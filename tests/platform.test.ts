import { withLegalFixture } from './fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createApp } from '../server/app.ts';
import { tokenHash } from '../server/auth.ts';
import { planFixture } from './fixtures.ts';

const password = 'platform-test-password';
async function setup(t) {
  await mkdir(resolve('artifacts'), { recursive: true });
  const directory = await mkdtemp(resolve('artifacts', 'platform-test-'));
  const app = await createApp({ dataDir: directory, serveClient: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const client = () => {
    let cookie = '';
    return {
      async request(path, data, method = data === undefined ? 'GET' : 'POST') {
        const response = await fetch(base + path, {
          method,
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
            ...(data && !(data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          },
          body:
            data === undefined
              ? undefined
              : data instanceof FormData
                ? data
                : JSON.stringify(withLegalFixture(data)),
        });
        if (response.headers.has('set-cookie'))
          cookie = response.headers.get('set-cookie').split(';')[0];
        return {
          status: response.status,
          data: response.headers.get('content-type')?.includes('application/json')
            ? await response.json()
            : await response.text(),
        };
      },
    };
  };
  function tokenFor(email, purpose) {
    const subject =
      purpose === 'verify' ? 'Verify your ArtGuard email' : 'Reset your ArtGuard password';
    const mail = app.db
      .prepare(
        'SELECT body FROM local_mail WHERE email=? AND subject=? ORDER BY rowid DESC LIMIT 1',
      )
      .get(email, subject);
    return mail?.body.match(/token=([a-f0-9]{64})/)?.[1];
  }
  async function register(name, verified = true) {
    const actor = client(),
      email = name.toLowerCase() + '@platform.test';
    const result = await actor.request('/api/auth/register', { name, email, password });
    assert.equal(result.status, 201);
    if (verified)
      assert.equal(
        (await actor.request('/api/auth/verify-email', { token: tokenFor(email, 'verify') }))
          .status,
        200,
      );
    return { actor, email, id: result.data.user.id };
  }
  async function upload(actor, suffix, status = 'published') {
    const data = new FormData();
    data.append(
      'file',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1MAAAAASUVORK5CYII=',
            'base64',
          ),
          Buffer.from(suffix),
        ],
        { type: 'image/png' },
      ),
      'fixture.png',
    );
    for (const [key, value] of Object.entries({
      title: 'Platform test ' + suffix,
      description: 'A synthetic project for platform feature verification.',
      category: 'Illustration',
      price: '12',
      licenses: 'personal',
      rights: 'true',
      status,
    }))
      data.append(key, value);
    return actor.request('/api/artworks', data);
  }
  return { app, client, tokenFor, register, upload };
}

test('email verification uses private, hashed, expiring single-use tokens and gates publication', async (t) => {
  const { app, client, register, tokenFor, upload } = await setup(t),
    { actor, email, id } = await register('Unverified', false),
    guest = client();
  assert.equal((await actor.request('/api/state')).data.user.emailVerified, false);
  assert.equal((await upload(actor, 'blocked')).status, 403);
  const draft = await upload(actor, 'draft', 'draft');
  assert.equal(draft.status, 201);
  assert.equal((await guest.request('/media/' + draft.data.artwork.id)).status, 404);
  assert.equal((await actor.request('/api/billing/orders', { plan: 'premium' })).status, 403);
  assert.equal(
    (
      await actor.request('/api/reports', {
        artworkId: 'quiet-city',
        category: 'fraud',
        details: 'A synthetic report before verification.',
      })
    ).status,
    403,
  );
  const token = tokenFor(email, 'verify'),
    stored = app.db.prepare('SELECT * FROM account_tokens WHERE user_id=?').get(id);
  assert.equal(stored.token_hash, tokenHash(token));
  assert.notEqual(stored.token_hash, token);
  assert.ok(stored.expires_at > Date.now());
  assert.equal(
    (await guest.request('/api/auth/verify-email', { token: '00'.repeat(32) })).status,
    400,
  );
  assert.equal((await guest.request('/api/auth/verify-email', { token })).status, 200);
  assert.equal((await guest.request('/api/auth/verify-email', { token })).status, 400);
  assert.equal((await actor.request('/api/state')).data.user.emailVerified, true);
  assert.equal(
    (
      await actor.request(
        '/api/artworks/' + draft.data.artwork.id,
        { status: 'published' },
        'PATCH',
      )
    ).status,
    200,
  );
  assert.equal((await guest.request('/media/' + draft.data.artwork.id)).status, 200);
  for (const route of ['/api/mail', '/api/local-mail', '/api/account_tokens'])
    assert.equal((await guest.request(route)).status, 404);
  assert.equal(JSON.stringify((await actor.request('/api/state')).data).includes(token), false);
});

