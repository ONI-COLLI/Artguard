import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
for (const port of [3600, 8665]) {
  const probe = createServer();
  await new Promise((done, reject) => probe.once('error', reject).listen(port, '127.0.0.1', done));
  await new Promise((done) => probe.close(done));
}
const directory = resolve('runtime', 'defense-' + Date.now());
mkdirSync(directory, { recursive: true });
mkdirSync(resolve('artifacts/defense-video'), { recursive: true });
const env = {
  ...process.env,
  ARTGUARD_DATA_DIR: directory,
  ARTGUARD_RPC_URL: 'http://127.0.0.1:8665',
  ARTGUARD_DEFENSE_MODE: '1',
  PORT: '3600',
  COOKIE_SECURE: 'false',
  ARTGUARD_BIND_HOST: '127.0.0.1',
};
for (const key of [
  'PUBLIC_ORIGIN',
  'OAUTH_BASE_URL',
  'ARTGUARD_PUBLIC_DEMO',
  'ARTGUARD_SOURCE_MANIFEST',
])
  delete env[key];
const log = createWriteStream(resolve('artifacts/defense-video/server.log'));
const app = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.pipe(log);
app.stderr.pipe(log);
writeFileSync(
  resolve('artifacts/defense-video/session.json'),
  JSON.stringify(
    { directory, pid: app.pid, url: 'http://127.0.0.1:3600/#/defense', rpc: env.ARTGUARD_RPC_URL },
    null,
    2,
  ),
);
console.log('Local defense page: http://127.0.0.1:3600/#/defense');
console.log(
  'No chain or tests start until Start real demonstration is pressed. Existing site data is preserved.',
);
async function stop() {
  const child = spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await new Promise((done) => child.once('exit', done));
  process.exit();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
await new Promise((done) => app.once('exit', done));
