import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sharing } from '../src/components/revenue-sharing';
const mocks = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn(), notify: vi.fn() }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    user: { recipients: [], wallet: { address: '0x1111111111111111111111111111111111111111' } },
  }),
  useAction: () => ({ mutateAsync: mocks.save, isPending: false }),
  useFeedback: () => ({ notify: mocks.notify }),
  errorText: (e: Error) => e.message,
}));
vi.mock('../src/components/dialogs', () => ({ useDialog: () => ({ close: mocks.close }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({});
});
const wallet = '0x2222222222222222222222222222222222222222';
async function fillCoauthor(address = wallet) {
  await userEvent.click(screen.getByRole('button', { name: 'Add co-author' }));
  await userEvent.type(screen.getByLabelText('Name / studio'), 'Test co-author');
  await userEvent.type(screen.getByLabelText('Ethereum wallet'), address);
}
it('adds co-authors, updates the creator share, and saves their wallets', async () => {
  render(<Sharing />);
  await fillCoauthor();
  expect(screen.getByRole('status')).toHaveTextContent('80%');
  await userEvent.click(screen.getByRole('button', { name: 'Save upload defaults' }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith({
      recipients: [{ name: 'Test co-author', wallet, percent: 20 }],
    }),
  );
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Upload defaults saved' }),
  );
});
it('rejects invalid and creator wallet addresses without sending changes', async () => {
  render(<Sharing />);
  await fillCoauthor('bad-wallet');
  await userEvent.click(screen.getByRole('button', { name: 'Save upload defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('valid, nonzero Ethereum wallet');
  const input = screen.getByLabelText('Ethereum wallet');
  await userEvent.clear(input);
  await userEvent.type(input, '0x1111111111111111111111111111111111111111');
  await userEvent.click(screen.getByRole('button', { name: 'Save upload defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('differ from your creator wallet');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('retains values when saving fails and permits removing a recipient', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Connection interrupted'));
  render(<Sharing />);
  await fillCoauthor();
  await userEvent.click(screen.getByRole('button', { name: 'Save upload defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
  expect(screen.getByLabelText('Ethereum wallet')).toHaveValue(wallet);
  expect(mocks.close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove co-author 1' }));
  expect(screen.getByRole('status')).toHaveTextContent('100%');
  await userEvent.click(screen.getByRole('button', { name: 'Save upload defaults' }));
  await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith({ recipients: [] }));
});
