import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  wallet: '0x2222222222222222222222222222222222222222',
  connection: {
    address: '0x1111111111111111111111111111111111111111',
    connector: { id: 'artguard-demo' },
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
  order: [] as string[],
}));
vi.mock('wagmi', () => ({
  useConnection: () => h.connection,
  useConnect: () => ({ mutateAsync: h.connect }),
  useDisconnect: () => ({ mutateAsync: h.disconnect, mutate: vi.fn() }),
  useConnectors: () => [{ id: 'artguard-demo' }],
}));
vi.mock('../src/lib/workspace', () => ({
  workspaceKey: ['workspace'],
  useWorkspace: () => ({ data: { user: { id: 'creator' } } }),
}));
vi.mock('../src/lib/session', () => ({ windowContext: 'isolated-demo-tab' }));
vi.mock('../src/lib/api', () => ({
  api: vi.fn(async () => ({ available: true, address: h.wallet })),
}));
import { DemoSession } from '../src/components/demo-session';
beforeEach(() => {
  h.wallet = '0x2222222222222222222222222222222222222222';
  h.order = [];
  h.connect.mockReset().mockImplementation(async () => {
    h.order.push('connect');
  });
  h.disconnect.mockReset().mockImplementation(async () => {
    h.order.push('disconnect');
  });
});
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DemoSession />
    </QueryClientProvider>,
  );
it('disconnects the old demo identity before reconnecting the same connector for a new account', async () => {
  show();
  await waitFor(() => expect(h.connect).toHaveBeenCalledOnce());
  expect(h.order).toEqual(['disconnect', 'connect']);
  expect(h.connect).toHaveBeenCalledWith({ connector: { id: 'artguard-demo' }, chainId: 31337 });
});
it('retains an already connected matching wallet', async () => {
  h.wallet = h.connection.address;
  show();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(h.disconnect).not.toHaveBeenCalled();
  expect(h.connect).not.toHaveBeenCalled();
});
