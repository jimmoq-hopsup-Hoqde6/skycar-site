import test from "node:test";
import assert from "node:assert/strict";
import { careInput, CareError, uuid } from "../../src/domain/care/request.ts";
import { careHandlers } from "../../src/server/care/http.ts";

const id = "11111111-1111-4111-8111-111111111111";
const input = { vehicle_id: id, service: "repair", description: "Scratch on rear bumper", preferred_window: "flexible" };
const request = (body = input, headers = {}) => new Request("https://skycar.test/api/v1/care/requests", {
  method: "POST", headers: { origin: "https://skycar.test", "content-type": "application/json", "idempotency-key": id, ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
function setup(overrides = {}) {
  const calls = [];
  const repo = {
    submit: async (...args) => { calls.push(args); return { request: { id }, replayed: false }; },
    get: async (...args) => { calls.push(args); return { id }; },
    retry: async (...args) => { calls.push(args); return { request: { id }, replayed: false }; },
    ...overrides,
  };
  return { calls, handlers: careHandlers({ enabled: () => true, connect: async () => repo }) };
}

test("strict normalized input rejects authoritative client fields and malformed data", () => {
  assert.deepEqual(careInput({ ...input, description: "  Scratch on rear bumper  " }), input);
  for (const field of ["owner_id", "quote_state", "price", "role", "next_update_at", "media_ids"]) {
    assert.throws(() => careInput({ ...input, [field]: "injected" }), /VALIDATION_FAILED/);
  }
  for (const body of [null, [], {}, { ...input, vehicle_id: "invalid" }, { ...input, service: "magic" },
    { ...input, description: "short" }, { ...input, description: "x".repeat(2001) },
    { ...input, description: "null\u0000character" }, { ...input, preferred_window: "confirmed" }]) {
    assert.throws(() => careInput(body), /VALIDATION_FAILED/);
  }
  assert.equal(uuid(id.toUpperCase()), id);
});

test("201 durable receipt and 200 replay include request id and private no-store", async () => {
  const { handlers, calls } = setup();
  const response = await handlers.submit(request());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal((await response.json()).data.request.id, id);
  assert.deepEqual(calls, [[id, input]]);
  const replay = setup({ submit: async () => ({ request: { id }, replayed: true }) });
  const r = await replay.handlers.submit(request());
  assert.equal(r.status, 200);
  assert.ok((await r.json()).meta.requestId);
});

for (const [label, body, headers, status] of [
  ["cross origin", input, { origin: "https://evil.test" }, 403],
  ["null origin", input, { origin: "null" }, 403],
  ["missing origin", input, { origin: "" }, 403],
  ["non-json", input, { "content-type": "text/plain" }, 415],
  ["bad JSON", "{", {}, 400],
  ["missing key", input, { "idempotency-key": "" }, 400],
  ["untrusted state", { ...input, assignment_state: "accepted" }, {}, 400],
  ["oversized streamed body", " ".repeat(16385), { "content-length": "1" }, 413],
]) {
  test(`reject ${label} before repository mutation`, async () => {
    const { handlers, calls } = setup();
    assert.equal((await handlers.submit(request(body, headers))).status, status);
    assert.equal(calls.length, 0);
  });
}

test("feature gate and unverified session prevent any repository work", async () => {
  let count = 0;
  const disabled = careHandlers({ enabled: () => false, connect: async () => { count++; throw Error("unexpected"); } });
  assert.equal((await disabled.submit(request())).status, 503);
  assert.equal(count, 0);
  const guest = careHandlers({ enabled: () => true, connect: async () => { throw new CareError("UNAUTHENTICATED"); } });
  assert.equal((await guest.get(id)).status, 401);
});

test("read and explicit retry contract reject bad identifiers and non-empty bodies", async () => {
  const { handlers, calls } = setup();
  assert.equal((await handlers.get("not-an-id")).status, 400);
  assert.equal((await handlers.get(id)).status, 200);
  assert.equal((await handlers.retry(request({}), id)).status, 200);
  assert.equal((await handlers.retry(request({ status: "received" }), id)).status, 400);
  assert.deepEqual(calls, [[id], [id, id]]);
});

for (const [code, status] of [["NOT_FOUND", 404], ["FORBIDDEN", 403], ["IDEMPOTENCY_CONFLICT", 409], ["INVALID_TRANSITION", 409], ["POLICY_UNAVAILABLE", 503], ["TEMPORARILY_UNAVAILABLE", 503]]) {
  test(`maps ${code} without leaking internals`, async () => {
    const { handlers } = setup({ submit: async () => { throw new CareError(code); } });
    const response = await handlers.submit(request());
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(body.error.retryable, code === "TEMPORARILY_UNAVAILABLE");
  });
}

test("unexpected errors are redacted and never claim success", async () => {
  const { handlers } = setup({ submit: async () => { throw new Error("secret database connection details"); } });
  const response = await handlers.submit(request());
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret|database connection/);
});
