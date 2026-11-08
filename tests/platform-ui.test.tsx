import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Billing from '../src/pages/billing';
import { ForgotPasswordForm, EmailAction } from '../src/components/account-security';
import { ApiError } from '../src/lib/api';
import { planRules } from '../shared/schemas';
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  notify: vi.fn(),
  wallet: '0x1111111111111111111111111111111111111111',
}));
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: mocks.wallet, chainId: 31337 }),
  useWriteContract: () => ({ mutateAsync: mocks.write }),
  useBalance: () => ({ refetch: vi.fn() }),
}));
vi.mock('../src/components/wallet', () => ({ WalletPanel: () => null }));
vi.mock('../src/components/dialogs', () => ({
  AccessPanel: () => null,
  useDialog: () => ({ auth: vi.fn() }),
}));
vi.mock('../src/lib/api', async (original) => ({ ...(await original()), api: mocks.api }));
vi.mock('../src/lib/blockchain', () => ({ walletError: (e: Error) => e.message }));
vi.mock('../src/lib/workspace', () => ({
  workspaceKey: ['workspace'],
  useData: () => ({
    user: {
      id: 'billing-user',
      plan: 'free',
      emailVerified: true,
      wallet: { address: mocks.wallet },
      subscription: { plan: 'free', validUntil: null, cancelAtEnd: false },
    },
    plans: planRules,
  }),
  useFeedback: () => ({ notify: mocks.notify }),
}));
const hash = '0x' + 'a'.repeat(64),
  id = '0x' + 'b'.repeat(64),
  key = 'artguard:subscription:billing-user';
const order: any = {
  id,
  plan: 'premium',
  contractAddress: '0x2222222222222222222222222222222222222222',
  signature: '0x' + '11'.repeat(65),
  status: 'prepared',
  transactionHash: null,
  validUntil: null,
  error: null,
  quote: {
    id,
    accountId: '0x' + 'c'.repeat(64),
    buyer: mocks.wallet,
    plan: 1,
    amount: '10000000000000000',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    expectedUntil: 0,
    instanceId: '0x' + 'd'.repeat(64),
  },
};
function setup(element = <Billing />, route = '/billing') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.write.mockResolvedValue(hash);
  mocks.api.mockImplementation(async (path: string) =>
    path === '/billing'
      ? { subscription: { plan: 'free', validUntil: null, cancelAtEnd: false }, orders: [] }
      : path === '/billing/orders'
        ? { order }
        : {},
  );
});
async function prepare() {
  await userEvent.click(screen.getByRole('button', { name: 'Choose Premium' }));
  await screen.findByText('Premium subscription order');
}
it('requires reviewing a subscription quote and retains it after wallet rejection', async () => {
  mocks.write.mockRejectedValueOnce(new Error('Payment rejected in wallet'));
  setup();
  await prepare();
  expect(screen.getByRole('button', { name: 'Pay 0.01 test ETH' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Pay 0.01 test ETH' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Payment rejected in wallet');
  expect(localStorage.getItem(key)).toBeNull();
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Pay 0.01 test ETH' })).toBeEnabled();
  expect(mocks.api.mock.calls.some(([path]) => path.includes('/confirm'))).toBe(false);
});
it('keeps the submitted hash when verification is unavailable and retries without paying twice', async () => {
  let attempts = 0;
  mocks.api.mockImplementation(async (path: string) => {
    if (path === '/billing')
      return { subscription: { plan: 'free', validUntil: null, cancelAtEnd: false }, orders: [] };
    if (path === '/billing/orders') return { order };
    if (path.includes('/confirm')) {
      if (++attempts === 1)
        throw new ApiError('Verification unavailable; retry this payment.', 503);
      return {
        order: {
          ...order,
          status: 'confirmed',
          transactionHash: hash,
          validUntil: Math.floor(Date.now() / 1000) + 2592000,
        },
      };
    }
    return {};
  });
  setup();
  await prepare();
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Pay 0.01 test ETH' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Verification unavailable');
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ id, hash });
  for (const button of [
    screen.getByRole('button', { name: 'Choose Premium' }),
    screen.getByRole('button', { name: 'Choose Business' }),
  ])
    expect(button).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Check payment' }));
  await waitFor(() =>
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Subscription payment verified' }),
    ),
  );
  expect(localStorage.getItem(key)).toBeNull();
  expect(mocks.write).toHaveBeenCalledTimes(1);
});
it('restores a submitted subscription from local storage without issuing another wallet payment', async () => {
  localStorage.setItem(key, JSON.stringify({ id, hash }));
  mocks.api.mockImplementation(async (path: string) =>
    path === '/billing'
      ? {
          subscription: { plan: 'free' },
          orders: [{ ...order, status: 'pending', transactionHash: hash }],
        }
      : { order: { ...order, status: 'pending', transactionHash: hash } },
  );
  setup();
  await screen.findByRole('button', { name: 'Check payment' });
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      `/billing/orders/${id}/confirm`,
      expect.objectContaining({ data: { transactionHash: hash } }),
    ),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});
it('shows reset request errors, retains the email and explains the local outbox on retry', async () => {
  mocks.api
    .mockRejectedValueOnce(new ApiError('Server unavailable', 503))
    .mockResolvedValueOnce({ message: 'If this account exists, its local message is ready.' });
  setup(<ForgotPasswordForm />, '/security');
  await userEvent.type(screen.getByLabelText('Account email'), 'recovery@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Request reset link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
  expect(screen.getByLabelText('Account email')).toHaveValue('recovery@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Request reset link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('local message is ready');
  expect(screen.getByText(/npm run mail/)).toBeInTheDocument();
});
it('verification failure offers recovery while retaining the link for retry', async () => {
  mocks.api.mockRejectedValueOnce(new ApiError('Verification link expired or already used.', 400));
  setup(<EmailAction mode="verify" />, '/verify-email?token=' + 'f'.repeat(64));
  await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('expired or already used');
  expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
});
it('a new email link requires a fresh action after a previous link succeeded', async () => {
  mocks.api.mockResolvedValue({ ok: true });
  setup(
    <>
      <Link to={'/verify-email?token=' + 'e'.repeat(64)}>Open another link</Link>
      <EmailAction mode="verify" />
    </>,
    '/verify-email?token=' + 'f'.repeat(64),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  await screen.findByText('Email verified successfully.');
  await userEvent.click(screen.getByRole('link', { name: 'Open another link' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Verify email' }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      '/auth/verify-email',
      expect.objectContaining({ data: { token: 'e'.repeat(64) } }),
    ),
  );
});
