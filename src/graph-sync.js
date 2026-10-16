import {fileUrl} from './store.js';
import {normalizeDimensions} from './dimensions.js';
const p = (type, extra = {}) => ({type, searchable: false, index: true, ...extra});
const common = {Id:p('String'), Url:p('String'), Title:p('String',{searchable:true}), Description:p('String',{searchable:true}), AltText:p('String'), MimeType:p('String'), CreatedAt:p('DateTime'), ModifiedAt:p('DateTime')};
export const TYPE_MODEL = {
  contentTypes: {
    cmp_Asset: {abstract: true, contentType: ['_Item'], properties: common},
    cmp_PublicImageAsset: {abstract: false, contentType: ['cmp_Asset','_ImageItem'], properties: {Width:p('Int'), Height:p('Int')}},
    cmp_PublicVideoAsset: {abstract: false, contentType: ['cmp_Asset','_AssetItem'], properties: {Width:p('Int'), Height:p('Int')}},
    cmp_PublicRawFileAsset: {abstract: false, contentType: ['cmp_Asset','_AssetItem'], properties: {}},
    cmp_PublicImageAssetRendition: {abstract: false, contentType: ['cmp_Asset','_ImageItem'], properties: {Width:p('Int'), Height:p('Int')}},
    cmp_PublicVideoAssetRendition: {abstract: false, contentType: ['cmp_Asset','_AssetItem'], properties: {}}
  }, propertyTypes: {}
};
export const graphConfigured = tenant => Boolean(tenant.graph?.gatewayAddress && tenant.graph.appKey && tenant.graph.secret);
export function graphDocument(asset, tenant, publicBase) {
  const type = {image:'cmp_PublicImageAsset', video:'cmp_PublicVideoAsset', raw_file:'cmp_PublicRawFileAsset'}[asset.type];
  const url = fileUrl(tenant, asset, publicBase);
  const measured = ['image', 'video'].includes(asset.type) ? normalizeDimensions(asset) : {};
  return {
    __typename: type,
    _itemMetadata: {key: asset.id, displayName: asset.title, type, lastModified: asset.modifiedAt},
    _assetMetadata: {url, mimeType: asset.mimeType, fileSize: asset.fileSize},
    ...(asset.type === 'image' ? {_imageMetadata: measured} : {}),
    _rbac: ['r:Everyone:Read'],
    Id: asset.id, Url: url, Title: asset.title, Description: asset.description, AltText: asset.altText, MimeType: asset.mimeType,
    CreatedAt: asset.createdAt, ModifiedAt: asset.modifiedAt,
    ...(measured.width ? {Width:measured.width} : {}),
    ...(measured.height ? {Height:measured.height} : {})
  };
}

/** Serializes sync runs, retains failed deletions and never throws into asset forms. */
export class GraphSync {
  constructor(runtime, publicBase, {delay = 1000, timeout = 10000, fetchImpl = fetch} = {}) {
    this.runtime = runtime; this.publicBase = publicBase; this.delay = delay; this.timeout = timeout; this.fetch = fetchImpl; this.queue = Promise.resolve();
  }
  schedule() {
    if (this.closed || !graphConfigured(this.runtime.tenant)) return;
    clearTimeout(this.timer); this.pending = true;
    this.timer = setTimeout(() => { this.pending = false; this.sync(); }, this.delay); this.timer.unref();
  }
  async request(graph, path, options = {}) {
    const result = await this.fetch(graph.gatewayAddress.replace(/\/$/, '') + path, {...options, headers: {Authorization: 'Basic ' + Buffer.from(`${graph.appKey}:${graph.secret}`).toString('base64'), ...options.headers}, signal: AbortSignal.timeout(this.timeout)});
    const text = await result.text();
    if (!result.ok) throw Object.assign(new Error(text.slice(0,4000) || `Graph returned HTTP ${result.status}`), {status:result.status});
    return {status: result.status, text};
  }
  sync({removeAll = false} = {}) {
    clearTimeout(this.timer); this.pending = false;
    const run = this.queue.then(async () => {
      const {tenant, store} = this.runtime;
      if (!graphConfigured(tenant)) {
        const result = {at:new Date().toISOString(), status:null, error:'Configure Graph gateway address, appKey and secret first'};
        store.state.lastSync = result; store.changed(); return result;
      }
      const graph = {...tenant.graph}; const assets = structuredClone(store.assets);
      const deleted = [...new Set([...store.state.pendingDeletes, ...(removeAll ? [...assets.map(asset => asset.id), ...store.state.syncedIds] : [])])];
      let status = null;
      try {
        if (!removeAll) status = (await this.request(graph, '/api/content/v3/types?id=cmp', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(TYPE_MODEL)})).status;
        const lines = deleted.map(assetId => JSON.stringify({delete:{_id:`cmp_${assetId}`}}));
        if (!removeAll) for (const asset of assets) lines.push(JSON.stringify({index:{_id:`cmp_${asset.id}`, _snapshotTime:new Date().toISOString()}}), JSON.stringify(graphDocument(asset, tenant, this.publicBase())));
        if (lines.length) {
          const result = await this.request(graph, '/_stream', {method:'POST', headers:{'Content-Type':'application/x-ndjson'}, body:lines.join('\n') + '\n'}); status = result.status;
          // HTTP 200 can still contain operation errors in the journal.
          let journal; try { journal = JSON.parse(result.text).journalId; } catch { /* Gateways may return an empty success body. */ }
          if (journal) {
            const checked = await this.request(graph, '/journal/stream/' + encodeURIComponent(journal));
            let report; try { report = JSON.parse(checked.text); } catch { throw new Error('Invalid Graph journal response'); }
            if (report.errors) throw Object.assign(new Error('Graph indexing journal reports errors: ' + checked.text.slice(0,4000)), {status});
          }
        }
        store.state.pendingDeletes = store.state.pendingDeletes.filter(assetId => !deleted.includes(assetId));
        store.state.syncedIds = removeAll ? [] : assets.map(asset => asset.id);
        store.state.lastSync = {at:new Date().toISOString(), status:status ?? 200, error:null};
      } catch (error) { store.state.lastSync = {at:new Date().toISOString(), status:error.status ?? null, error:error.message}; }
      store.changed(); return store.state.lastSync;
    });
    this.queue = run.catch(() => {}); return run;
  }
  async check() {
    if (!graphConfigured(this.runtime.tenant)) return {visible:false, status:null, error:'Graph is not configured'};
    try { const result = await this.request(this.runtime.tenant.graph, '/api/content/v3/sources?id=cmp'); return {visible:true, status:result.status, error:null}; }
    catch (error) { return {visible:false, status:error.status ?? null, error:error.message}; }
  }
  async close() {
    this.closed = true; clearTimeout(this.timer);
    if (this.pending) await this.sync();
    await this.queue;
  }
}
