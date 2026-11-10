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
it('lets a guest study actual startup, fingerprint and contract code without sending requests', async () => {
  render(<TechnicalCode />);
  expect(
    screen.getByRole('heading', { name: '1. Install and build the actual project' }),
  ).toBeVisible();
  expect(screen.getByText(/npm ci/, { selector: 'code' })).toBeVisible();
  const nav = within(screen.getByRole('navigation', { name: 'Code walkthrough steps' }));
  await userEvent.click(nav.getByRole('button', { name: /File hash/ }));
  expect(
    screen.getByRole('heading', { name: '7. Upload a file and calculate its fingerprint' }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    expect.stringContaining('server/artwork.routes.ts#L'),
  );
  await userEvent.click(screen.getByRole('button', { name: 'RU' }));
  expect(
    screen.getByRole('heading', { name: '7. Загрузить файл и вычислить отпечаток' }),
  ).toBeVisible();
  await userEvent.click(nav.getByRole('button', { name: /Вывод/ }));
  expect(
    screen.getByRole('heading', { name: '14. Вывести начисление автора или соавтора' }),
  ).toBeVisible();
  expect(mocks.api).not.toHaveBeenCalled();
});
it('explains external and hosted wallets, actual storage formats and escrow branches without signing', async () => {
  render(<TechnicalCode />);
  await userEvent.click(screen.getByRole('button', { name: /How wallets connect/ }));
  expect(screen.getByRole('heading', { name: /4\. Connect and prove/ })).toBeVisible();
  expect(screen.getByText(/The external private key stays in the wallet/)).toBeVisible();
  const nav = within(screen.getByRole('navigation', { name: 'Code walkthrough steps' }));
  await userEvent.click(nav.getByRole('button', { name: /Test wallets/ }));
  expect(screen.getByText(/This prototype mode is custodial/)).toBeVisible();
  await userEvent.click(nav.getByRole('button', { name: /Data storage/ }));
  const map = within(screen.getByRole('region', { name: 'Data storage map' }));
  expect(map.getAllByRole('article')).toHaveLength(8);
  const document = map
    .getByRole('heading', { name: 'Downloadable license record' })
    .closest('article')!;
  await userEvent.click(within(document).getByText('Contents and access'));
  expect(within(document).getByText(/TXT generated on request/)).toBeVisible();
  expect(within(document).getByText(/It is not an NFT/)).toBeVisible();
  await userEvent.click(nav.getByRole('button', { name: /Deposit/ }));
  await userEvent.click(screen.getByRole('button', { name: /2\. Delivery \/ dispute/ }));
  expect(screen.getByRole('heading', { name: /11\. Confirm delivery/ })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /Alternative: refund/ }));
  expect(screen.getByText(/separately calls withdrawRefund/)).toBeVisible();
  expect(mocks.api).not.toHaveBeenCalled();
});
it('checks live connectivity only on request, reports failures and never sends a transaction', async () => {
  mocks.api.mockImplementation((path: string) =>
    path === '/health' ? Promise.resolve({ ok: true }) : Promise.reject(new Error('Node offline')),
  );
  render(<TechnicalCode />);
  expect(mocks.api).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Check live connection' }));
  expect(await screen.findByText('Node offline')).toBeVisible();
  expect(screen.getByText('● Node API: ready')).toBeVisible();
  expect(screen.getByText('○ License marketplace: unavailable')).toBeVisible();
  expect(mocks.api.mock.calls.map((c) => c[0]).sort()).toEqual(
    ['/health', '/blockchain/status', '/blockchain/marketplace'].sort(),
  );
  expect(mocks.api.mock.calls.every((c) => !c[1]?.method)).toBe(true);
});
