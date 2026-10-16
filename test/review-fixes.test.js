import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {cmsSettings} from '../src/cms-settings.js';
import {gateway,svg,A} from './helpers.js';

const connect=html=>JSON.parse(/<pre id="settings">([\s\S]*?)<\/pre>/.exec(html)[1].replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&amp;/g,'&'));

test('CMS settings use a bare origin even with PUBLIC_BASE_URL paths and trailing slashes',()=>{
 for(const base of['http://localhost:8083','http://localhost:8083/','http://localhost:8083/prefix/path///']){
  const settings=cmsSettings(A,base).Optimizely;
  assert.equal(settings.Cms.DamUI.Endpoint,'http://localhost:8083');assert.equal(settings.Cms.DamUI.Path,'i/site-a/cloud/library-picker');
  const popup=new URL(settings.Cms.DamUI.Endpoint);popup.pathname=settings.Cms.DamUI.Path;
  assert.equal(popup.href,'http://localhost:8083/i/site-a/cloud/library-picker');assert.equal(popup.origin,settings.Cms.DamUI.Endpoint);
  assert.equal(settings.Cmp.Client.ApiUrl,'http://localhost:8083/i/site-a/v3/');
 }
});
test('Connect snippet and file URLs normalize the configured public URL to its origin',async t=>{
 const gw=await gateway(t,{publicBaseUrl:'https://dam.example:8443/ignored/path///'});
 const settings=connect((await gw.request('/tenants/site-a')).data).Optimizely;
 assert.equal(settings.Cms.DamUI.Endpoint,'https://dam.example:8443');
 await gw.upload([svg()]);const asset=gw.server.tenants.get('site-a').store.assets[0];
 assert.equal((await gw.request(`/i/site-a/v3/asset-urls/${asset.id}`)).data.url,`https://dam.example:8443/i/site-a/files/${asset.id}.svg`);
});
test('Connect snippet without PUBLIC_BASE_URL uses the actual port without a slash',async t=>{
 const gw=await gateway(t);const settings=connect((await gw.request('/tenants/site-a')).data).Optimizely;
 assert.equal(settings.Cms.DamUI.Endpoint,`http://localhost:${gw.server.address().port}`);
});
test('admin pages and confirmation/error pages allow self framing; popup picker denies framing',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const runtime=gw.server.tenants.get('site-a');const asset=runtime.store.assets[0];
 const pages=await Promise.all(['/', '/tenants/site-a','/tenants/site-a/edit',`/tenants/site-a/assets/${asset.id}`,`/tenants/site-a/request/${runtime.log.recent[0].n}`].map(path=>gw.request(path)));
 pages.push(await gw.form('/tenants/site-a/confirm',{action:'clear'}));
 pages.push(await gw.form(`/tenants/site-a/assets/${asset.id}/confirm`,{}));
 pages.push(await gw.request('/tenants/site-a/samples',{method:'POST',headers:{Accept:'text/html'},body:'csrf=wrong'}));
 for(const page of pages){assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.equal(page.headers.get('x-frame-options'),'SAMEORIGIN');}
 for(const path of['/i/site-a/','/i/site-a/cloud/library-picker']){const picker=await gw.request(path);assert.match(picker.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(picker.headers.get('x-frame-options'),'DENY');}
});
test('uploaded HTML retains sandbox CSP for GET, HEAD and conditional responses',async t=>{
 const gw=await gateway(t);const html='<script>parent.alert(1)</script>';await gw.upload([{filename:'page.html',mimeType:'text/html',data:Buffer.from(html)}]);
 const asset=gw.server.tenants.get('site-a').store.assets[0];const path=`/i/site-a/files/${asset.id}.html`;
 const get=await gw.request(path);assert.equal(get.data,html);assert.equal(get.status,200);
 for(const response of[get,await gw.request(path,{method:'HEAD'}),await gw.request(path,{headers:{'If-None-Match':asset.etag}})]){
  assert.equal(response.headers.get('content-security-policy'),"sandbox; default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(response.headers.get('x-frame-options'),null);
 }
});
test('lineage POST/DELETE and token reject unsupported or missing media types before parsing',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const store=gw.server.tenants.get('site-a').store;const path=`/i/site-a/v3/assets/${store.assets[0].id}/lineages`;
 for(const [route,method]of[[path,'POST'],[path+'/tracking-id','DELETE'],['/i/site-a/o/oauth2/v1/token','POST']]){
  for(const type of['','text/plain','application/jsonp','multipart/form-data']){
   const response=await gw.request(route,{method,headers:{'Content-Type':type},body:'{invalid JSON'});assert.equal(response.status,415,method+' '+type);
  }
  assert.equal((await gw.request(route,{method})).status,method==='DELETE'?204:415,'missing Content-Type');
 }
 for(const method of['POST','DELETE'])assert.equal((await gw.request(method==='POST'?path:path+'/tracking-id',{method,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'name=x&uri=/x'})).status,415);
 assert.equal(store.state.usages.length,0);
});
test('lineage accepts JSON parameters/casing and token accepts JSON or form only',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const store=gw.server.tenants.get('site-a').store;const path=`/i/site-a/v3/assets/${store.assets[0].id}/lineages`;
 const created=await gw.request(path,{method:'POST',headers:{'Content-Type':'Application/JSON; charset=utf-8'},body:{name:'Page',uri:'/page'}});assert.equal(created.status,200);
 assert.equal((await gw.request(path+'/'+created.data.id,{method:'DELETE',headers:{'Content-Type':'application/json; charset=utf-8'}})).status,204);assert.equal(store.state.usages.length,0);
 for(const type of['application/json; charset=utf-8','Application/X-WWW-Form-Urlencoded; charset=utf-8'])assert.equal((await gw.request('/i/site-a/o/oauth2/v1/token',{method:'POST',headers:{'Content-Type':type},body:type.startsWith('application/json')?'{}':'grant_type=client_credentials'})).status,200);
 assert.equal((await gw.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
});
test('GET uses disk streams; HEAD/304 use cached SHA-256 metadata without opening files',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const store=gw.server.tenants.get('site-a').store;const asset=store.assets[0];const path=`/i/site-a/files/${asset.id}.svg`;
 const etag='"'+createHash('sha256').update(svg().data).digest('hex')+'"';assert.equal(asset.etag,etag);
 store.readFile=()=>assert.fail('HTTP must not buffer entire file');const open=store.openFile.bind(store);let opens=0;
 store.openFile=(...args)=>{opens++;const stream=open(...args);assert.ok(stream instanceof ReadStream);return stream;};
 for(const options of[{method:'HEAD'},{headers:{'If-None-Match':etag}},{headers:{'If-None-Match':'W/'+etag}},{headers:{'If-None-Match':'*'}}]){
  const response=await gw.request(path,options);assert.equal(response.status,options.method?200:304);assert.equal(response.data,'');assert.equal(response.headers.get('etag'),etag);assert.equal(response.headers.get('accept-ranges'),'bytes');
 }
 assert.equal(opens,0);assert.equal((await gw.request(path)).data,svg().data.toString());assert.equal(opens,1);
 const replacement=svg('Changed');store.replace(asset.id,replacement);assert.notEqual(asset.etag,etag);
 const fresh=await gw.request(path,{headers:{'If-None-Match':etag}});assert.equal(fresh.status,200);assert.equal(fresh.data,replacement.data.toString());assert.equal(fresh.headers.get('etag'),asset.etag);
});
for(const memory of[false,true])test(`single byte ranges stream exact slices (${memory?'memory':'disk'})`,async t=>{
 const gw=await gateway(t,memory?{dataDir:':memory:'}:{});const store=gw.server.tenants.get('site-a').store;const [asset]=store.upload([{filename:'digits.txt',mimeType:'text/plain',data:Buffer.from('0123456789')}]);const path=`/i/site-a/files/${asset.id}.txt`;
 for(const [range,expected,start,end]of[['bytes=0-0','0',0,0],['bytes=2-5','2345',2,5],['bytes=7-','789',7,9],['bytes=-3','789',7,9],['bytes=8-999','89',8,9],['bytes=-999','0123456789',0,9]]){
  const response=await gw.request(path,{headers:{Range:range}});assert.equal(response.status,206,range);assert.equal(response.data,expected);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/10`);assert.equal(Number(response.headers.get('content-length')),expected.length);assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('etag'),asset.etag);
 }
 for(const range of['bytes=10-','bytes=99-100','bytes=5-2','bytes=-0']){const response=await gw.request(path,{headers:{Range:range}});assert.equal(response.status,416,range);assert.equal(response.headers.get('content-range'),'bytes */10');}
 for(const range of['bytes=bad','bytes=0-1,4-5','items=0-1']){const response=await gw.request(path,{headers:{Range:range}});assert.equal(response.status,200);assert.equal(response.data,'0123456789');}
 assert.equal((await gw.request(path,{headers:{Range:'bytes=0-1','If-None-Match':asset.etag}})).status,304);
 const head=await gw.request(path,{method:'HEAD',headers:{Range:'bytes=0-1'}});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'10');assert.equal(head.data,'');
 assert.equal((await gw.request(path,{headers:{Range:'bytes=0-1','If-Range':'"stale"'}})).status,200);
 assert.equal((await gw.request(path,{headers:{Range:'bytes=0-1','If-Range':asset.etag}})).status,206);
});
test('lineage DELETE exactly as the CMS sends it (no body, no Content-Type) removes the usage',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const asset=gw.server.tenants.get('site-a').store.assets[0];const path=`/i/site-a/v3/assets/${asset.id}/lineages`;
 const added=await gw.request(path,{method:'POST',body:{name:'Start',uri:'https://cms.example/'},headers:{Authorization:'epi-hmac key:1:nonce:sig'}});assert.equal(added.status,200);
 const removed=await gw.request(path+'/'+added.data.id,{method:'DELETE',headers:{Authorization:'epi-hmac key:1:nonce:sig',Accept:'application/json'}});assert.equal(removed.status,204);
 assert.deepEqual((await gw.request('/i/site-a/v3/asset-lineages')).data,{data:[]});
});
