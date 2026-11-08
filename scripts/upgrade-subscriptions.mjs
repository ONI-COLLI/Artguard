import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { foundry } from 'viem/chains';
import { ensureSubscriptions } from './deploy-subscriptions.mjs';
const directory = resolve(process.env.ARTGUARD_DATA_DIR || 'data', 'chain');
const client = createPublicClient({
  chain: foundry,
  transport: http('http://127.0.0.1:8545', { retryCount: 0, timeout: 3000 }),
});
try {
  if ((await client.getChainId()) !== 31337)
    throw new Error('Expected the local Anvil network, chain 31337.');
  const registry = JSON.parse(await readFile(join(directory, 'registry.json'), 'utf8'));
  const instance = await client.readContract({
    address: registry.address,
    abi: parseAbi(['function instanceId() view returns(bytes32)']),
    functionName: 'instanceId',
  });
  if (instance !== registry.instanceId)
    throw new Error('Restore the original local chain before upgrading.');
  const wallet = createWalletClient({ chain: foundry, transport: http('http://127.0.0.1:8545') });
  const deployment = await ensureSubscriptions(directory, registry, client, wallet);
  console.log(
    `Local subscription contract ready: ${deployment.address}. Existing registry, marketplace and licenses preserved.`,
  );
} catch (error) {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
}
