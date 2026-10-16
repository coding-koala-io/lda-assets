import {generateTenant} from './tenant-create.js';
import {constantEqual} from './tenants.js';
import {parseMultipart} from './multipart.js';
import {fail} from './http-utils.js';
import {ADMIN_PAGE_HEADERS} from './page-security.js';
import {aboutPage} from './about.js';
import {dashboardHtml, tenantHtml, tenantEditHtml, tenantPath, assetHtml, confirmationHtml, requestHtml} from './dashboard.js';

function samples() {
  const files=[['Amber field','#bd6515'],['Blue water','#087ba1'],['Green canopy','#30724c']].map(([title,color])=>({filename:title+'.svg',mimeType:'image/svg+xml',data:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${color}"/><text x="32" y="190" font-size="40" fill="white" font-family="sans-serif">${title}</text></svg>`)}));
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[0];for(const [index,object]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  files.push({filename:'Sample document.pdf',mimeType:'application/pdf',data:Buffer.from(pdf)});return files;
}
export async function handleDashboard({aboutRoot,path,method,url,bytes,headers,registry,runtime,token,send,redirect,publicBase,diagnostic}) {
  const html=body=>send(200,body,'text/html; charset=utf-8',ADMIN_PAGE_HEADERS);
  if(method==='GET'&&path==='/')return html(dashboardHtml(registry,token,url.searchParams.get('flash')??''));
  if(method==='GET'&&(path==='/about'||path.startsWith('/about/'))){const about=await aboutPage(path,aboutRoot);if(about)return send(about.status,about.html,'text/html; charset=utf-8',ADMIN_PAGE_HEADERS);}
  let values={};let upload;
  if(method==='POST'){
    if((headers['content-type']??'').startsWith('multipart/form-data')){upload=parseMultipart(bytes,headers['content-type']);values=upload.fields;}
    else values=Object.fromEntries(new URLSearchParams(bytes.toString('utf8')));
    if(!values.csrf||!constantEqual(values.csrf,token))throw fail('Invalid or missing CSRF token',403);
    if(runtime?.busy||runtime&&!registry.find(runtime.tenant.id))throw fail('Instance storage maintenance in progress',503);
  }
  if(path==='/tenants'&&method==='POST'){
    let tenant;
    await registry.edit(entries=>{tenant=generateTenant(values.name,entries,undefined,id=>registry.folderExists(id));return [...entries,tenant];});
    return redirect(tenantPath(tenant.id)+'?flash='+encodeURIComponent('Instance created. Link Graph, sync assets, then copy these CMS settings.')+'#connect');
  }
  if(!runtime)return false;
  const {tenant,store}=runtime;const base=tenantPath(tenant.id);const route=path.slice(base.length)||'/';
  if(method==='GET'){
    if(route==='/')return html(tenantHtml(runtime,registry,token,publicBase,url.searchParams));
    if(route==='/edit')return html(tenantEditHtml(tenant,token));
    if(route==='/stats')return send(200,{assets:store.assets.length,folders:store.state.folders.length,usages:store.state.usages.length,lastSync:store.state.lastSync});
    const asset=/^\/assets\/([a-f0-9]{32})$/.exec(route);if(asset)return html(assetHtml(runtime,store.asset(asset[1]),token,publicBase));
    const request=/^\/request\/(\d+)$/.exec(route);
    if(request){const entry=runtime.log.recent.find(entry=>entry.n===Number(request[1]));return entry?html(requestHtml(runtime,entry)):send(404,{message:'Request not found'});}
    return false;
  }
  if(method!=='POST')return false;
  const done=(message,section='assets')=>redirect(base+'?flash='+encodeURIComponent(message)+'#'+section);
  if(route==='/edit'){
    if(values.id!==tenant.id&&values.clientId!==tenant.clientId)throw fail('Keep clientId unchanged while renaming the instance ID');
    await registry.edit(entries=>entries.map(entry=>entry.id===tenant.id?{...entry,id:values.id,name:values.name,clientId:values.clientId,clientSecret:values.clientSecret}:entry));
    return redirect(tenantPath(values.id)+'?flash='+encodeURIComponent('Instance saved. Update the CMS settings if its ID or credentials changed.')+'#connect');
  }
  if(route==='/graph'||route==='/graph/unlink'){
    await registry.edit(entries=>entries.map(entry=>entry.id===tenant.id?{...entry,graph:route.endsWith('unlink')?{}:{gatewayAddress:values.gatewayAddress,appKey:values.appKey,secret:values.secret}}:entry));
    if(route==='/graph')runtime.sync.schedule();return done(route.endsWith('unlink')?'Graph link removed':'Graph link saved','graph-link');
  }
  if(route==='/sync'){await runtime.sync.sync();return done(store.state.lastSync.error?'Sync failed; see the error below.':'All assets synchronized to Graph','graph-link');}
  if(route==='/check'){runtime.visibility=await runtime.sync.check();return done('DAM visible to CMS: '+(runtime.visibility.visible?'yes':'no'),'graph-link');}
  if(route==='/upload'){
    if(!upload)throw fail('Use multipart/form-data to upload files');
    const added=store.upload(upload.files,values.folderId||store.rootId);runtime.sync.schedule();return done(`${added.length} asset${added.length===1?'':'s'} uploaded`);
  }
  if(route==='/samples'){store.upload(samples());runtime.sync.schedule();return done('Added 3 sample images and 1 sample document');}
  if(route==='/folders'){store.createFolder(values.name,values.parentId||store.rootId);return done('Folder created','folders');}
  const folder=/^\/folders\/([a-f0-9]{32})\/(rename|delete)$/.exec(route);
  if(folder){if(folder[2]==='rename')store.renameFolder(folder[1],values.name);else store.deleteFolder(folder[1]);return done('Folder '+(folder[2]==='rename'?'renamed':'deleted'),'folders');}
  const asset=/^\/assets\/([a-f0-9]{32})\/(edit|replace|confirm|delete)$/.exec(route);
  if(asset){
    const current=store.asset(asset[1]);
    if(asset[2]==='confirm')return html(confirmationHtml(runtime,token,'delete',current));
    if(asset[2]==='edit')store.edit(current.id,values);
    if(asset[2]==='replace'){if(!upload||upload.files.length!==1)throw fail('Choose exactly one replacement file');store.replace(current.id,upload.files[0]);}
    if(asset[2]==='delete'){if(!constantEqual(values.confirmation,current.id))throw fail('Type the asset ID to confirm deletion');store.delete(current.id);}
    runtime.sync.schedule();return asset[2]==='delete'?done('Asset deleted'):redirect(base+'/assets/'+current.id);
  }
  if(route==='/confirm'){
    if(!['clear','delete'].includes(values.action))throw fail('Unknown confirmation action');
    return html(confirmationHtml(runtime,token,values.action));
  }
  if(route==='/clear'||route==='/delete'){
    if(!constantEqual(values.confirmation,tenant.id))throw fail('Type the instance ID to confirm');
    if(route==='/clear'){store.clear();runtime.sync.schedule();return done('Instance cleared');}
    runtime.busy=true;
    try {
    if(values.removeGraph==='yes'){
      const result=await runtime.sync.sync({removeAll:true});
      if(result.error)throw fail('Graph removal failed; instance retained. '+result.error,502);
    }
    await registry.edit(entries=>entries.filter(entry=>entry.id!==tenant.id));
    diagnostic.suppressTenantLog=true;
    if(values.removeFolders==='yes')registry.deleteFolders(tenant.id);
    return redirect('/?flash='+encodeURIComponent('Instance deleted'+(values.removeFolders==='yes'?' with its local files':'; data and log folders retained')));
    } finally {runtime.busy=false;}
  }
  return false;
}
