import { withLegalFixture } from './fixtures.ts';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { inflateRawSync } from 'node:zlib';
import { sourceZip } from '../scripts/source-archive.mjs';

process.env.PUBLIC_ORIGIN = 'https://review.artguard.example';
process.env.ARTGUARD_PUBLIC_DEMO = 'true';
process.env.COOKIE_SECURE = 'true';
const { createApp } = await import('../server/app.ts');
const { Repository } = await import('../server/repository.ts');
let app, base, directory, repo, rpc;
const publicHost = 'review.artguard.example';
function actor() {
  let cookie = '';
  return {
    id: '',
    email: '',
    async request(path, data?, method = data === undefined ? 'GET' : 'POST', headers = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Host: publicHost,
          Origin: 'https://' + publicHost,
          Cookie: cookie,
          ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: data === undefined ? undefined : JSON.stringify(withLegalFixture(data)),
      });
      if (response.headers.has('set-cookie'))
        cookie = response.headers.get('set-cookie')!.split(';')[0];
      return {
        status: response.status,
        headers: response.headers,
        data: response.headers.get('content-type')?.includes('json')
          ? await response.json()
          : await response.text(),
      };
    },
  };
}
const alice = actor(),
  bob = actor(),
  guest = actor();
const bytes = Buffer.from('export const fixture = true;\n'),
  archive = sourceZip([{ path: 'server/fixture.ts', bytes }]);
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'public-hosting-test-'));
  await mkdir(join(directory, 'source/server'), { recursive: true });
  await writeFile(join(directory, 'source/server/fixture.ts'), bytes);
  await writeFile(join(directory, 'source.zip'), archive);
  process.env.ARTGUARD_SOURCE_MANIFEST = join(directory, 'manifest.private.json');
  await writeFile(
    process.env.ARTGUARD_SOURCE_MANIFEST,
    JSON.stringify({
      directory: join(directory, 'source'),
      archive: join(directory, 'source.zip'),
      revision: 'fixture-revision',
      createdAt: new Date().toISOString(),
      archiveSha256: createHash('sha256').update(archive).digest('hex'),
      scope: 'test source',
      files: [
        {
          path: 'server/fixture.ts',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.length,
        },
      ],
    }),
  );
  rpc = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const c = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: c.id, result: '0x7a69' }));
    });
  });
  await new Promise<void>((done) => rpc.listen(0, '127.0.0.1', done));
  const chain = {
    rpcUrl: 'http://127.0.0.1:' + rpc.address().port,
    client: {},
    status: async () => ({ ready: false }),
    requireReady: async () => ({ address: '0x' + '1'.repeat(40) }),
    marketplaceStatus: async () => ({ contracts: [] }),
  };
  app = await createApp({ dataDir: directory, serveClient: false, blockchain: chain as any });
  repo = new Repository(app.db);
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + app.server.address().port;
  for (const [i, a] of [alice, bob].entries()) {
    a.email = 'public-' + i + '@example.invalid';
    const result = await a.request('/api/auth/register', {
      name: 'Public Tester ' + i,
      email: a.email,
      password: 'PublicTest!2026',
    });
    assert.equal(result.status, 201);
    a.id = result.data.user.id;
  }
});
after(async () => {
  await app?.close();
  if (rpc) await new Promise<void>((done) => rpc.close(() => done()));
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
    await rm(directory, { recursive: true, force: true });
  }
  for (const key of [
    'PUBLIC_ORIGIN',
    'ARTGUARD_PUBLIC_DEMO',
    'COOKIE_SECURE',
    'ARTGUARD_SOURCE_MANIFEST',
  ])
    delete process.env[key];
});
test('configured public host works while arbitrary Host and cross-origin cookie writes fail', async () => {
  assert.equal((await guest.request('/api/health')).status, 200);
  // Node fetch normalizes Host to its destination; use raw HTTP for virtual-host validation.
  const statusForHost = (host: string) =>
    new Promise<number | undefined>((done, reject) => {
      const r = request(base + '/api/health', { headers: { Host: host } }, (response) => {
        response.resume();
        done(response.statusCode);
      });
      r.on('error', reject);
      r.end();
    });
  assert.equal(await statusForHost(publicHost), 200);
  assert.equal(await statusForHost('evil.example'), 403);
  assert.equal(
    (await guest.request('/api/auth/login', {}, 'POST', { Origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await guest.request('/api/auth/login', {}, 'POST', { 'Sec-Fetch-Site': 'cross-site' })).status,
    403,
  );
});
test('public registration issues Secure HttpOnly SameSite cookies and persists the public flag', async () => {
  const a = actor(),
    r = await a.request('/api/auth/login', { email: alice.email, password: 'PublicTest!2026' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie')!, /; Secure/);
  assert.match(r.headers.get('set-cookie')!, /; HttpOnly/);
  assert.match(r.headers.get('set-cookie')!, /SameSite=Strict/i);
  assert.equal(r.data.publicDemo, true);
  assert.equal((await a.request('/api/state')).data.publicDemo, true);
});
test('private demo mail belongs only to the current authenticated account and uses the HTTPS origin', async () => {
  assert.equal((await guest.request('/api/auth/demo-mail')).status, 401);
  const a = (await alice.request('/api/auth/demo-mail')).data,
    b = (await bob.request('/api/auth/demo-mail')).data;
  assert.equal(a.messages.length, 1);
  assert.equal(b.messages.length, 1);
  assert.match(
    a.messages[0].links[0],
    /^https:\/\/review\.artguard\.example\/#\/verify-email\?token=/,
  );
  assert.notEqual(a.messages[0].links[0], b.messages[0].links[0]);
  assert.ok(!JSON.stringify(a).includes(b.messages[0].links[0]));
});
test('funded test wallet allocation requires a signed-in verified account', async () => {
  assert.equal((await guest.request('/api/demo/wallet/provision', {})).status, 401);
  assert.equal((await alice.request('/api/demo/wallet/provision', {})).status, 403);
});
test('staff are absent from public personas and the shared identities cannot be edited', async () => {
  repo.run('INSERT INTO platform_meta VALUES(?,?)', 'demo_account:creator', alice.id);
  const r = await guest.request('/api/demo/profiles');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.data.profiles.map((p) => p.key),
    ['creator', 'buyer', 'coauthor'],
  );
  assert.equal(
    (
      await alice.request(
        '/api/profile',
        { name: 'Hijack', email: 'hijack@example.invalid' },
        'PATCH',
      )
    ).status,
    403,
  );
  assert.equal((await alice.request('/api/wallet', undefined, 'DELETE')).status, 403);
});
test('source index and allowlisted raw text are public and carry checksums', async () => {
  const page = await guest.request('/code');
  assert.equal(page.status, 200);
  assert.match(page.data, /server\/fixture.ts/);
  const raw = await guest.request('/source/server/fixture.ts');
  assert.equal(raw.data, bytes.toString());
  assert.equal(
    raw.headers.get('x-source-sha256'),
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
});
test('source metadata excludes filesystem paths and unlisted secret paths are never served', async () => {
  const manifest = await guest.request('/source-manifest.json');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.data.directory, undefined);
  assert.equal(manifest.data.archive, '/downloads/artguard-source.zip');
  assert.ok(!JSON.stringify(manifest.data).includes(directory));
  for (const path of [
    '/source/.env',
    '/source/runtime/public-demo/chain/accounts.private.json',
    '/source/server/../manifest.private.json',
    '/source/server/fixture.ts/extra',
  ])
    assert.equal((await guest.request(path)).status, 404, path);
});
test('downloaded ZIP is intact and decompresses to the published source bytes', async () => {
  const r = await fetch(base + '/downloads/artguard-source.zip', { headers: { Host: publicHost } });
  assert.equal(r.status, 200);
  const zip = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(zip, archive);
  assert.match(r.headers.get('content-disposition')!, /attachment/);
  const size = zip.readUInt32LE(18),
    offset = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
  assert.deepEqual(inflateRawSync(zip.subarray(offset, offset + size)), bytes);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
test('agents can read the entry point and RPC supports CORS reads without cookie authority', async () => {
  assert.equal((await guest.request('/llms.txt')).status, 200);
  const r = await guest.request(
    '/rpc',
    { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 },
    'POST',
    { Origin: 'https://external-agent.example' },
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.result, '0x7a69');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal((await guest.request('/rpc', undefined, 'OPTIONS')).status, 204);
});
test('unlocked signing, node controls, unknown RPC methods and malformed signed transactions fail', async () => {
  for (const method of [
    'eth_sendTransaction',
    'eth_accounts',
    'personal_sign',
    'anvil_setBalance',
    'evm_increaseTime',
  ])
    assert.equal((await guest.request('/rpc', { method, params: [], id: 1 })).status, 403, method);
  assert.equal(
    (
      await guest.request('/rpc', {
        method: 'eth_sendRawTransaction',
        params: ['0xdeadbeef'],
        id: 1,
      })
    ).status,
    400,
  );
});
