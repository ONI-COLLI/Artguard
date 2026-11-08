import { withLegalFixture } from './fixtures.ts';
import { ensureTermMarketplace } from '../scripts/deploy-term-marketplace.mjs';
import { termMarketplaceAbi } from '../shared/marketplace.ts';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  parseEther,
  zeroHash,
  zeroAddress,
  encodeFunctionData,
  numberToHex,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { localChain, registryAbi } from '../shared/blockchain.ts';
import { createApp } from '../server/app.ts';
import { verifiedFixture, planFixture } from './fixtures.ts';
import { ensureSubscriptions } from '../scripts/deploy-subscriptions.mjs';
import { ensurePromotions } from '../scripts/deploy-promotions.mjs';
import {
  promotionAbi,
  promotionMessage,
  promotionDomain,
  promotionTypes,
  promotionPeriod,
} from '../shared/promotions.ts';
import {
  consentTypes,
  subscriptionAbi,
  subscriptionMessage,
  subscriptionDomain,
  subscriptionTypes,
  subscriptionPeriod,
} from '../shared/platform.ts';
import { LocalBlockchain } from '../server/blockchain.ts';
import { Repository } from '../server/repository.ts';
import { syncAccountingBalances } from '../server/accounting-balances.ts';
import { anvilPath } from '../scripts/anvil.mjs';
import { compileRegistry, compileContract } from '../scripts/contract.mjs';
import { ensureMarketplace } from '../scripts/deploy-marketplace.mjs';
import {
  marketplaceAbi,
  legacyMarketplaceAbi,
  legacyQuoteTypes,
  contractQuote,
  quoteDomain,
  quoteTypes,
} from '../shared/marketplace.ts';

let directory, node, app, base, rpc, publicClient, testClient, deployment, artwork, registration;
const aliceAccount = privateKeyToAccount(generatePrivateKey()),
  bobAccount = privateKeyToAccount(generatePrivateKey());
let aliceWallet, bobWallet;
let market, paidOrder, paidPurchase, subscriptionMarket, promotionMarket;
function client() {
  let cookie = '';
  return {
    async request(path, data, method = data === undefined ? 'GET' : 'POST') {
      const response = await fetch(base + '/api' + path, {
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
      const result = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : await response.text();
      if (path === '/auth/register' && response.status === 201)
        verifiedFixture(app.db, result.user);
      return { status: response.status, data: result };
    },
  };
}
async function setPlan(actor, plan) {
  const state = (await actor.request('/state')).data;
  planFixture(app.db, state.user.id, plan);
  return actor.request('/state');
}
const alice = client(),
  bob = client(),
  guest = client();
async function challenge(actor, account) {
  const result = await actor.request('/wallet/challenge', { address: account.address });
  assert.equal(result.status, 200);
  return { ...result.data, signature: await account.signMessage({ message: result.data.message }) };
}
async function upload(suffix, actor = alice, recipients = []) {
  const f = new FormData();
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1MAAAAASUVORK5CYII=',
    'base64',
  );
  f.append(
    'file',
    new Blob([image, Buffer.from(suffix)], { type: 'image/png' }),
    'local-chain.png',
  );
  for (const [key, value] of Object.entries({
    title: 'Blockchain test ' + suffix,
    description: 'A synthetic image for local blockchain testing.',
    category: 'Illustration',
    price: '12',
    licenses: 'personal',
    rights: 'true',
  }))
    f.append(key, value);
  f.append('recipients', JSON.stringify(recipients));
  const result = await actor.request('/artworks', f);
  assert.equal(result.status, 201);
  return result.data.artwork;
}
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'chain-test-'));
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  rpc = `http://127.0.0.1:${port}`;
  node = spawn(
    anvilPath(),
    ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--no-cors', '--silent'],
    { stdio: 'ignore', windowsHide: true },
  );
  publicClient = createPublicClient({
    chain: localChain,
    transport: http(rpc, { retryCount: 0, timeout: 1000 }),
    pollingInterval: 50,
  });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      await publicClient.getChainId();
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(ready, 'Isolated Anvil node started');
  testClient = createTestClient({ chain: localChain, mode: 'anvil', transport: http(rpc) });
  const deployer = createWalletClient({ chain: localChain, transport: http(rpc) }),
    [account] = await deployer.getAddresses();
  const compiled = await compileRegistry(),
    instanceId = '0x' + randomBytes(32).toString('hex');
  const transactionHash = await deployer.deployContract({
    account,
    ...compiled,
    args: [instanceId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  deployment = { chainId: 31337, address: receipt.contractAddress, instanceId, transactionHash };
  await mkdir(join(directory, 'chain'));
  await writeFile(join(directory, 'chain', 'registry.json'), JSON.stringify(deployment));
  market = await ensureMarketplace(join(directory, 'chain'), deployment, publicClient, deployer);
  subscriptionMarket = await ensureSubscriptions(
    join(directory, 'chain'),
    deployment,
    publicClient,
    deployer,
  );
  promotionMarket = await ensurePromotions(
    join(directory, 'chain'),
    deployment,
    publicClient,
    deployer,
  );
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  aliceWallet = createWalletClient({
    account: aliceAccount,
    chain: localChain,
    transport: http(rpc),
  });
  bobWallet = createWalletClient({ account: bobAccount, chain: localChain, transport: http(rpc) });
  for (const [actor, name] of [
    [alice, 'Alice'],
    [bob, 'Bob'],
  ])
    assert.equal(
      (
        await actor.request('/auth/register', {
          name,
          email: name.toLowerCase() + '@blockchain.test',
          password: 'local-chain-test-password',
        })
      ).status,
      201,
    );
});
after(async () => {
  await app?.close();
  if (node && node.exitCode === null) {
    const stopped = new Promise((r) => node.once('exit', r));
    node.kill();
    await stopped;
  }
  if (directory) {
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve('artifacts') + sep));
    await rm(target, { recursive: true, force: true });
  }
});
test('local chain is real and RPC proxy rejects unlocked-account and admin methods', async () => {
  const status = await guest.request('/blockchain/status');
  assert.equal(status.data.ready, true);
  assert.equal(status.data.chainId, 31337);
  const read = await guest.request('/blockchain/rpc', {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_chainId',
    params: [],
  });
  assert.equal(read.data.result, '0x7a69');
  for (const method of [
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'anvil_impersonateAccount',
    'anvil_setBalance',
  ])
    assert.equal(
      (await guest.request('/blockchain/rpc', { jsonrpc: '2.0', id: 1, method, params: [] }))
        .status,
      403,
    );
  assert.throws(() => new LocalBlockchain(directory, 'https://example.com'), /local development/);
});
test('wallet linking verifies signatures and rejects forgery, expiry, and replay', async () => {
  assert.equal(
    (await guest.request('/wallet/challenge', { address: aliceAccount.address })).status,
    401,
  );
  const forged = await challenge(alice, aliceAccount);
  forged.signature = await bobAccount.signMessage({ message: forged.message });
  assert.equal((await alice.request('/wallet/link', forged)).status, 400);
  const expired = await challenge(alice, aliceAccount);
  app.db.prepare('UPDATE wallet_challenges SET expires_at=0 WHERE nonce=?').run(expired.nonce);
  assert.equal((await alice.request('/wallet/link', expired)).status, 400);
  const valid = await challenge(alice, aliceAccount);
  const linked = await alice.request('/wallet/link', valid);
  assert.equal(linked.status, 200);
  assert.equal(linked.data.user.wallet.address, aliceAccount.address);
  assert.equal((await alice.request('/wallet/link', valid)).status, 400);
});
test('challenges are session-bound and a wallet cannot be claimed by another account', async () => {
  const otherSession = client();
  await otherSession.request('/auth/login', {
    email: 'alice@blockchain.test',
    password: 'local-chain-test-password',
  });
  const v = await challenge(alice, aliceAccount);
  assert.equal((await otherSession.request('/wallet/link', v)).status, 400);
  assert.equal((await alice.request('/wallet/link', v)).status, 200);
  const duplicate = await challenge(bob, aliceAccount);
  assert.equal((await bob.request('/wallet/link', duplicate)).status, 409);
  assert.equal((await bob.request('/wallet/link', await challenge(bob, bobAccount))).status, 200);
});
test('only linked accounts receive test ETH on the local chain', async () => {
  assert.equal((await guest.request('/wallet/fund', {})).status, 401);
  for (const [actor, account] of [
    [alice, aliceAccount],
    [bob, bobAccount],
  ]) {
    const funded = await actor.request('/wallet/fund', {});
    assert.equal(funded.status, 200);
    assert.equal(await publicClient.getBalance({ address: account.address }), parseEther('1'));
  }
});
test('registration requires file ownership, publication, and a linked wallet', async () => {
  artwork = await upload('one');
  assert.equal((await bob.request(`/blockchain/artworks/${artwork.id}/prepare`, {})).status, 404);
  assert.equal((await guest.request(`/blockchain/artworks/${artwork.id}/prepare`, {})).status, 401);
  await alice.request(`/artworks/${artwork.id}`, { status: 'draft' }, 'PATCH');
  assert.equal((await alice.request(`/blockchain/artworks/${artwork.id}/prepare`, {})).status, 409);
  await alice.request(`/artworks/${artwork.id}`, { status: 'published' }, 'PATCH');
  await assert.rejects(
    publicClient.simulateContract({
      account: aliceAccount.address,
      address: deployment.address,
      abi: registryAbi,
      functionName: 'registerArtwork',
      args: [zeroHash, zeroHash],
    }),
  );
});
test('pending transactions stay pending until mined and matching event is verified', async () => {
  const intent = await alice.request(`/blockchain/artworks/${artwork.id}/prepare`, {});
  assert.equal(intent.status, 201);
  registration = intent.data.registration;
  const anotherTab = await alice.request(`/blockchain/artworks/${artwork.id}/prepare`, {});
  assert.equal(anotherTab.status, 201);
  assert.notEqual(anotherTab.data.registration.id, registration.id);
  await testClient.setAutomine(false);
  const transactionHash = await aliceWallet.writeContract({
    address: deployment.address,
    abi: registryAbi,
    functionName: 'registerArtwork',
    args: [registration.fileHash, registration.termsHash],
  });
  const pending = await alice.request(`/blockchain/registrations/${registration.id}/confirm`, {
    transactionHash,
  });
  assert.equal(pending.status, 202);
  assert.equal(pending.data.registration.status, 'pending');
  assert.equal(
    (await bob.request(`/blockchain/registrations/${registration.id}/confirm`, { transactionHash }))
      .status,
    404,
  );
  assert.equal((await alice.request(`/blockchain/artworks/${artwork.id}/prepare`, {})).status, 409);
  await testClient.mine({ blocks: 1 });
  await testClient.setAutomine(true);
  const verified = await alice.request(`/blockchain/registrations/${registration.id}/confirm`, {
    transactionHash,
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.registration.status, 'confirmed');
  registration = verified.data.registration;
  assert.equal(
    (
      await alice.request(`/blockchain/registrations/${registration.id}/confirm`, {
        transactionHash,
      })
    ).status,
    200,
  );
  const state = await guest.request(`/blockchain/artworks/${artwork.id}`);
  assert.equal(state.data.verified, true);
  assert.equal(state.data.pending, null);
  assert.ok(
    (await bob.request('/state')).data.artworks.find((a) => a.id === artwork.id).blockchain,
  );
  await assert.rejects(
    publicClient.simulateContract({
      account: aliceAccount.address,
      address: deployment.address,
      abi: registryAbi,
      functionName: 'registerArtwork',
      args: [registration.fileHash, registration.termsHash],
    }),
  );
});
test('a successful unrelated transaction cannot be used as proof of registration', async () => {
  const second = await upload('two'),
    intent = (await alice.request(`/blockchain/artworks/${second.id}/prepare`, {})).data
      .registration;
  const transactionHash = await aliceWallet.sendTransaction({ to: bobAccount.address, value: 1n });
  const forged = await alice.request(`/blockchain/registrations/${intent.id}/confirm`, {
    transactionHash,
  });
  assert.equal(forged.status, 422);
  assert.equal((await guest.request(`/blockchain/artworks/${second.id}`)).data.record, null);
  const next = (await alice.request(`/blockchain/artworks/${second.id}/prepare`, {})).data
    .registration;
  const wrongSender = await bobWallet.writeContract({
    address: deployment.address,
    abi: registryAbi,
    functionName: 'registerArtwork',
    args: [next.fileHash, next.termsHash],
  });
  assert.equal(
    (
      await alice.request(`/blockchain/registrations/${next.id}/confirm`, {
        transactionHash: wrongSender,
      })
    ).status,
    422,
  );
});
test('registered terms remain a snapshot and draft visibility and deletion rules are preserved', async () => {
  assert.equal((await alice.request(`/artworks/${artwork.id}`, undefined, 'DELETE')).status, 409);
  await alice.request(
    `/artworks/${artwork.id}`,
    { licenses: ['commercial'], status: 'draft' },
    'PATCH',
  );
  assert.equal((await guest.request(`/blockchain/artworks/${artwork.id}`)).status, 404);
  const owner = await alice.request(`/blockchain/artworks/${artwork.id}`);
  assert.equal(owner.data.verified, true);
  assert.equal(owner.data.termsChanged, true);
  await alice.request(`/artworks/${artwork.id}`, { status: 'published' }, 'PATCH');
});
test('wallets and verified records survive restart and stale chain instances are never marked verified', async () => {
  await app.close();
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await alice.request('/state')).data.user.wallet.address, aliceAccount.address);
  assert.equal((await guest.request(`/blockchain/artworks/${artwork.id}`)).data.verified, true);
  await writeFile(
    join(directory, 'chain', 'registry.json'),
    JSON.stringify({ ...deployment, instanceId: '0x' + randomBytes(32).toString('hex') }),
  );
  assert.equal((await guest.request('/blockchain/status')).data.ready, false);
  assert.equal((await guest.request(`/blockchain/artworks/${artwork.id}`)).data.verified, false);
  await writeFile(join(directory, 'chain', 'registry.json'), JSON.stringify(deployment));
  await alice.request('/wallet', undefined, 'DELETE');
  assert.equal((await alice.request('/state')).data.user.wallet, null);
  assert.equal((await guest.request(`/blockchain/artworks/${artwork.id}`)).data.verified, true);
});

