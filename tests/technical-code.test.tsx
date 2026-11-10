import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import TechnicalCode from '../src/components/technical-code';
import { technicalSteps } from '../src/lib/technical-source';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
beforeEach(() => {
  vi.clearAllMocks();
});

it('shows current source lines and preserves the startup and escrow/withdrawal boundaries', () => {
  expect(technicalSteps).toHaveLength(15);
  for (const step of technicalSteps)
    for (const excerpt of step.sources) {
      expect(excerpt.path).not.toMatch(/\.env|private\.json|runtime\/|data\//);
      const lines = readFileSync(resolve(excerpt.path), 'utf8')
        .replaceAll('\r\n', '\n')
        .split('\n');
      expect(
        lines
          .slice(excerpt.firstLine - 1, excerpt.firstLine - 1 + excerpt.code.split('\n').length)
          .join('\n'),
      ).toBe(excerpt.code);
    }
  expect(
    technicalSteps
      .find((s) => s.id === 'deposit')!
      .sources.some((s) => s.path === 'contracts/EscrowLicenseMarketplace.sol'),
  ).toBe(true);
  expect(technicalSteps.find((s) => s.id === 'withdraw')!.sources[0].code).toContain(
    'balances[msg.sender] = 0',
  );
});
it('keeps the default screen short and reveals code only on request', async () => {
  render(<TechnicalCode />);
  const nav = within(screen.getByRole('navigation', { name: 'Walkthrough steps' }));
  expect(nav.getAllByRole('button')).toHaveLength(6);
  expect(screen.getByRole('heading', { name: 'Start the app and blockchain' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'GitHub' })).not.toBeInTheDocument();
  for (const item of screen.getAllByText('data/artguard.sqlite')) expect(item).not.toBeVisible();
  expect(mocks.api).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('Show code'));
  expect(screen.getByText(/npm ci/, { selector: 'code' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'GitHub' })).toBeVisible();
  await userEvent.click(nav.getByRole('button', { name: /Wallet/ }));
  expect(screen.queryByRole('link', { name: 'GitHub' })).not.toBeInTheDocument();
});
it('keeps wallet, storage and escrow details accessible behind concise disclosures', async () => {
  render(<TechnicalCode />);
  const nav = within(screen.getByRole('navigation', { name: 'Walkthrough steps' }));
  await userEvent.click(nav.getByRole('button', { name: /Wallet/ }));
  expect(screen.getByText('Linking a wallet does not authorize a payment.')).toBeVisible();
  await userEvent.click(screen.getByText('Show code'));
  await userEvent.click(
    within(screen.getByRole('navigation', { name: 'Code topics' })).getByRole('button', {
      name: 'Test wallets',
    }),
  );
  expect(screen.getByText(/This prototype mode is custodial/)).toBeVisible();
  await userEvent.click(nav.getByRole('button', { name: /File/ }));
  await userEvent.click(screen.getByText('Where data is stored'));
  expect(screen.getByText('Downloadable license record')).toBeVisible();
  expect(screen.getByText('data/uploads/<generated filename>')).toBeVisible();
  await userEvent.click(nav.getByRole('button', { name: /Escrow/ }));
  expect(screen.getByText('Delivery: 72h · Review: 24h · Dispute: 7 days')).toBeVisible();
  await userEvent.click(screen.getByText('Show code'));
  await userEvent.click(
    within(screen.getByRole('navigation', { name: 'Code topics' })).getByRole('button', {
      name: 'Refund',
      exact: true,
    }),
  );
  expect(screen.getByText(/separately calls withdrawRefund/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'RU' }));
  expect(screen.getByRole('heading', { name: 'Оплати через escrow' })).toBeVisible();
  expect(mocks.api).not.toHaveBeenCalled();
});
it('shows live verification only in the last step and checks connectivity only when requested', async () => {
  mocks.api.mockImplementation((path: string) =>
    path === '/health' ? Promise.resolve({ ok: true }) : Promise.reject(new Error('Node offline')),
  );
  render(<TechnicalCode proof={<p>Live verification placeholder</p>} />);
  expect(screen.queryByText('Live verification placeholder')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Show code'));
  await userEvent.click(screen.getByRole('button', { name: 'Check live connection' }));
  expect(await screen.findByText('Node offline')).toBeVisible();
  expect(mocks.api.mock.calls.map((call) => call[0]).sort()).toEqual(
    ['/health', '/blockchain/status', '/blockchain/marketplace'].sort(),
  );
  await userEvent.click(
    within(screen.getByRole('navigation', { name: 'Walkthrough steps' })).getByRole('button', {
      name: /Verify/,
    }),
  );
  expect(screen.getByText('Live verification placeholder')).toBeVisible();
  expect(mocks.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
});
