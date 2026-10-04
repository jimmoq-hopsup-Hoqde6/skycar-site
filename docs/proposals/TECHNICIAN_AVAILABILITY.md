# Technician availability and capacity contract proposal

Status: proposal and executable scenario packet for issue #53. No route, schema,
UI or hosted change is implemented by this document.

## Outcome and boundary

An active, linked technician can store the Adelaide working windows in which
Skycar may propose work. The server remains the authority for both the schedule
and final capacity. A quote is still only a proposal, customer selection is
still only a booking request, and the existing connected `care_journeys` row is
still the only confirmed booking ledger.

This proposal extends D-008; it does not replace its atomic confirmation rule.
`care_journeys` in `scheduled`, `in_progress` or `cancellation_requested` remains
the capacity source. Issued/selected quotes, availability windows and
`booking_requested` journeys are not reservations.

## API proposal

### Read

`GET /api/v1/technician/availability`

- Requires a verified technician session, active `technician` role, and a
  current one-to-one expert/account link.
- Returns private/no-store JSON, varies by Cookie, and supplies the verified
  `X-Skycar-Account` response header.
- An unconfigured schedule is a successful empty record, not invented working
  hours.

```json
{
  "data": {
    "timezone": "Australia/Adelaide",
    "revision": 3,
    "weekly_windows": [
      { "weekday": 1, "starts_at": "09:00", "ends_at": "17:00" },
      { "weekday": 2, "starts_at": "09:00", "ends_at": "17:00" }
    ],
    "exceptions": [
      { "date": "2026-12-25", "windows": [] },
      { "date": "2026-12-28", "windows": [
        {
          "starts_at": "10:00", "starts_at_offset": "+10:30",
          "ends_at": "14:00", "ends_at_offset": "+10:30"
        }
      ] }
    ],
    "evaluated_at": "2026-10-05T00:00:00Z"
  }
}
```

Weekday uses ISO Monday `1` through Sunday `7`. Times are zero-padded local
wall-clock minutes. Windows are half-open `[starts_at, ends_at)` and cannot cross
midnight; an overnight period is represented by two windows on adjacent days.
An exception replaces, rather than adds to, the recurring windows for its date.
Exception offsets are required and must match Adelaide at the named boundary;
this makes a dated override unambiguous without trusting the device timezone.

### Replace

`PUT /api/v1/technician/availability`

Required headers:

- `Content-Type: application/json`
- UUID `Idempotency-Key`
- `X-Skycar-Account` equal to the last verified read; authentication never
  trusts this header
- same-origin `Origin`

Exact request body:

```json
{
  "expected_revision": 3,
  "timezone": "Australia/Adelaide",
  "weekly_windows": [],
  "exceptions": []
}
```

Exact result:

```json
{
  "data": {
    "revision": 4,
    "replayed": false
  }
}
```

The replacement and its audit/idempotency record commit atomically. Exact
actor/key/body replay returns the stored result with `replayed:true`. Reusing a
key with any changed field returns `IDEMPOTENCY_CONFLICT`. A stale
`expected_revision` returns `REVISION_CONFLICT` with no mutation.

## Validation and limits

- `timezone` is exactly `Australia/Adelaide` for this MVP.
- At most 28 recurring windows and 366 dated exceptions are accepted.
- Exceptions must use real ISO calendar dates from today through 18 months
  ahead and contain at most 8 windows each. Every exception window contains
  exactly `starts_at`, `starts_at_offset`, `ends_at`, `ends_at_offset`; offsets
  are `+09:30` or `+10:30` and must resolve each wall time in Adelaide.
- A window is at least 15 minutes, ends after it starts on the same local day,
  and has minute precision. Windows on one day must be sorted, non-overlapping
  and non-adjacent; clients merge adjacent windows into one canonical window.
- Unknown keys, duplicate dates, invalid dates, seconds, offsets in wall-time
  fields, oversized bodies and unsupported timezones fail validation.
- An empty weekly schedule plus empty exceptions means no technician-published
  availability. It never means always available.

Proposed errors follow the existing private technician boundary:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Body, window, date or timezone is invalid |
| 401 | `UNAUTHENTICATED` | No current technician session |
| 403 | `FORBIDDEN` / `CSRF_FAILED` | Role or trusted-origin check failed |
| 404 | `NOT_FOUND` | No active linked expert; does not disclose another link |
| 409 | `REVISION_CONFLICT` | Schedule changed after the last read |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key was reused for different input |
| 413 | `PAYLOAD_TOO_LARGE` | Bounded JSON body exceeded |
| 503 | `TECHNICIAN_UNAVAILABLE` | Authority could not be verified; safe exact retry |

