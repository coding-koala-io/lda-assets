import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve, relative, isAbsolute, posix} from 'node:path';
import {scratch, eventually} from './helpers.js';
import {releaseManifest, sumsLine, zipName, sha256File, tarCommand, buildRelease, gitCommit, STAGED_FILES} from '../scripts/build-release.mjs';
import {releaseNotes} from '../scripts/release-notes.mjs';

/** Relative .md links (anchors and web/mail links ignored) in README.md and LEGAL-NOTICE.md under root. */
function relativeDocLinks(root) {
  const links = [];
  for (const file of ['README.md', 'LEGAL-NOTICE.md']) {
    for (const [, target] of readFileSync(join(root, file), 'utf8').matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && target.endsWith('.md')) links.push({file, target: posix.normalize(posix.join(posix.dirname(file), target))});
    }
  }
  return links;
}

const repo = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canZip = process.platform === 'win32' ? existsSync(tarCommand()) : ['zip', 'unzip'].every(command => spawnSync(command, ['-v'], {stdio: 'ignore'}).status === 0);

test('release manifest and SHA256SUMS lines have the documented shape', t => {
  const sha = 'a'.repeat(64);
  assert.equal(zipName('assets', '1.2.3'), 'lda-assets-1.2.3.zip');
  assert.equal(sumsLine(sha, 'lda-assets-1.2.3.zip'), `${sha}  lda-assets-1.2.3.zip\n`);
  const manifest = releaseManifest({version: '1.2.3', file: 'lda-assets-1.2.3.zip', sha256: sha, size: 42, commit: 'abc123', builtAt: '2026-10-16T00:00:00.000Z'});
  assert.deepEqual(manifest, {module: 'assets', product: 'LDA Local Assets', version: '1.2.3', minNode: '24', dataVersion: 1, file: 'lda-assets-1.2.3.zip', sha256: sha, size: 42, commit: 'abc123', builtAt: '2026-10-16T00:00:00.000Z'});
  assert.deepEqual(Object.keys(manifest), ['module', 'product', 'version', 'minNode', 'dataVersion', 'file', 'sha256', 'size', 'commit', 'builtAt']);
  assert.equal(releaseManifest({version: '1.0.0', file: 'x.zip', sha256: sha, size: 1}).commit, null);
  assert.ok(Date.parse(releaseManifest({version: '1.0.0', file: 'x.zip', sha256: sha, size: 1}).builtAt));
  assert.throws(() => releaseManifest({version: '1.0.0', file: 'x.zip', sha256: 'XYZ', size: 1}), /sha256/);
  assert.throws(() => releaseManifest({version: '1.0.0', file: 'x.zip', sha256: sha, size: 0}), /size/);
  const file = join(scratch(t), 'sample.bin'); writeFileSync(file, 'release bytes');
  return sha256File(file).then(value => assert.equal(value, hash('release bytes')));
});

test('release notes take exactly one dated CHANGELOG section and refuse unreleased or undated ones', t => {
  const changelog = '# Changelog\n\n## [1.1.0] - 2027-01-01\n### Added\n- New\n\n## [1.0.0] - 2026-10-16\n### Changed\n- Old\n\n## [0.9.0] - unreleased\n- Draft\n\n## [0.8.0]\n- Undated\n\n## [0.7.0] - soon\n- Bad\n';
  assert.equal(releaseNotes(changelog, '1.1.0'), '### Added\n- New\n');
  assert.equal(releaseNotes(changelog, '1.0.0'), '### Changed\n- Old\n');
  assert.throws(() => releaseNotes(changelog, '9.9.9'), /no section/);
  for (const version of ['0.9.0', '0.8.0', '0.7.0']) assert.throws(() => releaseNotes(changelog, version), error => error.message.startsWith(`CHANGELOG.md section for ${version} is not dated`) && error.message.includes('YYYY-MM-DD'));
  assert.match(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8'), new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] - `, 'm'));
  // The command exits 1 with the message and writes nothing while the current section is undated.
  const heading = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8').split(/\r?\n/).find(line => line.startsWith(`## [${pkg.version}]`));
  const output = join(scratch(t), 'notes.md');
  const result = spawnSync(process.execPath, [join(repo, 'scripts/release-notes.mjs'), pkg.version, output], {encoding: 'utf8', windowsHide: true});
  if (/ - \d{4}-\d{2}-\d{2}$/.test(heading)) { assert.equal(result.status, 0, result.stderr); assert.ok(existsSync(output)); }
  else {
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), `CHANGELOG.md section for ${pkg.version} is not dated ("${heading}"). Change its heading to "## [${pkg.version}] - YYYY-MM-DD" before releasing.`);
    assert.ok(!existsSync(output));
  }
});

