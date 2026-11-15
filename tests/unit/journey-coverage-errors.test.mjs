import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyBoundary, JourneyError } from '../../src/server/care/journey/http.ts';
import { readFileSync } from 'node:fs';

const submitSource = readFileSync(new URL('../../src/server/care/http.ts', import.meta.url), 'utf8');

// 20261115100000: care_journey_command('update_details') raises the submit coverage codes.
// The journey route answers them with the same status and retryability as submit.
const cases = [['OUT_OF_AREA', 422], ['COVERAGE_UNAVAILABLE', 503]];
for (const [code, status] of cases) {
  test(`journey boundary maps ${code} to ${status}, not retryable`, async () => {
    const response = await journeyBoundary(async () => { throw new JourneyError(code); });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(body.error.retryable, false);
    assert.match(body.error.message, /not changed/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  });
  test(`${code} has the same status and retryability as submit (src/server/care/http.ts)`, () => {
    assert.match(submitSource, new RegExp(`${code}: \\{ status: ${status}, message: "[^"]+", retryable: false \\}`));
  });
}
test('other 503 journey answers stay retryable', async () => {
  const response = await journeyBoundary(async () => { throw new JourneyError('UNAVAILABLE'); });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.retryable, true);
});
