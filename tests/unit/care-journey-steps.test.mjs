import test from "node:test";
import assert from "node:assert/strict";
import { journeySteps } from "../../src/domain/care/journey-steps.ts";

const base = { quote_state: "in_review", assignment_state: "none", fulfilment_state: null };
const statuses = (progress, review) => journeySteps(progress, review).map(step => step.status);

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

test("completed work leaves review as unknown unless the journey review state is supplied", () => {
  const completed = { quote_state: "accepted", assignment_state: "accepted", fulfilment_state: "completed" };
  assert.deepEqual(statuses(completed), ["done", "done", "done", "done", "done", "done", "unknown"]);
  assert.deepEqual(statuses(completed, null), ["done", "done", "done", "done", "done", "done", "unknown"]);
  assert.deepEqual(statuses(completed, "awaiting_review"), ["done", "done", "done", "done", "done", "done", "current"]);
  assert.deepEqual(statuses(completed, "confirmed").at(-1), "done");
  assert.equal(journeySteps(completed, "issue_reported").at(-1).note, "Issue reported");
  for (const fulfilment_state of ["validated", "closed"]) assert.equal(statuses({ ...completed, fulfilment_state }).at(-1), "unknown");
});

test("a review state is ignored until the connected stage is completed", () => {
  assert.equal(statuses({ ...base, quote_state: "issued" }, "awaiting_review").at(-1), "upcoming");
});

test("cancelled journeys keep only the received step and close the rest", () => {
  const steps = journeySteps({ quote_state: "declined", assignment_state: "cancelled", fulfilment_state: null });
  assert.deepEqual(steps.map(step => step.status), ["done", "closed", "closed", "closed", "closed", "closed", "closed"]);
  assert.equal(steps.filter(step => step.status === "current").length, 0);
});

test("at most one step is current for every database state combination", () => {
  const quotes = ["draft", "in_review", "issued", "accepted", "declined", "expired", "superseded"];
  const assignments = ["none", "offered", "reserved", "accepted", "cancelled", "expired"];
  const fulfilments = [null, "scheduled", "ready", "in_progress", "paused", "completed", "validated", "closed"];
  for (const quote_state of quotes) for (const assignment_state of assignments) for (const fulfilment_state of fulfilments) {
    assert.ok(statuses({ quote_state, assignment_state, fulfilment_state }).filter(status => status === "current").length <= 1);
  }
});

test("awaiting review stub: My Jobs passes no reviewState, so the step stays unknown", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/features/care/my-jobs.tsx", import.meta.url), "utf8");
  const uses = source.match(/<JourneyTimeline\b[^>]*>/g) ?? [];
  assert.equal(uses.length, 1);
  assert.doesNotMatch(uses[0], /reviewState/);
  const completed = { quote_state: "accepted", assignment_state: "accepted", fulfilment_state: "completed" };
  const last = journeySteps(completed).at(-1);
  assert.equal(last.status, "unknown");
  assert.match(last.note, /service journey/);
});