test('blockchain quotes require a registered creator and calculate authoritative prices and fees', async () => {
  assert.equal((await guest.request('/blockchain/marketplace')).data.ready, true);
  assert.equal(
    (await alice.request('/wallet/link', await challenge(alice, aliceAccount))).status,
    200,
  );
  await setPlan(alice, 'premium');
  await alice.request(
    `/artworks/${artwork.id}`,
    { licenses: ['personal', 'commercial', 'extended'], price: 12 },
    'PATCH',
  );
  assert.equal(
    (
      await guest.request('/blockchain/checkouts', {
        items: [{ artworkId: artwork.id, license: 'commercial' }],
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await alice.request('/blockchain/checkouts', {
        items: [{ artworkId: artwork.id, license: 'commercial' }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await bob.request('/blockchain/checkouts', {
        items: [{ artworkId: 'quiet-city', license: 'personal' }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await bob.request('/blockchain/checkouts', {
        items: [
          { artworkId: artwork.id, license: 'personal' },
          { artworkId: artwork.id, license: 'extended' },
        ],
      })
    ).status,
    403,
  );
  const prepared = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: artwork.id, license: 'commercial' }],
    amount: 1,
    feeBps: 0,
  });
  assert.equal(prepared.status, 201);
  paidOrder = prepared.data.checkout;
  assert.equal(paidOrder.totalWei, String(parseEther('0.03')));
  assert.equal(paidOrder.items[0].quote.feeBps, 500);
  assert.equal(paidOrder.items[0].feeWei, String(parseEther('0.0015')));
  const reused = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: artwork.id, license: 'commercial' }],
  });
  assert.equal(reused.data.checkout.id, paidOrder.id);
  assert.equal(
    (await bob.request('/purchases', { items: [{ artworkId: artwork.id, license: 'commercial' }] }))
      .status,
    409,
  );
});
test('the contract rejects altered prices, fees, buyer wallets, and unauthorized quote signatures', async () => {
  const item = paidOrder.items[0],
    quote = contractQuote(item.quote),
    baseCall = {
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'buyLicenses',
      account: bobAccount.address,
    };
  for (const changed of [
    { ...quote, amount: 1n },
    { ...quote, feeBps: 0 },
    { ...quote, buyer: aliceAccount.address },
    { ...quote, instanceId: zeroHash },
  ])
    await assert.rejects(
      publicClient.simulateContract({
        ...baseCall,
        args: [[changed], [item.signature]],
        value: changed.amount,
      }),
    );
  const fakeSignature = await bobAccount.signTypedData({
    domain: quoteDomain(market.address),
    types: quoteTypes,
    primaryType: 'Quote',
    message: quote,
  });
  await assert.rejects(
    publicClient.simulateContract({
      ...baseCall,
      args: [[quote], [fakeSignature]],
      value: quote.amount,
    }),
  );
  await assert.rejects(
    publicClient.simulateContract({
      ...baseCall,
      args: [[quote], [item.signature]],
      value: quote.amount - 1n,
    }),
  );
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'hasLicense',
      args: [bobAccount.address, quote.fileHash, quote.licenseType],
    }),
    false,
  );
});
test('licenses and originals are withheld until the actual payment is mined and verified', async () => {
  const item = paidOrder.items[0];
  await testClient.setAutomine(false);
  try {
    const hash = await bobWallet.writeContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'buyLicenses',
      args: [
        paidOrder.items.map((i) => contractQuote(i.quote)),
        paidOrder.items.map((i) => i.signature),
      ],
      value: BigInt(paidOrder.totalWei),
    });
    paidOrder.transactionHash = hash;
    const pending = await bob.request(`/blockchain/checkouts/${paidOrder.id}/confirm`, {
      transactionHash: hash,
    });
    assert.equal(pending.status, 202);
    assert.equal(
      app.db
        .prepare('SELECT count(*) n FROM accounting_events WHERE source_key=?')
        .get('chain:' + item.quote.id).n,
      0,
    );
    assert.equal(
      (await bob.request('/state')).data.purchases.some((p) => p.artworkId === artwork.id),
      false,
    );
    const original = await bob.request(`/artworks/${artwork.id}/download`);
    assert.equal(original.status, 403);
    assert.equal(
      (
        await alice.request(`/blockchain/checkouts/${paidOrder.id}/confirm`, {
          transactionHash: hash,
        })
      ).status,
      404,
    );
    assert.equal((await guest.request(`/blockchain/checkouts/${paidOrder.id}`)).status, 401);
    await testClient.mine({ blocks: 1 });
  } finally {
    await testClient.setAutomine(true);
  }
  // A catalog edit after quote preparation must not change an already authorized price or terms.
  await alice.request(`/artworks/${artwork.id}`, { price: 999, licenses: ['personal'] }, 'PATCH');
  const result = await bob.request(`/blockchain/checkouts/${paidOrder.id}/confirm`, {
    transactionHash: paidOrder.transactionHash,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.checkout.status, 'confirmed');
  paidPurchase = result.data.checkout.purchaseIds[0];
  assert.ok(paidPurchase);
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM accounting_events WHERE purchase_id=?').get(paidPurchase)
      .n,
    1,
  );
  const state = (await bob.request('/state')).data;
  const purchase = state.purchases.find((p) => p.id === paidPurchase);
  assert.equal(purchase.payment.amountWei, paidOrder.totalWei);
  assert.equal(purchase.amount, 30);
  assert.equal(purchase.payment.transactionHash, paidOrder.transactionHash);
  assert.equal(
    (
      await bob.request(`/blockchain/checkouts/${paidOrder.id}/confirm`, {
        transactionHash: paidOrder.transactionHash,
      })
    ).status,
    200,
  );
  assert.equal(
    (await bob.request('/state')).data.purchases.filter((p) => p.id === paidPurchase).length,
    1,
  );
  await assert.rejects(
    publicClient.simulateContract({
      account: bobAccount.address,
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'buyLicenses',
      args: [[contractQuote(item.quote)], [item.signature]],
      value: BigInt(paidOrder.totalWei),
    }),
  );
});
test('public demo discovers and verifies a real purchase without a login or database changes', async () => {
  const before = app.db.prepare('SELECT count(*) n FROM purchases').get().n;
  const response = await guest.request('/blockchain/demo-proof');
  assert.equal(response.status, 200);
  const proof = response.data;
  assert.equal(proof.status, 'verified', proof.message);
  assert.ok(proof.checks.length >= 10);
  assert.ok(proof.checks.every((check) => check.passed));
  assert.equal(proof.transaction.hash, paidOrder.transactionHash);
  assert.equal(proof.transaction.amountWei, paidOrder.totalWei);
  assert.equal(proof.transaction.feeWei, '1500000000000000');
  assert.equal(proof.transaction.licenses[0].owned, true);
  assert.equal(proof.transaction.licenses[0].quoteUsed, true);
  assert.equal(proof.transaction.receipt.status, '0x1');
  assert.equal(proof.transaction.withdrawalScan, 'complete');
  assert.deepEqual(proof.transaction.withdrawals, []);
  assert.equal(app.db.prepare('SELECT count(*) n FROM purchases').get().n, before);
  assert.equal((await guest.request('/state')).data.user, null);
});

test('blockchain license documents preserve payment and terms and originals remain account-private', async () => {
  const other = await alice.request(`/licenses/${paidPurchase}/document`);
  assert.equal(other.status, 404);
  const document = await bob.request(`/licenses/${paidPurchase}/document`);
  assert.equal(document.status, 200);
  assert.match(document.data, /BLOCKCHAIN TEST LICENSE/);
  assert.ok(document.data.includes(paidOrder.transactionHash));
  assert.ok(document.data.includes(paidOrder.items[0].terms));
  assert.match(document.data, /0.03 test ETH/);
  assert.equal((await bob.request(`/artworks/${artwork.id}/download`)).status, 200);
  const row = app.db.prepare('SELECT * FROM purchases WHERE id=?').get(paidPurchase);
  assert.equal(row.amount, 3000);
  assert.equal(
    (await bob.request(`/blockchain/checkouts/${paidOrder.id}`)).data.checkout.items[0].terms,
    paidOrder.items[0].terms,
  );
  const seller = (await alice.request('/state')).data.sales.find((s) => s.id === paidPurchase);
  assert.equal(seller.payment.feeWei, String(parseEther('0.0015')));
  assert.equal(seller.allocations.length, 1);
});
test('creator and platform proceeds are credited exactly once and can be withdrawn by the recipient', async () => {
  const credit = await publicClient.readContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'balances',
    args: [aliceAccount.address],
  });
  assert.equal(credit, parseEther('0.0285'));
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'balances',
      args: [market.treasury],
    }),
    parseEther('0.0015'),
  );
  const before = await publicClient.getBalance({ address: aliceAccount.address });
  const hash = await aliceWallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'withdraw',
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  assert.equal(
    await publicClient.getBalance({ address: aliceAccount.address }),
    before + credit - receipt.gasUsed * receipt.effectiveGasPrice,
  );
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'balances',
      args: [aliceAccount.address],
    }),
    0n,
  );
  await assert.rejects(
    publicClient.simulateContract({
      account: aliceAccount.address,
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'withdraw',
    }),
  );
});
test('public demo distinguishes a real creator withdrawal from outstanding platform credit', async () => {
  const response = await guest.request(
    '/blockchain/demo-proof?transactionHash=' + paidOrder.transactionHash,
  );
  assert.equal(response.status, 200);
  const proof = response.data;
  assert.equal(proof.status, 'verified', proof.message);
  const tx = proof.transaction;
  const withdrawal = tx.withdrawals.find(
    (row) => row.wallet.toLowerCase() === aliceAccount.address.toLowerCase(),
  );
  assert.equal(withdrawal.amountWei, '28500000000000000');
  const receipt = await publicClient.getTransactionReceipt({ hash: withdrawal.transactionHash });
  assert.equal(receipt.status, 'success');
  assert.equal(String(receipt.blockNumber), withdrawal.blockNumber);
  assert.equal(
    tx.credits.find((row) => row.wallet === aliceAccount.address.toLowerCase()).amountWei,
    '0',
  );
  assert.equal(
    tx.credits.find((row) => row.wallet === market.treasury.toLowerCase()).amountWei,
    '1500000000000000',
  );
});

test('an unrelated transaction never issues a license and expired quotes cannot execute', async () => {
  await alice.request(
    `/artworks/${artwork.id}`,
    { price: 12, licenses: ['personal', 'commercial', 'extended'] },
    'PATCH',
  );
  const prepared = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: artwork.id, license: 'personal' }],
  });
  assert.equal(prepared.status, 201);
  const order = prepared.data.checkout;
  const unrelated = await bobWallet.sendTransaction({ to: aliceAccount.address, value: 1n });
  assert.equal(
    (await bob.request(`/blockchain/checkouts/${order.id}/confirm`, { transactionHash: unrelated }))
      .status,
    422,
  );
  assert.equal(
    (await bob.request('/state')).data.purchases.some(
      (p) => p.artworkId === artwork.id && p.license === 'personal',
    ),
    false,
  );
  const snapshot = await testClient.snapshot();
  try {
    await testClient.increaseTime({ seconds: 601 });
    await testClient.mine({ blocks: 1 });
    await assert.rejects(
      publicClient.simulateContract({
        account: bobAccount.address,
        address: market.address,
        abi: marketplaceAbi,
        functionName: 'buyLicenses',
        args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
        value: BigInt(order.totalWei),
      }),
    );
  } finally {
    await testClient.revert({ id: snapshot });
  }
});
test('bulk payment is atomic and failed bundles do not retain funds or issue partial licenses', async () => {
  await setPlan(bob, 'business');
  const items = [
    { artworkId: artwork.id, license: 'personal' },
    { artworkId: artwork.id, license: 'extended' },
  ];
  let result = await bob.request('/blockchain/checkouts', { items });
  assert.equal(result.status, 201);
  let order = result.data.checkout;
  const balance = await publicClient.getBalance({ address: market.address });
  const first = order.items[0],
    old = paidOrder.items[0];
  const revertedHash = await bobWallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'buyLicenses',
    args: [
      [contractQuote(first.quote), contractQuote(old.quote)],
      [first.signature, old.signature],
    ],
    value: BigInt(first.quote.amount) + BigInt(old.quote.amount),
    gas: 1500000n,
  });
  assert.equal(
    (await publicClient.waitForTransactionReceipt({ hash: revertedHash })).status,
    'reverted',
  );
  assert.equal(await publicClient.getBalance({ address: market.address }), balance);
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'hasLicense',
      args: [bobAccount.address, first.quote.fileHash, first.quote.licenseType],
    }),
    false,
  );
  assert.equal(
    (
      await bob.request(`/blockchain/checkouts/${order.id}/confirm`, {
        transactionHash: revertedHash,
      })
    ).status,
    422,
  );
  result = await bob.request('/blockchain/checkouts', { items });
  assert.equal(result.status, 201);
  order = result.data.checkout;
  const hash = await bobWallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'buyLicenses',
    args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
    value: BigInt(order.totalWei),
  });
  const confirmations = await Promise.all(
    [1, 2].map(() =>
      bob.request(`/blockchain/checkouts/${order.id}/confirm`, { transactionHash: hash }),
    ),
  );
  assert.ok(confirmations.every((c) => c.status === 200));
  assert.equal(
    (await bob.request('/state')).data.purchases.filter((p) => p.packageId === order.id).length,
    2,
  );
});
test('a broadcast payment can be recovered from events after an API restart without a stored transaction hash', async () => {
  const third = await upload('payment-recovery');
  const intent = (await alice.request(`/blockchain/artworks/${third.id}/prepare`, {})).data
    .registration;
  const registered = await aliceWallet.writeContract({
    address: deployment.address,
    abi: registryAbi,
    functionName: 'registerArtwork',
    args: [intent.fileHash, intent.termsHash],
  });
  assert.equal(
    (
      await alice.request(`/blockchain/registrations/${intent.id}/confirm`, {
        transactionHash: registered,
      })
    ).status,
    200,
  );
  const order = (
    await bob.request('/blockchain/checkouts', {
      items: [{ artworkId: third.id, license: 'personal' }],
    })
  ).data.checkout;
  const hash = await bobWallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'buyLicenses',
    args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
    value: BigInt(order.totalWei),
  });
  await app.close();
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(
    (await bob.request(`/blockchain/checkouts/${order.id}/recover`, {})).data.transactionHash,
    hash,
  );
  const verified = await bob.request(`/blockchain/checkouts/${order.id}/confirm`, {
    transactionHash: hash,
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.checkout.purchaseIds.length, 1);
  assert.equal(
    (await bob.request('/state')).data.purchases.find((p) => p.id === paidPurchase).payment
      .transactionHash,
    paidOrder.transactionHash,
  );
});

