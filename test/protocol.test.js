import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {gateway,svg} from './helpers.js';

test('multipart single/multiple uploads, file MIME, cache, CORS, conditional GET and HEAD',async t=>{
 const gw=await gateway(t);assert.equal((await gw.upload([svg()])).status,303);assert.equal((await gw.upload([svg('Second'),{filename:'Guide.pdf',mimeType:'application/pdf',data:Buffer.from('%PDF-1.4\n%%EOF')}])).status,303);
 const runtime=gw.server.tenants.get('site-a');assert.equal(runtime.store.assets.length,3);const asset=runtime.store.assets[0];assert.match(asset.id,/^[a-f0-9]{32}$/);assert.equal(asset.width,120);assert.equal(asset.height,80);
 const path=`/i/site-a/files/${asset.id}.${asset.ext}`;const first=await gw.request(path+'?width=1',{headers:{Origin:'https://cms.example'}});assert.equal(first.status,200);assert.equal(first.data,svg().data.toString());assert.equal(first.headers.get('access-control-allow-origin'),'*');assert.equal(first.headers.get('content-type'),'image/svg+xml');assert.equal(first.headers.get('cache-control'),'public, max-age=60');
 const cached=await gw.request(path,{headers:{'If-None-Match':'W/'+first.headers.get('etag')}});assert.equal(cached.status,304);assert.equal(cached.data,'');assert.equal(cached.headers.get('etag'),first.headers.get('etag'));
 const head=await gw.request(path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.data,'');assert.equal(Number(head.headers.get('content-length')),svg().data.length);
 assert.equal((await gw.request(path,{method:'OPTIONS'})).status,204);assert.equal((await gw.request(path.replace('.svg','.png'))).status,404);assert.equal((await gw.request(path.replace('site-a','site-b'))).status,404);
 runtime.store.flush();const saved=JSON.parse(readFileSync(join(gw.root,'data/site-a/assets.json')));assert.equal(saved.assets.length,3);assert.ok(existsSync(join(gw.root,`data/site-a/files/${asset.id}.svg`)));
});
test('sample assets create three SVG images and a PDF with no uploads',async t=>{const gw=await gateway(t);assert.equal((await gw.form('/tenants/site-a/samples',{})).status,303);const assets=gw.server.tenants.get('site-a').store.assets;assert.equal(assets.length,4);assert.equal(assets.filter(asset=>asset.type==='image').length,3);const pdf=assets.find(asset=>asset.type==='raw_file');assert.equal((await gw.request(`/i/site-a/files/${pdf.id}.pdf`)).headers.get('content-type'),'application/pdf');});
test('metadata edits move assets, replacement keeps ID and removes obsolete dimensions/files, deletion confirms',async t=>{
 const gw=await gateway(t);await gw.upload([svg()]);const store=gw.server.tenants.get('site-a').store;const asset=store.assets[0];const oldId=asset.id;const folder=store.createFolder('Editorial');const path='/tenants/site-a/assets/'+asset.id;
 assert.equal((await gw.form(path+'/edit',{title:'Changed',description:'A description',altText:'Alternative',tags:'one, two, one',folderId:folder.id})).status,303);assert.deepEqual(asset.tags,['one','two']);assert.equal(asset.folderId,folder.id);
 const response=await gw.upload([{filename:'note.txt',mimeType:'text/plain',data:Buffer.from('replacement')}],path+'/replace');assert.equal(response.status,303);assert.equal(asset.id,oldId);assert.equal(asset.title,'Changed');assert.equal(asset.ext,'txt');assert.equal(asset.width,undefined);assert.equal((await gw.request(`/i/site-a/files/${oldId}.svg`)).status,404);assert.equal((await gw.request(`/i/site-a/files/${oldId}.txt`)).data,'replacement');
 assert.equal((await gw.form(path+'/delete',{confirmation:'wrong'})).status,400);assert.equal(store.assets.length,1);assert.equal((await gw.form(path+'/confirm',{})).status,200);assert.equal((await gw.form(path+'/delete',{confirmation:oldId})).status,303);assert.equal(store.assets.length,0);assert.ok(store.state.pendingDeletes.includes(oldId));
});
test('folder create/rename/nonempty refusal/delete preserve root',async t=>{const gw=await gateway(t);const store=gw.server.tenants.get('site-a').store;assert.equal((await gw.form('/tenants/site-a/folders',{name:'Projects',parentId:store.rootId})).status,303);const folder=store.state.folders[1];await gw.form(`/tenants/site-a/folders/${folder.id}/rename`,{name:'Renamed'});assert.equal(folder.name,'Renamed');await gw.upload([svg()],undefined,{folderId:folder.id});assert.equal((await gw.form(`/tenants/site-a/folders/${folder.id}/delete`,{})).status,400);store.delete(store.assets[0].id);assert.equal((await gw.form(`/tenants/site-a/folders/${folder.id}/delete`,{})).status,303);assert.equal((await gw.form(`/tenants/site-a/folders/${store.rootId}/delete`,{})).status,400);});
test('lineage POST/list/DELETE and asset URL stay isolated by instance',async t=>{const gw=await gateway(t);await gw.upload([svg()]);const asset=gw.server.tenants.get('site-a').store.assets[0];const path=`/i/site-a/v3/assets/${asset.id}/lineages`;const result=await gw.request(path,{method:'POST',body:{name:'Landing page',uri:'https://cms.example/landing'},headers:{Authorization:'epi-hmac anything:signature'}});assert.equal(result.status,200);assert.match(result.data.id,/^[a-f0-9-]{36}$/);const list=await gw.request('/i/site-a/v3/asset-lineages');assert.equal(list.data.data[0].assetId,asset.id);assert.equal(list.data.data[0].trackingId,result.data.id);assert.deepEqual((await gw.request('/i/site-b/v3/asset-lineages')).data,{data:[]});assert.equal((await gw.request(`/i/site-a/v3/asset-urls/${asset.id}`)).data.url,`http://localhost:${gw.server.address().port}/i/site-a/files/${asset.id}.svg`);assert.equal((await gw.request(path+'/'+result.data.id,{method:'DELETE',headers:{'Content-Type':'application/json'}})).status,204);assert.deepEqual((await gw.request('/i/site-a/v3/asset-lineages')).data,{data:[]});});
test('JSON/form token credentials are accepted and auth kinds recorded with secrets redacted',async t=>{
 const gw=await gateway(t);for(const [headers,body]of[[{Authorization:'epi-hmac key:private'},{client_id:'invented-client',client_secret:'hidden-secret',grant_type:'client_credentials'}],[{Authorization:'Bearer private-token'},{client_secret:'hidden-secret'}],[{'X-USER-SSO-ID':'private-user','Content-Type':'application/x-www-form-urlencoded'},'client_id=invented-client&client_secret=hidden-secret']]){const result=await gw.request('/i/site-a/o/oauth2/v1/token',{method:'POST',body,headers});assert.equal(result.status,200);assert.equal(result.data.token_type,'Bearer');assert.equal(result.data.expires_in,3600);assert.ok(result.data.access_token.length>20);}
 const log=gw.server.tenants.get('site-a').log;assert.deepEqual(log.recent.slice(-3).map(entry=>entry.authKind),['epi-hmac','bearer','sso']);const disk=readFileSync(join(gw.root,'logs/site-a/requests.ndjson'),'utf8');for(const secret of['private-token','private-user','hidden-secret','invented-client','key:private'])assert.ok(!disk.includes(secret),secret);
 const detail=await gw.request('/tenants/site-a/request/'+log.recent[0].n);assert.equal(detail.status,200);assert.ok(!detail.data.includes('hidden-secret'));
});
test('picker filters assets, tolerates invalid options and uses an array message',async t=>{
 const gw=await gateway(t);await gw.upload([svg('Visible title'),{filename:'Raw guide.pdf',mimeType:'application/pdf',data:Buffer.from('raw')}]);let result=await gw.request('/i/site-a/cloud/library-picker?pickerOptions=not-base64');assert.equal(result.status,200);assert.match(result.data,/Visible title/);assert.match(result.data,/Raw guide/);assert.match(result.data,/window\.opener\.postMessage\(array, '\*'\)/);assert.match(result.data,/const array=assets\.filter/);assert.match(result.data,/const multiSelect=false/);
 const options=Buffer.from(JSON.stringify({assetTypes:['image'],multiSelect:true,unknown:1})).toString('base64');result=await gw.request('/i/site-a/?pickerOptions='+encodeURIComponent(options));assert.equal(result.status,200);assert.match(result.data,/Visible title/);assert.ok(!result.data.includes('Raw guide'));assert.match(result.data,/const multiSelect=true/);
 const unknown=Buffer.from(JSON.stringify({assetTypes:['unrecognised']})).toString('base64');assert.match((await gw.request('/i/site-a/?pickerOptions='+unknown)).data,/Raw guide/);
 const filtered=await gw.request('/i/site-a/?q=Raw&type=raw_file');assert.match(filtered.data,/Raw guide/);assert.ok(!filtered.data.includes('<h3>Visible title</h3>'));
});
test('picker click script sends array, enforces single/multi selection and previews JSON without opener',async t=>{
 const gw=await gateway(t);await gw.upload([svg('First'),svg('Second')]);
 for(const multi of[false,true])for(const opener of[false,true]){
  const encoded=Buffer.from(JSON.stringify({multiSelect:multi})).toString('base64');const html=(await gw.request('/i/site-a/?pickerOptions='+encoded)).data;const script=/<script>\s*const assets=([\s\S]*?)<\/script>/.exec(html)[0].slice(8,-9);
  const buttons=gw.server.tenants.get('site-a').store.assets.map(asset=>({dataset:{asset:asset.id},addEventListener(event,fn){this.click=fn;},setAttribute(){}}));const elements={select:{addEventListener(event,fn){this.click=fn;}},'selection-status':{},'selection-json':{hidden:true}};let posted;let closed=false;
  runInNewContext(script,{Set,document:{querySelectorAll:selector=>selector==='[data-asset]'?buttons:[],getElementById:id=>elements[id]},window:{opener:opener?{postMessage:(value,origin)=>{posted=value;assert.equal(origin,'*');}}:null,close:()=>{closed=true;}}});buttons[0].click();buttons[1].click();elements.select.click();
  const selected=opener?JSON.parse(JSON.stringify(posted)):JSON.parse(elements['selection-json'].textContent);assert.ok(Array.isArray(selected));assert.equal(selected.length,multi?2:1);assert.deepEqual(Object.keys(selected[0]),['id','url','title','type']);assert.equal(closed,opener);if(!opener)assert.equal(elements['selection-json'].hidden,false);
 }
});
test('untrusted names remain text in dashboard and picker scripts',async t=>{const gw=await gateway(t);await gw.upload([svg()]);const store=gw.server.tenants.get('site-a').store;store.edit(store.assets[0].id,{title:'</script><script>alert(1)</script>',description:'<img onerror=alert(1)>'});const picker=(await gw.request('/i/site-a/')).data;assert.ok(!picker.includes('</script><script>alert(1)</script>'));assert.ok(picker.includes('\\u003c/script>'));const dashboard=(await gw.request('/tenants/site-a')).data;assert.ok(dashboard.includes('&lt;/script&gt;'));});

