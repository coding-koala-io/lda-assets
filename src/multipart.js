import {fail} from './http-utils.js';
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_UPLOAD_SIZE = 256 * 1024 * 1024;

/** Binary-safe bounded form-data parser; boundary markers must occupy complete lines. */
export function parseMultipart(bytes, contentType, {maxFileSize = MAX_FILE_SIZE} = {}) {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType ?? '');
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200) throw fail('A valid multipart boundary is required');
  if (bytes.length > MAX_UPLOAD_SIZE) throw fail('Upload exceeds 256 MB', 413);
  const opening = Buffer.from(`--${boundary}\r\n`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  if (!bytes.subarray(0, opening.length).equals(opening)) throw fail('Malformed multipart opening boundary');
  const files = []; const fields = Object.create(null); let offset = opening.length; let parts = 0;
  while (offset < bytes.length) {
    if (++parts > 200) throw fail('Too many multipart parts');
    const headersEnd = bytes.indexOf('\r\n\r\n', offset);
    if (headersEnd < 0 || headersEnd - offset > 16384) throw fail('Malformed multipart headers');
    const headers = bytes.subarray(offset, headersEnd).toString('utf8');
    const disposition = /^content-disposition:\s*form-data;([^\r\n]*)/im.exec(headers)?.[1];
    const name = /(?:^|;)\s*name="([^"\r\n]*)"/i.exec(disposition ?? '')?.[1];
    if (!name) throw fail('Multipart part needs a field name');
    const filename = /(?:^|;)\s*filename="([^"\r\n]*)"/i.exec(disposition)?.[1];
    let end = headersEnd + 4;
    do {
      end = bytes.indexOf(separator, end);
      if (end < 0) throw fail('Missing multipart closing boundary');
      const suffix = bytes.subarray(end + separator.length, end + separator.length + 2).toString();
      const after = end + separator.length + 2;
      const closing = suffix === '--' && (after === bytes.length || bytes.subarray(after, after + 2).toString() === '\r\n');
      if (suffix === '\r\n' || closing) break;
      end++;
    } while (true);
    const data = bytes.subarray(headersEnd + 4, end);
    if (filename !== undefined) {
      if (data.length > maxFileSize) throw fail('File exceeds 50 MB', 413);
      const safeFilename = filename.replace(/%22/gi, '"').replace(/%0[da]/gi, '').split(/[\\/]/).at(-1);
      if (safeFilename) files.push({name, filename: safeFilename, mimeType: /^content-type:\s*([^\r\n;]+)/im.exec(headers)?.[1].trim().toLowerCase() || 'application/octet-stream', data});
    } else {
      if (data.length > 65536) throw fail('Multipart field exceeds 64 KB', 413);
      fields[name] = data.toString('utf8');
    }
    offset = end + separator.length;
    if (bytes.subarray(offset, offset + 2).toString() === '--') return {fields, files};
    offset += 2;
  }
  throw fail('Incomplete multipart body');
}
