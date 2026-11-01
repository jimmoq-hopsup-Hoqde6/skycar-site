# Technician availability: enforcement delta

Builds on PR #76 (`5374cea`, `20261101062300_technician_availability.sql`). Names below are #76's:
tables `care_technician_availability`, `_windows`, `_exception_days`, `_exception_windows`, `_commands`;
RPCs `care_technician_availability_read(p_actor)` and
`care_technician_replace_availability(p_actor, p_key, p_expected_revision, p_payload)`.
#76's own contract stays in `docs/TECHNICIAN_AVAILABILITY_API.md`; this file only covers what
`20261101063000_technician_availability_enforcement_delta.sql` adds. Nothing here edits #76's
migration, `care_journey_command`, or any existing migration.

## `care_technician_availability_check(p_expert_id, p_starts, p_ends)`

Read-only seam for the quote, selection and confirmation commands. `service_role` only,
`SECURITY INVOKER`, `search_path=''`, `STABLE`. Returns text:

| Result | Meaning |
| --- | --- |
| `AVAILABILITY_REQUIRED` | The expert has no `care_technician_availability` row (never published). |
| `SLOT_UNAVAILABLE` | A schedule exists but `[p_starts, p_ends]` is not inside exactly one window. |
| `AVAILABLE` | One window on the Adelaide date of `p_starts` covers the whole slot. |

Invalid input (`NULL`, infinite, `p_ends <= p_starts`) raises `P0001 VALIDATION_FAILED`; any other
role raises `P0001 FORBIDDEN`, matching #76.

A published-but-empty schedule (revision 1, no windows) is a deliberate statement and returns
`SLOT_UNAVAILABLE`, not `AVAILABILITY_REQUIRED`.

### Rules (same as #76's DST rules)

- Zone is `Australia/Adelaide`. The day is the Adelaide date of `p_starts`; a slot that crosses local midnight is unavailable.
- A dated exception replaces the weekly windows for its date. An exception date with no windows means closed.
- Exception windows use their stored explicit offsets (`+09:30` / `+10:30`), so the repeated fall-back hour is addressed unambiguously.
- Weekly windows carry no offset. A weekly boundary that is ambiguous (fall-back) or nonexistent (spring-forward) fails closed: that window is not available.
- Windows are half-open: a slot may end exactly at a window's end.
- Plain `SELECT`s only: no advisory lock, no row lock, no write, no read of `care_journeys`. It cannot join the journey lock order (advisory, vehicle, request, journey) and cannot deadlock with it.

### Wiring still to do (not in this delta)

Calling it from `care_journey_command` (quote/select/confirm) is a separate change to that function.
It should be called inside the existing confirmation transaction. Confirmed-booking overlap stays with
the existing atomic confirmation check and the `care:expert-capacity` advisory lock; the check only
answers "did the technician offer this time".

## Constraints added

| Constraint | Table | Rule |
| --- | --- | --- |
| `care_technician_availability_windows_no_overlap` | windows | `EXCLUDE USING gist (expert_id =, weekday =, int4range(starts_minute, ends_minute) &&)` |
| `care_technician_availability_exception_windows_instant_order` | exception windows | the window must end after it starts in real time |
| `care_technician_availability_exception_windows_no_overlap` | exception windows | `EXCLUDE USING gist (expert_id =, tstzrange(start instant, end instant) &&)` |

Why exclusion and not a trigger: both shapes are expressible with `btree_gist` and an `IMMUTABLE`
arithmetic helper (`care_technician_availability_offset_instant`: wall date + minute minus the stored
offset, no tz lookup), so the database enforces it for every writer, with no trigger ordering or
locking to reason about. Weekly windows are recurring wall minutes with no DST, so a minute range is exact.
Exception windows must be compared as instants.

Defects in #76's RPC that these close (each reproduced against `5374cea`):

1. It accepts an inverted exception window on a fall-back date, e.g. `02:30 +09:30` to `02:45 +10:30`
   ends 45 minutes before it starts.
2. It accepts exception windows whose wall minutes are disjoint but whose instants overlap
   (e.g. `02:00-02:50 +09:30` then `02:55 +10:30`-`03:10 +09:30`).

Existing data: a preflight block raises `AVAILABILITY_DELTA_PREFLIGHT_FAILED` with counts, and the
whole migration rolls back, if any stored row would violate a new constraint. The migration is
forward-only and creates no sequences. #76 created none (no identity or serial columns), so there is
nothing to revoke; the test asserts that.

## `care_technician_replace_availability`: authority re-check

#76 (`20261101062300_technician_availability.sql`) checks `current_user` and the `technician` role at
lines 189-192, before it takes any lock. The idempotency advisory lock is taken at line 200 and the
expert link is read at lines 203-206. The schedule advisory lock (281) and row lock (282) follow,
and nothing is re-checked after them. A role revoked, or an account or expert deactivated, while a
request waits on either lock still wrote the schedule.

The delta does a forward-only `create or replace` with the same signature, body and grants, adding two
re-checks: the role after the idempotency lock, and role plus active expert link (same expert) after the
schedule locks. A revoke that commits after the final re-check but before the transaction commits is
not excluded (no row lock is taken, so `service_role` needs no extra privilege).

## Open questions / follow-ups

- Through #76's RPC the new constraints surface as raw `23514` / `23P01` errors, because its `exception` handler does not map them. Mapping them to `VALIDATION_FAILED` needs another replacement of that function.
- `AVAILABILITY_REQUIRED` means "no row". If product wants "revision 0 / never published" and "published empty" to behave the same, change the check.
- `24:00` is not representable and windows end at `23:59` at the latest (#76's rule); a window cannot span local midnight.
