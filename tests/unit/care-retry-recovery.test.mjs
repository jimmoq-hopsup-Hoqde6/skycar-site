import test from "node:test";
import assert from "node:assert/strict";
import { clearPendingCareRetry, readPendingCareRetry, savePendingCareRetry } from "../../src/domain/care/retry-recovery.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const retryKey = "22222222-2222-4222-8222-222222222222";

class MemoryStore {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test("persists and clears only the request retry identifier", () => {
  const store = new MemoryStore();
  assert.equal(savePendingCareRetry(store, requestId.toUpperCase(), retryKey.toUpperCase()), true);
  assert.equal(readPendingCareRetry(store, requestId), retryKey);
  const saved = [...store.values.values()][0];
  assert.doesNotMatch(saved, /description|vehicle|session|owner/);
  clearPendingCareRetry(store, requestId);
  assert.equal(readPendingCareRetry(store, requestId), null);
});

test("malformed, mismatched and expanded stored values fail closed and are removed", () => {
  for (const value of [
    "not-json",
    JSON.stringify({ v: 1, request_id: requestId, idempotency_key: "bad", started_at: new Date().toISOString() }),
    JSON.stringify({ v: 1, request_id: retryKey, idempotency_key: retryKey, started_at: new Date().toISOString() }),
    JSON.stringify({ v: 1, request_id: requestId, idempotency_key: retryKey, started_at: "bad" }),
    JSON.stringify({ v: 1, request_id: requestId, idempotency_key: retryKey, started_at: new Date().toISOString(), description: "must not be stored" }),
  ]) {
    const store = new MemoryStore();
    store.setItem(`skycar:care-retry:v1:${requestId}`, value);
    assert.equal(readPendingCareRetry(store, requestId), null);
    assert.equal(store.values.size, 0);
  }
});

test("unavailable storage degrades without exposing or inventing recovery", () => {
  const store = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  assert.equal(savePendingCareRetry(store, requestId, retryKey), false);
  assert.equal(readPendingCareRetry(store, requestId), null);
  assert.doesNotThrow(() => clearPendingCareRetry(store, requestId));
  assert.equal(savePendingCareRetry(new MemoryStore(), "bad", retryKey), false);
});
