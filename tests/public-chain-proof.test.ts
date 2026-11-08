import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  encodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  TransactionNotFoundError,
} from 'viem';
import { marketplaceAbi } from '../shared/marketplace.ts';
import { createApp } from '../server/app.ts';

const hash = '0x' + 'a'.repeat(64),
  blockHash = '0x' + 'b'.repeat(64),
  instance = '0x' + 'c'.repeat(64),
  quoteId = '0x' + 'd'.repeat(64),
  fileHash = '0x' + 'e'.repeat(64),
  terms = '0x' + 'f'.repeat(64),
  withdrawalHash = '0x' + '9'.repeat(64);
const buyer = '0x' + '1'.repeat(40),
  seller = '0x' + '2'.repeat(40),
  coauthor = '0x' + '3'.repeat(40),
  contract = '0x' + '4'.repeat(40),
  treasury = '0x' + '5'.repeat(40);
const quote = {
  id: quoteId,
  buyer,
  seller,
  fileHash,
  licenseType: 1,
  termsHash: terms,
  amount: 12000000000000000n,
  feeBps: 1000,
  expiresAt: 9999999999n,
  instanceId: instance,
  recipients: [coauthor],
  shares: [2500],
};
let app,
  directory,
  base,
  mode = '',
  reads = 0,
  tip = 9n;
function logs() {
  const result = [
    {
      address: contract,
      topics: encodeEventTopics({
        abi: marketplaceAbi,
        eventName: 'LicensePurchased',
        args: { quoteId, buyer, seller },
      }),
      data: encodeAbiParameters(
        parseAbiParameters('bytes32,uint8,bytes32,uint256,uint256,uint64'),
        [fileHash, 1, terms, quote.amount, 1200000000000000n, 1792584000n],
      ),
    },
  ];
  for (const [recipient, amount, share] of [
    [seller, 8100000000000000n, 7500],
    [coauthor, 2700000000000000n, 2500],
  ])
    result.push({
      address: contract,
      topics: encodeEventTopics({
        abi: marketplaceAbi,
        eventName: 'RevenueAllocated',
        args: { quoteId, recipient },
      }),
      data: encodeAbiParameters(parseAbiParameters('uint256,uint16'), [
        mode === 'wrong_split' ? 1n : amount,
        share,
      ]),
    });
  return result;
}
const chain: any = {
  rpcUrl: 'http://127.0.0.1:8545',
  marketplaceStatus: async () => ({
    ready: true,
    deployment: { address: contract, version: 2, instanceId: instance },
  }),
  client: {
    getChainId: async () => {
      reads++;
      if (mode === 'offline') throw new Error('Offline');
      return 31337;
    },
    getBlockNumber: async (options) => {
      assert.equal(options?.cacheTime, 0, 'Live proof must read a fresh chain tip');
      return tip;
    },
    getTransaction: async ({ hash: requested }) => {
      if (requested !== hash) throw new TransactionNotFoundError({ hash: requested });
      return {
        hash,
        blockHash,
        from: buyer,
        to: mode === 'other_contract' ? buyer : contract,
        value: mode === 'wrong_amount' ? 1n : quote.amount,
        input: encodeFunctionData({
          abi: marketplaceAbi,
          functionName: 'buyLicenses',
          args: [[quote], ['0x' + '0'.repeat(130)]],
        }),
      };
    },
    getTransactionReceipt: async ({ hash: requested }) =>
      requested === withdrawalHash
        ? {
            status: 'success',
            to: contract,
            from: coauthor,
            blockHash,
            blockNumber: 8n,
            logs: [
              {
                address: contract,
                topics: encodeEventTopics({
                  abi: marketplaceAbi,
                  eventName: 'ProceedsWithdrawn',
                  args: { recipient: coauthor },
                }),
                data: encodeAbiParameters(parseAbiParameters('uint256'), [
                  mode === 'withdrawn_bad_receipt' ? 1n : 2700000000000000n,
                ]),
              },
            ],
          }
        : {
            status: mode === 'reverted' ? 'reverted' : 'success',
            transactionHash: hash,
            blockHash,
            blockNumber: 6n,
            to: contract,
            from: buyer,
            gasUsed: 100n,
            effectiveGasPrice: 10n,
            logs: logs(),
          },
    getBlock: async ({ blockNumber }) => ({
      number: 6n,
      hash:
        mode === 'noncanonical' && blockNumber !== undefined ? '0x' + '0'.repeat(64) : blockHash,
      transactions: mode === 'not_in_block' ? [] : [hash],
    }),
    getCode: async () => (mode === 'no_code' ? '0x' : '0x123456'),
    readContract: async ({ functionName, args, blockNumber }) => {
      // Anvil state restored from disk has current storage, not an archive of past storage.
      if (blockNumber !== undefined && blockNumber < tip)
        throw new Error('Historical storage unavailable after restore');
      if (functionName === 'instanceId')
        return mode === 'old_instance' ? '0x' + '0'.repeat(64) : instance;
      if (functionName === 'treasury') return treasury;
      if (functionName === 'hasLicense') return mode !== 'not_owned';
      if (functionName === 'usedQuotes') return mode !== 'unused_quote';
      if (functionName === 'balances') {
        if (mode === 'balances_offline') throw new Error('No balance');
        return mode === 'withdrawn' && args[0] === coauthor ? 0n : 8100000000000000n;
      }
      throw new Error('Unexpected read');
    },
    getContractEvents: async ({ eventName, fromBlock, toBlock }) => {
      assert.ok(toBlock - fromBlock <= 5000n);
      if (eventName === 'LicensePurchased')
        return mode === 'no_purchases' || fromBlock > 6n
          ? []
          : [{ transactionHash: hash, blockNumber: 6n, logIndex: 0 }];
      if (mode === 'withdrawal_offline') throw new Error('Missing withdrawal history');
      return mode.startsWith('withdrawn') && fromBlock <= 8n
        ? [
            {
              args: { recipient: coauthor, amount: 2700000000000000n },
              transactionHash: withdrawalHash,
              blockHash,
              blockNumber: 8n,
            },
          ]
        : [];
    },
  },
};
async function get(query = '') {
  const response = await fetch(base + '/api/blockchain/demo-proof' + query);
  return { status: response.status, data: await response.json() };
}
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'public-proof-test-'));
  app = await createApp({ dataDir: directory, serveClient: false, blockchain: chain });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
