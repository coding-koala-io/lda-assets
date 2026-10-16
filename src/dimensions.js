/** Graph dimensions must be positive signed 32-bit integers. */
export function normalizeDimensions({width, height}) {
  return Object.fromEntries(Object.entries({width, height}).flatMap(([key, value]) => {
    const rounded = Math.round(value);
    return Number.isFinite(value) && rounded > 0 && rounded <= 2147483647 ? [[key, rounded]] : [];
  }));
}

/** Read image headers only; malformed or unsupported media has no dimensions. */
export function dimensions(bytes, mimeType = '') {
  const pair = (width, height) => normalizeDimensions({width, height});
  try {
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return pair(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return pair(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let at = 2;
      while (at + 3 < bytes.length) {
        if (bytes[at++] !== 0xff) return {};
        while (bytes[at] === 0xff) at++;
        const marker = bytes[at++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
        const size = bytes.readUInt16BE(at);
        if (size < 2 || at + size > bytes.length) return {};
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && size >= 7) return pair(bytes.readUInt16BE(at + 5), bytes.readUInt16BE(at + 3));
        at += size;
      }
    }
    if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
      for (let at = 12; at + 8 <= bytes.length;) {
        const type = bytes.toString('ascii', at, at + 4); const size = bytes.readUInt32LE(at + 4); const p = at + 8;
        if (p + size > bytes.length) return {};
        if (type === 'VP8X' && size >= 10) return pair(1 + bytes.readUIntLE(p + 4, 3), 1 + bytes.readUIntLE(p + 7, 3));
        if (type === 'VP8 ' && size >= 10 && bytes.subarray(p + 3, p + 6).equals(Buffer.from([0x9d,0x01,0x2a]))) return pair(bytes.readUInt16LE(p + 6) & 0x3fff, bytes.readUInt16LE(p + 8) & 0x3fff);
        if (type === 'VP8L' && size >= 5 && bytes[p] === 0x2f) {
          const bits = bytes.readUInt32LE(p + 1);
          return pair((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        }
        at = p + size + (size % 2);
      }
    }
    if (mimeType === 'image/svg+xml') {
      const tag = /<svg\b([^>]*)>/i.exec(bytes.subarray(0, 65536).toString())?.[1] ?? '';
      const attr = key => new RegExp(`(?:^|\\s)${key}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
      const length = value => /^\d+(?:\.\d+)?(?:px)?$/i.test(value ?? '') ? parseFloat(value) : NaN;
      const box = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
      const width = length(attr('width')); const height = length(attr('height'));
      if (width > 0 && height > 0) return pair(width, height);
      if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
        if (width > 0) return pair(width, width * box[3] / box[2]);
        if (height > 0) return pair(height * box[2] / box[3], height);
        return pair(box[2], box[3]);
      }
    }
  } catch { /* Truncated or malformed image header. */ }
  return {};
}
