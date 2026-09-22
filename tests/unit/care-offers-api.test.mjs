import test from "node:test";
import assert from "node:assert/strict";
import { CareError } from "../../src/domain/care/request.ts";
import { careOffers } from "../../src/domain/care/offers.ts";
import { careOfferHandlers } from "../../src/server/care/offers-http.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";
const slotId = "33333333-3333-4333-8333-333333333333";
const vehicleId = "44444444-4444-4444-8444-444444444444";
const technicianId = "55555555-5555-4555-8555-555555555555";
const boundaryRequestId = "66666666-6666-4666-8666-666666666666";

function request() {
  return new Request(`https://skycar.test/api/v1/care/requests/${requestId}/offers?vehicle=${vehicleId}&technician=${technicianId}`, {
    headers: { cookie: "session=private", authorization: "Bearer private" },
  });
}

const raw = [{
  id: offerId,
  request_id: requestId,
  scope_summary: "Repair and refinish rear bumper scratch",
  total_price_cents: 49500,
  currency: "AUD",
  adjustment_reason: null,
  status: "issued",
  expires_at: "2026-09-24T06:00:00Z",
  created_at: "2026-09-22T00:30:00Z",
  updated_at: "2026-09-22T00:30:00Z",
  slots: [{
    id: slotId,
    starts_at: "2026-09-23T00:30:00Z",
    ends_at: "2026-09-23T03:30:00Z",
    status: "available",
    created_at: "2026-09-22T00:30:00Z",
  }],
}];

test("validates and returns customer-safe technician offers", () => {
  const parsed = careOffers(raw);
  assert.equal(parsed[0].total_price_cents, 49500);
  assert.equal(parsed[0].slots[0].id, slotId);
  assert.equal("technician_id" in parsed[0], false);
});

for (const invalid of [
  null,
  {},
  [{ ...raw[0], currency: "USD" }],
  [{ ...raw[0], status: "accepted" }],
  [{ ...raw[0], total_price_cents: 0 }],
  [{ ...raw[0], slots: [{ ...raw[0].slots[0], ends_at: raw[0].slots[0].starts_at }] }],
]) {
  test("fails closed on malformed offer payload", () => {
    assert.throws(() => careOffers(invalid), /TEMPORARILY_UNAVAILABLE|VALIDATION_FAILED/);
  });
}

test("owner-scoped offer handler uses one redacted shared-boundary completion event", async () => {
  const calls = [];
  const records = [];
  const handlers = careOfferHandlers({
    enabled: () => true,
    connect: async () => ({
      list: async id => { calls.push(id); return raw; },
    }),
  }, {
    makeRequestId: () => boundaryRequestId,
    now: () => 100,
    logger: { info: entry => records.push(entry), error: entry => records.push(entry) },
  });
  const response = await handlers.list(request(), requestId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-request-id"), boundaryRequestId);
  const body = await response.json();
  assert.equal(body.meta.requestId, boundaryRequestId);
  assert.equal(body.data[0].id, offerId);
  assert.deepEqual(calls, [requestId]);
  assert.equal(records.length, 1);
  assert.deepEqual(JSON.parse(records[0]), {
    event: "api_request_completed",
    requestId: boundaryRequestId,
    method: "GET",
    route: "/api/v1/care/requests/[requestId]/offers",
    status: 200,
    code: "OK",
    retryable: false,
    durationMs: 0,
  });
  assert.doesNotMatch(records[0], new RegExp(`${requestId}|${vehicleId}|${technicianId}|session=|Bearer`));
});

test("invalid IDs and expected Care failures preserve status, code and retry semantics", async () => {
  let calls = 0;
  const invalid = careOfferHandlers({
    enabled: () => true,
    connect: async () => ({ list: async () => { calls++; return raw; } }),
  });
  let response = await invalid.list(request(), "bad-id");
  assert.equal(response.status, 400);
  assert.deepEqual((await response.json()).error, {
    code: "VALIDATION_FAILED",
    message: "Check the request details.",
    fieldErrors: {},
    retryable: false,
  });
  assert.equal(calls, 0);

  for (const [code, status, retryable] of [
    ["UNAUTHENTICATED", 401, false],
    ["NOT_FOUND", 404, false],
    ["TEMPORARILY_UNAVAILABLE", 503, true],
  ]) {
    const failed = careOfferHandlers({
      enabled: () => true,
      connect: async () => ({ list: async () => { throw new CareError(code); } }),
    });
    response = await failed.list(request(), requestId);
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.error.code, code);
    assert.equal(body.error.retryable, retryable);
  }

  const disabled = careOfferHandlers({ enabled: () => false, connect: async () => { throw new Error("must not connect"); } });
  response = await disabled.list(request(), requestId);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "CARE_UNAVAILABLE");
});

test("unexpected failures are redacted and a failing log sink cannot alter the response", async () => {
  const records = [];
  const failed = careOfferHandlers({
    enabled: () => true,
    connect: async () => ({ list: async () => { throw new Error(`database secret ${requestId} ${technicianId}`); } }),
  }, {
    makeRequestId: () => boundaryRequestId,
    now: () => 100,
    logger: { info: entry => records.push(entry), error: entry => records.push(entry) },
  });
  let response = await failed.list(request(), requestId);
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), new RegExp(`secret|${requestId}|${technicianId}`));
  assert.equal(records.length, 1);
  assert.doesNotMatch(records[0], new RegExp(`secret|${requestId}|${vehicleId}|${technicianId}|session=|Bearer`));

  const successful = careOfferHandlers({
    enabled: () => true,
    connect: async () => ({ list: async () => raw }),
  }, {
    makeRequestId: () => boundaryRequestId,
    now: () => 100,
    logger: { info() { throw new Error("sink unavailable"); }, error() { throw new Error("sink unavailable"); } },
  });
  response = await successful.list(request(), requestId);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].id, offerId);
});
