type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prefix = "skycar:care-retry:v1:";

function storageKey(requestId: string) {
  return `${prefix}${requestId.toLowerCase()}`;
}

export function readPendingCareRetry(store: SessionStore, requestId: string): string | null {
  if (!uuid.test(requestId)) return null;
  const key = storageKey(requestId);
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || value.v !== 1 || value.request_id !== requestId.toLowerCase()
      || typeof value.idempotency_key !== "string" || !uuid.test(value.idempotency_key)
      || typeof value.started_at !== "string" || !Number.isFinite(Date.parse(value.started_at))
      || Object.keys(value).some(field => !["v", "request_id", "idempotency_key", "started_at"].includes(field))) {
      store.removeItem(key);
      return null;
    }
    return value.idempotency_key.toLowerCase();
  } catch {
    try { store.removeItem(key); } catch {}
    return null;
  }
}

export function savePendingCareRetry(store: SessionStore, requestId: string, idempotencyKey: string): boolean {
  if (!uuid.test(requestId) || !uuid.test(idempotencyKey)) return false;
  try {
    store.setItem(storageKey(requestId), JSON.stringify({
      v: 1,
      request_id: requestId.toLowerCase(),
      idempotency_key: idempotencyKey.toLowerCase(),
      started_at: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingCareRetry(store: SessionStore, requestId: string) {
  if (!uuid.test(requestId)) return;
  try { store.removeItem(storageKey(requestId)); } catch {}
}