test('a delayed verified payment can upgrade a later free local order without losing either record', async () => {
  const next = await upload('late-payment');
  const intent = (await alice.request(`/blockchain/artworks/${next.id}/prepare`, {})).data
    .registration;
  const registrationHash = await aliceWallet.writeContract({
    address: deployment.address,
    abi: registryAbi,
    functionName: 'registerArtwork',
    args: [intent.fileHash, intent.termsHash],
  });
  assert.equal(
    (
      await alice.request(`/blockchain/registrations/${intent.id}/confirm`, {
        transactionHash: registrationHash,
      })
    ).status,
    200,
  );
  const order = (
    await bob.request('/blockchain/checkouts', {
      items: [{ artworkId: next.id, license: 'personal' }],
    })
  ).data.checkout;
  const hash = await bobWallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'buyLicenses',
    args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
    value: BigInt(order.totalWei),
  });
  // Simulate opening a free local order after expiry while the earlier mined payment remains unreported.
  app.db.prepare('UPDATE chain_checkouts SET expires_at=0 WHERE id=?').run(order.id);
  const local = await bob.request('/purchases', {
    items: [{ artworkId: next.id, license: 'personal' }],
  });
  assert.equal(local.status, 201);
  const localId = local.data.purchases.find((p) => p.artworkId === next.id).id;
  const verified = await bob.request(`/blockchain/checkouts/${order.id}/confirm`, {
    transactionHash: hash,
  });
  assert.equal(verified.status, 200);
  assert.deepEqual(verified.data.checkout.purchaseIds, [localId]);
  assert.equal(
    app.db
      .prepare(
        'SELECT count(*) n FROM accounting_supersessions s JOIN accounting_events e ON e.id=s.local_event_id WHERE e.purchase_id=?',
      )
      .get(localId).n,
    1,
  );
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM accounting_events WHERE purchase_id=?').get(localId).n,
    2,
  );
  const purchases = (await bob.request('/state')).data.purchases.filter(
    (p) => p.artworkId === next.id,
  );
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].payment.transactionHash, hash);
  const journal = app.db
    .prepare('SELECT previous_local_record FROM chain_checkout_items WHERE checkout_id=?')
    .get(order.id);
  assert.equal(JSON.parse(journal.previous_local_record).id, localId);
});

test('the local faucet funds an expensive valid quote and cannot be used for another account', async () => {
  const target = (await alice.request('/state')).data.artworks.find(
    (a) => a.title === 'Blockchain test late-payment',
  );
  await alice.request(
    `/artworks/${target.id}`,
    { price: 100000, licenses: ['personal', 'extended'] },
    'PATCH',
  );
  const prepared = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: target.id, license: 'extended' }],
  });
  assert.equal(prepared.status, 201);
  const order = prepared.data.checkout;
  assert.equal(order.totalWei, String(parseEther('500')));
  assert.equal((await alice.request(`/blockchain/checkouts/${order.id}/fund`, {})).status, 404);
  await testClient.setBalance({ address: market.quoteSigner, value: 1n });
  assert.equal((await bob.request(`/blockchain/checkouts/${order.id}/fund`, {})).status, 200);
  assert.ok(
    (await publicClient.getBalance({ address: bobAccount.address })) >= parseEther('500.01'),
  );
});
const charlieAccount = privateKeyToAccount(generatePrivateKey()),
  danaAccount = privateKeyToAccount(generatePrivateKey());
const charlie = client(),
  dana = client();
async function approveAndPublish(id) {
  const state = (await alice.request('/state')).data,
    project = state.artworks.find((a) => a.id === id);
  const actors = [
    [charlieAccount, charlie],
    [danaAccount, dana],
    [bobAccount, bob],
  ];
  for (const recipient of project.recipients || []) {
    const pair = actors.find(
      ([account]) => account.address.toLowerCase() === recipient.wallet?.toLowerCase(),
    );
    assert.ok(pair, 'Known co-author fixture wallet');
    const [account, actor] = pair;
    const request = await actor.request(`/coauthors/${id}/request`);
    assert.equal(request.status, 200, JSON.stringify(request.data));
    const signature = await account.signTypedData({
      domain: request.data.domain,
      types: consentTypes,
      primaryType: 'RevenueConsent',
      message: request.data.message,
    });
    assert.equal(
      (
        await actor.request(`/coauthors/${id}/approve`, {
          versionId: request.data.versionId,
          signature,
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (await alice.request(`/artworks/${id}`, { status: 'published' }, 'PATCH')).status,
    200,
  );
}
let splitArtwork, splitOrder;
async function registerFile(target, actor = alice, wallet = aliceWallet) {
  const prepared = await actor.request(`/blockchain/artworks/${target.id}/prepare`, {});
  assert.equal(prepared.status, 201);
  const intent = prepared.data.registration;
  const transactionHash = await wallet.writeContract({
    address: deployment.address,
    abi: registryAbi,
    functionName: 'registerArtwork',
    args: [intent.fileHash, intent.termsHash],
  });
  assert.equal(
    (await actor.request(`/blockchain/registrations/${intent.id}/confirm`, { transactionHash }))
      .status,
    200,
  );
}
async function payOrder(order, wallet = bobWallet, abi = marketplaceAbi) {
  const hash = await wallet.writeContract({
    address: order.contractAddress,
    abi,
    functionName: 'buyLicenses',
    args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
    value: BigInt(order.totalWei),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
test('co-author setup validates addresses, duplicates, creator wallets, totals, and legacy missing wallets', async () => {
  await dana.request('/auth/register', {
    name: 'Dana',
    email: 'dana@blockchain.test',
    password: 'local-chain-test-password',
  });
  assert.equal(
    (await dana.request('/wallet/link', await challenge(dana, danaAccount))).status,
    200,
  );
  await charlie.request('/auth/register', {
    name: 'Charlie',
    email: 'charlie@blockchain.test',
    password: 'local-chain-test-password',
  });
  assert.equal(
    (await charlie.request('/wallet/link', await challenge(charlie, charlieAccount))).status,
    200,
  );
  for (const recipients of [
    [{ name: 'Charlie', percent: 20, wallet: 'bad' }],
    [{ name: 'Charlie', percent: 20, wallet: zeroAddress }],
    [{ name: 'Charlie', percent: 20, wallet: aliceAccount.address }],
    [
      { name: 'Charlie', percent: 20, wallet: charlieAccount.address },
      { name: 'Duplicate', percent: 20, wallet: charlieAccount.address.toLowerCase() },
    ],
    [
      { name: 'Charlie', percent: 60, wallet: charlieAccount.address },
      { name: 'Dana', percent: 40, wallet: danaAccount.address },
    ],
    Array.from({ length: 11 }, () => ({ name: 'Someone', percent: 1 })),
  ])
    assert.ok((await alice.request('/recipients', { recipients }, 'PATCH')).status >= 400);
  assert.equal((await guest.request('/recipients', { recipients: [] }, 'PATCH')).status, 401);
  splitArtwork = await upload('coauthor-splits');
  await registerFile(splitArtwork);
  assert.equal(
    (
      await alice.request(
        `/artworks/${splitArtwork.id}`,
        { recipients: [{ name: 'Legacy name only', percent: 20 }] },
        'PATCH',
      )
    ).status,
    200,
  );
  const unavailable = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: splitArtwork.id, license: 'personal' }],
  });
  assert.equal(unavailable.status, 400);
  assert.match(unavailable.data.error, /unavailable/);
});
test('a signed quote freezes multiple co-author wallets and exact shares after fees', async () => {
  const recipients = [
    { name: 'Charlie', percent: 25, wallet: charlieAccount.address },
    { name: 'Dana', percent: 15, wallet: danaAccount.address },
  ];
  assert.equal(
    (await alice.request(`/artworks/${splitArtwork.id}`, { recipients }, 'PATCH')).status,
    200,
  );
  await approveAndPublish(splitArtwork.id);
  const prepared = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: splitArtwork.id, license: 'personal' }],
  });
  assert.equal(prepared.status, 201);
  splitOrder = prepared.data.checkout;
  const item = splitOrder.items[0];
  assert.equal(splitOrder.marketVersion, 2);
  assert.deepEqual(
    item.quote.recipients,
    recipients.map((r) => r.wallet),
  );
  assert.deepEqual(item.quote.shares, [2500, 1500]);
  assert.deepEqual(
    item.allocations.map((a) => a.percent),
    [60, 25, 15],
  );
  assert.deepEqual(
    item.allocations.map((a) => a.amountWei),
    ['6840000000000000', '2850000000000000', '1710000000000000'],
  );
  for (const changed of [
    { ...contractQuote(item.quote), shares: [5000, 1500] },
    { ...contractQuote(item.quote), recipients: [bobAccount.address, danaAccount.address] },
  ])
    await assert.rejects(
      publicClient.simulateContract({
        address: market.address,
        abi: marketplaceAbi,
        functionName: 'buyLicenses',
        account: bobAccount.address,
        args: [[changed], [item.signature]],
        value: BigInt(splitOrder.totalWei),
      }),
    );
  // Editing future settings must not change this quote or its resulting receipt.
  await alice.request(
    `/artworks/${splitArtwork.id}`,
    { recipients: [{ name: 'New recipient', percent: 90, wallet: bobAccount.address }] },
    'PATCH',
  );
  const reused = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: splitArtwork.id, license: 'personal' }],
  });
  assert.equal(reused.data.checkout.id, splitOrder.id);
  assert.deepEqual(reused.data.checkout.items[0].allocations, item.allocations);
  const before = await publicClient.readContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'balances',
    args: [aliceAccount.address],
  });
  const hash = await payOrder(splitOrder);
  const verified = await bob.request(`/blockchain/checkouts/${splitOrder.id}/confirm`, {
    transactionHash: hash,
  });
  assert.equal(verified.status, 200);
  splitOrder = verified.data.checkout;
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'balances',
      args: [aliceAccount.address],
    }),
    before + 6840000000000000n,
  );
  for (const [account, amount] of [
    [charlieAccount, 2850000000000000n],
    [danaAccount, 1710000000000000n],
  ])
    assert.equal(
      await publicClient.readContract({
        address: market.address,
        abi: marketplaceAbi,
        functionName: 'balances',
        args: [account.address],
      }),
      amount,
    );
  const receipt = (await charlie.request('/blockchain/proceeds')).data;
  assert.equal(receipt.amountWei, '2850000000000000');
  assert.equal(receipt.earnings.length, 1);
  assert.equal(receipt.earnings[0].creator, false);
  assert.equal(receipt.earnings[0].percent, 25);
  const document = await bob.request(`/licenses/${splitOrder.purchaseIds[0]}/document`);
  assert.equal(document.data.includes(charlieAccount.address), false);
  assert.equal(document.data.includes('0.00285 test ETH'), false);
  assert.doesNotMatch(document.data, /Platform fee:|Creator credit:|Revenue distribution/);
  const seller = (await alice.request('/state')).data.sales.find(
    (s) => s.id === splitOrder.purchaseIds[0],
  );
  assert.deepEqual(seller.payment.allocations, item.allocations);
  assert.equal(seller.allocations.length, 3);
});
test('public demo verifies every co-author allocation from real contract events', async () => {
  const response = await guest.request(
    '/blockchain/demo-proof?transactionHash=' + splitOrder.transactionHash,
  );
  assert.equal(response.status, 200);
  const proof = response.data;
  assert.equal(proof.status, 'verified', proof.message);
  const tx = proof.transaction;
  assert.equal(tx.allocations.length, 4);
  assert.equal(
    tx.allocations.reduce((sum, row) => sum + BigInt(row.amountWei), 0n),
    BigInt(tx.amountWei),
  );
  for (const [account, amount] of [
    [charlieAccount, '2850000000000000'],
    [danaAccount, '1710000000000000'],
  ]) {
    assert.equal(
      tx.allocations.find((row) => row.wallet.toLowerCase() === account.address.toLowerCase())
        .amountWei,
      amount,
    );
    assert.equal(
      tx.credits.find((row) => row.wallet === account.address.toLowerCase()).amountWei,
      amount,
    );
  }
  assert.deepEqual(tx.withdrawals, []);
});

