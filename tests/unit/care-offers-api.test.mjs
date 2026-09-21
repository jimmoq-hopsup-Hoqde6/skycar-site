import test from "node:test";
import assert from "node:assert/strict";
import { CareError } from "../../src/domain/care/request.ts";
import { careOffers } from "../../src/domain/care/offers.ts";
import { careOfferHandlers } from "../../src/server/care/offers-http.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";
const slotId = "33333333-3333-4333-8333-333333333333";

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

test("owner-scoped offer handler returns private no-store response", async () => {
  const calls = [];
  const handlers = careOfferHandlers({
    enabled: () => true,
    connect: async () => ({
      list: async id => { calls.push(id); return raw; },
    }),
  });
  const response = await handlers.list(requestId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).data[0].id, offerId);
  assert.deepEqual(calls, [requestId]);
});

test("invalid IDs and auth errors never call or leak repository internals", async () => {
  let calls = 0;
  const invalid = careOfferHandlers({
    enabled: () => true,
    connect: async () => ({ list: async () => { calls++; return raw; } }),
  });
  assert.equal((await invalid.list("bad-id")).status, 400);
  assert.equal(calls, 0);

  const guest = careOfferHandlers({
    enabled: () => true,
    connect: async () => { throw new CareError("UNAUTHENTICATED"); },
  });
  assert.equal((await guest.list(requestId)).status, 401);

  const failed = careOfferHandlers({
    enabled: () => true,
    connect: async () => ({ list: async () => { throw new Error("secret"); } }),
  });
  const response = await failed.list(requestId);
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret/);
});
