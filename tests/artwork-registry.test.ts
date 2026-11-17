import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  sha256,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { anvilPath } from '../scripts/anvil.mjs';
import { compileRegistry } from '../scripts/contract.mjs';
import { localChain, registryAbi } from '../shared/blockchain.ts';

const instance = sha256(stringToHex('ArtGuard registry test instance'));
const emptyHash = `0x${'0'.repeat(64)}` as Hex;
const sampleFile = sha256(stringToHex('Synthetic artwork 1'));
const otherFile = sha256(stringToHex('Synthetic artwork 2'));
const originalTerms = sha256(stringToHex('Synthetic personal licence terms'));
const revisedTerms = sha256(stringToHex('Synthetic commercial licence terms'));

let node: ChildProcess | undefined;
let compiled: Awaited<ReturnType<typeof compileRegistry>>;
let chain: ReturnType<typeof createPublicClient>;
let wallet: ReturnType<typeof createWalletClient>;
let alice: Address;
let bob: Address;
let registry: Address;

before(async () => {
  compiled = await compileRegistry();
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });

  const transport = http(`http://127.0.0.1:${address.port}`, {
    retryCount: 0,
    timeout: 1_000,
  });
  chain = createPublicClient({ chain: localChain, transport, pollingInterval: 50 });
  wallet = createWalletClient({ chain: localChain, transport });
  node = spawn(
    anvilPath(),
    ['--host', '127.0.0.1', '--port', String(address.port), '--chain-id', '31337', '--silent'],
    { stdio: 'ignore', windowsHide: true },
  );
  const controller = new AbortController();
  try {
    await Promise.race([
      (async () => {
        for (let attempt = 0; attempt < 60; attempt++) {
          const chainId = await chain.getChainId().catch(() => undefined);
          if (chainId !== undefined) {
            assert.equal(chainId, 31337);
            return;
          }
          await delay(100, undefined, { signal: controller.signal });
        }
        throw new Error('The disposable Anvil node did not start.');
      })(),
      once(node, 'exit', { signal: controller.signal }).then(([code]) => {
        throw new Error(`Anvil exited before startup (code ${code}).`);
      }),
    ]);
  } finally {
    controller.abort();
  }
  [alice, bob] = await wallet.getAddresses();
  assert.ok(alice && bob, 'Anvil should provide two test wallets');
});

after(async () => {
  if (!node?.pid || node.exitCode !== null || node.signalCode !== null) return;
  const exited = once(node, 'exit', { signal: AbortSignal.timeout(5_000) });
  node.kill();
  await exited;
});

beforeEach(async () => {
  const hash = await wallet.deployContract({
    ...compiled,
    account: alice,
    chain: localChain,
    args: [instance],
  });
  const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 10_000 });
  assert.equal(receipt.status, 'success');
  assert.ok(receipt.contractAddress);
  registry = receipt.contractAddress;
});

function record(fileHash: Hex) {
  return chain.readContract({
    address: registry,
    abi: registryAbi,
    functionName: 'records',
    args: [fileHash],
  });
}

async function register(account: Address, fileHash: Hex, termsHash: Hex) {
  const hash = await wallet.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: 'registerArtwork',
    account,
    chain: localChain,
    args: [fileHash, termsHash],
  });
  const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 10_000 });
  assert.equal(receipt.status, 'success');
  return receipt;
}

async function assertReverts(fileHash: Hex, termsHash: Hex, expected: string) {
  await assert.rejects(
    chain.simulateContract({
      address: registry,
      abi: registryAbi,
      functionName: 'registerArtwork',
      account: alice,
      args: [fileHash, termsHash],
    }),
    (error: unknown) => {
      assert.ok(error instanceof BaseError);
      const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
      assert.ok(revert instanceof ContractFunctionRevertedError);
      assert.equal(revert.data?.errorName, expected);
      return true;
    },
  );
}

test('Registers the file and emits matching evidence', async () => {
  const receipt = await register(alice, sampleFile, originalTerms);
  const block = await chain.getBlock({ blockHash: receipt.blockHash });
  assert.deepEqual(await record(sampleFile), [alice, originalTerms, block.timestamp]);
  const events = parseEventLogs({
    abi: registryAbi,
    eventName: 'ArtworkRegistered',
    logs: receipt.logs,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].address.toLowerCase(), registry.toLowerCase());
  assert.deepEqual(events[0].args, {
    fileHash: sampleFile,
    registrant: alice,
    termsHash: originalTerms,
    registeredAt: block.timestamp,
  });
});

test('Rejects a zero file hash', async () => {
  await assertReverts(emptyHash, originalTerms, 'InvalidHash');
  assert.deepEqual(await record(emptyHash), [zeroAddress, emptyHash, 0n]);
});

test('Rejects a zero licence terms hash', async () => {
  await assertReverts(sampleFile, emptyHash, 'InvalidHash');
  assert.deepEqual(await record(sampleFile), [zeroAddress, emptyHash, 0n]);
});

test('Rejects duplicate registration and preserves the original record', async () => {
  await register(alice, sampleFile, originalTerms);
  const original = await record(sampleFile);
  await assertReverts(sampleFile, revisedTerms, 'AlreadyRegistered');
  assert.deepEqual(await record(sampleFile), original);
});

test('Keeps records from two wallets separate', async () => {
  await register(alice, sampleFile, originalTerms);
  const first = await record(sampleFile);
  await register(bob, otherFile, originalTerms);
  const second = await record(otherFile);
  assert.deepEqual(await record(sampleFile), first);
  assert.equal(first[0], alice);
  assert.equal(second[0], bob);
  assert.equal(second[1], originalTerms);
});