test('picker preserves allowed selections across folder and search navigation',async t=>{
 const gw=await gateway(t);await gw.upload([svg('First folder image'),svg('Second folder image')]);
 const store=gw.server.tenants.get('site-a').store;const first=store.assets[0];const second=store.assets[1];const folder=store.createFolder('Second folder');store.edit(second.id,{folderId:folder.id});
 const options=Buffer.from(JSON.stringify({assetTypes:['image'],multiSelect:true})).toString('base64');
 const html=(await gw.request(`/i/site-a/?pickerOptions=${options}&folder=${folder.id}&selection=${first.id},${'f'.repeat(32)}`)).data;
 const script=/<script>\s*const assets=([\s\S]*?)<\/script>/.exec(html)[0].slice(8,-9);
 const button={dataset:{asset:second.id},addEventListener(event,fn){this.click=fn;},setAttribute(){}};
 const anchor={href:gw.base+`/i/site-a/?pickerOptions=${options}`,addEventListener(event,fn){this.click=fn;}};
 const form={addEventListener(event,fn){this.submit=fn;},append(input){this.input=input;}};
 const elements={select:{addEventListener(event,fn){this.click=fn;}},'selection-status':{},'selection-json':{hidden:true}};
 runInNewContext(script,{Set,URL,document:{querySelectorAll:selector=>selector==='[data-asset]'?[button]:selector==='.folder-tree a'?[anchor]:[form],getElementById:id=>elements[id],createElement:()=>({})},window:{opener:null}});
 assert.equal(elements.select.disabled,false);assert.equal(elements['selection-status'].textContent,'1 selected');button.click();anchor.click();form.submit();
 assert.deepEqual(new URL(anchor.href).searchParams.get('selection').split(','),[first.id,second.id]);assert.equal(form.input.value,first.id+','+second.id);
 elements.select.click();assert.deepEqual(JSON.parse(elements['selection-json'].textContent).map(asset=>asset.id),[first.id,second.id]);
});
test('uploaded JSON files return exact bytes and multipart oversize receives HTTP 413',async t=>{
 const gw=await gateway(t);const bytes=Buffer.from('{"hello":"world"}');await gw.upload([{filename:'example.json',mimeType:'application/json',data:bytes}]);const asset=gw.server.tenants.get('site-a').store.assets[0];const response=await gw.request(`/i/site-a/files/${asset.id}.json`);assert.deepEqual(response.data,{hello:'world'});assert.equal(Number(response.headers.get('content-length')),bytes.length);
 const tooBig=await gw.upload([{filename:'large.bin',mimeType:'application/octet-stream',data:Buffer.alloc(50*1024*1024+1)}]);assert.equal(tooBig.status,413);assert.equal(gw.server.tenants.get('site-a').store.assets.length,1);
 const sdkOversize=await gw.request('/i/site-a/o/oauth2/v1/token',{method:'POST',body:'x'.repeat(1024*1024+1)});assert.equal(sdkOversize.status,413);
});
