# Technician availability API

Status: implemented schedule contract for issue #53. This does not change quote
submission or operations confirmation, and it does not take the booking locks.

`care_journeys` in `scheduled`, `in_progress` or `cancellation_requested` remains
the only capacity ledger. Saving hours does not reserve, move, or cancel a job.
A quote is still a proposal. Customer selection is still a request. Operations
confirmation still uses the existing atomic overlap check.

## Read

`GET /api/v1/technician/availability`

Requires a verified technician session, an active `technician` role, and one
active expert link. An unlinked technician is `NOT_FOUND`. An empty schedule is
revision `0`, not implied availability.

```json
{
  "data": {
    "timezone": "Australia/Adelaide",
    "revision": 0,
    "weekly_windows": [],
    "exceptions": [],
    "evaluated_at": "2026-11-01T00:30:00.000Z"
  }
}
```

Weekday is ISO Monday `1` through Sunday `7`. Windows are half-open
`[starts_at, ends_at)` on one local day. An exception replaces that date. An
empty exception window list means the date is closed.

## Replace

`PUT /api/v1/technician/availability`

Headers: `Content-Type: application/json`, UUID `Idempotency-Key`,
`X-Skycar-Account` from the last verified read, and a same-origin `Origin`.
The account header is checked against the session. It is not authentication.

```json
{
  "expected_revision": 0,
  "timezone": "Australia/Adelaide",
  "weekly_windows": [{ "weekday": 1, "starts_at": "09:00", "ends_at": "17:00" }],
  "exceptions": [{ "date": "2026-12-25", "windows": [] }]
}
```

Success:

```json
{ "data": { "revision": 1, "replayed": false } }
```

The replacement, audit row and idempotency row commit together. The same
actor, key and body returns `replayed: true`. A changed body or a different
linked expert with the same key returns `IDEMPOTENCY_CONFLICT`. A stale
`expected_revision` returns `REVISION_CONFLICT` and writes nothing.

## Rules enforced here

- Timezone is exactly `Australia/Adelaide`.
- At most 28 weekly windows and 366 exceptions, with at most 8 windows each.
- Each window is at least 15 minutes, minute precision, and does not cross
  midnight. `24:00` is rejected. Touching or overlapping windows are rejected.
- Exception dates run from the Adelaide current date through 18 months and
  must be listed once, in order.
- Exception offsets are `+09:30` or `+10:30` and must be the Adelaide offset at
  that wall time. A missing spring-forward time is rejected. An ambiguous
  fall-back time is accepted only with the offset that matches that instant.
- Weekly hours that would fall in a missing or ambiguous time are stored as
  wall-clock rules. This slice does not expand them into bookings.
- Direct table and function access is revoked from `anon` and `authenticated`.
  The commands run as `service_role` and recheck the technician role and link.
- Lock namespaces are `care:technician-availability:` and
  `care:technician-availability-schedule:`. They are not
  `care:expert-capacity:` and the commands do not lock `care_journeys`.

## Not in this slice

Quote submission and operations confirmation do not yet reject a slot that sits
outside the saved hours. That check needs its own reviewed change to the
existing journey command. Rescheduling is not implemented. No provider, payment,
notification, hosted credential, or protected environment is changed.

The basic screen is `/technician/availability`. It edits weekly hours and one
replacement window per date. A date that already has several windows is kept
when the first window is unchanged.