test('co-authors withdraw their own credit independently and confirmation never double-credits', async () => {
  assert.equal((await charlie.request('/wallet/fund', {})).status, 200);
  const wallet = createWalletClient({
    account: charlieAccount,
    chain: localChain,
    transport: http(rpc),
  });
  const before = await publicClient.getBalance({ address: charlieAccount.address });
  const hash = await wallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'withdraw',
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(
    await publicClient.getBalance({ address: charlieAccount.address }),
    before + 2850000000000000n - receipt.gasUsed * receipt.effectiveGasPrice,
  );
  assert.equal((await charlie.request('/blockchain/proceeds')).data.amountWei, '0');
  assert.equal(
    (
      await bob.request(`/blockchain/checkouts/${splitOrder.id}/confirm`, {
        transactionHash: splitOrder.transactionHash,
      })
    ).status,
    200,
  );
  assert.equal((await charlie.request('/blockchain/proceeds')).data.amountWei, '0');
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'balances',
      args: [danaAccount.address],
    }),
    1710000000000000n,
  );
  await alice.request(`/artworks/${splitArtwork.id}`, { recipients: [] }, 'PATCH');
});
test('public demo shows a co-author withdrawal while the other co-author retains their credit', async () => {
  const response = await guest.request(
    '/blockchain/demo-proof?transactionHash=' + splitOrder.transactionHash,
  );
  const proof = response.data;
  assert.equal(proof.status, 'verified', proof.message);
  const tx = proof.transaction;
  assert.equal(tx.withdrawals.length, 1);
  assert.equal(tx.withdrawals[0].wallet.toLowerCase(), charlieAccount.address.toLowerCase());
  assert.equal(tx.withdrawals[0].amountWei, '2850000000000000');
  assert.equal(
    tx.credits.find((row) => row.wallet === charlieAccount.address.toLowerCase()).amountWei,
    '0',
  );
  assert.equal(
    tx.credits.find((row) => row.wallet === danaAccount.address.toLowerCase()).amountWei,
    '1710000000000000',
  );
});

test('contract validates signed split constraints, conserves rounding, and rolls back every batch credit on error', async () => {
  const signer = createWalletClient({ chain: localChain, transport: http(rpc) });
  const baseQuote = {
    ...contractQuote(splitOrder.items[0].quote),
    licenseType: 3,
    amount: 101n,
    feeBps: 0,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
  };
  const signed = async (changed) => {
    const quote = { ...baseQuote, ...changed, id: '0x' + randomBytes(32).toString('hex') };
    return {
      quote,
      signature: await signer.signTypedData({
        account: market.quoteSigner,
        domain: quoteDomain(market.address),
        types: quoteTypes,
        primaryType: 'Quote',
        message: quote,
      }),
    };
  };
  for (const change of [
    { recipients: [zeroAddress], shares: [2000] },
    { recipients: [aliceAccount.address], shares: [2000] },
    { recipients: [charlieAccount.address, charlieAccount.address], shares: [2000, 2000] },
    { recipients: [charlieAccount.address], shares: [10000] },
    { recipients: [charlieAccount.address], shares: [0] },
    { recipients: [charlieAccount.address], shares: [] },
    { recipients: Array(11).fill(charlieAccount.address), shares: Array(11).fill(1) },
  ]) {
    const bad = await signed(change);
    await assert.rejects(
      publicClient.simulateContract({
        address: market.address,
        abi: marketplaceAbi,
        functionName: 'buyLicenses',
        account: bobAccount.address,
        args: [[bad.quote], [bad.signature]],
        value: 101n,
      }),
    );
  }
  const good = await signed({
    recipients: [charlieAccount.address, danaAccount.address],
    shares: [3333, 3333],
  });
  const bad = await signed({ licenseType: 2, recipients: [zeroAddress], shares: [1] });
  const balances = await Promise.all(
    [aliceAccount, charlieAccount, danaAccount].map((a) =>
      publicClient.readContract({
        address: market.address,
        abi: marketplaceAbi,
        functionName: 'balances',
        args: [a.address],
      }),
    ),
  );
  const failed = await bobWallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'buyLicenses',
    args: [
      [good.quote, bad.quote],
      [good.signature, bad.signature],
    ],
    value: 202n,
    gas: 1000000n,
  });
  assert.equal((await publicClient.waitForTransactionReceipt({ hash: failed })).status, 'reverted');
  assert.deepEqual(
    await Promise.all(
      [aliceAccount, charlieAccount, danaAccount].map((a) =>
        publicClient.readContract({
          address: market.address,
          abi: marketplaceAbi,
          functionName: 'balances',
          args: [a.address],
        }),
      ),
    ),
    balances,
  );
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'usedQuotes',
      args: [good.quote.id],
    }),
    false,
  );
  const hash = await bobWallet.writeContract({
    address: market.address,
    abi: marketplaceAbi,
    functionName: 'buyLicenses',
    args: [[good.quote], [good.signature]],
    value: 101n,
  });
  assert.equal((await publicClient.waitForTransactionReceipt({ hash })).status, 'success');
  const after = await Promise.all(
    [aliceAccount, charlieAccount, danaAccount].map((a) =>
      publicClient.readContract({
        address: market.address,
        abi: marketplaceAbi,
        functionName: 'balances',
        args: [a.address],
      }),
    ),
  );
  assert.deepEqual(
    after.map((n, i) => n - balances[i]),
    [35n, 33n, 33n],
  );
});
test('different project allocations survive editing, defaults changes, and restart and pay the right wallets in one batch', async () => {
  const firstRecipients = [{ name: 'Charlie', wallet: charlieAccount.address, percent: 40 }];
  const secondRecipients = [{ name: 'Dana', wallet: danaAccount.address, percent: 10 }];
  const first = await upload('independent-one', alice, firstRecipients),
    second = await upload('independent-two', alice, secondRecipients);
  await approveAndPublish(first.id);
  await approveAndPublish(second.id);
  await registerFile(first);
  await registerFile(second);
  await alice.request(
    '/recipients',
    { recipients: [{ name: 'Unrelated upload default', wallet: bobAccount.address, percent: 90 }] },
    'PATCH',
  );
  const result = await bob.request('/blockchain/checkouts', {
    items: [
      { artworkId: first.id, license: 'personal' },
      { artworkId: second.id, license: 'personal' },
    ],
  });
  assert.equal(result.status, 201);
  const order = result.data.checkout;
  assert.deepEqual(order.items.find((i) => i.artworkId === first.id).quote.recipients, [
    charlieAccount.address,
  ]);
  assert.deepEqual(order.items.find((i) => i.artworkId === second.id).quote.recipients, [
    danaAccount.address,
  ]);
  assert.equal(
    (
      await alice.request(
        `/artworks/${first.id}`,
        {
          recipients: [{ name: 'Dana', wallet: danaAccount.address, percent: 50 }],
          licenses: ['personal', 'commercial'],
        },
        'PATCH',
      )
    ).status,
    200,
  );
  const accounts = [aliceAccount, charlieAccount, danaAccount];
  const readBalances = () =>
    Promise.all(
      accounts.map((a) =>
        publicClient.readContract({
          address: market.address,
          abi: marketplaceAbi,
          functionName: 'balances',
          args: [a.address],
        }),
      ),
    );
  const before = await readBalances();
  const hash = await payOrder(order);
  const verified = await bob.request(`/blockchain/checkouts/${order.id}/confirm`, {
    transactionHash: hash,
  });
  assert.equal(verified.status, 200);
  const after = await readBalances();
  assert.deepEqual(
    after.map((v, i) => v - before[i]),
    [17100000000000000n, 4560000000000000n, 1140000000000000n],
  );
  await app.close();
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const state = (await alice.request('/state')).data;
  assert.equal(state.artworks.find((a) => a.id === first.id).recipients[0].percent, 50);
  assert.equal(state.artworks.find((a) => a.id === second.id).recipients[0].percent, 10);
  assert.equal(
    state.sales.find((s) => s.artworkId === first.id).payment.allocations.find((a) => !a.creator)
      .wallet,
    charlieAccount.address,
  );
  assert.equal(
    state.sales.find((s) => s.artworkId === first.id).payment.allocations.find((a) => !a.creator)
      .percent,
    40,
  );
  await approveAndPublish(first.id);
  const next = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: first.id, license: 'commercial' }],
  });
  assert.equal(next.status, 201);
  assert.deepEqual(next.data.checkout.items[0].quote.recipients, [danaAccount.address]);
  assert.deepEqual(next.data.checkout.items[0].quote.shares, [5000]);
});
test('public demo verifies a multi-license payment after an API restart', async () => {
  const response = await guest.request('/blockchain/demo-proof');
  const proof = response.data;
  assert.equal(proof.status, 'verified', proof.message);
  assert.equal(proof.transaction.licenses.length, 2);
  assert.equal(proof.transaction.amountWei, '24000000000000000');
  assert.equal(proof.transaction.feeWei, '1200000000000000');
  assert.equal(
    proof.transaction.allocations.reduce((sum, row) => sum + BigInt(row.amountWei), 0n),
    BigInt(proof.transaction.amountWei),
  );
  assert.ok(proof.transaction.licenses.every((license) => license.owned && license.quoteUsed));
});

test('Business quotes charge zero platform fee and retain that fee after a plan change', async () => {
  assert.equal((await setPlan(alice, 'business')).status, 200);
  const target = await upload('business-zero-fee', alice, [
    { name: 'Charlie', wallet: charlieAccount.address, percent: 25 },
  ]);
  await approveAndPublish(target.id);
  await registerFile(target);
  const result = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: target.id, license: 'personal' }],
  });
  assert.equal(result.status, 201);
  const order = result.data.checkout;
  assert.equal(order.items[0].quote.feeBps, 0);
  assert.equal(order.items[0].feeWei, '0');
  assert.deepEqual(
    order.items[0].allocations.map((a) => a.amountWei),
    ['9000000000000000', '3000000000000000'],
  );
  await setPlan(alice, 'premium');
  const accounts = [aliceAccount.address, charlieAccount.address, market.treasury];
  const balances = () =>
    Promise.all(
      accounts.map((address) =>
        publicClient.readContract({
          address: market.address,
          abi: marketplaceAbi,
          functionName: 'balances',
          args: [address],
        }),
      ),
    );
  const before = await balances();
  const hash = await payOrder(order);
  const verified = await bob.request(`/blockchain/checkouts/${order.id}/confirm`, {
    transactionHash: hash,
  });
  assert.equal(verified.status, 200);
  const after = await balances();
  assert.deepEqual(
    after.map((v, i) => v - before[i]),
    [9000000000000000n, 3000000000000000n, 0n],
  );
  const sale = (await alice.request('/state')).data.sales.find((s) => s.artworkId === target.id);
  assert.equal(sale.commission, 0);
  assert.equal(sale.payment.feeWei, '0');
});
test('co-author approvals reject forgery and stale revisions, keep drafts private and preserve prior licenses', async () => {
  await setPlan(alice, 'premium');
  const target = await upload('consent-versions', alice, [
    { name: 'Charlie', wallet: charlieAccount.address, percent: 20 },
    { name: 'Dana', wallet: danaAccount.address, percent: 10 },
  ]);
  assert.equal(target.status, 'draft');
  assert.equal(
    (await guest.request('/state')).data.artworks.some((a) => a.id === target.id),
    false,
  );
  assert.equal((await bob.request(`/coauthors/${target.id}/request`)).status, 404);
  assert.equal(
    (await charlie.request('/coauthors')).data.invitations.some((i) => i.artwork.id === target.id),
    true,
  );
  assert.equal((await charlie.request(`/artworks/${target.id}/download`)).status, 403);
  assert.equal(
    (await bob.request('/purchases', { items: [{ artworkId: target.id, license: 'personal' }] }))
      .status,
    400,
  );
  const request = (await charlie.request(`/coauthors/${target.id}/request`)).data;
  const sign = (account, data) =>
    account.signTypedData({
      domain: data.domain,
      types: consentTypes,
      primaryType: 'RevenueConsent',
      message: data.message,
    });
  const forged = await sign(bobAccount, request);
  assert.equal(
    (
      await charlie.request(`/coauthors/${target.id}/approve`, {
        versionId: request.versionId,
        signature: forged,
      })
    ).status,
    400,
  );
  const signature = await sign(charlieAccount, request);
  assert.equal(
    (
      await charlie.request(`/coauthors/${target.id}/approve`, {
        versionId: request.versionId,
        signature,
      })
    ).status,
    200,
  );
  assert.equal(
    (await charlie.request(`/coauthors/${target.id}/decline`, { versionId: request.versionId }))
      .status,
    409,
  );
  assert.equal(
    (
      await alice.request(`/artworks/${target.id}`, { status: 'published' }, 'PATCH')
    ).data.artworks.find((a) => a.id === target.id).status,
    'draft',
  );
  const danaRequest = (await dana.request(`/coauthors/${target.id}/request`)).data;
  assert.equal(
    (await dana.request(`/coauthors/${target.id}/decline`, { versionId: danaRequest.versionId }))
      .status,
    200,
  );
  assert.equal(
    (await alice.request('/state')).data.artworks.find((a) => a.id === target.id).shareApproval
      .recipients[1].status,
    'declined',
  );
  await approveAndPublish(target.id);
  assert.equal(
    (await bob.request('/state')).data.artworks.some((a) => a.id === target.id),
    true,
  );
  assert.equal(
    (await bob.request('/purchases', { items: [{ artworkId: target.id, license: 'personal' }] }))
      .status,
    201,
  );
  await alice.request(
    `/artworks/${target.id}`,
    {
      recipients: [
        { name: 'Charlie', wallet: charlieAccount.address, percent: 30 },
        { name: 'Dana', wallet: danaAccount.address, percent: 10 },
      ],
    },
    'PATCH',
  );
  const changed = (await alice.request('/state')).data.artworks.find((a) => a.id === target.id);
  assert.equal(changed.status, 'draft');
  assert.notEqual(changed.shareApproval.versionId, request.versionId);
  assert.equal(
    changed.shareApproval.recipients.every((r) => r.status === 'pending'),
    true,
  );
  assert.equal(
    (
      await charlie.request(`/coauthors/${target.id}/approve`, {
        versionId: request.versionId,
        signature,
      })
    ).status,
    409,
  );
  const newest = (await charlie.request(`/coauthors/${target.id}/request`)).data;
  assert.equal(
    (
      await charlie.request(`/coauthors/${target.id}/approve`, {
        versionId: newest.versionId,
        signature,
      })
    ).status,
    400,
  );
  assert.equal((await bob.request(`/artworks/${target.id}/download`)).status, 200);
  assert.equal(
    (await guest.request('/state')).data.artworks.some((a) => a.id === target.id),
    false,
  );
  await approveAndPublish(target.id);
  assert.equal((await alice.request('/wallet', undefined, 'DELETE')).status, 200);
  assert.equal(
    (await guest.request('/state')).data.artworks.some((a) => a.id === target.id),
    false,
  );
  assert.equal((await charlie.request(`/coauthors/${target.id}/request`)).status, 409);
  assert.equal(
    (await alice.request('/wallet/link', await challenge(alice, aliceAccount))).status,
    200,
  );
  assert.equal(
    (await alice.request('/state')).data.artworks.find((a) => a.id === target.id).shareApproval
      .ready,
    false,
  );
  await approveAndPublish(target.id);
});

