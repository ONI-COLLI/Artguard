import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ArtworkDetail } from '../src/pages/marketplace';

const mocks = vi.hoisted(() => ({ open: vi.fn(), download: vi.fn(), artwork: null as any }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({ user: { id: 'viewer' }, artworks: [mocks.artwork], purchases: [] }),
  useFeedback: () => ({ notify: vi.fn() }),
  useDownload: () => ({ pending: false, run: mocks.download }),
  useAction: () => ({}),
}));
vi.mock('../src/components/dialogs', () => ({
  useDialog: () => ({ open: mocks.open, auth: vi.fn() }),
}));
vi.mock('../src/components/chain-registration', () => ({
  ChainRegistrationCard: () => (
    <section>
      <h3>Blockchain registration</h3>
      <code>saved-transaction-hash</code>
    </section>
  ),
}));
vi.mock('../src/pages/coauthors', () => ({
  ShareStatusCard: () => <div>Co-author approval details</div>,
}));
vi.mock('../src/components/promotions', () => ({
  PromoteButton: () => <button>Promote</button>,
  PromotedShelf: () => null,
}));
beforeEach(() => {
  sessionStorage.setItem('artguard:display-currency:v2', 'USD');
  vi.clearAllMocks();
  mocks.artwork = {
    id: 'project',
    title: 'Quiet City',
    description: 'Detailed description of this original artwork.',
    author: 'Creator',
    category: 'Illustration',
    format: 'PNG',
    date: '2026-10-21',
    image: '/media/project',
    gallery: [],
    price: 24,
    status: 'published',
    licenses: ['personal'],
    own: false,
    seeded: false,
    blockchain: null,
  };
});
function setup() {
  render(
    <MemoryRouter initialEntries={['/artwork/project']}>
      <Routes>
        <Route path="/artwork/:id" element={<ArtworkDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}
it('keeps the description and purchase essentials visible while registration stays in additional information', async () => {
  setup();
  expect(screen.getByRole('heading', { name: 'Quiet City' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'License' })).toBeVisible();
  expect(screen.getByText('$24.00')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Description' })).toBeVisible();
  expect(screen.getByText(mocks.artwork.description)).toBeVisible();
  expect(screen.getByText('saved-transaction-hash')).not.toBeVisible();
  expect(screen.getByRole('button', { name: 'Get this license' })).toBeEnabled();
  await userEvent.click(screen.getByText('Additional information'));
  expect(screen.getByText(mocks.artwork.description)).toBeVisible();
  expect(screen.getByText('saved-transaction-hash')).toBeVisible();
  expect(screen.getByRole('link', { name: 'View registration' })).toBeVisible();
  await userEvent.click(screen.getByText('Additional information'));
  expect(screen.getByText('saved-transaction-hash')).not.toBeVisible();
  expect(screen.getByText(mocks.artwork.description)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Get this license' }));
  expect(mocks.open).toHaveBeenCalledWith('Get a license', expect.anything());
});
it('keeps creator actions accessible while completed co-author details stay collapsed', async () => {
  mocks.artwork.own = true;
  mocks.artwork.shareApproval = { ready: true };
  setup();
  expect(screen.getByRole('link', { name: 'Edit your artwork' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Promote' })).toBeVisible();
  expect(screen.getByText('Co-author approval details')).not.toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Download original' }));
  expect(mocks.download).toHaveBeenCalledWith('/api/artworks/project/download');
});
it('keeps unresolved approval feedback visible when a license cannot be purchased', () => {
  mocks.artwork.shareApproval = { ready: false };
  setup();
  expect(screen.getByText('Co-author approval details')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Get this license' })).toBeDisabled();
});
