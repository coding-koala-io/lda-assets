export const fail = (message, status = 400) => Object.assign(new Error(message), {status});
export function parseJson(text) {
  try { return JSON.parse(text); } catch { throw fail('Invalid JSON body'); }
}
/** Reject without destroying the socket, so oversized requests receive HTTP 413. */
export function readBody(request, limit = 1024 * 1024) {
  return new Promise((accept,reject)=>{
    const chunks=[]; let length=0; let finished=false;
    const cleanup=()=>{request.off('data',data);request.off('end',end);request.off('error',error);request.off('aborted',aborted);};
    const error=cause=>{if(finished)return;finished=true;cleanup();chunks.length=0;reject(cause);};
    const aborted=()=>error(fail('Request body was interrupted'));
    const end=()=>{if(finished)return;finished=true;cleanup();const body=Buffer.concat(chunks,length);chunks.length=0;accept(body);};
    const data=chunk=>{
      length+=chunk.length;
      if(length>limit){chunks.length=0;error(fail(`Request body exceeds ${Math.floor(limit/1024/1024)} MB`,413));request.resume();return;}
      chunks.push(chunk);
    };
    request.on('data',data);request.once('end',end);request.once('error',error);request.once('aborted',aborted);
  });
}

/** Ignore malformed/multiple ranges; reject an unsatisfiable single byte range. */
export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec((header ?? '').trim());
  if (!match || !match[1] && !match[2]) return null;
  let start; let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix || !size) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) return false;
  }
  return {start, end};
}
