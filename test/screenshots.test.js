import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {scratch} from './helpers.js';
import {runInNewContext} from 'node:vm';
import {DevTools, waitReady, PAGES, WIDTHS, OUTPUT_DIR, outputPath, pageRoute, manifest, changes, findBrowser,
  assertSafeCaptureText, checkPagePrivacy, configureBrowser, prepareDemo, openDemo, screenshots, DEMO_TIME, DEMO_PORT} from '../scripts/screenshots.mjs';

test('screenshots cover every standalone screen, including legal and POST confirmation pages', () => {
  assert.deepEqual(PAGES.map(page => page.name), [
    'dashboard', 'about', 'privacy', 'licence', 'legal', 'instance', 'instance-edit',
    'asset', 'document', 'request', 'instance-clear', 'instance-delete', 'asset-delete', 'error',
  ]);
  const demo = {tenant: 'demo-library', asset: 'a'.repeat(32), document: 'b'.repeat(32), request: '1'};
  assert.deepEqual(PAGES.slice(0, 5).map(page => pageRoute(page, demo)), ['/', '/about', '/about/privacy', '/about/licence', '/about/legal']);
  assert.equal(pageRoute(PAGES.find(page => page.name === 'asset'), demo), '/tenants/demo-library/assets/' + 'a'.repeat(32));
  assert.deepEqual(PAGES.filter(page => page.form).map(page => page.form), [{action: 'clear'}, {action: 'delete'}, {}, {name: ''}]);
  assert.ok(PAGES.every(page => !page.route.startsWith('/app/')));
  assert.throws(() => pageRoute(PAGES.find(page => page.name === 'asset'), {}), /Missing demo/);
});

test('screenshots use stable safe paths and a deterministic manifest at both native widths', () => {
  assert.deepEqual(WIDTHS, [720, 360]);
  assert.equal(OUTPUT_DIR, 'docs/media/screens');
  const paths = PAGES.flatMap(page => WIDTHS.map(width => outputPath(page.name, width)));
  assert.equal(new Set(paths).size, 28);
  for (const page of PAGES) for (const width of WIDTHS) {
    assert.equal(outputPath(page.name, width), 'docs/media/screens/' + page.name + '-' + width + '.png');
    assert.ok(manifest().includes('| [' + page.name + '-' + width + '.png]('));
    assert.ok(manifest().includes(page.route));
  }
  assert.equal(manifest(), manifest());
  assert.doesNotMatch(manifest(), /\d{4}-\d{2}-\d{2}|v\d+\.\d+|\d+\.\d+\.\d+/);
  for (const page of ['../escape', '/absolute', 'dashboard.png', 'unknown']) assert.throws(() => outputPath(page, 720), /Unknown screenshot/);
  for (const width of [0, 721, '360']) assert.throws(() => outputPath('dashboard', width), /Unknown screenshot/);
});

test('before/after report distinguishes added, changed, unchanged and removed files', () => {
  assert.deepEqual(changes(new Map([['same.png', 'a'], ['edit.png', 'b'], ['old.png', 'c']]), new Map([['same.png', 'a'], ['edit.png', 'd'], ['new.png', 'e']])), [
    {file: 'edit.png', status: 'changed'}, {file: 'new.png', status: 'added'},
    {file: 'old.png', status: 'removed'}, {file: 'same.png', status: 'unchanged'},
  ]);
});

test('an unavailable explicit browser fails plainly without searching other installations', async () => {
  await assert.rejects(findBrowser({LDA_SCREENSHOT_BROWSER: '/nonexistent-lda-screenshot-browser'}, process.platform), /No Chromium browser found.*LDA_SCREENSHOT_BROWSER/);
});

test('privacy checks reject literal usernames, normalized home paths and random suffixes without echoing them', () => {
  const identity = {username: 'ScreenshotPerson', home: 'C:\\Users\\ScreenshotPerson'};
  const temporary = resolve('lda-assets-screens-X7c9Qz');
  assert.doesNotThrow(() => assertSafeCaptureText('Configuration: D:/demo/tenants.json', temporary, identity));
  for (const [text, reason] of [
    ['Hello ScreenshotPerson', 'OS username'],
    ['c:/USERS/SCREENSHOTPERSON/data', 'home folder'],
    ['Folder X7c9Qz', 'temporary directory suffix'],
  ]) {
    assert.throws(() => assertSafeCaptureText(text, temporary, identity), error => {
      assert.equal(error.message, 'Screenshot privacy check failed: ' + reason);
      assert.ok(!error.message.includes(text));
      return true;
    });
  }
});

