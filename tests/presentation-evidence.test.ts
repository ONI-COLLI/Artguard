import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { presentationEvidence, recordedPresentationRuns } from '../server/presentation.ts';
const address = '0x' + 'a'.repeat(40),
  hash = '0x' + 'b'.repeat(64);
function chain(mode = 'valid'): any {
  return {
    status: async () => ({
      ready: mode !== 'offline',
      deployment: { address, transactionHash: hash },
    }),
    marketplaceStatus: async () => ({
      contracts: [{ version: 4, address, transactionHash: hash }],
    }),
    client: {
      getTransactionReceipt: async () => ({
        status: 'success',
        transactionHash: hash,
        to: null,
        contractAddress: mode === 'wrong-contract' ? '0xwrong' : address,
        blockHash: 'canonical',
        blockNumber: 4n,
      }),
      getCode: async () => (mode === 'empty-code' ? '0x' : '0x123456'),
      getBlock: async () => ({ hash: mode === 'reorg' ? 'different' : 'canonical' }),
    },
  };
}
test('public deployment evidence requires successful creation receipts, canonical blocks and existing runtime code', async () => {
  const current = await presentationEvidence(chain());
  assert.equal(current.online, true);
  assert.equal(current.contracts[0].bytecodeBytes, 3);
  for (const mode of ['offline', 'wrong-contract', 'empty-code', 'reorg'])
    assert.equal((await presentationEvidence(chain(mode))).online, false, mode);
  assert.equal(JSON.stringify(current).includes('privateKey'), false);
});
test('recorded runs require matching logs and valid dates; missing or contradictory results are not fabricated', async () => {
  const root = resolve('artifacts');
  const directory = await mkdtemp(join(root, 'presentation-test-'));
  try {
    assert.deepEqual(await recordedPresentationRuns(directory), []);
    const summary = {
      command: 'npm run test:blockchain',
      exitCode: 0,
      passed: 51,
      failed: 0,
      completedAt: '2026-11-08T10:00:00Z',
      privateKey: 'not-public',
    };
    await writeFile(join(directory, 'blockchain-results.json'), JSON.stringify(summary));
    await writeFile(join(directory, 'blockchain-tests.log'), '# pass 51\n# fail 0\n');
    const runs = await recordedPresentationRuns(directory);
    assert.equal(runs[0].passed, 51);
    assert.equal(runs[0].logSha256.length, 64);
    assert.equal(JSON.stringify(runs).includes('not-public'), false);
    await writeFile(join(directory, 'blockchain-tests.log'), '# pass 50\n# fail 1\n');
    assert.deepEqual(await recordedPresentationRuns(directory), []);
    await writeFile(
      join(directory, 'blockchain-results.json'),
      JSON.stringify({ ...summary, completedAt: 'invalid' }),
    );
    assert.deepEqual(await recordedPresentationRuns(directory), []);
  } finally {
    if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe test cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
});
