import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import TechnicalCode from '../src/components/technical-code';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { linearSteps, studioBlocks } from '../src/lib/linear-walkthrough';
import { MemoryRouter } from 'react-router-dom';
import { technicalSteps } from '../src/lib/technical-source';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.mockResolvedValue({
    status: 'not_found',
    checkedAt: '2026-11-10T12:00:00Z',
    message: 'No local deposit.',
    checks: [],
    orders: [],
  });
});

it('shows current source lines and preserves the startup and escrow/withdrawal boundaries', () => {
  expect(technicalSteps).toHaveLength(15);
  for (const step of [...technicalSteps, ...linearSteps])
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
function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <MemoryRouter>
        <TechnicalCode />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('uses four horizontal blocks and shows the editor and terminal together without disclosures', async () => {
  const view = setup();
  expect(studioBlocks).toHaveLength(4);
  expect(new Set(studioBlocks.flatMap((block) => block.steps)).size).toBe(8);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('tab', { name: /Start/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Start the local stack' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Terminal and output' })).toBeVisible();
  expect(screen.getByText(/npm run chain/, { selector: 'code' })).toBeVisible();
  expect(view.container.querySelectorAll('.syntax-keyword').length).toBeGreaterThan(0);
  expect(view.container.querySelectorAll('.studio-line-number').length).toBeGreaterThan(0);
  expect(view.container.querySelectorAll('details,summary')).toHaveLength(0);
  expect(screen.getByRole('link', { name: 'Back to ArtGuard' })).toHaveAttribute('href', '/home');
  expect(mocks.api).not.toHaveBeenCalled();
});
it('navigates blocks by keyboard, keeps all selected source fragments and exposes storage in block two', async () => {
  setup();
  screen.getByRole('tab', { name: /Start/ }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('heading', { name: 'Wallet → file → fingerprint' })).toBeVisible();
  expect(screen.getByText('data/artguard.sqlite')).toBeVisible();
  const codeParts = document.querySelectorAll('.studio-code-file pre').length;
  await userEvent.click(screen.getByRole('button', { name: /ArtworkRegistry.sol/ }));
  expect(document.querySelectorAll('.studio-code-file pre')).toHaveLength(codeParts);
  expect(mocks.api).not.toHaveBeenCalled();
});
it('labels examples and reads the real node only in the payout and verification block', async () => {
  setup();
  expect(screen.getByText('EXAMPLE OUTPUT')).toBeVisible();
  await userEvent.click(screen.getByRole('tab', { name: /Payouts & proof/ }));
  expect(await screen.findByText('No local deposit.')).toBeVisible();
  expect(screen.getByText('LIVE · ANVIL JSON-RPC')).toBeVisible();
  expect(screen.getByText('EXAMPLE + LIVE RPC')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'RU' }));
  expect(screen.getByRole('heading', { name: 'Вывод → проверка на узле' })).toBeVisible();
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) => path === '/blockchain/escrow-proof' && !options?.method,
    ),
  ).toBe(true);
});
