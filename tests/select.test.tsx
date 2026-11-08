import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Select } from '../src/components/select';
import { Form, Field, Submit } from '../src/components/ui';

const options = [
  { value: 'free', label: 'Free' },
  { value: 'unavailable', label: 'Unavailable', disabled: true },
  { value: 'premium', label: 'Premium' },
  { value: 'top', label: 'Top' },
];
function Preview({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('free');
  return (
    <>
      <Select
        aria-label="Plan"
        value={value}
        onChange={setValue}
        options={options}
        disabled={disabled}
      />
      <button>Outside</button>
    </>
  );
}
it('selects with the keyboard, skips disabled choices, and restores focus', async () => {
  render(<Preview />);
  const user = userEvent.setup();
  await user.tab();
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(screen.getByRole('combobox', { name: 'Plan' })).toHaveTextContent('Premium');
  expect(screen.getByRole('combobox', { name: 'Plan' })).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.keyboard('{ArrowDown}{Home}{Enter}');
  expect(screen.getByRole('combobox', { name: 'Plan' })).toHaveTextContent('Free');
});
it('searches by currency name or code and commits the actual value', async () => {
  const change = vi.fn();
  render(
    <Select
      aria-label="Currency"
      value="USD"
      onChange={change}
      searchable
      options={[
        { value: 'USD', label: 'USD · US Dollar', group: 'Popular' },
        { value: 'KZT', label: 'KZT · Kazakhstani Tenge', group: 'Popular' },
        { value: 'BTC', label: 'BTC · Bitcoin', group: 'Crypto' },
      ]}
    />,
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Currency' }));
  await userEvent.type(screen.getByRole('combobox', { name: 'Search options' }), 'tenge');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  await userEvent.keyboard('{Enter}');
  expect(change).toHaveBeenCalledWith('KZT');
  expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveFocus();
});
it('dismisses without changing the value and keeps Escape inside a nested dropdown', async () => {
  const outerEscape = vi.fn();
  render(
    <div onKeyDown={(event) => event.key === 'Escape' && outerEscape()}>
      <Preview />
    </div>,
  );
  const trigger = screen.getByRole('combobox', { name: 'Plan' });
  await userEvent.click(trigger);
  await userEvent.keyboard('{End}{Escape}');
  expect(trigger).toHaveTextContent('Free');
  expect(outerEscape).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(trigger);
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
it('keeps disabled selects closed', async () => {
  render(<Preview disabled />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Plan' }));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
it('submits the chosen form value and inherits the pending form lock', async () => {
  let finish!: () => void;
  const submit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <Form
      schema={z.object({ role: z.enum(['Creator', 'Buyer']) })}
      defaults={{ role: 'Creator' }}
      onSubmit={submit}
    >
      <Field name="role" label="Role" options={['Creator', 'Buyer']} />
      <Submit>Save</Submit>
    </Form>,
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
  await userEvent.click(screen.getByRole('option', { name: 'Buyer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'Buyer' }),
    expect.anything(),
  );
  expect(screen.getByRole('combobox', { name: 'Role' })).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByRole('combobox', { name: 'Role' })).toBeEnabled();
  expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Buyer');
});
