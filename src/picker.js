import {page, libraryHtml, jsonScript} from './dashboard.js';
import {fileUrl} from './store.js';

export function pickerOptions(encoded) {
  try {
    const value = JSON.parse(Buffer.from(encoded ?? '', 'base64').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function pickerHtml(runtime, params, publicBase) {
  const encoded = params.get('pickerOptions') ?? '';
  const options = pickerOptions(encoded);
  const allowed = Array.isArray(options.assetTypes) ? options.assetTypes.filter(type => ['image', 'video', 'raw_file'].includes(type)) : [];
  const assets = runtime.store.assets.filter(asset => !allowed.length || allowed.includes(asset.type)).map(asset => ({
    id: asset.id, url: fileUrl(runtime.tenant, asset, publicBase), title: asset.title, type: asset.type
  }));
  const requested = (params.get('selection') ?? '').split(',');
  const selected = assets.filter(asset => requested.includes(asset.id)).map(asset => asset.id);
  if (options.multiSelect !== true) selected.splice(1);
  return page(runtime.tenant.name + ' · Choose assets', `${libraryHtml(runtime, params, publicBase, {picker: true, allowed, optionString: encoded})}
<div class="picker-footer"><button type="button" id="select" disabled>Select</button><span id="selection-status" role="status" aria-live="polite">No assets selected</span></div>
<pre id="selection-json" hidden></pre><script>
const assets=${jsonScript(assets)};
const multiSelect=${options.multiSelect === true};
const selected=new Set(${jsonScript(selected)});
const choose=document.getElementById('select');
function refreshSelection(){
 document.querySelectorAll('[data-asset]').forEach(button=>{
  const active=selected.has(button.dataset.asset);
  button.setAttribute('aria-pressed',String(active));
  button.textContent=active?'Selected':'Choose asset';
 });
 choose.disabled=selected.size===0;
 document.getElementById('selection-status').textContent=selected.size?selected.size+' selected':'No assets selected';
}
document.querySelectorAll('[data-asset]').forEach(button=>button.addEventListener('click',()=>{
 const id=button.dataset.asset;
 if(selected.has(id))selected.delete(id);
 else{if(!multiSelect)selected.clear();selected.add(id)}
 refreshSelection();
}));
// Carry selection within this picker navigation, without retaining it for a later popup.
document.querySelectorAll('.folder-tree a').forEach(anchor=>anchor.addEventListener('click',()=>{
 const target=new URL(anchor.href);
 target.searchParams.set('selection',[...selected].join(','));
 anchor.href=target.href;
}));
document.querySelectorAll('form[method="get"]').forEach(form=>form.addEventListener('submit',()=>{
 const input=document.createElement('input');
 input.type='hidden';input.name='selection';input.value=[...selected].join(',');
 form.append(input);
}));
choose.addEventListener('click',()=>{
 const array=assets.filter(asset=>selected.has(asset.id)).map(({id,url,title,type})=>({id,url,title,type}));
 if(!array.length)return;
 if(window.opener){window.opener.postMessage(array, '*');window.close()}
 else{
  const preview=document.getElementById('selection-json');
  preview.hidden=false;preview.textContent=JSON.stringify(array,null,2);
 }
});
refreshSelection();
</script>`, '', {picker: true});
}
