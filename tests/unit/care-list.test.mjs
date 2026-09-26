import test from "node:test";
import assert from "node:assert/strict";
import { careListPage, careListQuery } from "../../src/domain/care/list.ts";
import { CareError } from "../../src/domain/care/request.ts";
import { careHandlers } from "../../src/server/care/http.ts";

const vehicle = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-20T13:00:00.123456Z";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const cursor = { v: 1, vehicle_id: vehicle, created_at: at, id };
const parse = params => careListQuery(new URLSearchParams(params));
const request = (params = {}) => new Request(`https://skycar.test/api/v1/care/requests?${new URLSearchParams(params)}`);

test("list defaults and strict bounded query fields", () => {
  assert.deepEqual(parse({}), { limit: 20, vehicle_id: null, before: null });
  assert.deepEqual(parse({ limit: "50", vehicle_id: vehicle.toUpperCase() }), { limit: 50, vehicle_id: vehicle, before: null });
  for (const params of [
    { limit: "0" }, { limit: "51" }, { limit: "-1" }, { limit: "1.5" }, { limit: "1e1" },
    { limit: "01" }, { limit: " 1" }, { limit: "" }, { limit: "+1" },
    { vehicle_id: "" }, { vehicle_id: "invalid" }, { owner_id: vehicle }, { status: "completed" },
    "limit=1&limit=2", `vehicle_id=${vehicle}&vehicle_id=${vehicle}`, "cursor=a&cursor=b",
    { cursor: "x".repeat(1025) },
  ]) assert.throws(() => parse(params), /VALIDATION_FAILED/);
});

test("cursor round-trip preserves microseconds and filter and permits a different page size", () => {
  const query = parse({ limit: "1", vehicle_id: vehicle });
  const response = careListPage({ items: [], evaluated_at: at, next_position: { created_at: at, id } }, query);
  assert.deepEqual(parse({ cursor: response.next_cursor, vehicle_id: vehicle, limit: "25" }), {
    limit: 25, vehicle_id: vehicle, before: { created_at: at, id },
  });
  assert.equal(response.evaluated_at, at);
  assert.equal(response.next_position, undefined);
  const unfiltered = careListPage({ items: [], evaluated_at: at, next_position: { created_at: at, id } }, parse({}));
  assert.equal(parse({ cursor: unfiltered.next_cursor }).before.created_at, at);
  assert.throws(() => parse({ cursor: response.next_cursor }), /VALIDATION_FAILED/);
  assert.throws(() => parse({ cursor: response.next_cursor, vehicle_id: id }), /VALIDATION_FAILED/);
  assert.throws(() => parse({ cursor: unfiltered.next_cursor, vehicle_id: vehicle }), /VALIDATION_FAILED/);
});

test("reject malformed, noncanonical, invalid-date and unsupported cursors", () => {
  const invalid = ["", "%%%", "a", "x".repeat(513), "_w", encode(cursor) + "=", encode(null), encode([]), encode({}),
    encode({ ...cursor, v: 2 }), encode({ ...cursor, id: "bad" }), encode({ ...cursor, owner: id }),
    ...["infinity", "0000-01-01T00:00:00.000000Z", "2026-02-30T13:00:00.123456Z", "2026-09-20T25:00:00.123456Z",
      "2026-09-20T13:00:00.123Z", "2026-09-20T13:00:00.123456+00:00", 123, null]
      .map(created_at => encode({ ...cursor, created_at })),
  ];
  for (const value of invalid) assert.throws(() => parse({ cursor: value, vehicle_id: vehicle }), /VALIDATION_FAILED/);
});

test("empty and final pages have no cursor and preserve authoritative summary data", async () => {
  for (const items of [[], [{ id, customer_stage: "request_received", is_overdue: true, money_state: null }]]) {
    let observed;
    const handlers = careHandlers({ enabled: () => true, connect: async () => ({
      list: async query => { observed = query; return { items, evaluated_at: at, next_position: null }; },
    }) });
    const response = await handlers.list(request({ vehicle_id: vehicle }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.deepEqual(observed, { limit: 20, vehicle_id: vehicle, before: null });
    const body = await response.json();
    assert.deepEqual(body.data, { items, next_cursor: null, evaluated_at: at });
    assert.ok(body.meta.requestId);
  }
});

test("invalid list queries do not reach the repository", async () => {
  let calls = 0;
  const handlers = careHandlers({ enabled: () => true, connect: async () => ({ list: async () => { calls++; } }) });
  for (const params of [{ owner_id: vehicle }, { limit: "0" }, { cursor: "invalid" }]) {
    assert.equal((await handlers.list(request(params))).status, 400);
  }
  assert.equal(calls, 0);
});

test("list disabled, unauthenticated and noncustomer access fail closed", async () => {
  let connections = 0;
  const handlers = careHandlers({ enabled: () => false, connect: async () => { connections++; } });
  assert.equal((await handlers.list(request())).status, 503);
  assert.equal(connections, 0);
  const guest = careHandlers({ enabled: () => true, connect: async () => { throw new CareError("UNAUTHENTICATED"); } });
  assert.equal((await guest.list(request())).status, 401);
  const technician = careHandlers({ enabled: () => true, connect: async () => ({ list: async () => { throw new CareError("FORBIDDEN"); } }) });
  assert.equal((await technician.list(request())).status, 403);
});

test("foreign/missing vehicle and database failure remain explicit private errors", async () => {
  for (const [error, status, code] of [
    [new CareError("NOT_FOUND"), 404, "NOT_FOUND"],
    [new CareError("TEMPORARILY_UNAVAILABLE"), 503, "TEMPORARILY_UNAVAILABLE"],
    [new Error("sensitive SQL provider detail"), 500, "INTERNAL_ERROR"],
  ]) {
    const handlers = careHandlers({ enabled: () => true, connect: async () => ({ list: async () => { throw error; } }) });
    const response = await handlers.list(request());
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.data, undefined);
    assert.equal(body.error.code, code);
    assert.doesNotMatch(JSON.stringify(body), /sensitive SQL provider/);
  }
});
