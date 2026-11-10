import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import TechnicalCode from '../src/components/technical-code';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { linearSteps } from '../src/lib/linear-walkthrough';
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
      <TechnicalCode />
    </QueryClientProvider>,
  );
}
it('shows every code step and output immediately without navigation or disclosure controls', async () => {
  const view = setup();
  await screen.findByText('No local deposit.');
  expect(screen.getByRole('heading', { name: 'Start the blockchain' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Verify the transaction on the node' })).toBeVisible();
  expect(screen.getByText('data/artguard.sqlite')).toBeVisible();
  expect(screen.getByText(/npm run chain/, { selector: 'code' })).toBeVisible();
  expect(screen.getByText(/EscrowFunded →/, { selector: 'code' })).toBeVisible();
  expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(8);
  expect(view.container.querySelectorAll('details, summary, [hidden]')).toHaveLength(0);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) => path === '/blockchain/escrow-proof' && !options?.method,
    ),
  ).toBe(true);
});
it('distinguishes expected terminal and RPC examples from the real node result in both languages', async () => {
  setup();
  await screen.findByText('No local deposit.');
  expect(screen.getAllByRole('heading', { name: 'Terminal example' })).toHaveLength(2);
  expect(screen.getByText(/Output examples show the expected format/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'RU' }));
  expect(screen.getAllByRole('heading', { name: 'Пример терминала' })).toHaveLength(2);
  expect(screen.getByRole('heading', { name: 'Настоящие данные узла' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Вывод долей авторам' })).toBeVisible();
  expect(linearSteps).toHaveLength(8);
  expect(linearSteps.every((step) => /example/.test(step.outputKind[0]))).toBe(true);
});
