import type { CareReceipt, CareEvent } from "./request.ts";

type CareProgress = Pick<CareReceipt, "quote_state" | "assignment_state" | "fulfilment_state">;

export type ConnectedCareStage = "quote_ready" | "appointment_requested" | "appointment_confirmed" | "in_progress" | "completed" | "cancelled";

export function connectedCareStage(receipt: CareProgress): ConnectedCareStage | null {
  if (["completed", "validated", "closed"].includes(receipt.fulfilment_state ?? "")) return "completed";
  if (["in_progress", "paused"].includes(receipt.fulfilment_state ?? "")) return "in_progress";
  if (["scheduled", "ready"].includes(receipt.fulfilment_state ?? "") || receipt.assignment_state === "accepted") return "appointment_confirmed";
  if (receipt.assignment_state === "cancelled" || receipt.quote_state === "declined") return "cancelled";
  if (receipt.assignment_state === "reserved" || receipt.quote_state === "accepted") return "appointment_requested";
  if (receipt.quote_state === "issued") return "quote_ready";
  return null;
}

export const eventLabels: Record<CareEvent["type"], string> = {
  request_received: "Request received",
  response_overdue: "Response delayed",
  no_match: "No match recorded",
  request_reopened: "Request reopened",
};

export function statusSummary(receipt: CareReceipt, now: number) {
  const connected = connectedCareStage(receipt);
  if (connected === "completed") return { title: "Your service is complete", detail: "The completion record and evidence are saved in your connected service journey and Garage history.", overdue: false, connected };
  if (connected === "in_progress") return { title: "Your service is in progress", detail: "The expert has started the recorded work. Open the service journey for the latest evidence and status.", overdue: false, connected };
  if (connected === "appointment_confirmed") return { title: "Your appointment is confirmed", detail: "Skycar has recorded the expert and confirmed appointment. Open the service journey for the agreed details.", overdue: false, connected };
  if (connected === "appointment_requested") return { title: "Your appointment is requested", detail: "You accepted a quote and proposed a time. The appointment is not confirmed until Skycar verifies expert availability.", overdue: false, connected };
  if (connected === "quote_ready") return { title: "Your quote is ready", detail: "A human-reviewed quote is ready to compare in your connected service journey.", overdue: false, connected };
  if (connected === "cancelled") return { title: "Your request is cancelled", detail: "This connected service journey is closed. No appointment is confirmed.", overdue: false, connected };
  const overdue = receipt.next_update_at !== null && Date.parse(receipt.next_update_at) <= now;
  if (receipt.customer_stage === "no_match") return {
    title: "No match yet", detail: "You can ask Skycar to review this request again. Reopening does not confirm a technician or appointment.", overdue: false, connected: null,
  };
  if (overdue) return {
    title: "Your update is overdue", detail: "The promised update time has passed. There is no newer confirmed outcome to show. Skycar operations is responsible for reviewing your request.", overdue: true, connected: null,
  };
  if (receipt.customer_stage === "delayed") return {
    title: "Your response is delayed", detail: "Skycar operations needs more time to review your request. The next update time is shown below.", overdue: false, connected: null,
  };
  return { title: "We have your request", detail: "Your request is recorded for review by Skycar operations. A technician and appointment have not been confirmed.", overdue: false, connected: null };
}

// Fail closed when a newer or malformed server response cannot be displayed honestly.
export function readReceipt(value: unknown, id: string): CareReceipt {
  const r = value as CareReceipt | null;
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (!r || r.id !== id || !["request_received", "delayed", "no_match"].includes(r.customer_stage)
    || !["repair", "cleaning"].includes(r.service) || typeof r.description !== "string"
    || !["one_to_two_business_days", "seven_to_fourteen_days", "flexible"].includes(r.preferred_window)
    || !["draft", "in_review", "issued", "accepted", "declined", "expired", "superseded"].includes(r.quote_state)
    || !["none", "offered", "reserved", "accepted", "cancelled", "expired"].includes(r.assignment_state)
    || !(r.fulfilment_state === null || ["scheduled", "ready", "in_progress", "paused", "completed", "validated", "closed"].includes(r.fulfilment_state))
    || r.money_state !== null || !["review_request", "review_overdue_request", "choose_recovery"].includes(r.next_action)
    || !["operations", "customer"].includes(r.responsible_role)
    || !date(r.created_at) || !date(r.updated_at) || !(r.next_update_at === null || date(r.next_update_at))
    || !Array.isArray(r.events) || r.events.some(e => !e || typeof e.id !== "string" || !Number.isSafeInteger(e.sequence)
      || !Object.hasOwn(eventLabels, e.type) || !date(e.occurred_at))) throw new Error("Unsupported response");
  return r;
}
