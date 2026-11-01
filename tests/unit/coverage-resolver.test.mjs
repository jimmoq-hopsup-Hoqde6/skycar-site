import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../../src/server/care/coverage-areas.json' with { type: 'json' };
import { buildCoverageIndex, createCoverageResolver } from '../../src/server/care/coverage-resolver.ts';
import { careCatalogueHandlers } from '../../src/server/care/catalogue-http.ts';
import { CARE_SERVICES, CareCatalogueError } from '../../src/domain/care/catalogue.ts';

const resolve = createCoverageResolver(data);
const ask = (postcode, service = 'repair') => resolve({ service, postcode });
const clone = () => structuredClone(data);
const row = (copy, postcode) => copy.candidates.find(item => item.postcode === postcode);

test('data file carries its source, retrieval date and rule', () => {
  assert.match(data.source.datasetUrl, /^https:\/\/data\.gov\.au\//);
  assert.match(data.source.downloadUrl, /^https:\/\//);
  assert.match(data.source.retrievedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(data.source.zipSha256, /^[0-9a-f]{64}$/);
  assert.equal(data.rule.threshold, 0.5);
  assert.ok(data.rule.text.includes('4GADE') && data.rule.text.includes('40120') && data.rule.text.includes('44550'));
});

test('every included postcode is re-derivable from the stored ABS ratios (no hand-picked codes)', () => {
  const t = data.rule.threshold;
  const codes = data.candidates.map(item => item.postcode);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(codes, [...codes].sort());
  for (const item of data.candidates) {
    assert.match(item.postcode, /^[0-9]{4}$/);
    const derived = item.gccsa_greater_adelaide >= t || item.lga_adelaide_hills + item.lga_mount_barker >= t;
    assert.equal(item.included, derived, item.postcode);
  }
  assert.equal(data.candidates.filter(item => item.included).length, 147);
});

test('in area: metro and Hills postcodes are available for both services', async () => {
  for (const postcode of ['5000', '5006', '5152', '5251', '5245', '5134']) {
    assert.equal(await ask(postcode, 'repair'), 'available', postcode);
    assert.equal(await ask(postcode, 'cleaning'), 'available', postcode);
  }
});

test('out of area: other places in SA and interstate are unavailable (a completed decision, not an error)', async () => {
  for (const postcode of ['5290', '5700', '5600', '3000', '2000', '0800', '5999']) assert.equal(await ask(postcode), 'unavailable', postcode);
});

test('borderline postcodes follow the documented rule', async () => {
  // Mostly inside Greater Adelaide / the named Hills councils: included.
  for (const postcode of ['5153', '5157', '5172', '5174', '5201', '5244', '5371', '5501']) {
    assert.ok(row(data, postcode).included, postcode);
    assert.equal(await ask(postcode), 'available', postcode);
  }
  // Touch Greater Adelaide or a Hills council only slightly: excluded.
  for (const postcode of ['5235', '5254', '5351', '5400']) {
    assert.ok(row(data, postcode), `${postcode} is a reviewed candidate`);
    assert.equal(row(data, postcode).included, false, postcode);
    assert.equal(await ask(postcode), 'unavailable', postcode);
  }
});

test('the resolver follows the data: flipping a ratio flips the answer, a hand-edited flag fails closed', async () => {
  const copy = clone();
  row(copy, '5000').gccsa_greater_adelaide = 0.1; row(copy, '5000').included = false;
  assert.equal(await createCoverageResolver(copy)({ service: 'repair', postcode: '5000' }), 'unavailable');
  const edited = clone(); row(edited, '5235').included = true;
  await assert.rejects(createCoverageResolver(edited)({ service: 'repair', postcode: '5000' }), { code: 'COVERAGE_UNAVAILABLE' });
});

test('unreadable, empty or inconsistent data is COVERAGE_UNAVAILABLE, never "out of area"', async () => {
  const empty = clone(); empty.candidates = [];
  const none = clone(); none.candidates = none.candidates.map(item => ({ ...item, gccsa_greater_adelaide: 0, lga_adelaide_hills: 0, lga_mount_barker: 0, included: false }));
  const dup = clone(); dup.candidates.push({ ...dup.candidates[0] });
  const badCode = clone(); badCode.candidates[0].postcode = '50';
  const badRatio = clone(); badRatio.candidates[0].gccsa_greater_adelaide = 'x';
  const badThreshold = clone(); badThreshold.rule.threshold = 0;
  const noServices = clone(); noServices.services = {};
  const wrongArea = clone(); wrongArea.services.repair = ['somewhere-else'];
  for (const [name, bad] of Object.entries({ empty, none, dup, badCode, badRatio, badThreshold, noServices, wrongArea, nullData: null, array: [], text: 'x' })) {
    await assert.rejects(createCoverageResolver(bad)({ service: 'cleaning', postcode: '5000' }), error => error instanceof CareCatalogueError && error.code === 'COVERAGE_UNAVAILABLE', name);
  }
  const unknownService = clone(); delete unknownService.services.cleaning;
  assert.equal(await createCoverageResolver(unknownService)({ service: 'repair', postcode: '5000' }), 'available');
  await assert.rejects(createCoverageResolver(unknownService)({ service: 'cleaning', postcode: '5000' }), { code: 'COVERAGE_UNAVAILABLE' });
  assert.throws(() => buildCoverageIndex(undefined), { code: 'COVERAGE_UNAVAILABLE' });
});

test('through the existing route handler: 200 available, 200 unavailable, 400 invalid, 503 when data is unusable', async () => {
  const post = (handlers, body) => handlers.check(new Request('https://skycar.test/api/v1/care/coverage', { method: 'POST', headers: { origin: 'https://skycar.test', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const handlers = careCatalogueHandlers({ services: CARE_SERVICES, resolveCoverage: resolve });
  let response = await post(handlers, { service: 'repair', postcode: '5000' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { service: 'repair', postcode: '5000', coverage: 'available' });
  response = await post(handlers, { service: 'cleaning', postcode: '5700' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { service: 'cleaning', postcode: '5700', coverage: 'unavailable' });
  for (const body of [{ service: 'repair', postcode: '50' }, { service: 'repair', postcode: '5000 ' }, { service: 'tow', postcode: '5000' }]) assert.equal((await post(handlers, body)).status, 400);
  const broken = careCatalogueHandlers({ services: CARE_SERVICES, resolveCoverage: createCoverageResolver({ candidates: [] }) });
  response = await post(broken, { service: 'repair', postcode: '5000' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'COVERAGE_UNAVAILABLE');
});
