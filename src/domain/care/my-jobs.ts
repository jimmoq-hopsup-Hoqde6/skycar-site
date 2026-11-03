import type { CareRequestSummary } from "./list.ts";
import { connectedCareStage } from "./presentation.ts";

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
const journeyStates = new Set(["review", "quotes_ready", "booking_requested", "scheduled", "in_progress", "completed", "cancellation_requested", "cancelled"]);
const completionReviews = new Set(["awaiting_review", "confirmed", "issue_reported"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const journeyLabels: Record<string, string> = {
  review: "Under review",
  quotes_ready: "Quotes ready",
  booking_requested: "Appointment requested",
  scheduled: "Appointment confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancellation_requested: "Cancellation requested",
  cancelled: "Cancelled",
};

function optionalToken(item: CareRequestSummary, key: "journey_state" | "completion_review_state", allowed: Set<string>) {
  if (!Object.hasOwn(item, key) || item[key] === null || item[key] === undefined) return null;
  if (typeof item[key] !== "string" || !allowed.has(item[key])) throw new Error("Unsupported jobs response");
  return item[key];
}

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
    const journey = optionalToken(item, "journey_state", journeyStates);
    const review = optionalToken(item, "completion_review_state", completionReviews);
    if ((review !== null && journey !== "completed") || (journey !== "completed" && Object.hasOwn(item, "completion_review_state") && item.completion_review_state !== null && item.completion_review_state !== undefined && journey === null)) {
      throw new Error("Unsupported jobs response");
    }
  }
  return page;
}

export function journeyStateLabel(item: CareRequestSummary) {
  const journey = item.journey_state ?? null;
  if (!journey) return null;
  if (journey === "completed" && item.completion_review_state === "issue_reported") return "Completion issue reported";
  if (journey === "completed" && item.completion_review_state === "confirmed") return "Completion confirmed";
  if (journey === "completed" && item.completion_review_state === "awaiting_review") return "Awaiting your completion review";
  return journeyLabels[journey] ?? null;
}

export function careJobSummary(item: CareRequestSummary) {
  const journey = item.journey_state ?? null;
  const review = item.completion_review_state ?? null;
  if (journey === "cancellation_requested") return { status: "Cancellation requested", detail: "Skycar still holds the recorded appointment until the cancellation is confirmed.", tone: "delayed" as const };
  if (journey === "cancelled") return { status: "Request cancelled", detail: "This service journey is closed and no appointment is confirmed.", tone: "delayed" as const };
  if (journey === "completed" && review === "issue_reported") return { status: "Completion issue reported", detail: "Your private completion issue is saved with this service journey.", tone: "action" as const };
  if (journey === "completed" && review === "confirmed") return { status: "Service complete", detail: "You confirmed completion. The record stays in this journey and your Garage history.", tone: "received" as const };
  if (journey === "completed") return { status: "Service complete", detail: "Completion evidence is saved. Confirm the work or report a private issue in the service journey.", tone: "action" as const };
  if (item.fulfilment_state === "paused") return { status: "Service paused", detail: "Recorded work is paused. The appointment remains on this journey until Skycar updates it.", tone: "delayed" as const };
  if (journey === "in_progress") return { status: "Service in progress", detail: "The expert has started the recorded work.", tone: "received" as const };
  if (journey === "scheduled") return { status: "Appointment confirmed", detail: "Skycar has confirmed the expert and appointment details.", tone: "received" as const };
  if (journey === "booking_requested") return { status: "Appointment requested", detail: "Your preferred time is recorded, but expert availability is not confirmed yet.", tone: "delayed" as const };
  if (journey === "quotes_ready") return { status: "Quote ready", detail: "A human-reviewed quote is ready for your decision.", tone: "action" as const };
  if (journey === "review") return { status: "Request in review", detail: "Your request is in the service journey. A technician and appointment are not confirmed.", tone: "received" as const };
  const connected = connectedCareStage(item);
  if (connected === "completed") return { status: "Service complete", detail: "Completion evidence is saved in the service journey and your Garage history.", tone: "received" as const };
  if (connected === "in_progress") return { status: "Service in progress", detail: "The expert has started the recorded work.", tone: "received" as const };
  if (connected === "appointment_confirmed") return { status: "Appointment confirmed", detail: "Skycar has confirmed the expert and appointment details.", tone: "received" as const };
  if (connected === "appointment_requested") return { status: "Appointment requested", detail: "Your preferred time is recorded, but expert availability is not confirmed yet.", tone: "delayed" as const };
  if (connected === "quote_ready") return { status: "Quote ready", detail: "A human-reviewed quote is ready for your decision.", tone: "action" as const };
  if (connected === "cancelled") return { status: "Request cancelled", detail: "This service journey is closed and no appointment is confirmed.", tone: "delayed" as const };
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
  const journey = item.journey_state ?? null;
  const review = item.completion_review_state ?? null;
  if (journey === "cancellation_requested") return "Skycar cancellation review";
  if (journey === "cancelled") return "No further action";
  if (journey === "completed" && review === "issue_reported") return "Skycar reviewing your issue";
  if (journey === "completed" && review === "confirmed") return "View completion record";
  if (journey === "completed") return "Confirm completion or report an issue";
  if (item.fulfilment_state === "paused") return "Waiting for Skycar to resume";
  if (journey === "in_progress") return "Expert completing the work";
  if (journey === "scheduled") return "Attend confirmed appointment";
  if (journey === "booking_requested") return "Skycar availability check";
  if (journey === "quotes_ready") return "Review your quotes";
  if (journey === "review") return "Skycar review";
  const connected = connectedCareStage(item);
  if (connected === "completed") return "View completion record";
  if (connected === "in_progress") return "Expert completing the work";
  if (connected === "appointment_confirmed") return "Attend confirmed appointment";
  if (connected === "appointment_requested") return "Skycar availability check";
  if (connected === "quote_ready") return "Review your quotes";
  if (connected === "cancelled") return "No further action";
  if (item.next_action === "choose_recovery") return "Your decision";
  if (item.next_action === "review_overdue_request") return "Skycar follow-up";
  return "Skycar review";
}

export function careJobLink(item: CareRequestSummary) {
  const journey = item.journey_state ?? null;
  const review = item.completion_review_state ?? null;
  const connected = connectedCareStage(item);
  if (journey === "cancellation_requested") return "View cancellation request";
  if (journey === "completed" && review === "issue_reported") return "View completion issue";
  if (journey === "completed" && review !== "confirmed") return "Review completion";
  if (journey === "completed" || connected === "completed") return "View completion record";
  if (journey === "quotes_ready" || connected === "quote_ready") return "Review quotes";
  return "Open service journey";
}

// Display-only photo hint. The server owns the count; the browser only formats it.
// Missing, zero or malformed values yield no hint (never "no photos": old requests report 0).
export function careJobPhotoHint(item: CareRequestSummary): { count: number | null; label: string } | null {
  const count: unknown = item.photo_count;
  const flag: unknown = item.has_photos;
  if (flag === false) return null;
  if (typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= 3) {
    return { count, label: count === 1 ? "1 photo sent" : `${count} photos sent` };
  }
  if (flag === true && (count === undefined || count === null)) return { count: null, label: "Photos sent" };
  return null;
}
