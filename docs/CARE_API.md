# Care request/status API — first increment (#3 / #14)

Contract version: 1. Scope: request receipt and overdue recovery, NOT a booking,
coverage guarantee, estimate, technician offer or payment integration. This
contract is published before any frontend consumer. No customer deadline is
invented: an operator must configure the internal `care_response_policy` row
before submission is available. Tests use explicitly test-only policy values.

## Authentication, privacy and transport

All routes require a verified Supabase session, `FEATURE_CARE=true`, and use the
session-scoped database client (never a service-role key). Database functions
derive the actor from `auth.uid()` and require a server-granted customer role.
Writes require an exact same-origin `Origin` and JSON content type. Responses
are `Cache-Control: private, no-store`. Unknown JSON fields are rejected.
Missing/foreign IDs return the same 404. Care references `public.vehicles`;
only an owned, unarchived vehicle can receive a new request. Existing requests
remain readable after archive, but not after ownership loss. Vehicle ownership
is immutable through direct authenticated updates while Care records reference
it. Care does not expose private media or allow clients to edit states/events.

Success/error envelopes follow FOUNDATION_ARCHITECTURE.md, with requestId.
Codes: 400 VALIDATION_FAILED, 401 UNAUTHENTICATED, 403 FORBIDDEN or CSRF_FAILED,
404 NOT_FOUND, 409 IDEMPOTENCY_CONFLICT, 413 PAYLOAD_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE,
503 CARE_UNAVAILABLE / POLICY_UNAVAILABLE / TEMPORARILY_UNAVAILABLE,
500 INTERNAL_ERROR. Internal database/provider details are not returned.

## Submit

`POST /api/v1/care/requests`

Required `Idempotency-Key`: UUID, scoped to verified actor + submit operation.
Body (maximum 16 KiB, strict fields):

```json
{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}
```

Service: `repair | cleaning`; preferred_window:
`one_to_two_business_days | seven_to_fourteen_days | flexible`. These are
preferences, never confirmed appointment availability. Description: 10–2000
trimmed characters. No price, owner, state, media or slot fields are accepted.

Returns 201 on creation or 200 on exact retry, with
`data: { request: <status below>, replayed: boolean }`. The database transaction
inserts request, immutable `request_received` event, audit and notification
outbox entry together. Same actor/key and different normalized payload is 409.
Concurrent retries serialize; an exact retry returns the current durable
request without restarting the deadline or producing another event. Retrying
an existing request is allowed after vehicle archive, not ownership loss.

## Read status / timeline

The additive [My Jobs list contract](CARE_MY_JOBS_API.md) defines the owner-scoped
`GET /api/v1/care/requests` collection and stable continuation tokens. Fetch
individual details below after selecting an authorised request from that list.

`GET /api/v1/care/requests/:id` returns `data: <status>`.

```json
{
  "id":"22222222-2222-4222-8222-222222222222",
  "vehicle_id":"11111111-1111-4111-8111-111111111111",
  "service":"repair",
  "description":"Scratch on rear bumper",
  "preferred_window":"flexible",
  "quote_state":"in_review",
  "assignment_state":"none",
  "fulfilment_state":null,
  "money_state":null,
  "customer_stage":"request_received",
  "next_action":"review_request",
  "responsible_role":"operations",
  "created_at":"2026-09-20T13:00:00Z",
  "updated_at":"2026-09-20T13:00:00Z",
  "next_update_at":"2026-09-20T14:00:00Z",
  "events":[{"id":"33333333-3333-4333-8333-333333333333","sequence":1,"type":"request_received","occurred_at":"2026-09-20T13:00:00Z"}]
}
```

Times above are examples, not an approved SLA. Events are chronologically
ordered by per-request sequence. Next update is authoritative; if overdue the
UI must show overdue honestly even before a worker runs. Do not infer matching
activity, assignment, an appointment or payment from receipt.

## Current transitions and internal deadline worker

Only the database owns transitions. `care_escalate_overdue(batch_size)` is
executable by service_role only, never authenticated/anonymous clients. It
processes up to 100 rows with `FOR UPDATE SKIP LOCKED`, using database time.

| Existing projection | Event | Result / next action |
| --- | --- | --- |
| request_received + deadline elapsed | response_overdue | delayed / review_overdue_request / operations + configured follow-up deadline |
| delayed + follow-up elapsed | no_match | no_match / choose_recovery / customer + no automated deadline |

Both transitions append an event, audit and deduplicated notification intent
atomically. Quote remains in_review, assignment remains none, fulfilment/money
remain null. Repeated calls do not re-escalate a terminal request. No-match
does NOT cancel, book, refund or charge. `POST /api/v1/care/requests/:id/retry`
with empty JSON object and UUID Idempotency-Key is the explicit owner-only
recovery: no_match -> request_received with a fresh configured deadline and
`request_reopened` event. A duplicate retry does not reset its deadline; a new
retry key on a non-no-match request returns 409 INVALID_TRANSITION.

Outbox rows retain pending/delivered/failed state, attempts, available_at and
last_error for a future delivery adapter. No delivered status or outbound
message is fabricated. No HTTP worker endpoint or schedule is activated here.
An approved deployment must wire the restricted worker and notification
delivery/retries and verify deadline monitoring before accepting real traffic.

## Reserved later projection mapping (not implemented by this increment)

| Customer stage | Required authoritative evidence |
| --- | --- |
| finding_qualified_technicians | persisted dispatch/matching event, not request receipt alone |
| offers_ready | issued, unexpired quote + actual available technician slots |
| appointment_confirmed | accepted quote + accepted assignment + scheduled fulfilment |
| technician_on_the_way | authorised active-appointment travel event |
| work_in_progress | in_progress fulfilment |
| awaiting_customer_review | completed fulfilment + protected evidence |
| completed | validated/closed fulfilment; show money separately |

Information-required, cancellation, rescheduling and disputes require their
own audited exception workflows before exposure. Later endpoints must publish
their contracts and acceptance tests before frontend integration. No generic
client state/event write endpoint is provided.

## Verification and rollout

Migration owner: Backend Developer, new additive migration 202609200002.
No live migration is executed. PostgreSQL integration fixtures emulate the
minimal Supabase auth/storage schema solely to exercise actual SQL functions,
grants and RLS. They are not evidence of hosted Supabase/storage verification.
Unit tests cover transport, validation and error contracts; database tests
cover ownership, roles, duplicate/conflict, rollback, deadlines, recovery,
direct-write denial and concurrency. Hosted two-user storage, signed-in UI,
worker delivery and staging rollback gates remain outstanding (#1/#8).
