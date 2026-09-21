import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_ROUTE_TEMPLATES,
  ApiFault,
  apiResult,
  withApiBoundary,
} from '../../src/server/http/api-boundary.mjs';

const requestId = '10000000-0000-4000-8000-000000000001';

function harness(handler, request = new Request('https://skycar.test/api/v1/health?secret=hidden', {
  headers: {
    cookie: 'session=private',
    authorization: 'Bearer secret',
    'x-request-id': '20000000-0000-4000-8000-000000000002',
  },
})) {
  const records = [];
  let tick = 100;
  const logger = {
    info: value => records.push(['info', value]),
    error: value => records.push(['error', value]),
  };
  return withApiBoundary(request, API_ROUTE_TEMPLATES.health, handler, {
    makeRequestId: () => requestId,
    now: () => (tick += 7),
    logger,
  }).then(response => ({ response, records }));
}

test('success uses the canonical envelope, server request ID and no-store response', async () => {
  const { response, records } = await harness(async context => ({ status: 'ok', requestIdSeen: context.requestId }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-request-id'), requestId);
  assert.deepEqual(await response.json(), {
    data: { status: 'ok', requestIdSeen: requestId },
    meta: { requestId },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0][0], 'info');
  assert.deepEqual(JSON.parse(records[0][1]), {
    event: 'api_request_completed', requestId, method: 'GET', route: '/api/v1/health',
    status: 200, code: 'OK', retryable: false, durationMs: 7,
  });
});

test('explicit success metadata cannot be confused with domain fields', async () => {
  const { response } = await harness(async () => apiResult({ status: 'queued', data: 'domain-value' }, {
    status: 201,
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/html',
      'X-Content-Type-Options': 'off',
      'X-Request-Id': 'client-controlled',
      'X-Skycar-Test': 'accepted',
    },
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-request-id'), requestId);
  assert.equal(response.headers.get('x-skycar-test'), 'accepted');
  assert.deepEqual((await response.json()).data, { status: 'queued', data: 'domain-value' });
});

test('known faults retain bounded public validation detail', async () => {
  const { response, records } = await harness(async () => {
    throw new ApiFault('VALIDATION_FAILED', 400, 'Check the highlighted fields.', {
      fieldErrors: { vehicle_id: 'Choose your vehicle.', '$invalid': 'drop', note: 'x'.repeat(400) },
      retryable: false,
    });
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(Object.keys(body.error.fieldErrors), ['vehicle_id', 'note']);
  assert.equal(body.error.fieldErrors.note.length, 240);
  assert.equal(records[0][0], 'info');
});

test('unexpected failures are redacted from both response and structured log', async () => {
  const { response, records } = await harness(async () => {
    throw new Error('database password, customer@example.test, provider payload');
  });
  const serialized = JSON.stringify(await response.json());
  assert.equal(response.status, 500);
  assert.match(serialized, /INTERNAL_ERROR/);
  assert.doesNotMatch(serialized, /password|customer@|provider payload/);
  assert.equal(records[0][0], 'error');
  assert.doesNotMatch(records[0][1], /hidden|session|Bearer|password|customer@|provider payload/);
  assert.deepEqual(Object.keys(JSON.parse(records[0][1])).sort(), [
    'code', 'durationMs', 'event', 'method', 'requestId', 'retryable', 'route', 'status',
  ]);
});

test('telemetry failures never replace the API response', async () => {
  const response = await withApiBoundary(
    new Request('https://skycar.test/api/v1/health'),
    API_ROUTE_TEMPLATES.health,
    async () => ({ status: 'ok' }),
    {
      makeRequestId: () => requestId,
      now: () => 1,
      logger: { info() { throw new Error('sink unavailable'); }, error() { throw new Error('sink unavailable'); } },
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'ok');
});

test('registered parameterised templates are safe to log', async () => {
  const records = [];
  const response = await withApiBoundary(
    new Request('https://skycar.test/api/v1/garage/vehicles/30000000-0000-4000-8000-000000000003/photo'),
    API_ROUTE_TEMPLATES.garageVehiclePhoto,
    async () => ({ status: 'ok' }),
    {
      makeRequestId: () => requestId,
      now: () => 1,
      logger: {
        info: value => records.push(value),
        error: value => records.push(value),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(JSON.parse(records[0]).route, '/api/v1/garage/vehicles/[vehicleId]/photo');
  assert.doesNotMatch(records[0], /30000000-0000-4000-8000-000000000003/);
});

test('unregistered literal and raw route values are rejected before execution', async () => {
  const rejectedRoutes = [
    '/api/v1/garage/vehicles/30000000-0000-4000-8000-000000000003/photo',
    '/api/v1/jobs/12345',
    '/api/v1/customers/customer@example.test',
    '/api/v1/jobs?customer=secret',
    'https://skycar.test/api/v1/health',
    '/api/v1/unreviewed-static-route',
  ];

  for (const route of rejectedRoutes) {
    let handlerCalled = false;
    await assert.rejects(
      () => withApiBoundary(
        new Request('https://skycar.test/api/v1/health'),
        route,
        async () => { handlerCalled = true; return {}; },
      ),
      /registered static route template/,
    );
    assert.equal(handlerCalled, false, `handler should not run for ${route}`);
  }
});
