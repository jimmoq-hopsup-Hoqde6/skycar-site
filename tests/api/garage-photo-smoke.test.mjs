import test from 'node:test';
import assert from 'node:assert/strict';
import { startNext } from './support/next-server.mjs';

test('built Garage photo route fails closed without activation/configuration', { timeout: 30000 }, async () => {
  for (const feature of ['false', 'true']) {
    const app = await startNext({ ...process.env, FEATURE_GARAGE: feature, SKYCAR_ENV: 'demo', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' });
    const base = app.base;
    try {
      const response = await fetch(`${base}/api/v1/garage/vehicles/11111111-1111-4111-8111-111111111111/photo`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const body = await response.json();
      assert.equal(body.error.code, 'GARAGE_UNAVAILABLE');
      assert.ok(body.meta.requestId);
      assert.equal(body.data, undefined);
    } finally {
      await app.stop();
    }
  }
});
