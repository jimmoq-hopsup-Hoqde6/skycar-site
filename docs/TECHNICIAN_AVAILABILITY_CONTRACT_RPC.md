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

## `care_technician_replace_availability`: authority locking and re-check

#76 (`20261101062300_technician_availability.sql`) checks `current_user` and the `technician` role at
lines 189-192 and reads the expert link at lines 203-207, all before the schedule advisory lock (281)
and row lock (282), without locking anything, and never re-checks. A role revoked, or an account or
expert deactivated or deleted, while a write waited on an advisory lock still wrote the schedule and
its audit/command rows (QA repro: 4 of 4).

The delta does a forward-only `create or replace` (same signature, grants and body) with these changes:

1. After the cheap input checks and **before any advisory wait**, `select ... for share of e, a` on the
   active `care_experts` + `care_technician_accounts` rows (the pattern
   `care_technician_work_command` and the quote/completion commands already use). A deactivation or
   deletion of either row now queues behind the write instead of committing in the middle of it, so the
   write is serialised before the revocation. If the link is already inactive the call fails
   `NOT_FOUND` (new key or replay).
2. The `technician` role is re-checked after the idempotency advisory lock and again after the schedule
   advisory/row lock. `user_roles` is not row-locked here, so a role revoked while waiting is refused
   `FORBIDDEN`; a revoke that commits after the last re-check but before this transaction commits is not
   excluded.

Deadlock analysis against `care_technician_admin_command` (expert `KEY SHARE`, then advisory
`care:technician-link`, then an insert into `care_technician_accounts`): `FOR SHARE` does not conflict with
`KEY SHARE`; the availability write never takes `care:technician-link` or `care:technician-command:*`, and
the admin command never takes the availability or schedule advisory locks or updates the expert/account
rows (it only inserts, `on conflict do nothing`). There is no shared lock pair that can be acquired in
opposite orders. The acceptance test runs both directions (admin bind parked while an availability write
runs, and an availability write parked on its schedule lock while an admin bind runs): neither blocks nor
deadlocks. Out-of-band tooling that deactivates an account/expert will now wait for an in-flight
availability write, as it already does for the technician work commands.

## Hosted prerequisite: `btree_gist` (migration `20261101063000`)

The two exclusion constraints need `btree_gist` (uuid and smallint equality inside GiST). The migration runs
`create extension if not exists btree_gist with schema extensions` (plain `create extension if not exists btree_gist` if
no schema named `extensions` exists). **One of these must be true before the migration is applied**, otherwise it fails
closed with `permission denied to create extension "btree_gist"` / `Must have CREATE privilege on current database`
(SQLSTATE 42501) and, being one transaction, changes nothing:

1. **Pre-install the extension** (preferred, least privilege for the migration role), as a role allowed to install it:
   `create extension if not exists btree_gist with schema extensions;`. The migration's own statement then does nothing.
2. **Or grant the migration role `CREATE` on the database**: `grant create on database <db> to <migration role>;` (on
   hosted Supabase the `postgres` role already has it; `btree_gist` is a trusted extension, so no superuser is needed).

Staging, read-only check on 1 Nov 2026 (reported by DevOps): `postgres` has CREATE on the database and on schema
`extensions`, `btree_gist` 1.7 is available and listed in `supautils.privileged_extensions`, and it was not installed yet,
so option 2 applies as it stands and the migration installs it into schema `extensions`. Any other project, and any CI
runner that is not `postgres`, must satisfy 1 or 2 first.

Tested in `tests/integration/supabase-admin-sequence-default-acl.acceptance.mjs` on PostgreSQL 17.6 with a non-superuser runner that has
no CREATE on the database: not pre-installed -> the migration fails with the error above and leaves no constraint and no
extension; pre-installed in schema `extensions` -> the full chain applies as that runner; runner with `CREATE` on the database
-> the migration's own block installs `btree_gist` WITH SCHEMA `extensions`. The test no longer grants CREATE to the runner to
get the chain through.

## Open questions / follow-ups

- Direct RPC calls still surface the new constraints as raw `23514` / `23P01` errors. The availability HTTP repository now maps only the known availability instant-order and overlap constraints to non-retryable `VALIDATION_FAILED` errors, without exposing SQL details. The shared client/API validator rejects these invalid instant intervals before a write; changing the direct RPC error contract still requires a separate migration.
- `AVAILABILITY_REQUIRED` means "no row". If product wants "revision 0 / never published" and "published empty" to behave the same, change the check.
- `24:00` is not representable and windows end at `23:59` at the latest (#76's rule); a window cannot span local midnight.
