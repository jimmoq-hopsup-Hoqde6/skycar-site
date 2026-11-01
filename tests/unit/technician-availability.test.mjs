import test from 'node:test';
import assert from 'node:assert/strict';
import { adelaideBoundaryOk, adelaideToday, addCalendarMonths, readAvailabilityCommand, readAvailabilityResult, readAvailabilitySchedule } from '../../src/domain/technician/availability.mjs';
import { availabilityFault, createAvailabilityHandlers } from '../../src/server/technician/availability-http.mjs';
import { safeReturnPath } from '../../src/server/auth/http.mjs';

const now = new Date('2026-11-01T00:30:00Z');
const account = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const quiet = { logger: { info() {}, error() {} }, now: () => now };
const schedule = {
  timezone: 'Australia/Adelaide',
  revision: 0,
  weekly_windows: [],
  exceptions: [],
  evaluated_at: '2026-11-01T00:30:00.000Z',
};

function command(overrides = {}) {
  return {
    expected_revision: 0,
    timezone: 'Australia/Adelaide',
    weekly_windows: [{ weekday: 1, starts_at: '09:00', ends_at: '17:00' }],
    exceptions: [],
    ...overrides,
  };
}

test('Adelaide offsets distinguish missing, ambiguous and ordinary local times', () => {
  assert.equal(adelaideToday(now), '2026-11-01');
  assert.equal(addCalendarMonths('2026-11-01', 18), '2028-05-01');
  assert.equal(adelaideBoundaryOk('2026-10-04', '02:30', '+10:30'), false);
  assert.equal(adelaideBoundaryOk('2026-10-04', '02:30', '+09:30'), false);
  assert.equal(adelaideBoundaryOk('2027-04-04', '02:30', '+10:30'), true);
  assert.equal(adelaideBoundaryOk('2027-04-04', '02:30', '+09:30'), true);
  assert.equal(adelaideBoundaryOk('2026-12-01', '14:00', '+10:30'), true);
  assert.equal(adelaideBoundaryOk('2026-12-01', '14:00', '+09:30'), false);
  assert.equal(adelaideBoundaryOk('2027-06-01', '14:00', '+09:30'), true);
  assert.equal(adelaideBoundaryOk('2027-06-01', '14:00', '+10:30'), false);
});

test('schedule commands accept canonical hours and reject booking-shaped input', () => {
  const accepted = readAvailabilityCommand(command(), now);
  assert.equal(accepted.expectedRevision, 0);
  assert.equal(accepted.payload.weekly_windows.length, 1);
  assert.equal(readAvailabilitySchedule(schedule), schedule);
  assert.equal(readAvailabilityResult({ revision: 1, replayed: false }).replayed, false);
  for (const body of [
    command({ timezone: 'UTC' }),
    command({ weekly_windows: [{ weekday: 1, starts_at: '23:00', ends_at: '01:00' }] }),
    command({ weekly_windows: [{ weekday: 1, starts_at: '09:00', ends_at: '09:10' }] }),
    command({ weekly_windows: [{ weekday: 1, starts_at: '09:00', ends_at: '12:00' }, { weekday: 1, starts_at: '12:00', ends_at: '17:00' }] }),
    command({ weekly_windows: [{ weekday: 2, starts_at: '09:00', ends_at: '17:00' }, { weekday: 1, starts_at: '09:00', ends_at: '17:00' }] }),
    command({ exceptions: [{ date: '2026-10-01', windows: [] }] }),
    command({ exceptions: [{ date: '2027-10-03', windows: [{ starts_at: '02:30', starts_at_offset: '+10:30', ends_at: '04:00', ends_at_offset: '+10:30' }] }] }),
    { ...command(), note: 'always open' },
    command({ expected_revision: -1 }),
  ]) assert.throws(() => readAvailabilityCommand(body, now));
  const closed = readAvailabilityCommand(command({
    exceptions: [{ date: '2026-12-25', windows: [] }, { date: '2026-12-28', windows: [{ starts_at: '10:00', starts_at_offset: '+10:30', ends_at: '14:00', ends_at_offset: '+10:30' }] }],
  }), now);
  assert.equal(closed.payload.exceptions[0].windows.length, 0);
});

test('availability HTTP stays private and does not trust a mismatched account', async () => {
  assert.equal(safeReturnPath('/technician/availability'), '/technician/availability');
  let replaced = 0;
  const handlers = createAvailabilityHandlers({
    async read() { return { account, data: schedule }; },
    async replace(_key, _command, expected) {
      if (expected !== account) throw availabilityFault('FORBIDDEN');
      replaced += 1;
      return { account, data: { revision: 1, replayed: false } };
    },
  }, quiet);
  const loaded = await handlers.read(new Request('http://localhost/api/v1/technician/availability'));
  assert.equal(loaded.status, 200);
  assert.equal(loaded.headers.get('cache-control'), 'private, no-store');
  assert.equal(loaded.headers.get('x-skycar-account'), account);
  const saved = await handlers.replace(new Request('http://localhost/api/v1/technician/availability', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', 'idempotency-key': key, 'x-skycar-account': account },
    body: JSON.stringify(command()),
  }));
  assert.equal(saved.status, 200);
  assert.equal(replaced, 1);
  const mismatch = await handlers.replace(new Request('http://localhost/api/v1/technician/availability', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', 'idempotency-key': key, 'x-skycar-account': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    body: JSON.stringify(command()),
  }));
  assert.equal(mismatch.status, 403);
  const invalid = await handlers.replace(new Request('http://localhost/api/v1/technician/availability', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', 'idempotency-key': key, 'x-skycar-account': account },
    body: JSON.stringify(command({ timezone: 'UTC' })),
  }));
  assert.equal(invalid.status, 400);
  assert.equal(replaced, 1);
});