const subscriber = client(),
  subscriberAccount = privateKeyToAccount(generatePrivateKey());
let subscriberWallet, subscriptionOrder, firstUntil;
test('subscription quotes are account-private, tamper-resistant and activate only after mined payment', async () => {
  await subscriber.request('/auth/register', {
    name: 'Subscriber',
    email: 'subscriber@blockchain.test',
    password: 'local-chain-test-password',
  });
  assert.equal((await subscriber.request('/billing/orders', { plan: 'premium' })).status, 400);
  assert.equal(
    (await subscriber.request('/wallet/link', await challenge(subscriber, subscriberAccount)))
      .status,
    200,
  );
  subscriberWallet = createWalletClient({
    account: subscriberAccount,
    chain: localChain,
    transport: http(rpc),
  });
  const prepared = await subscriber.request('/billing/orders', { plan: 'premium' });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  subscriptionOrder = prepared.data.order;
  assert.equal(subscriptionOrder.quote.amount, '10000000000000000');
  assert.equal(
    (await subscriber.request('/billing/orders', { plan: 'premium' })).data.order.id,
    subscriptionOrder.id,
  );
  assert.equal((await subscriber.request('/billing/orders', { plan: 'business' })).status, 409);
  assert.equal((await bob.request(`/billing/orders/${subscriptionOrder.id}/fund`, {})).status, 404);
  assert.equal(
    (await subscriber.request(`/billing/orders/${subscriptionOrder.id}/fund`, {})).status,
    200,
  );
  const q = subscriptionMessage(subscriptionOrder.quote),
    address = subscriptionOrder.contractAddress;
  for (const patch of [
    { amount: 1n },
    { plan: 2 },
    { buyer: bobAccount.address },
    { accountId: zeroHash },
    { instanceId: zeroHash },
    { expectedUntil: 1n },
  ])
    await assert.rejects(
      publicClient.simulateContract({
        account: subscriberAccount.address,
        address,
        abi: subscriptionAbi,
        functionName: 'purchase',
        args: [{ ...q, ...patch }, subscriptionOrder.signature],
        value: q.amount,
      }),
    );
  await assert.rejects(
    publicClient.simulateContract({
      account: bobAccount.address,
      address,
      abi: subscriptionAbi,
      functionName: 'purchase',
      args: [q, subscriptionOrder.signature],
      value: q.amount,
    }),
  );
  await assert.rejects(
    publicClient.simulateContract({
      account: subscriberAccount.address,
      address,
      abi: subscriptionAbi,
      functionName: 'purchase',
      args: [q, subscriptionOrder.signature],
      value: q.amount - 1n,
    }),
  );
  const forged = await bobAccount.signTypedData({
    domain: subscriptionDomain(address),
    types: subscriptionTypes,
    primaryType: 'Quote',
    message: q,
  });
  await assert.rejects(
    publicClient.simulateContract({
      account: subscriberAccount.address,
      address,
      abi: subscriptionAbi,
      functionName: 'purchase',
      args: [q, forged],
      value: q.amount,
    }),
  );
  await testClient.setAutomine(false);
  let hash;
  try {
    hash = await subscriberWallet.writeContract({
      address,
      abi: subscriptionAbi,
      functionName: 'purchase',
      args: [q, subscriptionOrder.signature],
      value: q.amount,
    });
    assert.equal(
      (
        await subscriber.request(`/billing/orders/${subscriptionOrder.id}/confirm`, {
          transactionHash: hash,
        })
      ).status,
      202,
    );
    assert.equal((await subscriber.request('/state')).data.user.plan, 'free');
    assert.equal(
      (
        await bob.request(`/billing/orders/${subscriptionOrder.id}/confirm`, {
          transactionHash: hash,
        })
      ).status,
      404,
    );
    await testClient.mine({ blocks: 1 });
  } finally {
    await testClient.setAutomine(true);
  }
  const paid = await subscriber.request(`/billing/orders/${subscriptionOrder.id}/confirm`, {
    transactionHash: hash,
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.subscription.plan, 'premium');
  const receipt = await publicClient.getTransactionReceipt({ hash }),
    block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  firstUntil = paid.data.subscription.validUntil;
  assert.equal(firstUntil, Number(block.timestamp) + subscriptionPeriod);
  assert.equal((await subscriber.request('/state')).data.user.plan, 'premium');
  assert.equal(
    await publicClient.readContract({
      address,
      abi: subscriptionAbi,
      functionName: 'balances',
      args: [subscriptionMarket.treasury],
    }),
    q.amount,
  );
  assert.equal(
    (
      await subscriber.request(`/billing/orders/${subscriptionOrder.id}/confirm`, {
        transactionHash: hash,
      })
    ).data.subscription.validUntil,
    firstUntil,
  );
  await assert.rejects(
    publicClient.simulateContract({
      account: subscriberAccount.address,
      address,
      abi: subscriptionAbi,
      functionName: 'purchase',
      args: [q, subscriptionOrder.signature],
      value: q.amount,
    }),
  );
});

test('subscription cancellation retains prepaid access and renewal recovery survives restart without double-credit', async () => {
  assert.equal((await subscriber.request('/billing/orders', { plan: 'business' })).status, 409);
  const cancelled = await subscriber.request('/billing/cancel', {});
  assert.equal(cancelled.data.subscription.cancelAtEnd, true);
  assert.equal(cancelled.data.subscription.validUntil, firstUntil);
  assert.equal(cancelled.data.subscription.plan, 'premium');
  assert.equal((await subscriber.request('/billing/orders', { plan: 'premium' })).status, 409);
  assert.equal(
    (await subscriber.request('/billing/resume', {})).data.subscription.cancelAtEnd,
    false,
  );
  const renewed = await subscriber.request('/billing/orders', { plan: 'premium' });
  assert.equal(renewed.status, 201);
  const order = renewed.data.order,
    q = subscriptionMessage(order.quote);
  assert.equal(q.expectedUntil, BigInt(firstUntil));
  await subscriber.request(`/billing/orders/${order.id}/fund`, {});
  const hash = await subscriberWallet.writeContract({
    address: order.contractAddress,
    abi: subscriptionAbi,
    functionName: 'purchase',
    args: [q, order.signature],
    value: q.amount,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await app.close();
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(
    (await subscriber.request(`/billing/orders/${order.id}/recover`, {})).data.transactionHash,
    hash,
  );
  const confirmed = await Promise.all([
    subscriber.request(`/billing/orders/${order.id}/confirm`, { transactionHash: hash }),
    subscriber.request(`/billing/orders/${order.id}/confirm`, { transactionHash: hash }),
  ]);
  assert.deepEqual(
    confirmed.map((r) => r.status),
    [200, 200],
  );
  assert.equal(confirmed[0].data.subscription.validUntil, firstUntil + subscriptionPeriod);
  assert.equal(
    await publicClient.readContract({
      address: order.contractAddress,
      abi: subscriptionAbi,
      functionName: 'balances',
      args: [subscriptionMarket.treasury],
    }),
    parseEther('0.02'),
  );
  assert.equal(
    (
      await subscriber.request(`/billing/orders/${subscriptionOrder.id}/confirm`, {
        transactionHash: (await subscriber.request('/billing')).data.orders.find(
          (o) => o.id === subscriptionOrder.id,
        ).transactionHash,
      })
    ).data.subscription.validUntil,
    firstUntil + subscriptionPeriod,
  );
});

test('unrelated receipts never grant a subscription; Business costs 0.05 test ETH and treasury withdraws once', async () => {
  const actor = client(),
    account = privateKeyToAccount(generatePrivateKey());
  await actor.request('/auth/register', {
    name: 'Business buyer',
    email: 'business-buyer@blockchain.test',
    password: 'local-chain-test-password',
  });
  await actor.request('/wallet/link', await challenge(actor, account));
  const prepared = await actor.request('/billing/orders', { plan: 'business' }),
    order = prepared.data.order;
  assert.equal(order.quote.amount, '50000000000000000');
  await actor.request(`/billing/orders/${order.id}/fund`, {});
  const wallet = createWalletClient({ account, chain: localChain, transport: http(rpc) }),
    unrelated = await wallet.sendTransaction({ to: account.address, value: 0n });
  await publicClient.waitForTransactionReceipt({ hash: unrelated });
  assert.equal(
    (await actor.request(`/billing/orders/${order.id}/confirm`, { transactionHash: unrelated }))
      .status,
    422,
  );
  assert.equal((await actor.request('/state')).data.user.plan, 'free');
  const fresh = (await actor.request('/billing/orders', { plan: 'business' })).data.order;
  const hash = await wallet.writeContract({
    address: fresh.contractAddress,
    abi: subscriptionAbi,
    functionName: 'purchase',
    args: [subscriptionMessage(fresh.quote), fresh.signature],
    value: BigInt(fresh.quote.amount),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(
    (await actor.request(`/billing/orders/${fresh.id}/confirm`, { transactionHash: hash })).data
      .subscription.plan,
    'business',
  );
  assert.equal(
    await publicClient.readContract({
      address: fresh.contractAddress,
      abi: subscriptionAbi,
      functionName: 'balances',
      args: [subscriptionMarket.treasury],
    }),
    parseEther('0.07'),
  );
  const deployer = createWalletClient({ chain: localChain, transport: http(rpc) }),
    [treasury] = await deployer.getAddresses();
  const withdrawn = await deployer.writeContract({
    account: treasury,
    address: fresh.contractAddress,
    abi: subscriptionAbi,
    functionName: 'withdraw',
  });
  assert.equal(
    (await publicClient.waitForTransactionReceipt({ hash: withdrawn })).status,
    'success',
  );
  assert.equal(
    await publicClient.readContract({
      address: fresh.contractAddress,
      abi: subscriptionAbi,
      functionName: 'balances',
      args: [treasury],
    }),
    0n,
  );
  await assert.rejects(
    publicClient.simulateContract({
      account: treasury,
      address: fresh.contractAddress,
      abi: subscriptionAbi,
      functionName: 'withdraw',
    }),
  );
});

test('subscription contract rejects expired quotes and switches plans only after the paid period expires', async () => {
  const snapshot = await testClient.snapshot(),
    deployer = createWalletClient({ chain: localChain, transport: http(rpc) }),
    [account] = await deployer.getAddresses(),
    address = subscriptionMarket.address;
  const sign = (q) =>
    deployer.signTypedData({
      account,
      domain: subscriptionDomain(address),
      types: subscriptionTypes,
      primaryType: 'Quote',
      message: q,
    });
  const original = subscriptionMessage(subscriptionOrder.quote);
  const current = await publicClient.readContract({
    address,
    abi: subscriptionAbi,
    functionName: 'subscriptions',
    args: [original.accountId],
  });
  const block = await publicClient.getBlock();
  let q = {
    ...original,
    id: '0x' + randomBytes(32).toString('hex'),
    plan: 2,
    amount: parseEther('0.05'),
    expectedUntil: current[1],
    expiresAt: block.timestamp + 600n,
  };
  try {
    await assert.rejects(
      publicClient.simulateContract({
        account: subscriberAccount.address,
        address,
        abi: subscriptionAbi,
        functionName: 'purchase',
        args: [q, await sign(q)],
        value: q.amount,
      }),
    );
    const expired = { ...q, plan: 1, amount: parseEther('0.01'), expiresAt: block.timestamp - 1n };
    await assert.rejects(
      publicClient.simulateContract({
        account: subscriberAccount.address,
        address,
        abi: subscriptionAbi,
        functionName: 'purchase',
        args: [expired, await sign(expired)],
        value: expired.amount,
      }),
    );
    await testClient.setNextBlockTimestamp({ timestamp: current[1] + 1n });
    await testClient.mine({ blocks: 1 });
    q = { ...q, expiresAt: current[1] + 601n };
    await testClient.setBalance({ address: subscriberAccount.address, value: parseEther('1') });
    const hash = await subscriberWallet.writeContract({
      address,
      abi: subscriptionAbi,
      functionName: 'purchase',
      args: [q, await sign(q)],
      value: q.amount,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash }),
      paidBlock = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const updated = await publicClient.readContract({
      address,
      abi: subscriptionAbi,
      functionName: 'subscriptions',
      args: [q.accountId],
    });
    assert.equal(updated[0], 2);
    assert.equal(updated[1], paidBlock.timestamp + BigInt(subscriptionPeriod));
  } finally {
    await testClient.revert({ id: snapshot });
  }
});

test('accounting conserves exact verified proceeds and records wallet and treasury credits at one block', async () => {
  const userId = (await alice.request('/state')).data.user.id;
  app.db
    .prepare('INSERT OR IGNORE INTO manager_accounts VALUES(?,?)')
    .run(userId, new Date().toISOString());
  const summary = (await alice.request('/admin/accounting')).data;
  const items = app.db
    .prepare(
      "SELECT i.amount_wei,i.fee_wei FROM chain_checkout_items i JOIN chain_checkouts c ON c.id=i.checkout_id WHERE c.status='confirmed'",
    )
    .all();
  const gross = items.reduce((n, i) => n + BigInt(i.amount_wei), 0n),
    fees = items.reduce((n, i) => n + BigInt(i.fee_wei), 0n),
    totals = summary.totals.test_eth;
  assert.equal(BigInt(totals.gross), gross);
  assert.equal(BigInt(totals.commission), fees);
  assert.equal(BigInt(totals.creatorNet) + BigInt(totals.coauthorNet), gross - fees);
  assert.equal(totals.subscriptions, String(parseEther('0.07')));
  assert.equal(BigInt(totals.platformRevenue), fees + parseEther('0.07'));
  const exportBefore = (await alice.request('/admin/accounting/export')).data;
  assert.equal(exportBefore.events.filter((e) => e.purchaseId === paidPurchase).length, 1);
  const result = await alice.request('/admin/accounting/sync', {});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const snapshot = result.data.snapshot,
    blockNumber = BigInt(snapshot.blockNumber);
  assert.equal(snapshot.instanceId, deployment.instanceId);
  assert.equal(snapshot.blockHash, (await publicClient.getBlock({ blockNumber })).hash);
  for (const wallet of snapshot.wallets) {
    assert.equal(
      wallet.nativeWei,
      String(await publicClient.getBalance({ address: wallet.address, blockNumber })),
    );
    for (const credit of wallet.contracts)
      assert.equal(
        credit.creditWei,
        String(
          await publicClient.readContract({
            address: credit.address,
            abi: credit.kind === 'subscription' ? subscriptionAbi : marketplaceAbi,
            functionName: 'balances',
            args: [wallet.address],
            blockNumber,
          }),
        ),
      );
  }
  assert.equal(
    snapshot.platform.subscriptionWei,
    '0',
    'Previously withdrawn subscription revenue is still earned, but no longer available',
  );
  const after = (await alice.request('/admin/accounting')).data;
  assert.equal(after.totals.test_eth.subscriptions, totals.subscriptions);
  assert.equal(after.balanceSnapshot.id, snapshot.id);
  const charlieUser = (
    await alice.request('/admin/accounting?view=users&q=charlie@blockchain.test')
  ).data.items[0];
  assert.ok(BigInt(charlieUser.earned.test_eth) > 0n);
  assert.ok(charlieUser.walletHistory.length);
  const stored = app.db.prepare('SELECT count(*) n FROM accounting_balance_snapshots').get().n;
  await assert.rejects(
    syncAccountingBalances(
      new Repository(app.db),
      new LocalBlockchain(directory, 'http://127.0.0.1:1'),
    ),
  );
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM accounting_balance_snapshots').get().n,
    stored,
  );
});

test('provisioned demo wallets sign current consents, pay real licenses and subscriptions, recover hashes and withdraw without accessing other wallets', async () => {
  const creator = client(),
    buyer = client(),
    coauthor = client();
  const nodeWallet = createWalletClient({ chain: localChain, transport: http(rpc) });
  const addresses = await nodeWallet.getAddresses();
  const repo = new Repository(app.db);
  repo.run('INSERT INTO platform_meta VALUES(?,?)', 'demo_chain_instance', deployment.instanceId);
  for (const [actor, key, address] of [
    [creator, 'creator', addresses[1]],
    [buyer, 'buyer', addresses[2]],
    [coauthor, 'coauthor', addresses[3]],
  ]) {
    const registered = await actor.request('/auth/register', {
      name: 'Demo ' + key,
      email: key + '@demo-wallet.test',
      password: 'demo-wallet-test-password',
    });
    assert.equal(registered.status, 201);
    repo.run(
      'INSERT INTO platform_meta VALUES(?,?)',
      'demo_account:' + key,
      registered.data.user.id,
    );
    const challenge = await actor.request('/wallet/challenge', { address });
    const signature = await nodeWallet.signMessage({
      account: address,
      message: challenge.data.message,
    });
    assert.equal(
      (await actor.request('/wallet/link', { nonce: challenge.data.nonce, signature })).status,
      200,
    );
    repo.run('INSERT INTO platform_meta VALUES(?,?)', 'demo_wallet:' + key, address);
  }
  assert.equal((await guest.request('/demo/wallet')).data.available, false);
  const ordinary = client();
  await ordinary.request('/auth/register', {
    name: 'Ordinary user',
    email: 'ordinary@demo-wallet.test',
    password: 'demo-wallet-test-password',
  });
  assert.equal(
    (await ordinary.request('/demo/wallet/rpc', { method: 'eth_accounts', params: [] })).status,
    403,
  );
  assert.equal(
    (await guest.request('/demo/wallet/rpc', { method: 'eth_accounts', params: [] })).status,
    401,
  );
  assert.equal(
    (await creator.request('/demo/wallet')).data.address.toLowerCase(),
    addresses[1].toLowerCase(),
  );
  const profiles = await guest.request('/demo/profiles');
  assert.equal(profiles.data.profiles.find((p) => p.key === 'creator').ready, true);
  assert.equal(
    profiles.data.profiles.some((p) => 'password' in p),
    false,
  );
  const rpcRequest = (actor, method, params) =>
    actor.request('/demo/wallet/rpc', { method, params });
  const send = (actor, from, to, data, value = 0n) =>
    rpcRequest(actor, 'eth_sendTransaction', [
      { from, to, data, value: numberToHex(value), chainId: '0x7a69' },
    ]);
  assert.equal(
    (await rpcRequest(creator, 'personal_sign', [toHex('arbitrary message'), addresses[1]])).status,
    403,
  );
  const proof = await creator.request('/wallet/challenge', { address: addresses[1] });
  assert.equal(
    (await rpcRequest(buyer, 'personal_sign', [toHex(proof.data.message), addresses[1]])).status,
    403,
  );
  const signed = await rpcRequest(creator, 'personal_sign', [
    toHex(proof.data.message),
    addresses[1],
  ]);
  assert.equal(signed.status, 200);
  assert.equal(
    (
      await creator.request('/wallet/link', {
        nonce: proof.data.nonce,
        signature: signed.data.result,
      })
    ).status,
    200,
  );
  assert.equal((await send(creator, addresses[2], addresses[1], '0x', 1n)).status, 403);
  assert.equal((await send(creator, addresses[1], addresses[2], '0x', 1n)).status, 403);
  assert.equal(
    (await rpcRequest(creator, 'anvil_setBalance', [addresses[1], '0xffff'])).status,
    403,
  );
  const project = await upload('demo-wallet-real-flow', creator, [
    { name: 'Demo Coauthor', wallet: addresses[3], percent: 25 },
  ]);
  const consent = (await coauthor.request(`/coauthors/${project.id}/request`)).data;
  const typed = {
    domain: consent.domain,
    types: consentTypes,
    primaryType: 'RevenueConsent',
    message: consent.message,
  };
  assert.equal(
    (
      await rpcRequest(coauthor, 'eth_signTypedData_v4', [
        addresses[3],
        JSON.stringify({ ...typed, message: { ...typed.message, shareBps: 9900 } }),
      ])
    ).status,
    403,
  );
  assert.equal(
    (await rpcRequest(buyer, 'eth_signTypedData_v4', [addresses[2], JSON.stringify(typed)])).status,
    404,
  );
  const signedConsent = await rpcRequest(coauthor, 'eth_signTypedData_v4', [
    addresses[3],
    JSON.stringify(typed),
  ]);
  assert.equal(signedConsent.status, 200);
  assert.equal(
    (
      await coauthor.request(`/coauthors/${project.id}/approve`, {
        versionId: consent.versionId,
        signature: signedConsent.data.result,
      })
    ).status,
    200,
  );
  assert.equal(
    (await creator.request(`/artworks/${project.id}`, { status: 'published' }, 'PATCH')).status,
    200,
  );
  const registration = (await creator.request(`/blockchain/artworks/${project.id}/prepare`, {}))
    .data.registration;
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: 'registerArtwork',
    args: [registration.fileHash, registration.termsHash],
  });
  assert.equal((await send(buyer, addresses[2], deployment.address, data)).status, 403);
  const registered = await send(creator, addresses[1], deployment.address, data);
  assert.equal(registered.status, 200);
  await publicClient.waitForTransactionReceipt({ hash: registered.data.result });
  assert.equal(
    (
      await creator.request(`/blockchain/registrations/${registration.id}/confirm`, {
        transactionHash: registered.data.result,
      })
    ).status,
    200,
  );
  const order = (
    await buyer.request('/blockchain/checkouts', {
      items: [{ artworkId: project.id, license: 'personal' }],
    })
  ).data.checkout;
  assert.ok(order);
  const buyData = encodeFunctionData({
    abi: marketplaceAbi,
    functionName: 'buyLicenses',
    args: [order.items.map((i) => contractQuote(i.quote)), order.items.map((i) => i.signature)],
  });
  assert.equal(
    (await send(buyer, addresses[2], order.contractAddress, buyData, BigInt(order.totalWei) + 1n))
      .status,
    403,
  );
  const paid = await send(
    buyer,
    addresses[2],
    order.contractAddress,
    buyData,
    BigInt(order.totalWei),
  );
  assert.equal(paid.status, 200);
  const saved = repo.one('SELECT status,tx_hash FROM chain_checkouts WHERE id=?', order.id);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.tx_hash, paid.data.result);
  const repeated = await send(
    buyer,
    addresses[2],
    order.contractAddress,
    buyData,
    BigInt(order.totalWei),
  );
  assert.equal(repeated.data.result, paid.data.result);
  await publicClient.waitForTransactionReceipt({ hash: paid.data.result });
  assert.equal(
    (
      await buyer.request(`/blockchain/checkouts/${order.id}/confirm`, {
        transactionHash: paid.data.result,
      })
    ).status,
    200,
  );
  assert.equal((await coauthor.request('/blockchain/proceeds')).data.amountWei, '2700000000000000');
  assert.equal((await creator.request('/blockchain/proceeds')).data.amountWei, '8100000000000000');
  const withdraw = encodeFunctionData({ abi: marketplaceAbi, functionName: 'withdraw' });
  const oldBalance = await publicClient.getBalance({ address: addresses[3] });
  const withdrawn = await send(coauthor, addresses[3], market.address, withdraw);
  assert.equal(withdrawn.status, 200);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawn.data.result });
  assert.equal(receipt.status, 'success');
  assert.equal(
    await publicClient.getBalance({ address: addresses[3] }),
    oldBalance + 2700000000000000n - receipt.gasUsed * receipt.effectiveGasPrice,
  );
  assert.equal((await coauthor.request('/blockchain/proceeds')).data.amountWei, '0');
  assert.equal((await send(coauthor, addresses[3], market.address, withdraw)).status, 409);
  const subscription = (await creator.request('/billing/orders', { plan: 'premium' })).data.order;
  const purchaseData = encodeFunctionData({
    abi: subscriptionAbi,
    functionName: 'purchase',
    args: [subscriptionMessage(subscription.quote), subscription.signature],
  });
  const subscriptionPaid = await send(
    creator,
    addresses[1],
    subscription.contractAddress,
    purchaseData,
    BigInt(subscription.quote.amount),
  );
  assert.equal(subscriptionPaid.status, 200);
  await publicClient.waitForTransactionReceipt({ hash: subscriptionPaid.data.result });
  assert.equal(
    (
      await creator.request(`/billing/orders/${subscription.id}/confirm`, {
        transactionHash: subscriptionPaid.data.result,
      })
    ).status,
    200,
  );
  assert.equal((await creator.request('/state')).data.user.plan, 'premium');
  const promotion = (await creator.request('/promotions/orders', { artworkId: project.id })).data
    .order;
  assert.ok(promotion, 'Demo creator can prepare a promotion');
  const promotionData = encodeFunctionData({
    abi: promotionAbi,
    functionName: 'purchase',
    args: [promotionMessage(promotion.quote), promotion.signature],
  });
  assert.equal(
    (
      await send(
        buyer,
        addresses[2],
        promotion.contractAddress,
        promotionData,
        BigInt(promotion.quote.amount),
      )
    ).status,
    403,
  );
  assert.equal(
    (await send(creator, addresses[1], promotion.contractAddress, promotionData, 1n)).status,
    403,
  );
  const promoted = await send(
    creator,
    addresses[1],
    promotion.contractAddress,
    promotionData,
    BigInt(promotion.quote.amount),
  );
  assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
  assert.equal(
    repo.one('SELECT tx_hash FROM promotion_orders WHERE id=?', promotion.id).tx_hash,
    promoted.data.result,
  );
  assert.equal(
    (
      await send(
        creator,
        addresses[1],
        promotion.contractAddress,
        promotionData,
        BigInt(promotion.quote.amount),
      )
    ).data.result,
    promoted.data.result,
  );
  await publicClient.waitForTransactionReceipt({ hash: promoted.data.result });
  assert.equal(
    (
      await creator.request(`/promotions/orders/${promotion.id}/confirm`, {
        transactionHash: promoted.data.result,
      })
    ).status,
    200,
  );
  repo.run("UPDATE platform_meta SET value=? WHERE key='demo_chain_instance'", zeroHash);
  assert.equal(
    (await send(buyer, addresses[2], order.contractAddress, buyData, BigInt(order.totalWei)))
      .status,
    409,
  );
  repo.run(
    "UPDATE platform_meta SET value=? WHERE key='demo_chain_instance'",
    deployment.instanceId,
  );
});

