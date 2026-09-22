import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedWriteOrigin } from '../../src/server/http/request-origin.mjs';

const configured = { environment: 'staging', appOrigin: 'https://phone.skycar.test' };
const request = (origin, headers = {}, url = 'http://localhost:3000/api/write') => new Request(url, {
  headers: { ...(origin === null ? {} : { origin }), ...headers },
});

test('approved public origin works behind an internal runtime without trusting proxy headers', () => {
  assert.equal(isTrustedWriteOrigin(request(configured.appOrigin), configured), true);
  assert.equal(isTrustedWriteOrigin(request(configured.appOrigin, {
    host: 'internal:3000', 'x-forwarded-host': 'attacker.test', 'x-forwarded-proto': 'http',
  }), configured), true);
  for (const origin of [null, '', 'null', 'https://attacker.test', 'http://phone.skycar.test',
    'https://phone.skycar.test:444', 'https://phone.skycar.test/path', 'https://user@phone.skycar.test',
    'https://phone.skycar.test,https://attacker.test']) {
    assert.equal(isTrustedWriteOrigin(request(origin, {
      host: 'phone.skycar.test', 'x-forwarded-host': 'phone.skycar.test', 'x-forwarded-proto': 'https',
    }), configured), false, String(origin));
  }
  assert.equal(isTrustedWriteOrigin(request(configured.appOrigin, { 'sec-fetch-site': 'cross-site' }), configured), false);
});

test('hosted environments fail closed on absent or invalid deployment origin', () => {
  for (const environment of ['staging', 'production', 'unexpected']) {
    assert.equal(isTrustedWriteOrigin(request('http://localhost:3000'), { environment }), false);
    for (const appOrigin of ['', 'null', 'https://phone.skycar.test/', 'https://user@phone.skycar.test',
      'http://phone.skycar.test', 'http://localhost:3000', 'https://phone.skycar.test?x=y']) {
      assert.equal(isTrustedWriteOrigin(request(appOrigin), { environment, appOrigin }), false);
    }
  }
});

test('local demo respects the actual loopback Host and port instead of Next normalization', () => {
  const options = { environment: 'demo', appOrigin: undefined };
  assert.equal(isTrustedWriteOrigin(request('http://127.0.0.1:3000', { host: '127.0.0.1:3000' }), options), true);
  assert.equal(isTrustedWriteOrigin(request('http://[::1]:3000', { host: '[::1]:3000' }), options), true);
  assert.equal(isTrustedWriteOrigin(request('http://localhost:3000', { host: '127.0.0.1:3000' }), options), false);
  assert.equal(isTrustedWriteOrigin(request('http://127.0.0.1:4000', { host: '127.0.0.1:4000' }), options), false);
  assert.equal(isTrustedWriteOrigin(request('http://attacker.test:3000', { host: 'attacker.test:3000' }), options), false);
  assert.equal(isTrustedWriteOrigin(request('https://attacker.test', { 'x-forwarded-host': 'attacker.test' }), options), false);
  assert.equal(isTrustedWriteOrigin(request('https://skycar.test', {}, 'https://skycar.test/write'), options), true);
});
