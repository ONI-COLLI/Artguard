import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseEther } from 'viem';
import { BlockchainCheckout } from '../src/components/blockchain-checkout';
import { ApiError } from '../src/lib/api';
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  notify: vi.fn(),
  buyer: '0x1111111111111111111111111111111111111111',
}));
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: mocks.buyer, chainId: 31337, isConnected: true }),
  useWriteContract: () => ({ mutateAsync: mocks.write }),
  useBalance: () => ({ data: { value: 10n ** 18n } }),
}));
vi.mock('../src/components/wallet', () => ({ WalletPanel: () => null }));
vi.mock('../src/components/dialogs', () => ({
  useDialog: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: mocks.api,
}));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    user: { id: 'user-1', wallet: { address: mocks.buyer } },
    artworks: [{ id: 'art-1', title: 'Test artwork', price: 12, blockchain: {}, seeded: false }],
  }),
  useFeedback: () => ({ notify: mocks.notify }),
  workspaceKey: ['workspace'],
}));
vi.mock('../src/lib/blockchain', () => ({
  useMarketStatus: () => ({
    data: {
      ready: true,
      deployment: {
        address: '0x3333333333333333333333333333333333333333',
        instanceId: '0x' + 'b'.repeat(64),
      },
    },
  }),
  walletError: (e: Error) => e.message,
}));
const hash = '0x' + 'a'.repeat(64),
  storageKey = 'artguard:checkout:user-1:art-1:commercial';
