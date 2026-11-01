import type { CareReceipt } from "./request.ts";
import { connectedCareStage } from "./presentation.ts";

// Presentation-only projection of the existing connectedCareStage() derivation.
// It adds no backend logic: every step is backed by care_requests columns that
// care_list_requests already returns, except "awaiting review" (see below).
type Progress = Pick<CareReceipt, "quote_state" | "assignment_state" | "fulfilment_state">;

export type CompletionReviewState = "awaiting_review" | "confirmed" | "issue_reported";
export type JourneyStepId = "received" | "offers" | "selected" | "confirmed" | "in_progress" | "completed" | "awaiting_review";
// done: reached; current: where the journey is now; upcoming: not reached yet;
// unknown: no backing field is available to this surface; closed: journey was cancelled.
export type JourneyStepStatus = "done" | "current" | "upcoming" | "unknown" | "closed";
export type JourneyStep = { id: JourneyStepId; label: string; status: JourneyStepStatus; note: string | null };

const order: { id: JourneyStepId; label: string }[] = [
  { id: "received", label: "Request received" },
  { id: "offers", label: "Offers" },
  { id: "selected", label: "Selected" },
  { id: "confirmed", label: "Confirmed" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "awaiting_review", label: "Awaiting review" },
];

// Index of the current step for each connected stage. null (no connected stage yet) keeps the request at "received".
const stageIndex = { quote_ready: 1, appointment_requested: 2, appointment_confirmed: 3, in_progress: 4, completed: 5 } as const;

/**
 * reviewState: care_journeys.completion_review_state, which only the journey API
 * (Journey.completion_review.state) exposes. The My Jobs list does not return it, so
 * callers without the journey must leave it undefined and the final step stays "unknown".
 */
export function journeySteps(progress: Progress, reviewState?: CompletionReviewState | null): JourneyStep[] {
  const stage = connectedCareStage(progress);
  if (stage === "cancelled") {
    return order.map(({ id, label }, index) => ({
      id, label, status: index === 0 ? "done" : "closed", note: index === 1 ? "Request cancelled" : null,
    }));
  }
  const current = stage === null ? 0 : stageIndex[stage];
  return order.map(({ id, label }, index) => {
    if (id === "awaiting_review") {
      if (stage !== "completed") return { id, label, status: "upcoming", note: null };
      if (reviewState === "awaiting_review") return { id, label, status: "current", note: null };
      if (reviewState === "confirmed") return { id, label, status: "done", note: "Confirmed by you" };
      if (reviewState === "issue_reported") return { id, label, status: "done", note: "Issue reported" };
      return { id, label, status: "unknown", note: "Review status is shown in your service journey" };
    }
    // Completed is the last backed step: it is reached, not "in progress".
    if (index < current || (id === "completed" && stage === "completed")) return { id, label, status: "done", note: null };
    return { id, label, status: index === current ? "current" : "upcoming", note: null };
  });
}
