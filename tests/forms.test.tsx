import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Form, Field, Submit } from '../src/components/ui';
import { loginSchema } from '../shared/schemas';
import { ApiError } from '../src/lib/api';
describe('React forms', () => {
  it('locks fields while waiting and prevents duplicate requests', async () => {
    let finish!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <Form
        schema={loginSchema}
        defaults={{ email: 'alice@example.test', password: 'valid-password' }}
        onSubmit={submit}
      >
        <Field name="email" label="Email address" type="email" />
        <Submit>Sign in</Submit>
      </Form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for server confirmation');
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByLabelText('Email address')).toBeEnabled();
  });
  it('shows field errors and prevents invalid submissions', async () => {
    const submit = vi.fn();
    render(
      <Form schema={loginSchema} onSubmit={submit}>
        <Field name="email" label="Email address" type="email" />
        <Field name="password" label="Password" type="password" />
        <Submit>Sign in</Submit>
      </Form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(submit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Email address'), 'alice@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'valid-password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.test', password: 'valid-password' }),
      expect.anything(),
    );
  });
  it('keeps the entered values and reenables submission after a server error', async () => {
    const submit = vi.fn().mockRejectedValue(new ApiError('Invalid email or password.', 401));
    render(
      <Form
        schema={loginSchema}
        defaults={{ email: 'alice@example.test', password: 'valid-password' }}
        onSubmit={submit}
      >
        <Field name="email" label="Email address" type="email" />
        <Field name="password" label="Password" type="password" />
        <Submit>Sign in</Submit>
      </Form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByLabelText('Email address')).toHaveValue('alice@example.test');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});
