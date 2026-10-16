// Builds dist/lda-<key>-<version>.zip, dist/SHA256SUMS and dist/manifest.json. No dependencies.
import {cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {product} from '../src/product.js';

export const STAGED_FILES = ['scripts/service.ps1', 'scripts/service-xml.js', 'package.json', 'LICENSE.md', 'README.md', 'LEGAL-NOTICE.md', 'PRIVACY.md', 'CHANGELOG.md', 'CLEAN-ROOM.md', 'TAKEDOWN-AND-CONTACT.md', 'CONTRIBUTING.md', 'docs/protocol.md', 'docs/RELEASING.md'];
const repoRoot = path.resolve(import.meta.dirname, '..');

export const zipName = (key, version) => `lda-${key}-${version}.zip`;
export const sumsLine = (sha256, file) => `${sha256}  ${file}\n`;
export function releaseManifest({key = product.key, name = product.name, version, dataVersion = product.dataVersion, file, sha256, size, commit = null, builtAt = new Date().toISOString()}) {
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error('sha256 must be 64 lowercase hex characters');
  if (!Number.isInteger(size) || size <= 0) throw new Error('size must be a positive integer');
  return {module: key, product: name, version, minNode: '24', dataVersion, file, sha256, size, commit: commit || null, builtAt};
}
export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
/** Windows bsdtar writes zip archives with -a; another tar on PATH (for example Git's GNU tar) may not. */
export function tarCommand() {
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return process.platform === 'win32' && existsSync(system) ? system : 'tar';
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', windowsHide: true, ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}
/** Release commit: LDA_RELEASE_COMMIT when set (CI passes the tagged commit), otherwise git rev-parse HEAD, otherwise null. */
export function gitCommit(root = repoRoot) {
  if ('LDA_RELEASE_COMMIT' in process.env) return process.env.LDA_RELEASE_COMMIT && process.env.LDA_RELEASE_COMMIT !== 'none' ? process.env.LDA_RELEASE_COMMIT : null;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true});
  return result.status === 0 ? result.stdout.trim() || null : null;
}

export async function buildRelease({root = repoRoot, outDir = path.join(root, 'dist'), commit = gitCommit(root), logger = console} = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const stage = path.join(outDir, 'stage');
  rmSync(stage, {recursive: true, force: true}); mkdirSync(stage, {recursive: true});
  cpSync(path.join(root, 'src'), path.join(stage, 'src'), {recursive: true});
  for (const file of [...STAGED_FILES, ...(existsSync(path.join(root, 'package-lock.json')) ? ['package-lock.json'] : [])]) {
    const from = path.join(root, file);
    if (!existsSync(from)) throw new Error(`Release file is missing: ${file}`);
    mkdirSync(path.dirname(path.join(stage, file)), {recursive: true}); cpSync(from, path.join(stage, file));
  }
  if (Object.keys(pkg.dependencies ?? {}).length) run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts'], {cwd: stage, shell: process.platform === 'win32'});
  const file = zipName(product.key, pkg.version); const zip = path.join(outDir, file);
  rmSync(zip, {force: true});
  if (process.platform === 'win32') run(tarCommand(), ['-a', '-c', '-f', zip, '-C', stage, '.']);
  else run('zip', ['-r', '-q', zip, '.'], {cwd: stage});
  const sha256 = await sha256File(zip);
  const manifest = releaseManifest({version: pkg.version, file, sha256, size: statSync(zip).size, commit});
  writeFileSync(path.join(outDir, 'SHA256SUMS'), sumsLine(sha256, file));
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  logger.log(`Built ${zip} (${manifest.size} bytes, sha256 ${sha256})`);
  return {zip, stage, manifest};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await buildRelease(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
