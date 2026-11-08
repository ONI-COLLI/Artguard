import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { encodeFunctionData } from 'viem';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { LocalBlockchain } from '../server/blockchain.ts';
import { demoProfiles } from '../shared/demo.ts';
import { registryAbi } from '../shared/blockchain.ts';
import { consentTypes } from '../shared/platform.ts';

// Procedural, synthetic PNG fixture. No uploaded user artwork is copied or changed.
function sampleImage() {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const b of body) {
      crc ^= b;
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      check = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, check]);
  };
  const width = 640,
    height = 420,
    raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      const circle = (x - 350) ** 2 + (y - 180) ** 2 < 110 ** 2;
      const steps = x > 80 && x < 230 && y > 100 + x / 4 && y < 330;
      const bar = x > 365 && x < 555 && y > 260 && y < 300;
      const color = circle
        ? [222, 153, 113]
        : steps
          ? [132, 149, 177]
          : bar
            ? [209, 198, 183]
            : [39 + Math.floor(y / 40), 42 + Math.floor(x / 55), 51 + Math.floor(y / 45)];
      raw.set(color, i);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('tEXt', Buffer.concat([Buffer.from('Demo\0'), randomBytes(12)])),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function prepareDemoProject(directory: string) {
  const app = await createApp({ dataDir: directory, serveClient: false });
  try {
    const repo = new Repository(app.db);
    const existing = repo.one<{ value: string }>(
      "SELECT value FROM platform_meta WHERE key='demo_project'",
    );
    if (existing) {
      console.log('Existing demo project kept: http://localhost:3000/#/artwork/' + existing.value);
      return;
    }
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/api`;
    function actor() {
      let cookie = '';
      return async (
        path: string,
        data?: unknown,
        method = data === undefined ? 'GET' : 'POST',
      ): Promise<any> => {
        const response = await fetch(base + path, {
          method,
          headers: {
            Cookie: cookie,
            ...(data !== undefined && !(data instanceof FormData)
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          body:
            data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
        });
        if (response.headers.has('set-cookie'))
          cookie = response.headers.get('set-cookie')!.split(';')[0];
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Demo request failed.');
        return result;
      };
    }
    const creator = actor(),
      coauthor = actor();
    for (const [request, key] of [
      [creator, 'creator'],
      [coauthor, 'coauthor'],
    ] as const) {
      const p = demoProfiles.find((p) => p.key === key)!;
      await request('/auth/login', { email: p.email, password: p.password });
    }
    const creatorState = await creator('/state'),
      coauthorState = await coauthor('/state');
    const f = new FormData();
    f.append(
      'file',
      new Blob([new Uint8Array(sampleImage())], { type: 'image/png' }),
      'shared-horizons-demo.png',
    );
    for (const [key, value] of Object.entries({
      title: 'Shared Horizons — demo project',
      description:
        'A geometric illustration with warm circular forms, muted architectural shapes and a dark background. Choose a usage license for your project. The original PNG becomes available after the escrow order is completed.',
      category: 'Illustration',
      price: '12',
      status: 'draft',
      rights: 'true',
      recipients: JSON.stringify([
        { name: 'Demo Coauthor', wallet: coauthorState.user.wallet.address, percent: 25 },
      ]),
    }))
      f.append(key, value);
    for (const license of ['personal', 'commercial', 'extended']) f.append('licenses', license);
    const project = (await creator('/artworks', f)).artwork;
    repo.run('INSERT INTO platform_meta VALUES(?,?)', 'demo_project', project.id);
    const consent = await coauthor(`/coauthors/${project.id}/request`);
    const signature = (
      await coauthor('/demo/wallet/rpc', {
        method: 'eth_signTypedData_v4',
        params: [
          coauthorState.user.wallet.address,
          JSON.stringify({
            domain: consent.domain,
            types: consentTypes,
            primaryType: 'RevenueConsent',
            message: consent.message,
          }),
        ],
      })
    ).result;
    await coauthor(`/coauthors/${project.id}/approve`, { versionId: consent.versionId, signature });
    await creator(`/artworks/${project.id}`, { status: 'published' }, 'PATCH');
    const registration = (await creator(`/blockchain/artworks/${project.id}/prepare`, {}))
      .registration;
    const data = encodeFunctionData({
      abi: registryAbi,
      functionName: 'registerArtwork',
      args: [registration.fileHash, registration.termsHash],
    });
    const transactionHash = (
      await creator('/demo/wallet/rpc', {
        method: 'eth_sendTransaction',
        params: [
          {
            from: creatorState.user.wallet.address,
            to: registration.contractAddress,
            data,
            value: '0x0',
            chainId: '0x7a69',
          },
        ],
      })
    ).result;
    const chain = new LocalBlockchain(directory);
    await chain.client.waitForTransactionReceipt({ hash: transactionHash });
    await creator(`/blockchain/registrations/${registration.id}/confirm`, { transactionHash });
    console.log(
      'Published and registered: Shared Horizons — demo project. Co-author: 25% after platform fee.',
    );
    console.log('Ready for a buyer: http://localhost:3000/#/artwork/' + project.id);
  } finally {
    await app.close();
  }
}
