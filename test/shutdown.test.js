import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {scratch,A,B,eventually} from './helpers.js';
const repo=resolve(import.meta.dirname,'..');
for(const signal of['SIGINT','SIGTERM','SIGBREAK'])test(`${signal} flushes both instances before production CLI exits`,{timeout:15000},async t=>{
 const root=scratch(t);const file=join(root,'tenants.json');writeFileSync(file,JSON.stringify({tenants:[A,B]}));
 const child=spawn(process.execPath,['--import',pathToFileURL(join(repo,'test/fixtures/signal-preload.js')).href,join(repo,'src/server.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,PORT:'0',HOST:'127.0.0.1',TENANTS_FILE:file,DATA_DIR:join(root,'data'),LOG_DIR:join(root,'logs'),ADMIN_USER:'',ADMIN_PASSWORD:'',PUBLIC_BASE_URL:'',PUBLIC_HOSTNAMES:''}});
 let stdout='';let stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);const exited=once(child,'exit');
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 await eventually(()=>{assert.equal(child.exitCode,null,stdout+stderr);return /listening at http:\/\/127.0.0.1:(\d+)/.test(stdout);},5000);
 const port=/listening at http:\/\/127.0.0.1:(\d+)/.exec(stdout)[1];const base=`http://127.0.0.1:${port}`;
 const html=await(await fetch(base+'/')).text();const csrf=/name="csrf" value="([a-f0-9]+)"/.exec(html)[1];
 for(const tenant of[A,B]){
  const response=await fetch(base+`/tenants/${tenant.id}/samples`,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf})});assert.equal(response.status,303);await response.text();assert.equal(existsSync(join(root,`data/${tenant.id}/assets.json`)),false);
 }
 if(process.platform==='win32'||signal==='SIGBREAK')child.send({signal});else{child.disconnect();child.kill(signal);}
 const[code,termination]=await exited;assert.equal(code,0,stdout+stderr);assert.equal(termination,null);
 for(const tenant of[A,B]){const saved=JSON.parse(readFileSync(join(root,`data/${tenant.id}/assets.json`)));assert.equal(saved.assets.length,4);assert.equal(readdirSync(join(root,`data/${tenant.id}`)).some(name=>name.endsWith('.tmp')),false);}
});
