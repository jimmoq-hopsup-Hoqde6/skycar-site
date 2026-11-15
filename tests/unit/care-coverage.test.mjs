import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCoverage, isPostcodeShape, normalisePostcode, readCoverageResponse } from '../../src/domain/care/coverage.ts';

const sent = { service: 'repair', postcode: '5000' };
const ok = coverage => ({ data: { service: 'repair', postcode: '5000', coverage }, meta: { requestId: 'r' } });
const err = code => ({ error: { code, message: 'x', fieldErrors: {}, retryable: false }, meta: { requestId: 'r' } });

test('postcode shape is exactly four digits after trimming', () => {
  assert.equal(normalisePostcode(' 5000 '), '5000');
  assert.equal(normalisePostcode(5000), '');
  for (const good of ['5000', '0800']) assert.equal(isPostcodeShape(good), true);
  for (const bad of ['', '500', '50000', '50a0', ' 5000', '５０００', null, undefined, 5000]) assert.equal(isPostcodeShape(bad), false, String(bad));
});

test('an exact matching decision maps to in_area or out_of_area', () => {
  assert.deepEqual(readCoverageResponse(200, ok('available'), sent), { kind: 'in_area', postcode: '5000' });
  assert.deepEqual(readCoverageResponse(200, ok('unavailable'), sent), { kind: 'out_of_area', postcode: '5000' });
});

test('anything that is not an exact matching decision is unknown, never in_area', () => {
  const unexpected = { kind: 'unknown', reason: 'unexpected' };
  assert.deepEqual(readCoverageResponse(200, ok('maybe'), sent), unexpected);
  assert.deepEqual(readCoverageResponse(200, { data: { ...ok('available').data, postcode: '5001' } }, sent), unexpected);
  assert.deepEqual(readCoverageResponse(200, { data: { ...ok('available').data, service: 'cleaning' } }, sent), unexpected);
  assert.deepEqual(readCoverageResponse(200, { data: { ...ok('available').data, extra: true } }, sent), unexpected);
  assert.deepEqual(readCoverageResponse(200, { data: { service: 'repair', postcode: '5000' } }, sent), unexpected);
  for (const body of [null, undefined, 'available', [], { data: null }, { data: [] }, {}]) assert.deepEqual(readCoverageResponse(200, body, sent), unexpected);
  assert.deepEqual(readCoverageResponse(204, null, sent), unexpected);
  assert.deepEqual(readCoverageResponse(403, err('FORBIDDEN'), sent), unexpected);
  assert.deepEqual(readCoverageResponse(413, err('PAYLOAD_TOO_LARGE'), sent), unexpected);
});

test('error responses map to invalid_input or unknown with the right reason', () => {
  assert.deepEqual(readCoverageResponse(400, err('VALIDATION_FAILED'), sent), { kind: 'invalid_input' });
  assert.deepEqual(readCoverageResponse(400, err('OTHER'), sent), { kind: 'unknown', reason: 'unexpected' });
  assert.deepEqual(readCoverageResponse(503, err('COVERAGE_UNAVAILABLE'), sent), { kind: 'unknown', reason: 'unavailable' });
  assert.deepEqual(readCoverageResponse(500, err('INTERNAL_ERROR'), sent), { kind: 'unknown', reason: 'unavailable' });
  assert.deepEqual(readCoverageResponse(503, null, sent), { kind: 'unknown', reason: 'unavailable' });
});

function fakeFetch(status, body, seen = []) {
  return async (url, init) => { seen.push({ url, init }); return { status, json: async () => { if (body === undefined) throw new SyntaxError('bad json'); return body; } }; };
}

test('checkCoverage posts exactly {service, postcode} to the coverage route', async () => {
  const seen = [];
  const outcome = await checkCoverage(sent, { fetchImpl: fakeFetch(200, ok('available'), seen) });
  assert.deepEqual(outcome, { kind: 'in_area', postcode: '5000' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/v1/care/coverage');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(seen[0].init.body), { service: 'repair', postcode: '5000' });
  assert.ok(seen[0].init.signal instanceof AbortSignal);
});

test('checkCoverage rejects a bad postcode locally without calling the server', async () => {
  const seen = [];
  assert.deepEqual(await checkCoverage({ service: 'repair', postcode: '50' }, { fetchImpl: fakeFetch(200, ok('available'), seen) }), { kind: 'invalid_input' });
  assert.equal(seen.length, 0);
});

test('checkCoverage reports network failure, timeout and unreadable bodies as unknown', async () => {
  assert.deepEqual(await checkCoverage(sent, { fetchImpl: async () => { throw new TypeError('offline'); } }), { kind: 'unknown', reason: 'network' });
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  assert.deepEqual(await checkCoverage(sent, { fetchImpl: hang, timeoutMs: 20 }), { kind: 'unknown', reason: 'network' });
  assert.deepEqual(await checkCoverage(sent, { fetchImpl: fakeFetch(200, undefined) }), { kind: 'unknown', reason: 'unexpected' });
  assert.deepEqual(await checkCoverage(sent, { fetchImpl: fakeFetch(503, err('COVERAGE_UNAVAILABLE')) }), { kind: 'unknown', reason: 'unavailable' });
});

test('there is no bypass: the module exposes no "continue anyway" policy', async () => {
  const coverageModule = await import('../../src/domain/care/coverage.ts');
  assert.equal('UNKNOWN_COVERAGE_POLICY' in coverageModule, false);
});
