import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Editor from '../src/pages/editor';
const mocks = vi.hoisted(() => ({ api: vi.fn(), notify: vi.fn(), workspace: null as any }));
vi.mock('../src/lib/api', async (original) => ({ ...(await original()), api: mocks.api }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => mocks.workspace,
  useFeedback: () => ({ notify: mocks.notify }),
  useAction: () => ({}),
  workspaceKey: ['workspace'],
  errorText: (e: Error) => e.message,
}));
vi.mock('../src/components/dialogs', () => ({
  useDialog: () => ({ open: vi.fn() }),
  AccessPanel: () => null,
}));
const recipient = {
  name: 'Project collaborator',
  wallet: '0x2222222222222222222222222222222222222222',
  percent: 25,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace = {
    user: {
      id: 'owner',
      plan: 'free',
      wallet: null,
      recipients: [{ ...recipient, name: 'Upload default', percent: 15 }],
    },
    artworks: [
      {
        id: 'project-a',
        own: true,
        title: 'First project',
        description: 'Original artwork description.',
        price: 12,
        category: 'Illustration',
        licenses: ['personal'],
        licenseDurationDays: 90,
        status: 'published',
        recipients: [{ ...recipient }],
      },
    ],
    plans: { free: { name: 'Free', limit: 5 } },
  };
  mocks.api.mockResolvedValue({ ...mocks.workspace, artwork: { id: 'new-project' } });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
function setup(path: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/upload" element={<Editor />} />
          <Route path="/edit/:id" element={<Editor />} />
          <Route path="/artwork/:id" element={<p>Project saved</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('loads the project shares rather than upload defaults and saves edits as project metadata', async () => {
  setup('/edit/project-a');
  expect(screen.getByLabelText('Name / studio')).toHaveValue('Project collaborator');
  expect(screen.getByRole('combobox', { name: 'License period' })).toHaveTextContent('90 days');
  expect(screen.getByRole('status')).toHaveTextContent('75%');
  const share = screen.getByLabelText('Share of net proceeds, %');
  await userEvent.clear(share);
  await userEvent.type(share, '40');
  expect(screen.getByRole('status')).toHaveTextContent('60%');
  await userEvent.click(screen.getByRole('button', { name: 'Save artwork' }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalled());
  expect(mocks.api.mock.calls[0][0]).toBe('/artworks/project-a');
  expect(mocks.api.mock.calls[0][1]).toMatchObject({
    method: 'PATCH',
    data: { licenseDurationDays: 90, recipients: [{ ...recipient, percent: 40 }] },
  });
  expect(mocks.workspace.user.recipients[0].percent).toBe(15);
});
it('submits project co-authors as JSON inside a multipart artwork upload', async () => {
  setup('/upload');
  expect(screen.getByLabelText('Name / studio')).toHaveValue('Upload default');
  await userEvent.click(screen.getByRole('combobox', { name: 'License period' }));
  await userEvent.click(screen.getByRole('option', { name: '30 days' }));
  await userEvent.clear(screen.getByLabelText('Name / studio'));
  await userEvent.type(screen.getByLabelText('Name / studio'), 'New project partner');
  await userEvent.type(screen.getByLabelText('Title'), 'Uploaded project');
  await userEvent.type(screen.getByLabelText('Description'), 'An original uploaded image.');
  await userEvent.type(screen.getByLabelText('Base license price, USD'), '24');
  await userEvent.upload(
    screen.getByLabelText('Artwork file'),
    new File(['synthetic png'], 'project.png', { type: 'image/png' }),
  );
  await userEvent.click(screen.getByRole('checkbox', { name: /I created this artwork/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save artwork' }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalled());
  const [path, options] = mocks.api.mock.calls[0];
  expect(path).toBe('/artworks');
  expect(options.data).toBeInstanceOf(FormData);
  expect(options.data.get('licenseDurationDays')).toBe('30');
  expect(JSON.parse(options.data.get('recipients'))).toEqual([
    { ...recipient, name: 'New project partner', percent: 15 },
  ]);
});
it('clears the project recipients without falling back to upload defaults', async () => {
  setup('/edit/project-a');
  await userEvent.click(screen.getByRole('button', { name: 'Remove co-author 1' }));
  expect(screen.getByRole('status')).toHaveTextContent('100%');
  await userEvent.click(screen.getByRole('button', { name: 'Save artwork' }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalled());
  expect(mocks.api.mock.calls[0][1].data.recipients).toEqual([]);
});
it('refuses duplicate co-author wallets before uploading or saving', async () => {
  setup('/edit/project-a');
  await userEvent.click(screen.getByRole('button', { name: 'Add co-author' }));
  await userEvent.type(screen.getAllByLabelText('Name / studio')[1], 'Another co-author');
  await userEvent.type(screen.getAllByLabelText('Ethereum wallet')[1], recipient.wallet);
  await userEvent.click(screen.getByRole('button', { name: 'Save artwork' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Each co-author wallet must be unique.',
  );
  expect(mocks.api).not.toHaveBeenCalled();
});
