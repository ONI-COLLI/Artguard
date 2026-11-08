import { resolve, join } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
// Resolve from cwd to support Windows paths containing spaces and non-ASCII names.
const directory = resolve(process.cwd(), 'runtime', 'public-demo');
mkdirSync(directory, { recursive: true });
if (directory === resolve('data')) throw new Error('Public and local data must be separate.');
const configFile = join(directory, 'runtime.json'),
  config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
Object.assign(process.env, {
  ARTGUARD_DATA_DIR: directory,
  ARTGUARD_RPC_URL: 'http://127.0.0.1:8555',
  ARTGUARD_PUBLIC_DEMO: 'true',
  ARTGUARD_NODE_ACCOUNTS: '256',
  PORT: '3300',
  ARTGUARD_SOURCE_MANIFEST: join(directory, 'source-manifest.private.json'),
});
if (config.publicOrigin) {
  process.env.PUBLIC_ORIGIN = config.publicOrigin;
  process.env.OAUTH_BASE_URL = config.publicOrigin;
}
const command = process.argv[2];
if (command === 'chain') await import('./local-chain.mjs');
else if (command === 'setup') {
  process.env.COOKIE_SECURE = 'false';
  await import('./demo-setup.ts');
} else if (command === 'app') {
  if (!config.publicOrigin)
    throw new Error('Start the public HTTPS tunnel and save its publicOrigin first.');
  process.env.COOKIE_SECURE = 'true';
  await import('../dist/server/server/index.js');
} else throw new Error('Usage: node --import tsx scripts/run-public.mjs chain|setup|app');
