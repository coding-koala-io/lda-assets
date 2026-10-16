import {basicCredentials, constantEqual, loopback} from './tenants.js';

export function localAuthorities(host, port) {
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const names = ['127.0.0.1', 'localhost', hostname].map(name => name.toLowerCase());
  return new Set(names.flatMap(name => Number(port) === 80 ? [name, `${name}:80`] : [`${name}:${port}`]));
}

/** SDK paths bypass these dashboard-only checks. */
export function adminAccess(request, config, response) {
  const admin = basicCredentials(request.headers.authorization);
  const validAdmin = Boolean(config.adminUser && config.adminPassword && admin && constantEqual(admin.appKey,config.adminUser) && constantEqual(admin.secret,config.adminPassword));
  const authorities = localAuthorities(config.host, request.socket.localPort);
  const publicHosts = String(config.publicHostnames).split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const matchesPublic = authority => publicHosts.some(value => {
    try { const allowed = new URL(value.includes('://') ? value : `http://${value}`); const candidate = new URL(`http://${authority}`); return allowed.hostname === candidate.hostname && (!allowed.port || allowed.port === candidate.port); }
    catch { return false; }
  });
  if (loopback(config.host) && !authorities.has(request.headers.host?.toLowerCase()) && !matchesPublic(request.headers.host)) return {status:403,message:'Host is not allowed'};
  const origin = request.headers.origin; let sameOrigin = origin == null;
  if (origin != null) {
    try {
      const parsed = new URL(origin);
      if (['http:','https:'].includes(parsed.protocol) && parsed.origin === origin) sameOrigin = parsed.protocol === 'http:' && authorities.has(parsed.host.toLowerCase()) || matchesPublic(parsed.host) || !loopback(config.host) && validAdmin && parsed.host.toLowerCase() === request.headers.host?.toLowerCase();
    } catch { /* invalid origins remain forbidden */ }
  }
  if (request.method === 'OPTIONS' || !sameOrigin) return {status:403,message:'A same-origin request is required'};
  if (!loopback(config.host) && !validAdmin && new URL(request.url,'http://localhost').pathname !== '/health') {
    response.setHeader('WWW-Authenticate','Basic realm="LDA Local Assets"'); return {status:401,message:'Administrator credentials are required'};
  }
  return {validAdmin};
}
