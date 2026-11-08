import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { LEGAL_VERSION } from '../shared/legal.ts';
import { financialReport, serviceEarned } from '../server/finance.ts';
import { termsSnapshot } from '../shared/blockchain.ts';
let app, base, directory, repo, artwork, image;
function actor() {
  let cookie = '';
  return {
    id: '',
    async request(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') {
      const r = await fetch(base + '/api' + path, {
        method,
        headers: {
          Cookie: cookie,
          ...(data && !(data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
      });
      if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0];
      const contentType = r.headers.get('content-type') || '';
      const content = contentType.includes('json')
        ? await r.json()
        : contentType.startsWith('image/')
          ? Buffer.from(await r.arrayBuffer())
          : await r.text();
      return { status: r.status, data: content, headers: r.headers };
    },
  };
}
const alice = actor(),
  bob = actor(),
  manager = actor(),
  admin = actor(),
  guest = actor();
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'prototype-review-'));
  app = await createApp({ dataDir: directory, serveClient: false });
  repo = new Repository(app.db);
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + app.server.address().port;
  for (const [i, a] of [alice, bob, manager, admin].entries()) {
    const r = await a.request('/auth/register', {
      name: 'Private name ' + i,
      email: 'review-' + i + '@example.invalid',
      password: 'Prototype!2026',
      legalAccepted: true,
      legalVersion: LEGAL_VERSION,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    a.id = r.data.user.id;
    repo.run(
      'INSERT INTO email_verifications VALUES(?,?,?)',
      a.id,
      r.data.user.email,
      new Date().toISOString(),
    );
  }
  repo.run('INSERT INTO manager_accounts VALUES(?,?)', manager.id, new Date().toISOString());
  repo.run('INSERT INTO admin_accounts VALUES(?,?)', admin.id, new Date().toISOString());
  image = await sharp({ create: { width: 1400, height: 1000, channels: 3, background: '#ae7755' } })
    .png()
    .toBuffer();
  const form = new FormData();
  for (const [k, v] of Object.entries({
    title: 'Protected source',
    description: 'An original synthetic image for privacy tests.',
    category: 'Illustration',
    price: '20',
    status: 'published',
    rights: 'true',
    licenses: 'personal',
  }))
    form.append(k, v);
  form.append('file', new Blob([image], { type: 'image/png' }), 'source.png');
  const upload = await alice.request('/artworks', form);
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  artwork = upload.data.artwork;
});
after(async () => {
  await app?.close();
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
test('registration requires affirmative consent to the current document version', async () => {
  for (const extra of [
    {},
    { legalAccepted: false, legalVersion: LEGAL_VERSION },
    { legalAccepted: true, legalVersion: 'old' },
  ]) {
    const r = await guest.request('/auth/register', {
      name: 'No consent',
      email: randomUUID() + '@example.invalid',
      password: 'Prototype!2026',
      ...extra,
    });
    assert.equal(r.status, 400);
  }
  assert.equal(repo.one('SELECT count(*) n FROM privacy_consents').n, 4);
});
test('public attribution uses a separate alias and frozen new terms are detailed without altering legacy snapshots', async () => {
  const before = (await bob.request('/state')).data.artworks.find((a) => a.id === artwork.id);
  assert.match(before.author, /^Creator /);
  assert.ok(!JSON.stringify(before).includes('Private name'));
  assert.equal(
    (await alice.request('/privacy/profile', { alias: 'Studio Test' }, 'PATCH')).status,
    200,
  );
  assert.equal(
    (await bob.request('/state')).data.artworks.find((a) => a.id === artwork.id).author,
    'Studio Test',
  );
  const terms = JSON.parse(termsSnapshot(artwork));
  assert.equal(terms.version, 2);
  assert.equal(terms.territory, 'Kazakhstan');
  assert.match(terms.licenses[0].terms, /non-transferable/);
  assert.equal(JSON.parse(termsSnapshot({ licenses: ['personal'] })).version, 1);
});
test('public media is reduced and watermarked; original endpoint stays protected', async () => {
  const r = await fetch(base + '/media/' + artwork.id);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type')!, /image\/webp/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.notDeepEqual(bytes, image);
  const meta = await sharp(bytes).metadata();
  assert.ok(meta.width! <= 960);
  assert.ok(meta.height! <= 720);
  assert.equal((await bob.request('/artworks/' + artwork.id + '/download')).status, 403);
  assert.deepEqual((await alice.request('/artworks/' + artwork.id + '/download')).data, image);
});
test('withdrawing consent blocks new work, retains old records and can be reversed explicitly', async () => {
  const count = repo.one('SELECT count(*) n FROM privacy_consents WHERE user_id=?', bob.id).n;
  assert.equal((await bob.request('/privacy/withdraw', { confirm: true })).status, 200);
  assert.equal(
    (
      await bob.request('/blockchain/checkouts', {
        items: [{ artworkId: artwork.id, license: 'personal' }],
      })
    ).status,
    403,
  );
  assert.equal((await bob.request('/privacy')).data.accepted, false);
  assert.equal((await bob.request('/state')).status, 200);
  assert.equal(
    (await bob.request('/privacy/consents', { accepted: true, version: LEGAL_VERSION })).status,
    200,
  );
  assert.equal((await bob.request('/privacy')).data.accepted, true);
  assert.equal(
    repo.one('SELECT count(*) n FROM privacy_consents WHERE user_id=?', bob.id).n,
    count + 1,
  );
});
test('private exports and requests exclude credentials and cannot be read by another account or a manager', async () => {
  const exported = await alice.request('/privacy/export');
  assert.equal(exported.status, 200);
  assert.ok(!JSON.stringify(exported.data).includes('password_hash'));
  assert.doesNotMatch(
    JSON.stringify(exported.data),
    /"(password_hash|sessions|token_hash|private_keys)"\s*:/,
  );
  assert.equal((await guest.request('/privacy/export')).status, 401);
  const r = await alice.request('/privacy/requests', {
    kind: 'deletion',
    message: 'Please review deletion of my fictional account.',
  });
  assert.equal(r.status, 201);
  assert.equal((await bob.request('/privacy')).data.requests.length, 0);
  assert.equal((await manager.request('/admin/privacy')).status, 403);
  assert.equal(
    (
      await admin.request(
        '/admin/privacy/requests/' + r.data.id,
        {
          status: 'answered',
          response:
            'Request reviewed. No erasure has been performed; awaiting resolution of retained records.',
        },
        'PATCH',
      )
    ).status,
    200,
  );
  assert.equal((await alice.request('/privacy')).data.requests[0].status, 'answered');
});
test('operating expenses have manager-only access, exact decimal amounts, retry protection and retained void history', async () => {
  const expense = {
    id: randomUUID(),
    category: 'hosting',
    amount: '10.05',
    occurredOn: '2026-11-08',
    note: 'Synthetic hosting cost',
  };
  assert.equal((await alice.request('/manager/finance/expenses', expense)).status, 403);
  assert.equal((await admin.request('/manager/finance/expenses', expense)).status, 403);
  assert.equal((await manager.request('/manager/finance/expenses', expense)).status, 201);
  assert.equal((await manager.request('/manager/finance/expenses', expense)).status, 200);
  assert.equal(
    (await manager.request('/manager/finance/expenses', { ...expense, amount: '11' })).status,
    409,
  );
  const report = (await manager.request('/manager/finance?from=2026-11-01&to=2026-11-30')).data;
  assert.equal(report.operatingCostsCents, '1005');
  assert.equal(report.profitCents, '-1005');
  assert.equal(
    (await manager.request('/manager/finance?from=2026-11-30&to=2026-11-01')).status,
    400,
  );
  assert.equal(
    (
      await manager.request('/manager/finance/expenses/' + expense.id + '/void', {
        reason: 'Entry was entered for the wrong demonstration period.',
      })
    ).status,
    200,
  );
  const after = (await manager.request('/manager/finance?from=2026-11-01&to=2026-11-30')).data;
  assert.equal(after.operatingCostsCents, '0');
  assert.ok(after.expenses[0].voided_at);
});
test('service revenue accrues exactly across periods and preserves deferred receipts', () => {
  const start = Date.parse('2026-11-01T00:00:00+05:00'),
    duration = 30 * 86400000;
  assert.equal(serviceEarned(1000n, start, duration, start, start + duration / 2), 500n);
  assert.equal(serviceEarned(1000n, start, duration, start + duration / 2, start + duration), 500n);
  assert.equal(serviceEarned(1000n, start, duration, start - duration, start), 0n);
  repo.run(
    'INSERT INTO accounting_events(id,source_key,kind,currency,buyer_id,title,gross,fee,net,allocations_json,occurred_at,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    randomUUID(),
    'review-subscription',
    'subscription',
    'local_usd',
    alice.id,
    '30 day subscription',
    '1000',
    '1000',
    '0',
    '[]',
    new Date(start).toISOString(),
    new Date(start).toISOString(),
  );
  const first = financialReport(repo, { from: '2026-11-01', to: '2026-11-15' }),
    second = financialReport(repo, { from: '2026-11-16', to: '2026-11-30' });
  assert.equal(first.cashRevenueCents, '1000');
  assert.equal(first.earnedRevenueCents, '500');
  assert.equal(first.deferredServiceCents, '500');
  assert.equal(second.cashRevenueCents, '0');
  assert.equal(second.earnedRevenueCents, '500');
  assert.equal(second.deferredServiceCents, '0');
});
