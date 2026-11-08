import { createConnector } from 'wagmi';
import { getAddress, type Address, type ProviderConnectInfo } from 'viem';
import type { DemoWalletState } from '../../shared/demo';
import { api } from './api';
import { localChain } from '../../shared/blockchain';

export function demoWallet() {
  return createConnector((config) => {
    let connected = false;
    const account = async () => {
      const state = await api<DemoWalletState>('/demo/wallet');
      if (!state.available || !state.address)
        throw new Error('This account has no provisioned demo wallet.');
      return getAddress(state.address);
    };
    const provider = {
      async request({ method, params = [] }: { method: string; params?: readonly unknown[] }) {
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [await account()];
        if (method === 'wallet_switchEthereumChain') {
          if (Number((params[0] as { chainId: string })?.chainId) !== 31337)
            throw new Error('Demo wallets only support ArtGuard Local.');
          return null;
        }
        if (['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'].includes(method)) {
          const response = await api<{ result: unknown }>('/demo/wallet/rpc', {
            method: 'POST',
            data: { method, params },
          });
          return response.result;
        }
        const response = await api<{ result?: unknown; error?: { message: string; code: number } }>(
          '/blockchain/rpc',
          { method: 'POST', data: { jsonrpc: '2.0', id: 1, method, params } },
        );
        if (response.error)
          throw Object.assign(new Error(response.error.message), { code: response.error.code });
        return response.result;
      },
    };
    return {
      id: 'artguard-demo',
      name: 'ArtGuard demo wallet',
      type: 'artguard-demo',
      async connect({ withCapabilities } = {}) {
        const accounts = [await account()];
        connected = true;
        return {
          accounts: (withCapabilities
            ? accounts.map((address) => ({ address, capabilities: {} }))
            : accounts) as never,
          chainId: 31337,
        };
      },
      async disconnect() {
        connected = false;
      },
      async getAccounts() {
        return [await account()];
      },
      async getChainId() {
        return 31337;
      },
      async getProvider() {
        await account();
        return provider;
      },
      async isAuthorized() {
        return connected && !!(await api<DemoWalletState>('/demo/wallet')).available;
      },
      async switchChain({ chainId }) {
        if (chainId !== 31337) throw new Error('Only the local test chain is available.');
        return localChain;
      },
      onAccountsChanged(accounts: string[]) {
        config.emitter.emit('change', {
          accounts: accounts.map((a) => getAddress(a)) as readonly Address[],
        });
      },
      onChainChanged() {
        config.emitter.emit('change', { chainId: 31337 });
      },
      onConnect(_info: ProviderConnectInfo) {},
      onDisconnect() {
        connected = false;
        config.emitter.emit('disconnect');
      },
    };
  });
}
