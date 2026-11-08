// The selector is tab-local; authentication stays in an HttpOnly server cookie.
export let windowContext: string | null = null;
const storageKey = 'artguard.window-context';
const validContext = (value: string | null) =>
  value && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null;
const newContext = () => 'tab-' + crypto.randomUUID();

async function claimContext(context: string): Promise<boolean> {
  if (navigator.locks) {
    return new Promise((resolve, reject) => {
      void navigator.locks
        .request('artguard-window:' + context, { ifAvailable: true }, async (lock) => {
          resolve(!!lock);
          if (lock)
            await new Promise<void>((release) =>
              window.addEventListener('pagehide', () => release(), { once: true }),
            );
        })
        .catch(reject);
    });
  }
  // Fallback for browsers without Web Locks. A duplicated tab must fork its session.
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('artguard-window-owners');
    const id = crypto.randomUUID();
    let occupied = false;
    channel.onmessage = ({ data }) => {
      if (data?.context !== context) return;
      if (data.type === 'probe')
        channel.postMessage({ type: 'occupied', context, target: data.id });
      if (data.type === 'occupied' && data.target === id) occupied = true;
    };
    channel.postMessage({ type: 'probe', context, id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (occupied) channel.close();
    else window.addEventListener('pagehide', () => channel.close(), { once: true });
    return !occupied;
  }
  return true;
}

// Run before loading React and wagmi so every request and wallet uses the same tab.
export async function initializeWindowSession() {
  const url = new URL(window.location.href);
  const requested = validContext(url.searchParams.get('window'));
  let saved: string | null = null;
  try {
    saved = validContext(sessionStorage.getItem(storageKey));
  } catch {
    /* URL survives reload when storage is unavailable. */
  }
  const source = requested || saved;
  const canTrackOwner = !!navigator.locks || typeof BroadcastChannel !== 'undefined';
  let context =
    saved && (!requested || requested === saved) && canTrackOwner ? saved : newContext();
  while (!(await claimContext(context))) context = newContext();
  if (context !== source) {
    const response = await fetch(
      '/api/auth/window' + (source ? '?__window=' + encodeURIComponent(source) : ''),
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new Error('Could not open an independent session. Reload this tab to try again.');
  }
  windowContext = context;
  try {
    sessionStorage.setItem(storageKey, context);
  } catch {
    /* Keep the context in this tab's URL. */
  }
  url.searchParams.set('window', context);
  window.history.replaceState(window.history.state, '', url);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });
}
export function sessionUrl(path: string) {
  if (!windowContext || !path.startsWith('/') || path.startsWith('//')) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set('__window', windowContext);
  return url.pathname + url.search + url.hash;
}
