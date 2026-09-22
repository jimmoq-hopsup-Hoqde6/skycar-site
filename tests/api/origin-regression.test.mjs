// Real built Next.js routes with localhost-only synthetic Auth/RPC/Storage.
// This verifies the HTTP boundary, not hosted Supabase, RLS or physical devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vehicleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const assetId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jpeg = Buffer.alloc(256); jpeg.set([0xff, 0xd8, 0xff]);

test('built writes accept the real page origin and reject origin/proxy spoofing before mutations', { timeout: 45000 }, async () => {
  const at = Math.floor(Date.now() / 1000);
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: actor, aud: 'authenticated', role: 'authenticated', iat: at, exp: at + 3600 });
  const token = `${header}.${payload}.${createHmac('sha256', 'synthetic-test-only').update(`${header}.${payload}`).digest('base64url')}`;
  const cookie = 'sb-127-auth-token=base64-' + b64({ access_token: token, refresh_token: 'synthetic-only',
    expires_at: at + 3600, expires_in: 3600, token_type: 'bearer', user: { id: actor } });
  let mutations = 0;
  let authChecks = 0;
  const stub = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader('Content-Type', 'application/json');
    const vehicle = { id: vehicleId, make: 'Synthetic', model: 'Car', variant: null, year: null,
      registration: null, registration_state: null, revision: 1, archived_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (req.url === '/auth/v1/user') {
      authChecks++;
      return res.end(JSON.stringify({ id: actor, aud: 'authenticated', role: 'authenticated', created_at: vehicle.created_at }));
    }
    mutations++;
    if (req.url === '/rest/v1/rpc/garage_mutate_vehicle') return res.end(JSON.stringify(vehicle));
    if (['/rest/v1/rpc/care_submit_request', '/rest/v1/rpc/care_retry_request'].includes(req.url)) {
      return res.end(JSON.stringify({ request: { id: requestId }, replayed: false }));
    }
    if (req.url === '/rest/v1/rpc/garage_reserve_vehicle_photo') return res.end('{"processing_state":"uploading"}');
    if (req.url.startsWith('/storage/v1/object/private-media/')) return res.end('{"Key":"synthetic"}');
    if (req.url === '/rest/v1/rpc/garage_finalize_vehicle_photo') return res.end(JSON.stringify({
      id: assetId, vehicle_id: vehicleId, purpose: 'vehicle_original', mime_type: 'image/jpeg',
      size_bytes: 256, processing_state: 'stored', created_at: vehicle.created_at,
      original_status: 'stored', display_status: 'unavailable', replayed: false,
    }));
    res.statusCode = 500; res.end('{"message":"Unexpected synthetic endpoint"}');
  });
  stub.listen(0, '127.0.0.1'); await once(stub, 'listening');
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const operations = [
    ['garage/vehicles', 'POST', { make: 'Synthetic', model: 'Car' }, 201],
    [`garage/vehicles/${vehicleId}`, 'PATCH', { make: 'Synthetic', model: 'Car', expected_revision: 1 }, 200],
    [`garage/vehicles/${vehicleId}/archive`, 'POST', { expected_revision: 1 }, 200],
    ['care/requests', 'POST', { vehicle_id: vehicleId, service: 'repair', description: 'Synthetic scratch repair request', preferred_window: 'flexible' }, 201],
    [`care/requests/${requestId}/retry`, 'POST', {}, 200],
    [`garage/vehicles/${vehicleId}/photo`, 'POST', jpeg, 201],
    ['care/coverage', 'POST', { service: 'repair', postcode: '5000' }, 503],
  ];
  try {
    for (const mode of ['local', 'proxy', 'unconfigured']) {
      const port = { local: 3431, proxy: 3432, unconfigured: 3433 }[mode];
      const base = `http://127.0.0.1:${port}`;
      const pageOrigin = mode === 'local' ? base : 'https://phone.skycar.test';
      const env = { ...process.env, SKYCAR_ENV: mode === 'local' ? 'demo' : 'staging', FEATURE_CARE: 'true',
        FEATURE_GARAGE: 'true', NEXT_PUBLIC_SUPABASE_URL: stubUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-only', SUPABASE_SECRET_KEY: 'synthetic-server-only' };
      delete env.SKYCAR_APP_ORIGIN;
      if (mode === 'proxy') env.SKYCAR_APP_ORIGIN = pageOrigin;
      const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: 'ignore' });
      const exited = once(server, 'exit');
      try {
        let ready = false;
        for (let i = 0; i < 75; i++) {
          try { const r = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(500) }); await r.text(); ready = true; break; }
          catch { await delay(100); }
        }
        assert.ok(ready, 'Built application started');
        for (const [path, method, data, expected] of operations) {
          for (const variant of ['same-origin', 'foreign', 'missing', 'null', 'cross-site', 'forged-forwarded-host']) {
            const origin = variant === 'foreign' || variant === 'forged-forwarded-host' ? 'https://attacker.test'
              : variant === 'null' ? 'null' : pageOrigin;
            const before = mutations;
            const r = await fetch(`${base}/api/v1/${path}`, { method, signal: AbortSignal.timeout(5000), headers: {
              cookie, 'content-type': Buffer.isBuffer(data) ? 'image/jpeg' : 'application/json', 'idempotency-key': randomUUID(),
              ...(variant === 'missing' ? {} : { origin }),
              ...(variant === 'cross-site' ? { 'sec-fetch-site': 'cross-site' } : {}),
              ...(variant === 'forged-forwarded-host' ? { 'x-forwarded-host': 'attacker.test', 'x-forwarded-proto': 'https' } : {}),
            }, body: Buffer.isBuffer(data) ? data : JSON.stringify(data) });
            const body = await r.json();
            const allowed = variant === 'same-origin' && mode !== 'unconfigured';
            assert.equal(r.status, allowed ? expected : 403, `${mode} ${path} ${variant}: ${body.error?.code}`);
            if (!allowed) assert.equal(mutations, before, 'Rejected origin never reaches RPC/Storage');
            else if (path !== 'care/coverage') assert.ok(mutations > before, 'Authenticated operation reached synthetic persistence');
            else assert.equal(body.error.code, 'COVERAGE_UNAVAILABLE');
          }
        }
        console.log(`PASS origin boundary: ${mode}, 7 operations × 6 origin cases`);
      } finally { server.kill('SIGTERM'); await exited; }
    }
    assert.ok(authChecks > 0, 'Session validation was exercised');
  } finally { await new Promise(resolve => stub.close(resolve)); }
});
