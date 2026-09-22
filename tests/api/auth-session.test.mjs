// Real Next.js cookie boundary; synthetic local Auth, never a hosted acceptance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

test('built sign-in replaces accounts, refreshes cookies and signs out privately', { timeout: 30000 }, async () => {
  const ids = { 'a@example.test': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b@example.test': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  let refreshes = 0;
  const session = (id, expired = false) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = encode({ alg: 'HS256', typ: 'JWT' });
    const body = encode({ sub: id, aud: 'authenticated', role: 'authenticated', iat: now - 120, exp: expired ? now - 60 : now + 3600 });
    return { access_token: `${head}.${body}.${createHmac('sha256', 'test-only').update(`${head}.${body}`).digest('base64url')}`, refresh_token: id, expires_in: expired ? -60 : 3600, expires_at: expired ? now - 60 : now + 3600, token_type: 'bearer', user: { id, aud: 'authenticated', created_at: new Date().toISOString() } };
  };
  const stub = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/v1/token?grant_type=password') {
      const input = JSON.parse(raw);
      if (!ids[input.email] || input.password !== 'synthetic-password') { res.statusCode = 400; return res.end('{"error":"invalid_grant","error_description":"Synthetic private provider detail"}'); }
      return res.end(JSON.stringify(session(ids[input.email])));
    }
    if (req.url === '/auth/v1/token?grant_type=refresh_token') { refreshes++; return res.end(JSON.stringify(session(JSON.parse(raw).refresh_token))); }
    if (req.url === '/auth/v1/user') {
      const id = JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url')).sub;
      return res.end(JSON.stringify(session(id).user));
    }
    if (req.url === '/auth/v1/logout?scope=local') { res.statusCode = 204; return res.end(); }
    res.statusCode = 500; res.end('{"error":"Unexpected synthetic endpoint"}');
  });
  stub.listen(0, '127.0.0.1'); await once(stub, 'listening');
  const base = 'http://127.0.0.1:3441';
  const origin = 'https://phone.skycar.test';
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3441'], {
    env: { ...process.env, SKYCAR_ENV: 'staging', SKYCAR_APP_ORIGIN: origin, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${stub.address().port}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-only' }, stdio: 'ignore',
  });
  const exited = once(server, 'exit');
  const jar = new Map();
  const capture = response => {
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    for (const value of response.headers.getSetCookie()) {
      assert.match(value, /HttpOnly/i); assert.match(value, /Secure/i); assert.match(value, /SameSite=lax/i);
      const pair = value.split(';')[0]; const at = pair.indexOf('=');
      if (value.match(/Max-Age=0/i)) jar.delete(pair.slice(0, at)); else jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const post = (path, data, from = origin) => fetch(base + path, { method: 'POST', headers: { origin: from, cookie: cookie(), 'content-type': 'application/json' }, body: JSON.stringify(data) });
  try {
    let ready = false;
    for (let i = 0; i < 75; i++) { try { await fetch(base + '/api/v1/health'); ready = true; break; } catch { await delay(100); } }
    assert.ok(ready);
    const rejected = await post('/api/v1/auth/sign-in', { email: 'a@example.test', password: 'wrong' });
    assert.equal(rejected.status, 401); assert.doesNotMatch(await rejected.text(), /private provider/);
    assert.equal((await post('/api/v1/auth/sign-in', {}, 'https://attacker.test')).status, 403);
    for (const email of Object.keys(ids)) {
      const result = await post('/api/v1/auth/sign-in', { email, password: 'synthetic-password', next: '/care/requests/cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
      assert.equal(result.status, 200); capture(result);
      assert.equal((await result.json()).data.redirectTo, '/care/requests/cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      const value = decodeURIComponent(jar.get('sb-127-auth-token'));
      assert.equal(JSON.parse(Buffer.from(value.slice(7), 'base64url')).user.id, ids[email]);
    }
    jar.set('sb-127-auth-token', 'base64-' + Buffer.from(JSON.stringify(session(ids['b@example.test'], true))).toString('base64url'));
    const refreshed = await fetch(base + '/auth/sign-in', { headers: { cookie: cookie() } });
    assert.equal(refreshed.status, 200); capture(refreshed); await refreshed.text(); assert.ok(refreshes > 0);
    const signedOut = await post('/api/v1/auth/sign-out', {});
    assert.equal(signedOut.status, 200); capture(signedOut); assert.equal(jar.size, 0);
    console.log('PASS: secure HTTP-only cookies, A → B replacement, expiry refresh, local sign-out, private responses');
  } finally { server.kill('SIGTERM'); await exited; await new Promise(resolve => stub.close(resolve)); }
});
