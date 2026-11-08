import { withLegalFixture } from './fixtures.ts';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../server/migrations.ts';
import { verifiedFixture, planFixture, approvedProjectFixture } from './fixtures.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let app, base, directory, artwork, purchase;
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1MAAAAASUVORK5CYII=',
  'base64',
);
function client() {
  let cookie = '';
  return {
    async request(route, { method = 'GET', data, headers = {} } = {}) {
      const options = { method, headers: { ...headers } };
      if (cookie) options.headers.Cookie = cookie;
      if (data instanceof FormData) options.body = data;
      else if (data !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(withLegalFixture(data));
      }
      const response = await fetch(base + route, options);
      if (response.headers.has('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      const result = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : await response.text();
      if (route === '/api/auth/register' && response.status === 201)
        verifiedFixture(app.db, result.user);
      return { status: response.status, data: result, headers: response.headers };
    },
  };
}
async function setPlan(actor, plan) {
  const state = (await actor.request('/api/state')).data;
  planFixture(app.db, state.user.id, plan);
  return actor.request('/api/state');
}
const alice = client(),
  bob = client(),
  guest = client();

test('test windows share a browser cookie jar but keep login, private images and logout isolated', async () => {
  const jar = new Map();
  async function request(path, context, data, method = data === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + path, {
      method,
      headers: {
        Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(context === undefined ? {} : { 'X-ArtGuard-Window': context }),
        ...(data && !(data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body:
        data === undefined
          ? undefined
          : data instanceof FormData
            ? data
            : JSON.stringify(withLegalFixture(data)),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) {
      const [key, ...rest] = cookie.split(';')[0].split('=');
      jar.set(key, rest.join('='));
    }
    const json = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, data: json ? await response.json() : await response.text() };
  }
  for (const [context, name] of [
    ['creator-window', 'Scoped Creator'],
    ['buyer-window', 'Scoped Buyer'],
    [undefined, 'Regular User'],
  ]) {
    const result = await request('/api/auth/register', context, {
      name,
      email: name.toLowerCase().replaceAll(' ', '-') + '@windows.test',
      password: 'window-session-password',
    });
    assert.equal(result.status, 201);
    assert.equal(result.data.user.name, name);
  }
  assert.equal(jar.size, 3);
  assert.equal(
    (await request('/api/auth/window', 'creator-window', { context: 'creator-copy' })).status,
    200,
  );
  assert.notEqual(
    jar.get('artguard_session_window_creator-copy'),
    jar.get('artguard_session_window_creator-window'),
  );
  assert.equal((await request('/api/state', 'creator-copy')).data.user.name, 'Scoped Creator');
  assert.equal(
    (await request('/api/auth/window', 'buyer-window', { context: 'creator-window' })).status,
    409,
  );
  assert.equal(
    (await request('/api/auth/window', 'buyer-window', { context: 'invalid.context' })).status,
    400,
  );
  assert.equal(
    (await request('/api/auth/window', 'empty-window', { context: 'guest-copy' })).status,
    200,
  );
  assert.equal((await request('/api/state', 'guest-copy')).data.user, null);
  assert.equal((await request('/api/state', 'creator-window')).data.user.name, 'Scoped Creator');
  assert.equal((await request('/api/state?__window=buyer-window')).data.user.name, 'Scoped Buyer');
  assert.equal((await request('/api/state')).data.user.name, 'Regular User');
  assert.equal((await request('/api/state', 'empty-window')).data.user, null);
  assert.equal((await request('/api/state', 'bad.value')).status, 400);
  assert.equal((await request('/api/state?__window=buyer-window', 'creator-window')).status, 400);
  const form = upload(
    Buffer.concat([image, Buffer.from('window-session-test')]),
    'Private window draft',
  );
  form.append('status', 'draft');
  const created = await request('/api/artworks', 'creator-window', form);
  assert.equal(created.status, 201);
  const imageUrl = created.data.artwork.image;
  assert.equal((await request(imageUrl + '?__window=creator-window')).status, 200);
  assert.equal((await request(imageUrl + '?__window=buyer-window')).status, 404);
  assert.equal((await request(imageUrl)).status, 404);
  assert.equal((await request('/api/auth/logout', 'creator-window', {})).status, 200);
  assert.equal((await request('/api/state', 'creator-window')).data.user, null);
  assert.equal((await request('/api/state', 'creator-copy')).data.user.name, 'Scoped Creator');
  assert.equal(
    (
      await request('/api/auth/login', 'creator-copy', {
        email: 'scoped-buyer@windows.test',
        password: 'window-session-password',
      })
    ).status,
    200,
  );
  assert.equal((await request('/api/state', 'creator-copy')).data.user.name, 'Scoped Buyer');
  assert.equal((await request('/api/state', 'buyer-window')).data.user.name, 'Scoped Buyer');
  assert.equal((await request('/api/state')).data.user.name, 'Regular User');
});
function upload(bytes = image, title = 'Local test artwork') {
  const f = new FormData();
  f.append('file', new Blob([bytes], { type: 'image/png' }), 'test.png');
  f.append('title', title);
  f.append('description', 'An original image for integration testing.');
  f.append('category', 'Illustration');
  f.append('price', '12');
  f.append('licenses', 'personal');
  f.append('licenses', 'commercial');
  f.append('rights', 'true');
  return f;
}
before(async () => {
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  directory = await mkdtemp(path.join(root, 'artifacts', 'test-'));
  app = await createApp({ dataDir: directory });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await app?.close();
  if (directory && path.resolve(directory).startsWith(path.join(root, 'artifacts') + path.sep))
    await rm(directory, { recursive: true, force: true });
});
test('guest workspace hides catalog and exposes no account credentials', async () => {
  const r = await guest.request('/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.data.user, null);
  assert.equal(r.data.artworks.length, 0);
  assert.equal(JSON.stringify(r.data).includes('password_hash'), false);
  assert.equal((await guest.request('/api/health')).data.blockchain, 'local-evm');
  assert.equal(app.db.prepare('PRAGMA user_version').get().user_version, 12);
});
test('registration hashes passwords and isolates account sessions', async () => {
  const a = await alice.request('/api/auth/register', {
    method: 'POST',
    data: { name: 'Alice Creator', email: 'alice@example.test', password: 'local-test-pass-2026' },
  });
  const b = await bob.request('/api/auth/register', {
    method: 'POST',
    data: { name: 'Bob Buyer', email: 'bob@example.test', password: 'local-test-pass-2026' },
  });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.data.user.id, b.data.user.id);
  assert.match(a.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const hash = app.db
    .prepare('SELECT password_hash FROM users WHERE email=?')
    .get('alice@example.test').password_hash;
  assert.notEqual(hash, 'local-test-pass-2026');
  assert.match(hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(
    (
      await guest.request('/api/auth/register', {
        method: 'POST',
        data: { name: 'Duplicate', email: 'ALICE@example.test', password: 'local-test-pass-2026' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await guest.request('/api/auth/login', {
        method: 'POST',
        data: { email: 'alice@example.test', password: 'wrong-password' },
      })
    ).status,
    401,
  );
});
test('anonymous uploads and cross-site writes are rejected', async () => {
  assert.equal(
    (await guest.request('/api/artworks', { method: 'POST', data: upload() })).status,
    401,
  );
  assert.equal(
    (
      await alice.request('/api/plan', {
        method: 'PATCH',
        data: { plan: 'premium' },
        headers: { Origin: 'https://unrelated.test' },
      })
    ).status,
    403,
  );
  assert.equal((await guest.request('/data/artguard.sqlite')).status, 404);
});
test('publishing stores a real file and server-calculated fingerprint', async () => {
  const result = await alice.request('/api/artworks', { method: 'POST', data: upload() });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  artwork = result.data.artwork;
  assert.match(artwork.hash, /^[a-f0-9]{64}$/);
  assert.equal(artwork.own, true);
  assert.equal(artwork.price, 12);
  assert.equal(
    (await bob.request('/api/state')).data.artworks.find((a) => a.id === artwork.id).own,
    false,
  );
  assert.equal(
    (await bob.request('/api/artworks', { method: 'POST', data: upload() })).status,
    409,
  );
  assert.equal(
    (await guest.request('/media/' + artwork.id)).headers.get('content-type'),
    'image/webp',
  );
  const bad = upload(Buffer.from('not an image'));
  assert.equal((await alice.request('/api/artworks', { method: 'POST', data: bad })).status, 400);
});
test('only the owner may edit; drafts stay private; registry checks visibility', async () => {
  assert.equal(
    (await bob.request('/api/artworks/' + artwork.id, { method: 'PATCH', data: { price: 1 } }))
      .status,
    404,
  );
  assert.equal(
    (
      await alice.request('/api/artworks/' + artwork.id, {
        method: 'PATCH',
        data: { status: 'draft' },
      })
    ).status,
    200,
  );
  assert.equal(
    (await bob.request('/api/state')).data.artworks.some((a) => a.id === artwork.id),
    false,
  );
  assert.equal((await bob.request('/media/' + artwork.id)).status, 404);
  assert.equal((await bob.request('/api/verify?query=' + artwork.hash)).data.artwork, null);
  assert.equal(
    (await alice.request('/api/verify?query=' + artwork.registration)).data.artwork.id,
    artwork.id,
  );
  await alice.request('/api/artworks/' + artwork.id, {
    method: 'PATCH',
    data: { status: 'published' },
  });
});
test('checkout calculates prices and fees, blocks self-purchase and duplicates', async () => {
  await alice.request('/api/artworks/' + artwork.id, {
    method: 'PATCH',
    data: { recipients: [{ name: 'Co-creator', percent: 20 }] },
  });
  assert.equal(
    (
      await alice.request('/api/purchases', {
        method: 'POST',
        data: { items: [{ artworkId: artwork.id, license: 'commercial' }] },
      })
    ).status,
    400,
  );
  approvedProjectFixture(app.db, artwork.id);
  const result = await bob.request('/api/purchases', {
    method: 'POST',
    data: { amount: 0, items: [{ artworkId: artwork.id, license: 'commercial', amount: 0 }] },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  purchase = result.data.purchases[0];
  assert.equal(purchase.amount, 30);
  const sale = (await alice.request('/api/state')).data.sales[0];
  assert.equal(sale.commission, 3);
  assert.equal(sale.net, 27);
  assert.equal(sale.allocations[1].amount, 5.4);
  assert.equal(
    (
      await bob.request('/api/purchases', {
        method: 'POST',
        data: { items: [{ artworkId: artwork.id, license: 'commercial' }] },
      })
    ).status,
    409,
  );
  assert.equal(
    (await bob.request('/api/verify?query=' + artwork.hash)).data.artwork.id,
    artwork.id,
  );
});
test('license documents and source downloads require the correct account', async () => {
  assert.equal((await guest.request('/api/artworks/' + artwork.id + '/download')).status, 401);
  assert.equal((await alice.request('/api/licenses/' + purchase.id + '/document')).status, 404);
  const document = await bob.request('/api/licenses/' + purchase.id + '/document');
  assert.equal(document.status, 200);
  assert.match(document.data, /Bob Buyer/);
  assert.match(document.data, /No real payment/);
  assert.equal((await bob.request('/api/artworks/' + artwork.id + '/download')).status, 200);
});
test('bulk checkout is atomic and feature access is enforced on the server', async () => {
  const items = [
    { artworkId: 'quiet-city', license: 'personal' },
    { artworkId: 'light-form', license: 'personal' },
  ];
  assert.equal(
    (await bob.request('/api/purchases', { method: 'POST', data: { items } })).status,
    403,
  );
  assert.equal((await bob.request('/api/sales/export')).status, 403);
  assert.equal(
    (
      await bob.request('/api/team', {
        method: 'POST',
        data: { name: 'Team Contact', email: 'contact@example.test' },
      })
    ).status,
    403,
  );
  await setPlan(bob, 'business');
  const before = (await bob.request('/api/state')).data.purchases.length;
  assert.equal(
    (
      await bob.request('/api/purchases', {
        method: 'POST',
        data: { items: [items[0], { artworkId: 'missing', license: 'personal' }] },
      })
    ).status,
    400,
  );
  assert.equal((await bob.request('/api/state')).data.purchases.length, before);
  const r = await bob.request('/api/purchases', { method: 'POST', data: { items } });
  assert.equal(r.status, 201);
  assert.equal(r.data.purchases.length, before + 2);
  const team = await bob.request('/api/team', {
    method: 'POST',
    data: { name: 'Team Contact', email: 'contact@example.test' },
  });
  assert.equal(team.status, 201);
  assert.equal(
    (await bob.request('/api/team/' + team.data.team[0].id, { method: 'DELETE' })).data.team.length,
    0,
  );
  await setPlan(alice, 'premium');
  assert.equal((await alice.request('/api/sales/export')).status, 200);
});
test('upload quotas and plan downgrades are enforced', async () => {
  const userId = (await alice.request('/api/state')).data.user.id;
  await setPlan(alice, 'free');
  // Populate metadata fixtures directly; HTTP uploads are covered above.
  const insert = app.db.prepare(
    'INSERT INTO artworks(id,owner_id,title,description,category,price,licenses,mime,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  );
  for (let i = 0; i < 4; i++)
    insert.run(
      'quota-' + i,
      userId,
      'Quota ' + i,
      'Quota test artwork',
      'Illustration',
      100,
      '["personal"]',
      'image/png',
      'quota-hash-' + i,
      new Date().toISOString(),
    );
  assert.equal(
    (
      await alice.request('/api/artworks', {
        method: 'POST',
        data: upload(Buffer.concat([image, Buffer.from('unique')])),
      })
    ).status,
    409,
  );
  await setPlan(alice, 'premium');
  assert.equal(
    (
      await alice.request('/api/artworks', {
        method: 'POST',
        data: upload(Buffer.concat([image, Buffer.from('unique')])),
      })
    ).status,
    201,
  );
  assert.equal((await setPlan(alice, 'free')).status, 200);
});
test('concurrent uploads cannot both claim the final Free slot', async () => {
  const c = client();
  const registered = await c.request('/api/auth/register', {
    method: 'POST',
    data: {
      name: 'Concurrent Creator',
      email: 'concurrent@example.test',
      password: 'local-test-pass-2026',
    },
  });
  assert.equal(registered.status, 201);
  const id = registered.data.user.id;
  const insert = app.db.prepare(
    'INSERT INTO artworks(id,owner_id,title,description,category,price,licenses,mime,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  );
  for (let i = 0; i < 4; i++)
    insert.run(
      'parallel-' + i,
      id,
      'Parallel ' + i,
      'A quota fixture artwork',
      'Illustration',
      100,
      '["personal"]',
      'image/png',
      'parallel-hash-' + i,
      new Date().toISOString(),
    );
  const results = await Promise.all(
    [1, 2].map((n) =>
      c.request('/api/artworks', {
        method: 'POST',
        data: upload(Buffer.concat([image, Buffer.from('parallel-' + n)])),
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await c.request('/api/state')).data.artworks.filter((a) => a.own).length, 5);
});
test('deletion is owner-only and existing licenses prevent removal', async () => {
  await setPlan(alice, 'premium');
  assert.equal(
    (await alice.request('/api/artworks/' + artwork.id, { method: 'DELETE' })).status,
    409,
  );
  assert.equal(
    (await bob.request('/api/artworks/' + artwork.id, { method: 'DELETE' })).status,
    404,
  );
  const result = await alice.request('/api/artworks', {
    method: 'POST',
    data: upload(Buffer.concat([image, Buffer.from('delete-test')])),
  });
  assert.equal(result.status, 201);
  assert.equal(
    (await alice.request('/api/artworks/' + result.data.artwork.id, { method: 'DELETE' })).status,
    200,
  );
  assert.equal((await guest.request('/media/' + result.data.artwork.id)).status, 404);
  assert.equal(
    (await bob.request('/api/purchases', { method: 'POST', data: { items: [null] } })).status,
    400,
  );
  assert.equal(
    (await alice.request('/api/recipients', { method: 'PATCH', data: { recipients: [null] } }))
      .status,
    400,
  );
});
test('saved accounts, files, and licenses persist across a server restart', async () => {
  // Existing installations predate versioned migrations. Adopt their schema in place.
  app.db.exec('PRAGMA user_version=0');
  await app.close();
  app = await createApp({ dataDir: directory });
  assert.equal(app.db.prepare('PRAGMA user_version').get().user_version, 12);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const state = (await bob.request('/api/state')).data;
  assert.equal(state.user.email, 'bob@example.test');
  assert.ok(state.purchases.some((p) => p.id === purchase.id));
  await bob.request('/api/auth/logout', { method: 'POST', data: {} });
  assert.equal((await bob.request('/api/state')).data.user, null);
  const login = await bob.request('/api/auth/login', {
    method: 'POST',
    data: { email: 'bob@example.test', password: 'local-test-pass-2026' },
  });
  assert.equal(login.status, 200);
  assert.ok(login.data.purchases.length >= 3);
});

test('each uploaded project stores independent shares, preserves edits, and snapshots local order allocations', async () => {
  const owner = client();
  const registered = await owner.request('/api/auth/register', {
    method: 'POST',
    data: {
      name: 'Project share owner',
      email: 'project-shares@example.test',
      password: 'local-test-pass-2026',
    },
  });
  assert.equal(registered.status, 201);
  const one = [
    {
      name: 'First collaborator',
      percent: 20,
      wallet: '0x1111111111111111111111111111111111111111',
    },
  ];
  const two = [
    {
      name: 'Second collaborator',
      percent: 35,
      wallet: '0x2222222222222222222222222222222222222222',
    },
  ];
  assert.equal(
    (
      await owner.request('/api/recipients', {
        method: 'PATCH',
        data: { recipients: [{ name: 'Default only', percent: 70 }] },
      })
    ).status,
    200,
  );
  const create = async (suffix, recipients) => {
    const data = upload(Buffer.concat([image, Buffer.from(suffix)]), suffix);
    if (recipients !== undefined) data.append('recipients', JSON.stringify(recipients));
    const result = await owner.request('/api/artworks', { method: 'POST', data });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.artwork;
  };
  const first = await create('First independent project', one),
    second = await create('Second independent project', two);
  const plain = await create('No implicit defaults');
  approvedProjectFixture(app.db, first.id);
  approvedProjectFixture(app.db, second.id);
  assert.deepEqual(first.recipients, one);
  assert.deepEqual(second.recipients, two);
  assert.deepEqual(plain.recipients, []);
  const guestState = (await guest.request('/api/state')).data;
  assert.deepEqual(guestState.artworks, []);
  assert.equal(
    (await bob.request('/api/artworks/' + first.id, { method: 'PATCH', data: { recipients: [] } }))
      .status,
    404,
  );
  assert.equal(
    (
      await owner.request('/api/artworks/' + first.id, {
        method: 'PATCH',
        data: { title: 'New project title' },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await owner.request('/api/state')).data.artworks.find((a) => a.id === first.id).recipients,
    one,
  );
  approvedProjectFixture(app.db, first.id);
  const purchased = await bob.request('/api/purchases', {
    method: 'POST',
    data: {
      items: [
        { artworkId: first.id, license: 'personal' },
        { artworkId: second.id, license: 'personal' },
      ],
    },
  });
  assert.equal(purchased.status, 201);
  const sales = (await owner.request('/api/state')).data.sales;
  assert.equal(sales.find((s) => s.artworkId === first.id).allocations[1].percent, 20);
  assert.equal(sales.find((s) => s.artworkId === first.id).allocations[1].amount, 2.16);
  assert.equal(sales.find((s) => s.artworkId === second.id).allocations[1].percent, 35);
  assert.equal(sales.find((s) => s.artworkId === second.id).allocations[1].amount, 3.78);
  const changed = [{ ...one[0], percent: 50 }];
  await owner.request('/api/artworks/' + first.id, {
    method: 'PATCH',
    data: { recipients: changed },
  });
  await owner.request('/api/recipients', { method: 'PATCH', data: { recipients: [] } });
  const state = (await owner.request('/api/state')).data;
  assert.deepEqual(state.artworks.find((a) => a.id === first.id).recipients, changed);
  assert.deepEqual(state.artworks.find((a) => a.id === second.id).recipients, two);
  assert.equal(state.sales.find((s) => s.artworkId === first.id).allocations[1].percent, 20);
  assert.equal(
    (
      await owner.request('/api/artworks/' + first.id, {
        method: 'PATCH',
        data: { recipients: [] },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await owner.request('/api/state')).data.artworks.find((a) => a.id === first.id).recipients,
    [],
  );
  for (const recipients of [
    [{ name: 'Broken', percent: 20, wallet: 'bad' }],
    [
      { name: 'One', percent: 60 },
      { name: 'Two', percent: 40 },
    ],
    null,
  ])
    assert.equal(
      (await owner.request('/api/artworks/' + second.id, { method: 'PATCH', data: { recipients } }))
        .status,
      400,
    );
  const malformed = upload(Buffer.concat([image, Buffer.from('invalid-shares')]));
  malformed.append('recipients', '{broken');
  assert.equal(
    (await owner.request('/api/artworks', { method: 'POST', data: malformed })).status,
    400,
  );
  assert.equal((await owner.request('/api/state')).data.artworks.filter((a) => a.own).length, 3);
});

test('migration 5 copies existing portfolio shares once without changing purchase allocations', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db);
    db.exec('DROP TABLE artwork_revenue_settings; PRAGMA user_version=4;');
    const recipients = [{ name: 'Legacy collaborator', percent: 25 }];
    db.prepare(
      'INSERT INTO users(id,name,email,password_hash,recipients,created_at) VALUES(?,?,?,?,?,?)',
    ).run(
      'owner',
      'Owner',
      'owner@migration.test',
      'disabled',
      JSON.stringify(recipients),
      '2026-10-21',
    );
    for (const id of ['first', 'second'])
      db.prepare(
        'INSERT INTO artworks(id,owner_id,title,description,category,price,licenses,mime,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        'owner',
        id,
        'Description',
        'Illustration',
        1200,
        '["personal"]',
        'image/png',
        id,
        '2026-10-21',
      );
    db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?)').run(
      'paid',
      'owner',
      'first',
      'personal',
      1200,
      120,
      '[{"name":"Original recipient","percent":15,"amount":1.62}]',
      null,
      '2026-10-21',
    );
    const original = db.prepare('SELECT * FROM purchases WHERE id=?').get('paid');
    migrate(db);
    for (const id of ['first', 'second'])
      assert.deepEqual(
        JSON.parse(
          db.prepare('SELECT recipients FROM artwork_revenue_settings WHERE artwork_id=?').get(id)
            .recipients,
        ),
        recipients,
      );
    db.exec("UPDATE users SET recipients='[]'; PRAGMA user_version=4;");
    migrate(db);
    assert.deepEqual(
      JSON.parse(
        db
          .prepare('SELECT recipients FROM artwork_revenue_settings WHERE artwork_id=?')
          .get('first').recipients,
      ),
      recipients,
    );
    assert.deepEqual(db.prepare('SELECT * FROM purchases WHERE id=?').get('paid'), original);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
  } finally {
    db.close();
  }
});

test('seller plans charge 10%, 5%, and 0% while splitting net local proceeds with co-authors', async () => {
  const creator = client(),
    buyer = client();
  for (const [actor, name] of [
    [creator, 'Fee creator'],
    [buyer, 'Fee buyer'],
  ])
    assert.equal(
      (
        await actor.request('/api/auth/register', {
          method: 'POST',
          data: {
            name,
            email: name.replace(' ', '') + '@fees.test',
            password: 'local-test-pass-2026',
          },
        })
      ).status,
      201,
    );
  const form = upload(Buffer.concat([image, Buffer.from('plan-fees')]), 'Plan fee test');
  form.append('licenses', 'extended');
  form.append('recipients', JSON.stringify([{ name: 'Co-author', percent: 25 }]));
  const created = await creator.request('/api/artworks', { method: 'POST', data: form });
  assert.equal(created.status, 201);
  const id = created.data.artwork.id;
  approvedProjectFixture(app.db, id);
  for (const [plan, price, percent, license, gross, fee] of [
    ['free', 0, 10, 'personal', 12, 1.2],
    ['premium', 10, 5, 'commercial', 30, 1.5],
    ['business', 50, 0, 'extended', 60, 0],
  ]) {
    const changed = await setPlan(creator, plan);
    assert.equal(changed.status, 200);
    assert.equal(changed.data.plans[plan].price, price);
    assert.equal(changed.data.plans[plan].commission, percent);
    assert.equal(
      (
        await buyer.request('/api/purchases', {
          method: 'POST',
          data: { items: [{ artworkId: id, license }] },
        })
      ).status,
      201,
    );
    const sale = (await creator.request('/api/state')).data.sales.find(
      (s) => s.artworkId === id && s.license === license,
    );
    assert.equal(sale.amount, gross);
    assert.equal(sale.commission, fee);
    assert.ok(Math.abs(sale.net - (gross - fee)) < 0.0001);
    assert.equal(sale.allocations[1].amount, Math.floor((gross - fee) * 100 * 0.25) / 100);
  }
});
