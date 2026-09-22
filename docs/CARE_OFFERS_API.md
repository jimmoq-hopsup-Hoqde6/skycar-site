# Care technician offers API — isolated preparation (#14 / PR #29)

Contract version: 1, corrected 22 September 2026. This slice stores reviewed
quote data and operator-entered appointment options. It does **not** verify a
technician's calendar capacity, reserve a slot, accept an offer, create a
booking, charge a customer or start fulfilment. It remains draft preparation.

## Customer read

`GET /api/v1/care/requests/:id/offers`

Requires a verified customer session and `FEATURE_CARE=true`. The database
derives the caller from `auth.uid()` and a server-granted customer role; a
foreign or missing request returns the same 404. Responses are private/no-store.
Customer read uses the session-scoped client, never the service-role client.
The route uses the shared API boundary and the reviewed static log template
`/api/v1/care/requests/[requestId]/offers`. Its response/body request IDs match,
and its single completion record excludes the literal Care request identifier,
URL, query, session data and offer contents. A logging failure cannot change the
customer response.
The application decoder independently requires every returned offer to match the
route request ID and the documented field, timestamp, expiry and slot bounds.
Repository drift or malformed data fails the whole response closed with a
retryable 503; private and unrecognised fields are never copied to the response.

Only issued offers with `expires_at` strictly after the read statement's start
are returned. Each returned offer must have at least one available option whose
`starts_at` is also strictly in the future. Already-started, withdrawn or expired
options are omitted. An offer with no selectable options is omitted. These
checks are read-time filtering, not a reservation or a guarantee of capacity.

Example `data` item (synthetic values, not a price or appointment promise):

```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "request_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "scope_summary": "Repair and refinish rear bumper scratch",
  "total_price_cents": 49500,
  "currency": "AUD",
  "adjustment_reason": "Estimate increased after technician photo review",
  "status": "issued",
  "expires_at": "2026-09-22T23:00:00Z",
  "created_at": "2026-09-22T00:30:00Z",
  "updated_at": "2026-09-22T00:30:00Z",
  "slots": [
    {
      "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "starts_at": "2026-09-23T00:30:00Z",
      "ends_at": "2026-09-23T03:30:00Z",
      "status": "available",
      "created_at": "2026-09-22T00:30:00Z"
    }
  ]
}
```

Private technician account IDs are not returned. A separately reviewed public
profile/review contract is still needed before customers can compare technicians.

## Restricted publishing RPC

`care_publish_offer(p_idempotency_key uuid, p_request_id uuid, p_technician_id uuid,
p_scope_summary text, p_total_price_cents integer, p_adjustment_reason text,
p_expires_at timestamptz, p_slots jsonb) -> jsonb`

Only `service_role` has execution permission. A missing or different role claim
also fails closed. Spoofing a role claim does not grant an authenticated or
anonymous database role permission to execute the function. There is no public
HTTP publishing endpoint and no technician dispatch adapter in this slice.

Requirements:
- The request references its customer's unarchived Garage vehicle. Lock order
  is vehicle, request, technician role; publication checks time after lock waits.
- The request is `request_received` or `delayed`, with quote `in_review`,
  assignment `none` and no fulfilment or money state. Reopen no-match requests
  before publishing. Missing/ineligible vehicle is `NOT_FOUND`; other incompatible
  request states are `INVALID_TRANSITION`.
- The technician has the server-granted technician role. This is not proof of
  qualifications, coverage, onboarding or available calendar capacity.
- Scope is 10–2000 trimmed characters; total is a positive integer number of AUD
  cents; optional adjustment explanation is 3–1000 trimmed characters.
- Expiry is finite and in the future. It is the customer's decision deadline:
  **expiry must be at or before every appointment's start**, not after it.
- One to twenty non-overlapping options are supplied. Each object contains only
  `starts_at` and `ends_at`: absolute, timezone-qualified timestamp strings.
  Nulls, missing fields, invalid dates, non-finite times, non-positive durations,
  duplicate/overlapping options and unknown fields return `VALIDATION_FAILED`.

A successful call atomically supersedes the prior issued offer for the same
request/technician, inserts the replacement and options, and records an audit.
A partial unique index and request lock maintain one issued offer per pair.
Invalid input or audit failure rolls back the whole operation, including prior
offer supersession. The audit identifies a service-role publisher and records
the target technician separately; it does not impersonate that technician.

The service publisher supplies a UUID idempotency key for each logical command.
The database stores a private canonical command record in the same transaction as
the offer and audit. A retry with the same key and equivalent normalized command
returns `{"offer_id":"...","replayed":true}` without another offer, slot or
audit. The first successful execution returns the same shape with `replayed:false`.
Whitespace is normalized for text fields; absolute appointment instants and slot
order are canonicalized. Reusing a key for a different command fails with
`IDEMPOTENCY_CONFLICT`. A transaction advisory lock makes two simultaneous first
attempts race-safe. A failed transaction leaves no reconciliation record, so the
same command can be retried safely.

Idempotent publication is not booking concurrency protection, confirmed calendar
capacity or exactly-once delivery to external systems. The command ledger is not
customer-readable, and callers must durably retain the key until the outcome is
reconciled.

This slice does not advance the request to `offers_ready` or stop its existing
deadline worker. That operational integration, including deduplicated events and
notification delivery, remains a separate acceptance gate. Do not enable live
offers while request/offer lifecycle integration is incomplete.

## Customer HTTP errors

400 VALIDATION_FAILED, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND,
503 CARE_UNAVAILABLE / TEMPORARILY_UNAVAILABLE, 500 INTERNAL_ERROR.
Publishing RPC validation/transition errors above are not a new public HTTP API.

## Verification and next gates

`tests/integration/garage-care-db.test.mjs` retains the original shared journey
assertions, applies every migration in filename order, and additionally invokes
`care-offers.acceptance.mjs`. Offer coverage includes owner A/B isolation, denied
client reads/writes/publishing, forged/missing role claims, valid publish/read,
malformed/null/time-boundary input, rollback, supersession and concurrent
publication, including identical-key replay/conflict and simultaneous duplicate
commands. The bootstrap `auth.role()` shim tests SQL boundaries only; it is
not hosted JWT, Supabase, Storage, calendar or physical-device evidence.
Exact executed results and revisions belong in the PR conversation, not inferred
from the existence of tests or from unrelated green workflows.

Still required: independent review; PR #27 integration acceptance; hosted auth,
private-storage/device and release controls; technician qualifications/coverage
and authoritative capacity; public profile comparison;
offer/request state and notification integration; atomic acceptance of an offer
and slot with revalidated capacity; booking projection; separate money lifecycle.
No live migration, deployment, payment provider, customer booking or dispatch is
activated by this correction. The separate private pilot is untouched.
