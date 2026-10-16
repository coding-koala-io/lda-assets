import {existsSync, readFileSync, mkdirSync, renameSync, watch, watchFile, unwatchFile, writeFileSync, unlinkSync, rmSync} from 'node:fs';
import {resolve, join, dirname, basename} from 'node:path';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {Store} from './store.js';
import {RequestLog} from './request-log.js';
import {GraphSync} from './graph-sync.js';
import {product} from './product.js';

export const loopback = host => /^(localhost|\[?::1\]?|127(?:\.\d{1,3}){3}|::ffff:127(?:\.\d{1,3}){3})$/i.test(host);
export const constantEqual = (a, b) => {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};
export function basicCredentials(header = '') {
  const match = /^Basic\s+([a-z0-9+/]+={0,2})$/i.exec(header);
  if (!match) return null;
  const value = Buffer.from(match[1], 'base64').toString('utf8'); const colon = value.indexOf(':');
  return colon < 0 ? null : {appKey:value.slice(0,colon), secret:value.slice(colon+1)};
}
export function validateTenants(input) {
  if (!input || !Array.isArray(input.tenants)) throw new Error('tenants.json must contain a tenants array');
  const ids = new Set(); const keys = new Set();
  return input.tenants.map((entry, index) => {
    const fail = message => { throw new Error(`Tenant entry ${index + 1}${entry?.id ? ` (${entry.id})` : ''}: ${message}`); };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('must be an object');
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(entry.id)) fail('invalid id; use 1-63 lowercase letters, digits and hyphens');
    if (ids.has(entry.id)) fail('duplicate id'); ids.add(entry.id);
    if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.trim().length > 100) fail('name must be 1-100 characters');
    if (typeof entry.clientId !== 'string' || !/^[A-Za-z0-9._~-]{1,200}$/.test(entry.clientId)) fail('invalid clientId');
    if (keys.has(entry.clientId)) fail('duplicate clientId'); keys.add(entry.clientId);
    if (typeof entry.clientSecret !== 'string' || !entry.clientSecret || entry.clientSecret !== entry.clientSecret.trim()) fail('clientSecret must be nonempty without edge whitespace');
    const graph = entry.graph ?? {};
    if (typeof graph !== 'object' || Array.isArray(graph)) fail('graph must be an object');
    for (const key of ['gatewayAddress','appKey','secret']) if (graph[key] != null && typeof graph[key] !== 'string') fail(`graph.${key} must be a string`);
    const linked = ['gatewayAddress','appKey','secret'].filter(key => graph[key]);
    if (linked.length && linked.length !== 3) fail('graph requires gatewayAddress, appKey and secret together');
    if (linked.length) {
      try { const parsed = new URL(graph.gatewayAddress); if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail('invalid Graph gateway URL'); }
      catch { fail('invalid Graph gateway URL'); }
      if (!/^[A-Za-z0-9._~-]{1,200}$/.test(graph.appKey) || !graph.secret.trim() || graph.secret !== graph.secret.trim()) fail('invalid Graph credentials');
    }
    return {id:entry.id, name:entry.name.trim(), clientId:entry.clientId, clientSecret:entry.clientSecret, graph:linked.length ? {...graph, gatewayAddress:graph.gatewayAddress.replace(/\/$/,'')} : {}};
  });
}