test('privacy reads rendered text and visible form values without changing the page', async () => {
  const calls = [];
  const cdp = {
    step(step) { calls.push(step); },
    evaluate(expression) {
      return runInNewContext(expression, {document: {
        body: {innerText: 'Made-up demo'},
        querySelectorAll(selector) {
          assert.equal(selector, 'input:not([type=hidden]), textarea, select');
          return [{value: 'X7c9Qz'}];
        },
      }});
    },
  };
  await assert.rejects(checkPagePrivacy(cdp, resolve('lda-assets-screens-X7c9Qz')), /temporary directory suffix/);
  assert.deepEqual(calls, ['evaluate: privacy']);
});

test('browser timezone and locale are fixed before navigation without injecting a clock', async () => {
  const commands = [];
  await configureBrowser({async send(method, params) { commands.push([method, params]); }});
  assert.deepEqual(commands, [
    ['Emulation.setTimezoneOverride', {timezoneId: 'UTC'}],
    ['Emulation.setLocaleOverride', {locale: 'en-US'}],
  ]);
});

test('independent demo datasets and real server pages repeat except for measured durations', async t => {
  const root = scratch(t);
  const directories = ['first', 'second'].map(name => join(root, name));
  for (const directory of directories) mkdirSync(directory);
  const demos = [];
  const stores = [];
  for (const directory of directories) {
    demos.push(await prepareDemo(directory));
    stores.push(readFileSync(join(directory, 'data', 'demo-library', 'assets.json'), 'utf8'));
  }
  assert.deepEqual(demos[0], demos[1]);
  assert.equal(stores[0], stores[1]);
  const state = JSON.parse(stores[0]);
  assert.equal(state.assets.length, 4);
  assert.ok(state.assets.every(asset => asset.createdAt === DEMO_TIME && asset.modifiedAt === DEMO_TIME));
  assert.equal(new Set([...state.assets, ...state.folders].map(entity => entity.id)).size, 6);
  for (const asset of state.assets) {
    assert.deepEqual(...directories.map(directory => readFileSync(join(directory, 'data', 'demo-library', 'files', asset.id + '.' + asset.ext))));
  }
  // Keep the same actual port between runs, without requiring the release port
  // to be free on a developer's machine when running unit tests.
  assert.equal(DEMO_PORT, 18083);
  let port = 0;
  const runs = [];
  for (let run = 0; run < 2; run++) {
    const {server, base, demo} = await openDemo(directories[0], demos[0], {port});
    port = server.address().port;
    try {
      const runtime = server.tenants.get(demo.tenant);
      assert.equal(runtime.log.recent.length, 1);
      assert.equal(runtime.log.recent[0].n, 1);
      assert.equal(runtime.log.recent[0].ts, DEMO_TIME);
      assert.ok(Number.isInteger(runtime.log.recent[0].ms) && runtime.log.recent[0].ms >= 0);
      // A configured clock must not replace the process clock.
      assert.notEqual(new Date().toISOString(), DEMO_TIME);
      // Occupied fixed ports fail; they never fall back to another real origin.
      await assert.rejects(openDemo(directories[1], demos[1], {port}), {code: 'EADDRINUSE'});
      const pages = [];
      for (const page of PAGES) {
        const url = base + pageRoute(page, demo);
        const response = await fetch(url, page.form ? {method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Accept: 'text/html', Connection: 'close'},
          body: new URLSearchParams({csrf: demo.csrf, ...page.form})} : {headers: {Connection: 'close'}});
        const html = await response.text();
        assert.equal(response.status, page.name === 'error' ? 400 : 200, page.name);
        if (page.name === 'dashboard') assert.ok(html.includes(join(directories[0], 'tenants.json')));
        // Remove only the invisible CSRF value and real elapsed-time fields in
        // this comparison. Actual captures always contain the untouched UI.
        pages.push(html.replace(/name="csrf" value="[a-f0-9]+"/g, 'name="csrf" value="TOKEN"')
          .replace(/\d+ms/g, 'DURATIONms').replace(/(&quot;ms&quot;: )\d+/g, '$1DURATION'));
      }
      runs.push(pages);
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
      });
    }
  }
  assert.deepEqual(runs[0], runs[1]);
});

const repoRoot = resolve(import.meta.dirname, '..');
const demoDirectory = join(repoRoot, '.test-runtime', 'screenshots-demo');
const browserEnv = {LDA_SCREENSHOT_BROWSER: process.execPath};
const checkoutIdentity = {username: '', home: ''};

test('checkout privacy rejects a demo configuration path under the home folder', {timeout: 20000}, async () => {
  assert.equal(existsSync(demoDirectory), false);
  await assert.rejects(screenshots({browserEnv, checkoutIdentity: {username: '', home: repoRoot}}),
    {message: 'Screenshot privacy check failed: home folder'});
  assert.equal(existsSync(demoDirectory), false);
});