test('verification expiry, resend cooldown and changing email invalidate previous links', async (t) => {
  const { app, register, tokenFor } = await setup(t),
    { actor, email, id } = await register('Emailchange', false),
    first = tokenFor(email, 'verify');
  await actor.request('/api/auth/resend-verification', {});
  assert.equal(app.db.prepare('SELECT count(*) n FROM local_mail WHERE email=?').get(email).n, 1);
  app.db
    .prepare('UPDATE account_tokens SET expires_at=?,created_at=? WHERE user_id=?')
    .run(Date.now() - 1, Date.now() - 61000, id);
  assert.equal((await actor.request('/api/auth/verify-email', { token: first })).status, 400);
  assert.equal((await actor.request('/api/auth/resend-verification', {})).status, 200);
  const second = tokenFor(email, 'verify');
  assert.notEqual(second, first);
  const nextEmail = 'new-address@platform.test';
  assert.equal(
    (
      await actor.request(
        '/api/profile',
        { name: 'Emailchange', email: nextEmail, role: 'Creator' },
        'PATCH',
      )
    ).status,
    200,
  );
  assert.equal((await actor.request('/api/auth/verify-email', { token: second })).status, 400);
  assert.equal(
    (await actor.request('/api/auth/verify-email', { token: tokenFor(nextEmail, 'verify') }))
      .status,
    200,
  );
  assert.equal((await actor.request('/api/state')).data.user.emailVerified, true);
});

test('password reset is purpose-bound, single-use and revokes every existing session', async (t) => {
  const { app, client, register, tokenFor } = await setup(t),
    { actor, email, id } = await register('Resetuser', false),
    other = client(),
    guest = client();
  const generic = await guest.request('/api/auth/forgot-password', { email });
  assert.deepEqual(
    generic,
    await guest.request('/api/auth/forgot-password', { email: 'unknown@platform.test' }),
  );
  assert.equal(
    (
      await guest.request('/api/auth/reset-password', {
        token: tokenFor(email, 'verify'),
        password: 'replacement-password',
      })
    ).status,
    400,
  );
  const expired = tokenFor(email, 'reset');
  assert.equal((await guest.request('/api/auth/verify-email', { token: expired })).status, 400);
  app.db
    .prepare(
      "UPDATE account_tokens SET expires_at=?,created_at=? WHERE user_id=? AND purpose='reset'",
    )
    .run(Date.now() - 1, Date.now() - 61000, id);
  assert.equal(
    (
      await guest.request('/api/auth/reset-password', {
        token: expired,
        password: 'replacement-password',
      })
    ).status,
    400,
  );
  await guest.request('/api/auth/forgot-password', { email });
  const token = tokenFor(email, 'reset');
  assert.notEqual(token, expired);
  assert.equal(
    (await guest.request('/api/auth/reset-password', { token, password: 'short' })).status,
    400,
  );
  assert.equal((await other.request('/api/auth/login', { email, password })).status, 200);
  assert.ok(app.db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(id).n >= 2);
  assert.equal(
    (
      await actor.request('/api/wallet/challenge', {
        address: '0x1111111111111111111111111111111111111111',
      })
    ).status,
    200,
  );
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM wallet_challenges WHERE user_id=?').get(id).n,
    1,
  );
  assert.equal(
    (await guest.request('/api/auth/reset-password', { token, password: 'replacement-password' }))
      .status,
    200,
  );
  assert.equal((await actor.request('/api/state')).data.user, null);
  assert.equal((await other.request('/api/state')).data.user, null);
  assert.equal((await guest.request('/api/state')).data.user, null);
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM account_tokens WHERE user_id=?').get(id).n,
    0,
  );
  assert.equal(
    app.db.prepare('SELECT count(*) n FROM wallet_challenges WHERE user_id=?').get(id).n,
    0,
  );
  assert.equal(
    (await guest.request('/api/auth/reset-password', { token, password: 'replacement-password' }))
      .status,
    400,
  );
  assert.equal((await actor.request('/api/auth/login', { email, password })).status, 401);
  assert.equal(
    (await actor.request('/api/auth/login', { email, password: 'replacement-password' })).status,
    200,
  );
});

test('paid access cannot be granted through profile fields or legacy plans and expires without removing projects', async (t) => {
  const { app, register, upload } = await setup(t),
    { actor, id } = await register('Expiry');
  app.db.prepare("UPDATE users SET plan='business' WHERE id=?").run(id);
  assert.equal((await actor.request('/api/state')).data.user.plan, 'free');
  assert.equal((await actor.request('/api/plan', { plan: 'business' }, 'PATCH')).status, 402);
  const profile = await actor.request(
    '/api/profile',
    {
      name: 'Expiry',
      email: 'expiry@platform.test',
      role: 'Creator',
      isAdmin: true,
      plan: 'business',
    },
    'PATCH',
  );
  assert.equal(profile.data.user.isAdmin, false);
  assert.equal(profile.data.user.plan, 'free');
  assert.equal((await actor.request('/api/admin/moderation')).status, 403);
  planFixture(app.db, id, 'premium');
  for (let n = 0; n < 6; n++) assert.equal((await upload(actor, 'expiry-' + n)).status, 201);
  app.db
    .prepare('UPDATE subscriptions SET valid_until=? WHERE user_id=?')
    .run(Math.floor(Date.now() / 1000) - 1, id);
  const state = (await actor.request('/api/state')).data;
  assert.equal(state.user.plan, 'free');
  assert.equal(state.artworks.filter((a) => a.own).length, 6);
  assert.equal((await upload(actor, 'over-quota')).status, 409);
  assert.equal(
    (await actor.request('/api/team', { name: 'Member', email: 'member@platform.test' })).status,
    403,
  );
});

