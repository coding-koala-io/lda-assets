import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {gateway,svg,eventually} from './helpers.js';
import {TYPE_MODEL,graphDocument} from '../src/graph-sync.js';
async function fakeGraph(t,{status=200,journalError=false}={}){
 const requests=[];let currentStatus=status;let delay=0;
 const server=http.createServer(async(req,res)=>{let body='';for await(const bytes of req)body+=bytes;requests.push({method:req.method,url:req.url,auth:req.headers.authorization,contentType:req.headers['content-type'],body});if(delay)await new Promise(accept=>setTimeout(accept,delay));res.writeHead(currentStatus,{'Content-Type':'application/json'});res.end(JSON.stringify(currentStatus>=400?{message:'Synthetic sync failure'}:req.url.startsWith('/_stream')?{journalId:'synthetic-journal'}:req.url.startsWith('/journal/')?{errors:journalError,items:[]}:{}));});
 await new Promise(accept=>server.listen(0,'127.0.0.1',accept));t.after(()=>new Promise(accept=>server.close(accept)));
 return{requests,graph:{gatewayAddress:`http://127.0.0.1:${server.address().port}`,appKey:'fake-app',secret:'fake-secret'},setStatus:value=>currentStatus=value,setDelay:value=>delay=value};
}
async function linkGraph(gw,fake){await gw.server.tenants.edit(entries=>entries.map(entry=>entry.id==='site-a'?{...entry,graph:fake.graph}:entry));}
test('Graph sync PUT exact cmp model, Basic credentials and NDJSON index/document/delete formats',async t=>{
 const fake=await fakeGraph(t);const gw=await gateway(t,{publicBaseUrl:'http://dam.example:8083'});await linkGraph(gw,fake);await gw.upload([svg()]);assert.equal((await gw.form('/tenants/site-a/sync',{})).status,303);
 const types=fake.requests.find(request=>request.method==='PUT');assert.equal(types.url,'/api/content/v3/types?id=cmp');assert.deepEqual(JSON.parse(types.body),TYPE_MODEL);assert.deepEqual(Object.keys(JSON.parse(types.body).contentTypes),['cmp_Asset','cmp_PublicImageAsset','cmp_PublicVideoAsset','cmp_PublicRawFileAsset','cmp_PublicImageAssetRendition','cmp_PublicVideoAssetRendition']);
 const stream=fake.requests.find(request=>request.url==='/_stream');const lines=stream.body.trim().split('\n').map(JSON.parse);assert.equal(lines.length,2);const store=gw.server.tenants.get('site-a').store;const asset=store.assets[0];assert.equal(lines[0].index._id,'cmp_'+asset.id);assert.ok(Date.parse(lines[0].index._snapshotTime));assert.deepEqual(lines[1],graphDocument(asset,gw.server.tenants.find('site-a'),'http://dam.example:8083'));assert.equal(lines[1].Url,`http://dam.example:8083/i/site-a/files/${asset.id}.svg`);assert.deepEqual(lines[1]._rbac,['r:Everyone:Read']);assert.deepEqual(lines[1]._imageMetadata,{width:120,height:80});
 for(const request of fake.requests)assert.equal(request.auth,'Basic '+Buffer.from('fake-app:fake-secret').toString('base64'));
 await gw.form(`/tenants/site-a/assets/${asset.id}/delete`,{confirmation:asset.id});await gw.form('/tenants/site-a/sync',{});const deleted=fake.requests.filter(request=>request.url==='/_stream').at(-1).body.trim().split('\n').map(JSON.parse);assert.deepEqual(deleted,[{delete:{_id:'cmp_'+asset.id}}]);assert.deepEqual(store.state.pendingDeletes,[]);assert.equal(store.state.lastSync.error,null);
 assert.equal((await gw.form('/tenants/site-a/check',{})).status,303);assert.equal(gw.server.tenants.get('site-a').visibility.visible,true);assert.ok(fake.requests.some(request=>request.url==='/api/content/v3/sources?id=cmp'));
});
test('asset changes debounce for one second and repeated changes coalesce',async t=>{const fake=await fakeGraph(t);const gw=await gateway(t);await linkGraph(gw,fake);await gw.upload([svg()]);const runtime=gw.server.tenants.get('site-a');await new Promise(accept=>setTimeout(accept,100));runtime.store.edit(runtime.store.assets[0].id,{title:'Newest title'});runtime.sync.schedule();await new Promise(accept=>setTimeout(accept,850));assert.equal(fake.requests.length,0);await eventually(()=>runtime.store.state.lastSync?.error===null);assert.equal(fake.requests.filter(request=>request.url==='/_stream').length,1);assert.ok(fake.requests.find(request=>request.url==='/_stream').body.includes('Newest title'));});
test('sync failures preserve assets and deletions for retry and appear on dashboard',async t=>{const fake=await fakeGraph(t,{status:503});const gw=await gateway(t);await linkGraph(gw,fake);await gw.upload([svg()]);const runtime=gw.server.tenants.get('site-a');await gw.form('/tenants/site-a/sync',{});assert.equal(runtime.store.assets.length,1);assert.equal(runtime.store.state.lastSync.status,503);assert.match(runtime.store.state.lastSync.error,/Synthetic sync failure/);assert.match((await gw.request('/tenants/site-a')).data,/HTTP 503/);const id=runtime.store.assets[0].id;runtime.store.delete(id);await runtime.sync.sync();assert.deepEqual(runtime.store.state.pendingDeletes,[id]);fake.setStatus(200);await runtime.sync.sync();assert.deepEqual(runtime.store.state.pendingDeletes,[]);assert.equal(runtime.store.state.lastSync.error,null);});
test('HTTP-success indexing journal errors count as a failed sync',async t=>{const fake=await fakeGraph(t,{journalError:true});const gw=await gateway(t);await linkGraph(gw,fake);await gw.upload([svg()]);await gw.form('/tenants/site-a/sync',{});assert.match(gw.server.tenants.get('site-a').store.state.lastSync.error,/journal reports errors/);});
test('missing link and network/visibility errors are recorded without breaking dashboard',async t=>{const gw=await gateway(t);const runtime=gw.server.tenants.get('site-a');await runtime.sync.sync();assert.match(runtime.store.state.lastSync.error,/Configure Graph/);runtime.sync.fetch=async()=>{throw new Error('Synthetic offline');};runtime.tenant.graph={gatewayAddress:'http://fake.invalid',appKey:'x',secret:'x'};await runtime.sync.sync();assert.match(runtime.store.state.lastSync.error,/Synthetic offline/);assert.equal((await runtime.sync.check()).visible,false);assert.equal((await gw.request('/tenants/site-a')).status,200);});
test('deleting an instance can remove Graph docs; failed cleanup retains instance',async t=>{const fake=await fakeGraph(t);const gw=await gateway(t);await linkGraph(gw,fake);await gw.upload([svg()]);const asset=gw.server.tenants.get('site-a').store.assets[0];fake.setStatus(503);assert.equal((await gw.form('/tenants/site-a/delete',{confirmation:'site-a',removeGraph:'yes'})).status,502);assert.ok(gw.server.tenants.find('site-a'));fake.setStatus(200);assert.equal((await gw.form('/tenants/site-a/delete',{confirmation:'site-a',removeGraph:'yes'})).status,303);assert.ok(!gw.server.tenants.find('site-a'));const stream=fake.requests.filter(request=>request.url==='/_stream').at(-1);assert.deepEqual(stream.body.trim().split('\n').map(JSON.parse),[{delete:{_id:'cmp_'+asset.id}}]);});
test('serialized sync takes a fresh snapshot for a queued run',async t=>{const fake=await fakeGraph(t);const gw=await gateway(t);await linkGraph(gw,fake);await gw.upload([svg()]);const runtime=gw.server.tenants.get('site-a');fake.setDelay(30);const first=runtime.sync.sync();await eventually(()=>fake.requests.length>0);runtime.store.edit(runtime.store.assets[0].id,{title:'Queued newest title'});const second=runtime.sync.sync();await Promise.all([first,second]);assert.match(fake.requests.filter(request=>request.url==='/_stream').at(-1).body,/Queued newest title/);});

