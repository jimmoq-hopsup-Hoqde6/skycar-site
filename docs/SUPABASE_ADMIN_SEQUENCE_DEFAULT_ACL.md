# supabase_admin default privileges on public sequences

Three pieces, deliberately separate:

| Piece | Where | Who runs it | Can it fail the migration chain? |
| --- | --- | --- | --- |
| Migration `20261101140000_revoke_supabase_admin_sequence_default_acl.sql` | `supabase/migrations/` | the normal migration runner (the `postgres` role on hosted and in the Supabase CLI) | No. It only does work the running role controls and then **reports**. It never raises because of `supabase_admin` or anyone else's defaults. |
| Ops script `supabase-admin-sequence-default-acl.sql` | `scripts/ops/` | **only `supabase_admin`** (or a member of it) | Not part of the chain. Hard-fails and rolls back on any problem. |
| Read-only gate `sequence-default-acl-gate.sql` and classifying wrapper `sequence-default-acl-gate.sh` | `scripts/ops/` | anyone with read access | Not part of the chain. Fails closed (no-go) on any finding; the wrapper exits 0 GO / 10 expected / 11 blocking / 12 gate did not run. |

## Why `supabase_admin` is not in the migration

On a hosted Supabase project `supabase_admin` has its own default ACL for sequences in `public`
(and may have a global, all-schemas one). A sequence it creates later can be born with `USAGE`,
`SELECT` and `UPDATE` for `anon` and `authenticated`. `20261101133000` only changed the defaults of
the role that ran it.

