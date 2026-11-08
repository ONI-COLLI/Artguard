import { resolve, join } from 'node:path';
import { createWalletClient, http } from 'viem';
import { localChain } from '../shared/blockchain.ts';
import { LocalBlockchain } from '../server/blockchain.ts';
import { ensureEscrowMarketplace } from './deploy-escrow-marketplace.mjs';
const directory = resolve(process.env.ARTGUARD_DATA_DIR || 'data'),
  chain = new LocalBlockchain(directory);
const registry = await chain.requireReady(),
  status = await chain.marketplaceStatus();
const parent = status.contracts?.find((c) => c.version === 3);
if (!parent) throw new Error('Deploy timed licenses first: npm run chain:licenses');
const previous = await chain.requireMarketplace(parent.address);
const deployment = await ensureEscrowMarketplace(
  join(directory, 'chain'),
  registry,
  previous,
  chain.client,
  createWalletClient({ chain: localChain, transport: http(chain.rpcUrl) }),
);
console.log('Escrow ready:', deployment.address, 'Old contracts and balances preserved.');