beforeEach(() => {
  mode = '';
  tip = 9n;
});
after(async () => {
  await app?.close();
  assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
  await rm(directory, { recursive: true, force: true });
});
test('guests verify real receipt, canonical block, license state and allocations using RPC without purchase records or DB writes', async () => {
  assert.equal(app.db.prepare('SELECT count(*) n FROM purchases').get().n, 0);
  const before = app.db.prepare('SELECT total_changes() n').get().n;
  const { status, data } = await get();
  assert.equal(status, 200);
  assert.equal(data.status, 'verified');
  assert.equal(data.source, 'anvil_rpc');
  assert.ok(data.checks.every((check) => check.passed));
  assert.equal(data.transaction.hash, hash);
  assert.equal(data.transaction.blockNumber, '6');
  assert.equal(data.transaction.licenses[0].owned, true);
  assert.equal(
    data.transaction.allocations.find((row) => row.role === 'Co-author').amountWei,
    '2700000000000000',
  );
  assert.equal(data.transaction.receipt.status, '0x1');
  assert.equal(data.transaction.withdrawals.length, 0);
  assert.equal(app.db.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(JSON.stringify(data).includes('email'), false);
});
test('does not present bad receipts, unrelated contracts, wrong blocks, payments or ownership as verified', async () => {
  for (const invalid of [
    'reverted',
    'other_contract',
    'wrong_split',
    'wrong_amount',
    'noncanonical',
    'not_in_block',
    'no_code',
    'old_instance',
    'not_owned',
    'unused_quote',
  ]) {
    mode = invalid;
    const { data } = await get('?transactionHash=' + hash);
    assert.equal(data.status, 'failed', invalid);
    assert.equal(data.transaction, null, invalid);
  }
});
test('handles missing hashes and offline data without invented proof, while validating input before RPC reads', async () => {
  const before = reads;
  assert.equal((await get('?transactionHash=invalid')).status, 400);
  assert.equal(reads, before);
  mode = 'offline';
  assert.equal((await get()).data.status, 'unavailable');
  mode = 'no_purchases';
  assert.equal((await get()).data.status, 'not_found');
  mode = '';
  assert.equal((await get('?transactionHash=0x' + '8'.repeat(64))).data.status, 'not_found');
});
test('separates current credit from verified withdrawal receipts and labels unavailable history', async () => {
  mode = 'withdrawn';
  const { data } = await get();
  assert.equal(data.status, 'verified');
  assert.equal(data.transaction.withdrawals[0].transactionHash, withdrawalHash);
  assert.equal(data.transaction.credits.find((row) => row.wallet === coauthor).amountWei, '0');
  mode = 'withdrawn_bad_receipt';
  assert.equal((await get()).data.transaction.withdrawalScan, 'unavailable');
  mode = 'withdrawal_offline';
  const offline = (await get()).data;
  assert.equal(offline.transaction.withdrawalScan, 'unavailable');
  assert.equal(offline.transaction.withdrawals.length, 0);
  mode = 'balances_offline';
  assert.ok((await get()).data.transaction.credits.every((row) => row.amountWei === null));
});
test('bounds event scans and supports an explicit older purchase hash without claiming complete withdrawal history', async () => {
  tip = 10009n;
  assert.equal((await get()).data.status, 'not_found');
  const { data } = await get('?transactionHash=' + hash);
  assert.equal(data.status, 'verified');
  assert.equal(data.transaction.withdrawalScan, 'recent');
  assert.equal(data.transaction.withdrawalsFromBlock, '5009');
});