Changing another role's defaults needs membership of that role. Hosted customers are not
`supabase_admin` and cannot become members of it, and the CLI applies migrations as `postgres`,
which is not a member either. An earlier draft of this migration ran
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` and raised when that was refused. That would
have stopped every later migration on a hosted project (`supabase db push`, or the owner connector
applying files in order). It would also have broken the Supabase CLI local flow: QA reports that the local stack started by
`supabase db reset` **does have** a `supabase_admin` role and applies migrations as a non-superuser
`postgres` (not re-verified here; no CLI stack was available on the test box). So do not assume
`supabase_admin` is absent locally. The migration works whether or not that role exists and whether
or not the runner is a member; the acceptance test applies the whole chain as a non-superuser,
non-member runner next to a superuser `supabase_admin` with default grants to simulate that.

Nothing currently exposed: no sequence owned by `supabase_admin` existed on staging when checked
on 1 Nov 2026 (see `docs/staging/V2_NINE_MIGRATION_INSTALL.md` on the staging checklist branch).
The risk is future sequences, so the gate matters more than the fix.

## What the migration does (all within the running role's control)

1. Revokes everything from `PUBLIC`, `anon` and `authenticated` on every non-extension sequence in
   `public` that the running role can act as (the loop of `20261101133000`; sequences owned by roles
   it cannot act as are skipped with a NOTICE). `service_role` is untouched.
2. Revokes the running role's own default sequence privileges in `public` from `PUBLIC`, `anon`,
   `authenticated`.
3. Reports every remaining finding as `WARNING` (SQLSTATE `01000`, message prefix
   `SKYCAR-SEQ-ACL`) or one `NOTICE` saying it is clean. Findings are listed below. It exits 0
   either way, so a re-run on a clean database passes (it prints one clean NOTICE and no WARNING).

It is one transaction and idempotent. It is safe to re-run in any state and for any runner.

## What counts as a finding (migration report, ops verification and gate share one query; the gate and ops script additionally quote the creator role name)

- `default_acl`: a `pg_default_acl` row for sequences, **any creator role**, scoped to schema
  `public` **or global (all schemas)**, that grants `anon`, `authenticated` or `PUBLIC` any privilege.
  A global entry is a failure, not a warning: `IN SCHEMA public` cannot remove it, and any privilege
  (`USAGE`, `SELECT` reads `last_value`, `UPDATE` allows `setval`) is exposure.
- `sequence`: a non-extension sequence in `public`, **any owner**, whose ACL grants `anon`,
  `authenticated` or `PUBLIC` any privilege.

## Runbook for the hosted project (requires the project owner's approval; not part of any migration)

Order matters: **apply the migration chain first, including `20261101133000` and
`20261101140000`, and only then run the ops script.** The ops script verifies the whole database,
and the migration is what clears the migration runner's own sequence grants and default ACL. If the
ops script runs first while the runner's (`postgres`) default ACL still grants `anon` or
`authenticated`, its verification finds that, reports `NO-GO` and **rolls everything back** (nothing
changes, but the run is wasted).

1. Apply the migration chain, including `20261101140000`, as the normal migration runner. It cannot
   fail because of `supabase_admin`. A re-run on an already clean database passes and prints exactly
   one `NOTICE: SKYCAR-SEQ-ACL: clean, ...` and no `WARNING`; it is not silent.
2. Gate (read only; run as any role that can connect and read the catalogs). Use the wrapper; it
   runs the gate with `-v ON_ERROR_STOP=1`, classifies the result and never reports "expected" when the
   gate itself failed to run:
   `DATABASE_URL=... sh scripts/ops/sequence-default-acl-gate.sh`
   | exit | meaning |
   |---|---|
   | `0` | `GO`: nothing to do. |
   | `10` | `NO-GO (expected)`: every finding is a `supabase_admin` default ACL on sequences (schema `public` or global). Needs Supabase support (step 4); does not block the staging install. |
   | `11` | `NO-GO (blocking)`: at least one finding is anything else. Do not proceed (step 3). |
   | `12` | The gate did not run or ended unrecognised: no `DATABASE_URL`, no `psql`, connection refused, unknown database, a role without `CONNECT`, another SQL error, or a finding count that does not match the rows printed. **Never "expected"**; the `psql` error is on stderr. Fix the cause and re-run. |

   The wrapper prints the finding rows (`kind|detail`) on stdout. The underlying command, if you need it
   raw, is `psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -f scripts/ops/sequence-default-acl-gate.sql`:
   without `ON_ERROR_STOP` `psql` exits 0 even on `NO-GO`; with it a `NO-GO` is exit 3, SQLSTATE `P0001`,
   and each finding is also a `WARNING`.
3. Classify a `NO-GO` (the wrapper does this; this is what it implements):
   - **Expected, `supabase_admin` default ACLs only.** The whole line of every finding row equals
     `default_acl|creator=supabase_admin scope=<public|GLOBAL(all schemas)> grantee=<anon|authenticated|PUBLIC> privilege=<USAGE|SELECT|UPDATE>`
     and the number of rows equals the finding count the gate reported. Customers cannot change these
     (hosted `postgres` is not a member of `supabase_admin`); they need Supabase support to run the ops
     script (step 4). Record it as an expected finding awaiting support. **It does not block the staging
     install.**
   - **Anything else blocks.** Any other creator role's default ACL (including a role whose name merely
     starts with `supabase_admin`: the gate prints creator names with `quote_ident`, so it appears as
     `creator="supabase_admin evil"`), any existing sequence with a grant (including one owned by
     `supabase_admin`), a row count that does not match, or any other `NO-GO` cause is a real finding: do
     not proceed until it is decided and fixed with a normal, reviewed REVOKE.
4. Only for the expected class: the party that can act as `supabase_admin` (Supabase support, or a
   `supabase_admin` connection if one is available) runs:
   `psql "$SUPABASE_ADMIN_URL" -X -v ON_ERROR_STOP=1 -f scripts/ops/supabase-admin-sequence-default-acl.sql`
   It revokes `ALL` on sequences from `anon`, `authenticated`, `PUBLIC` for `supabase_admin` IN SCHEMA
   `public` **and** the global entry, then verifies with the same query as the gate. Any remaining
   finding (another creator's default ACL, an existing sequence with a grant) fails the script and
   **rolls everything back**, so a partial result never remains. If a non-member runs it, it fails
   with SQLSTATE `42501` and the message `SKYCAR-SEQ-ACL: <role> cannot change the default privileges
   of supabase_admin`.
5. Gate again after the ops script (`sh scripts/ops/sequence-default-acl-gate.sh`). Required result: exit 0 and `GO`. Until support has run it, the
   hosted gate stays `NO-GO` for the expected class; the staging checklist must expect that.
6. Findings that are not `supabase_admin` default ACLs are not fixed by the script; they need an
   explicit decision and a normal, reviewed REVOKE. The migration already clears them where the
   running role owns them.

If `supabase_admin` cannot be used at all, the mitigation is to keep `supabase_admin`-created
objects out of `public` (extensions belong in the `extensions` schema) and to keep the gate in the
staging checklist so a new `supabase_admin`-owned sequence is noticed.

## Applying and recording

- The hosted migration history may record this file under a generated version (the staging install
  used `apply_migration`, which assigns versions at call time). The repository filename is the
  source of truth.
- Never apply the ops script from a migration, a workflow, or an agent. Do not apply anything to
  staging or production without the project owner's direct approval.
