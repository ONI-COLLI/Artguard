import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createPublicClient, http } from 'viem';

const output = resolve('artifacts/demo-video');
const evidence = JSON.parse(readFileSync(join(output, 'evidence.json'), 'utf8'));
const hash = '0xbb557e4525e0cf4168c9f5040ad716ebb0c798b5860976d77be8f0f432dbf18c';
const proof = await fetch(
  `${evidence.localUrl}/api/blockchain/escrow-proof?transactionHash=${hash}`,
).then((r) => r.json());
if (proof.status !== 'verified' || proof.checks.some((c) => !c.passed))
  throw new Error('Escrow proof failed');
const client = createPublicClient({ transport: http(evidence.rpc) });
const order = proof.orders[0];
const hashes = [
  order.depositHash,
  order.releaseHash,
  ...order.withdrawals.map((w) => w.hash),
].filter(Boolean);
const receipts = [];
for (const transactionHash of hashes) {
  const [tx, receipt, block] = await Promise.all([
    client.getTransaction({ hash: transactionHash }),
    client.getTransactionReceipt({ hash: transactionHash }),
    client.getBlock({
      blockNumber: (await client.getTransactionReceipt({ hash: transactionHash })).blockNumber,
    }),
  ]);
  if (receipt.status !== 'success' || block.hash !== receipt.blockHash)
    throw new Error('Receipt verification failed');
  receipts.push({
    hash: transactionHash,
    from: tx.from,
    to: tx.to,
    valueWei: String(tx.value),
    status: receipt.status,
    block: String(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: String(receipt.gasUsed),
    effectiveGasPrice: String(receipt.effectiveGasPrice),
    logCount: receipt.logs.length,
  });
}
writeFileSync(join(output, 'flow.json'), JSON.stringify({ proof, receipts }, null, 2));
console.log(
  `Verified ${proof.checks.length} on-chain checks and ${receipts.length} canonical transaction receipts.`,
);

const command = 'npm run test:blockchain';
const events = [{ at: new Date().toISOString(), type: 'command', text: command }];
const stream = createWriteStream(join(output, 'blockchain-tests.log'));
const npm =
  process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const child = spawn(process.execPath, [npm, 'run', 'test:blockchain'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let combined = '';
for (const pipe of [child.stdout, child.stderr])
  pipe.on('data', (chunk) => {
    const text = String(chunk);
    combined += text;
    stream.write(chunk);
    events.push({ at: new Date().toISOString(), type: 'output', text });
  });
const exitCode = await new Promise((done, reject) => {
  child.once('exit', done);
  child.once('error', reject);
});
stream.end();
const plain = combined.replace(/\x1b\[[0-9;]*m/g, '');
const passed = Number(
  plain.match(/# pass\s+(\d+)/)?.[1] || plain.match(/ℹ pass\s+(\d+)/)?.[1] || 0,
);
const failed = Number(
  plain.match(/# fail\s+(\d+)/)?.[1] || plain.match(/ℹ fail\s+(\d+)/)?.[1] || 0,
);
const result = { command, exitCode, passed, failed, completedAt: new Date().toISOString() };
events.push({ at: result.completedAt, type: 'complete', ...result });
writeFileSync(join(output, 'blockchain-execution.json'), JSON.stringify(events, null, 2));
writeFileSync(join(output, 'blockchain-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = exitCode || 0;
