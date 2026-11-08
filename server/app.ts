import { hostingGuard, publicDemo, publicOrigin } from './hosting.js';
import { privacyRoutes, hasLegalConsent } from './privacy.js';
import { financeRoutes } from './finance.js';
import { publicDemoRoutes } from './public-demo.js';
import { publicRpcRoutes } from './public-rpc.js';
import { publicSourceRoutes } from './public-source.js';
import { escrowRoutes } from './escrow.routes.js';
import { escrowProofRoutes } from './escrow-proof.js';
import { presentationRoutes } from './presentation.js';
import { defenseRoutes } from './defense.js';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openDatabase } from './database.js';
import { Repository } from './repository.js';
import { sessionUser } from './auth.js';
import { HttpError, errorHandler } from './errors.js';
import { accountRoutes } from './account.routes.js';
import { artworkRoutes } from './artwork.routes.js';
import { purchaseRoutes } from './purchase.routes.js';
import { LocalBlockchain } from './blockchain.js';
import { blockchainRoutes } from './blockchain.routes.js';
import { chainPurchaseRoutes } from './chain-purchase.routes.js';
import { platformRoutes } from './platform.routes.js';
import { billingRoutes } from './billing.routes.js';
import { backfillAccounting } from './accounting-records.js';
import { accountingRoutes } from './accounting.routes.js';
import { demoRoutes } from './demo.routes.js';
import { promotionRoutes } from './promotion.routes.js';
import { ExchangeRates, exchangeRoutes } from './exchange.js';
import { homeSummary } from './home.js';
import { blockchainDemoRoutes } from './blockchain-demo.js';
import { publicChainProofRoutes } from './public-chain-proof.js';
import { technicalRoutes, siteSettings } from './technical.routes.js';
import { oauthRoutes, type OAuthTransport } from './oauth.js';
export async function createApp({
  dataDir = process.env.ARTGUARD_DATA_DIR || resolve('data'),
  serveClient = true,
  blockchain,
  exchange,
  oauthTransport,
}: {
  dataDir?: string;
  serveClient?: boolean;
  blockchain?: LocalBlockchain;
  exchange?: ExchangeRates;
  oauthTransport?: OAuthTransport;
} = {}) {
  const uploads = join(dataDir, 'uploads');
  await mkdir(uploads, { recursive: true });
  const db = openDatabase(dataDir),
    repo = new Repository(db),
    app = express();
  const chain = blockchain || new LocalBlockchain(dataDir);
  const rates = exchange || new ExchangeRates(join(dataDir, 'cache', 'exchange-rates.json'));
  backfillAccounting(repo);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'img-src': ["'self'", 'blob:', 'data:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (publicOrigin()) app.set('trust proxy', 'loopback');
  app.use(hostingGuard());
  app.use(express.json({ limit: '64kb' }));
  app.use(publicRpcRoutes(repo, chain));
  app.use(publicSourceRoutes());
  app.use((req, _res, next) => {
    req.user = sessionUser(repo, req);
    if (
      req.user &&
      req.method === 'POST' &&
      /^\/api\/(purchases$|artworks$|blockchain\/checkouts$|blockchain\/artworks\/[^/]+\/prepare$|billing\/orders$|promotions\/orders$|demo\/wallet\/provision$|coauthors\/[^/]+\/approve$)/.test(
        req.path,
      ) &&
      !hasLegalConsent(repo, req.user.id)
    )
      return next(
        new HttpError(
          403,
          'Review and accept the current terms in Privacy before a new purchase or publication. Existing orders and withdrawals remain available.',
        ),
      );
    const settings = siteSettings(repo);
    if (req.method === 'POST' && req.path === '/api/auth/register' && !settings.registrationEnabled)
      return next(
        new HttpError(
          503,
          'New registrations are temporarily paused. Existing accounts can still sign in.',
        ),
      );
    if (req.method === 'POST' && req.path === '/api/artworks' && !settings.uploadsEnabled)
      return next(new HttpError(503, 'New project uploads are temporarily paused.'));
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, storage: 'sqlite', blockchain: 'local-evm' }),
  );
  app.get('/api/state', (req, res) =>
    res.json({ ...repo.snapshot(req.user), ...(publicDemo() ? { publicDemo: true } : {}) }),
  );
  app.get('/api/home', (req, res) => {
    const summary = homeSummary(repo);
    res.json({ ...summary, featured: req.user ? summary.featured : null });
  });
  app.use(
    '/api',
    exchangeRoutes(rates),
    privacyRoutes(repo),
    oauthRoutes(repo, oauthTransport),
    publicDemoRoutes(repo, chain),
    accountRoutes(repo),
    demoRoutes(repo, chain),
    platformRoutes(repo),
    billingRoutes(repo, chain),
    promotionRoutes(repo, chain),
    accountingRoutes(repo, chain),
    financeRoutes(repo, chain),
    technicalRoutes(repo, chain),
    blockchainDemoRoutes(repo, chain),
    publicChainProofRoutes(chain),
    escrowProofRoutes(chain),
    presentationRoutes(chain),
    defenseRoutes(repo, chain, dataDir),
    purchaseRoutes(repo),
    blockchainRoutes(repo, chain),
    chainPurchaseRoutes(repo, chain),
    escrowRoutes(repo, chain, uploads),
  );
  app.use(artworkRoutes(repo, uploads));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API endpoint not found.')));
  if (serveClient) {
    const client = resolve('dist/client');
    try {
      await access(join(client, 'index.html'));
      app.use(express.static(client, { index: 'index.html', dotfiles: 'deny' }));
      app.get('/', (_req, res) => res.sendFile(join(client, 'index.html')));
    } catch {
      app.get('/', (_req, res) =>
        res
          .status(503)
          .type('text/plain')
          .send(
            'Run npm run build, then npm start. For development use npm run dev and open http://localhost:5173.',
          ),
      );
    }
  }
  app.use((_req, _res, next) => next(new HttpError(404, 'Page not found.')));
  app.use(errorHandler);
  const server = createServer(app);
  return {
    app,
    server,
    db,
    close: async () => {
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      db.close();
    },
  };
}
