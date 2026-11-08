import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './errors.js';
import { publicOrigin } from './hosting.js';
type Manifest = {
  directory: string;
  archive: string;
  revision: string;
  createdAt: string;
  archiveSha256: string;
  scope: string;
  files: { path: string; sha256: string; size: number }[];
};
const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function publicSourceRoutes() {
  const r = Router();
  async function manifest() {
    const file = process.env.ARTGUARD_SOURCE_MANIFEST;
    if (!file) throw new HttpError(404, 'Public source export is not enabled.');
    return JSON.parse(await readFile(file, 'utf8')) as Manifest;
  }
  r.get('/source-manifest.json', async (_req, res) => {
    const m = await manifest();
    res.set('Access-Control-Allow-Origin', '*').json({
      revision: m.revision,
      createdAt: m.createdAt,
      archiveSha256: m.archiveSha256,
      scope: m.scope,
      files: m.files,
      archive: '/downloads/artguard-source.zip',
      rawPrefix: '/source/',
    });
  });
  r.get('/downloads/artguard-source.zip', async (_req, res) => {
    const m = await manifest();
    res.download(m.archive, 'artguard-source.zip');
  });
  r.get(/^\/source\/(.+)$/, async (req, res) => {
    const m = await manifest(),
      path = String(req.params[0]);
    const file = m.files.find((f) => f.path === path);
    if (!file) throw new HttpError(404, 'Source file is not in the published snapshot.');
    res
      .type('text/plain')
      .set({ 'Access-Control-Allow-Origin': '*', 'X-Source-SHA256': file.sha256 })
      .send(await readFile(join(m.directory, file.path)));
  });
  r.get('/docs/report.md', async (_req, res) => {
    const m = await manifest();
    const f = m.files.find((f) => f.path === 'docs/PUBLIC_REVIEW.md');
    if (!f) throw new HttpError(404, 'Report guide is unavailable.');
    res.type('text/plain').send(await readFile(join(m.directory, f.path)));
  });
  r.get('/llms.txt', async (_req, res) => {
    const m = await manifest(),
      base = publicOrigin()?.origin || '';
    res
      .type('text/plain')
      .send(
        `# ArtGuard — full-stack public test server\n\nShared Express + SQLite + Anvil application running on the operator's computer through HTTPS. Not a static screenshot or mock API. Use fictional information and test ETH only.\n\n- Source index: ${base}/code\n- All raw source paths and SHA-256 hashes: ${base}/source-manifest.json\n- Download the source: ${base}/downloads/artguard-source.zip\n- Architecture, flows, roles and report checklist: ${base}/docs/report.md\n- Original README: ${base}/source/README.md\n- Escrow contract: ${base}/source/contracts/EscrowLicenseMarketplace.sol\n- API implementation: ${base}/source/server/app.ts\n- Browser entry: ${base}/source/src/App.tsx\n- Blockchain demonstration: ${base}/#/blockchain-demo\n- Demo logins: ${base}/#/demo\n\nSource revision SHA-256: ${m.revision}\nSource snapshot time: ${m.createdAt}\n\nGuest catalog is intentionally hidden. The source and documentation are readable without login. For functional analysis, use the buyer/creator/co-author demo accounts or register a fictional account, open Account security > private demo inbox, then allocate a hosted test wallet in Profile > Wallet. Staff accounts have private operator credentials. OAuth requires provider keys and is disabled until configured. Transactions use the actual shared local EVM, not public Ethereum. No data, uploaded files, account/session databases, keys, runtime logs or environment secrets are included in the code download. The local source repository has not been published to GitHub; raw source and ZIP are provided directly by this public server.\n`,
      );
  });
  r.get('/robots.txt', async (_req, res) => {
    await manifest();
    res.type('text/plain').send('User-agent: *\nAllow: /\n');
  });
  r.get('/code', async (_req, res) => {
    const m = await manifest();
    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ArtGuard source code</title><style>body{font:15px/1.6 system-ui;background:#111;color:#eee;max-width:1100px;margin:auto;padding:32px 22px}a{color:#f69a79}nav{display:flex;gap:20px;flex-wrap:wrap}.box{border:1px solid #333;background:#202020;padding:24px;border-radius:14px;margin:24px 0}code{overflow-wrap:anywhere;font-size:12px}ul{padding-left:20px}li{padding:4px 0}small{color:#aaa}h1{font-size:38px}</style></head><body><nav><a href="/">Open application</a><a href="/docs/report.md">Report guide</a><a href="/llms.txt">Agent entry point</a></nav><h1>ArtGuard source code</h1><p>The client, server, Solidity contracts, tests and deployment scripts are available for review.</p><section class="box"><nav><a href="/downloads/artguard-source.zip">Download complete source ZIP</a><a href="/source-manifest.json">Files & checksums (JSON)</a></nav><p>${escape(m.scope)}</p><small>Snapshot ${escape(m.createdAt)} · ${m.files.length} files</small><p>Revision: <code>${m.revision}</code></p><p>ZIP SHA-256: <code>${m.archiveSha256}</code></p></section><h2>Start here</h2><ul><li><a href="/source/README.md">README: setup and features</a></li><li><a href="/source/server/app.ts">Express application and authorization</a></li><li><a href="/source/server/escrow-records.ts">Receipt verification and license activation</a></li><li><a href="/source/contracts/EscrowLicenseMarketplace.sol">Escrow smart contract</a></li><li><a href="/source/tests/escrow.test.ts">Actual Anvil integration tests</a></li></ul><h2>All source files</h2><ul>${m.files.map((f) => `<li><a href="/source/${f.path.split('/').map(encodeURIComponent).join('/')}">${escape(f.path)}</a> <small>${f.size} bytes</small></li>`).join('')}</ul></body></html>`,
      );
  });
  return r;
}
