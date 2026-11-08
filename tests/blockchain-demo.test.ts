import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { encodeEventTopics, encodeAbiParameters, parseAbiParameters } from 'viem';
import { marketplaceAbi } from '../shared/marketplace.ts';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { tokenHash } from '../server/auth.ts';
import { verifiedFixture } from './fixtures.ts';

let directory,
  app,
  repo,
  base,
  online = true,
  instance = '0x' + 'a'.repeat(64),
  mode = 'valid',
  reads = 0;
const hash = '0x' + 'b'.repeat(64),
  quote = '0x' + 'c'.repeat(64),
  fileHash = '0x' + 'd'.repeat(64),
  termsHash = '0x' + 'e'.repeat(64);
const contract = '0x' + '1'.repeat(40),
  registry = '0x' + '2'.repeat(40),
  buyer = '0x' + '3'.repeat(40),
  seller = '0x' + '4'.repeat(40),
  coauthor = '0x' + '5'.repeat(40);
const time = '2026-10-21T12:00:00.000Z';
function receipt() {
  if (mode === 'missing') throw new Error('Node offline');
  const logs = [
    {
      address: contract,
      topics: encodeEventTopics({
        abi: marketplaceAbi,
        eventName: 'LicensePurchased',
        args: { quoteId: quote, buyer, seller },
      }),
      data: encodeAbiParameters(
        parseAbiParameters('bytes32,uint8,bytes32,uint256,uint256,uint64'),
        [fileHash, 1, termsHash, 12000000000000000n, 1200000000000000n, 1792584000n],
      ),
    },
  ];
  for (const [recipient, amount, share] of [
    [seller, 8100000000000000n, 7500],
    [coauthor, 2700000000000000n, 2500],
  ]) {
    logs.push({
      address: contract,
      topics: encodeEventTopics({
        abi: marketplaceAbi,
        eventName: 'RevenueAllocated',
        args: { quoteId: quote, recipient },
      }),
      data: encodeAbiParameters(parseAbiParameters('uint256,uint16'), [
        mode === 'wrong_split' ? 1n : amount,
        share,
      ]),
    });
  }
  return {
    status: mode === 'reverted' ? 'reverted' : 'success',
    from: mode === 'wrong_buyer' ? seller : buyer,
    to: mode === 'wrong_contract' ? registry : contract,
    blockNumber: 6n,
    logs,
  };
}
const chain: any = {
  status: async () => {
    reads++;
    return {
      ready: online,
      chainId: 31337,
      message: 'Local test node',
      deployment: { address: registry, instanceId: instance },
    };
  },
  marketplaceStatus: async () => ({ ready: online, deployment: { address: contract } }),
  client: { getBlockNumber: async () => 9n, getTransactionReceipt: async () => receipt() },
};
async function get(token = '') {
  const response = await fetch(base + '/api/admin/blockchain-demo', {
    headers: token ? { Cookie: 'artguard_session=' + tokenHash(token) } : {},
  });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'blockchain-demo-test-'));
  app = await createApp({ dataDir: directory, serveClient: false, blockchain: chain });
  repo = new Repository(app.db);
  for (const id of ['admin', 'regular', 'unverified']) {
    repo.run(
      'INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
      id,
      id,
      id + '@proof.test',
      'not-a-real-password',
      time,
    );
    repo.run(
      'INSERT INTO sessions VALUES(?,?,?)',
      tokenHash(tokenHash(id)),
      id,
      Date.now() + 60000,
    );
    if (id !== 'unverified') verifiedFixture(app.db, { id, email: id + '@proof.test' });
    if (id !== 'regular') repo.run('INSERT INTO manager_accounts VALUES(?,?)', id, time);
  }
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await app?.close();
  assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
  await rm(directory, { recursive: true, force: true });
});
test('requires a verified manager before reading any blockchain or private purchase data', async () => {
  assert.equal((await get()).status, 401);
  assert.equal((await get('regular')).status, 403);
  assert.equal((await get('unverified')).status, 403);
  assert.equal(reads, 0);
  const response = await get('admin');
  assert.equal(response.status, 200);
  assert.equal(response.data.sale, null);
  assert.equal(response.data.network.blockNumber, '9');
});
test('verifies the saved license and every split from receipt events without writing to the database', async () => {
  const artwork = repo.one('SELECT id,owner_id FROM artworks LIMIT 1');
  repo.run(
    'INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?)',
    'proof-purchase',
    'regular',
    artwork.id,
    'personal',
    1200,
    120,
    '[]',
    null,
    time,
  );
  repo.run(
    'INSERT INTO chain_checkouts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'proof-checkout',
    'regular',
    buyer,
    instance,
    contract,
    'confirmed',
    9999999999,
    hash,
    '6',
    time,
    '12000000000000000',
    null,
    time,
  );
  repo.run('INSERT INTO chain_checkout_versions VALUES(?,?)', 'proof-checkout', 2);
  repo.run(
    'INSERT INTO chain_checkout_items(quote_id,checkout_id,artwork_id,seller_id,title,license,seller_wallet,file_hash,terms_hash,terms_json,amount,commission,amount_wei,fee_wei,fee_bps,signature,purchase_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    quote,
    'proof-checkout',
    artwork.id,
    artwork.owner_id,
    'Saved demonstration artwork',
    'personal',
    seller,
    fileHash,
    termsHash,
    '{}',
    1200,
    120,
    '12000000000000000',
    '1200000000000000',
    1000,
    '0x',
    'proof-purchase',
  );
  repo.run(
    'INSERT INTO chain_revenue_splits VALUES(?,?)',
    quote,
    JSON.stringify([
      {
        name: 'Creator',
        wallet: seller,
        percent: 75,
        amountWei: '8100000000000000',
        creator: true,
      },
      {
        name: 'Co-author',
        wallet: coauthor,
        percent: 25,
        amountWei: '2700000000000000',
        creator: false,
      },
    ]),
  );
  const changes = repo.one('SELECT total_changes() AS n').n;
  const response = await get('admin');
  assert.equal(response.data.sale.proof, 'verified');
  assert.equal(response.data.sale.blockNumber, '6');
  assert.equal(response.data.sale.allocations[1].amountWei, '2700000000000000');
  assert.equal(repo.one('SELECT total_changes() AS n').n, changes);
  assert.equal(JSON.stringify(response.data).includes('@proof.test'), false);
  assert.equal(JSON.stringify(response.data).includes('signature'), false);
});
test('never marks reverted, unrelated, mismatched, offline or old-instance payments as verified', async () => {
  for (const invalid of ['wrong_buyer', 'wrong_contract', 'wrong_split', 'reverted']) {
    mode = invalid;
    assert.equal((await get('admin')).data.sale.proof, 'mismatch', invalid);
  }
  mode = 'missing';
  assert.equal((await get('admin')).data.sale.proof, 'unavailable');
  online = false;
  assert.equal((await get('admin')).data.sale.proof, 'unavailable');
  online = true;
  mode = 'valid';
  instance = '0x' + 'f'.repeat(64);
  assert.equal((await get('admin')).data.sale.proof, 'different_instance');
});
