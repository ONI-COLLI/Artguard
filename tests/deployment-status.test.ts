import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createApp } from '../server/app.ts';
const address = (i: number) => '0x' + String(i).repeat(40);
const hash = (i: number) => '0x' + String(i).repeat(64);
const deployments = [1, 2, 3, 4, 5, 6].map((i) => ({
  address: address(i),
  transactionHash: hash(i),
  version: i,
}));
let mode = '',
  app,
  directory: string,
  base: string,
  reads = 0;
const chain: any = {
  status: async () => ({
    ready: mode !== 'offline',
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    deployment: deployments[0],
  }),
  marketplaceStatus: async () => ({
    ready: true,
    deployment: deployments[1],
    contracts: deployments.slice(1, 4),
  }),
  requireMarketplace: async (target) => deployments.find((item) => item.address === target),
  subscriptionDeployment: async () => {
    if (mode === 'subscriptions') throw new Error('Private path should not be exposed');
    return deployments[4];
  },
  promotionDeployment: async () => deployments[5],
  client: {
    getTransactionReceipt: async ({ hash: transactionHash }) => {
      reads++;
      const index = deployments.findIndex((item) => item.transactionHash === transactionHash);
      return {
        transactionHash,
        status: mode === 'reverted' ? 'reverted' : 'success',
        blockNumber: 7n,
        blockHash: hash(9),
        contractAddress: mode === 'wrong_contract' ? address(9) : deployments[index].address,
      };
    },
    getBlock: async () => ({ hash: hash(mode === 'noncanonical' ? 8 : 9) }),
  },
};
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'deployment-status-test-'));
  app = await createApp({ dataDir: directory, serveClient: false, blockchain: chain });
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
beforeEach(() => {
  mode = '';
  reads = 0;
});
after(async () => {
  await app?.close();
  assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
  await rm(directory, { recursive: true, force: true });
});
async function get() {
  const response = await fetch(base + '/api/blockchain/deployments');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
test('guests read six confirmed deployments without login, database writes or private metadata', async () => {
  const before = app.db.prepare('SELECT total_changes() n').get().n;
  const data = await get();
  assert.equal(data.ready, true);
  assert.equal(data.contracts.length, 6);
  assert.equal(reads, 6);
  assert.equal(app.db.prepare('SELECT total_changes() n').get().n, before);
  assert.deepEqual(data.contracts[3], {
    id: 'escrow',
    ready: true,
    address: address(4),
    transactionHash: hash(4),
    blockNumber: '7',
  });
  assert.ok(!JSON.stringify(data).match(/private|quoteSigner|treasury|signature|mnemonic|version/));
});
test('offline node exposes no stale addresses and makes no receipt requests', async () => {
  mode = 'offline';
  const data = await get();
  assert.equal(data.chainReady, false);
  assert.equal(data.ready, false);
  assert.equal(reads, 0);
  assert.ok(data.contracts.every((item) => !item.ready && !item.address && !item.transactionHash));
});
test('reverted, mismatched or noncanonical deployment receipts are never confirmed', async () => {
  for (mode of ['reverted', 'wrong_contract', 'noncanonical']) {
    const data = await get();
    assert.equal(data.ready, false);
    assert.ok(
      data.contracts.every((item) => !item.ready && !item.address && !item.transactionHash),
    );
  }
});
test('one unavailable contract does not hide the other confirmed deployments', async () => {
  mode = 'subscriptions';
  const data = await get();
  assert.equal(data.ready, false);
  assert.equal(data.contracts.filter((item) => item.ready).length, 5);
  assert.equal(data.contracts.find((item) => item.id === 'subscriptions').address, null);
});
