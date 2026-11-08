import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { initializeWindowSession } from './lib/session';
import { CurrencyProvider } from './components/currency';
import './styles.css';
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1 }, mutations: { retry: 0 } },
});
async function start() {
  await initializeWindowSession();
  const [{ default: App }, { walletConfig }] = await Promise.all([
    import('./App'),
    import('./lib/blockchain'),
  ]);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WagmiProvider config={walletConfig}>
        <QueryClientProvider client={client}>
          <CurrencyProvider>
            <App />
          </CurrencyProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  );
}
void start().catch((error) => {
  createRoot(document.getElementById('root')!).render(
    <div className="workspace-loading" role="alert">
      <h2>Could not open your workspace.</h2>
      <p>{error instanceof Error ? error.message : 'The local server is unavailable.'}</p>
      <button onClick={() => window.location.reload()}>Try again</button>
    </div>,
  );
});
