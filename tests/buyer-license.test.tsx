import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Licenses } from '../src/pages/account';
import { licenseUsageTerms } from '../shared/license-terms';
const mocks = vi.hoisted(() => ({ download: vi.fn(), notify: vi.fn() }));
const tx = '0x' + 'a'.repeat(64),
  buyer = '0x' + '1'.repeat(40);
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    user: { id: 'buyer', plan: 'free' },
    artworks: [
      {
        id: 'art',
        title: 'Shared Horizons',
        author: 'Demo Creator',
        image: '/media/art',
        own: false,
      },
    ],
    purchases: [
      {
        id: 'purchase',
        artworkId: 'art',
        license: 'personal',
        amount: 12,
        date: '2026-10-21',
        createdAt: '2026-10-21T12:00:00Z',
        payment: {
          amountWei: '12000000000000000',
          feeWei: '1200000000000000',
          transactionHash: tx,
          buyerWallet: buyer,
          chainId: 31337,
          allocations: [
            {
              name: 'Private collaborator',
              wallet: '0x' + '2'.repeat(40),
              percent: 25,
              amountWei: '2700000000000000',
            },
          ],
        },
      },
    ],
  }),
  useDownload: () => ({ pending: false, run: mocks.download }),
  useFeedback: () => ({ notify: mocks.notify }),
}));
vi.mock('../src/components/dialogs', () => ({
  useDialog: () => ({ open: vi.fn() }),
  AccessPanel: () => null,
}));
vi.mock('../src/components/blockchain-checkout', () => ({
  PendingBlockchainCheckouts: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it('shows buyer license essentials and a receipt without exposing revenue allocations', async () => {
  render(
    <MemoryRouter>
      <Licenses />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Your licenses' })).toBeVisible();
  expect(screen.getByText('0.012 test ETH')).toBeVisible();
  expect(
    screen.queryByText(/Private collaborator|0.0027 test ETH|Platform fee|75%|25%/),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Payment receipt'));
  expect(screen.getByText(tx)).toBeVisible();
  expect(screen.getByText(buyer)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Copy Transaction hash' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'License document' }));
  expect(mocks.download).toHaveBeenCalledWith('/api/licenses/purchase/document');
  await userEvent.click(screen.getByRole('button', { name: 'Original file' }));
  expect(mocks.download).toHaveBeenLastCalledWith('/api/artworks/art/download');
});
it('presents the selected frozen license terms rather than raw quote JSON', () => {
  const snapshot = JSON.stringify({
    version: 1,
    licenses: [
      { id: 'personal', terms: 'Personal rights at purchase time' },
      { id: 'commercial', terms: 'Different commercial rights' },
    ],
  });
  expect(licenseUsageTerms(snapshot, 'personal')).toBe('Personal rights at purchase time');
  expect(licenseUsageTerms('Legacy usage terms', 'commercial')).toBe('Legacy usage terms');
});
