import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {ADMIN_PAGE_HEADERS,PICKER_PAGE_HEADERS} from './page-security.js';
import {TenantRegistry,loopback} from './tenants.js';
import {adminAccess} from './admin-access.js';
import {handleDashboard} from './dashboard-routes.js';
import {pickerHtml} from './picker.js';
import {fileUrl} from './store.js';
import {readBody,parseJson,fail,byteRange} from './http-utils.js';
import {MAX_UPLOAD_SIZE} from './multipart.js';
import {truncate,redactUrl,sanitizeLog,safeHeaders} from './request-log.js';
import {page,e} from './dashboard.js';
import {product} from './product.js';

export const REMOTE_API_MESSAGE='This local development API only answers this machine. Set LDA_ALLOW_REMOTE_API=true to override (not recommended).';
/** CMP API routes used by the CMS server: OAuth token and v3 lineage/asset-url endpoints. */
export const isCmpApiRoute=route=>route==='/o/oauth2/v1/token'||route.startsWith('/v3/');
/** Loopback callers only: 127.0.0.0/8, ::1 and IPv4-mapped 127.x addresses. */
export const loopbackAddress=address=>/^(::1|(::ffff:)?127(?:\.\d{1,3}){3})$/i.test(String(address??''));

export function configuration(env=process.env){
  return {port:Number(env.PORT??8083),host:env.HOST??'127.0.0.1',tenantsFile:env.TENANTS_FILE??'./tenants.json',dataDir:env.DATA_DIR??'./data',logDir:env.LOG_DIR??'./logs',adminUser:env.ADMIN_USER??'',adminPassword:env.ADMIN_PASSWORD??'',publicBaseUrl:env.PUBLIC_BASE_URL??'',publicHostnames:env.PUBLIC_HOSTNAMES??'',logBodies:(env.LOG_BODIES??'true').toLowerCase()!=='false',allowRemoteApi:(env.LDA_ALLOW_REMOTE_API??'').toLowerCase()==='true'};
}
export function createServer(options={}){
  const config={...configuration(),...options};const logger=config.logger??console;
  if(!Number.isInteger(config.port)||config.port<0||config.port>65535)throw new Error('PORT must be an integer from 0 to 65535');
  if(!loopback(config.host)&&(!config.adminUser||!config.adminPassword))throw new Error('ADMIN_USER and ADMIN_PASSWORD are required when HOST is not loopback');
  if(config.publicBaseUrl){const url=new URL(config.publicBaseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin');}
  let server;
  const publicBase=()=>(config.publicBaseUrl?new URL(config.publicBaseUrl).origin:'')||`http://localhost:${server?.address()?.port??config.port}`;
  const registry=new TenantRegistry(config,logger,publicBase);const token=randomBytes(32).toString('hex');
  server=http.createServer(async(request,response)=>{
    const started=performance.now();let runtime;let reqBody=null;let resBody=null;const diagnostic={};
    const auth=request.headers.authorization?.split(/\s+/)[0].toLowerCase();
    const authKind=auth==='epi-hmac'?'epi-hmac':auth==='bearer'?'bearer':request.headers['x-user-sso-id']?'sso':auth??'none';
    response.setHeader('X-Content-Type-Options','nosniff');
    response.on('finish',()=>{
      const byteLength=body=>Buffer.byteLength(typeof body==='string'?body:JSON.stringify(body)??'');
      const entry={ts:new Date().toISOString(),method:request.method,url:redactUrl(request.url),status:response.statusCode,ms:Math.round(performance.now()-started),authKind,headers:safeHeaders(request.headers),reqBody:config.logBodies?truncate(sanitizeLog(reqBody)):null,resBody:config.logBodies?truncate(sanitizeLog(resBody)):null,reqTruncated:config.logBodies&&byteLength(reqBody)>65536,resTruncated:config.logBodies&&byteLength(resBody)>65536};
      (runtime&&!diagnostic.suppressTenantLog?runtime.log:registry.unrouted).append(entry);
      logger.log(`[${runtime?.tenant.id??'_unrouted'}] ${request.method} ${entry.url} ${response.statusCode} ${entry.ms}ms auth=${authKind}`);
    });
    function send(status,body,contentType='application/json; charset=utf-8',headers={}){
      resBody=Buffer.isBuffer(body)?`<${body.length} bytes binary>`:contentType.startsWith('text/html')?`<HTML ${Buffer.byteLength(body??'')} bytes>`:body;
      response.statusCode=status;response.setHeader('Content-Type',contentType);
      for(const [name,value]of Object.entries(headers))if(!response.hasHeader(name))response.setHeader(name,value);
      response.end(request.method==='HEAD'||status===204||status===304?undefined:Buffer.isBuffer(body)?body:contentType.startsWith('application/json')?JSON.stringify(body):body);return true;
    }
    const redirect=location=>{response.setHeader('Location',location);return send(303,'Redirecting','text/plain; charset=utf-8');};
    try{
      const url=new URL(request.url,'http://localhost');const path=url.pathname.replace(/\/$/,'')||'/';const method=request.method;
      const sdk=/^\/i\/([^/]+)(?:\/(.*))?$/.exec(path);
      if(sdk){
        if(!config.allowRemoteApi&&isCmpApiRoute('/'+(sdk[2]??''))&&!loopbackAddress(request.socket.remoteAddress))return send(403,{message:REMOTE_API_MESSAGE});
        runtime=registry.get(decodeURIComponent(sdk[1]));if(!runtime)return send(404,{message:'Instance not found'});
        if(runtime.busy)return send(503,{message:'Instance storage maintenance in progress'});
        const route='/'+(sdk[2]??'');const store=runtime.store;
        if(method==='GET'&&(route==='/'||route==='/cloud/library-picker'))return send(200,pickerHtml(runtime,url.searchParams,publicBase()),'text/html; charset=utf-8',PICKER_PAGE_HEADERS);
        const file=/^\/files\/([a-f0-9]{32})\.([a-z0-9]{1,12})$/.exec(route);
        if(file&&['GET','HEAD','OPTIONS'].includes(method)){
          response.setHeader('Access-Control-Allow-Origin','*');response.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');response.setHeader('Access-Control-Allow-Headers','If-None-Match, Range, If-Range');response.setHeader('Access-Control-Expose-Headers','ETag, Content-Length, Content-Range, Accept-Ranges');
          if(method==='OPTIONS')return send(204,null);
          const asset=store.asset(file[1]);if(asset.ext!==file[2])return send(404,{message:'File not found'});
          if(!store.hasFile(asset))return send(404,{message:'File not found'});
          const etag=asset.etag;response.setHeader('ETag',etag);response.setHeader('Cache-Control','public, max-age=60');
          response.setHeader('Accept-Ranges','bytes');
          response.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");
          const matches=(request.headers['if-none-match']??'').split(',').map(value=>value.trim().replace(/^W\//,''));
          if(matches.includes(etag)||matches.includes('*'))return send(304,null,asset.mimeType);
          const range=method==='GET'&&(!request.headers['if-range']||request.headers['if-range']===etag)?byteRange(request.headers.range,asset.fileSize):null;
          if(range===false){response.setHeader('Content-Range',`bytes */${asset.fileSize}`);return send(416,{message:'Requested range not satisfiable'});}
          const length=range?range.end-range.start+1:asset.fileSize;
          response.setHeader('Content-Length',length);
          if(range)response.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${asset.fileSize}`);
          if(asset.type==='raw_file')response.setHeader('Content-Disposition',`attachment; filename="${asset.id}.${asset.ext}"`);
          if(method==='HEAD')return send(200,null,asset.mimeType);
          response.statusCode=range?206:200;response.setHeader('Content-Type',asset.mimeType);resBody=`<${length} bytes binary>`;
          await pipeline(store.openFile(asset,range??{}),response);return;

        }
        const lineage=/^\/v3\/assets\/([a-f0-9]{32})\/lineages(?:\/([^/]+))?$/.exec(route);
        const isToken=method==='POST'&&route==='/o/oauth2/v1/token';
        const contentType=(request.headers['content-type']??'').split(';')[0].trim().toLowerCase();
        const hasBody=Number(request.headers['content-length']??0)>0||request.headers['transfer-encoding']!==undefined;
        // The CMS sends lineage DELETE without a body or Content-Type; only bodies need a JSON media type.
        const isLineage=(method==='POST'&&lineage&&!lineage[2])||(method==='DELETE'&&lineage?.[2]&&hasBody);
        if((isLineage&&contentType!=='application/json')||(isToken&&!['application/json','application/x-www-form-urlencoded'].includes(contentType)))throw fail('Unsupported Content-Type',415);
        let body={};
        if(['POST','DELETE'].includes(method)){
          const bytes=await readBody(request);const text=bytes.toString('utf8');
          body=text?contentType==='application/x-www-form-urlencoded'?Object.fromEntries(new URLSearchParams(text)):parseJson(text):{};reqBody=body;
          if(runtime.busy||registry.find(runtime.tenant.id)!==runtime.tenant)throw fail('Instance storage maintenance in progress',503);
        }
        if(isToken)return send(200,{token_type:'Bearer',access_token:randomBytes(32).toString('base64url'),expires_in:3600});
        if(method==='GET'&&route==='/v3/asset-lineages')return send(200,{data:store.state.usages});
        const assetUrl=/^\/v3\/asset-urls\/([a-f0-9]{32})$/.exec(route);
        if(method==='GET'&&assetUrl)return send(200,{url:fileUrl(runtime.tenant,store.asset(assetUrl[1]),publicBase())});
        if(method==='POST'&&lineage&&!lineage[2])return send(200,{id:store.addUsage(lineage[1],body).trackingId});
        if(method==='DELETE'&&lineage?.[2]){store.deleteUsage(lineage[1],decodeURIComponent(lineage[2]));return send(204,null);}
        return send(404,{message:'Not found'});
      }
      const access=adminAccess(request,config,response);if(access.status)return send(access.status,{message:access.message});
      if(method==='GET'&&path==='/health')return send(200,{status:'ok',product:product.key,version:product.version,dataVersion:product.dataVersion,...(!loopback(config.host)&&!access.validAdmin?{}:{tenants:registry.health()})});
      const tenantRoute=/^\/tenants\/([^/]+)(?:\/|$)/.exec(path);
      if(tenantRoute){runtime=registry.get(decodeURIComponent(tenantRoute[1]));if(!runtime)return send(404,{message:'Instance not found'});if(runtime.busy)return send(503,{message:'Instance storage maintenance in progress'});}
      let bytes=Buffer.alloc(0);
      if(method==='POST'){
        const multipart=(request.headers['content-type']??'').startsWith('multipart/form-data');bytes=await readBody(request,multipart?MAX_UPLOAD_SIZE:1024*1024);
        reqBody=multipart?`<multipart upload: ${bytes.length} bytes>`:Object.fromEntries(new URLSearchParams(bytes.toString('utf8')));
      }
      if(await handleDashboard({aboutRoot:config.aboutRoot,path,method,url,bytes,headers:request.headers,registry,runtime,token,send,redirect,publicBase:publicBase(),diagnostic}))return;
      return send(404,{message:'Not found'});
    }catch(error){
      logger.error(error.stack??error.message);
      if(!response.headersSent){
        const status=error.status??(error.code==='ENOENT'?404:400);
        if((request.headers.accept??'').includes('text/html'))send(status,page('Request could not be completed',`<p class="error" role="alert">${e(error.message)}</p><p>Return to the previous page to correct the form. ${'<a href="/">Open instances</a>'}</p>`),'text/html; charset=utf-8',ADMIN_PAGE_HEADERS);
        else send(status,{message:error.code==='ENOENT'?'File not found':error.message});
      }else response.destroy(error);
    }
  });
  server.config=config;server.tenants=registry;server.publicBase=publicBase;
  const close=server.close;
  server.close=function(callback){return close.call(this,async error=>{try{await registry.close();callback?.(error);}catch(failure){logger.error(failure.message);callback?.(failure);}});};
  return server;
}
export function startupWarning(host){
  return ['','!'.repeat(72),`WARNING: ${product.name} is for development use only and is NOT for production.`,`HOST=${host} is not a loopback address: anyone on the network can reach this server.`,'Never point a shared, staging or production site at it.','Bind HOST=127.0.0.1 unless you understand and accept this risk.','!'.repeat(72),''].join('\n');
}
export async function startServer(options={}){
  const server=createServer(options);const logger=options.logger??console;
  if(!loopback(server.config.host))(logger.warn??logger.log).call(logger,startupWarning(server.config.host));
  try{await new Promise((accept,reject)=>{server.once('error',reject);server.listen(server.config.port,server.config.host,accept);});}
  catch(error){await server.tenants.close();throw error;}
  logger.log(`${product.name} ${product.version} (${product.suite}) listening at http://${server.config.host}:${server.address().port} — development use only`);return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let server;
  try{server=await startServer();}catch(error){console.error(error.message);process.exit(error.exitCode??1);}
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;server.close(error=>{if(error){console.error(error);process.exitCode=1;}});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('SIGBREAK',stop);
}
