import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ChainRegistrationCard } from '../src/components/chain-registration';
import { ApiError } from '../src/lib/api';

const state = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  notify: vi.fn(),
  address: '0x1111111111111111111111111111111111111111',
}));
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: state.address, chainId: 31337, isConnected: true }),
  useWriteContract: () => ({ mutateAsync: state.write }),
}));
vi.mock('../src/components/wallet', () => ({ WalletPanel: () => null }));
vi.mock('../src/components/dialogs', () => ({ useDialog: () => ({ open: vi.fn() }) }));
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: state.api,
}));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({ user: { id: 'user-1', wallet: { address: state.address } } }),
  useFeedback: () => ({ notify: state.notify }),
  workspaceKey: ['workspace'],
}));
vi.mock('../src/lib/blockchain', () => ({
  useChainStatus: () => ({ data: { ready: true, deployment: { instanceId: '0xinstance' } } }),
  walletError: (e: Error) =>
    e.message.includes('rejected')
      ? 'Request cancelled in your wallet. You can try again when ready.'
      : e.message,
}));

const hash = '0x' + 'a'.repeat(64),
  key = 'artguard:registration:user-1:art-1';
const artwork = {
  id: 'art-1',
  own: true,
  seeded: false,
  status: 'published',
  blockchain: null,
} as any;
const record = {
  id: 'intent-1',
  fileHash: hash,
  termsHash: hash,
  status: 'prepared',
  instanceId: '0xinstance',
  transactionHash: null,
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChainRegistrationCard artwork={artwork} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  state.api.mockImplementation(async (path: string) =>
    path.endsWith('/prepare')
      ? { registration: record, deployment: { address: state.address } }
      : { record: null, pending: null, verified: false },
  );
});
describe('blockchain registration feedback', () => {
  it('keeps the action available after the user declines the wallet transaction', async () => {
    state.write.mockRejectedValue(new Error('User rejected the request'));
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Register on local blockchain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Request cancelled in your wallet');
    expect(screen.getByRole('button', { name: 'Register on local blockchain' })).toBeEnabled();
    expect(localStorage.getItem(key)).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
  });
  it('restores a saved hash after reload and keeps it when the server is offline', async () => {
    localStorage.setItem(key, JSON.stringify({ id: 'intent-1', transactionHash: hash }));
    state.api.mockImplementation(async (path: string) => {
      if (path.endsWith('/confirm')) throw new ApiError('Server unavailable', 503);
      return { record: null, pending: null, verified: false };
    });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.getByRole('button', { name: 'Check transaction' })).toBeEnabled();
    expect(localStorage.getItem(key)).toContain(hash);
    expect(state.write).not.toHaveBeenCalled();
  });
  it('clears a rejected proof and permits a new registration instead of leaving a pending screen', async () => {
    localStorage.setItem(key, JSON.stringify({ id: 'intent-1', transactionHash: hash }));
    state.api.mockImplementation(async (path: string) => {
      if (path.endsWith('/confirm')) throw new ApiError('Transaction reverted', 422);
      return { record: null, pending: null, verified: false };
    });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Transaction reverted');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Register on local blockchain' })).toBeEnabled(),
    );
    expect(localStorage.getItem(key)).toBeNull();
    expect(state.notify).not.toHaveBeenCalled();
  });
});
