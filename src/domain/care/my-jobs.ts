import type { CareRequestSummary } from "./list.ts";

export type CareJobsPage = {
  items: CareRequestSummary[];
  next_cursor: string | null;
  evaluated_at: string;
};

const stages = new Set(["request_received", "delayed", "no_match"]);
const actions = new Set(["review_request", "review_overdue_request", "choose_recovery"]);
const roles = new Set(["operations", "customer"]);
const quoteStates = new Set(["draft", "in_review", "issued", "accepted", "declined", "expired", "superseded"]);
const assignmentStates = new Set(["none", "offered", "reserved", "accepted", "cancelled", "expired"]);
const fulfilmentStates = new Set(["scheduled", "ready", "in_progress", "paused", "completed", "validated", "closed"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function readCareJobsPage(value: unknown): CareJobsPage {
  const page = value as CareJobsPage | null;
  if (!page || !Array.isArray(page.items) || !validDate(page.evaluated_at)
    || !(page.next_cursor === null || (typeof page.next_cursor === "string" && page.next_cursor.length > 0 && page.next_cursor.length <= 512))) {
    throw new Error("Unsupported jobs response");
  }
  for (const item of page.items) {
    if (!item || typeof item.id !== "string" || !uuid.test(item.id) || typeof item.vehicle_id !== "string" || !uuid.test(item.vehicle_id)
      || typeof item.vehicle_archived !== "boolean" || !["repair", "cleaning"].includes(item.service)
      || !stages.has(item.customer_stage) || !actions.has(item.next_action)
      || !roles.has(item.responsible_role) || typeof item.is_overdue !== "boolean"
      || !validDate(item.created_at) || !validDate(item.updated_at)
      || !(item.next_update_at === null || validDate(item.next_update_at))
      || !quoteStates.has(item.quote_state) || !assignmentStates.has(item.assignment_state)
      || !(item.fulfilment_state === null || fulfilmentStates.has(item.fulfilment_state)) || item.money_state !== null
      || (item.customer_stage === "no_match" && (item.next_action !== "choose_recovery" || item.responsible_role !== "customer" || item.next_update_at !== null || item.is_overdue))
      || (item.customer_stage !== "no_match" && item.responsible_role !== "operations")) {
      throw new Error("Unsupported jobs response");
    }
  }
  return page;
}

export function careJobSummary(item: CareRequestSummary) {
  if (item.customer_stage === "no_match") return {
    status: "No match yet",
    detail: "Choose whether you would like Skycar to review this request again.",
    tone: "action" as const,
  };
  if (item.is_overdue) return {
    status: "Update overdue",
    detail: "The expected update time has passed. Skycar operations needs to follow up.",
    tone: "overdue" as const,
  };
  if (item.customer_stage === "delayed") return {
    status: "Response delayed",
    detail: "Skycar operations is still reviewing this request.",
    tone: "delayed" as const,
  };
  return {
    status: "Request received",
    detail: "Your request is recorded and waiting for review by Skycar operations.",
    tone: "received" as const,
  };
}

export function careJobAction(item: CareRequestSummary) {
  if (item.next_action === "choose_recovery") return "Your decision";
  if (item.next_action === "review_overdue_request") return "Skycar follow-up";
  return "Skycar review";
}
