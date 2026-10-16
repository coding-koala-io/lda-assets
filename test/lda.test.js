import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gateway,scratch,svg,quiet,A,B} from './helpers.js';
import {pathToFileURL} from 'node:url';
import {product} from '../src/product.js';
import {TenantRegistry} from '../src/tenants.js';
import {configuration,startServer,startupWarning,isCmpApiRoute,loopbackAddress,REMOTE_API_MESSAGE} from '../src/server.js';

const repo=resolve(import.meta.dirname,'..');
const pkg=JSON.parse(readFileSync(join(repo,'package.json'),'utf8'));
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const FOOTER=`LDA Local Assets ${pkg.version} · Development use only, not for production · Not affiliated with or endorsed by Optimizely · Optimizely® is a trademark of Optimizely North America Inc. · No warranty · <a href="/about">About</a> · <a href="/about/privacy">Privacy</a> · <a href="/about/licence">Licence</a> · <a href="/about/legal">Legal notice</a>`;
// The picker is opened by the CMS, so its footer links open in a new tab.
const FRAMED_FOOTER=FOOTER.replace(/(href="\/about[^"]*")/g,'$1 target="_blank" rel="noopener"');
function chrome(html,label){
 assert.match(html,/<title>[^<]* · LDA Local Assets<\/title>/,label+' title');
 assert.ok(html.includes('<strong>Development use only — not for production.</strong>'),label+' banner');
 assert.ok(html.includes('Local Developer Accelerator for Optimizely · by Coding Koala'),label+' banner suite');
 assert.ok(html.includes(label.startsWith('picker')?FRAMED_FOOTER:FOOTER),label+' footer');
}
/** A fresh connection whose remote address is reported as another machine. */
function remote(server,path,{method='GET',headers={},body}={}){
 return new Promise((accept,reject)=>{
  const req=http.request({host:'127.0.0.1',port:server.address().port,path,method,headers,agent:false},res=>{let text='';res.on('data',bytes=>text+=bytes);res.on('end',()=>accept({status:res.statusCode,text,json:()=>JSON.parse(text)}));});
  req.on('error',reject);req.end(body);
 });
}
function spoofRemote(server,address='192.0.2.10'){server.prependListener('connection',socket=>Object.defineProperty(socket,'remoteAddress',{value:address,configurable:true}));}

test('product identity comes from package.json and src/product.js',()=>{
 assert.deepEqual({...product},{key:'assets',name:'LDA Local Assets',suite:'Local Developer Accelerator for Optimizely',publisher:'Coding Koalas Pty Ltd',version:pkg.version,dataVersion:1,compatibleWith:'Optimizely DAM'});
 assert.equal(pkg.name,'lda-assets');assert.match(pkg.version,/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
 // Release metadata is checked by format, so a version bump does not break the tests.
 const license=readFileSync(join(repo,'LICENSE.md'),'utf8');assert.equal(license.match(/^Licensed Work:\s+(.+)$/m)?.[1].trim(),`LDA Local Assets ${pkg.version}`);
 const changeDate=license.match(/^Change Date:\s+(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];assert.ok(changeDate&&new Date(changeDate).toISOString().startsWith(changeDate),'Change Date is a valid YYYY-MM-DD date');
 const heading=readFileSync(join(repo,'CHANGELOG.md'),'utf8').split(/\r?\n/).find(line=>line.startsWith(`## [${pkg.version}] - `));assert.ok(heading&&/ - (unreleased|\d{4}-\d{2}-\d{2})$/.test(heading),'CHANGELOG has an unreleased or dated section for the package version');
assert.equal(pkg.private,true);assert.equal(pkg.license,'BUSL-1.1');assert.equal(pkg.author,'Coding Koalas Pty Ltd');
 assert.equal(pkg.repository,'github:coding-koala-io/lda-assets');assert.equal(pkg.homepage,'https://github.com/coding-koala-io/lda-assets#readme');assert.equal(pkg.engines.node,'>=24');
 assert.equal(pkg.description,'LDA Local Assets — local development stand-in compatible with Optimizely DAM. Part of Local Developer Accelerator for Optimizely by Coding Koala. Development use only.');
 assert.equal(pkg.scripts['release:build'],'node scripts/build-release.mjs');
});
test('/health reports product, version and dataVersion with instance details for loopback callers',async t=>{
 const gw=await gateway(t);const health=(await gw.request('/health')).data;
 assert.equal(health.status,'ok');assert.equal(health.product,'assets');assert.equal(health.version,pkg.version);assert.equal(health.dataVersion,1);assert.ok(health.tenants['site-a']);
});
test('tenants.json without dataVersion loads as version 1 and the first save writes dataVersion 1',async t=>{
 const gw=await gateway(t);assert.equal(JSON.parse(readFileSync(gw.file)).dataVersion,undefined);
 assert.equal((await gw.form('/tenants',{name:'Versioned'})).status,303);
 const saved=JSON.parse(readFileSync(gw.file));assert.equal(saved.dataVersion,1);assert.deepEqual(Object.keys(saved),['dataVersion','tenants']);
 const root=scratch(t);const file=join(root,'tenants.json');writeFileSync(file,JSON.stringify({dataVersion:1,tenants:[A]}));
 const registry=new TenantRegistry({tenantsFile:file,dataDir:':memory:',logDir:':memory:'},quiet,()=>'http://localhost:1');t.after(()=>registry.close());assert.equal(registry.entries.length,1);
});
test('data written by a newer version is refused with exit code 3 and the exact message',t=>{
 const root=scratch(t);const file=join(root,'tenants.json');writeFileSync(file,JSON.stringify({dataVersion:2,tenants:[A]}));
 assert.throws(()=>new TenantRegistry({tenantsFile:file,dataDir:':memory:',logDir:':memory:'},quiet,()=>'http://localhost:1'),error=>error.exitCode===3&&error.message===`Data in ${resolve(file)} was written by a newer version (dataVersion 2). Upgrade LDA Local Assets or restore a backup.`);
});
test('a non-numeric or non-positive-integer dataVersion is refused with exit code 3 and a clear message',t=>{
 const root=scratch(t);const file=join(root,'tenants.json');
 for(const value of [null,0,-1,1.5,'1','abc',true,[],{}]){
  const text=JSON.stringify({dataVersion:value,tenants:[A]});writeFileSync(file,text);
  assert.throws(()=>new TenantRegistry({tenantsFile:file,dataDir:':memory:',logDir:':memory:'},quiet,()=>'http://localhost:1'),error=>error.exitCode===3&&error.message===`Data in ${resolve(file)} has an invalid dataVersion (${JSON.stringify(value)}).`,JSON.stringify(value));
  assert.equal(readFileSync(file,'utf8'),text);
 }
});
test('server CLI exits with code 3 on an invalid dataVersion',{timeout:15000},async t=>{
 const root=scratch(t);const file=join(root,'tenants.json');writeFileSync(file,JSON.stringify({dataVersion:'abc',tenants:[A]}));
 const child=spawn(process.execPath,[join(repo,'src/server.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'0',HOST:'127.0.0.1',TENANTS_FILE:file,DATA_DIR:join(root,'data'),LOG_DIR:join(root,'logs'),ADMIN_USER:'',ADMIN_PASSWORD:''}});
 let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);const [code]=await once(child,'exit');
 assert.equal(code,3);assert.equal(stderr.trim(),`Data in ${resolve(file)} has an invalid dataVersion ("abc").`);
});
test('server CLI exits with code 3 on newer data and leaves the file untouched',{timeout:15000},async t=>{
 const root=scratch(t);const file=join(root,'tenants.json');const text=JSON.stringify({dataVersion:5,tenants:[A,B]});writeFileSync(file,text);
 const child=spawn(process.execPath,[join(repo,'src/server.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'0',HOST:'127.0.0.1',TENANTS_FILE:file,DATA_DIR:join(root,'data'),LOG_DIR:join(root,'logs'),ADMIN_USER:'',ADMIN_PASSWORD:''}});
 let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);const [code]=await once(child,'exit');
 assert.equal(code,3);assert.ok(stderr.includes(`Data in ${resolve(file)} was written by a newer version (dataVersion 5). Upgrade LDA Local Assets or restore a backup.`),stderr);
 assert.equal(readFileSync(file,'utf8'),text);
});
test('a hot reload of newer data is rejected and dashboard edits do not overwrite it',async t=>{
 const gw=await gateway(t);const text=JSON.stringify({dataVersion:2,tenants:[A]});writeFileSync(gw.file,text);
 await new Promise(accept=>setTimeout(accept,500));assert.ok(gw.server.tenants.find('site-b'));
 assert.equal((await gw.form('/tenants',{name:'Blocked'})).status,400);assert.equal(readFileSync(gw.file,'utf8'),text);
});
test('banner, header, title suffix and footer appear on dashboard, instance, asset, confirm, error, picker and about pages',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const runtime=gw.server.tenants.get('site-a');const asset=runtime.store.assets[0];
 const pages={dashboard:await gw.request('/'),instance:await gw.request('/tenants/site-a'),edit:await gw.request('/tenants/site-a/edit'),asset:await gw.request(`/tenants/site-a/assets/${asset.id}`),request:await gw.request(`/tenants/site-a/request/${runtime.log.recent[0].n}`),confirm:await gw.form('/tenants/site-a/confirm',{action:'delete'}),assetConfirm:await gw.form(`/tenants/site-a/assets/${asset.id}/confirm`,{}),error:await gw.request('/tenants/site-a/samples',{method:'POST',headers:{Accept:'text/html'},body:'csrf=wrong'}),picker:await gw.request('/i/site-a/cloud/library-picker'),pickerRoot:await gw.request('/i/site-a/'),about:await gw.request('/about'),privacy:await gw.request('/about/privacy'),licence:await gw.request('/about/licence'),legal:await gw.request('/about/legal')};
 for(const [label,page]of Object.entries(pages))chrome(page.data,label);
 assert.ok(pages.dashboard.data.includes('<a href="/">LDA Local Assets · Instances</a>'));
 assert.match(pages.dashboard.data,/<title>Instances · LDA Local Assets<\/title>/);
 assert.ok(pages.picker.data.includes('<header>LDA Local Assets · Asset picker</header>'));
 for(const [label,page]of Object.entries(pages))assert.equal(page.data.includes('target="_blank" rel="noopener"'),label.startsWith('picker'),label+' new-tab links');
 assert.ok(!pages.dashboard.data.includes('Local DAM'));
});
test('about pages show product facts and render the repository legal files as escaped text',async t=>{
 const gw=await gateway(t);const about=await gw.request('/about');assert.equal(about.status,200);
 for(const text of['LDA Local Assets','Local Developer Accelerator for Optimizely',`<dd>${pkg.version}</dd>`,'<dt>Data version</dt><dd>1</dd>','Coding Koalas Pty Ltd','Business Source License 1.1 — free for development and other non-production use','href="/about/privacy"','href="/about/licence"','href="/about/legal"'])assert.ok(about.data.includes(text),text);
 for(const [path,file]of[['/about/privacy','PRIVACY.md'],['/about/licence','LICENSE.md'],['/about/legal','LEGAL-NOTICE.md']]){
  const response=await gw.request(path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/^text\/html/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.ok(response.data.includes(`<pre>${escape(readFileSync(join(repo,file),'utf8'))}</pre>`),path);
 }
 assert.ok((await gw.request('/about/licence')).data.includes('Business Source License 1.1'));
 assert.equal((await gw.request('/about/unknown')).status,404);
});
test('about pages read files at request time, escape markup and return 404 text when a file is missing',async t=>{
 const root=scratch(t);const gw=await gateway(t,{aboutRoot:pathToFileURL(root+'/')});
 assert.equal((await gw.request('/about/privacy')).status,404);assert.match((await gw.request('/about/privacy')).data,/PRIVACY\.md was not found/);
 writeFileSync(join(root,'PRIVACY.md'),'# Changed <script>alert(1)</script>');
 const privacy=await gw.request('/about/privacy');assert.equal(privacy.status,200);assert.ok(privacy.data.includes('# Changed &lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(!privacy.data.includes('<script>alert(1)'));
 const legal=await gw.request('/about/legal');assert.equal(legal.status,404);chrome(legal.data,'missing');
});
test('about pages follow dashboard access rules',async t=>{
 const gw=await gateway(t,{host:'0.0.0.0',adminUser:'admin',adminPassword:'password'});
 for(const path of['/about','/about/privacy'])assert.equal((await gw.request(path)).status,401);
 assert.equal((await gw.request('/about',{headers:{Authorization:'Basic '+Buffer.from('admin:password').toString('base64')}})).status,200);
 const local=await gateway(t);assert.equal((await local.request('/about',{headers:{Origin:'https://evil.example'}})).status,403);
});
test('CMP API route and loopback address classification',()=>{
 for(const route of['/o/oauth2/v1/token','/v3/asset-lineages','/v3/asset-urls/'+'a'.repeat(32),'/v3/assets/'+'a'.repeat(32)+'/lineages','/v3/assets/x/lineages/y'])assert.ok(isCmpApiRoute(route),route);
 for(const route of['/','/cloud/library-picker','/files/'+'a'.repeat(32)+'.svg'])assert.ok(!isCmpApiRoute(route),route);
 for(const address of['127.0.0.1','127.10.20.30','::1','::ffff:127.0.0.1','::FFFF:127.1.2.3'])assert.ok(loopbackAddress(address),address);
 for(const address of['192.0.2.10','10.0.0.1','::ffff:192.0.2.10','fe80::1','0.0.0.0','',undefined,'localhost'])assert.ok(!loopbackAddress(address),String(address));
 assert.equal(configuration({}).allowRemoteApi,false);assert.equal(configuration({LDA_ALLOW_REMOTE_API:'true'}).allowRemoteApi,true);assert.equal(configuration({LDA_ALLOW_REMOTE_API:'TRUE'}).allowRemoteApi,true);assert.equal(configuration({LDA_ALLOW_REMOTE_API:'1'}).allowRemoteApi,false);
});
test('CMP token, lineage and asset URL API refuse other machines; files and picker stay available',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const asset=gw.server.tenants.get('site-a').store.assets[0];spoofRemote(gw.server);
 const json={'Content-Type':'application/json'};
 for(const [path,options]of[['/i/site-a/o/oauth2/v1/token',{method:'POST',headers:json,body:'{}'}],['/i/site-a/v3/asset-lineages'],[`/i/site-a/v3/asset-urls/${asset.id}`],[`/i/site-a/v3/assets/${asset.id}/lineages`,{method:'POST',headers:json,body:JSON.stringify({name:'Page',uri:'/page'})}],[`/i/site-a/v3/assets/${asset.id}/lineages/tracking`,{method:'DELETE'}],['/i/unknown/v3/asset-lineages']]){
  const response=await remote(gw.server,path,options);assert.equal(response.status,403,path);assert.deepEqual(response.json(),{message:REMOTE_API_MESSAGE});
 }
 assert.equal(REMOTE_API_MESSAGE,'This local development API only answers this machine. Set LDA_ALLOW_REMOTE_API=true to override (not recommended).');
 assert.equal(gw.server.tenants.get('site-a').store.state.usages.length,0);
 const file=await remote(gw.server,`/i/site-a/files/${asset.id}.svg`);assert.equal(file.status,200);assert.equal(file.text,svg().data.toString());
 assert.equal((await remote(gw.server,'/i/site-a/cloud/library-picker')).status,200);assert.equal((await remote(gw.server,'/i/site-a/')).status,200);
 const local=await gw.request('/i/site-a/v3/asset-lineages');assert.equal(local.status,200);
});
test('LDA_ALLOW_REMOTE_API=true lets other machines use the CMP API',async t=>{
 const gw=await gateway(t,{allowRemoteApi:true});await gw.upload([svg()]);const asset=gw.server.tenants.get('site-a').store.assets[0];spoofRemote(gw.server);
 const token=await remote(gw.server,'/i/site-a/o/oauth2/v1/token',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(token.status,200);assert.equal(token.json().token_type,'Bearer');
 const added=await remote(gw.server,`/i/site-a/v3/assets/${asset.id}/lineages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Page',uri:'/page'})});assert.equal(added.status,200);
 assert.equal((await remote(gw.server,`/i/site-a/v3/asset-urls/${asset.id}`)).status,200);
});
test('startup logs the product line; a non-loopback HOST prints a loud warning first',async t=>{
 const root=scratch(t);const lines=[];const logger={log:line=>lines.push(['log',line]),warn:line=>lines.push(['warn',line]),error(){}};
 const server=await startServer({host:'127.0.0.1',port:0,tenantsFile:join(root,'tenants.json'),dataDir:':memory:',logDir:':memory:',logger,adminUser:'',adminPassword:''});
 t.after(()=>new Promise(accept=>server.close(accept)));
 assert.deepEqual(lines,[['log',`LDA Local Assets ${pkg.version} (Local Developer Accelerator for Optimizely) listening at http://127.0.0.1:${server.address().port} — development use only`]]);
 const warning=startupWarning('0.0.0.0');for(const text of['development use only','NOT for production','HOST=0.0.0.0','anyone on the network can reach this server','Never point a shared, staging or production site at it'])assert.ok(warning.includes(text),text);assert.ok(warning.split('\n').length>=5);
 const remoteLines=[];const remoteLogger={log:line=>remoteLines.push(['log',line]),warn:line=>remoteLines.push(['warn',line]),error(){}};
 // TEST-NET address: printing happens before listen, which then fails without opening a port.
 await assert.rejects(startServer({host:'192.0.2.1',port:0,tenantsFile:join(root,'remote.json'),dataDir:':memory:',logDir:':memory:',logger:remoteLogger,adminUser:'admin',adminPassword:'password'}));
 assert.deepEqual(remoteLines[0],['warn',startupWarning('192.0.2.1')]);assert.equal(remoteLines.some(([,line])=>line.includes('listening at')),false);
});
