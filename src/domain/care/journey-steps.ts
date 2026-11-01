import type { CareRequestSummary } from "./list.ts";
import { connectedCareStage } from "./presentation.ts";

// Presentation-only mapping of values the backend already returns for each My Jobs item
// (care_list_requests: journey_state, completion_review_state, plus the quote, assignment and
// fulfilment states behind connectedCareStage()). It adds no backend logic and derives no status.
// journey_state wins when present, exactly as careJobSummary() does; otherwise the existing
// connectedCareStage() mapping is used.
type Progress = Pick<CareRequestSummary, "quote_state" | "assignment_state" | "fulfilment_state">
  & Partial<Pick<CareRequestSummary, "journey_state" | "completion_review_state">>;

export type JourneyStepId = "received" | "offers" | "selected" | "confirmed" | "in_progress" | "completed" | "awaiting_review";
// done: reached; current: where the journey is now; upcoming: not reached yet;
// unknown: the backend has not recorded a value for this step; closed: journey was cancelled.
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

// Index of the current step for each backend journey_state. "cancelled" and "cancellation_requested" are handled separately.
const journeyIndex = { review: 0, quotes_ready: 1, booking_requested: 2, scheduled: 3, in_progress: 4, completed: 5 } as const;
// Same positions for the older connected stage, used when the list item carries no journey_state.
const stageIndex = { quote_ready: 1, appointment_requested: 2, appointment_confirmed: 3, in_progress: 4, completed: 5 } as const;

function closedSteps(): JourneyStep[] {
  return order.map(({ id, label }, index) => ({
    id, label, status: index === 0 ? "done" : "closed", note: index === 1 ? "Request cancelled" : null,
  }));
}

export function journeySteps(progress: Progress): JourneyStep[] {
  const journey = progress.journey_state ?? null;
  const stage = connectedCareStage(progress);
  if (journey === "cancelled" || (journey === null && stage === "cancelled")) return closedSteps();

  let current: number;
  let completed: boolean;
  if (journey === "cancellation_requested") {
    // The journey stays where it was until Skycar confirms the cancellation; the position comes from the existing stage.
    current = stage === null || stage === "cancelled" ? 0 : stageIndex[stage];
    completed = stage === "completed";
  } else if (journey !== null) {
    current = journeyIndex[journey];
    completed = journey === "completed";
  } else {
    current = stage === null ? 0 : stageIndex[stage as keyof typeof stageIndex];
    completed = stage === "completed";
  }
  const review = progress.completion_review_state ?? null;
  return order.map(({ id, label }, index) => {
    if (id === "awaiting_review") {
      if (!completed) return { id, label, status: "upcoming", note: null };
      if (review === "awaiting_review") return { id, label, status: "current", note: null };
      if (review === "confirmed") return { id, label, status: "done", note: "Confirmed by you" };
      if (review === "issue_reported") return { id, label, status: "done", note: "Issue reported" };
      return { id, label, status: "unknown", note: "Review status not recorded yet" };
    }
    // Completed is a reached state, not "in progress".
    if (index < current || (id === "completed" && completed)) return { id, label, status: "done", note: null };
    if (index === current) return { id, label, status: "current", note: journey === "cancellation_requested" ? "Cancellation requested" : null };
    return { id, label, status: "upcoming", note: null };
  });
}
