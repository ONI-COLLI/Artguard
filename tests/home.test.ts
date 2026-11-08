import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { homeSummary } from '../server/home.ts';
import { approvedProjectFixture } from './fixtures.ts';

let directory, app, repo, base;
const time = '2026-10-21T12:00:00.000Z';
const owner = 'home-owner';
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'home-test-'));
  app = await createApp({ dataDir: directory, serveClient: false });
  repo = new Repository(app.db);
  repo.run(
    'INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
    owner,
    'Private creator',
    'private@home.test',
    'private-password-hash',
    time,
  );
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await app?.close();
  assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
  await rm(directory, { recursive: true, force: true });
});
function event({
  id = randomUUID(),
  kind = 'sale',
  currency = 'test_eth',
  gross = '12000000000000001',
  hash = '0xABC',
  instance = '0xDEF',
} = {}) {
  const table = kind === 'promotion' ? 'promotion_accounting_events' : 'accounting_events';
  repo.run(
    `INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    id,
    kind,
    currency,
    owner,
    owner,
    'historical-project',
    'Private purchase',
    'personal',
    randomUUID(),
    gross,
    '0',
    gross,
    '[]',
    'private-buyer-wallet',
    'private-seller-wallet',
    hash,
    'private-contract',
    instance,
    time,
    time,
  );
  return id;
}
test('starts at zero and excludes simulated, prepared, pending and failed payments', () => {
  assert.equal(homeSummary(repo).completedTransactions, 0);
  for (const status of ['prepared', 'pending', 'failed']) {
    repo.run(
      'INSERT INTO chain_checkouts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      randomUUID(),
      owner,
      'private-wallet',
      'instance',
      'contract',
      status,
      9999999999,
      status === 'prepared' ? null : status,
      null,
      null,
      '9999999999999999999',
      null,
      time,
    );
  }
  event({ currency: 'local_usd', gross: '1200', hash: null, instance: null });
  const summary = homeSummary(repo);
  assert.equal(summary.completedTransactions, 0);
  assert.equal(summary.licensesIssued, 0);
  assert.equal(summary.licenseVolumeWei, '0');
});
test('counts a multi-license transaction once, includes service payments, and sums sales with exact integers', () => {
  const local = event({ currency: 'local_usd', gross: '1200', hash: null, instance: null });
  const chain = event();
  repo.run('INSERT INTO accounting_supersessions VALUES(?,?)', local, chain);
  event({ hash: '0xabc', instance: '0xdef' });
  event({ kind: 'subscription', hash: '0xSUB', gross: '10000000000000000' });
  event({ kind: 'promotion', hash: '0xPROMO', gross: '5000000000000000' });
  event({ instance: 'different-instance', gross: '900719925474099312345' });
  const summary = homeSummary(repo);
  assert.equal(summary.completedTransactions, 4);
  assert.equal(summary.licensesIssued, 3);
  assert.equal(summary.licenseVolumeWei, String(12000000000000001n * 2n + 900719925474099312345n));
});
test('lists only publicly available projects and returns the same safe summary to guests and accounts', async () => {
  const before = homeSummary(repo).projectsAvailable;
  for (const id of ['available', 'draft', 'hidden', 'unapproved']) {
    repo.run(
      'INSERT INTO artworks(id,owner_id,title,description,category,price,licenses,status,mime,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id,
      owner,
      id,
      'Public description',
      'Illustration',
      1200,
      '["personal"]',
      id === 'draft' ? 'draft' : 'published',
      'image/png',
      id,
      `2099-10-${id === 'available' ? '01' : '21'}T12:00:00.000Z`,
    );
  }
  repo.run(
    'INSERT INTO artwork_moderation VALUES(?,?,?,?,?)',
    'hidden',
    1,
    'Private report',
    owner,
    time,
  );
  repo.setArtworkRecipients('unapproved', [
    {
      name: 'Private co-author',
      percent: 25,
      wallet: '0x1111111111111111111111111111111111111111',
    },
  ]);
  const response = await fetch(base + '/api/home');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const guest = await response.json();
  assert.equal(guest.projectsAvailable, before + 1);
  assert.equal(guest.featured, null);
  assert.deepEqual(Object.keys(guest).sort(), [
    'completedTransactions',
    'featured',
    'licenseVolumeWei',
    'licensesIssued',
    'projectsAvailable',
    'updatedAt',
  ]);

  assert.equal(JSON.stringify(guest).includes('private@'), false);
  assert.equal(JSON.stringify(guest).includes('wallet'), false);
  assert.equal(JSON.stringify(guest).includes('Private purchase'), false);
  const register = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Home visitor',
      legalAccepted: true,
      legalVersion: '2026-11-08.1',
      email: 'visitor@home.test',
      password: 'HomeVisitor!2026',
    }),
  });
  assert.equal(register.status, 201);
  const signedIn = await fetch(base + '/api/home', {
    headers: { Cookie: register.headers.get('set-cookie')!.split(';')[0] },
  }).then((r) => r.json());
  assert.equal(signedIn.featured.id, 'available');
  assert.deepEqual({ ...signedIn, updatedAt: '', featured: null }, { ...guest, updatedAt: '' });
  approvedProjectFixture(app.db, 'unapproved');
  assert.equal(homeSummary(repo).projectsAvailable, before + 2);
});
