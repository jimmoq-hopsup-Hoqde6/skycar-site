import { Buffer } from "node:buffer";
import { CareError, object, uuid } from "./request.ts";
import type { CareReceipt } from "./request.ts";

export type CareListPosition = { created_at: string; id: string };
export type CareListQuery = {
  limit: number;
  vehicle_id: string | null;
  before: CareListPosition | null;
};
export type CareRequestSummary = Omit<CareReceipt, "description" | "preferred_window" | "events"> & {
  vehicle_archived: boolean;
  is_overdue: boolean;
};
export type CareListRows = {
  items: CareRequestSummary[];
  next_position: CareListPosition | null;
  evaluated_at: string;
};

// Keep the original six fractional digits: JavaScript Date loses microseconds.
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) {
    throw new CareError("VALIDATION_FAILED");
  }
  const parsed = new Date(value);
  if (value.startsWith("0000-") || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 23) !== value.slice(0, 23)) {
    throw new CareError("VALIDATION_FAILED");
  }
  return value;
}

export function careListQuery(params: URLSearchParams): CareListQuery {
  if (params.toString().length > 1024) throw new CareError("VALIDATION_FAILED");
  for (const key of params.keys()) {
    if (!["limit", "vehicle_id", "cursor"].includes(key) || params.getAll(key).length !== 1) {
      throw new CareError("VALIDATION_FAILED");
    }
  }
  const rawLimit = params.get("limit");
  if (rawLimit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)) throw new CareError("VALIDATION_FAILED");
  const vehicle = params.has("vehicle_id") ? uuid(params.get("vehicle_id")) : null;
  const result: CareListQuery = { limit: rawLimit === null ? 20 : Number(rawLimit), vehicle_id: vehicle, before: null };
  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    try {
      if (rawCursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new CareError("VALIDATION_FAILED");
      const bytes = Buffer.from(rawCursor, "base64url");
      if (bytes.toString("base64url") !== rawCursor) throw new CareError("VALIDATION_FAILED");
      const cursor = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      const fields = ["v", "vehicle_id", "created_at", "id"];
      if (cursor.v !== 1 || Object.keys(cursor).length !== fields.length ||
        Object.keys(cursor).some(key => !fields.includes(key)) || cursor.vehicle_id !== vehicle) {
        throw new CareError("VALIDATION_FAILED");
      }
      result.before = { created_at: timestamp(cursor.created_at), id: uuid(cursor.id) };
    } catch { throw new CareError("VALIDATION_FAILED"); }
  }
  return result;
}

export function careListPage(rows: CareListRows, query: CareListQuery) {
  return {
    items: rows.items,
    next_cursor: rows.next_position === null ? null : Buffer.from(JSON.stringify({
      v: 1, vehicle_id: query.vehicle_id, ...rows.next_position,
    })).toString("base64url"),
    evaluated_at: rows.evaluated_at,
  };
}
