import type { Deployment } from '../shared/blockchain.js';
import {
  deploymentNames,
  type DeploymentLine,
  type DeploymentStatus,
} from '../shared/deployments.js';
import type { LocalBlockchain } from './blockchain.js';

// Public deployment metadata only. Never return accounts, signers, keys or configuration files.
export async function deploymentStatus(chain: LocalBlockchain): Promise<DeploymentStatus> {
  const status = await chain.status();
  const market = status.ready ? await chain.marketplaceStatus() : null;
  const candidates = (market?.ready ? market.contracts || [market.deployment!] : []).filter(
    Boolean,
  );
  async function marketplace(version: number) {
    const saved = candidates.find((item) => item.version === version);
    if (!saved) throw new Error('Deployment unavailable');
    return chain.requireMarketplace(saved.address);
  }
  const readers: Record<keyof typeof deploymentNames, () => Promise<Deployment | null>> = {
    registry: async () => status.deployment,
    marketplace: () => marketplace(2),
    timed: () => marketplace(3),
    escrow: () => marketplace(4),
    subscriptions: () => chain.subscriptionDeployment(),
    promotions: () => chain.promotionDeployment(),
  };
  const contracts = await Promise.all(
    (Object.keys(deploymentNames) as (keyof typeof deploymentNames)[]).map(
      async (id): Promise<DeploymentLine> => {
        const unavailable: DeploymentLine = {
          id,
          ready: false,
          address: null,
          transactionHash: null,
          blockNumber: null,
        };
        if (!status.ready) return unavailable;
        try {
          const saved = await readers[id]();
          if (!saved) return unavailable;
          const receipt = await chain.client.getTransactionReceipt({ hash: saved.transactionHash });
          const block = await chain.client.getBlock({ blockNumber: receipt.blockNumber });
          if (
            receipt.status !== 'success' ||
            receipt.contractAddress?.toLowerCase() !== saved.address.toLowerCase() ||
            receipt.blockHash !== block.hash
          )
            return unavailable;
          return {
            id,
            ready: true,
            address: saved.address,
            transactionHash: receipt.transactionHash,
            blockNumber: String(receipt.blockNumber),
          };
        } catch {
          return unavailable;
        }
      },
    ),
  );
  return {
    ready: status.ready && contracts.every((item) => item.ready),
    chainReady: status.ready,
    chainId: status.chainId,
    rpcUrl: status.rpcUrl,
    checkedAt: new Date().toISOString(),
    contracts,
  };
}