test('paid promotions require project ownership, exact payment and a verified event, then renew and record service revenue once', async () => {
  await setPlan(alice, 'business');
  const project = await upload('paid-promotion');
  assert.equal((await guest.request('/promotions/orders', { artworkId: project.id })).status, 401);
  assert.equal((await bob.request('/promotions/orders', { artworkId: project.id })).status, 404);
  assert.equal((await bob.request('/promotions?artworkId=' + project.id)).status, 404);
  await alice.request(`/artworks/${project.id}`, { status: 'draft' }, 'PATCH');
  assert.equal((await alice.request('/promotions/orders', { artworkId: project.id })).status, 409);
  await alice.request(`/artworks/${project.id}`, { status: 'published' }, 'PATCH');
  const before = (await alice.request('/admin/accounting')).data;
  const prepared = await alice.request('/promotions/orders', {
    artworkId: project.id,
    amount: '1',
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const order = prepared.data.order,
    q = promotionMessage(order.quote);
  assert.equal(order.quote.amount, '5000000000000000');
  assert.equal(
    (await alice.request('/promotions/orders', { artworkId: project.id })).data.order.id,
    order.id,
  );
  assert.equal((await bob.request(`/promotions/orders/${order.id}/fund`, {})).status, 404);
  assert.equal(
    (await bob.request(`/promotions/orders/${order.id}/confirm`, { transactionHash: zeroHash }))
      .status,
    404,
  );
  assert.equal(
    (await guest.request('/promotions/featured')).data.featured.some(
      (p) => p.artworkId === project.id,
    ),
    false,
  );
  const simulate = (
    quote,
    signature = order.signature,
    value = quote.amount,
    account = aliceAccount.address,
  ) =>
    publicClient.simulateContract({
      address: order.contractAddress,
      abi: promotionAbi,
      functionName: 'purchase',
      account,
      args: [quote, signature],
      value,
    });
  await assert.rejects(simulate({ ...q, projectId: zeroHash }));
  await assert.rejects(simulate({ ...q, buyer: bobAccount.address }));
  await assert.rejects(simulate(q, order.signature, 1n));
  const nodeWallet = createWalletClient({ chain: localChain, transport: http(rpc) }),
    [signer] = await nodeWallet.getAddresses();
  const badPrice = { ...q, amount: parseEther('0.006') };
  const badSignature = await nodeWallet.signTypedData({
    account: signer,
    domain: promotionDomain(order.contractAddress),
    types: promotionTypes,
    primaryType: 'Quote',
    message: badPrice,
  });
  await assert.rejects(simulate(badPrice, badSignature));
  const expired = { ...q, expiresAt: 0n };
  const expiredSignature = await nodeWallet.signTypedData({
    account: signer,
    domain: promotionDomain(order.contractAddress),
    types: promotionTypes,
    primaryType: 'Quote',
    message: expired,
  });
  await assert.rejects(simulate(expired, expiredSignature));
  const hash = await aliceWallet.writeContract({
    address: order.contractAddress,
    abi: promotionAbi,
    functionName: 'purchase',
    args: [q, order.signature],
    value: q.amount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash }),
    block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(
    (await guest.request('/promotions/featured')).data.featured.some(
      (p) => p.artworkId === project.id,
    ),
    false,
  );
  assert.equal(
    (await alice.request(`/promotions/orders/${order.id}/recover`, {})).data.transactionHash,
    hash,
  );
  const confirmed = await Promise.all([
    alice.request(`/promotions/orders/${order.id}/confirm`, { transactionHash: hash }),
    alice.request(`/promotions/orders/${order.id}/confirm`, { transactionHash: hash }),
  ]);
  assert.deepEqual(
    confirmed.map((r) => r.status),
    [200, 200],
    JSON.stringify(confirmed),
  );
  const first = confirmed[0].data.order;
  assert.equal(first.validUntil, Number(block.timestamp) + promotionPeriod);
  await assert.rejects(simulate(q));
  const realNow = Date.now;
  try {
    Date.now = () => Number(block.timestamp) * 1000 + 1000;
    assert.equal(
      (await guest.request('/promotions/featured')).data.featured.filter(
        (p) => p.artworkId === project.id,
      ).length,
      1,
    );
    await alice.request(`/artworks/${project.id}`, { status: 'draft' }, 'PATCH');
    assert.equal(
      (await guest.request('/promotions/featured')).data.featured.some(
        (p) => p.artworkId === project.id,
      ),
      false,
    );
    await alice.request(`/artworks/${project.id}`, { status: 'published' }, 'PATCH');
    assert.equal(
      (await guest.request('/promotions/featured')).data.featured.some(
        (p) => p.artworkId === project.id,
      ),
      true,
    );
  } finally {
    Date.now = realNow;
  }
  const renewal = (await alice.request('/promotions/orders', { artworkId: project.id })).data.order;
  assert.equal(renewal.quote.expectedUntil, first.validUntil);
  const renewalHash = await aliceWallet.writeContract({
    address: renewal.contractAddress,
    abi: promotionAbi,
    functionName: 'purchase',
    args: [promotionMessage(renewal.quote), renewal.signature],
    value: BigInt(renewal.quote.amount),
  });
  await publicClient.waitForTransactionReceipt({ hash: renewalHash });
  const renewed = await alice.request(`/promotions/orders/${renewal.id}/confirm`, {
    transactionHash: renewalHash,
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
  assert.equal(renewed.data.order.startsAt, first.validUntil);
  assert.equal(renewed.data.order.validUntil, first.validUntil + promotionPeriod);
  const active = (await alice.request('/promotions?artworkId=' + project.id)).data.active;
  assert.equal(
    active.startsAt,
    first.startsAt,
    'Renewal preserves the start of the continuous placement',
  );
  assert.equal(active.validUntil, first.validUntil + promotionPeriod);
  try {
    Date.now = () => Number(block.timestamp) * 1000 + 1000;
    assert.equal(
      (await guest.request('/promotions/featured')).data.featured.filter(
        (p) => p.artworkId === project.id,
      ).length,
      1,
    );
    app.db
      .prepare(
        'INSERT INTO artwork_moderation(artwork_id,hidden,reason,updated_by,updated_at) VALUES(?,1,?,?,?)',
      )
      .run(
        project.id,
        'Test moderation',
        (await alice.request('/state')).data.user.id,
        new Date().toISOString(),
      );
    assert.equal(
      (await guest.request('/promotions/featured')).data.featured.some(
        (p) => p.artworkId === project.id,
      ),
      false,
    );
    app.db.prepare('UPDATE artwork_moderation SET hidden=0 WHERE artwork_id=?').run(project.id);
    Date.now = () => (active.validUntil + 1) * 1000;
    assert.equal(
      (await guest.request('/promotions/featured')).data.featured.some(
        (p) => p.artworkId === project.id,
      ),
      false,
    );
  } finally {
    Date.now = realNow;
  }
  const after = (await alice.request('/admin/accounting')).data;
  assert.equal(after.totals.test_eth.gross, before.totals.test_eth.gross);
  assert.equal(after.totals.test_eth.commission, before.totals.test_eth.commission);
  assert.equal(
    BigInt(after.totals.test_eth.promotions) - BigInt(before.totals.test_eth.promotions),
    parseEther('0.01'),
  );
  assert.equal(
    BigInt(after.totals.test_eth.platformRevenue) - BigInt(before.totals.test_eth.platformRevenue),
    parseEther('0.01'),
  );
  const exported = (await alice.request('/admin/accounting/export')).data;
  assert.equal(exported.events.filter((e) => e.sourceKey === 'promotion:' + order.id).length, 1);
  assert.equal(exported.promotionOrders.find((o) => o.id === order.id).tx_hash, hash);
  assert.throws(
    () => app.db.prepare("UPDATE promotion_accounting_events SET gross='0'").run(),
    /immutable/,
  );
  const snapshot = await syncAccountingBalances(
    new Repository(app.db),
    new LocalBlockchain(directory, rpc),
  );
  assert.equal(snapshot.platform.promotionWei, after.totals.test_eth.promotions);
  const withdrawal = await nodeWallet.writeContract({
    account: signer,
    address: promotionMarket.address,
    abi: promotionAbi,
    functionName: 'withdraw',
  });
  await publicClient.waitForTransactionReceipt({ hash: withdrawal });
  assert.equal(
    await publicClient.readContract({
      address: promotionMarket.address,
      abi: promotionAbi,
      functionName: 'balances',
      args: [signer],
    }),
    0n,
  );
  assert.equal(
    (await alice.request('/admin/accounting')).data.totals.test_eth.promotions,
    after.totals.test_eth.promotions,
  );
});

test('unrelated promotion transactions never activate a project and orders survive restart', async () => {
  const project = await upload('unrelated-promotion'),
    order = (await alice.request('/promotions/orders', { artworkId: project.id })).data.order;
  const hash = await aliceWallet.sendTransaction({ to: aliceAccount.address, value: 0n });
  await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(
    (await alice.request(`/promotions/orders/${order.id}/confirm`, { transactionHash: hash }))
      .status,
    422,
  );
  assert.equal((await alice.request('/promotions?artworkId=' + project.id)).data.active, null);
  assert.equal(
    (await guest.request('/promotions/featured')).data.featured.some(
      (p) => p.artworkId === project.id,
    ),
    false,
  );
  const fresh = (await alice.request('/promotions/orders', { artworkId: project.id })).data.order;
  const paid = await aliceWallet.writeContract({
    address: fresh.contractAddress,
    abi: promotionAbi,
    functionName: 'purchase',
    args: [promotionMessage(fresh.quote), fresh.signature],
    value: BigInt(fresh.quote.amount),
  });
  await publicClient.waitForTransactionReceipt({ hash: paid });
  await app.close();
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    blockchain: new LocalBlockchain(directory, rpc),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(
    (await alice.request(`/promotions/orders/${fresh.id}/recover`, {})).data.transactionHash,
    paid,
  );
  assert.equal(
    (await alice.request(`/promotions/orders/${fresh.id}/confirm`, { transactionHash: paid }))
      .status,
    200,
  );
  assert.equal(
    (await alice.request('/promotions?artworkId=' + project.id)).data.orders.find(
      (o) => o.id === fresh.id,
    ).transactionHash,
    paid,
  );
});

test('timed licenses record signed expiry, split actual funds, reject tampering and renew after expiry', async (t) => {
  await setPlan(alice, 'business');
  const target = await upload('timed-license', alice, [
    { name: 'Charlie', percent: 25, wallet: charlieAccount.address },
  ]);
  await approveAndPublish(target.id);
  assert.equal(
    (await alice.request('/artworks/' + target.id, { licenseDurationDays: 30 }, 'PATCH')).status,
    200,
  );
  assert.equal(
    (await alice.request('/artworks/' + target.id, { licenseDurationDays: 31 }, 'PATCH')).status,
    400,
  );
  await registerFile(target);
  await setPlan(alice, 'free');
  assert.equal(
    (await bob.request('/purchases', { items: [{ artworkId: target.id, license: 'personal' }] }))
      .status,
    409,
  );
  const deployer = createWalletClient({ chain: localChain, transport: http(rpc) });
  const terms = await ensureTermMarketplace(
    join(directory, 'chain'),
    deployment,
    market,
    publicClient,
    deployer,
  );
  assert.equal(
    (
      await ensureTermMarketplace(
        join(directory, 'chain'),
        deployment,
        market,
        publicClient,
        deployer,
      )
    ).address,
    terms.address,
  );
  assert.equal(
    await publicClient.readContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'hasLicense',
      args: [bobAccount.address, paidOrder.items[0].quote.fileHash, 1],
    }),
    true,
    'Existing perpetual license inherited',
  );
  const prepared = await bob.request('/blockchain/checkouts', {
    items: [{ artworkId: target.id, license: 'personal' }],
  });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const order = prepared.data.checkout;
  assert.equal(order.marketVersion, 3);
  assert.equal(order.items[0].quote.durationSeconds, 30 * 86400);
  const q = contractQuote(order.items[0].quote);
  await assert.rejects(
    publicClient.simulateContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'buyLicenses',
      account: bobAccount.address,
      args: [[{ ...q, durationSeconds: 90n * 86400n }], [order.items[0].signature]],
      value: BigInt(order.totalWei),
    }),
  );
  await assert.rejects(
    publicClient.simulateContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'buyLicenses',
      account: aliceAccount.address,
      args: [[q], [order.items[0].signature]],
      value: BigInt(order.totalWei),
    }),
  );
  const hash = await payOrder(order, bobWallet, termMarketplaceAbi);
  const confirmed = await bob.request('/blockchain/checkouts/' + order.id + '/confirm', {
    transactionHash: hash,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  const purchaseId = confirmed.data.checkout.purchaseIds[0];
  let purchase = (await bob.request('/state')).data.purchases.find((p) => p.id === purchaseId);
  assert.equal(Date.parse(purchase.validUntil) - Date.parse(purchase.validFrom), 30 * 86400000);
  assert.equal(purchase.expired, false);
  const expiry = await publicClient.readContract({
    address: terms.address,
    abi: termMarketplaceAbi,
    functionName: 'licenseExpiry',
    args: [bobAccount.address, q.fileHash, 1],
  });
  assert.equal(Number(expiry) * 1000, Date.parse(purchase.validUntil));
  assert.equal(
    await publicClient.readContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'balances',
      args: [charlieAccount.address],
    }),
    parseEther('0.0027'),
  );
  assert.equal(
    (
      await bob.request('/blockchain/checkouts', {
        items: [{ artworkId: target.id, license: 'personal' }],
      })
    ).status,
    409,
  );
  const proof = await guest.request('/blockchain/demo-proof?transactionHash=' + hash);
  assert.equal(proof.data.status, 'verified', JSON.stringify(proof.data));
  assert.equal(proof.data.transaction.licenses[0].validUntil, purchase.validUntil);
  const document = await bob.request('/licenses/' + purchaseId + '/document');
  assert.match(document.data, /Valid until:/);
  assert.match(document.data, /Status: Active/);
  const snapshot = await testClient.snapshot();
  try {
    await testClient.setNextBlockTimestamp({ timestamp: expiry + 1n });
    await testClient.mine({ blocks: 1 });
    t.mock.method(Date, 'now', () => Number(expiry + 2n) * 1000);
    app.db.prepare('UPDATE sessions SET expires_at=?').run(Date.now() + 86400000);
    purchase = (await bob.request('/state')).data.purchases.find((p) => p.id === purchaseId);
    assert.equal(purchase.expired, true);
    assert.equal((await bob.request('/artworks/' + target.id + '/download')).status, 403);
    assert.equal(
      await publicClient.readContract({
        address: terms.address,
        abi: termMarketplaceAbi,
        functionName: 'hasLicense',
        args: [bobAccount.address, q.fileHash, 1],
      }),
      false,
    );
    assert.equal(
      (await guest.request('/blockchain/demo-proof?transactionHash=' + hash)).data.status,
      'verified',
      'A historical transaction remains verifiable after expiry',
    );
    const renewed = await bob.request('/blockchain/checkouts', {
      items: [{ artworkId: target.id, license: 'personal' }],
    });
    assert.equal(renewed.status, 201, JSON.stringify(renewed.data));
    const renewal = renewed.data.checkout,
      renewalHash = await payOrder(renewal, bobWallet, termMarketplaceAbi);
    const result = await bob.request('/blockchain/checkouts/' + renewal.id + '/confirm', {
      transactionHash: renewalHash,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.deepEqual(result.data.checkout.purchaseIds, [purchaseId]);
    assert.equal(
      (
        await bob.request('/blockchain/checkouts/' + renewal.id + '/confirm', {
          transactionHash: renewalHash,
        })
      ).status,
      200,
    );
    const latest = (await bob.request('/state')).data.purchases.find((p) => p.id === purchaseId);
    assert.equal(latest.expired, false);
    assert.equal(latest.payment.transactionHash, renewalHash);
    assert.equal(
      (await alice.request('/state')).data.sales.filter((s) => s.artworkId === target.id).length,
      2,
    );
    assert.equal((await bob.request('/artworks/' + target.id + '/download')).status, 200);
    assert.equal(
      app.db.prepare('SELECT count(*) n FROM accounting_events WHERE purchase_id=?').get(purchaseId)
        .n,
      2,
    );
    assert.equal(
      app.db.prepare('SELECT count(*) n FROM purchases WHERE id=?').get(purchaseId).n,
      1,
    );
    const charlieWallet = createWalletClient({
      account: charlieAccount,
      chain: localChain,
      transport: http(rpc),
    });
    await testClient.setBalance({ address: charlieAccount.address, value: parseEther('1') });
    const withdrawal = await charlieWallet.writeContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'withdraw',
    });
    await publicClient.waitForTransactionReceipt({ hash: withdrawal });
    assert.equal(
      await publicClient.readContract({
        address: terms.address,
        abi: termMarketplaceAbi,
        functionName: 'balances',
        args: [charlieAccount.address],
      }),
      0n,
    );
    assert.equal(
      (
        await guest.request('/blockchain/demo-proof?transactionHash=' + renewalHash)
      ).data.transaction.withdrawals.some((w) => w.transactionHash === withdrawal),
      true,
    );
    // A mined payment can be recovered after a later renewal has already been confirmed.
    const advance = async (until: string) => {
      const timestamp = BigInt(Math.floor(Date.parse(until) / 1000) + 1);
      await testClient.setNextBlockTimestamp({ timestamp });
      await testClient.mine({ blocks: 1 });
      t.mock.method(Date, 'now', () => Number(timestamp + 1n) * 1000);
      app.db.prepare('UPDATE sessions SET expires_at=?').run(Date.now() + 86400000);
    };
    await advance(latest.validUntil);
    const delayed = (
      await bob.request('/blockchain/checkouts', {
        items: [{ artworkId: target.id, license: 'personal' }],
      })
    ).data.checkout;
    assert.ok(delayed);
    const delayedHash = await payOrder(delayed, bobWallet, termMarketplaceAbi);
    const delayedExpiry = await publicClient.readContract({
      address: terms.address,
      abi: termMarketplaceAbi,
      functionName: 'licenseExpiry',
      args: [bobAccount.address, q.fileHash, 1],
    });
    await advance(new Date(Number(delayedExpiry) * 1000).toISOString());
    const fourth = (
      await bob.request('/blockchain/checkouts', {
        items: [{ artworkId: target.id, license: 'personal' }],
      })
    ).data.checkout;
    assert.ok(fourth);
    const fourthHash = await payOrder(fourth, bobWallet, termMarketplaceAbi);
    assert.equal(
      (
        await bob.request('/blockchain/checkouts/' + fourth.id + '/confirm', {
          transactionHash: fourthHash,
        })
      ).status,
      200,
    );
    const recovered = await bob.request('/blockchain/checkouts/' + delayed.id + '/confirm', {
      transactionHash: delayedHash,
    });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
    const current = (await bob.request('/state')).data.purchases.find((p) => p.id === purchaseId);
    assert.equal(
      current.payment.transactionHash,
      fourthHash,
      'Recovery must not replace the newest license',
    );
    assert.equal(current.expired, false);
    assert.equal(
      app.db.prepare('SELECT count(*) n FROM accounting_events WHERE purchase_id=?').get(purchaseId)
        .n,
      4,
    );
    assert.equal(
      (await alice.request('/state')).data.sales.filter((s) => s.artworkId === target.id).length,
      4,
    );
  } finally {
    t.mock.restoreAll();
    await testClient.revert({ id: snapshot });
  }
});

