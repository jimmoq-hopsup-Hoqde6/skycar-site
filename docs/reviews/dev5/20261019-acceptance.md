# Developer 5 QA — 19 October 2026

Reviewed draft: `19c88f7ae002e2283d72de4ee5fbce7334ab483c` (PR #65, including its ancestor notification and availability packets). Node 24.19.0. QA branch: `qa/dev5-acceptance-20261019`.

## Results and independence

- Existing unit tests plus availability and payment reference scenarios: 235 passed, zero failed or skipped.
- Added notification acceptance suite: four passed, one failed, zero skipped.
- Tests use the actual notification adapter with synthetic authorization/provider dependencies. No outbound messages or real transactions occur.
- Availability/payment reference scenarios are proposal evidence, not working calendar or payment integration evidence.
- Browser, real PostgreSQL concurrency, hosted Auth/storage and physical-phone checks were not run in this pass. Historical reports do not establish current hosted status.
- No application implementation, migrations, shared database logic, booking commands, CI configuration or existing draft files changed. No approval, merge or deployment. Another developer must review these QA additions; QA must not approve its own implementation.

## QA-N01 — malformed notification instant reaches provider

Priority: P2 (validation defect in an unconnected adapter; not a demonstrated production send). Suggested owner: notification/backend implementation owner, coordinated through Developer 1.

Contract: `docs/proposals/CARE_NOTIFICATIONS.md`, Adapter job, requires malformed instants to fail closed before authorization.

Reproduce:

1. Check out the reviewed draft plus this QA packet.
2. Run `node --test tests/review/dev5/notification-acceptance.test.mjs`.
3. QA-N01 passes `available_at: "2026-02-30T00:00:00Z"` with an otherwise valid job, a fixed October clock and synthetic dependencies.
4. Expected: `NotificationJobError`, zero authorization calls and zero provider calls.
5. Actual: no rejection, one authorization call and one provider call. The suite exits 1.

Cause observed in source: `readJob` accepts a timestamp when its suffix matches and `Date.parse` is finite. JavaScript normalizes February 30 to March 2, so an impossible calendar date is accepted.

Correction acceptance: reject impossible calendar dates before dependencies while continuing to accept valid absolute timestamps and supported explicit offsets. Add leap-year valid/invalid boundaries and verify due/future behavior. Do not change the expected result merely to make this test green. The implementation owner should fix the adapter on a separately reviewed branch; this packet deliberately retains the failing acceptance test.

## Other new executable acceptance checks

| ID | Scenario | Result |
| --- | --- | --- |
| QA-N02 | Consent withdrawn after first attempt prevents repeat send | PASS |
| QA-N03 | Malformed authorization cannot reach provider | PASS |
| QA-N04 | Missing/invalid provider receipts cannot establish delivery | PASS |
| QA-N05 | Exhausted retry cannot send after temporary failure | PASS |

## Next customer–technician acceptance queue

These are test specifications, NOT fresh execution results or newly discovered bugs.

| Priority | Given / when | Required outcome | Coordination |
| --- | --- | --- | --- |
| P1 | Owner has customer plus technician/admin role; confirms or disputes completion | Match explicit reviewed role policy, including replay after role changes | Developer 1; existing R1 in PR #64 |
| P1 | Two real database connections reuse actor/key across selection and completion on one vehicle | No deadlock or duplicate write; deterministic conflict/replay | Developer 1; existing R2 in PR #64 |
| P1 | Customer submits photos, selects quote, requests appointment | Clear requested state until server confirmation; retry creates one request | Developer 2 UI, Developer 1 commands |
| P1 | Two customers request overlapping technician slots | At most one confirmation; loser receives actionable conflict | Developer 1 backend, Developer 3 UI |
| P1 | User switches account during an in-flight job/photo response | Old private data and retry drafts cleared; stale response ignored | Developers 2 and 3 |
| P2 | Technician edits weekly windows, dated exceptions, DST gaps/folds and midnight boundaries | Valid Adelaide times, explicit conflicts, confirmed jobs preserved | Developer 3; Developer 1 persistence |
| P2 | Upload/network failure followed by retry | Visible failure and recoverable draft; no false submission/completion | Developers 2 and 3 |
| P2 | Technician completes job, customer confirms or reports issue | Private evidence and issue text remain correctly scoped; no implied payment | Developers 1–3 |

Existing PR #64 records dual-role completion and opposite-lock-order findings, plus a midnight availability contract gap. Those are prior findings and were not independently re-executed here. Avoid duplicate issue creation. This review does not approve those implementations or the QA packet itself.

## Commands

```sh
node --test tests/unit/*.test.mjs tests/review/availability-scenarios.test.mjs tests/review/payment-scenarios.test.mjs
node --test tests/review/payment-scenarios.pricing.test.mjs
node --test tests/review/dev5/notification-acceptance.test.mjs
```

The new review suite requires explicit execution: repository `npm test` only includes `tests/unit/*.test.mjs`. Registering it in shared CI belongs to the CI owner after correction/review, not to this isolated packet.
