import { ensureEscrowMarketplace } from './deploy-escrow-marketplace.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { foundry } from 'viem/chains';
import { compileRegistry } from './contract.mjs';
import { anvilPath } from './anvil.mjs';
import { ensureMarketplace } from './deploy-marketplace.mjs';
import { ensureSubscriptions } from './deploy-subscriptions.mjs';
import { ensurePromotions } from './deploy-promotions.mjs';
import { ensureTermMarketplace } from './deploy-term-marketplace.mjs';

const directory = resolve(process.env.ARTGUARD_DATA_DIR || 'data', 'chain');
await mkdir(directory, { recursive: true });
const rpcUrl = process.env.ARTGUARD_RPC_URL || 'http://127.0.0.1:8545';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpcUrl))
  throw new Error('Only a loopback test node is supported.');
const rpcPort = new URL(rpcUrl).port;
const publicMode = process.env.ARTGUARD_PUBLIC_DEMO === 'true';
let walletArgs = [];
if (publicMode) {
  if (directory === resolve('data', 'chain') || rpcPort === '8545')
    throw new Error('The public test node must use an isolated data directory and port.');
  const configFile = join(directory, 'accounts.private.json');
  try {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    const find = (value) =>
      typeof value === 'string' && [12, 15, 18, 21, 24].includes(value.trim().split(/\s+/).length)
        ? value
        : typeof value === 'object' && value !== null
          ? Object.entries(value)
              .map(([key, v]) =>
                key === 'mnemonic' && typeof v === 'string'
                  ? v
                  : typeof v === 'object'
                    ? find(v)
                    : null,
              )
              .find(Boolean)
          : null;
    const mnemonic = find(config);
    if (!mnemonic)
      throw new Error(
        'Restore the private mnemonic configuration before restarting the public test node.',
      );
    walletArgs = ['--mnemonic', mnemonic];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      await readFile(join(directory, 'state.json'));
      throw new Error(
        'Public chain state exists, but its private wallet configuration is missing. Restore accounts.private.json; the existing network will not be replaced.',
      );
    } catch (stateError) {
      if (stateError.code !== 'ENOENT') throw stateError;
    }
    walletArgs = ['--mnemonic-random', '24'];
  }
  walletArgs.push(
    '--config-out',
    configFile,
    '--accounts',
    process.env.ARTGUARD_NODE_ACCOUNTS || '128',
  );
}

const client = createPublicClient({
  chain: foundry,
  transport: http(rpcUrl, { retryCount: 0, timeout: 1000 }),
});
try {
  await client.getChainId();
  throw new Error(
    'Test RPC port is already in use. Stop the existing node before running npm run chain.',
  );
} catch (error) {
  if (error.message.startsWith('Test RPC port ')) throw error;
}
const child = spawn(
  anvilPath(),
  [
    '--host',
    '127.0.0.1',
    '--port',
    rpcPort,
    '--chain-id',
    '31337',
    '--state',
    join(directory, 'state.json'),
    '--state-interval',
    '1',
    '--no-cors',
    '--silent',
    ...walletArgs,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
);
let stopped = false;
const stop = () => {
  stopped = true;
  child.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (!stopped) {
    console.error(`Local chain exited (${code}).`);
    process.exitCode = code || 1;
  }
});
try {
  let ready = false;
  for (let n = 0; n < 60 && !stopped; n++) {
    try {
      if ((await client.getChainId()) === 31337) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Local chain did not start.');
  const manifest = join(directory, 'registry.json');
  let deployment;
  try {
    const saved = JSON.parse(await readFile(manifest, 'utf8'));
    const instance = await client.readContract({
      address: saved.address,
      abi: parseAbi(['function instanceId() view returns (bytes32)']),
      functionName: 'instanceId',
    });
    if (instance === saved.instanceId) deployment = saved;
  } catch {}
  if (!deployment) {
    if (publicMode) {
      try {
        await readFile(manifest);
        throw new Error(
          'The saved public registry does not match the running network. Restore its state instead of replacing it.',
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const wallet = createWalletClient({ chain: foundry, transport: http(rpcUrl) });
    const [account] = await wallet.getAddresses();
    const contract = await compileRegistry();
    const instanceId = '0x' + randomBytes(32).toString('hex');
    const transactionHash = await wallet.deployContract({
      account,
      ...contract,
      args: [instanceId],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== 'success' || !receipt.contractAddress)
      throw new Error('Registry deployment failed.');
    deployment = { chainId: 31337, address: receipt.contractAddress, instanceId, transactionHash };
    await writeFile(manifest, JSON.stringify(deployment, null, 2));
  }
  console.log(`ArtGuard local chain ready: ${rpcUrl} (chain 31337)`);
  console.log(`Registry: ${deployment.address}. State saved under data/chain. Test ETH only.`);
  const marketplace = await ensureMarketplace(
    directory,
    deployment,
    client,
    createWalletClient({ chain: foundry, transport: http(rpcUrl) }),
  );
  console.log(`License marketplace: ${marketplace.address}. Test ETH checkout ready.`);
  const terms = await ensureTermMarketplace(
    directory,
    deployment,
    marketplace,
    client,
    createWalletClient({ chain: foundry, transport: http(rpcUrl) }),
  );
  console.log(`Timed licenses: ${terms.address}. Previous perpetual licenses preserved.`);
  const escrow = await ensureEscrowMarketplace(
    directory,
    deployment,
    terms,
    client,
    createWalletClient({ chain: foundry, transport: http(rpcUrl) }),
  );
  console.log('Escrow marketplace:', escrow.address);
  const subscriptions = await ensureSubscriptions(
    directory,
    deployment,
    client,
    createWalletClient({ chain: foundry, transport: http(rpcUrl) }),
  );
  console.log(`Subscription payments: ${subscriptions.address}. Prepaid 30-day test plans ready.`);
  const promotions = await ensurePromotions(
    directory,
    deployment,
    client,
    createWalletClient({ chain: foundry, transport: http(rpcUrl) }),
  );
  console.log(`Promotion payments: ${promotions.address}. Paid 7-day placements ready.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  stop();
}
