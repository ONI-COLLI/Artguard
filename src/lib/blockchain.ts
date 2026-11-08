import { createConfig, createStorage, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useQuery } from '@tanstack/react-query';
import { localChain, type ChainStatus } from '../../shared/blockchain';
import { api } from './api';
import type { MarketStatus } from '../../shared/marketplace';
import { demoWallet } from './demo-wallet';
import { windowContext } from './session';
export const walletConfig = createConfig({
  chains: [localChain],
  connectors: [demoWallet(), injected()],
  storage: createStorage({
    key: 'artguard-wallet-' + (windowContext || 'default'),
    storage: sessionStorage,
  }),
  transports: { [localChain.id]: http('/api/blockchain/rpc', { retryCount: 0 }) },
});
export function useChainStatus() {
  return useQuery({
    queryKey: ['blockchain', 'status'],
    queryFn: () => api<ChainStatus>('/blockchain/status'),
    staleTime: 5000,
    refetchInterval: 30000,
    retry: false,
  });
}
export function walletError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Please try again.';
  if (/user rejected|user denied|request rejected|user cancelled/i.test(message))
    return 'Request cancelled in your wallet. You can try again when ready.';
  if (/insufficient funds/i.test(message))
    return 'Not enough test ETH. Open Wallet and choose Get test ETH.';
  return (error as { shortMessage?: string })?.shortMessage || message;
}
export function useMarketStatus() {
  return useQuery({
    queryKey: ['blockchain', 'marketplace'],
    queryFn: () => api<MarketStatus>('/blockchain/marketplace'),
    staleTime: 5000,
    refetchInterval: 30000,
    retry: false,
  });
}
