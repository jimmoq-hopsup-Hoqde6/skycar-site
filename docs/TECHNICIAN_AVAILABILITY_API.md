# Technician availability contract — backend slice (issue #53)

Status: DRAFT implementation contract. It describes exactly what migration
`20261101060000_technician_availability_contract.sql` implements and what is
deliberately left for later reviewed deltas. It extends
[docs/proposals/TECHNICIAN_AVAILABILITY.md](proposals/TECHNICIAN_AVAILABILITY.md)
(PR #60) and does not replace D-008. Issue #53 requires the M2 contract owner
and Delivery lead to acknowledge this handoff before it is merged; see
[Open questions](#open-questions-for-the-m2-contract-owner-and-delivery-lead).

Base: accepted PR #74 head `18240dc137a66660ef9251101df906159ffae9a4`.
Migration timestamp `20261101060000` is provisional until a migration owner is
allocated.

## Scope

In this slice:
- four new private tables and three service-only RPCs (read, replace, check);
- one `SECURITY DEFINER` helper used only by owner-SELECT RLS policies;
- PostgreSQL acceptance tests in `tests/integration/technician-availability.acceptance.mjs`.

Not in this slice (no existing function, table, route or UI is changed):
- the HTTP route `GET|PUT /api/v1/technician/availability` (the RPC shapes
  below are what the route will wrap; the route itself stays proposal-only);
- enforcement at quote submission, customer selection or operations
  confirmation (see [Enforcement seam](#enforcement-seam));
- rescheduling, notifications, operations-authored schedules.

`care_journeys` in `scheduled`, `in_progress` or `cancellation_requested`
remains the only booking/capacity ledger. These tables hold working-hour
intentions and never reserve capacity.

## RPCs

All three are executable by `service_role` only (revoked from public, anon and
authenticated), `SECURITY INVOKER`, `set search_path = ''`, and begin with
`current_user = 'service_role'`. The actor comes from the verified session in the
server tier, never from a request body.

### `care_technician_availability_read(p_actor uuid) returns jsonb`

Stable, takes no explicit locks. `FORBIDDEN` unless `p_actor` has the stored
`technician` role; `NOT_FOUND` unless it has an active
`care_technician_accounts` link to an active `care_experts` row. An unconfigured
schedule is a successful empty record, never "always available".

```json
{
  "timezone": "Australia/Adelaide",
  "revision": 3,
  "weekly_windows": [
    { "weekday": 1, "starts_at": "09:00", "ends_at": "12:00" },
    { "weekday": 1, "starts_at": "13:00", "ends_at": "17:00" },
    { "weekday": 7, "starts_at": "22:00", "ends_at": "24:00" }
  ],
  "exceptions": [
    { "date": "2026-12-25", "windows": [] },
    { "date": "2026-12-28", "windows": [
      { "starts_at": "10:00", "starts_at_offset": "+10:30",
        "ends_at": "14:00", "ends_at_offset": "+10:30" } ] }
  ],
  "evaluated_at": "2026-11-01T06:00:00.123456+00:00"
}
```

Ordering is canonical (weekday, start; date ascending). Exceptions dated before
today (Adelaide) are not returned. A schedule that was never written returns
`revision: 0` with empty arrays.

### `care_technician_availability_replace(p_actor uuid, p_key uuid, p_payload jsonb) returns jsonb`

Replaces the whole schedule atomically. `p_payload` must contain exactly these
keys (unknown or missing keys are `VALIDATION_FAILED` / `BODY`):

```json
{
  "expected_revision": 3,
  "timezone": "Australia/Adelaide",
  "weekly_windows": [ { "weekday": 1, "starts_at": "09:00", "ends_at": "17:00" } ],
  "exceptions": [ { "date": "2026-12-25", "windows": [] } ]
}
```

Result: `{"revision": 4, "replayed": false}` (replay: `"replayed": true`).

Field rules:

| Field | Rule |
| --- | --- |
| `expected_revision` | integer, 1–9 digits, must equal the stored revision (new schedule = `0`) |
| `timezone` | exactly `Australia/Adelaide` |
| `weekday` | integer 1 (Monday) – 7 (Sunday) |
| `starts_at` | `HH:MM`, 00:00–23:59 |
| `ends_at` | `HH:MM`, or `24:00` (end-of-day, end only) |
| window length | at least 15 minutes; half-open `[start, end)`; cannot cross midnight (use two windows on adjacent days) |
| windows per weekday | sorted by start, non-overlapping, **non-adjacent** (clients merge touching windows) |
| `exceptions[].date` | real ISO date, today (Adelaide) through today + 18 months, unique, ascending |
| exception `windows` | 0–8; empty = day off; **replaces** (does not add to) the weekly windows for that date |
| exception offsets | all four of `starts_at`, `starts_at_offset`, `ends_at`, `ends_at_offset` required; offsets are `+09:30` or `+10:30` and must be the offset in force in Adelaide at that wall time |
| limits | ≤ 28 weekly windows, ≤ 366 exceptions |

An empty weekly list plus empty exceptions publishes no availability.

### `care_technician_availability_check(p_expert_id uuid, p_starts timestamptz, p_ends timestamptz) returns text`

Read-only, lock-free enforcement seam. Returns:

- `AVAILABILITY_REQUIRED` — the expert has published no weekly window and no
  current/future exception window;
- `SLOT_UNAVAILABLE` — outside every window, on a day off, or touching a window
  boundary that is nonexistent/ambiguous in Adelaide;
- `AVAILABLE` — the whole `[p_starts, p_ends)` interval fits **one** effective window.

The local date is taken from `p_starts` in `Australia/Adelaide` and only that
date's effective windows are considered, so an interval that crosses local
midnight is `SLOT_UNAVAILABLE` (windows cannot cross midnight). An exception for
the date wins over weekly windows. `VALIDATION_FAILED` (no detail) is raised for
null, non-finite or `p_ends <= p_starts` input. It never reads `care_journeys`: overlap with
confirmed work remains the existing atomic confirmation check.

## Error codes

Raised as `errcode 'P0001'` with the code as the message, like every Care RPC.
`VALIDATION_FAILED` additionally carries a machine-readable `DETAIL`.

| Message | When | Proposed HTTP (route not in this slice) |
| --- | --- | --- |
| `FORBIDDEN` | caller is not `service_role`, null actor, or actor lacks the technician role | 403 |
| `NOT_FOUND` | no active linked active expert (does not disclose other links) | 404 |
| `VALIDATION_FAILED` | see details below | 400 |
| `REVISION_CONFLICT` | `expected_revision` ≠ stored revision; nothing mutated | 409 |
| `IDEMPOTENCY_CONFLICT` | same actor/key reused with a different action or payload | 409 |

`DETAIL` values: `BODY`, `TIMEZONE`, `TOO_MANY`, `WINDOW_SHAPE`, `WINDOW_RANGE`,
`WINDOW_ORDER`, `WINDOW_OVERLAP`, `WINDOW_ADJACENT`, `EXCEPTION_SHAPE`,
`DATE_OUT_OF_RANGE`, `DUPLICATE_DATE`, `EXCEPTION_ORDER`, `OFFSET_MISMATCH`,
`INVALID_VALUE` (malformed date/number text). The check seam additionally
returns the *values* `AVAILABILITY_REQUIRED` / `SLOT_UNAVAILABLE`; when wired in
later, those become error messages of the calling RPC and need HTTP mappings
(`SLOT_UNAVAILABLE` already exists for confirmation).

## Idempotency

Ledger `care_technician_availability_commands`, primary key
`(actor_id, idempotency_key)`, stores action, exact payload and result.

1. Role, expert link and basic body shape are checked first, so a replay is never
   served to a technician who has lost the role or link.
2. A new advisory lock `care:technician-availability:<actor>:<key>` serialises
   first attempts and retries of the same key.
3. Exact replay (same action, `jsonb`-equal payload) returns the stored result
   with `replayed: true` — even if the schedule has since moved to a later
   revision. Any difference returns `IDEMPOTENCY_CONFLICT`.
4. Replace, ledger row and `care.technician_availability_replace` audit event
   commit in one transaction; an audit failure rolls everything back.
5. Concurrent replaces on one schedule serialise on the header row; exactly one
   wins per `expected_revision`, the rest get `REVISION_CONFLICT`.

The ledger has no expiry in this slice (see open questions).

## Lock order

`care_technician_availability_replace` (the only writer):

1. plain read of `user_roles`;
2. `care_experts` + `care_technician_accounts` `FOR SHARE` (same first step and
   mode as `care_technician_job_command` / `care_technician_work_command`);
3. advisory lock `care:technician-availability:<actor>:<key>` (new namespace);
4. header row `care_technician_availability` `FOR UPDATE`;
5. rows of the new windows / exceptions / commands tables;
6. `audit_events` insert.

It never locks `vehicles`, `care_requests`, `care_journeys`,
`care_reviewed_quotes`, `care_journey_commands` or the
`care:expert-capacity:<id>` advisory lock, so it cannot join a wait cycle with
the canonical actor/key → vehicle → request → journey order, with the
journey-before-request order that `care_journey_command` start/complete/cancel
use today, or with confirmation's capacity lock. Read and check functions take
no explicit locks. The acceptance test proves this with `pg_locks` and two
concurrent sessions against `care_journey_command` confirm and cancel in both
directions.

## RLS and privilege posture

- RLS is enabled on all four tables; all privileges are revoked from `public`,
  `anon` and `authenticated` first.
- `service_role`: select/insert/update on header and commands, select/insert/
  delete on exceptions and windows (plus the identity sequence).
- `authenticated`: `SELECT` only, on header, exceptions and windows, through
  policies `care_availability_owner_select`,
  `care_availability_exceptions_owner_select` and
  `care_availability_windows_owner_select`. A row is visible only when
  `care_technician_owns_expert(expert_id)` is true. There is no insert/update/
  delete grant or policy for any browser role; the commands ledger is never
  exposed. Customers and anon have no access of any kind.
- `care_technician_owns_expert(uuid)` is the only `SECURITY DEFINER` object:
  `stable`, `search_path = ''`, derives identity from `auth.uid()`, returns only
  a boolean about the caller (active link + technician role). It exists because
  `care_technician_accounts` deliberately has no browser privileges.
- Pure helper functions are `service_role`-only and take no table access.

The browser `SELECT` grant is a deliberate, small addition to the repo's
"no browser grants" posture to satisfy "technician owns own rows"; it can be
dropped without affecting the RPC contract (server-mediated reads remain).

## Adelaide time and DST rules

- Rules are local wall-clock intentions in `Australia/Adelaide`; appointment
  instants stay absolute `timestamptz`. Comparisons are on instants, never
  browser locale strings.
- Weekly windows carry no offset. Each boundary is mapped to an instant per
  date; if the wall time is **nonexistent** (spring forward, e.g. 02:30 on the
  first Sunday of October) or **ambiguous** (fall back, e.g. 02:30 on the first
  Sunday of April) the mapping is `NULL` and that window cannot cover anything
  that day. The server never shifts it. Other windows that day still work.
- Exception windows require explicit `+09:30`/`+10:30` offsets, validated at
  write time against Adelaide at that wall time (`OFFSET_MISMATCH`), which makes
  a dated override unambiguous on transition days.
- Ordinary daytime windows on a transition day expand with the offset in force at
  each boundary. `24:00` is midnight at the end of the local date (no Adelaide
  transition occurs at midnight).
- The tests locate the next real transitions from the pinned timezone database
  instead of hard-coding dates.

## Enforcement seam

Nothing calls `care_technician_availability_check` yet. Proposed wiring, as one
separately reviewed delta owned by M2 (it must replace `care_journey_command`
and `care_technician_job_command` in full, so it must not be bundled with this
backend slice):

1. Technician quote submission (`care_technician_job_command` `quote`, after the
   eligibility check): `AVAILABILITY_REQUIRED` / `SLOT_UNAVAILABLE`.
2. Customer selection (`care_journey_command` `select_quote`, next to the
   existing expert eligibility check): recheck; still a request, not a hold.
3. Operations confirmation (`care_journey_command` `confirm`, after the
   `care:expert-capacity:<id>` advisory lock and before the existing overlap
   query): current availability **and** existing overlap/future-start checks in
   one transaction; adjacent appointments remain non-overlapping.

Because `check` is a lock-free snapshot read it adds no lock edges to any of
these functions. Under READ COMMITTED a concurrent `replace` is observed either
wholly before or wholly after the check statement. Operations-authored quotes
without technician provenance keep D-008's manual assertion; provenance must be
read from stored `care_reviewed_quotes.submitted_by_technician`, never from a
browser flag. Changing availability never rewrites or cancels `scheduled`,
`in_progress` or `cancellation_requested` journeys.

## Verification evidence

`tests/integration/technician-availability.acceptance.mjs` (run from
`tests/integration/garage-care-db.test.mjs` on disposable PostgreSQL 17.6 with
auth shims): authority/role/link, browser-role denial, RLS allow/deny,
idempotent replay and conflict, stale revisions, ~40 invalid-input cases,
exclusion-constraint rejection, DST fixtures, two-session concurrency vs
`care_journey_command`, 8-way revision race, 6-way same-key race, audit rollback
and a forward-only snapshot diff. Hosted Supabase Auth/RLS is **not** proven.

## Open questions for the M2 contract owner and Delivery lead

1. **Handoff/ownership (blocking per #53):** who owns the migration and its
   timestamp? Is `20261101060000` acceptable, and is basing on PR #74 head
   `18240dc` (not main) accepted? Please comment on #50/#53.
2. **Enforcement delta:** accept quote → select → confirm as the three enforcement
   points, or confirm-only? Who writes the full-function replacement of
   `care_journey_command`?
3. **Lock-order inversion:** `care_journey_command` start/complete/cancel take the
   journey row before the request row, opposite to confirm and all technician
   commands (reproduced as a deadlock on a disposable DB; local draft issue). The
   enforcement delta rewrites the same function — should the fix ride with it or
   stay a separate migration?
4. **Provenance:** is `care_reviewed_quotes.submitted_by_technician` the agreed
   authoritative marker for exempting operations-authored quotes?
5. **`24:00` end-only:** the proposal specifies `HH:MM` and no midnight crossing.
   `24:00` as an exclusive end lets a late shift end at midnight. Accept or
   require two-window representation?
6. **Browser read grant:** keep owner-`SELECT` through RLS, or make reads
   server-mediated only (drop the three policies and `care_technician_owns_expert`)?
7. **Limits and horizon:** 28 weekly windows, 366 exceptions, 8 windows per
   exception, 18-month horizon, 15-minute minimum — confirm or adjust.
8. **Retention:** the idempotency ledger and `audit_events` rows grow without
   expiry; is a retention policy needed before launch? Past exceptions are only
   dropped at the next replace.
9. **Stale unconfirmed requests:** when an edit makes a `quotes_ready` /
   `booking_requested` slot unavailable, what do customer and operations see
   (copy, notification, new-quote request)? Nothing is sent by this slice.
10. **Delivery routing:** the HTTP route/repository/UI files and HTTP mappings for
    `AVAILABILITY_REQUIRED` / `SLOT_UNAVAILABLE` need an owner; rescheduling needs
    its own contract.
11. **CI:** `.github/workflows/care-database.yml` runs only
    `tests/integration/care-db.test.mjs`; the suite containing this test is
    `garage-care-db.test.mjs`. Is that suite gated anywhere? Also the PR #74
    "nine-file manifest" becomes ten.
12. **Hosted prerequisites:** `btree_gist` must be installable (the migration uses
    the `extensions` schema when present); hosted two-account Auth/RLS acceptance
    (#51/#8) is still required.
