import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, createReadStream} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {dimensions} from './dimensions.js';
import {MAX_FILE_SIZE} from './multipart.js';
import {fail} from './http-utils.js';

const id = () => randomBytes(16).toString('hex');
const types = new Map(Object.entries({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',avif:'image/avif',bmp:'image/bmp',ico:'image/x-icon',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',ogv:'video/ogg',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',json:'application/json',zip:'application/zip'}));
export function fileProperties(file) {
  let ext = /\.([a-z0-9]{1,12})$/i.exec(file.filename)?.[1].toLowerCase();
  let mimeType = String(file.mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)) mimeType = 'application/octet-stream';
  if (mimeType === 'application/octet-stream' && types.has(ext)) mimeType = types.get(ext);
  ext ??= [...types].find(([, value]) => value === mimeType)?.[0] ?? 'bin';
  return {ext, mimeType, type: mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'raw_file'};
}
export const fileUrl = (tenant, asset, publicBase) => `${publicBase.replace(/\/$/, '')}/i/${tenant.id}/files/${asset.id}.${asset.ext}`;

/** JSON metadata and immutable file IDs are scoped to a single instance. */
export class Store {
  constructor({dataDir = './data', logger = console} = {}) {
    this.dataDir = dataDir; this.logger = logger; this.memoryFiles = new Map();
    const rootId = id();
    this.state = {version: 1, assets: [], folders: [{id: rootId, name: 'Root', parentId: null}], usages: [], pendingDeletes: [], syncedIds: [], lastSync: null};
    if (dataDir !== ':memory:' && existsSync(join(dataDir, 'assets.json'))) {
      const file = join(dataDir, 'assets.json');
      try {
        const state = JSON.parse(readFileSync(file, 'utf8'));
        if (state.version !== 1 || !Array.isArray(state.assets) || !Array.isArray(state.folders) || !Array.isArray(state.usages) || state.folders.filter(f => f.parentId === null).length !== 1) throw new Error('Invalid asset store');
        const folderIds = new Set(state.folders.map(f => f.id));
        if (folderIds.size !== state.folders.length || state.folders.some(f => !/^[a-f0-9]{32}$/.test(f.id) || typeof f.name !== 'string' || f.parentId !== null && !folderIds.has(f.parentId))) throw new Error('Invalid folder');
        for (const f of state.folders) { const visited = new Set([f.id]); let parent = f.parentId; while (parent !== null) { if (visited.has(parent)) throw new Error('Folder cycle'); visited.add(parent); parent = state.folders.find(f => f.id === parent).parentId; } }
        if (new Set(state.assets.map(a => a.id)).size !== state.assets.length || state.assets.some(a => !/^[a-f0-9]{32}$/.test(a.id) || !/^[a-z0-9]{1,12}$/.test(a.ext) || !folderIds.has(a.folderId) || !['image','video','raw_file'].includes(a.type))) throw new Error('Invalid asset');
        for (const key of ['pendingDeletes','syncedIds']) if (state[key] && (!Array.isArray(state[key]) || state[key].some(value => !/^[a-f0-9]{32}$/.test(value)))) throw new Error('Invalid synchronization state');
        this.state = {...this.state, ...state};
        // Upgrade older libraries once at load time; HTTP HEAD/304 never read file bytes.
        for (const asset of this.assets) {
          if (!/^"[a-f0-9]{64}"$/.test(asset.etag ?? '') && existsSync(this.filePath(asset))) {
            asset.etag = this.contentEtag(this.readFile(asset)); this.changed();
          }
        }
      } catch (error) {
        // Preserve the bytes and refuse startup instead of silently losing an asset library.
        throw new Error(`Cannot load ${file}: ${error.message}`);
      }
    }
  }
  get assets() { return this.state.assets; }
  get rootId() { return this.state.folders.find(folder => folder.parentId === null).id; }
  asset(assetId) { const asset = this.assets.find(asset => asset.id === assetId); if (!asset) throw fail('Asset not found', 404); return asset; }
  folder(folderId) { const folder = this.state.folders.find(folder => folder.id === folderId); if (!folder) throw fail('Folder not found', 404); return folder; }
  changed() {
    this.dirty = true; clearTimeout(this.timer);
    this.timer = setTimeout(() => { try { this.flush(); } catch (error) { this.logger.error(`Persistence failed: ${error.message}`); } }, 100); this.timer.unref();
  }
  flush() {
    clearTimeout(this.timer);
    if (!this.dirty || this.dataDir === ':memory:') return;
    mkdirSync(this.dataDir, {recursive: true});
    const file = join(this.dataDir, 'assets.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(this.state, null, 2) + '\n'); renameSync(temporary, file); this.dirty = false; }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  filePath(asset) { return join(this.dataDir, 'files', `${asset.id}.${asset.ext}`); }
  writeFile(asset, bytes) {
    if (this.dataDir === ':memory:') { this.memoryFiles.set(`${asset.id}.${asset.ext}`, Buffer.from(bytes)); asset.etag = this.contentEtag(bytes); return; }
    mkdirSync(join(this.dataDir, 'files'), {recursive: true});
    const file = this.filePath(asset); const temporary = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, bytes); renameSync(temporary, file); asset.etag = this.contentEtag(bytes); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  readFile(asset) { return this.dataDir === ':memory:' ? this.memoryFiles.get(`${asset.id}.${asset.ext}`) : readFileSync(this.filePath(asset)); }
  hasFile(asset) { return this.dataDir === ':memory:' ? this.memoryFiles.has(`${asset.id}.${asset.ext}`) : existsSync(this.filePath(asset)); }
  openFile(asset, {start = 0, end = asset.fileSize - 1} = {}) {
    if (this.dataDir !== ':memory:') return createReadStream(this.filePath(asset), {start, end});
    const bytes = this.memoryFiles.get(`${asset.id}.${asset.ext}`);
    if (!bytes) throw fail('File not found', 404);
    return Readable.from([bytes.subarray(start, end + 1)]);
  }
  removeFile(asset) {
    if (this.dataDir === ':memory:') this.memoryFiles.delete(`${asset.id}.${asset.ext}`);
    else if (existsSync(this.filePath(asset))) unlinkSync(this.filePath(asset));
  }
  validateFile(file) { if (!Buffer.isBuffer(file.data) || !file.data.length) throw fail('Choose a non-empty file'); if (file.data.length > MAX_FILE_SIZE) throw fail('File exceeds 50 MB', 413); }
  upload(files, folderId = this.rootId) {
    this.folder(folderId); if (!files.length) throw fail('Choose one or more files');
    for (const file of files) this.validateFile(file);
    const added = [];
    try {
      for (const file of files) {
        const properties = fileProperties(file); const now = new Date().toISOString();
        const asset = {id: id(), ...properties, title: file.filename.replace(/\.[^.]+$/, ''), description: '', altText: '', fileSize: file.data.length, ...(properties.type === 'image' ? dimensions(file.data, properties.mimeType) : {}), folderId, tags: [], createdAt: now, modifiedAt: now};
        this.writeFile(asset, file.data); added.push(asset);
      }
    } catch (error) { for (const asset of added) this.removeFile(asset); throw error; }
    this.assets.push(...added); this.changed(); return added;
  }
  edit(assetId, values) {
    const asset = this.asset(assetId); this.folder(values.folderId || asset.folderId);
    for (const key of ['title','description','altText']) if (values[key] !== undefined && (typeof values[key] !== 'string' || values[key].length > (key === 'description' ? 10000 : 1000))) throw fail(`${key} is too long`);
    if (values.title !== undefined && !values.title.trim()) throw fail('Title is required');
    const tags = values.tags === undefined ? asset.tags : Array.isArray(values.tags) ? values.tags : values.tags.split(',').map(tag => tag.trim()).filter(Boolean);
    if (tags.length > 100 || tags.some(tag => typeof tag !== 'string' || tag.length > 200)) throw fail('Use at most 100 tags of up to 200 characters');
    for (const key of ['title','description','altText']) if (values[key] !== undefined) asset[key] = values[key];
    asset.tags = [...new Set(tags)]; asset.folderId = values.folderId || asset.folderId; asset.modifiedAt = new Date().toISOString(); this.changed(); return asset;
  }
  replace(assetId, file) {
    this.validateFile(file); const asset = this.asset(assetId); const old = {...asset}; const properties = fileProperties(file);
    const next = {...asset, ...properties, fileSize: file.data.length, modifiedAt: new Date().toISOString()};
    delete next.width; delete next.height;
    if (properties.type === 'image') Object.assign(next, dimensions(file.data, properties.mimeType));
    this.writeFile(next, file.data); delete asset.width; delete asset.height; Object.assign(asset, next);
    if (old.ext !== asset.ext) this.removeFile(old);
    this.changed(); return asset;
  }
  delete(assetId) {
    const asset = this.asset(assetId);
    this.removeFile(asset); this.state.assets = this.assets.filter(asset => asset.id !== assetId);
    this.state.usages = this.state.usages.filter(usage => usage.assetId !== assetId);
    this.state.pendingDeletes = [...new Set([...this.state.pendingDeletes, assetId])]; this.changed();
  }
  createFolder(name, parentId = this.rootId) {
    this.folder(parentId); name = this.folderName(name);
    const folder = {id: id(), name, parentId}; this.state.folders.push(folder); this.changed(); return folder;
  }
  folderName(name) { if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw fail('Folder name must be 1-100 characters'); return name.trim(); }
  renameFolder(folderId, name) { const folder = this.folder(folderId); folder.name = this.folderName(name); this.changed(); }
  deleteFolder(folderId) {
    const folder = this.folder(folderId);
    if (folder.parentId === null) throw fail('The root folder cannot be deleted');
    if (this.assets.some(asset => asset.folderId === folderId) || this.state.folders.some(folder => folder.parentId === folderId)) throw fail('Folder is not empty');
    this.state.folders = this.state.folders.filter(folder => folder.id !== folderId); this.changed();
  }
  addUsage(assetId, values) {
    this.asset(assetId);
    if (typeof values?.name !== 'string' || typeof values?.uri !== 'string' || values.name.length > 2000 || values.uri.length > 8000) throw fail('Lineage needs name and uri strings');
    const usage = {trackingId: randomUUID(), assetId, name: values.name, uri: values.uri, at: new Date().toISOString()};
    this.state.usages.push(usage); this.changed(); return usage;
  }
  deleteUsage(assetId, trackingId) { this.state.usages = this.state.usages.filter(usage => usage.assetId !== assetId || usage.trackingId !== trackingId); this.changed(); }
  clear() { for (const asset of [...this.assets]) this.delete(asset.id); this.state.folders = this.state.folders.filter(folder => folder.parentId === null); this.state.usages = []; this.changed(); }
  contentEtag(bytes) { return '"' + createHash('sha256').update(bytes).digest('hex') + '"'; }
}
