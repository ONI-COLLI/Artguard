import type { Address, Hex } from 'viem';

export const deploymentNames = {
  registry: 'Registry',
  marketplace: 'License marketplace',
  timed: 'Timed licenses',
  escrow: 'Escrow marketplace',
  subscriptions: 'Subscription payments',
  promotions: 'Promotion payments',
} as const;

export interface DeploymentLine {
  id: keyof typeof deploymentNames;
  ready: boolean;
  address: Address | null;
  transactionHash: Hex | null;
  blockNumber: string | null;
}

export interface DeploymentStatus {
  ready: boolean;
  chainReady: boolean;
  chainId: number;
  rpcUrl: string;
  checkedAt: string;
  contracts: DeploymentLine[];
}
