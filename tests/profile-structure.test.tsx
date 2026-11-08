import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MainNavigation, ProfileNavigation } from '../src/components/navigation';
import { PlanCards } from '../src/components/plan-cards';
import { planRules } from '../shared/schemas';

const mocks = vi.hoisted(() => ({ plan: 'free', role: 'Creator', auth: vi.fn() }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    plans: planRules,
    artworks: [],
    user: {
      id: 'creator',
      plan: mocks.plan,
      role: mocks.role,
      wallet: null,
      subscription: { plan: mocks.plan, validUntil: null, cancelAtEnd: false },
    },
  }),
}));
vi.mock('../src/components/dialogs', () => ({ useDialog: () => ({ auth: mocks.auth }) }));
function Location() {
  const l = useLocation();
  return <output aria-label="Current page">{l.pathname + l.search}</output>;
}
beforeEach(() => {
  sessionStorage.setItem('artguard:display-currency:v2', 'USD');
  mocks.plan = 'free';
  mocks.role = 'Creator';
  vi.clearAllMocks();
});

it('keeps three main sections and retains workspace access inside Profile', () => {
  render(
    <MemoryRouter initialEntries={['/works']}>
      <MainNavigation />
      <ProfileNavigation />
    </MemoryRouter>,
  );
  const main = within(screen.getByRole('navigation', { name: 'Main navigation' }));
  expect(main.getAllByRole('link').map((l) => l.textContent)).toEqual([
    'Home',
    'Marketplace',
    'Profile',
  ]);
  expect(main.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  const profile = within(screen.getByRole('navigation', { name: 'Profile sections' }));
  expect(profile.getByRole('link', { name: 'My artwork' })).toHaveAttribute('href', '/works');
  expect(profile.getByRole('link', { name: 'Licenses' })).toHaveAttribute('href', '/licenses');
  expect(profile.getByRole('link', { name: 'Wallet' })).toHaveAttribute('href', '/profile/wallet');
  expect(profile.getByRole('link', { name: 'Earnings' })).toHaveAttribute('href', '/analytics');
});
it('lets the same member buy licenses and create projects', () => {
  mocks.role = 'Buyer';
  render(
    <MemoryRouter initialEntries={['/licenses']}>
      <MainNavigation />
      <ProfileNavigation />
    </MemoryRouter>,
  );
  const profile = within(screen.getByRole('navigation', { name: 'Profile sections' }));
  expect(profile.getByRole('link', { name: 'Licenses' })).toHaveAttribute('aria-current', 'page');
  expect(profile.getByRole('link', { name: 'My artwork' })).toBeInTheDocument();
  expect(profile.getByRole('link', { name: 'Earnings' })).toBeInTheDocument();
});
it('compares the three plans and takes the selected paid plan into real billing', async () => {
  render(
    <MemoryRouter>
      <PlanCards />
      <Location />
    </MemoryRouter>,
  );
  const free = within(screen.getByRole('article', { name: 'Free plan' }));
  expect(free.getByText('$0')).toBeInTheDocument();
  expect(free.getByText('10%')).toBeInTheDocument();
  expect(free.getByRole('button', { name: 'Current plan' })).toBeDisabled();
  const premium = within(screen.getByRole('article', { name: 'Premium plan' }));
  expect(premium.getByText('$10')).toBeInTheDocument();
  expect(premium.getByText('5%')).toBeInTheDocument();
  const business = within(screen.getByRole('article', { name: 'Business plan' }));
  expect(business.getByText('$50')).toBeInTheDocument();
  expect(business.getByText('0%')).toBeInTheDocument();
  await userEvent.click(premium.getByRole('button', { name: 'Choose Premium' }));
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/billing?plan=premium');
});
it('preserves paid-plan renewal and cancellation rules rather than activating plans in the browser', async () => {
  mocks.plan = 'premium';
  const choose = vi.fn(),
    end = vi.fn();
  render(
    <MemoryRouter>
      <PlanCards onChoose={choose} onFree={end} />
    </MemoryRouter>,
  );
  expect(
    within(screen.getByRole('article', { name: 'Business plan' })).getByRole('button'),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Renew for 30 days' }));
  expect(choose).toHaveBeenCalledExactlyOnceWith('premium');
  await userEvent.click(screen.getByRole('button', { name: 'End paid plan at expiry' }));
  expect(end).toHaveBeenCalledOnce();
});
