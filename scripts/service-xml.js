import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateTenant} from '../src/tenant-create.js';
import {cmsSettings} from '../src/cms-settings.js';

export const SERVICE_ID = 'LdaAssets';
export const DISPLAY_NAME = 'Local Developer Accelerator — Assets (development only)';
export const DESCRIPTION = 'LDA Local Assets — local development stand-in compatible with Optimizely DAM. Not for production. By Coding Koala.';
export const DEFAULT_RUNTIME_ROOT = 'C:\\ProgramData\\Coding Koala\\Local Developer Accelerator\\Assets';
export const WRAPPER_URL = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe';

const pathsFor = value => path.win32.isAbsolute(value) && !value.startsWith('/') ? path.win32 : path;
const xml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));

export function runtimePaths(runtimeRoot = DEFAULT_RUNTIME_ROOT) {
  const paths = pathsFor(runtimeRoot);
  if (!paths.isAbsolute(runtimeRoot)) throw new Error('RuntimeRoot must be an absolute path');
  const root = paths.normalize(runtimeRoot);
  const service = paths.join(root, 'service');
  return {root, tenantsFile: paths.join(root, 'tenants.json'), dataDir: paths.join(root, 'data'), logDir: paths.join(root, 'logs'), service,
    wrapper: paths.join(service, `${SERVICE_ID}.exe`), xml: paths.join(service, `${SERVICE_ID}.xml`), wrapperLogs: paths.join(service, 'logs')};
}

export function generateServiceXml({nodePath, repoRoot, runtimeRoot = DEFAULT_RUNTIME_ROOT, port = 8083, host = '127.0.0.1'}) {
  for (const [label, value] of Object.entries({nodePath, repoRoot})) {
    if (typeof value !== 'string' || !pathsFor(value).isAbsolute(value) || /[\x00-\x1f"%]/.test(value)) throw new Error(`${label} must be an absolute path without quotes, control characters or % expansion`);
  }
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Port must be an integer from 1 to 65535');
  if (typeof host !== 'string' || !host || /[\x00-\x1f%]/.test(host)) throw new Error('Host must be nonempty without control characters or % expansion');
  if (/[\x00-\x1f"%]/.test(runtimeRoot)) throw new Error('RuntimeRoot cannot contain quotes, control characters or % expansion');
  const runtime = runtimePaths(runtimeRoot);
  const server = pathsFor(repoRoot).join(repoRoot, 'src', 'server.js');
  const env = {PORT: Number(port), HOST: host, TENANTS_FILE: runtime.tenantsFile, DATA_DIR: runtime.dataDir, LOG_DIR: runtime.logDir};
  return `<?xml version="1.0" encoding="UTF-8"?>
<service>
  <id>${SERVICE_ID}</id>
  <name>${xml(DISPLAY_NAME)}</name>
  <description>${xml(DESCRIPTION)}</description>
  <executable>${xml(nodePath)}</executable>
  <arguments>${xml(`"${server}"`)}</arguments>
  <workingdirectory>${xml(repoRoot)}</workingdirectory>
${Object.entries(env).map(([name, value]) => `  <env name="${name}" value="${xml(value)}" />`).join('\n')}
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="10 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>${xml(runtime.wrapperLogs)}</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <serviceaccount>
    <domain>NT AUTHORITY</domain>
    <user>LocalService</user>
  </serviceaccount>
</service>
`;
}

/** Exclusive creation preserves existing credentials on repeated installs. */
export function initializeTenantFile(runtimeRoot, port = 8083) {
  const runtime = runtimePaths(runtimeRoot);
  if (existsSync(runtime.tenantsFile)) return null;
  const tenant = generateTenant('Default', []);
  mkdirSync(runtime.root, {recursive: true});
  writeFileSync(runtime.tenantsFile, JSON.stringify({dataVersion: 1, tenants: [tenant]}, null, 2) + '\n', {flag: 'wx'});
  return cmsSettings(tenant, `http://localhost:${port}`);
}

// JSON on stdin avoids shell quoting/escaping paths and keeps PowerShell 5.1 simple.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    if (process.argv[2] === 'init') {
      const snippet = initializeTenantFile(options.runtimeRoot, options.port);
      if (snippet) console.log(JSON.stringify(snippet, null, 2));
    } else if (process.argv[2] === 'xml') process.stdout.write(generateServiceXml(options));
    else throw new Error('Expected xml or init command');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
