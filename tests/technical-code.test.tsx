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
it('uses four blocks with source filenames and line numbers, without an IDE shell', async () => {
  const view = setup();
  expect(studioBlocks).toHaveLength(4);
  expect(new Set(studioBlocks.flatMap((block) => block.steps)).size).toBe(8);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('tab', { name: /Start/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Start the local stack' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Terminal and output' })).toBeVisible();
  expect(screen.getByText(/npm run chain/, { selector: 'code' })).toBeVisible();
  expect(view.container.querySelectorAll('.syntax-keyword').length).toBeGreaterThan(0);
  expect(view.container.querySelectorAll('.walkthrough-line-number').length).toBeGreaterThan(0);
  expect(view.container.querySelectorAll('details,summary')).toHaveLength(0);
  expect(screen.getByRole('region', { name: 'Code' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'deploy-escrow-marketplace.mjs' })).toBeVisible();
  expect(screen.getByText('scripts/')).toBeVisible();
  expect(
    view.container.querySelector('.studio-fullscreen, .studio-activity, .studio-statusbar'),
  ).toBeNull();
  expect(screen.queryByRole('link', { name: 'Back to ArtGuard' })).not.toBeInTheDocument();
  expect(mocks.api).toHaveBeenCalledWith('/blockchain/deployments');
});
it('navigates blocks by keyboard and shows filenames, directories and storage', async () => {
  setup();
  screen.getByRole('tab', { name: /Start/ }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('heading', { name: 'Wallet → file → fingerprint' })).toBeVisible();
  expect(screen.getByText('data/artguard.sqlite')).toBeVisible();
  expect(screen.getByRole('link', { name: 'ArtworkRegistry.sol' })).toBeVisible();
  expect(screen.getByText('contracts/')).toBeVisible();
  expect(document.querySelectorAll('.walkthrough-code-file pre').length).toBeGreaterThan(1);
  expect(mocks.api.mock.calls.every(([path]) => path === '/blockchain/deployments')).toBe(true);
});
it('labels examples separately from deployment and payment data read from the real node', async () => {
  setup();
  expect(screen.getAllByText('Terminal example')).toHaveLength(1);
  expect(screen.getByText('Live deployment · RPC')).toBeVisible();
  await userEvent.click(screen.getByRole('tab', { name: /Payouts & proof/ }));
  expect(await screen.findByText('No local deposit.')).toBeVisible();
  expect(screen.getByText('LIVE · ANVIL JSON-RPC')).toBeVisible();
  expect(screen.getByText('EXAMPLE + LIVE RPC')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'RU' }));
  expect(screen.getByRole('heading', { name: 'Вывод → проверка на узле' })).toBeVisible();
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) =>
        ['/blockchain/deployments', '/blockchain/escrow-proof'].includes(path) && !options?.method,
    ),
  ).toBe(true);
});
