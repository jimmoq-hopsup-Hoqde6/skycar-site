import type { CareReceipt, CareEvent } from "./request.ts";

export const eventLabels: Record<CareEvent["type"], string> = {
  request_received: "Request received",
  response_overdue: "Response delayed",
  no_match: "No match recorded",
  request_reopened: "Request reopened",
};

export function statusSummary(receipt: CareReceipt, now: number) {
  const overdue = receipt.next_update_at !== null && Date.parse(receipt.next_update_at) <= now;
  if (receipt.customer_stage === "no_match") return {
    title: "No match yet", detail: "You can ask Skycar to review this request again. Reopening does not confirm a technician or appointment.", overdue: false,
  };
  if (overdue) return {
    title: "Your update is overdue", detail: "The promised update time has passed. There is no newer confirmed outcome to show. Skycar operations is responsible for reviewing your request.", overdue: true,
  };
  if (receipt.customer_stage === "delayed") return {
    title: "Your response is delayed", detail: "Skycar operations needs more time to review your request. The next update time is shown below.", overdue: false,
  };
  return { title: "We have your request", detail: "Your request is recorded for review by Skycar operations. A technician and appointment have not been confirmed.", overdue: false };
}

// Fail closed when a newer or malformed server response cannot be displayed honestly.
export function readReceipt(value: unknown, id: string): CareReceipt {
  const r = value as CareReceipt | null;
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (!r || r.id !== id || !["request_received", "delayed", "no_match"].includes(r.customer_stage)
    || !["repair", "cleaning"].includes(r.service) || typeof r.description !== "string"
    || !["one_to_two_business_days", "seven_to_fourteen_days", "flexible"].includes(r.preferred_window)
    || !["operations", "customer"].includes(r.responsible_role)
    || !date(r.created_at) || !date(r.updated_at) || !(r.next_update_at === null || date(r.next_update_at))
    || !Array.isArray(r.events) || r.events.some(e => !e || typeof e.id !== "string" || !Number.isSafeInteger(e.sequence)
      || !Object.hasOwn(eventLabels, e.type) || !date(e.occurred_at))) throw new Error("Unsupported response");
  return r;
}
