import test from 'node:test';
import assert from 'node:assert/strict';
import { adelaideBoundaryOk, adelaideToday, addCalendarMonths, readAvailabilityCommand, readAvailabilityResult, readAvailabilitySchedule } from '../../src/domain/technician/availability.mjs';
import { availabilityFault, availabilityWriteFault, createAvailabilityHandlers } from '../../src/server/technician/availability-http.mjs';
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

const fallBackDate = '2027-04-04';
const dated = windows => command({exceptions: [{date: fallBackDate, windows}]});
const invertedFallBack = [{starts_at: '02:30', starts_at_offset: '+09:30', ends_at: '02:45', ends_at_offset: '+10:30'}];
const overlappingFallBack = [
  {starts_at: '02:00', starts_at_offset: '+09:30', ends_at: '02:50', ends_at_offset: '+09:30'},
  {starts_at: '02:55', starts_at_offset: '+10:30', ends_at: '03:10', ends_at_offset: '+09:30'},
];

test('fall-back exception windows reject reversed instants and real overlaps despite valid wall hours', () => {
  const nonAdjacentOverlap = [
    {starts_at: '02:00', starts_at_offset: '+09:30', ends_at: '02:40', ends_at_offset: '+09:30'},
    {starts_at: '02:41', starts_at_offset: '+10:30', ends_at: '02:56', ends_at_offset: '+10:30'},
    {starts_at: '02:57', starts_at_offset: '+10:30', ends_at: '03:12', ends_at_offset: '+09:30'},
  ];
  for (const windows of [invertedFallBack, overlappingFallBack, nonAdjacentOverlap]) {
    const body = dated(windows);
    assert.throws(() => readAvailabilityCommand(body, now), /offset|overlap/i);
    assert.throws(() => readAvailabilitySchedule({...schedule, exceptions: body.exceptions}), /offset|overlap/i);
  }
});

test('explicit fall-back offsets retain valid spans and disjoint windows even when real-time order differs', () => {
  for (const windows of [
    [{starts_at: '02:30', starts_at_offset: '+10:30', ends_at: '02:45', ends_at_offset: '+09:30'}],
    [{starts_at: '02:30', starts_at_offset: '+09:30', ends_at: '02:45', ends_at_offset: '+09:30'}],
    [
      {starts_at: '02:00', starts_at_offset: '+09:30', ends_at: '02:15', ends_at_offset: '+09:30'},
      {starts_at: '02:20', starts_at_offset: '+10:30', ends_at: '02:35', ends_at_offset: '+10:30'},
    ],
  ]) {
    const body = dated(windows);
    assert.deepEqual(readAvailabilityCommand(body, now).payload.exceptions, body.exceptions);
    assert.deepEqual(readAvailabilitySchedule({...schedule, exceptions: body.exceptions}).exceptions, body.exceptions);
  }
});

test('saved and submitted exception boundaries both reject spring gaps and mismatched seasonal offsets', () => {
  for (const [date, windows] of [
    ['2027-10-03', [{starts_at: '02:30', starts_at_offset: '+09:30', ends_at: '04:00', ends_at_offset: '+10:30'}]],
    ['2027-10-03', [{starts_at: '01:30', starts_at_offset: '+09:30', ends_at: '02:30', ends_at_offset: '+10:30'}]],
    ['2027-06-01', [{starts_at: '09:00', starts_at_offset: '+10:30', ends_at: '17:00', ends_at_offset: '+10:30'}]],
  ]) {
    const body = command({exceptions: [{date, windows}]});
    assert.throws(() => readAvailabilityCommand(body, now));
    assert.throws(() => readAvailabilitySchedule({...schedule, exceptions: body.exceptions}));
  }
  const windows = [{starts_at: '01:30', starts_at_offset: '+09:30', ends_at: '03:30', ends_at_offset: '+10:30'}];
  const body = command({exceptions: [{date: '2027-10-03', windows}]});
  assert.deepEqual(readAvailabilityCommand(body, now).payload.exceptions, body.exceptions);
  assert.deepEqual(readAvailabilitySchedule({...schedule, exceptions: body.exceptions}).exceptions, body.exceptions);
  // Existing saved history may be outside today's editing horizon; its offsets still validate.
  assert.doesNotThrow(() => readAvailabilitySchedule({...schedule, exceptions: [{date: '2026-10-04', windows}]}));
});

test('invalid DST windows return non-retryable HTTP400 before reaching the repository', async () => {
  let calls = 0;
  const handlers = createAvailabilityHandlers({async replace() { calls += 1; return {account, data: {revision: 1, replayed: false}}; }}, quiet);
  for (const windows of [invertedFallBack, overlappingFallBack]) {
    const response = await handlers.replace(new Request('http://localhost/api/v1/technician/availability', {
      method: 'PUT', headers: {'content-type': 'application/json', origin: 'http://localhost', 'idempotency-key': key, 'x-skycar-account': account},
      body: JSON.stringify(dated(windows)),
    }));
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error.code, 'VALIDATION_FAILED');
    assert.equal(result.error.retryable, false);
  }
  assert.equal(calls, 0, 'invalid hours cannot create an unknown write outcome');
});


test('only known availability write constraints become safe non-retryable validation faults', async () => {
  const cases = [
    ['23514', 'care_technician_availability_exception_windows_instant_order'],
    ['23P01', 'care_technician_availability_exception_windows_no_overlap'],
    ['23P01', 'care_technician_availability_windows_no_overlap'],
  ];
  for (const [code, name] of cases) {
    const error = {code, message: `violates constraint "${name}"`, details: 'Private database row'};
    const handlers = createAvailabilityHandlers({async replace() { throw availabilityWriteFault(error); }}, quiet);
    const response = await handlers.replace(new Request('http://localhost/api/v1/technician/availability', {
      method: 'PUT', headers: {'content-type': 'application/json', origin: 'http://localhost', 'idempotency-key': key, 'x-skycar-account': account},
      body: JSON.stringify(command()),
    }));
    assert.equal(response.status, 400);
    const envelope = await response.json();
    assert.equal(envelope.error.code, 'VALIDATION_FAILED');
    assert.equal(envelope.error.retryable, false);
    assert.doesNotMatch(JSON.stringify(envelope), /constraint|Private database row|23514|23P01/);
  }
  for (const error of [
    {code: '23514', message: 'violates constraint "unrelated_check"'},
    {code: '23514', message: 'violates constraint "care_technician_availability_exception_windows_instant_order_other"'},
    {code: '23P01', message: 'violates constraint "unrelated_overlap"'},
    {code: '23505', message: 'duplicate key "care_technician_availability_windows_no_overlap"'},
    {code: '23514'},
    {code: 'P0001', message: 'Private unexpected error'},
  ]) {
    const fault = availabilityWriteFault(error);
    assert.equal(fault.status, 503);
    assert.equal(fault.retryable, true);
    assert.doesNotMatch(fault.message, /constraint|Private|duplicate/);
  }
  assert.equal(availabilityWriteFault({code: 'P0001', message: 'REVISION_CONFLICT'}).status, 409);
  assert.equal(availabilityWriteFault({code: 'P0001', message: 'FORBIDDEN'}).status, 403);
});