test('a browser launch failure removes its browser scratch and actual demo directories', {timeout: 20000}, async () => {
  const removed = [];
  await assert.rejects(screenshots({browserEnv, checkoutIdentity, async removeDirectory(directory, options) {
    if (directory === demoDirectory) assert.ok(existsSync(join(directory, 'tenants.json')));
    await rm(directory, options);
    removed.push(directory);
  }}), {message: 'Chromium could not start in this environment'});
  assert.equal(removed.length, 2);
  assert.match(basename(removed[0]), /^lda-assets-screens-/);
  assert.equal(existsSync(removed[0]), false);
  assert.equal(removed[1], demoDirectory);
  assert.equal(existsSync(demoDirectory), false);
});

test('a browser scratch removal failure still removes demo data and signal handlers', {timeout: 20000}, async t => {
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'];
  const originalListeners = signals.map(signal => process.listeners(signal));
  const profileError = new Error('Simulated browser profile removal failure');
  await assert.rejects(screenshots({browserEnv, checkoutIdentity, async removeDirectory(directory, options) {
    if (directory === demoDirectory) {
      await rm(directory, options);
      return;
    }
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.match(basename(directory), /^lda-assets-screens-/);
    assert.ok(existsSync(join(demoDirectory, 'tenants.json')));
    t.after(() => rm(directory, options));
    throw profileError;
  }}), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0].message, 'Chromium could not start in this environment');
    assert.equal(error.errors[1], profileError);
    assert.match(error.message, /Simulated browser profile removal failure/);
    return true;
  });
  assert.equal(existsSync(demoDirectory), false);
  assert.deepEqual(signals.map(signal => process.listeners(signal)), originalListeners);
});

test('full-page readiness starts lazy image loads before decode and tolerates suspended frames', {timeout: 2000}, async () => {
  const url = 'http://localhost/tenants/demo-library';
  const steps = [];
  let decoded = 0;
  const images = Array.from({length: 3}, () => ({
    loading: 'lazy',
    decode() {
      assert.ok(images.every(image => image.loading === 'eager'), 'all lazy requests must start before any decode');
      if (this.loading !== 'eager') return new Promise(() => {});
      decoded++;
      return Promise.resolve();
    },
  }));
  const cdp = {
    step(step) { steps.push(step); },
    evaluate(expression) {
      return runInNewContext(expression, {
        location: {href: url},
        document: {readyState: 'complete', querySelector: () => ({}), fonts: {ready: Promise.resolve()}, images},
        requestAnimationFrame() {}, // No frame delivery from a background target.
        setTimeout, clearTimeout,
      });
    },
  };
  await waitReady(cdp, url);
  assert.equal(decoded, 3);
  assert.deepEqual(steps, ['navigate: document ready', 'evaluate: fonts', 'evaluate: images', 'evaluate: paint']);
});

class ScreenshotSocket extends EventTarget {
  readyState = WebSocket.OPEN;
  send(text) { this.command = JSON.parse(text); }
  reply(result) { this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({id: this.command.id, ...result})})); }
}

test('DevTools timeouts retain page, width and step, and debug logs each step', async () => {
  const logs = [];
  const socket = new ScreenshotSocket();
  const cdp = new DevTools(socket, {timeout: 10, debug: true, log: line => logs.push(line)});
  cdp.step('evaluate: images', 'instance', 720);
  const pending = cdp.evaluate('pendingPromise');
  cdp.step('capture: PNG', 'request', 360);
  await assert.rejects(pending, /instance @ 720px \[evaluate: images\]: DevTools timed out: Runtime.evaluate/);
  assert.equal(cdp.pending.size, 0);
  assert.deepEqual(logs, ['[screenshots] browser @ n/a [setup]', '[screenshots] instance @ 720px [evaluate: images]', '[screenshots] request @ 360px [capture: PNG]']);
});

test('DevTools protocol, evaluation and disconnect errors include the capture context', async () => {
  for (const kind of ['protocol', 'evaluation', 'disconnect', 'closed', 'send']) {
    const socket = new ScreenshotSocket();
    const logs = [];
    const cdp = new DevTools(socket, {debug: false, log: line => logs.push(line)});
    cdp.step('evaluate: verify capture', 'instance', 360);
    if (kind === 'closed') socket.readyState = WebSocket.CLOSED;
    if (kind === 'send') socket.send = () => { throw new Error('send failed'); };
    const pending = cdp.evaluate('true');
    if (kind === 'protocol') socket.reply({error: {message: 'protocol failed'}});
    if (kind === 'evaluation') socket.reply({result: {exceptionDetails: {text: 'evaluation failed'}}});
    if (kind === 'disconnect') socket.dispatchEvent(new Event('close'));
    await assert.rejects(pending, /instance @ 360px \[evaluate: verify capture\]:/);
    assert.equal(cdp.pending.size, 0);
    assert.deepEqual(logs, []);
  }
});
