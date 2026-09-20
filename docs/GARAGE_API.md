# Garage vehicle API — first executable slice

Tracks #2. Based on D-006 and the merged shared `public.vehicles` model.
This contract precedes frontend integration. It does not activate vehicle-photo processing,
Care bookings, benefits, reminders or provider integrations.

## Access and envelopes

All routes require `FEATURE_GARAGE=true`, configured Supabase, and a verified cookie
session. No service-role key is used by the HTTP application. Unauthenticated requests
return 401; missing configuration/disabled feature returns 503. Private responses use
`Cache-Control: private, no-store` and `Vary: Cookie`.

Success: `{ "data": ..., "meta": { "requestId": "uuid" } }`.
Error: `{ "error": { "code": "...", "message": "...", "fieldErrors": {},
"retryable": false }, "meta": { "requestId": "uuid" } }`.

Writes require `Content-Type: application/json`, an `Origin` exactly matching the
request URL origin, and an `Idempotency-Key` UUID. Proxies must preserve the canonical
request origin. Cross-origin and absent-Origin writes fail closed (403). Bodies are
limited to 8 KiB. Unknown properties, including owner, role, state and timestamps,
are rejected. Ownership is always the verified session user; unknown and other-owner
vehicle IDs both return 404.

Idempotency keys are scoped to authenticated actor and retained in a private database
ledger. Replaying the same command/vehicle/payload returns the original committed
vehicle snapshot. Reusing a key with different input returns 409. Mutations and their
history/audit/ledger records commit atomically. Retry an uncertain result with the
same key and input. A fresh user edit must use a new key.

## Routes

| Route | Input | Result |
| --- | --- | --- |
| GET `/api/v1/garage/vehicles` | `archived=false` (default) or `true`; `limit=1..50` (default 20); optional UUID `after` cursor | `{items: Vehicle[], nextCursor: UUID \| null}` ordered by ID ascending, filtered to owner and archive state |
| POST `/api/v1/garage/vehicles` | Full vehicle input below | Vehicle (201; replays also 201) |
| GET `/api/v1/garage/vehicles/{id}` | UUID | Vehicle, including archived vehicles |
| PATCH `/api/v1/garage/vehicles/{id}` | Full vehicle input plus `expected_revision` positive integer | Vehicle; stale revision or archived vehicle is 409 |
| POST `/api/v1/garage/vehicles/{id}/archive` | `{ "expected_revision": 1 }` | Archived Vehicle; no hard delete or restore in this slice |
| GET `/api/v1/garage/vehicles/{id}/history` | `limit=1..50`; optional opaque `after` cursor | `{items: HistoryEvent[], nextCursor}` ordered by occurrence time descending, then ID descending for stable pagination |

```json
{
  "make": "Toyota",
  "model": "Corolla",
  "variant": "Ascent Sport",
  "year": 2020,
  "registration": "ABC123",
  "registration_state": "SA"
}
```

`make` and `model`: trimmed 1–80 characters. `variant`: trimmed string up to 120 or
null. `year`: integer 1886–2200 or null (foundation range; not VIN verification).
`registration`: trimmed 1–16 letters/digits/spaces/hyphens or null, uppercased.
`registration_state`: ACT/NSW/NT/QLD/SA/TAS/VIC/WA or null. Empty optional form
fields are sent as null. At the API, empty strings and invalid types are rejected.
Registration is user-entered, never a verified registration/history claim.

Vehicle response contains `id`, `make`, `model`, `variant`, `year`, `registration`,
`registration_state`, `revision`, `archived_at`, `created_at`, `updated_at`.
It excludes owner IDs. HistoryEvent contains `id`, `event_type`, `occurred_at`,
`source`, `payload`, `created_at`. Garage mutation events contain revision and
changed field names; never duplicate private registration values into logs.

## Stable errors and UI rules

| Status | Code | UI action |
| --- | --- | --- |
| 400 | VALIDATION_FAILED / INVALID_JSON | Show field/form error; preserve input |
| 401 | UNAUTHENTICATED | Show session-required state; no mutation controls |
| 403 | ORIGIN_REJECTED | Stop mutation; do not retry cross-origin |
| 404 | NOT_FOUND | Reload list; no existence disclosure |
| 409 | REVISION_CONFLICT / VEHICLE_ARCHIVED | Preserve input; reload current vehicle before another edit |
| 409 | IDEMPOTENCY_CONFLICT | Do not silently retry with another key |
| 413 | PAYLOAD_TOO_LARGE | Ask for smaller input |
| 415 | UNSUPPORTED_MEDIA_TYPE | JSON only |
| 503 | GARAGE_UNAVAILABLE / TEMPORARILY_UNAVAILABLE | Preserve input; retry with the same key after recovery |
| 500 | INTERNAL_ERROR | Generic error with request ID; never expose database messages |

Lists have explicit loading, empty, unavailable, sign-in-required and retry states.
The UI waits for server success and refreshes data; it must not pretend persistence
or background-photo processing succeeded. Archive requires confirmation. Archived
vehicles remain accessible in the archived list/history and cannot be edited.

## Migration and validation boundary

`202609200100_garage_mutations.sql` adds a vehicle revision, private mutation ledger,
and an authenticated RPC. It preserves vehicle IDs and ownership. Direct authenticated
vehicle/history writes are revoked; consumers must use an audited, validated server
mutation. Owner-entered odometer/reminder APIs are a follow-up, not direct inserts. Care reads/references
remain unchanged. This access change is recorded in D-007 before implementation.

Release still requires applying migrations to an isolated Supabase environment,
two-user RLS/RPC tests, session-refresh/auth integration and signed-in device QA.
Pure API tests with a fake repository do not establish live RLS correctness.
