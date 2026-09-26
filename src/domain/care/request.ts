export type CareInput = {
  vehicle_id: string;
  service: "repair" | "cleaning";
  description: string;
  preferred_window: "one_to_two_business_days" | "seven_to_fourteen_days" | "flexible";
};

export type CareEvent = {
  id: string;
  sequence: number;
  type: "request_received" | "response_overdue" | "no_match" | "request_reopened";
  occurred_at: string;
};

export type CareReceipt = CareInput & {
  id: string;
  quote_state: "draft" | "in_review" | "issued" | "accepted" | "declined" | "expired" | "superseded";
  assignment_state: "none" | "offered" | "reserved" | "accepted" | "cancelled" | "expired";
  fulfilment_state: "scheduled" | "ready" | "in_progress" | "paused" | "completed" | "validated" | "closed" | null;
  money_state: null;
  customer_stage: "request_received" | "delayed" | "no_match";
  next_action: "review_request" | "review_overdue_request" | "choose_recovery";
  responsible_role: "operations" | "customer";
  created_at: string;
  updated_at: string;
  next_update_at: string | null;
  events: CareEvent[];
};

export class CareError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new CareError("VALIDATION_FAILED");
  }
  return value.toLowerCase();
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CareError("VALIDATION_FAILED");
  return value as Record<string, unknown>;
}

export function careInput(value: unknown): CareInput {
  const input = object(value);
  const fields = ["vehicle_id", "service", "description", "preferred_window"];
  if (Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))) {
    throw new CareError("VALIDATION_FAILED");
  }
  const vehicle_id = uuid(input.vehicle_id);
  if (input.service !== "repair" && input.service !== "cleaning") throw new CareError("VALIDATION_FAILED");
  // Match PostgreSQL btrim(text): normalize ordinary leading/trailing spaces.
  if (typeof input.description !== "string") throw new CareError("VALIDATION_FAILED");
  const description = input.description.replace(/^ +| +$/g, "");
  if ([...description].length < 10 || [...description].length > 2000 || description.includes("\u0000")) {
    throw new CareError("VALIDATION_FAILED");
  }
  const preferred_window = input.preferred_window;
  if (preferred_window !== "one_to_two_business_days" && preferred_window !== "seven_to_fourteen_days" && preferred_window !== "flexible") {
    throw new CareError("VALIDATION_FAILED");
  }
  return { vehicle_id, service: input.service, description, preferred_window };
}
