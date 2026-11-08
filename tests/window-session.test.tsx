import { beforeEach, afterEach, expect, test, vi } from 'vitest';

const key = 'artguard.window-context';
let owners: Set<string>;
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/#/overview');
  owners = new Set();
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn(async (name, _options, callback) => {
        if (owners.has(name)) return callback(null);
        owners.add(name);
        try {
          return await callback({ name });
        } finally {
          owners.delete(name);
        }
      }),
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('an ordinary site URL automatically receives an independent tab session before API and image requests', async () => {
  const session = await import('../src/lib/session');
  await session.initializeWindowSession();
  expect(session.windowContext).toMatch(/^tab-[a-f0-9-]+$/);
  expect(sessionStorage.getItem(key)).toBe(session.windowContext);
  expect(new URL(window.location.href).searchParams.get('window')).toBe(session.windowContext);
  expect(window.location.hash).toBe('#/overview');
  expect(fetch).toHaveBeenCalledWith(
    '/api/auth/window',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ context: session.windowContext }),
    }),
  );
  expect(session.sessionUrl('/api/state')).toBe('/api/state?__window=' + session.windowContext);
  expect(session.sessionUrl('/media/project?download=1')).toBe(
    '/media/project?download=1&__window=' + session.windowContext,
  );
  expect(session.sessionUrl('blob:preview')).toBe('blob:preview');
  expect(session.sessionUrl('https://example.test/image.png')).toBe(
    'https://example.test/image.png',
  );
});

test('reloading or typing the normal site URL in the same tab keeps its account context', async () => {
  sessionStorage.setItem(key, 'saved-tab');
  const session = await import('../src/lib/session');
  await session.initializeWindowSession();
  expect(session.windowContext).toBe('saved-tab');
  expect(fetch).not.toHaveBeenCalled();
});

test('a duplicated tab forks a copied sessionStorage context without logging out the original', async () => {
  sessionStorage.setItem(key, 'original-tab');
  window.history.replaceState({}, '', '/?window=original-tab#/licenses');
  owners.add('artguard-window:original-tab');
  const session = await import('../src/lib/session');
  await session.initializeWindowSession();
  expect(session.windowContext).not.toBe('original-tab');
  expect(owners.has('artguard-window:original-tab')).toBe(true);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    '/api/auth/window?__window=original-tab',
    expect.objectContaining({ body: JSON.stringify({ context: session.windowContext }) }),
  );
  expect(window.location.hash).toBe('#/licenses');
});

test('a copied role URL opens with a separate login and keeps its demo role and destination', async () => {
  window.history.replaceState({}, '', '/?window=creator-old&demo=buyer#/marketplace');
  const session = await import('../src/lib/session');
  await session.initializeWindowSession();
  expect(session.windowContext).not.toBe('creator-old');
  expect(fetch).toHaveBeenCalledWith('/api/auth/window?__window=creator-old', expect.anything());
  expect(new URL(window.location.href).searchParams.get('demo')).toBe('buyer');
  expect(window.location.hash).toBe('#/marketplace');
});

test('a migration failure leaves the existing login URL and stored context intact', async () => {
  sessionStorage.setItem(key, 'old-tab');
  window.history.replaceState({}, '', '/?window=old-tab#/works');
  owners.add('artguard-window:old-tab');
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  const session = await import('../src/lib/session');
  await expect(session.initializeWindowSession()).rejects.toThrow('independent session');
  expect(sessionStorage.getItem(key)).toBe('old-tab');
  expect(new URL(window.location.href).searchParams.get('window')).toBe('old-tab');
  expect(session.windowContext).toBe(null);
});
