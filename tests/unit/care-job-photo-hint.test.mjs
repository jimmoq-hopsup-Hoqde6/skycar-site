import test from "node:test";
import assert from "node:assert/strict";
import { careJobPhotoHint, readCareJobsPage } from "../../src/domain/care/my-jobs.ts";

const base = {
  id: "11111111-1111-4111-8111-111111111111", vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", vehicle_archived: false, service: "repair",
  quote_state: "in_review", assignment_state: "none", fulfilment_state: null, money_state: null, customer_stage: "request_received",
  next_action: "review_request", responsible_role: "operations", created_at: "2026-09-20T13:00:00.000001Z", updated_at: "2026-09-20T13:00:00.000001Z",
  next_update_at: "2026-09-20T14:00:00.000001Z", is_overdue: false,
};

test("photo hint formats the server count and tolerates a missing field", () => {
  assert.deepEqual(careJobPhotoHint({ ...base, photo_count: 1, has_photos: true }), { count: 1, label: "1 photo sent" });
  assert.deepEqual(careJobPhotoHint({ ...base, photo_count: 3, has_photos: true }), { count: 3, label: "3 photos sent" });
  assert.deepEqual(careJobPhotoHint({ ...base, photo_count: 2 }), { count: 2, label: "2 photos sent" });
  assert.deepEqual(careJobPhotoHint({ ...base, has_photos: true }), { count: null, label: "Photos sent" });
  assert.equal(careJobPhotoHint(base), null);
});

test("zero or malformed values never produce a hint, and zero is never presented as 'no photos'", () => {
  for (const extra of [{ photo_count: 0, has_photos: false }, { photo_count: 0 }, { has_photos: false }, { photo_count: 4, has_photos: true }, { photo_count: 1.5 }, { photo_count: "2" }, { photo_count: null }, { photo_count: 2, has_photos: false }, { has_photos: "yes" }, { has_photos: true, photo_count: 0 }, { photo_count: -1 }]) {
    assert.equal(careJobPhotoHint({ ...base, ...extra }), null, JSON.stringify(extra));
  }
});

test("the jobs reader accepts items with or without the new fields", () => {
  const page = { items: [{ ...base, photo_count: 2, has_photos: true }, { ...base, id: "22222222-2222-4222-8222-222222222222" }], next_cursor: null, evaluated_at: "2026-09-20T13:30:00Z" };
  assert.deepEqual(readCareJobsPage(page), page);
});
