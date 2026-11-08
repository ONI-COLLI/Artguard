import { withLegalFixture } from './fixtures.ts';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { recordPurchase, trackWallet } from '../server/accounting-records.ts';
import { verifiedFixture, approvedProjectFixture } from './fixtures.ts';
let directory, app, base, product, purchase, adminId, creatorId, buyerId, coauthorId;
function client() {
  let cookie = '';
  return {
    async request(route, data, method = data === undefined ? 'GET' : 'POST') {
      const response = await fetch(base + '/api' + route, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data && !(data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          data === undefined
            ? undefined
            : data instanceof FormData
              ? data
              : JSON.stringify(withLegalFixture(data)),
      });
      if (response.headers.has('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return {
        status: response.status,
        headers: response.headers,
        data: response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : await response.text(),
      };
    },
  };
}
const admin = client(),
  creator = client(),
  buyer = client(),
  coauthor = client(),
  guest = client(),
  unverified = client();
async function start() {
  app = await createApp({ dataDir: directory, serveClient: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
}
async function register(actor, name, verified = true) {
  const result = await actor.request('/auth/register', {
    name,
    email: name.toLowerCase() + '@accounting.test',
    password: 'accounting-test-password',
  });
  assert.equal(result.status, 201);
  if (verified) verifiedFixture(app.db, result.data.user);
  return result.data.user.id;
}
async function upload(suffix) {
  const f = new FormData();
  f.append(
    'file',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1MAAAAASUVORK5CYII=',
          'base64',
        ),
        Buffer.from(suffix),
      ],
      { type: 'image/png' },
    ),
    'synthetic.png',
  );
  for (const [k, v] of Object.entries({
    title: 'Accounting ' + suffix,
    description: 'A synthetic product for accounting integration tests.',
    category: 'Illustration',
    price: '12',
    licenses: 'personal',
    rights: 'true',
  }))
    f.append(k, v);
  const r = await creator.request('/artworks', f);
  assert.equal(r.status, 201);
  return r.data.artwork;
}
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'accounting-test-'));
  await start();
  adminId = await register(admin, 'Administrator');
  creatorId = await register(creator, 'Creator');
  buyerId = await register(buyer, 'Buyer');
  coauthorId = await register(coauthor, 'Coauthor');
  await register(unverified, 'Unverified', false);
  app.db.prepare('INSERT INTO manager_accounts VALUES(?,?)').run(adminId, new Date().toISOString());
});
after(async () => {
  await app?.close();
  assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
  await rm(directory, { recursive: true, force: true });
});
test('financial database, exports and synchronization require a verified manager', async () => {
  for (const actor of [guest, buyer, unverified])
    for (const [path, data] of [
      ['/admin/accounting', undefined],
      ['/admin/accounting/export', undefined],
      ['/admin/accounting/sync', {}],
    ])
      assert.equal((await actor.request(path, data)).status, actor === guest ? 401 : 403);
  assert.equal((await admin.request('/admin/accounting')).status, 200);
  assert.equal((await admin.request('/admin/accounting?page=0')).status, 400);
  assert.equal(
    (await admin.request('/admin/accounting?view=users&q=Creator')).data.items[0].id,
    creatorId,
  );
  assert.equal((await admin.request('/admin/accounting?view=users&page=2')).data.items.length, 0);
});
test('every local sale records exact fee and creator/co-author credits, stable IDs and immutable snapshots', async () => {
  product = await upload('original');
  const wallet = '0x2222222222222222222222222222222222222222',
    repo = new Repository(app.db);
  app.db
    .prepare('INSERT INTO wallets VALUES(?,?,?)')
    .run(coauthorId, wallet, new Date().toISOString());
  trackWallet(repo, coauthorId);
  await creator.request(
    '/artworks/' + product.id,
    { recipients: [{ name: 'Coauthor', wallet, percent: 25 }] },
    'PATCH',
  );
  approvedProjectFixture(app.db, product.id);
  trackWallet(repo, creatorId);
  const order = await buyer.request('/purchases', {
    items: [{ artworkId: product.id, license: 'personal' }],
  });
  assert.equal(order.status, 201);
  purchase = order.data.purchases.find((p) => p.artworkId === product.id);
  const summary = (await admin.request('/admin/accounting')).data;
  assert.deepEqual(summary.totals.local_usd, {
    sales: 1,
    gross: '1200',
    commission: '120',
    creatorNet: '810',
    coauthorNet: '270',
    subscriptions: '0',
    promotions: '0',
    platformRevenue: '120',
  });
  assert.equal(summary.totals.test_eth.gross, '0');
  assert.equal(summary.counts.soldProducts, 1);
  const events = (await admin.request('/admin/accounting?view=events')).data.items;
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.purchaseId, purchase.id);
  assert.equal(event.artworkId, product.id);
  assert.equal(event.buyerId, buyerId);
  assert.equal(event.sellerId, creatorId);
  assert.equal(event.allocations[1].userId, coauthorId);
  assert.equal(event.allocations[1].amount, '270');
  assert.notEqual(event.id, purchase.id);
  recordPurchase(repo, purchase.id);
  assert.equal(app.db.prepare('SELECT count(*) n FROM accounting_events').get().n, 1);
  await creator.request(
    '/artworks/' + product.id,
    { title: 'Changed after sale', price: 33 },
    'PATCH',
  );
  assert.equal(
    (await admin.request('/admin/accounting?view=events')).data.items[0].title,
    'Accounting original',
  );
  assert.equal(
    (await admin.request('/admin/accounting?view=products&q=' + product.id)).data.items[0].title,
    'Changed after sale',
  );
  assert.throws(
    () => app.db.prepare('UPDATE accounting_events SET gross=? WHERE id=?').run('1', event.id),
    /immutable/,
  );
  assert.throws(
    () => app.db.prepare('DELETE FROM accounting_events WHERE id=?').run(event.id),
    /immutable/,
  );
  const user = (await admin.request('/admin/accounting?view=users&q=' + coauthorId)).data.items[0];
  assert.equal(user.earned.local_usd, '270');
  assert.equal(user.balance, null);
});
test('unsold deleted products remain archived and wallet unlinking retains address ownership intervals', async () => {
  const target = await upload('delete-me');
  await creator.request('/artworks/' + target.id, { price: 19 }, 'PATCH');
  assert.equal((await creator.request('/artworks/' + target.id, undefined, 'DELETE')).status, 200);
  const archived = (await admin.request('/admin/accounting?view=products&status=deleted')).data
    .items[0];
  assert.equal(archived.id, target.id);
  assert.equal(archived.priceCents, 1900);
  assert.ok(archived.deletedAt);
  assert.deepEqual(
    app.db
      .prepare('SELECT action FROM product_history WHERE artwork_id=? ORDER BY rowid')
      .all(target.id)
      .map((r) => r.action),
    ['created', 'updated', 'deleted'],
  );
  assert.equal((await coauthor.request('/wallet', undefined, 'DELETE')).status, 200);
  const row = (await admin.request('/admin/accounting?view=users&q=' + coauthorId)).data.items[0];
  assert.equal(row.wallet, null);
  assert.equal(row.walletHistory.length, 1);
  assert.ok(row.walletHistory[0].unlinkedAt);
  assert.equal(row.earned.local_usd, '270');
});
test('journal failure rolls back the license together with its financial record', async (t) => {
  t.mock.method(console, 'error', () => {});
  const target = await upload('rollback');
  app.db.exec(
    "CREATE TRIGGER fail_accounting BEFORE INSERT ON accounting_events WHEN NEW.title='Accounting rollback' BEGIN SELECT RAISE(ABORT,'Synthetic accounting failure'); END;",
  );
  assert.equal(
    (await buyer.request('/purchases', { items: [{ artworkId: target.id, license: 'personal' }] }))
      .status,
    500,
  );
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM purchases WHERE artwork_id=?').get(target.id).n,
    0,
  );
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM accounting_events WHERE artwork_id=?').get(target.id).n,
    0,
  );
  app.db.exec('DROP TRIGGER fail_accounting');
  assert.equal(
    (await buyer.request('/purchases', { items: [{ artworkId: target.id, license: 'personal' }] }))
      .status,
    201,
  );
});
test('exports omit credentials, retain all record IDs and restarts do not duplicate imported events', async () => {
  const before = (await admin.request('/admin/accounting/export')).data;
  assert.match(before.units.local_usd, /simulated/);
  assert.ok(before.events.every((e) => e.id && e.purchaseId && e.allocations.every((a) => a.id)));
  assert.equal(JSON.stringify(before).includes('password_hash'), false);
  assert.equal(JSON.stringify(before).includes('account_tokens'), false);
  assert.equal(JSON.stringify(before).includes('accounting-test-password'), false);
  const count = app.db.prepare('SELECT count(*) n FROM product_history').get().n;
  await app.close();
  await start();
  const after = (await admin.request('/admin/accounting/export')).data;
  assert.deepEqual(after.events.map((e) => e.id).sort(), before.events.map((e) => e.id).sort());
  assert.equal(app.db.prepare('SELECT count(*) n FROM product_history').get().n, count);
  assert.equal((await admin.request('/admin/accounting/sync', {})).status, 503);
  assert.equal((await admin.request('/admin/accounting')).data.balanceSnapshot, null);
});