test('version 1 upgrades preserve old quotes, paid licenses, balances, recovery, and independent withdrawals', async () => {
  await app.close();
  app = null;
  const upgradeDirectory = join(directory, 'upgrade-case');
  await mkdir(join(upgradeDirectory, 'chain'), { recursive: true });
  const deployer = createWalletClient({ chain: localChain, transport: http(rpc) }),
    [account] = await deployer.getAddresses();
  const compiled = await compileContract('LegacyLicenseMarketplace');
  const transactionHash = await deployer.deployContract({
    account,
    ...compiled,
    args: [deployment.address, account, account],
  });
  const oldReceipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  const legacy = {
    chainId: 31337,
    address: oldReceipt.contractAddress,
    instanceId: deployment.instanceId,
    registryAddress: deployment.address,
    quoteSigner: account,
    treasury: account,
    transactionHash,
  };
  await writeFile(join(upgradeDirectory, 'chain', 'registry.json'), JSON.stringify(deployment));
  await writeFile(join(upgradeDirectory, 'chain', 'marketplace.json'), JSON.stringify(legacy));
  const start = async () => {
    app = await createApp({
      dataDir: upgradeDirectory,
      serveClient: false,
      blockchain: new LocalBlockchain(upgradeDirectory, rpc),
    });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${app.server.address().port}`;
  };
  await start();
  const creator = client(),
    buyer = client();
  for (const [actor, name, wallet] of [
    [creator, 'Upgrade creator', aliceAccount],
    [buyer, 'Upgrade buyer', bobAccount],
  ]) {
    assert.equal(
      (
        await actor.request('/auth/register', {
          name,
          email: name.replace(' ', '') + '@upgrade.test',
          password: 'local-chain-test-password',
        })
      ).status,
      201,
    );
    assert.equal((await actor.request('/wallet/link', await challenge(actor, wallet))).status, 200);
  }
  const target = await upload('legacy-upgrade', creator);
  await registerFile(target, creator, aliceWallet);
  const creatorId = (await creator.request('/state')).data.user.id,
    buyerId = (await buyer.request('/state')).data.user.id;
  const orders = [];
  for (const [license, number] of [
    ['personal', 1],
    ['commercial', 2],
  ]) {
    const quote = {
      id: '0x' + randomBytes(32).toString('hex'),
      buyer: bobAccount.address,
      seller: aliceAccount.address,
      fileHash: '0x' + target.hash,
      licenseType: number,
      termsHash: registration.termsHash,
      amount: '1000000000000000',
      feeBps: 1000,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      instanceId: deployment.instanceId,
    };
    const signature = await deployer.signTypedData({
      account,
      domain: quoteDomain(legacy.address, 1),
      types: legacyQuoteTypes,
      primaryType: 'Quote',
      message: contractQuote(quote),
    });
    const id = 'legacy-' + license;
    app.db
      .prepare(
        "INSERT INTO chain_checkouts(id,buyer_id,buyer_wallet,instance_id,contract_address,status,expires_at,total_wei,created_at) VALUES(?,?,?,?,?,'prepared',?,?,?)",
      )
      .run(
        id,
        buyerId,
        quote.buyer,
        quote.instanceId,
        legacy.address,
        quote.expiresAt,
        quote.amount,
        new Date().toISOString(),
      );
    app.db
      .prepare(
        'INSERT INTO chain_checkout_items(quote_id,checkout_id,artwork_id,seller_id,title,license,seller_wallet,file_hash,terms_hash,terms_json,amount,commission,amount_wei,fee_wei,fee_bps,signature) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        quote.id,
        id,
        target.id,
        creatorId,
        target.title,
        license,
        quote.seller,
        quote.fileHash,
        quote.termsHash,
        'Legacy terms',
        100,
        10,
        quote.amount,
        '100000000000000',
        1000,
        signature,
      );
    orders.push({
      id,
      contractAddress: legacy.address,
      totalWei: quote.amount,
      items: [{ quote, signature }],
    });
  }
  const paidHash = await payOrder(orders[0], bobWallet, legacyMarketplaceAbi);
  const currentSchema = app.db.prepare('PRAGMA user_version').get().user_version;
  // Simulate an actual schema-3 installation, including a mined payment not yet reported to the API.
  app.db.exec(
    'DROP TABLE chain_revenue_splits; DROP TABLE chain_checkout_versions; PRAGMA user_version=3;',
  );
  await app.close();
  app = null;
  market = await ensureMarketplace(
    join(upgradeDirectory, 'chain'),
    deployment,
    publicClient,
    deployer,
  );
  assert.equal(market.version, 2);
  assert.notEqual(market.address, legacy.address);
  assert.equal(
    (
      await publicClient.readContract({
        address: market.address,
        abi: marketplaceAbi,
        functionName: 'previousMarketplace',
      })
    ).toLowerCase(),
    legacy.address.toLowerCase(),
  );
  assert.equal(
    (await ensureMarketplace(join(upgradeDirectory, 'chain'), deployment, publicClient, deployer))
      .address,
    market.address,
  );
  await start();
  assert.equal(app.db.prepare('PRAGMA user_version').get().user_version, currentSchema);
  assert.ok(app.db.prepare("SELECT name FROM sqlite_master WHERE name='artwork_images'").get());
  assert.equal(
    (await buyer.request(`/blockchain/checkouts/${orders[0].id}/recover`, {})).data.transactionHash,
    paidHash,
  );
  const confirmed = await buyer.request(`/blockchain/checkouts/${orders[0].id}/confirm`, {
    transactionHash: paidHash,
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.checkout.marketVersion, 1);
  assert.equal(
    await publicClient.readContract({
      address: market.address,
      abi: marketplaceAbi,
      functionName: 'hasLicense',
      args: [bobAccount.address, orders[0].items[0].quote.fileHash, 1],
    }),
    true,
  );
  const oldOpen = (await buyer.request(`/blockchain/checkouts/${orders[1].id}`)).data.checkout;
  const laterHash = await payOrder(oldOpen, bobWallet, legacyMarketplaceAbi);
  assert.equal(
    (
      await buyer.request(`/blockchain/checkouts/${oldOpen.id}/confirm`, {
        transactionHash: laterHash,
      })
    ).status,
    200,
  );
  const proceeds = await creator.request('/blockchain/proceeds');
  assert.equal(proceeds.status, 200);
  assert.equal(proceeds.data.balances.find((b) => b.version === 1).amountWei, '1800000000000000');
  assert.equal(proceeds.data.balances.find((b) => b.version === 2).amountWei, '0');
  const withdrawal = await aliceWallet.writeContract({
    address: legacy.address,
    abi: legacyMarketplaceAbi,
    functionName: 'withdraw',
  });
  assert.equal(
    (await publicClient.waitForTransactionReceipt({ hash: withdrawal })).status,
    'success',
  );
  assert.equal((await creator.request('/blockchain/proceeds')).data.amountWei, '0');
  assert.equal((await buyer.request('/state')).data.purchases.length, 2);
});
