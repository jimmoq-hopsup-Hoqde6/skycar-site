import test from "node:test";
import assert from "node:assert/strict";
import { readCareSubmission } from "../../src/domain/care/submission.ts";

const id = "11111111-1111-4111-8111-111111111111";
const receipt = {
  id, vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", service: "repair",
  description: "Scratch on the rear bumper", preferred_window: "flexible",
  quote_state: "in_review", assignment_state: "none", fulfilment_state: null,
  money_state: null, customer_stage: "request_received", next_action: "review_request",
  responsible_role: "operations", created_at: "2026-09-20T12:00:00Z",
  updated_at: "2026-09-20T12:00:00Z", next_update_at: "2026-09-20T13:00:00Z",
  events: [{ id: "22222222-2222-4222-8222-222222222222", sequence: 1, type: "request_received", occurred_at: "2026-09-20T12:00:00Z" }],
};

test("reads the exact durable submission envelope", () => {
  const result = readCareSubmission({ request: receipt, replayed: false });
  assert.equal(result.request.id, id);
  assert.equal(result.replayed, false);
});

test("fails closed for malformed, expanded or unsupported submission responses", () => {
  for (const value of [
    null,
    { request: receipt },
    { request: receipt, replayed: "false" },
    { request: { ...receipt, customer_stage: "appointment_confirmed" }, replayed: false },
    { request: receipt, replayed: false, price: 500 },
  ]) assert.throws(() => readCareSubmission(value));
});
