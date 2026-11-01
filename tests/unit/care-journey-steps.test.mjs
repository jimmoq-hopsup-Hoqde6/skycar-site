import test from "node:test";
import assert from "node:assert/strict";
import { journeySteps } from "../../src/domain/care/journey-steps.ts";

const base = { quote_state: "in_review", assignment_state: "none", fulfilment_state: null };
const statuses = progress => journeySteps(progress).map(step => step.status);

test("lists the seven journey states in order", () => {
  assert.deepEqual(journeySteps(base).map(step => step.id), ["received", "offers", "selected", "confirmed", "in_progress", "completed", "awaiting_review"]);
});

test("a new request is at request received", () => {
  assert.deepEqual(statuses(base), ["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
});

test("each backed stage marks earlier steps done and itself current", () => {
  assert.deepEqual(statuses({ ...base, quote_state: "issued" }), ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
  assert.deepEqual(statuses({ quote_state: "accepted", assignment_state: "reserved", fulfilment_state: null }), ["done", "done", "current", "upcoming", "upcoming", "upcoming", "upcoming"]);
  assert.deepEqual(statuses({ quote_state: "accepted", assignment_state: "accepted", fulfilment_state: "scheduled" }), ["done", "done", "done", "current", "upcoming", "upcoming", "upcoming"]);
  assert.deepEqual(statuses({ quote_state: "accepted", assignment_state: "accepted", fulfilment_state: "in_progress" }), ["done", "done", "done", "done", "current", "upcoming", "upcoming"]);
  assert.deepEqual(statuses({ quote_state: "accepted", assignment_state: "accepted", fulfilment_state: "paused" }), ["done", "done", "done", "done", "current", "upcoming", "upcoming"]);
});

const completed = { quote_state: "accepted", assignment_state: "accepted", fulfilment_state: "completed" };

test("completed work uses the backend completion_review_state for the final step", () => {
  const done6 = ["done", "done", "done", "done", "done", "done"];
  assert.deepEqual(statuses({ ...completed, journey_state: "completed", completion_review_state: "awaiting_review" }), [...done6, "current"]);
  const confirmed = journeySteps({ ...completed, journey_state: "completed", completion_review_state: "confirmed" });
  assert.deepEqual(confirmed.map(step => step.status), [...done6, "done"]);
  assert.equal(confirmed.at(-1).note, "Confirmed by you");
  assert.equal(journeySteps({ ...completed, journey_state: "completed", completion_review_state: "issue_reported" }).at(-1).note, "Issue reported");
});

test("no recorded completion_review_state leaves the final step unknown, never inferred", () => {
  for (const extra of [{}, { journey_state: "completed" }, { journey_state: "completed", completion_review_state: null }, { completion_review_state: null }]) {
    assert.deepEqual(statuses({ ...completed, ...extra }), ["done", "done", "done", "done", "done", "done", "unknown"]);
  }
  for (const fulfilment_state of ["validated", "closed"]) assert.equal(statuses({ ...completed, fulfilment_state }).at(-1), "unknown");
});

test("a review state is ignored until the journey is completed", () => {
  assert.equal(statuses({ ...base, quote_state: "issued", completion_review_state: "awaiting_review" }).at(-1), "upcoming");
  assert.equal(statuses({ ...base, journey_state: "in_progress", completion_review_state: "confirmed" }).at(-1), "upcoming");
});

test("journey_state maps to a step and wins over the connected stage", () => {
  const expected = { review: 0, quotes_ready: 1, booking_requested: 2, scheduled: 3, in_progress: 4 };
  for (const [journey_state, index] of Object.entries(expected)) {
    const steps = journeySteps({ ...base, journey_state });
    assert.equal(steps.findIndex(step => step.status === "current"), index, journey_state);
    assert.ok(steps.slice(0, index).every(step => step.status === "done"));
    assert.ok(steps.slice(index + 1).every(step => step.status === "upcoming"));
  }
  // journey_state outranks the older stage fields, as in careJobSummary().
  assert.deepEqual(statuses({ ...completed, journey_state: "scheduled" }), ["done", "done", "done", "current", "upcoming", "upcoming", "upcoming"]);
  // Without journey_state the connected-stage mapping is unchanged.
  assert.deepEqual(statuses({ ...base, journey_state: null, quote_state: "issued" }), ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
});

test("cancellation requested keeps the journey in place and labels the current step", () => {
  const steps = journeySteps({ quote_state: "accepted", assignment_state: "accepted", fulfilment_state: "scheduled", journey_state: "cancellation_requested" });
  assert.deepEqual(steps.map(step => step.status), ["done", "done", "done", "current", "upcoming", "upcoming", "upcoming"]);
  assert.equal(steps[3].note, "Cancellation requested");
  assert.equal(journeySteps({ ...base, journey_state: "cancellation_requested" })[0].note, "Cancellation requested");
});

test("cancelled journeys keep only the received step and close the rest", () => {
  const steps = journeySteps({ quote_state: "declined", assignment_state: "cancelled", fulfilment_state: null });
  assert.deepEqual(steps.map(step => step.status), ["done", "closed", "closed", "closed", "closed", "closed", "closed"]);
  assert.equal(steps.filter(step => step.status === "current").length, 0);
  const byJourney = journeySteps({ ...base, journey_state: "cancelled" });
  assert.deepEqual(byJourney.map(step => step.status), ["done", "closed", "closed", "closed", "closed", "closed", "closed"]);
  assert.equal(byJourney[1].note, "Request cancelled");
});

test("at most one step is current for every database state combination", () => {
  const quotes = ["draft", "in_review", "issued", "accepted", "declined", "expired", "superseded"];
  const assignments = ["none", "offered", "reserved", "accepted", "cancelled", "expired"];
  const fulfilments = [null, "scheduled", "ready", "in_progress", "paused", "completed", "validated", "closed"];
  for (const quote_state of quotes) for (const assignment_state of assignments) for (const fulfilment_state of fulfilments) {
    assert.ok(statuses({ quote_state, assignment_state, fulfilment_state }).filter(status => status === "current").length <= 1);
  }
});

test("at most one step is current for every journey_state and completion_review_state value", () => {
  const journeys = [null, "review", "quotes_ready", "booking_requested", "scheduled", "in_progress", "completed", "cancellation_requested", "cancelled"];
  const reviews = [null, "awaiting_review", "confirmed", "issue_reported"];
  for (const journey_state of journeys) for (const completion_review_state of reviews) {
    assert.ok(statuses({ ...completed, journey_state, completion_review_state }).filter(status => status === "current").length <= 1);
    assert.ok(statuses({ ...base, journey_state, completion_review_state }).filter(status => status === "current").length <= 1);
  }
});

test("My Jobs passes the whole list item, so backend journey fields reach the timeline", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/features/care/my-jobs.tsx", import.meta.url), "utf8");
  const uses = source.match(/<JourneyTimeline\b[^>]*>/g) ?? [];
  assert.equal(uses.length, 1);
  assert.match(uses[0], /progress=\{item\}/);
  const component = await readFile(new URL("../../src/features/care/journey-timeline.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /STUB|reviewState/);
});
