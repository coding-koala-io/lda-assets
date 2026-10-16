const base = "default-src 'self'; img-src 'self' http: https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'";
export const ADMIN_PAGE_HEADERS = {'Content-Security-Policy': base + "; frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN'};
export const PICKER_PAGE_HEADERS = {'Content-Security-Policy': base + "; frame-ancestors 'none'", 'X-Frame-Options': 'DENY'};
