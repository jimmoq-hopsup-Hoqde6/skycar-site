import { journeySteps, type CompletionReviewState, type JourneyStepStatus } from "@/domain/care/journey-steps";
import type { CareRequestSummary } from "@/domain/care/list";
import "./journey-timeline.css";

const marks: Record<JourneyStepStatus, string> = { done: "✓", current: "", upcoming: "", unknown: "?", closed: "–" };
const spoken: Record<JourneyStepStatus, string> = {
  done: "Completed", current: "Current step", upcoming: "Not yet reached", unknown: "Status not available here", closed: "Not continuing",
};
const visible: Partial<Record<JourneyStepStatus, string>> = { current: "Current step" };

// Presentational only: renders the existing connected stage as an ordered list.
export function JourneyTimeline({ progress, reviewState }: {
  progress: Pick<CareRequestSummary, "quote_state" | "assignment_state" | "fulfilment_state">;
  reviewState?: CompletionReviewState | null;
}) {
  const steps = journeySteps(progress, reviewState);
  const current = steps.find(step => step.status === "current");
  return <ol className="journey-timeline" aria-label={current ? `Service journey progress. Current step: ${current.label}` : "Service journey progress"}>
    {steps.map((step, index) => {
      const text = step.note ?? visible[step.status];
      return <li key={step.id} className={`journey-step journey-step-${step.status}`} aria-current={step.status === "current" ? "step" : undefined}>
        <span className="journey-marker" aria-hidden="true">{marks[step.status] || index + 1}</span>
        <span className="journey-text">
          <span className="journey-label">{step.label}<span className="sr-only">. {spoken[step.status]}.</span></span>
          {text && <span className="journey-note" aria-hidden={step.note ? undefined : "true"}>{text}</span>}
        </span>
      </li>;
    })}
  </ol>;
}
