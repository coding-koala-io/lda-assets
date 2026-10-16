import {appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, openSync, readSync, closeSync, readdirSync} from 'node:fs';
import {join} from 'node:path';


const LIMIT = 50 * 1024 * 1024;
/** Preserve the rest of the URL, including repeated and percent-encoded parameters. */
export function redactUrl(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, separator, key) => {
    try { return /^(auth|client_?id|client_?secret|access_?token|refresh_?token|token|secret|password|appkey|singlekey|api_?key|csrf)$/i.test(decodeURIComponent(key.replaceAll('+', ' '))) ? `${separator}${key}=***` : match; }
    catch { return match; }
  });
}
/** Apply URL redaction to every logged header, including multi-value headers. */
function redactHeaders(headers) {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name,
    Array.isArray(value) ? value.map(redactUrl) : redactUrl(value)]));
}
/** Read backwards in small byte blocks, retaining complete Unicode NDJSON lines. */
function readRecent(file, entries) {
  const fd = openSync(file, 'r'); let position = statSync(file).size; let pending = Buffer.alloc(0); let skipping = false;
  const append = bytes => {
    if (!bytes.length) return;
    try { const entry = JSON.parse(bytes.toString('utf8')); if (Number.isSafeInteger(entry.n)) entries.push(entry); } catch { /* partial or invalid line */ }
  };
  try {
    while (position > 0 && entries.length < 500) {
      const length = Math.min(position, 65536); position -= length;
      const block = Buffer.alloc(length); const count = readSync(fd, block, 0, length, position);
      const bytes = Buffer.concat([block.subarray(0, count), pending]); let end = bytes.length;
      while (entries.length < 500 && end > 0) {
        const newline = bytes.lastIndexOf(10, end - 1);
        if (newline < 0) break;
        if (!skipping) append(bytes.subarray(newline + 1, end));
        skipping = false; end = newline;
      }
      // Two bounded bodies plus metadata fit in 256 KB. Skip oversized corrupt lines.
      if (skipping || end > 256 * 1024) { pending = Buffer.alloc(0); skipping = true; }
      else pending = bytes.subarray(0, end);
    }
    if (position === 0 && entries.length < 500 && !skipping) append(pending);
  } finally { closeSync(fd); }
}
export function truncate(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  if (text == null) return null;
  const bytes = Buffer.from(text);
  if (bytes.length <= 65536) return body;
  const decoder = new TextDecoder('utf-8', {fatal: true});
  for (let end = 65536; end >= 65532; end--) { try { return decoder.decode(bytes.subarray(0, end)); } catch { /* complete UTF-8 only */ } }
  return '';
}

/** A separate ring and rotated files for every tenant, including unrouted requests. */
export class RequestLog {
  constructor(dir, logger) { this.dir = dir; this.logger = logger; this.recent = []; this.number = 0; this.loaded = false; }
  load() {
    if (this.loaded) return;
    this.loaded = true;
    if (this.dir === ':memory:') return;
    try {
      const entries = [];
      for (const suffix of ['', '.1', '.2', '.3']) {
        const file = join(this.dir, 'requests.ndjson' + suffix);
        if (existsSync(file)) readRecent(file, entries);
        if (entries.length >= 500) break;
      }
      this.recent.push(...entries.reverse().map(entry => ({...entry, url: redactUrl(entry.url), headers: safeHeaders(redactHeaders(entry.headers)), reqBody: sanitizeLog(entry.reqBody), resBody: sanitizeLog(entry.resBody)})));
      this.number = this.recent.reduce((maximum, entry) => Math.max(maximum, entry.n), 0);
    } catch (error) { this.logger.error(`Request log load failed: ${error.message}`); }
  }
  append(entry) {
    if (this.disabled) return;
    entry.url = redactUrl(entry.url);
    entry.headers = safeHeaders(redactHeaders(entry.headers));
    entry.reqBody = sanitizeLog(entry.reqBody); entry.resBody = sanitizeLog(entry.resBody);
    this.load();
    entry.n = ++this.number;
    this.recent.push(entry); if (this.recent.length > 500) this.recent.shift();
    if (this.dir === ':memory:') return;
    try {
      mkdirSync(this.dir, {recursive: true});
      const file = join(this.dir, 'requests.ndjson'); const line = JSON.stringify(entry) + '\n';
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > LIMIT) {
        if (existsSync(`${file}.3`)) unlinkSync(`${file}.3`);
        for (let n = 2; n >= 1; n--) if (existsSync(`${file}.${n}`)) renameSync(`${file}.${n}`, `${file}.${n + 1}`);
        renameSync(file, `${file}.1`);
      }
      appendFileSync(file, line);
    } catch (error) { this.logger.error(`Request log failed: ${error.message}`); }
  }
  clear() {
    this.load(); const removed = {requests: this.recent.length, requestFiles: 0};
    this.recent.length = 0;
    if (this.dir !== ':memory:' && existsSync(this.dir)) for (const name of readdirSync(this.dir)) {
      if (/^requests\.ndjson(?:\.[1-3])?$/.test(name)) { unlinkSync(join(this.dir, name)); removed.requestFiles++; }
    }
    return removed;
  }
}

const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|x-user-sso-id|csrf|client_?id|client_?secret|access_?token|refresh_?token|secret|password|adminpassword|appkey|singlekey|x-api-key)$/i;
export function sanitizeLog(value) {
  if (Array.isArray(value)) return value.map(sanitizeLog);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,sensitive.test(key)?'***':sanitizeLog(entry)]));
  return typeof value === 'string' ? redactUrl(value) : value;
}
export function safeHeaders(headers) { return sanitizeLog(headers); }
