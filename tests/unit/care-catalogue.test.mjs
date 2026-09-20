import test from "node:test";
import assert from "node:assert/strict";
import {
  CARE_SERVICES,
  CareCatalogueError,
  coverageInput,
} from "../../src/domain/care/catalogue.ts";
import { careCatalogueHandlers } from "../../src/server/care/catalogue-http.ts";

const valid = { service: "repair", postcode: "5000" };
const request = (body = valid, headers = {}) => new Request("https://skycar.test/api/v1/care/coverage", {
  method: "POST",
  headers: { origin: "https://skycar.test", "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

function setup(resolveCoverage = async () => "available") {
  const calls = [];
  const handlers = careCatalogueHandlers({
    services: CARE_SERVICES,
    resolveCoverage: async input => { calls.push(input); return resolveCoverage(input); },
  });
  return { calls, handlers };
}

test("catalogue is immutable, public and limited to approved services", async () => {
  assert.ok(Object.isFrozen(CARE_SERVICES));
  assert.ok(CARE_SERVICES.every(Object.isFrozen));
  const { handlers, calls } = setup();
  const response = await handlers.list();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=60");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.deepEqual(body.data.services, [
    { id: "repair", name: "Scratch & dent repair" },
    { id: "cleaning", name: "Detailing & cleaning" },
  ]);
  assert.ok(body.meta.requestId);
  assert.equal(calls.length, 0);
  assert.doesNotMatch(JSON.stringify(body), /price|provider|appointment|payment/i);
});

test("coverage input accepts only an approved service and exact postcode", () => {
  assert.deepEqual(coverageInput(valid), valid);
  for (const body of [
    null,
    [],
    {},
    { ...valid, service: "sale_ready" },
    { ...valid, postcode: 5000 },
    { ...valid, postcode: "500" },
    { ...valid, postcode: " 5000" },
    { ...valid, postcode: "５０００" },
    { ...valid, owner_id: "injected" },
  ]) assert.throws(() => coverageInput(body), /VALIDATION_FAILED/);
});

for (const decision of ["available", "unavailable"]) {
  test(`returns only an authoritative ${decision} decision`, async () => {
    const { handlers, calls } = setup(async () => decision);
    const response = await handlers.check(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body.data, { ...valid, coverage: decision });
    assert.deepEqual(calls, [valid]);
    assert.ok(body.meta.requestId);
  });
}

for (const [label, body, headers, status] of [
  ["cross origin", valid, { origin: "https://evil.test" }, 403],
  ["null origin", valid, { origin: "null" }, 403],
  ["missing origin", valid, { origin: "" }, 403],
  ["non-json", valid, { "content-type": "text/plain" }, 415],
  ["bad JSON", "{", {}, 400],
  ["unsupported service", { ...valid, service: "other" }, {}, 400],
  ["unknown fields", { ...valid, available: true }, {}, 400],
  ["oversized streamed body", " ".repeat(1025), { "content-length": "1" }, 413],
]) {
  test(`rejects ${label} before coverage resolution`, async () => {
    const { handlers, calls } = setup();
    assert.equal((await handlers.check(request(body, headers))).status, status);
    assert.equal(calls.length, 0);
  });
}

for (const [label, resolver] of [
  ["explicit unavailability", async () => { throw new CareCatalogueError("COVERAGE_UNAVAILABLE"); }],
  ["generic timeout or exception", async () => { throw new Error("secret provider timeout details"); }],
  ["malformed decision", async () => "maybe"],
]) {
  test(`resolver ${label} is one retryable unavailable contract`, async () => {
    const { handlers } = setup(resolver);
    const response = await handlers.check(request());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.deepEqual(body.error, {
      code: "COVERAGE_UNAVAILABLE",
      message: "Coverage cannot be confirmed right now.",
      fieldErrors: {},
      retryable: true,
    });
    assert.equal(body.data, undefined);
    assert.doesNotMatch(JSON.stringify(body), /secret|provider|timeout|maybe/);
  });
}

test("unexpected failures outside the resolver boundary remain redacted 500", async () => {
  const { handlers, calls } = setup();
  const response = await handlers.check({
    headers: { get: () => "https://skycar.test" },
    get url() { throw new Error("secret framework failure"); },
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.retryable, false);
  assert.doesNotMatch(JSON.stringify(body), /secret|framework failure/);
  assert.equal(calls.length, 0);
});