const order: any = {
  id: 'checkout-1',
  buyerWallet: mocks.buyer,
  instanceId: '0x' + 'b'.repeat(64),
  contractAddress: '0x3333333333333333333333333333333333333333',
  status: 'prepared',
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  transactionHash: null,
  totalWei: String(parseEther('0.03')),
  purchaseIds: [],
  error: null,
  items: [
    {
      artworkId: 'art-1',
      title: 'Test artwork',
      license: 'commercial',
      signature: '0x' + '11'.repeat(65),
      terms: 'Commercial usage terms',
      feeWei: String(parseEther('0.0015')),
      referenceAmount: 30,
      quote: {
        id: '0x' + 'c'.repeat(64),
        buyer: mocks.buyer,
        seller: '0x2222222222222222222222222222222222222222',
        fileHash: hash,
        licenseType: 2,
        termsHash: hash,
        amount: String(parseEther('0.03')),
        feeBps: 500,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        instanceId: '0x' + 'b'.repeat(64),
      },
    },
  ],
};
function setup(initial?: any) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BlockchainCheckout
          initial={initial}
          items={[{ artworkId: 'art-1', license: 'commercial' }]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  sessionStorage.setItem('artguard:display-currency:v2', 'USD');
  localStorage.clear();
  vi.clearAllMocks();
  mocks.write.mockResolvedValue(hash);
  mocks.api.mockResolvedValue({ checkout: order });
});
describe('blockchain checkout feedback', () => {
  it('shows the payment essentials while wallet, contract and recovery details stay collapsed', async () => {
    setup();
    expect(screen.getByText('$30.00')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByRole('button', { name: 'Pay 0.03 test ETH' })).toBeDisabled();
    expect(screen.getByText('0.03 test ETH')).toBeVisible();
    expect(screen.getByText('Test ETH only · network gas is additional.')).toBeVisible();
    expect(screen.getByText(mocks.buyer)).not.toBeVisible();
    expect(screen.getByText(order.contractAddress)).not.toBeVisible();
    expect(screen.getByRole('checkbox')).toBeVisible();
    await userEvent.click(screen.getByText('Usage terms'));
    expect(screen.getByText('Commercial usage terms')).toBeVisible();
    await userEvent.click(screen.getByText('Additional information'));
    expect(screen.getByText(mocks.buyer)).toBeVisible();
    expect(screen.getByText(order.contractAddress)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recover an existing payment' })).toBeVisible();
    await userEvent.click(screen.getByText('Additional information'));
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Pay 0.03 test ETH' })).toBeEnabled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('keeps expired-price feedback and the refresh action outside technical information', () => {
    setup({ ...order, expiresAt: Math.floor(Date.now() / 1000) - 60 });
    expect(screen.getByText('This price has expired. Refresh it to continue.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh price' })).toBeEnabled();
    expect(screen.getByText(order.contractAddress)).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pay 0.03 test ETH' })).not.toBeInTheDocument();
  });
  it('keeps revenue splits out of buyer checkout while passing frozen shares to the contract', async () => {
    const recipient = '0x4444444444444444444444444444444444444444';
    const split = structuredClone(order);
    split.marketVersion = 2;
    split.items[0].allocations = [
      {
        name: 'Artist',
        wallet: split.items[0].quote.seller,
        percent: 75,
        amountWei: '21375000000000000',
        creator: true,
      },
      {
        name: 'Collaborator',
        wallet: recipient,
        percent: 25,
        amountWei: '7125000000000000',
        creator: false,
      },
    ];
    split.items[0].quote.recipients = [recipient];
    split.items[0].quote.shares = [2500];
    setup(split);
    expect(screen.queryByText('Collaborator · Co-author')).not.toBeInTheDocument();
    expect(screen.queryByText('0.007125 test ETH')).not.toBeInTheDocument();
    expect(screen.queryByText(/Platform fee|Revenue distribution/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Additional information'));
    expect(screen.queryByText(recipient)).not.toBeInTheDocument();
    expect(screen.queryByText(/Platform fee|Revenue distribution/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Pay 0.03 test ETH' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalled());
    expect(mocks.write.mock.calls[0][0].args[0][0]).toMatchObject({
      recipients: [recipient],
      shares: [2500],
    });
  });
  it('requires reviewed terms and lets the user retry after declining wallet payment', async () => {
    mocks.write.mockRejectedValue(new Error('User rejected payment'));
    setup(order);
    expect(screen.getByRole('button', { name: 'Pay 0.03 test ETH' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Pay 0.03 test ETH' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('User rejected payment');
    expect(screen.getByRole('button', { name: 'Pay 0.03 test ETH' })).toBeEnabled();
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('waits for server verification before showing an issued license', async () => {
    let confirm!: (v: any) => void;
    mocks.api.mockImplementation((path: string) =>
      path.endsWith('/confirm')
        ? new Promise((resolve) => {
            confirm = resolve;
          })
        : Promise.resolve({ checkout: order }),
    );
    setup(order);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Pay 0.03 test ETH' }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        '/blockchain/checkouts/checkout-1/confirm',
        expect.anything(),
      ),
    );
    expect(screen.getByText('Payment submitted · awaiting verification')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check payment' })).toBeVisible();
    expect(screen.getByText(hash)).not.toBeVisible();
    await userEvent.click(screen.getByText('Additional information'));
    expect(screen.getByText(hash)).toBeVisible();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toContain(hash);
    await act(async () =>
      confirm({
        checkout: {
          ...order,
          status: 'confirmed',
          transactionHash: hash,
          purchaseIds: ['license-1'],
        },
      }),
    );
    expect(await screen.findByText('Payment verified · licenses issued')).toBeVisible();
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ value: parseEther('0.03'), chainId: 31337 }),
    );
  });
  it('restores a submitted payment after reload and preserves its hash during a server outage', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ id: order.id, transactionHash: hash }));
    mocks.api.mockImplementation(async (path: string) => {
      if (path.endsWith('/confirm')) throw new ApiError('Server unavailable', 503);
      return { checkout: order };
    });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.getByRole('button', { name: 'Check payment' })).toBeEnabled();
    expect(localStorage.getItem(storageKey)).toContain(hash);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('clears a proven failed payment and offers a new quote without granting access', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ id: order.id, transactionHash: hash }));
    mocks.api.mockImplementation(async (path: string) => {
      if (path.endsWith('/confirm')) throw new ApiError('Payment transaction reverted', 422);
      return { checkout: order };
    });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment transaction reverted');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh price' })).toBeEnabled(),
    );
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
