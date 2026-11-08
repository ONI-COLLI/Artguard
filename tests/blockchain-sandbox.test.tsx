import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { webcrypto, createHash } from 'node:crypto';
import { BlockchainSandbox } from '../src/components/blockchain-sandbox';
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
it('hashes real sample bytes, rejects changed signed inputs, then demonstrates atomic credits and a separate withdrawal', async () => {
  render(<BlockchainSandbox />);
  expect(screen.getByText(/Simulation · no real transactions/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Keep project and continue' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Calculate the fingerprint first');
  await userEvent.click(screen.getByRole('button', { name: 'Calculate sample fingerprint' }));
  await screen.findByText(
    createHash('sha256').update('ArtGuard teaching sample — a collaborative artwork').digest('hex'),
  );
  for (const name of [
    'Keep project and continue',
    'Sign creator challenge',
    'Record registration',
    'Sign buyer challenge',
    'Sign offer',
  ])
    await userEvent.click(screen.getByRole('button', { name }));
  const price = screen.getByRole('checkbox', { name: 'Change the signed price' });
  await userEvent.click(price);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm simulated payment' }));
  expect(screen.getByRole('alert')).toHaveTextContent('invalidates the signature');
  expect(screen.getByText('License: Not issued')).toBeVisible();
  await userEvent.click(price);
  const sender = screen.getByRole('checkbox', { name: 'Send from a different wallet' });
  await userEvent.click(sender);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm simulated payment' }));
  expect(screen.getByRole('alert')).toHaveTextContent('sending wallet differs');
  await userEvent.click(sender);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm simulated payment' }));
  expect(screen.getByText(/Creator 0.0081 · co-author 0.0027/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Read verified license' }));
  await userEvent.click(screen.getByRole('button', { name: 'Withdraw simulated share' }));
  expect(screen.getByRole('status')).toHaveTextContent('Simulation complete');
  expect(screen.getByText('Withdrawal: 0.0027 test ETH received')).toBeVisible();
  await userEvent.click(screen.getByText('Is this escrow?'));
  expect(screen.getByText(/There is no waiting for buyer acceptance/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Reset practice' }));
  expect(screen.getByText('License: Not issued')).toBeVisible();
});
