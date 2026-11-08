import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromotionCheckout, PromotedShelf } from '../src/components/promotions';
import { ApiError } from '../src/lib/api';
import { promotionAbi, promotionMessage } from '../shared/promotions';
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  notify: vi.fn(),
  buyer: '0x1111111111111111111111111111111111111111',
}));
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: mocks.buyer, chainId: 31337 }),
  useWriteContract: () => ({ mutateAsync: mocks.write }),
  useBalance: () => ({ data: { value: 10n ** 18n }, refetch: vi.fn() }),
}));
vi.mock('../src/components/dialogs', () => ({
  useDialog: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock('../src/components/wallet', () => ({ WalletPanel: () => null }));
vi.mock('../src/lib/api', async (original) => ({ ...(await original()), api: mocks.api }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    user: { id: 'creator', emailVerified: true, wallet: { address: mocks.buyer } },
    artworks: [{ id: 'art-1', own: true }],
  }),
  useFeedback: () => ({ notify: mocks.notify }),
}));
vi.mock('../src/lib/blockchain', () => ({ walletError: (e: Error) => e.message }));
const artwork: any = {
  id: 'art-1',
  title: 'Promoted original',
  author: 'Artist',
  image: '/media/art-1',
  price: 12,
  status: 'published',
  own: true,
};
const order: any = {
  id: '0x' + 'a'.repeat(64),
  artworkId: 'art-1',
  title: artwork.title,
  contractAddress: '0x3333333333333333333333333333333333333333',
  quote: {
    id: '0x' + 'a'.repeat(64),
    projectId: '0x' + 'b'.repeat(64),
    buyer: mocks.buyer,
    amount: '5000000000000000',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    expectedUntil: 0,
    instanceId: '0x' + 'c'.repeat(64),
  },
  signature: '0x' + '11'.repeat(65),
  status: 'prepared',
  transactionHash: null,
  startsAt: null,
  validUntil: null,
  error: null,
};
const hash = ('0x' + 'd'.repeat(64)) as `0x${string}`;
const confirmed = {
  ...order,
  status: 'confirmed',
  transactionHash: hash,
  startsAt: Math.floor(Date.now() / 1000),
  validUntil: Math.floor(Date.now() / 1000) + 604800,
};
function setup(body = <PromotionCheckout artwork={artwork} />) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>{body}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.write.mockResolvedValue(hash);
  mocks.api.mockImplementation(async (path) => {
    if (path.startsWith('/promotions?'))
      return { ready: true, message: '', active: null, orders: [] };
    if (path === '/promotions/orders') return { order };
    if (path.endsWith('/confirm')) return { order: confirmed };
    return { featured: [] };
  });
});
it('activates only after verification and pays the exact signed promotion quote', async () => {
  setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Prepare promotion payment' }));
  expect(await screen.findByRole('button', { name: 'Pay 0.005 test ETH' })).toBeDisabled();
  expect(screen.queryByText(/Payment verified/)).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Promote this project for 7 days at the price shown.' }),
  );
  await userEvent.dblClick(screen.getByRole('button', { name: 'Pay 0.005 test ETH' }));
  await screen.findByText('Payment verified · 7 days added');
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.write).toHaveBeenCalledWith(
    expect.objectContaining({
      abi: promotionAbi,
      address: order.contractAddress,
      functionName: 'purchase',
      args: [promotionMessage(order.quote), order.signature],
      value: 5000000000000000n,
    }),
  );
  expect(mocks.api).toHaveBeenCalledWith(
    `/promotions/orders/${order.id}/confirm`,
    expect.objectContaining({ data: { transactionHash: hash } }),
  );
  expect(localStorage.getItem('artguard:promotion:creator:art-1')).toBeNull();
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});
it('recovers a saved payment after a verification outage without offering a second charge', async () => {
  localStorage.setItem('artguard:promotion:creator:art-1', JSON.stringify({ id: order.id, hash }));
  let checks = 0;
  mocks.api.mockImplementation(async (path) => {
    if (path.startsWith('/promotions?'))
      return {
        ready: true,
        message: '',
        active: null,
        orders: [{ ...order, status: 'pending', transactionHash: hash }],
      };
    if (path.endsWith('/confirm')) {
      if (checks++ === 0) throw new ApiError('Verification temporarily unavailable', 503);
      return { order: confirmed };
    }
    return {};
  });
  setup();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Pay 0.005 test ETH' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Check payment' }));
  await screen.findByText('Payment verified · 7 days added');
  expect(mocks.write).not.toHaveBeenCalled();
});
it('shows only featured matching projects in the separate promoted shelf', async () => {
  mocks.api.mockResolvedValue({ featured: [{ artworkId: 'art-1' }, { artworkId: 'missing' }] });
  setup(
    <PromotedShelf artworks={[artwork, { ...artwork, id: 'ordinary', title: 'Unpaid project' }]} />,
  );
  expect(
    await screen.findByRole('link', { name: 'View promoted artwork: Promoted original' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('Unpaid project')).not.toBeInTheDocument();
  expect(screen.getByText('Paid placements')).toBeInTheDocument();
  expect(screen.getByLabelText('Scroll promoted projects horizontally')).toHaveAttribute(
    'tabindex',
    '0',
  );
});
it('shows the existing paid end date and offers an extension without charging automatically', async () => {
  mocks.api.mockResolvedValue({
    ready: true,
    message: '',
    active: { startsAt: confirmed.startsAt, validUntil: confirmed.validUntil },
    orders: [confirmed],
  });
  setup();
  await screen.findByText(/Promoted until/);
  expect(screen.getByRole('button', { name: 'Extend promotion · 7 days' })).toBeEnabled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.api).toHaveBeenCalledTimes(1);
});
