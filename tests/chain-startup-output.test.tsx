import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChainStartupOutput } from '../src/components/chain-startup-output';
import { shortenHex } from '../src/components/short-hex';
import { deploymentNames } from '../shared/deployments';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
const address = '0x1234567890123456789012345678901234567890';
const hash = '0x' + 'a'.repeat(64);
const snapshot = {
  ready: true,
  chainReady: true,
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:8545',
  checkedAt: '2026-11-11T12:00:00Z',
  contracts: Object.keys(deploymentNames).map((id) => ({
    id,
    ready: true,
    address,
    transactionHash: hash,
    blockNumber: '7',
  })),
};
beforeEach(() => vi.resetAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ChainStartupOutput language="en" />
    </QueryClientProvider>,
  );
}
it('shows every startup contract and real deployment hash shortened with the full value on hover', async () => {
  mocks.api.mockResolvedValue(snapshot);
  setup();
  const output = await screen.findByLabelText('Current deployment output');
  for (const name of Object.values(deploymentNames)) expect(output).toHaveTextContent(name + ':');
  expect(output).toHaveTextContent(
    'ArtGuard local chain ready: http://127.0.0.1:8545 (chain 31337)',
  );
  expect(output).toHaveTextContent('node --env-file-if-exists=.env scripts/local-chain.mjs');
  expect(output).toHaveTextContent('Paid 7-day placements ready.');
  expect(screen.getAllByTitle(address)).toHaveLength(6);
  expect(screen.getAllByTitle(hash)).toHaveLength(6);
  expect(output).toHaveTextContent(shortenHex(address));
  expect(output).not.toHaveTextContent(address);
  expect(output).not.toHaveTextContent(hash);
  expect(output).not.toHaveTextContent('.env not found');
  expect(mocks.api).toHaveBeenCalledWith('/blockchain/deployments');
});
it('never invents ready output or addresses when the node or a deployment is unavailable', async () => {
  mocks.api.mockResolvedValue({
    ...snapshot,
    ready: false,
    chainReady: false,
    contracts: snapshot.contracts.map((item) => ({
      ...item,
      ready: false,
      address: null,
      transactionHash: null,
    })),
  });
  setup();
  const output = await screen.findByLabelText('Current deployment output');
  expect(output).toHaveTextContent('Local blockchain unavailable.');
  expect(output).not.toHaveTextContent('ArtGuard local chain ready:');
  expect(screen.getAllByText(/not confirmed/)).toHaveLength(6);
  expect(screen.queryByTitle(address)).not.toBeInTheDocument();
});
it('shows an error instead of a fabricated terminal when the status request fails', async () => {
  mocks.api.mockRejectedValue(new Error('Offline'));
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('No addresses confirmed');
  expect(screen.queryByLabelText('Current deployment output')).not.toBeInTheDocument();
});
