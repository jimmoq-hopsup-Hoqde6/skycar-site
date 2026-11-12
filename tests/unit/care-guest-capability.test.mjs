import test from 'node:test';
import assert from 'node:assert/strict';
import { guestCapability, guestCookie, guestCookieName, verifyGuestCookie } from '../../src/server/care/journey/access.mjs';

const secret = 'synthetic-test-secret';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';
const token = guestCapability(secret, id, key);
const pair = `${guestCookieName(id)}=${token}`;

test('guest access accepts the exact request capability among unrelated cookies', () => {
  assert.equal(verifyGuestCookie(`unrelated=value; ${pair}; another=value`, secret, id, key), true);
});

test('guest access cannot be moved to another request', () => {
  assert.equal(verifyGuestCookie(pair, secret, other, key), false);
  assert.equal(verifyGuestCookie(`${guestCookieName(other)}=${token}`, secret, other, key), false);
});

test('guest access rejects changed intake keys and rotated signing secrets', () => {
  assert.equal(verifyGuestCookie(pair, secret, id, other), false);
  assert.equal(verifyGuestCookie(pair, 'rotated-synthetic-secret', id, key), false);
});

test('missing, malformed and modified capabilities fail closed without throwing', () => {
  for (const value of ['', '0', 'g'.repeat(64), token.slice(1), `${token}0`, `${token[0] === 'a' ? 'b' : 'a'}${token.slice(1)}`]) {
    assert.equal(verifyGuestCookie(`${guestCookieName(id)}=${value}`, secret, id, key), false);
  }
  assert.equal(verifyGuestCookie(null, secret, id, key), false);
});

test('a similarly named cookie cannot impersonate the capability cookie', () => {
  assert.equal(verifyGuestCookie(`prefix_${pair}`, secret, id, key), false);
  assert.equal(verifyGuestCookie(`${guestCookieName(id)}_suffix=${token}`, secret, id, key), false);
});

test('guest cookie is HTTPS-only, HttpOnly and scoped to the exact journey API', () => {
  const cookie = guestCookie(secret, id, key);
  assert.equal(cookie, `${pair}; Path=/api/v1/care/journey/${id}; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`);
  assert.ok(!cookie.includes(key));
  assert.ok(!cookie.includes(secret));
  assert.ok(!guestCookie(secret, id, key, false).includes('; Secure'));
});
