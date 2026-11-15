import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyBoundary, JourneyError } from '../../src/server/care/journey/http.ts';
import { technicianFault } from '../../src/server/technician/http.mjs';

// 20261115090000 raises these from care_journey_command (publish_quote, select_quote, confirm) and
// care_technician_job_command (quote). They are decisions, not outages: 409 and never retryable.
for (const code of ['EXPERT_ACCOUNT_REQUIRED', 'AVAILABILITY_REQUIRED', 'AVAILABILITY_SLOT_UNAVAILABLE']) {
  test(`journey boundary maps ${code} to a non-retryable 409`, async () => {
    const response = await journeyBoundary(async () => { throw new JourneyError(code); });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(body.error.retryable, false);
    assert.match(body.error.message, code === 'EXPERT_ACCOUNT_REQUIRED' ? /technician login/i : /availability/i);
  });
  test(`technician fault maps ${code} to 409 with its own code`, () => {
    const fault = technicianFault(code);
    assert.equal(fault.code, code);
    assert.equal(fault.status, 409);
  });
}
test('capacity overlap keeps SLOT_UNAVAILABLE distinct from the availability codes', async () => {
  const response = await journeyBoundary(async () => { throw new JourneyError('SLOT_UNAVAILABLE'); });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'SLOT_UNAVAILABLE');
  assert.doesNotMatch(body.error.message, /published availability/);
});