test('release commit comes from LDA_RELEASE_COMMIT, otherwise git rev-parse HEAD, otherwise null', t => {
  const saved = process.env.LDA_RELEASE_COMMIT;
  t.after(() => { if (saved === undefined) delete process.env.LDA_RELEASE_COMMIT; else process.env.LDA_RELEASE_COMMIT = saved; });
  process.env.LDA_RELEASE_COMMIT = 'b'.repeat(40); assert.equal(gitCommit(), 'b'.repeat(40));
  process.env.LDA_RELEASE_COMMIT = ''; assert.equal(gitCommit(), null);
  delete process.env.LDA_RELEASE_COMMIT;
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8', windowsHide: true});
  assert.equal(gitCommit(), head.status === 0 ? head.stdout.trim() : null);
  assert.ok(readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8').includes('LDA_RELEASE_COMMIT: ${{ github.sha }}'));
});

test('release files include every document that README.md and LEGAL-NOTICE.md link to', () => {
  for (const file of ['TAKEDOWN-AND-CONTACT.md', 'CONTRIBUTING.md']) assert.ok(STAGED_FILES.includes(file), file);
  const links = relativeDocLinks(repo);
  assert.ok(links.some(link => link.target === 'TAKEDOWN-AND-CONTACT.md'));
  for (const {file, target} of links) assert.ok(STAGED_FILES.includes(target) || target.startsWith('src/'), `${file} links to ${target}, which is not packaged`);
});

test('npm release:build script, CI and release workflows, ignored dist folder and releasing guide', () => {
  assert.equal(pkg.scripts['release:build'], 'node scripts/build-release.mjs');
  assert.match(readFileSync(join(repo, '.gitignore'), 'utf8'), /^dist\/$/m);
  const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8');
  for (const text of ['develop', 'main', "'feature/**'", "'release/**'", "'hotfix/**'", 'pull_request', 'windows-latest', 'actions/setup-node@v4', 'node-version: 24', 'npm ci', 'npm test', 'contents: read']) assert.ok(ci.includes(text), text);
  assert.ok(!ci.includes('npm install'), 'CI installs exactly the committed lockfile');
  const release = readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8');
  for (const text of ["tags: ['v*']", 'contents: write', 'npm test', 'npm run release:build', 'gh release create "$TAG" dist/*.zip dist/SHA256SUMS dist/manifest.json', '--title "LDA Local Assets $VERSION"', '--notes-file', 'GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}', '"$GITHUB_REF_NAME" != "v$VERSION"', 'needs: test']) assert.ok(release.includes(text), text);
  const guide = readFileSync(join(repo, 'docs/RELEASING.md'), 'utf8');
  for (const text of ['git flow release start X.Y.Z', 'CHANGELOG', 'Change Date', 'npm test', 'git flow release finish X.Y.Z', 'git push origin main develop --tags']) assert.ok(guide.includes(text), text);
});

test('release build produces a zip, sums and manifest; the unpacked zip starts and answers /health', {skip: !canZip, timeout: 60000}, async t => {
  const root = scratch(t); const outDir = join(root, 'dist');
  const {zip, manifest} = await buildRelease({outDir, commit: null, logger: {log() {}}});
  const file = zipName('assets', pkg.version);
  assert.equal(zip, join(outDir, file)); assert.ok(existsSync(zip));
  const bytes = readFileSync(zip);
  assert.equal(readFileSync(join(outDir, 'SHA256SUMS'), 'utf8'), `${hash(bytes)}  ${file}\n`);
  const saved = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(saved, manifest);
  assert.equal(saved.module, 'assets'); assert.equal(saved.product, 'LDA Local Assets'); assert.equal(saved.version, pkg.version); assert.equal(saved.minNode, '24'); assert.equal(saved.dataVersion, 1);
  assert.equal(saved.file, file); assert.equal(saved.sha256, hash(bytes)); assert.equal(saved.size, statSync(zip).size); assert.equal(saved.commit, null); assert.ok(Date.parse(saved.builtAt));

  const unpacked = join(root, 'unpacked'); mkdirSync(unpacked);
  const extract = process.platform === 'win32' ? spawnSync(tarCommand(), ['-x', '-f', zip, '-C', unpacked], {windowsHide: true, encoding: 'utf8'}) : spawnSync('unzip', ['-q', zip, '-d', unpacked], {encoding: 'utf8'});
  assert.equal(extract.status, 0, extract.stderr);
  for (const name of ['src/server.js', 'src/product.js', 'package-lock.json', ...STAGED_FILES]) assert.ok(existsSync(join(unpacked, name)), name);
  for (const name of ['test', '.github', 'dist', 'scripts/build-release.mjs']) assert.ok(!existsSync(join(unpacked, name)), name);
  assert.deepEqual(readdirSync(join(unpacked, 'docs')).sort(), ['RELEASING.md', 'protocol.md']);
  for (const {file, target} of relativeDocLinks(unpacked)) {
    const inside = relative(unpacked, resolve(unpacked, target));
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside) && existsSync(join(unpacked, target)), `packaged ${file} links to missing ${target}`);
  }
  assert.deepEqual(readdirSync(join(unpacked, 'scripts')).sort(), ['service-xml.js', 'service.ps1']);

  const runtime = join(root, 'runtime');
  const child = spawn(process.execPath, ['src/server.js'], {cwd: unpacked, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, PORT: '0', HOST: '127.0.0.1', TENANTS_FILE: join(runtime, 'tenants.json'), DATA_DIR: join(runtime, 'data'), LOG_DIR: join(runtime, 'logs'), ADMIN_USER: '', ADMIN_PASSWORD: '', PUBLIC_BASE_URL: '', PUBLIC_HOSTNAMES: ''}});
  let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const exited = once(child, 'exit');
  try {
    await eventually(() => { assert.equal(child.exitCode, null, stdout + stderr); return /listening at http:\/\/127\.0\.0\.1:(\d+)/.test(stdout); }, 10000);
    assert.match(stdout, new RegExp(`LDA Local Assets ${pkg.version.replace(/\./g, '\\.')} \\(Local Developer Accelerator for Optimizely\\) listening at`));
    const port = /listening at http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout)[1];
    const health = await (await fetch(`http://127.0.0.1:${port}/health`, {headers: {Connection: 'close'}})).json();
    assert.equal(health.product, 'assets'); assert.equal(health.version, pkg.version); assert.equal(health.dataVersion, 1);
    const licence = await (await fetch(`http://127.0.0.1:${port}/about/licence`, {headers: {Connection: 'close'}})).text();
    assert.match(licence, /Business Source License 1\.1/);
  } finally {
    // Stop the unpacked server before the scratch folder (its working directory) is removed.
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
});
