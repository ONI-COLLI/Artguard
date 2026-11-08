import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../dist/server/server/app.js';

// Exercise the compiled server and actual Vite output, using a disposable database.
let app, base, directory;
const clientDirectory = resolve('dist/client');
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'deployment-test-'));
  await writeFile(join(directory, 'private-sentinel.txt'), 'private deployment fixture');
  app = await createApp({ dataDir: directory, serveClient: true });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await app?.close();
  if (directory) {
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve('artifacts') + sep));
    await rm(target, { recursive: true, force: true });
  }
});

test('production HTML references the built entry point and sends working browser security headers', async () => {
  const response = await fetch(base + '/?window=demo-window');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();
  assert.ok(html.includes('<div id="root"></div>'));
  assert.match(html, /type="module"[^>]+src="\/assets\/[^\"]+\.js"/);
  assert.doesNotMatch(html, /\/src\/main\.tsx/);
});

test('every production asset, including lazy page chunks, is served intact with the correct content type', async () => {
  const assets = await readdir(join(clientDirectory, 'assets'));
  assert.ok(assets.length > 10);
  for (const name of assets) {
    const response = await fetch(base + '/assets/' + encodeURIComponent(name));
    assert.equal(response.status, 200, name);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      await readFile(join(clientDirectory, 'assets', name)),
      name,
    );
    if (name.endsWith('.js'))
      assert.match(response.headers.get('content-type'), /javascript/, name);
    if (name.endsWith('.css'))
      assert.match(response.headers.get('content-type'), /text\/css/, name);
  }
});

test('compiled public API starts without an account and keeps private routes protected', async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, storage: 'sqlite', blockchain: 'local-evm' });
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.user, null);
  assert.deepEqual(state.artworks, []);
  const home = await fetch(base + '/api/home');
  assert.equal(home.status, 200);
  for (const route of ['/api/admin/accounting', '/api/admin/blockchain-demo']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 401, route);
    assert.match(response.headers.get('content-type'), /application\/json/);
  }
});

test('missing assets and API endpoints return 404 without exposing local files or an HTML success page', async () => {
  for (const route of [
    '/assets/missing.js',
    '/api/missing',
    '/.env',
    '/data/artguard.sqlite',
    '/data/chain/state.json',
    '/private-sentinel.txt',
    '/server/index.ts',
    '/package.json',
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404, route);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.doesNotMatch(await response.text(), /private deployment fixture|<!doctype html>/i);
  }
});

test('malformed JSON and cross-site requests fail cleanly while the compiled server remains available', async () => {
  const malformed = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  });
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers.get('content-type'), /application\/json/);
  const denied = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    body: '{}',
  });
  assert.equal(denied.status, 403);
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal(app.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
});