All error and success responses remain private/no-store. Access denial or a
different verified response account clears the browser's schedule draft and
pending retry. A transient failure retains only the exact key/body in memory;
focus refresh may reconcile but never automatically repeats a write.

## Adelaide time and daylight-saving rules

Stored rules are local wall-clock intentions with the IANA zone
`Australia/Adelaide`. Proposed appointment timestamps remain absolute,
timezone-qualified instants. The server uses its pinned timezone database to
expand rules for a specific date and compares instants, never browser locale
strings.

- If a recurring boundary lands in a nonexistent spring-forward local time,
  that occurrence is unavailable. The technician must add a valid dated
  exception; the server does not silently shift it.
- If a recurring boundary lands in an ambiguous fall-back local time, that
  occurrence is unavailable until a dated exception supplies explicit offsets
  that match Adelaide for that date.
- Ordinary windows on a transition day, such as daytime hours, expand normally
  using the offset in force at each boundary.
- UI displays both local date/time and `Australia/Adelaide`; device timezone is
  not booking authority.

For reference, `2026-10-04 02:30` is nonexistent in Adelaide, while
`2027-04-04 02:30` is ambiguous. These dates are scenario fixtures, not a
permanent hard-coded daylight-saving calendar.

## Quote, selection and confirmation rules

For technician-submitted quotes:

1. Quote submission requires the proposed absolute `[start,end)` to fit one
   effective schedule window. Missing availability returns
   `AVAILABILITY_REQUIRED`; outside/ambiguous/nonexistent time returns
   `SLOT_UNAVAILABLE`.
2. Customer selection rechecks the technician's current role/link,
   service/postcode/insurance and effective availability. It remains a request,
   not a hold.
3. Operations confirmation takes the existing expert advisory lock and checks,
   in one transaction, current eligibility, current effective availability,
   appointment still in the future, and overlap against confirmed journeys.
4. At most one competing confirmation succeeds. Adjacent appointments are not
   overlapping because capacity intervals are half-open.

Operations-authored quotes without technician provenance retain D-008's manual
availability assertion and atomic overlap check. They do not create a fake
technician calendar. A future implementation must make this distinction from
stored provenance, never a browser-supplied flag.

Changing availability does not rewrite or cancel `scheduled`, `in_progress` or
`cancellation_requested` work. Those remain capacity commitments. It can make
an unconfirmed technician quote/request unavailable at its next server recheck,
in which case operations must obtain a new valid proposal.

## Cancellation and rescheduling

- `cancellation_requested` continues to occupy capacity until operations records
  `cancelled`. Only `cancelled` releases it.
- Quote expiry does not release capacity because a quote never held capacity.
- Rescheduling must stay on the same journey. The proposed design keeps the
  confirmed `starts_at`/`ends_at` blocking capacity while a separate proposed
  interval is reviewed. Atomic confirmation checks the new interval and swaps
  it into the same journey; rejection leaves the original appointment intact.
- Do not implement rescheduling by creating a second booking row or silently
  editing confirmed times. State/event/API additions require their own reviewed
  contract and migration owner.

## Proposed persistence and integration ownership

Future Backend-owned forward migration (timestamp allocated only at handoff):

- one private schedule header per `expert_id` with timezone, revision and
  timestamps;
- ordered recurring-window and dated-exception rows, or an equivalently strict
  normalized representation;
- an actor-scoped idempotency ledger and audit event;
- no direct `anon`/`authenticated` table or RPC execution;
- service-only security-invoker commands that recheck role/link before replay.

Expected implementation intersections requiring Delivery & Review allocation:

- new technician availability route/repository/domain/UI files;
- a new forward migration and PostgreSQL acceptance suite;
- bounded changes to technician quote authority and the existing connected
  journey selection/confirmation RPC;
- customer/operations copy for a slot that became unavailable;
- browser tests for exact retry, account clearing and Adelaide display.

No implementation writer should edit the frozen #59 revision. Integration must
base on its accepted descendant, allocate one migration owner, publish exact
contract deltas before consumption and preserve the existing booking ledger.

## Acceptance matrix

`tests/review/availability-scenarios.test.mjs` is an executable reference suite.
It proves canonical windows, half-open overlap, availability containment,
schedule-edit behavior, cancellation release, non-reserving quotes, competing
confirmation, stale revisions and Adelaide DST edge cases. It is contract
evidence only: it does not prove a database, API, hosted Auth/RLS, browser or
physical device implementation.

Future implementation acceptance additionally requires real PostgreSQL
concurrent confirmation/edit cases, role/link/account/source revocation, audit
rollback, strict HTTP decoding, full browser recovery, hosted two-account
Auth/RLS/private-data checks and physical-phone review under #8.