test('moderators review private reports and hiding blocks new sales while preserving existing licenses', async (t) => {
  const { app, client, register, upload } = await setup(t),
    owner = await register('Owner'),
    buyer = await register('Reporter'),
    moderator = await register('Moderator'),
    guest = client();
  const target = (await upload(owner.actor, 'reported')).data.artwork;
  assert.equal(
    (
      await buyer.actor.request('/api/purchases', {
        items: [{ artworkId: target.id, license: 'personal' }],
      })
    ).status,
    201,
  );
  assert.equal((await buyer.actor.request('/api/admin/moderation')).status, 403);
  assert.equal(
    (
      await buyer.actor.request('/api/admin/artworks/' + target.id + '/moderation', {
        hidden: true,
        reason: 'Synthetic moderation reason',
      })
    ).status,
    403,
  );
  const report = {
    artworkId: target.id,
    category: 'copyright',
    details: 'A synthetic report to verify moderator review.',
  };
  assert.equal((await owner.actor.request('/api/reports', report)).status, 400);
  assert.equal((await buyer.actor.request('/api/reports', report)).status, 201);
  assert.equal((await buyer.actor.request('/api/reports', report)).status, 409);
  assert.equal((await owner.actor.request('/api/reports')).data.reports.length, 0);
  app.db
    .prepare('INSERT INTO admin_accounts VALUES(?,?)')
    .run(moderator.id, new Date().toISOString());
  const queue = await moderator.actor.request('/api/admin/moderation');
  assert.equal(queue.status, 200);
  const reportId = queue.data.reports[0].id;
  assert.equal(queue.data.reports[0].reporter, 'Reporter');
  assert.equal(
    (
      await moderator.actor.request('/api/admin/artworks/' + target.id + '/moderation', {
        hidden: true,
        reason: 'Hidden while this report is reviewed.',
      })
    ).status,
    200,
  );
  assert.equal(
    (await guest.request('/api/state')).data.artworks.some((a) => a.id === target.id),
    false,
  );
  assert.equal((await guest.request('/media/' + target.id)).status, 404);
  assert.equal((await buyer.actor.request('/media/' + target.id)).status, 200);
  assert.equal((await buyer.actor.request('/api/artworks/' + target.id + '/download')).status, 200);
  assert.equal((await owner.actor.request('/media/' + target.id)).status, 200);
  const fresh = await register('Newbuyer');
  assert.equal(
    (
      await fresh.actor.request('/api/purchases', {
        items: [{ artworkId: target.id, license: 'personal' }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await owner.actor.request('/api/artworks/' + target.id, { status: 'published' }, 'PATCH'))
      .status,
    200,
  );
  assert.equal((await guest.request('/media/' + target.id)).status, 404);
  assert.equal(
    (await owner.actor.request('/api/artworks/' + target.id, undefined, 'DELETE')).status,
    409,
  );
  assert.equal(
    (
      await moderator.actor.request('/api/admin/reports/' + reportId + '/review', {
        status: 'resolved',
        note: 'Issue reviewed; the project can be restored.',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await moderator.actor.request('/api/admin/reports/' + reportId + '/review', {
        status: 'dismissed',
        note: 'Repeated review is rejected.',
      })
    ).status,
    409,
  );
  const ownReports = (await buyer.actor.request('/api/reports')).data.reports;
  assert.equal(ownReports[0].status, 'resolved');
  assert.match(ownReports[0].reviewNote, /restored/);
  assert.equal('reporter_id' in ownReports[0], false);
  assert.equal(
    (
      await moderator.actor.request('/api/admin/artworks/' + target.id + '/moderation', {
        hidden: false,
        reason: 'Report resolved and publication restored.',
      })
    ).status,
    200,
  );
  assert.equal((await guest.request('/media/' + target.id)).status, 200);
  assert.deepEqual(
    (await moderator.actor.request('/api/admin/moderation')).data.actions
      .map((a) => a.action)
      .sort(),
    ['hide', 'restore'],
  );
  app.db.prepare('DELETE FROM admin_accounts WHERE user_id=?').run(moderator.id);
  assert.equal((await moderator.actor.request('/api/admin/moderation')).status, 403);
});