/** Atomic serialized edits and directory watching mirror the local gateway registry. */
export class TenantRegistry {
  constructor(config, logger, publicBase) {
    this.config = config; this.logger = logger; this.publicBase = publicBase; this.file = resolve(config.tenantsFile); this.runtimes = new Map(); this.writeQueue = Promise.resolve();
    this.loadedText = existsSync(this.file) ? readFileSync(this.file,'utf8') : null;
    this.entries = this.loadedText === null ? [] : this.read(this.loadedText);
    this.unrouted = new RequestLog(this.folder(config.logDir,'_unrouted'), logger);
    const changed = () => { clearTimeout(this.reloadTimer); this.reloadTimer = setTimeout(() => this.reload(), 300); this.reloadTimer.unref(); };
    try { this.watcher = watch(dirname(this.file), {persistent:false}, (_, name) => { if (!name || String(name) === basename(this.file)) changed(); }); this.watcher.on('error', error => logger.error(error.message)); }
    catch { this.fileWatcher = changed; watchFile(this.file, {persistent:false, interval:100}, changed); }
  }
  folder(root, id) { return root === ':memory:' ? root : join(root,id); }
  folderExists(id) { return [this.config.dataDir,this.config.logDir].some(root => root !== ':memory:' && existsSync(this.folder(root,id))); }
  read(text) {
    let input;
    try { input = JSON.parse(text); } catch (error) { throw new Error(`Invalid ${this.file}: ${error.message}`); }
    // Only an absent dataVersion is treated as 1; newer data must never be rewritten by an older build,
    // and anything else but a positive integer (null included) is refused rather than guessed.
    const dataVersion = input !== null && typeof input === 'object' && Object.hasOwn(input, 'dataVersion') ? input.dataVersion : 1;
    if (typeof dataVersion !== 'number' || !Number.isInteger(dataVersion) || dataVersion < 1) throw Object.assign(new Error(`Data in ${this.file} has an invalid dataVersion (${JSON.stringify(dataVersion)}).`), {exitCode:3});
    if (dataVersion > product.dataVersion) throw Object.assign(new Error(`Data in ${this.file} was written by a newer version (dataVersion ${dataVersion}). Upgrade ${product.name} or restore a backup.`), {exitCode:3});
    try { return validateTenants(input); } catch (error) { throw new Error(`Invalid ${this.file}: ${error.message}`); }
  }
  find(id) { return this.entries.find(entry => entry.id === id); }
  get(id) {
    const tenant = this.find(id); if (!tenant) return null;
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = {tenant, store:new Store({dataDir:this.folder(this.config.dataDir,id), logger:this.logger}), log:new RequestLog(this.folder(this.config.logDir,id),this.logger)};
      runtime.sync = new GraphSync(runtime, this.publicBase, this.config.syncOptions); runtime.log.load(); this.runtimes.set(id,runtime);
    }
    return runtime;
  }
  enqueue(work) { const next = this.writeQueue.then(work); this.writeQueue = next.catch(() => {}); return next; }
  assertDiskUnchanged() {
    const text = existsSync(this.file) ? readFileSync(this.file,'utf8') : null;
    if (text !== this.loadedText) throw new Error('tenants.json was changed on disk; reload or fix it first');
  }
  async apply(entries, commit = () => {}) {
    const active = new Set(entries.map(entry => entry.id));
    const removed = this.entries.filter(old => !active.has(old.id));
    const renames = removed.map(old => ({old,next:entries.find(next => !this.find(next.id) && next.clientId === old.clientId)})).filter(pair => pair.next);
    const moves = renames.flatMap(({old,next}) => [this.config.dataDir,this.config.logDir].filter(root => root !== ':memory:').map(root => ({from:resolve(root,old.id),to:resolve(root,next.id),root:resolve(root)})));
    for (const move of moves) {
      if (dirname(move.from) !== move.root || dirname(move.to) !== move.root) throw new Error('Unsafe instance path');
      if (existsSync(move.to)) throw new Error('Cannot rename instance: target folder already exists');
    }
    const evicted = removed.map(entry => this.runtimes.get(entry.id)).filter(Boolean); const moved = [];
    for (const runtime of evicted) runtime.busy = true;
    try {
      for (const runtime of evicted) { await runtime.sync.close(); runtime.store.flush(); }
      for (const move of moves) if (existsSync(move.from)) { renameSync(move.from,move.to); moved.push(move); }
      commit();
    } catch (error) {
      for (const move of moved.reverse()) renameSync(move.to,move.from);
      for (const runtime of evicted) runtime.sync.closed = false;
      throw error;
    } finally { for (const runtime of evicted) runtime.busy = false; }
    for (const old of removed) {
      const runtime = this.runtimes.get(old.id); this.runtimes.delete(old.id); if (!runtime) continue;
      const renamed = renames.find(pair => pair.old.id === old.id);
      if (renamed) {
        runtime.tenant = renamed.next; runtime.store.dataDir = this.folder(this.config.dataDir,renamed.next.id); runtime.log.dir = this.folder(this.config.logDir,renamed.next.id);
        runtime.sync.closed = false; this.runtimes.set(renamed.next.id,runtime); runtime.sync.schedule();
      } else runtime.log.disabled = true;
    }
    this.entries = entries;
    for (const entry of entries) { const runtime = this.runtimes.get(entry.id); if (runtime) runtime.tenant = entry; }
  }
  edit(change) {
    return this.enqueue(async () => {
      if (this.closed) throw new Error('Server is shutting down');
      this.assertDiskUnchanged();
      const entries = validateTenants({tenants:change(structuredClone(this.entries))});
      const temporary = `${this.file}.${randomUUID()}.tmp`; const written = JSON.stringify({dataVersion:product.dataVersion,tenants:entries},null,2) + '\n';
      mkdirSync(dirname(this.file),{recursive:true});
      try {
        writeFileSync(temporary,written);
        await this.apply(entries, () => { this.assertDiskUnchanged(); renameSync(temporary,this.file); this.loadedText = written; });
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    });
  }
  reload() {
    return this.enqueue(async () => {
      if (this.closed) return false;
      try {
        const text = readFileSync(this.file,'utf8'); if (text === this.loadedText) return true;
        await this.apply(this.read(text)); this.loadedText = text; this.logger.log('Tenant configuration reloaded'); return true;
      } catch (error) { this.logger.error(`Tenant reload rejected; keeping previous configuration: ${error.message}`); return false; }
    });
  }
  deleteFolders(id) {
    for (const root of [this.config.dataDir,this.config.logDir]) {
      if (root === ':memory:') continue;
      const target = resolve(root,id);
      if (dirname(target) !== resolve(root) || basename(target) !== id || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error('Unsafe tenant folder');
      rmSync(target,{recursive:true,force:true});
    }
  }
  health() { return Object.fromEntries(this.entries.map(({id}) => [id,{loaded:this.runtimes.has(id), assets:this.runtimes.get(id)?.store.assets.length ?? 0}])); }
  async close() {
    this.closed = true; this.watcher?.close(); if (this.fileWatcher) unwatchFile(this.file,this.fileWatcher); clearTimeout(this.reloadTimer); await this.writeQueue;
    const errors = [];
    // Save local mutations first, then close independent Graph clients concurrently.
    for (const runtime of this.runtimes.values()) { try { runtime.store.flush(); } catch (error) { errors.push(error); } }
    await Promise.all([...this.runtimes.values()].map(async runtime => { try { await runtime.sync.close(); runtime.store.flush(); } catch (error) { errors.push(error); } }));
    if (errors.length) throw new AggregateError(errors,'Shutdown persistence failed');
  }
}
