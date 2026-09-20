# My Jobs request list — Care #3 / #14

Contract version: 1. Additive, read-only extension of [CARE_API.md](CARE_API.md).
Dependency: Care PR #16. This is the backend list contract for reopening saved
requests; it does not implement the My Jobs screen or later booking states.

## Route, session and ownership

`GET /api/v1/care/requests?limit=20&vehicle_id=<uuid>&cursor=<opaque-token>`

Uses the existing verified Supabase session, `FEATURE_CARE` and session-scoped
database client. The database requires the customer role and restricts every
row to both the request's customer and the vehicle's current owner. There is
no client-supplied owner or role. Own archived vehicles remain readable.
Missing and foreign vehicle filters return the same 404 `NOT_FOUND`.
An owned vehicle without requests, or an empty account, returns an empty list.

All responses, including errors, are `Cache-Control: private, no-store` and
`Vary: Cookie`. Reads never create events, notifications or progress updates.
No service-role credential or new environment setting is required.

## Query validation and paging

All parameters are optional and may appear only once. Unknown keys are rejected.

| Parameter | Contract |
| --- | --- |
| `limit` | Decimal integer 1–50; default 20. No signs, leading zeroes or fractions. |
| `vehicle_id` | Owned vehicle UUID; archived vehicles allowed. |
| `cursor` | Opaque versioned continuation token from the previous response. Maximum 512 characters. Pass unchanged. |

Order is `created_at DESC, id DESC`, using immutable creation time rather than
mutable status or update time. The cursor retains PostgreSQL microseconds and
the vehicle filter. A changed vehicle filter requires a new first-page request.
Changing page size is allowed. Malformed, unknown-version or mismatched-filter
cursors return 400 `VALIDATION_FAILED`. The entire query is limited to 1 KiB.

The cursor is a position, not an access credential or frozen snapshot. Every
page independently checks the current session, role and vehicle ownership.
Changing or copying a cursor cannot grant access to another customer's data.
Each page reads current status; a status change does not move an existing row
between pages. New requests created ahead of the cursor appear on refresh.
Clients should refresh from the first page to see new requests and updated
statuses, and discard pages after sign-out/account change.

## Response

200, using the existing API envelope and requestId:

```json
{
  "data": {
    "items": [{
      "id": "22222222-2222-4222-8222-222222222222",
      "vehicle_id": "11111111-1111-4111-8111-111111111111",
      "vehicle_archived": false,
      "service": "repair",
      "quote_state": "in_review",
      "assignment_state": "none",
      "fulfilment_state": null,
      "money_state": null,
      "customer_stage": "request_received",
      "next_action": "review_request",
      "responsible_role": "operations",
      "created_at": "2026-09-20T13:00:00.000001+00:00",
      "updated_at": "2026-09-20T13:00:00.000001+00:00",
      "next_update_at": "2026-09-20T14:00:00.000001+00:00",
      "is_overdue": true
    }],
    "next_cursor": null,
    "evaluated_at": "2026-09-20T14:01:00+00:00"
  },
  "meta": { "requestId": "example-request-id" }
}
```

Times are examples, not approved response promises. `next_cursor` is non-null
only when another row exists. Empty/final pages return null. No total count is
provided. Summaries omit descriptions, customer IDs, internal response policy,
private media, notification data and event histories. Fetch the existing
`GET /api/v1/care/requests/:id` for the authorised detail/timeline.

`evaluated_at` is database time captured once per page. `is_overdue` is true
when the operations-owned next-update deadline has passed at that time. It
does not change `customer_stage` or claim the escalation worker has run. A
no-match request remains visible with its actual customer recovery action and
no automatic deadline. Archived vehicle history remains visible; reactivation
or a different active vehicle is needed before new work can be requested.

Only receipt, delayed and no-match stages currently exist. Do not manufacture
upcoming appointments, completed jobs, technician activity or payment progress
to fill future My Jobs tabs. The separate state fields remain authoritative.

## Errors and rollout

Existing envelope: 400 `VALIDATION_FAILED`, 401 `UNAUTHENTICATED`,
403 `FORBIDDEN`, 404 `NOT_FOUND`, 503 `CARE_UNAVAILABLE` /
`TEMPORARILY_UNAVAILABLE`, 500 `INTERNAL_ERROR`. Missing list migration fails
closed; no fixture fallback or empty-success substitution. Existing saved
requests remain readable even when the intake response policy is unconfigured.

Backend owns additive migration `202609200003_care_my_jobs.sql`, following
Care's 202609200002 and before Garage's reserved 202609200100. It adds a
customer/creation/ID index and a restricted list RPC without changing existing
mutations, grants or vehicle identity. No live migration is part of this work.

Required evidence: two-customer isolation, noncustomer/anonymous denial,
foreign/missing vehicle parity, archived history, bounded pages, equal-time
and microsecond pagination, status changes between pages, new arrivals,
overdue/no-match semantics, no read side effects, strict API queries and built
route fail-closed checks. PostgreSQL test auth/storage shims do not replace
hosted Supabase session/PostgREST or signed-in-device verification (#1/#8).
Frontend integration and merge wait for dependency/acceptance review; this
contract alone does not enable customer intake or constitute a deployment.