test('Graph documents restrict dimensions to media types and normalize legacy values',()=>{
 const base={id:'a'.repeat(32),ext:'bin',width:12.6,height:9.4};
 for(const type of['image','video']){
  const doc=graphDocument({...base,type},{id:'site-a'},'http://localhost:8083');
  assert.equal(doc.Width,13);assert.equal(doc.Height,9);
  if(type==='image')assert.deepEqual(doc._imageMetadata,{width:13,height:9});else assert.equal(doc._imageMetadata,undefined);
 }
 const limit=graphDocument({...base,type:'image',width:2147483647.1,height:2147483647.49},{id:'site-a'},'http://localhost:8083');assert.equal(limit.Width,2147483647);assert.equal(limit.Height,2147483647);
 const raw=graphDocument({...base,type:'raw_file'},{id:'site-a'},'http://localhost:8083');
 for(const key of['Width','Height','_imageMetadata'])assert.equal(Object.hasOwn(raw,key),false);
 for(const value of[0,-1,0.1,2147483648,2147483647.5,Infinity,NaN]){
  const doc=graphDocument({...base,type:'image',width:value,height:value},{id:'site-a'},'http://localhost:8083');
  assert.equal(Object.hasOwn(doc,'Width'),false);assert.equal(Object.hasOwn(doc,'Height'),false);assert.deepEqual(doc._imageMetadata,{});
 }
});
test('Graph stream sends rounded SVG dimensions and omits dimensions from raw/video uploads',async t=>{
 const fake=await fakeGraph(t);const gw=await gateway(t);await linkGraph(gw,fake);
 const bytes=Buffer.from('<svg width="12.6" viewBox="0 0 3 1"/>');
 await gw.upload([{filename:'fractional.svg',mimeType:'image/svg+xml',data:bytes},{filename:'raw.html',mimeType:'text/html',data:bytes},{filename:'video.mp4',mimeType:'video/mp4',data:bytes}]);
 await gw.form('/tenants/site-a/sync',{});
 const docs=fake.requests.find(request=>request.url==='/_stream').body.trim().split('\n').map(JSON.parse).filter(value=>value.__typename);
 assert.equal(docs[0].Width,13);assert.equal(docs[0].Height,4);assert.deepEqual(docs[0]._imageMetadata,{width:13,height:4});
 for(const doc of docs.slice(1)){assert.equal(Object.hasOwn(doc,'Width'),false);assert.equal(Object.hasOwn(doc,'Height'),false);assert.equal(Object.hasOwn(doc,'_imageMetadata'),false);}
});
