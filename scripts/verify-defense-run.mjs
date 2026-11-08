import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createPublicClient, http } from 'viem';
const id = process.argv[2];
if (!/^[a-f\d-]{36}$/.test(id || '')) throw new Error('Pass an exact saved defense run UUID.');
const output = resolve('artifacts/defense-video', id);
const run = JSON.parse(readFileSync(join(output, 'run.json'), 'utf8'));
const proof = JSON.parse(readFileSync(join(output, 'on-chain-proof.json'), 'utf8'));
if (
  !run.events.some((e) => e.channel === 'stage' && e.text === 'Completed') ||
  Object.values(run.jobs).some((j) => j.status !== 'passed' || j.failed || j.exitCode !== 0)
)
  throw new Error('The run did not complete successfully.');
const client = createPublicClient({ transport: http('http://127.0.0.1:8665') });
const hashes = [
  ...new Set([
    ...run.contracts.map((c) => c.hash),
    ...proof.orders
      .flatMap((o) => [o.depositHash, o.releaseHash, ...o.withdrawals.map((w) => w.hash)])
      .filter(Boolean),
  ]),
];
const receipts = [];
for (const hash of hashes) {
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (receipt.status !== 'success' || block.hash !== receipt.blockHash)
    throw new Error('Not a successful canonical transaction: ' + hash);
  receipts.push({
    hash,
    status: receipt.status,
    block: String(receipt.blockNumber),
    blockHash: block.hash,
    from: tx.from,
    to: tx.to,
    valueWei: String(tx.value),
    gasUsed: String(receipt.gasUsed),
    logCount: receipt.logs.length,
  });
}
const result = {
  checkedAt: new Date().toISOString(),
  chainId: await client.getChainId(),
  source: 'Fresh read from the current Anvil JSON-RPC, not the purchase database',
  receipts,
};
writeFileSync(join(output, 'canonical-receipts.json'), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    chainId: result.chainId,
    successfulCanonicalReceipts: receipts.length,
    unitPassed: run.jobs.unit.passed,
    evmPassed: run.jobs.contracts.passed,
    proofChecks: proof.checks.length,
  }),
);
