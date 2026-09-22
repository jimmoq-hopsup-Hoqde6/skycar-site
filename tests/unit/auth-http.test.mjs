import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiFault } from '../../src/server/http/api-boundary.mjs';
import { createAuthHandlers, safeReturnPath } from '../../src/server/auth/http.mjs';

const requestId = '10000000-0000-4000-8000-000000000001';

function request(path, body, headers = {}) {
  return new Request(`https://skycar.test${path}`, {
    method: 'POST',
    headers: { origin: 'https://skycar.test', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function setup(overrides = {}) {
  const calls = [];
  const auth = {
    signInWithPassword: async value => { calls.push(['signIn', value]); return { error: null }; },
    signOut: async value => { calls.push(['signOut', value]); return { error: null }; },
    ...overrides,
  };
  const logs = [];
  const handlers = createAuthHandlers({ connect: async () => ({ auth }) }, {
    makeRequestId: () => requestId,
    now: () => 10,
    logger: { info: value => logs.push(value), error: value => logs.push(value) },
  });
  return { calls, handlers, logs };
}

test('sign in normalizes only the email and returns an allow-listed local path', async () => {
  const { calls, handlers } = setup();
  const response = await handlers.signIn(request('/api/v1/auth/sign-in', {
    email: '  PERSON@Example.Test ', password: '  exact password  ', next: '/care/request?from=garage#form',
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.deepEqual(calls, [['signIn', { email: 'person@example.test', password: '  exact password  ' }]]);
  assert.equal((await response.json()).data.redirectTo, '/care/request?from=garage#form');
});

test('request-status is an allow-listed return path', () => {
  assert.equal(
    safeReturnPath('/care/requests/11111111-1111-4111-8111-111111111111'),
    '/care/requests/11111111-1111-4111-8111-111111111111',
  );
});

for (const next of ['https://evil.test/', '//evil.test/', '/\\evil.test/', '/api/v1/garage/vehicles', '/auth/sign-out', '/', 'javascript:alert(1)']) {
  test(`reject unsafe return path ${JSON.stringify(next)}`, () => {
    assert.throws(() => safeReturnPath(next), error => error instanceof ApiFault && error.code === 'VALIDATION_FAILED');
  });
}

for (const [label, body, headers, status] of [
  ['cross origin', { email: 'a@example.test', password: 'secret' }, { origin: 'https://evil.test' }, 403],
  ['missing origin', { email: 'a@example.test', password: 'secret' }, { origin: '' }, 403],
  ['non-json', { email: 'a@example.test', password: 'secret' }, { 'content-type': 'text/plain' }, 415],
  ['bad JSON', '{', {}, 400],
  ['unknown field', { email: 'a@example.test', password: 'secret', role: 'admin' }, {}, 400],
  ['invalid email', { email: 'not-an-email', password: 'secret' }, {}, 400],
  ['empty password', { email: 'a@example.test', password: '' }, {}, 400],
  ['oversized body', ' '.repeat(8193), { 'content-length': '1' }, 413],
]) {
  test(`reject ${label} before contacting Supabase`, async () => {
    const { calls, handlers } = setup();
    const response = await handlers.signIn(request('/api/v1/auth/sign-in', body, headers));
    assert.equal(response.status, status);
    assert.equal(calls.length, 0);
  });
}

test('provider sign-in rejection stays generic in the response and log', async () => {
  const { handlers, logs } = setup({
    signInWithPassword: async () => ({ error: new Error('provider detail for person@example.test password=secret') }),
  });
  const response = await handlers.signIn(request('/api/v1/auth/sign-in', {
    email: 'person@example.test', password: 'secret', next: '/garage',
  }));
  const serialized = JSON.stringify(await response.json());
  assert.equal(response.status, 401);
  assert.match(serialized, /INVALID_CREDENTIALS/);
  assert.doesNotMatch(serialized, /person@|password=|provider detail/);
  assert.doesNotMatch(logs[0], /person@|password=|provider detail/);
  assert.match(logs[0], /\/api\/v1\/auth\/sign-in/);
});

test('unexpected sign-in failure is redacted and never reports success', async () => {
  const { handlers, logs } = setup({ signInWithPassword: async () => { throw new Error('secret transport failure'); } });
  const response = await handlers.signIn(request('/api/v1/auth/sign-in', {
    email: 'person@example.test', password: 'secret', next: '/garage',
  }));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret transport/);
  assert.doesNotMatch(logs[0], /secret transport/);
});

test('sign out is same-origin, local-scope and returns the sign-in page', async () => {
  const { calls, handlers } = setup();
  const response = await handlers.signOut(request('/api/v1/auth/sign-out', {}));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['signOut', { scope: 'local' }]]);
  assert.equal((await response.json()).data.redirectTo, '/auth/sign-in');
});

test('sign out rejects cross-origin and non-empty requests before contacting Supabase', async () => {
  for (const candidate of [
    request('/api/v1/auth/sign-out', {}, { origin: 'https://evil.test' }),
    request('/api/v1/auth/sign-out', { scope: 'global' }),
  ]) {
    const { calls, handlers } = setup();
    assert.ok([400, 403].includes((await handlers.signOut(candidate)).status));
    assert.equal(calls.length, 0);
  }
});

test('sign-out provider failure is retryable and redacted', async () => {
  const { handlers } = setup({ signOut: async () => ({ error: new Error('private token') }) });
  const response = await handlers.signOut(request('/api/v1/auth/sign-out', {}));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'SIGN_OUT_FAILED');
  assert.equal(body.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(body), /private token/);
});
