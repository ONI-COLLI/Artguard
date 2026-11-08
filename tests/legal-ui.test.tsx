import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { LegalFields } from '../src/components/legal-consent';
import { Form, Submit } from '../src/components/ui';
import { LEGAL_VERSION } from '../shared/legal';
it('requires explicit consent, submits the document version and keeps detail text collapsed', async () => {
  const submit = vi.fn();
  render(
    <MemoryRouter>
      <Form
        schema={z.object({
          legalAccepted: z.literal(true),
          legalVersion: z.literal(LEGAL_VERSION),
        })}
        defaults={{ legalAccepted: false }}
        onSubmit={async (v) => {
          submit(v);
        }}
      >
        <LegalFields />
        <Submit>Register test</Submit>
      </Form>
    </MemoryRouter>,
  );
  const checkbox = screen.getByRole('checkbox', { name: /I accept the prototype terms/ });
  expect(checkbox).not.toBeChecked();
  expect(screen.getByText('Data processing details').closest('details')).not.toHaveAttribute(
    'open',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Register test' }));
  expect(submit).not.toHaveBeenCalled();
  await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: 'Register test' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ legalAccepted: true, legalVersion: LEGAL_VERSION }),
  );
  expect(screen.getByRole('link', { name: /Privacy/ })).toHaveAttribute('href', '/legal/privacy');
});
