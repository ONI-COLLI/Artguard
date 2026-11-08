import { withLegalFixture } from './fixtures.ts';
import { encodeFunctionData } from 'viem';
import { before, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, createTestClient, http, parseEther } from 'viem';
import { localChain, registryAbi } from '../shared/blockchain.ts';
import { escrowAbi } from '../shared/escrow.ts';
import { contractQuote, termMarketplaceAbi } from '../shared/marketplace.ts';
import { consentTypes } from '../shared/platform.ts';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { LocalBlockchain } from '../server/blockchain.ts';
import { reconcileEscrow } from '../server/reconciliation.ts';
import { verifiedFixture, planFixture } from './fixtures.ts';
import { anvilPath } from '../scripts/anvil.mjs';
import { compileRegistry } from '../scripts/contract.mjs';
import { ensureMarketplace } from '../scripts/deploy-marketplace.mjs';
import { ensureTermMarketplace } from '../scripts/deploy-term-marketplace.mjs';
import { ensureEscrowMarketplace } from '../scripts/deploy-escrow-marketplace.mjs';
let directory,
  node,
  app,
  repo,
  base,
  rpc,
  client,
  testClient,
  wallet,
  accounts,
  registry,
  terms,
  market,
  virtualTime = 0;
const realNow = Date.now;
function actor() {
  let cookie = '';
  return {
    id: '',
    email: '',
    async request(path, data?, method = data === undefined ? 'GET' : 'POST') {
      const r = await fetch(base + '/api' + path, {
        method,
        headers: {
          Cookie: cookie,
          ...(data && !(data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          data === undefined
            ? undefined
            : data instanceof FormData
              ? data
              : JSON.stringify(withLegalFixture(data)),
      });
      if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0];
      return {
        status: r.status,
        data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text(),
      };
    },
  };
}
const seller = actor(),
  buyer = actor(),
  coauthor = actor(),
  manager = actor(),
  admin = actor(),
  stranger = actor(),
  guest = actor();
before(async () => {
  mock.method(Date, 'now', () => Math.max(realNow(), virtualTime));
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'escrow-test-'));
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as any).port;
  await new Promise<void>((r) => probe.close(() => r()));
  rpc = 'http://127.0.0.1:' + port;
  node = spawn(
    anvilPath(),
    ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--no-cors', '--silent'],
    { stdio: 'ignore', windowsHide: true },
  );
  client = createPublicClient({
    chain: localChain,
    transport: http(rpc, { retryCount: 0 }),
    pollingInterval: 25,
  });
  for (let i = 0; i < 60; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  testClient = createTestClient({ chain: localChain, mode: 'anvil', transport: http(rpc) });
  wallet = createWalletClient({ chain: localChain, transport: http(rpc) });
  accounts = await wallet.getAddresses();
  const hash = await wallet.deployContract({
    account: accounts[0],
    ...(await compileRegistry()),
    args: ['0x' + randomBytes(32).toString('hex')],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const instanceId = await client.readContract({
    address: receipt.contractAddress!,
    abi: registryAbi,
    functionName: 'instanceId',
  });
  registry = {
    chainId: 31337,
    address: receipt.contractAddress,
    instanceId,
    transactionHash: hash,
  };
  await mkdir(join(directory, 'chain'));
  await writeFile(join(directory, 'chain', 'registry.json'), JSON.stringify(registry));
  const previous = await ensureMarketplace(join(directory, 'chain'), registry, client, wallet);
  terms = await ensureTermMarketplace(join(directory, 'chain'), registry, previous, client, wallet);
  market = await ensureEscrowMarketplace(join(directory, 'chain'), registry, terms, client, wallet);
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  repo = new Repository(app.db);
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
  for (const [index, a, name] of [
    [1, seller, 'Seller'],
    [2, buyer, 'Buyer'],
    [3, coauthor, 'Coauthor'],
    [4, manager, 'Manager'],
    [5, admin, 'Administrator'],
    [6, stranger, 'Stranger'],
  ] as const) {
    const r = await a.request('/auth/register', {
      name,
      email: name.toLowerCase() + '@escrow.test',
      password: 'EscrowDemo!2026',
    });
    assert.equal(r.status, 201);
    a.id = r.data.user.id;
    a.email = r.data.user.email;
    verifiedFixture(app.db, r.data.user);
    const challenge = (await a.request('/wallet/challenge', { address: accounts[index] })).data;
    const signature = await wallet.signMessage({
      account: accounts[index],
      message: challenge.message,
    });
    assert.equal((await a.request('/wallet/link', { ...challenge, signature })).status, 200);
  }
  repo.run('INSERT INTO manager_accounts VALUES(?,?)', manager.id, new Date().toISOString());
  repo.run('INSERT INTO admin_accounts VALUES(?,?)', admin.id, new Date().toISOString());
});
after(async () => {
  mock.restoreAll();
  await app?.close();
  if (node && node.exitCode === null) {
    const stopped = new Promise((r) => node.once('exit', r));
    node.kill();
    await stopped;
  }
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
async function advance(seconds: number) {
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
  virtualTime = Number((await client.getBlock()).timestamp) * 1000;
  repo.run('UPDATE sessions SET expires_at=?', Date.now() + 365 * 86400000);
}
async function project(label: string, days = 30) {
  planFixture(app.db, seller.id, 'business');
  const f = new FormData();
  f.append(
    'file',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1MAAAAASUVORK5CYII=',
          'base64',
        ),
        Buffer.from(label),
      ],
      { type: 'image/png' },
    ),
    'synthetic.png',
  );
  for (const [k, v] of Object.entries({
    title: 'Escrow ' + label,
    description: 'Synthetic escrow test artwork.',
    category: 'Illustration',
    price: '12',
    licenses: 'personal',
    licenseDurationDays: String(days),
    rights: 'true',
    recipients: JSON.stringify([{ name: 'Coauthor', wallet: accounts[3], percent: 25 }]),
  }))
    f.append(k, v);
  const uploaded = await seller.request('/artworks', f);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  const a = uploaded.data.artwork;
  const consent = (await coauthor.request('/coauthors/' + a.id + '/request')).data;
  const signature = await wallet.signTypedData({
    account: accounts[3],
    domain: consent.domain,
    types: consentTypes,
    primaryType: 'RevenueConsent',
    message: consent.message,
  });
  assert.equal(
    (
      await coauthor.request('/coauthors/' + a.id + '/approve', {
        versionId: consent.versionId,
        signature,
      })
    ).status,
    200,
  );
  assert.equal(
    (await seller.request('/artworks/' + a.id, { status: 'published' }, 'PATCH')).status,
    200,
  );
  const intent = (await seller.request('/blockchain/artworks/' + a.id + '/prepare', {})).data
    .registration;
  const hash = await wallet.writeContract({
    account: accounts[1],
    address: registry.address,
    abi: registryAbi,
    functionName: 'registerArtwork',
    args: [intent.fileHash, intent.termsHash],
  });
  await client.waitForTransactionReceipt({ hash });
  assert.equal(
    (
      await seller.request('/blockchain/registrations/' + intent.id + '/confirm', {
        transactionHash: hash,
      })
    ).status,
    200,
  );
  planFixture(app.db, seller.id, 'free');
  return a;
}
async function deposit(label: string) {
  const a = await project(label);
  const r = await buyer.request('/blockchain/checkouts', {
    items: [{ artworkId: a.id, license: 'personal' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const order = r.data.checkout;
  assert.equal(order.marketVersion, 4);
  const hash = await wallet.writeContract({
    account: accounts[2],
    address: market.address,
    abi: escrowAbi,
    functionName: 'buyLicenses',
    args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
    value: BigInt(order.totalWei),
  });
  await client.waitForTransactionReceipt({ hash });
  const confirmed = await buyer.request('/blockchain/checkouts/' + order.id + '/confirm', {
    transactionHash: hash,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  return { a, order, id: order.items[0].quote.id, hash };
}
async function perform(id, fn, account = accounts[2]) {
  const hash = await wallet.writeContract({
    account,
    address: market.address,
    abi: escrowAbi,
    functionName: fn,
    args: [id],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  const r = await buyer.request('/escrow/' + id + '/sync', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { hash, receipt, order: r.data.order };
}
async function credit(address) {
  return client.readContract({
    address: market.address,
    abi: escrowAbi,
    functionName: 'balances',
    args: [address],
  });
}
async function rejects(id, fn, account) {
  await assert.rejects(
    client.simulateContract({
      account,
      address: market.address,
      abi: escrowAbi,
      functionName: fn,
      args: [id],
    }),
  );
}

test('deposit holds funds, issues no license or revenue, checks permissions and rejects invalid quotes', async () => {
  const before = [await credit(accounts[0]), await credit(accounts[1]), await credit(accounts[3])],
    t = await deposit('held');
  assert.equal(
    (
      await client.readContract({
        address: market.address,
        abi: escrowAbi,
        functionName: 'getEscrow',
        args: [t.id],
      })
    ).state,
    1,
  );
  assert.deepEqual(
    [await credit(accounts[0]), await credit(accounts[1]), await credit(accounts[3])],
    before,
  );
  assert.equal(
    await client.readContract({
      address: market.address,
      abi: escrowAbi,
      functionName: 'hasLicense',
      args: [accounts[2], t.order.items[0].quote.fileHash, 1],
    }),
    false,
  );
  assert.equal(repo.one('SELECT count(*) n FROM purchases WHERE artwork_id=?', t.a.id).n, 0);
  assert.equal(
    repo.one('SELECT count(*) n FROM accounting_events WHERE artwork_id=?', t.a.id).n,
    0,
  );
  assert.equal((await buyer.request('/artworks/' + t.a.id + '/download')).status, 403);
  assert.equal((await buyer.request('/escrow/' + t.id + '/preview')).status, 403);
  assert.equal((await stranger.request('/escrow/' + t.id + '/sync', {})).status, 404);
  assert.equal((await guest.request('/escrow/orders')).status, 401);
  assert.equal((await admin.request('/escrow/orders?scope=manager')).status, 403);
  assert.equal(
    (
      await buyer.request('/blockchain/checkouts', {
        items: [{ artworkId: t.a.id, license: 'personal' }],
      })
    ).status,
    409,
  );
  const q = contractQuote(t.order.items[0].quote);
  await assert.rejects(
    client.simulateContract({
      account: accounts[2],
      address: market.address,
      abi: escrowAbi,
      functionName: 'buyLicenses',
      args: [
        [{ ...q, id: '0x' + randomBytes(32).toString('hex'), amount: q.amount + 1n }],
        [t.order.items[0].signature],
      ],
      value: q.amount + 1n,
    }),
  );
  await rejects(t.id, 'markDelivered', accounts[2]);
  await rejects(t.id, 'release', accounts[2]);
  await rejects(t.id, 'refund', accounts[2]);
  const changes = repo.one('SELECT total_changes() n').n;
  const proof = await guest.request('/blockchain/escrow-proof?transactionHash=' + t.hash);
  assert.equal(proof.data.status, 'verified', JSON.stringify(proof.data));
  assert.equal(proof.data.orders[0].heldWei, t.order.totalWei);
  assert.deepEqual(proof.data.orders[0].allocations, []);
  assert.equal(repo.one('SELECT total_changes() n').n, changes);
  await perform(t.id, 'refund', accounts[1]);
});
test('acceptance releases exact fees and co-author shares, starts the period and makes withdrawals real', async () => {
  const t = await deposit('accept'),
    before = [await credit(accounts[0]), await credit(accounts[1]), await credit(accounts[3])];
  assert.equal((await seller.request('/escrow/' + t.id + '/delivery-check', {})).status, 200);
  await perform(t.id, 'markDelivered', accounts[1]);
  assert.equal((await buyer.request('/escrow/' + t.id + '/preview')).status, 200);
  assert.equal((await buyer.request('/artworks/' + t.a.id + '/download')).status, 403);
  await rejects(t.id, 'release', accounts[1]);
  await rejects(t.id, 'dispute', accounts[1]);
  const release = await perform(t.id, 'release');
  assert.equal(release.order.state, 'released');
  assert.deepEqual(
    [
      (await credit(accounts[0])) - before[0],
      (await credit(accounts[1])) - before[1],
      (await credit(accounts[3])) - before[2],
    ],
    [parseEther('0.0012'), parseEther('0.0081'), parseEther('0.0027')],
  );
  const purchase = (await buyer.request('/state')).data.purchases.find(
    (p) => p.artworkId === t.a.id,
  );
  assert.equal(purchase.payment.transactionHash, release.hash);
  assert.equal(Date.parse(purchase.validUntil) - Date.parse(purchase.validFrom), 30 * 86400000);
  assert.equal((await buyer.request('/artworks/' + t.a.id + '/download')).status, 200);
  await buyer.request('/escrow/' + t.id + '/sync', {});
  assert.equal(
    repo.one('SELECT count(*) n FROM accounting_events WHERE artwork_id=?', t.a.id).n,
    1,
  );
  await rejects(t.id, 'release', accounts[2]);
  await rejects(t.id, 'refund', accounts[1]);
  const hash = await wallet.writeContract({
    account: accounts[3],
    address: market.address,
    abi: escrowAbi,
    functionName: 'withdraw',
  });
  await client.waitForTransactionReceipt({ hash });
  assert.equal(await credit(accounts[3]), 0n);
  const proof = (await guest.request('/blockchain/escrow-proof?transactionHash=' + t.hash)).data;
  assert.equal(proof.status, 'verified', JSON.stringify(proof));
  assert.equal(proof.orders[0].releaseHash, release.hash);
  assert.equal(
    proof.orders[0].withdrawals.some((w) => w.hash === hash),
    true,
  );
});
test('no delivery permits a full refundable credit after 72 hours, then an exact wallet refund and repurchase', async () => {
  const t = await deposit('timeout');
  await rejects(t.id, 'refund', accounts[2]);
  await advance(72 * 3600 + 1);
  await rejects(t.id, 'markDelivered', accounts[1]);
  const prior = await client.readContract({
    address: market.address,
    abi: escrowAbi,
    functionName: 'refundBalances',
    args: [accounts[2]],
  });
  await perform(t.id, 'refund');
  assert.equal(
    await client.readContract({
      address: market.address,
      abi: escrowAbi,
      functionName: 'refundBalances',
      args: [accounts[2]],
    }),
    prior + BigInt(t.order.totalWei),
  );
  assert.equal(
    repo.one('SELECT count(*) n FROM accounting_events WHERE artwork_id=?', t.a.id).n,
    0,
  );
  const available = await client.readContract({
      address: market.address,
      abi: escrowAbi,
      functionName: 'refundBalances',
      args: [accounts[2]],
    }),
    balance = await client.getBalance({ address: accounts[2] });
  const hash = await wallet.writeContract({
    account: accounts[2],
    address: market.address,
    abi: escrowAbi,
    functionName: 'withdrawRefund',
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(
    await client.getBalance({ address: accounts[2] }),
    balance + available - receipt.gasUsed * receipt.effectiveGasPrice,
  );
  const proof = (await guest.request('/blockchain/escrow-proof?transactionHash=' + t.hash)).data;
  assert.equal(proof.status, 'verified', JSON.stringify(proof));
  assert.equal(
    proof.orders[0].withdrawals.some((w) => w.hash === hash),
    true,
  );
  assert.equal(
    (
      await buyer.request('/blockchain/checkouts', {
        items: [{ artworkId: t.a.id, license: 'personal' }],
      })
    ).status,
    201,
  );
});
test('review timeout enables release without buyer acceptance; it never releases just from an API read', async () => {
  const t = await deposit('review-timeout');
  await perform(t.id, 'markDelivered', accounts[1]);
  await advance(24 * 3600 + 1);
  assert.equal(
    (await buyer.request('/escrow/' + t.id + '/sync', {})).data.order.state,
    'delivered',
  );
  assert.equal(repo.one('SELECT count(*) n FROM purchases WHERE artwork_id=?', t.a.id).n, 0);
  await rejects(t.id, 'dispute', accounts[2]);
  assert.equal((await perform(t.id, 'release', accounts[1])).order.state, 'released');
});
test('dispute blocks payouts, manager decisions are authorized, recorded and verified on-chain', async () => {
  const t = await deposit('dispute-refund');
  await perform(t.id, 'markDelivered', accounts[1]);
  await perform(t.id, 'dispute');
  await rejects(t.id, 'release', accounts[2]);
  await rejects(t.id, 'release', accounts[1]);
  await rejects(t.id, 'refund', accounts[2]);
  await assert.rejects(
    client.simulateContract({
      account: accounts[1],
      address: market.address,
      abi: escrowAbi,
      functionName: 'resolveDispute',
      args: [t.id, false],
    }),
  );
  const denied = await admin.request('/escrow/' + t.id + '/resolve', {
    refund: true,
    reason: 'A technical admin cannot decide this dispute.',
  });
  assert.ok(denied.status === 403 || denied.status === 404);
  const result = await manager.request('/escrow/' + t.id + '/resolve', {
    refund: true,
    reason: 'The buyer demonstrated an incorrect delivery.',
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.order.state, 'refunded');
  assert.ok(repo.one('SELECT tx_hash FROM escrow_decisions WHERE quote_id=?', t.id).tx_hash);
  assert.equal(repo.one('SELECT count(*) n FROM purchases WHERE artwork_id=?', t.a.id).n, 0);
  assert.equal(
    (
      await manager.request('/escrow/' + t.id + '/resolve', {
        refund: false,
        reason: 'A second decision must not be possible.',
      })
    ).status,
    409,
  );
  const proof = (await guest.request('/blockchain/escrow-proof?transactionHash=' + t.hash)).data;
  assert.equal(proof.status, 'verified', JSON.stringify(proof));
  assert.equal(proof.orders[0].state, 'refunded');
});
test('manager may release a valid disputed delivery; unresolved disputes allow refund after 7 days', async () => {
  const t = await deposit('dispute-release');
  await perform(t.id, 'markDelivered', accounts[1]);
  await perform(t.id, 'dispute');
  const decision = await manager.request('/escrow/' + t.id + '/resolve', {
    refund: false,
    reason: 'The original file fingerprint and delivery were verified.',
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.data));
  assert.equal(decision.data.order.state, 'released');
  const other = await deposit('dispute-timeout');
  await perform(other.id, 'markDelivered', accounts[1]);
  await perform(other.id, 'dispute');
  await advance(7 * 86400 + 1);
  assert.equal(
    (
      await manager.request('/escrow/' + other.id + '/resolve', {
        refund: false,
        reason: 'Late decisions cannot override the refund deadline.',
      })
    ).status >= 400,
    true,
  );
  assert.equal((await perform(other.id, 'refund')).order.state, 'refunded');
});
test('bulk deposits can settle independently and a restart preserves escrow state and released licenses', async () => {
  const first = await project('bulk-one'),
    second = await project('bulk-two');
  planFixture(app.db, buyer.id, 'business');
  const prepared = await buyer.request('/blockchain/checkouts', {
    items: [
      { artworkId: first.id, license: 'personal' },
      { artworkId: second.id, license: 'personal' },
    ],
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const order = prepared.data.checkout;
  const hash = await wallet.writeContract({
    account: accounts[2],
    address: market.address,
    abi: escrowAbi,
    functionName: 'buyLicenses',
    args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
    value: BigInt(order.totalWei),
  });
  await client.waitForTransactionReceipt({ hash });
  assert.equal(
    (
      await buyer.request('/blockchain/checkouts/' + order.id + '/confirm', {
        transactionHash: hash,
      })
    ).status,
    200,
  );
  const [one, two] = order.items;
  await perform(one.quote.id, 'markDelivered', accounts[1]);
  await perform(one.quote.id, 'release');
  await perform(two.quote.id, 'refund', accounts[1]);
  assert.equal(
    repo.one(
      'SELECT count(*) n FROM accounting_events WHERE artwork_id IN (?,?)',
      first.id,
      second.id,
    ).n,
    1,
  );
  await app.close();
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  repo = new Repository(app.db);
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
  assert.equal(
    (await buyer.request('/escrow/' + one.quote.id + '/sync', {})).data.order.state,
    'released',
  );
  assert.equal(
    (await buyer.request('/escrow/' + two.quote.id + '/sync', {})).data.order.state,
    'refunded',
  );
  assert.equal(
    (await guest.request('/blockchain/escrow-proof?transactionHash=' + hash)).data.status,
    'verified',
  );
});

test('the new contract inherits older license expiry and preserves the older contract credits', async () => {
  const a = await project('legacy-license');
  const q = {
    id: '0x' + randomBytes(32).toString('hex'),
    buyer: accounts[6],
    seller: accounts[1],
    fileHash: '0x' + a.hash,
    licenseType: 1,
    termsHash: repo.one('SELECT terms_hash FROM chain_registrations WHERE artwork_id=?', a.id)
      .terms_hash,
    amount: String(parseEther('0.012')),
    feeBps: 1000,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    instanceId: registry.instanceId,
    recipients: [accounts[3]],
    shares: [2500],
    durationSeconds: 30 * 86400,
  };
  const chain = new LocalBlockchain(directory, rpc),
    signature = await chain.signQuote(terms, q);
  const hash = await wallet.writeContract({
    account: accounts[6],
    address: terms.address,
    abi: termMarketplaceAbi,
    functionName: 'buyLicenses',
    args: [[contractQuote(q)], [signature]],
    value: BigInt(q.amount),
  });
  await client.waitForTransactionReceipt({ hash });
  assert.equal(
    await client.readContract({
      address: market.address,
      abi: escrowAbi,
      functionName: 'hasLicense',
      args: [accounts[6], q.fileHash, 1],
    }),
    true,
  );
  assert.equal(
    await client.readContract({
      address: market.address,
      abi: escrowAbi,
      functionName: 'licenseExpiry',
      args: [accounts[6], q.fileHash, 1],
    }),
    await client.readContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'licenseExpiry',
      args: [accounts[6], q.fileHash, 1],
    }),
  );
  assert.equal(
    (
      await stranger.request('/blockchain/checkouts', {
        items: [{ artworkId: a.id, license: 'personal' }],
      })
    ).status,
    409,
  );
  const oldCredit = await client.readContract({
    address: terms.address,
    abi: termMarketplaceAbi,
    functionName: 'balances',
    args: [accounts[3]],
  });
  assert.equal(
    (await ensureEscrowMarketplace(join(directory, 'chain'), registry, terms, client, wallet))
      .address,
    market.address,
  );
  assert.equal(
    await client.readContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'balances',
      args: [accounts[3]],
    }),
    oldCredit,
  );
});

test('reconciliation distinguishes locked deposits, recipient credits and refunded credits at the same block', async () => {
  const t = await deposit('reconciliation');
  const funded = await reconcileEscrow(repo, new LocalBlockchain(directory, rpc));
  const line = funded.contracts.find(
    (c) => c.address.toLowerCase() === market.address.toLowerCase(),
  )!;
  assert.equal(line.status, 'matched');
  assert.equal(line.differenceWei, '0');
  assert.ok(BigInt(line.lockedEscrowWei) >= BigInt(t.order.totalWei));
  await perform(t.id, 'markDelivered', accounts[1]);
  await perform(t.id, 'release');
  const released = await reconcileEscrow(repo, new LocalBlockchain(directory, rpc));
  const after = released.contracts.find(
    (c) => c.address.toLowerCase() === market.address.toLowerCase(),
  )!;
  assert.equal(after.status, 'matched');
  assert.equal(
    BigInt(line.lockedEscrowWei) - BigInt(after.lockedEscrowWei),
    BigInt(t.order.totalWei),
  );
  assert.equal(
    BigInt(after.recipientCreditsWei) - BigInt(line.recipientCreditsWei),
    BigInt(t.order.totalWei),
  );
});
test('prepared demo wallets fund, deliver, release, dispute and withdraw refunds through the restricted site signer', async () => {
  for (const [key, person, address] of [
    ['creator', seller, accounts[1]],
    ['buyer', buyer, accounts[2]],
    ['coauthor', coauthor, accounts[3]],
  ]) {
    repo.run(
      'INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      'demo_account:' + key,
      person.id,
    );
    repo.run(
      'INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      'demo_wallet:' + key,
      address,
    );
  }
  repo.run(
    'INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    'demo_chain_instance',
    registry.instanceId,
  );
  const send = async (person, address, data, value = 0n) =>
    person.request('/demo/wallet/rpc', {
      method: 'eth_sendTransaction',
      params: [{ from: address, to: market.address, data, value: '0x' + value.toString(16) }],
    });
  async function demoDeposit(label) {
    const a = await project(label),
      prepared = await buyer.request('/blockchain/checkouts', {
        items: [{ artworkId: a.id, license: 'personal' }],
      });
    assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
    const order = prepared.data.checkout,
      data = encodeFunctionData({
        abi: escrowAbi,
        functionName: 'buyLicenses',
        args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
      });
    const result = await send(buyer, accounts[2], data, BigInt(order.totalWei));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    await client.waitForTransactionReceipt({ hash: result.data.result });
    assert.equal(
      (await send(buyer, accounts[2], data, BigInt(order.totalWei))).data.result,
      result.data.result,
    );
    assert.equal(
      (
        await buyer.request('/blockchain/checkouts/' + order.id + '/confirm', {
          transactionHash: result.data.result,
        })
      ).status,
      200,
    );
    return order.items[0].quote.id;
  }
  const id = await demoDeposit('demo-direct');
  const delivered = encodeFunctionData({
    abi: escrowAbi,
    functionName: 'markDelivered',
    args: [id],
  });
  assert.equal((await send(buyer, accounts[2], delivered)).status, 403);
  const actual = await send(seller, accounts[1], delivered);
  assert.equal(actual.status, 200, JSON.stringify(actual.data));
  await client.waitForTransactionReceipt({ hash: actual.data.result });
  const released = await send(
    buyer,
    accounts[2],
    encodeFunctionData({ abi: escrowAbi, functionName: 'release', args: [id] }),
  );
  assert.equal(released.status, 200, JSON.stringify(released.data));
  await client.waitForTransactionReceipt({ hash: released.data.result });
  assert.equal((await buyer.request('/escrow/' + id + '/sync', {})).data.order.state, 'released');
  const id2 = await demoDeposit('demo-refund');
  for (const [person, address, fn] of [
    [seller, accounts[1], 'markDelivered'],
    [buyer, accounts[2], 'dispute'],
    [seller, accounts[1], 'refund'],
  ]) {
    const r = await send(
      person,
      address,
      encodeFunctionData({ abi: escrowAbi, functionName: fn, args: [id2] }),
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await client.waitForTransactionReceipt({ hash: r.data.result });
  }
  assert.equal((await buyer.request('/escrow/' + id2 + '/sync', {})).data.order.state, 'refunded');
  const out = await send(
    buyer,
    accounts[2],
    encodeFunctionData({ abi: escrowAbi, functionName: 'withdrawRefund' }),
  );
  assert.equal(out.status, 200, JSON.stringify(out.data));
  await client.waitForTransactionReceipt({ hash: out.data.result });
  assert.equal(
    await client.readContract({
      address: market.address,
      abi: escrowAbi,
      functionName: 'refundBalances',
      args: [accounts[2]],
    }),
    0n,
  );
  assert.equal(
    (
      await send(
        seller,
        accounts[1],
        encodeFunctionData({ abi: escrowAbi, functionName: 'resolveDispute', args: [id2, false] }),
      )
    ).status,
    403,
  );
});
