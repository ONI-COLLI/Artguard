import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defenseRequestAllowed } from '../server/defense.ts';
const request = (headers = {}, address = '127.0.0.1'): any => ({
  socket: { remoteAddress: address },
  headers: {
    host: '127.0.0.1:3600',
    origin: 'http://127.0.0.1:3600',
    'x-artguard-defense': '1',
    ...headers,
  },
});
test('live commands require an explicitly enabled local stand and a same-origin custom header', () => {
  assert.equal(defenseRequestAllowed(request(), true), true);
  assert.equal(defenseRequestAllowed(request(), false), false);
  assert.equal(defenseRequestAllowed(request({}, '10.1.2.3'), true), false);
  assert.equal(defenseRequestAllowed(request({ origin: 'https://attacker.test' }), true), false);
  assert.equal(
    defenseRequestAllowed(
      request({ host: 'attacker.test:3600', origin: 'http://attacker.test:3600' }),
      true,
    ),
    false,
  );
  assert.equal(defenseRequestAllowed(request({ 'x-artguard-defense': undefined }), true), false);
  assert.equal(
    defenseRequestAllowed(
      request({ host: '127.0.0.1:3300', origin: 'http://127.0.0.1:3300' }),
      true,
    ),
    false,
  );
});
