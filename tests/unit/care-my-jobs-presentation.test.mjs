import test from "node:test";
import assert from "node:assert/strict";
import { careJobAction, careJobSummary, readCareJobsPage } from "../../src/domain/care/my-jobs.ts";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  vehicle_archived: false,
  service: "repair",
  quote_state: "in_review",
  assignment_state: "none",
  fulfilment_state: null,
  money_state: null,
  customer_stage: "request_received",
  next_action: "review_request",
  responsible_role: "operations",
  created_at: "2026-09-20T13:00:00.000001Z",
  updated_at: "2026-09-20T13:00:00.000001Z",
  next_update_at: "2026-09-20T14:00:00.000001Z",
  is_overdue: false,
};

test("reads an authoritative bounded jobs page", () => {
  const page = { items: [base], next_cursor: "next-page", evaluated_at: "2026-09-20T13:30:00Z" };
  assert.deepEqual(readCareJobsPage(page), page);
});

test("fails closed for malformed or future list responses", () => {
  for (const page of [
    null,
    {},
    { items: [], next_cursor: null, evaluated_at: "invalid" },
    { items: [{ ...base, customer_stage: "booked" }], next_cursor: null, evaluated_at: "2026-09-20T13:30:00Z" },
    { items: [{ ...base, id: "not-a-uuid" }], next_cursor: null, evaluated_at: "2026-09-20T13:30:00Z" },
    { items: [{ ...base, money_state: "paid" }], next_cursor: null, evaluated_at: "2026-09-20T13:30:00Z" },
    { items: [{ ...base, is_overdue: "yes" }], next_cursor: null, evaluated_at: "2026-09-20T13:30:00Z" },
    { items: [{ ...base, customer_stage: "no_match", next_action: "review_request" }], next_cursor: null, evaluated_at: "2026-09-20T13:30:00Z" },
    { items: [base], next_cursor: "x".repeat(513), evaluated_at: "2026-09-20T13:30:00Z" },
  ]) assert.throws(() => readCareJobsPage(page), /Unsupported jobs response/);
});

test("presents only implemented receipt, delayed, overdue and recovery states", () => {
  assert.deepEqual(careJobSummary(base), {
    status: "Request received",
    detail: "Your request is recorded and waiting for review by Skycar operations.",
    tone: "received",
  });
  assert.equal(careJobSummary({ ...base, customer_stage: "delayed" }).status, "Response delayed");
  assert.equal(careJobSummary({ ...base, is_overdue: true }).status, "Update overdue");
  assert.equal(careJobSummary({ ...base, customer_stage: "no_match", next_action: "choose_recovery", responsible_role: "customer", next_update_at: null }).status, "No match yet");
  assert.equal(careJobAction(base), "Skycar review");
  assert.equal(careJobAction({ ...base, next_action: "review_overdue_request" }), "Skycar follow-up");
  assert.equal(careJobAction({ ...base, next_action: "choose_recovery" }), "Your decision");
});
