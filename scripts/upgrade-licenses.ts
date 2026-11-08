import { resolve, join } from 'node:path';
import { createWalletClient, http } from 'viem';
import { localChain } from '../shared/blockchain.ts';
import { LocalBlockchain } from '../server/blockchain.ts';
import { ensureTermMarketplace } from './deploy-term-marketplace.mjs';
const directory = resolve(process.env.ARTGUARD_DATA_DIR || 'data'),
  chain = new LocalBlockchain(directory);
const registry = await chain.requireReady(),
  previous = await chain.requireMarketplace();
const wallet = createWalletClient({ chain: localChain, transport: http(chain.rpcUrl) });
const deployment = await ensureTermMarketplace(
  join(directory, 'chain'),
  registry,
  previous,
  chain.client,
  wallet,
);
console.log(
  'Term licenses ready:',
  deployment.address,
  'Existing contracts, balances and licenses are preserved.',
);
