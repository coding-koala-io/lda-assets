import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createServer} from '../src/server.js';
export const quiet={log(){},error(){},warn(){}};
export const A={id:'site-a',name:'Site A',clientId:'dam-site-a-12345678',clientSecret:Buffer.alloc(32,1).toString('base64'),graph:{}};
export const B={id:'site-b',name:'Site B',clientId:'dam-site-b-12345678',clientSecret:Buffer.alloc(32,2).toString('base64'),graph:{}};
export function scratch(t){
 const root=resolve(import.meta.dirname,'../.test-runtime');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
 t.after(()=>{const inside=relative(root,resolve(dir));assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));rmSync(dir,{recursive:true,force:true});});return dir;
}
export async function gateway(t,options={}){
 const root=scratch(t);const file=join(root,'tenants.json');writeFileSync(file,JSON.stringify({tenants:[A,B]}));
 const server=createServer({host:'127.0.0.1',port:0,dataDir:join(root,'data'),logDir:join(root,'logs'),tenantsFile:file,logger:quiet,adminUser:'',adminPassword:'',publicBaseUrl:'',publicHostnames:'',...options});
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
 // Closing saves pending stores, which can recreate data/ after scratch() removed the folder; remove it again.
 t.after(async()=>{await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));rmSync(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path,{method='GET',body,headers={},redirect='manual'}={}){
  const response=await fetch(base+path,{method,redirect,headers:{...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':typeof body==='object'&&!Buffer.isBuffer(body)?'application/json':'application/x-www-form-urlencoded'}:{}),...headers},...(body!==undefined?{body:body instanceof FormData||typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)}:{})});
  const text=await response.text();const data=response.headers.get('content-type')?.startsWith('application/json')&&text?JSON.parse(text):text;return{status:response.status,data,headers:response.headers};
 }
 const csrf=html=>/name="csrf" value="([a-f0-9]+)"/.exec(html)?.[1];
 const token=csrf((await request('/')).data);
 const form=(path,values,options={})=>request(path,{method:'POST',body:new URLSearchParams({csrf:token,...values}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:base},...options});
 const upload=(files,path='/tenants/site-a/upload',fields={})=>{const body=new FormData();body.append('csrf',token);for(const[key,value]of Object.entries(fields))body.append(key,value);for(const file of files)body.append('files',new Blob([file.data],{type:file.mimeType??'application/octet-stream'}),file.filename);return request(path,{method:'POST',body});};
 return{server,base,request,form,upload,token,root,file};
}
export const svg=(title='Test rectangle')=>({filename:title+'.svg',mimeType:'image/svg+xml',data:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="blue"/><title>${title}</title></svg>`)});
export async function eventually(check,timeout=3000){const end=Date.now()+timeout;do{if(await check())return;await new Promise(accept=>setTimeout(accept,20));}while(Date.now()<end);assert.fail('Condition not reached before timeout');}
