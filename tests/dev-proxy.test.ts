import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApp } from '../server/app.js';

test(
  'real Vite proxy permits same-origin guest bootstrap and still rejects a foreign origin',
  { timeout: 30000 },
  async () => {
    await mkdir(resolve('artifacts'), { recursive: true });
    const directory = await mkdtemp(resolve('artifacts', 'dev-proxy-test-'));
    const app = await createApp({ dataDir: directory, serveClient: false });
    let vite;
    const savedPort = process.env.PORT;
    try {
      await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
      const address = app.server.address();
      assert.ok(address && typeof address !== 'string');
      process.env.PORT = String(address.port);
      vite = await createViteServer({
        configFile: resolve('vite.config.ts'),
        logLevel: 'silent',
        server: { port: 0, strictPort: true, preTransformRequests: false },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      await vite.listen();
      const web = vite.httpServer!.address();
      assert.ok(web && typeof web !== 'string');
      const origin = `http://127.0.0.1:${web.port}`;
      const request = (requestOrigin: string, context: string) =>
        fetch(origin + '/api/auth/window', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: requestOrigin,
            'Sec-Fetch-Site': 'same-origin',
          },
          body: JSON.stringify({ context }),
        });
      const allowed = await request(origin, 'tab-proxy-test');
      assert.equal(allowed.status, 200);
      assert.deepEqual(await allowed.json(), { ok: true });
      const denied = await request('https://foreign.example.invalid', 'tab-foreign-test');
      assert.equal(denied.status, 403);
      assert.match((await denied.json()).error, /Cross-site requests/);
    } finally {
      if (savedPort === undefined) delete process.env.PORT;
      else process.env.PORT = savedPort;
      await vite?.close();
      await app.close();
      const target = resolve(directory);
      assert.ok(target.startsWith(resolve('artifacts') + sep));
      assert.ok(target.split(sep).at(-1)!.startsWith('dev-proxy-test-'));
      await rm(target, { recursive: true, force: true });
    }
  },
);
