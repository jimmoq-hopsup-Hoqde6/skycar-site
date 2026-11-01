# V2 nine-migration install: manifest, pre-migration checklist, post-migration verification, backup gap review

> **Status: documentation only. Nothing in this document has been executed against any hosted
> database.** No migration has been applied, no workflow has been dispatched, and no secret or
> environment value has been read or set while writing it. Anything not demonstrated by a file in this
> repository at the pinned commit is marked **UNVERIFIED**. This document does not approve, authorise or
> schedule an installation; founder approval is a checklist item below.

- Repository: `jimmoq-hopsup-Hoqde6/skycar-site`
- Pinned application / migration candidate: `18240dc137a66660ef9251101df906159ffae9a4`
  (head of PR #74, branch `fix/completion-final-lock-authority`; independent PASS reported by the owner)
- Tested integration (from PR #74): `413a9e46893324d38f88847b0bab109072bed5f1`
- Source of the install list: the owner's "Proposed installation manifest" comment on PR #74
  (comment id 6552566823, 2026-11-01T02:54:31Z). That comment itself says it is *not approved or applied*.
- `supabase/migrations` tree object at the pin: `f94277b5952e051afce4cd2f58730160abff70fa` (17 files).

## 0. Findings that must be resolved before anyone installs anything

| # | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| F1 | **The nine files are not self-contained.** They reference `public.care_requests`, `public.care_guest_requests`, `public.user_roles`, `public.vehicles`, `public.vehicle_history`, `public.audit_events` and `auth.users`, which are created by the **eight earlier files** in the same directory (`202609200001` … `20261001030000`). | Reading the nine files; `care_journeys` has FKs to `care_requests` and `care_guest_requests`. | The nine can only apply on a database that already has the eight baseline migrations. "Baseline replay is prohibited" (PR comment) is consistent with that, but it means the pre-migration inventory **must** show the eight baseline versions. |
| F2 | **Conflicting staging-state descriptions.** `docs/STAGING_BACKUP_EXECUTION.md` (at the pin) describes staging as an **empty** project with **no applied migration history** and a **six-migration** packet at application `821125d`. The nine-file stack presupposes eight applied baseline files. | `docs/STAGING_BACKUP_EXECUTION.md`; `git ls-tree 821125d supabase/migrations` lists six files. | Actual staging inventory is **UNVERIFIED**. If staging is still empty, the correct install set is the eight baseline files **plus** the nine (17), not nine. The founder must confirm inventory before the manifest below is used. |
| F3 | **The backup workflow cannot back up the nine-file stack as shipped** (see section 4: hard-coded `APPLICATION_SHA`, empty-project-only gate). | `ops/staging-backup/backup.mjs` lines 17-31, 98-111. | A pre-migration backup of a baseline-populated staging project with this workflow will fail closed. |
| F4 | Manifest vs tree: **no mismatch.** All nine blob SHAs in the PR comment equal the blob SHAs in the tree at `18240dc…` and in the bytes (re-hashed with `git hash-object`). The nine are exactly the files with versions > `20261001030000`; the "original eight pending files" in the comment are unchanged from PR #74's own diff (PR #74 changes only the ninth migration + four test files). | Section 1. | none |
| F5 | Sequence privileges are not revoked by the migrations (`care_journey_events_id_seq`). On a disposable local PostgreSQL 17.6 loaded with Supabase-style default privileges, `anon` and `authenticated` retained USAGE/SELECT/UPDATE on it. | Check D4 below. Hosted state **UNVERIFIED**. | Low severity (no table privilege, so no insert path), but it contradicts the "browser roles receive no privileges" comment in `20261003064126`. Record the hosted result; do not fix as part of this install without a reviewed migration. |
| F6 | The migrations create **no** RLS policies and never run `FORCE ROW LEVEL SECURITY`; protection is revoked grants + RLS-enabled + service-role-only RPCs. None of the ten functions is `SECURITY DEFINER` (all are `SECURITY INVOKER`, `search_path=''`, with an in-body `current_user <> 'service_role'` guard on the RPCs). | Reading the nine files. | Verification below checks the actual (invoker) design rather than a definer design. |

## 1. Manifest (pinned to `18240dc137a66660ef9251101df906159ffae9a4`)

Order is ascending version, which is the order Supabase applies and the order in the PR comment. Blob SHAs
are Git blob IDs (`git hash-object`), taken from the tree at the pin and compared with the PR #74 comment.

| Order | Path (under `supabase/migrations/`) | Version | Git blob SHA | Bytes | Matches PR #74 comment |
| --- | --- | --- | --- | --- | --- |
| 1 | `20261003064126_care_connected_journey.sql` | `20261003064126` | `de4b31ad085e9d5f0c410b825cf37565208ff0f5` | 28842 | yes |
| 2 | `20261004090000_technician_inbox.sql` | `20261004090000` | `55d448620035d8eaa1f0040f3121fb53a0e03e7e` | 11644 | yes |
| 3 | `20261004124000_technician_quotes.sql` | `20261004124000` | `6773498011dd697f1f327b5684b0dca8f29b061e` | 10565 | yes |
| 4 | `20261004133000_technician_work_start.sql` | `20261004133000` | `1e8a70c873b3ddd0ba63fba9652b890a8efd9488` | 4223 | yes |
| 5 | `20261004140000_technician_completion.sql` | `20261004140000` | `0d4bb71697ea671963647372e33a040a52ef4dbe` | 7984 | yes |
| 6 | `20261004150000_customer_completion_review.sql` | `20261004150000` | `37bd21c7e08d7d20c44fa1ca342d598f6c309c7a` | 6943 | yes |
| 7 | `20261020183000_completion_review_security_fix.sql` | `20261020183000` | `b8476976ffecc30721e3b358ddf95229871f9875` | 5903 | yes |
| 8 | `20261020183001_completion_review_replay_authority.sql` | `20261020183001` | `9da568903d8d95718e382897670fbbf34bfe53e6` | 6355 | yes |
| 9 | `20261101024732_completion_review_final_lock_authority.sql` | `20261101024732` | `52f11c3e9edca2cb6f57c66d1377bee1cd59618e` | 6365 | yes |

Eight baseline files that exist in the same directory at the pin and are **prerequisites, not part of the
nine** (blob SHAs from the same tree; applied state in staging is **UNVERIFIED**):

| Version | File | Git blob SHA |
| --- | --- | --- |
| `202609200001` | `202609200001_foundation.sql` | `a1d1cf28b896474e3e3a972e5857993126acc921` |
| `202609200002` | `202609200002_care_requests.sql` | `5fa6a6f399ade7fc8dbecd2b4e779f4a877fb40f` |
| `202609200003` | `202609200003_care_my_jobs.sql` | `d74c23175405f2846e61046c19ed901050f58b19` |
| `202609200100` | `202609200100_garage_mutations.sql` | `07f2f8b701ed86f5ba5d2b5bac7ea279c935e0fa` |
| `202609200300` | `202609200300_garage_vehicle_photos.sql` | `16eab45434c926b8ec783f49db6d0474ad8ba1c4` |
| `202609220100` | `202609220100_care_offers.sql` | `82f09e2b26b8cb351c814d32f2306697fc4d8711` |
| `202609300001` | `202609300001_staging_access_hardening.sql` | `0d21a113d00f8b7491a44ab226ca670094243b61` |
| `20261001030000` | `20261001030000_care_guest_requests.sql` | `173148e6cc448b9e10e52006e21bc68609105e7f` |

Notes:

- `20261004133000` creates `care_technician_work_command`; `20261004140000` replaces it (`create or replace`),
  and `20261004150000`, `20261020183000`, `20261020183001`, `20261101024732` each replace
  `care_customer_completion_review_command` (same signature). Replaced functions keep their existing ACLs;
  none of the last three files re-issues `revoke`/`grant`, so the grants come from `20261004150000`.
- `20261004150000` contains a data backfill (`update public.care_journeys set completion_review_state='awaiting_review' where state='completed' and completion_review_state is null`).
- The default branch `main` contains **only** `202609200001_foundation.sql` from this directory; the pinned
  commit is reachable by SHA but is **not** on `main`. Installation must be pinned to the commit SHA, not to a branch name.

Re-verify the pin with this read-only script (needs only a git clone; no credentials):

```bash
#!/usr/bin/env bash
# Read-only: re-verify the nine pinned migration blobs. Run in a clone of the repository.
set -euo pipefail
PIN=18240dc137a66660ef9251101df906159ffae9a4
git fetch --quiet origin "$PIN"
test "$(git rev-parse "$PIN^{commit}")" = "$PIN"
fail=0
while read -r blob path; do
  tree_blob=$(git rev-parse "$PIN:$path")                       # blob recorded in the pinned tree
  work_blob=$(git show "$PIN:$path" | git hash-object --stdin)  # blob recomputed from the bytes
  if [ "$tree_blob" = "$blob" ] && [ "$work_blob" = "$blob" ]; then echo "OK   $blob $path"
  else echo "FAIL $path expected=$blob tree=$tree_blob content=$work_blob"; fail=1; fi
done <<'LIST'
de4b31ad085e9d5f0c410b825cf37565208ff0f5 supabase/migrations/20261003064126_care_connected_journey.sql
55d448620035d8eaa1f0040f3121fb53a0e03e7e supabase/migrations/20261004090000_technician_inbox.sql
6773498011dd697f1f327b5684b0dca8f29b061e supabase/migrations/20261004124000_technician_quotes.sql
1e8a70c873b3ddd0ba63fba9652b890a8efd9488 supabase/migrations/20261004133000_technician_work_start.sql
0d4bb71697ea671963647372e33a040a52ef4dbe supabase/migrations/20261004140000_technician_completion.sql
37bd21c7e08d7d20c44fa1ca342d598f6c309c7a supabase/migrations/20261004150000_customer_completion_review.sql
b8476976ffecc30721e3b358ddf95229871f9875 supabase/migrations/20261020183000_completion_review_security_fix.sql
9da568903d8d95718e382897670fbbf34bfe53e6 supabase/migrations/20261020183001_completion_review_replay_authority.sql
52f11c3e9edca2cb6f57c66d1377bee1cd59618e supabase/migrations/20261101024732_completion_review_final_lock_authority.sql
LIST
# The migrations directory must contain exactly these nine plus the eight baseline files at the pin.
test "$(git ls-tree --name-only "$PIN" supabase/migrations/ | wc -l)" = 17 || { echo "FAIL: expected 17 files in supabase/migrations at pin"; fail=1; }
test "$(git rev-parse "$PIN:supabase/migrations")" = f94277b5952e051afce4cd2f58730160abff70fa || { echo "FAIL: migrations directory tree SHA differs"; fail=1; }
exit $fail
```

## 2. Pre-migration checklist

Nothing below has been performed. Each row needs dated, redacted evidence (who, when, output) recorded in
the installation issue/PR before the next row is relied on. Items that need hosted access are **UNVERIFIED**
until a person with staging access provides that evidence. Never paste secret values, connection strings or
passwords into the evidence log; record presence/equality only.

| # | Check | How to verify (read-only) | Pass condition | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Founder approval recorded for this exact pin and the final install set (9 or 8+9, see F2) | Link the approval message/comment | Names commit `18240dc137a66660ef9251101df906159ffae9a4` and the file list | link | UNVERIFIED |
| 2 | Pinned revision and blob SHAs re-verified | Run the script in section 1 immediately before installing; also confirm PR #74 head is still `18240dc…` | Script exits 0; head unchanged | script output | UNVERIFIED |
| 3 | Staging project status is **ACTIVE_HEALTHY** | Supabase dashboard project status or Management API `GET /v1/projects/{ref}` (`status` field) | `ACTIVE_HEALTHY` | screenshot/JSON, redacted | UNVERIFIED |
| 4 | Staging project ref confirmed **non-production** | Compare the project ref/URL host to the documented staging ref and to the production ref held by the founder; project name/marker matches `skycar-v2-isolated-staging` | Ref is the staging ref; differs from production ref | redacted ref comparison | UNVERIFIED |
| 5 | No production credentials in the environment or secrets | List secret/variable **names only** in the `skycar-staging` environment and the deployment environment (never values); confirm each Supabase URL/ref/key in use belongs to staging (derive the ref from the URL host, compare) | Every Supabase value belongs to the staging ref; no production URL/key/ref anywhere | names + equality result | UNVERIFIED |
| 6 | `schema_migrations` inventory recorded | Run P1-P2 in section 2.1 | Output saved; the eight baseline versions present (or the founder-approved 8+9 plan, F2); no unexpected versions | saved output | UNVERIFIED |
| 7 | None of the nine target versions or created objects already exist | P3, P4 | 0 rows each | output | UNVERIFIED |
| 8 | Prerequisite tables exist | P5 | 9 rows, all true | output | UNVERIFIED |
| 9 | RLS enabled on **all** public tables | P6 | 0 rows | output | UNVERIFIED |
| 10 | Storage buckets `public = false` | P7 (and E1 after install) | No bucket with `public <> false`; `private-media` present and private | output | UNVERIFIED |
| 11 | Backup / PITR confirmed **with a test restore** | Confirm the staging project's backup/PITR entitlement in the dashboard; restore a recent backup/PITR point to a **separate, disposable** target; run P2 and B2/E1 against the restored copy | Restore succeeded; restored inventory equals row 6; restored RLS/bucket checks pass | restore record, redacted | UNVERIFIED |
| 12 | A stop/rollback decision exists | Written note: these are forward-only migrations with no down scripts; recovery path is restore-to-new-project, not "undo" | Note recorded | link | UNVERIFIED |
| 13 | Install method pinned | The runner applies exactly the nine files from the pinned commit (e.g. checkout the SHA, `supabase db push` limited to pending versions, or the dashboard SQL editor in order) and prints the pending list **before** applying | Pending list == the nine versions, in order; no baseline file listed | dry-run output | UNVERIFIED |

### 2.1 Pre-migration SQL (read-only)

Run inside a read-only transaction (`begin read only; … rollback;`) over a verified TLS connection with a
least-privilege role. Save the output next to the evidence log. These were executed only against a
disposable local database; on that database P3/P4 return rows because the stack was already installed there,
which is the expected "fail" signal on a fresh target.

```sql
-- P1. Server version and identity of what we are connected to (record in the evidence log).
select current_database() as db, current_user as connected_as, version() as server_version,
       current_setting('server_version_num')::int between 170000 and 179999 as pg17;

-- P2. schema_migrations inventory. Record the full output BEFORE installing. Expected for the nine-file
--     install: the 8 baseline versions listed in A2 present, none of the 9 new versions present.
select version, name, md5(coalesce(statements::text, '')) as statements_md5
from supabase_migrations.schema_migrations order by version;

-- P3. None of the nine target versions is already present. Expected: 0 rows.
select version, name from supabase_migrations.schema_migrations
where version in ('20261003064126','20261004090000','20261004124000','20261004133000','20261004140000',
                  '20261004150000','20261020183000','20261020183001','20261101024732');

-- P4. None of the objects the nine files CREATE exists yet (a pre-existing table/function means partial or
--     out-of-band application). Expected: 0 rows.
select 'table' as kind, c.relname as name from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relname in ('care_experts','care_journeys',
  'care_reviewed_quotes','care_journey_events','care_journey_commands','care_technician_accounts',
  'care_technician_invitations','care_technician_commands')
union all
select 'function', p.oid::regprocedure::text from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname in ('care_journey_command',
  'care_technician_admin_command','care_technician_read','care_technician_quote_selection_guard',
  'care_technician_invitation_withdraw','care_technician_job_command','care_technician_work_command',
  'care_technician_completion_upload_access','care_completion_review_initialise',
  'care_customer_completion_review_command');

-- P5. Prerequisites the nine files reference must already exist (they come from the 8 baseline files).
--     Expected: 9 rows, all true.
select t as required_table, to_regclass('public.' || t) is not null as exists
from unnest(array['care_requests','care_guest_requests','user_roles','vehicles','vehicle_history',
                  'audit_events']) t
union all select 'auth.users', to_regclass('auth.users') is not null
union all select 'storage.buckets', to_regclass('storage.buckets') is not null
union all select 'storage.objects', to_regclass('storage.objects') is not null;

-- P6. RLS on every public table (same as B2). Expected: 0 rows.
select c.relname from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and not c.relrowsecurity;

-- P7. Buckets (same as E1/E2). Expected: no rows with public <> false.
select id, name, public from storage.buckets order by id;
```

## 3. Post-migration verification SQL (read-only)

All statements are `SELECT`-only. Run inside `begin read only; … rollback;`. They were validated for syntax
and for the stated expected results by applying the 17 files (8 baseline + 9 new, in order) to a **disposable
local PostgreSQL 17.6 with hand-written Supabase stubs** (`anon`/`authenticated`/`service_role` roles, `auth.users`,
`storage.buckets/objects`, `supabase_migrations.schema_migrations`, Supabase-style default privileges). That
is not hosted evidence: results from the real staging project are **UNVERIFIED** until someone runs them there.

### 3.1 Migration history: exactly the nine new versions, no baseline replay, no duplicates

```sql
-- A1. Exactly the nine new versions are present, once each, with the expected names.
with expected(ord, version, name) as (values
  (1, '20261003064126', 'care_connected_journey'),
  (2, '20261004090000', 'technician_inbox'),
  (3, '20261004124000', 'technician_quotes'),
  (4, '20261004133000', 'technician_work_start'),
  (5, '20261004140000', 'technician_completion'),
  (6, '20261004150000', 'customer_completion_review'),
  (7, '20261020183000', 'completion_review_security_fix'),
  (8, '20261020183001', 'completion_review_replay_authority'),
  (9, '20261101024732', 'completion_review_final_lock_authority'))
select e.ord, e.version, e.name as expected_name, m.name as actual_name,
       count(m.version) over (partition by e.version) as rows_for_version,
       case when m.version is null then 'FAIL: MISSING'
            when m.name is distinct from e.name then 'FAIL: NAME_MISMATCH'
            else 'PASS' end as status
from expected e
left join supabase_migrations.schema_migrations m on m.version = e.version
order by e.ord;
-- Expected: 9 rows, all PASS, rows_for_version = 1.

-- A2. No duplicates, and nothing outside the 8 baseline + 9 new versions
--     (no baseline replay under a new timestamp, no unreviewed extra migration).
with allowed(version) as (values
  ('202609200001'), ('202609200002'), ('202609200003'), ('202609200100'),
  ('202609200300'), ('202609220100'), ('202609300001'), ('20261001030000'),   -- 8 baseline files
  ('20261003064126'), ('20261004090000'), ('20261004124000'), ('20261004133000'),
  ('20261004140000'), ('20261004150000'), ('20261020183000'), ('20261020183001'),
  ('20261101024732'))                                                           -- 9 new files
select 'unexpected_version' as problem, m.version, m.name
from supabase_migrations.schema_migrations m
where m.version not in (select version from allowed)
union all
select 'duplicate_version', version, null
from supabase_migrations.schema_migrations group by version having count(*) > 1
union all
select 'duplicate_name', null, name
from supabase_migrations.schema_migrations group by name having count(*) > 1;
-- Expected: 0 rows.

-- A3. Totals. Expected: total_rows = 17, baseline_rows = 8, new_rows = 9
--     (adjust ONLY if the recorded pre-migration inventory legitimately differs; see section 3).
select count(*) as total_rows,
       count(*) filter (where version in ('202609200001','202609200002','202609200003','202609200100',
         '202609200300','202609220100','202609300001','20261001030000')) as baseline_rows,
       count(*) filter (where version in ('20261003064126','20261004090000','20261004124000',
         '20261004133000','20261004140000','20261004150000','20261020183000','20261020183001',
         '20261101024732')) as new_rows,
       max(version) as max_version
from supabase_migrations.schema_migrations;

-- A4. Baseline rows unchanged versus the pre-migration snapshot (run the same statement before and
--     after; diff the two outputs byte-for-byte). A difference means a baseline replay or edit.
select version, name, md5(coalesce(statements::text, '')) as statements_md5
from supabase_migrations.schema_migrations
where version in ('202609200001','202609200002','202609200003','202609200100',
                  '202609200300','202609220100','202609300001','20261001030000')
order by version;
```

### 3.2 Tables, RLS, constraints, indexes, triggers

Objects created by the nine files: 8 tables (`care_experts`, `care_journeys`, `care_reviewed_quotes`,
`care_journey_events`, `care_journey_commands`, `care_technician_accounts`, `care_technician_invitations`,
`care_technician_commands`), 1 identity sequence, 3 added/guarded columns on existing tables
(`care_reviewed_quotes.submitted_by_technician`, `care_journeys.completion_review_state`,
`care_journeys.completion_issue_details`), 3 triggers, and 10 functions.

```sql
-- B1. Tables exist in public, RLS enabled; FORCE RLS reported (see note below).
with t(name) as (values
  ('care_experts'), ('care_journeys'), ('care_reviewed_quotes'), ('care_journey_events'),
  ('care_journey_commands'), ('care_technician_accounts'), ('care_technician_invitations'),
  ('care_technician_commands'))
select t.name,
       (it.table_name is not null)            as in_information_schema,
       c.relkind,
       c.relrowsecurity                        as rls_enabled,        -- expected true
       c.relforcerowsecurity                   as rls_forced,         -- expected false (not set by these migrations)
       pg_get_userbyid(c.relowner)             as owner,
       case when c.oid is null then 'FAIL: MISSING'
            when it.table_name is null or c.relkind <> 'r' then 'FAIL: NOT A PUBLIC BASE TABLE'
            when not c.relrowsecurity then 'FAIL: RLS DISABLED'
            else 'PASS' end                    as status
from t
left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
left join information_schema.tables it
       on it.table_schema = 'public' and it.table_name = t.name and it.table_type = 'BASE TABLE'
order by t.name;
-- Expected: 8 rows, all PASS. The migrations never run ALTER TABLE ... FORCE ROW LEVEL SECURITY.

-- B2. Every public table has RLS enabled (includes baseline tables). Expected: 0 rows.
select c.relname, c.relkind
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
order by 1;

-- B3. The nine migrations create NO policies on their tables (deny-by-default to non-BYPASSRLS roles).
--     Expected: 0 rows. Any row is a deviation to explain.
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('care_experts','care_journeys','care_reviewed_quotes','care_journey_events',
                    'care_journey_commands','care_technician_accounts','care_technician_invitations',
                    'care_technician_commands');

-- B4. Columns, sequence, constraints, indexes and triggers added by the nine files.
select 'column' as kind, table_name || '.' || column_name as object, 'present' as status
from information_schema.columns
where table_schema = 'public' and (table_name, column_name) in (
  ('care_reviewed_quotes','submitted_by_technician'),
  ('care_journeys','completion_review_state'),
  ('care_journeys','completion_issue_details'),
  ('care_journeys','completion_evidence'),
  ('care_journeys','selected_quote_id'))
union all
select 'sequence', sequencename, 'present' from pg_sequences
where schemaname = 'public' and sequencename = 'care_journey_events_id_seq'
union all
select 'constraint', conrelid::regclass::text || '.' || conname, 'present' from pg_constraint
where connamespace = 'public'::regnamespace and conname in (
  'care_reviewed_quotes_id_journey_unique','care_journeys_selected_quote_fk',
  'care_journeys_completion_review_check','care_journey_events_type_check')
union all
select 'index', indexname, 'present' from pg_indexes
where schemaname = 'public' and indexname in (
  'care_journeys_capacity_idx','care_quotes_journey_status_idx','care_quotes_one_current_per_expert_idx',
  'care_journey_events_journey_idx','care_journey_commands_journey_idx','care_technician_inbox_idx')
union all
select 'trigger', tgrelid::regclass::text || '.' || tgname, case when tgenabled = 'O' then 'enabled' else 'NOT ENABLED: ' || tgenabled::text end
from pg_trigger
where not tgisinternal and tgname in (
  'care_technician_quote_selection_guard','care_technician_invitation_withdraw','care_completion_review_initialise')
order by 1, 2;
-- Expected: 5 columns, 1 sequence, 4 constraints, 6 indexes, 3 triggers (all 'enabled').

-- B5. The final event-type CHECK (from 20261004150000) is the live one: 11 event types incl. completion_*.
select conname,
       pg_get_constraintdef(oid) like '%completion_confirmed%'
         and pg_get_constraintdef(oid) like '%completion_issue_reported%'
         and pg_get_constraintdef(oid) like '%quote_withdrawn%' as has_all_final_types   -- expected true
from pg_constraint
where conrelid = 'public.care_journey_events'::regclass and conname = 'care_journey_events_type_check';
```

### 3.3 Functions: existence, SECURITY mode, search_path, body fingerprint, execute grants

```sql
-- C1. The ten functions exist with the exact signatures, are SECURITY INVOKER (none of the nine files
--     uses SECURITY DEFINER), have search_path pinned to '', and have the expected body fingerprint.
--     expected_md5 = md5(prosrc) obtained by applying the pinned files to a disposable local PostgreSQL
--     17.6; a mismatch means the installed body is not the reviewed text -> STOP.
with f(signature, expected_md5) as (values
  ('public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb)',                   '597c0359e2d0eabbd858bf4cba6b3db7'),
  ('public.care_technician_admin_command(uuid,uuid,text,uuid,jsonb)',               '5638c994c4674d597c6b8ea80ec25cec'),
  ('public.care_technician_read(uuid,uuid)',                                        '9a680de0ea13c77d15bf571a4368b617'),
  ('public.care_technician_quote_selection_guard()',                                'ad94ca9d689e0459bffc6d11fa722482'),
  ('public.care_technician_invitation_withdraw()',                                  '2bbc98908599c1c00fb5bd467b74bfd9'),
  ('public.care_technician_job_command(uuid,uuid,text,uuid,jsonb)',                 '3bdb9abc3e56c67a49c1ab8165f121fb'),
  ('public.care_technician_work_command(uuid,uuid,text,uuid,jsonb)',                '9595544b65208ffa2b99331dcec60310'),
  ('public.care_technician_completion_upload_access(uuid,uuid)',                    '3179fca65e8aba87a806008a009450eb'),
  ('public.care_completion_review_initialise()',                                    '4a4e0067ffc5174ae4479a47a5853557'),
  ('public.care_customer_completion_review_command(uuid,uuid,uuid,text,uuid,jsonb)','687a861bb6eaff7458e824266f5ed67a'))
select f.signature,
       p.oid is not null                                                        as exists_in_pg_proc,
       p.prosecdef                                                              as security_definer,    -- expected false
       exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
               where c in ('search_path=""', 'search_path='))                   as search_path_empty,   -- expected true
       md5(p.prosrc) = f.expected_md5                                           as body_matches_reviewed,
       pg_get_userbyid(p.proowner)                                              as owner,
       case when p.oid is null then 'FAIL: MISSING'
            when p.prosecdef then 'FAIL: SECURITY DEFINER (not expected)'
            when not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                             where c in ('search_path=""', 'search_path=')) then 'FAIL: search_path NOT PINNED'
            when md5(p.prosrc) <> f.expected_md5 then 'FAIL: BODY DIFFERS'
            else 'PASS' end                                                     as status
from f
left join pg_proc p on p.oid = to_regprocedure(f.signature)
order by f.signature;
-- Expected: 10 rows, all PASS.

-- C2. Final-lock ordering (20261101024732): in care_customer_completion_review_command the journey row
--     lock precedes the 'authority change' role recheck. In 20261020183001 the order was the reverse.
select position('select * into journey from public.care_journeys where id=p_id for update;' in prosrc) as journey_lock_pos,
       position('The advisory/row locks may have waited behind an authority change.' in prosrc)         as role_recheck_pos,
       position('select * into journey from public.care_journeys where id=p_id for update;' in prosrc) > 0
       and position('select * into journey from public.care_journeys where id=p_id for update;' in prosrc)
         < position('The advisory/row locks may have waited behind an authority change.' in prosrc)     as final_lock_order_ok  -- expected true
from pg_proc
where oid = 'public.care_customer_completion_review_command(uuid,uuid,uuid,text,uuid,jsonb)'::regprocedure;

-- C3. No other overload of these names exists (create or replace must have replaced, not added).
--     Expected: every function_name has overloads = 1.
select proname as function_name, count(*) as overloads
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('care_journey_command','care_technician_admin_command','care_technician_read',
                  'care_technician_quote_selection_guard','care_technician_invitation_withdraw',
                  'care_technician_job_command','care_technician_work_command',
                  'care_technician_completion_upload_access','care_completion_review_initialise',
                  'care_customer_completion_review_command')
group by proname order by proname;

-- C4. FUNCTION grants. anon / authenticated / PUBLIC must NOT be able to execute; service_role must.
--     (proacl is NULL when defaults apply, and the default is EXECUTE for PUBLIC, so coalesce with acldefault.)
with fn as (
  select p.oid, p.oid::regprocedure::text as signature, p.proowner, p.proacl
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('care_journey_command','care_technician_admin_command','care_technician_read',
                      'care_technician_quote_selection_guard','care_technician_invitation_withdraw',
                      'care_technician_job_command','care_technician_work_command',
                      'care_technician_completion_upload_access','care_completion_review_initialise',
                      'care_customer_completion_review_command'))
select fn.signature,
       has_function_privilege('anon',          fn.oid, 'EXECUTE') as anon_exec,           -- expected false
       has_function_privilege('authenticated', fn.oid, 'EXECUTE') as authenticated_exec,  -- expected false
       exists (select 1 from aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
               where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec,       -- expected false
       has_function_privilege('service_role',  fn.oid, 'EXECUTE') as service_role_exec,   -- expected true
       case when has_function_privilege('anon', fn.oid, 'EXECUTE')
              or has_function_privilege('authenticated', fn.oid, 'EXECUTE')
              or exists (select 1 from aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') then 'FAIL: BROWSER/PUBLIC CAN EXECUTE'
            when not has_function_privilege('service_role', fn.oid, 'EXECUTE') then 'FAIL: service_role CANNOT EXECUTE'
            else 'PASS' end as status
from fn order by fn.signature;
-- Expected: 10 rows, all PASS.
```

### 3.4 Table and sequence grants for `anon`, `authenticated`, `PUBLIC`

```sql
-- D1. TABLE grants via information_schema.role_table_grants for anon / authenticated / PUBLIC.
--     Expected: 0 rows. (role_table_grants only lists grants visible to the connected role; run as the
--     table owner / postgres, and also run D2, which does not have that visibility limit.)
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('care_experts','care_journeys','care_reviewed_quotes','care_journey_events',
                     'care_journey_commands','care_technician_accounts','care_technician_invitations',
                     'care_technician_commands')
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, privilege_type;

-- D2. Same, from the catalog: table-level ACL, column-level ACL and PUBLIC. Expected: 0 rows with any 'true'.
select c.relname,
       has_table_privilege('anon',          c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_any,
       has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated_any,
       exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0) as public_any,
       exists (select 1 from pg_attribute at, aclexplode(at.attacl) a
               where at.attrelid = c.oid and at.attacl is not null and a.grantee in
                     (0, coalesce((select oid from pg_roles where rolname = 'anon'), 0),
                         coalesce((select oid from pg_roles where rolname = 'authenticated'), 0))) as column_acl_for_browser_roles
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('care_experts','care_journeys','care_reviewed_quotes','care_journey_events',
                    'care_journey_commands','care_technician_accounts','care_technician_invitations',
                    'care_technician_commands')
  and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0)
       or exists (select 1 from pg_attribute at, aclexplode(at.attacl) a
                  where at.attrelid = c.oid and at.attacl is not null and a.grantee in
                        (0, coalesce((select oid from pg_roles where rolname = 'anon'), 0),
                            coalesce((select oid from pg_roles where rolname = 'authenticated'), 0))));

-- D3. service_role privileges. The migrations grant SELECT, INSERT, UPDATE only. Anything beyond that comes from
--     Supabase default privileges, not from these files - record it; DELETE/TRUNCATE here is a REVIEW item.
select table_name, string_agg(privilege_type, ',' order by privilege_type) as service_role_privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'service_role'
  and table_name in ('care_experts','care_journeys','care_reviewed_quotes','care_journey_events',
                     'care_journey_commands','care_technician_accounts','care_technician_invitations',
                     'care_technician_commands')
group by table_name order by table_name;
-- Expected at minimum: INSERT,SELECT,UPDATE on all eight tables.

-- D4. SEQUENCE care_journey_events_id_seq. The migration revokes table privileges from anon/authenticated
--     but never revokes sequence privileges; Supabase default privileges may grant them. Expected: all false.
--     A 'true' is a finding to review (nextval/usage by browser roles), not something the migration fixes.
select 'public.care_journey_events_id_seq' as sequence_name,
       has_sequence_privilege('anon',          'public.care_journey_events_id_seq', 'USAGE,SELECT,UPDATE') as anon_any,
       has_sequence_privilege('authenticated', 'public.care_journey_events_id_seq', 'USAGE,SELECT,UPDATE') as authenticated_any,
       has_sequence_privilege('service_role',  'public.care_journey_events_id_seq', 'USAGE,SELECT')        as service_role_usage_select;  -- expected true

-- D5. Default privileges that explain D3/D4 (informational).
select pg_get_userbyid(defaclrole) as for_role, defaclnamespace::regnamespace as schema, defaclobjtype as objtype, defaclacl
from pg_default_acl order by 1, 3;

-- D6. Every SECURITY DEFINER function in public pins search_path (baseline functions are SECURITY DEFINER;
--     the nine files add none). Expected: 0 rows.
select p.oid::regprocedure as function, p.proconfig
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');

-- D7. No function created by the nine files is SECURITY DEFINER. Expected: 0 rows.
select p.oid::regprocedure as function
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and p.proname in ('care_journey_command','care_technician_admin_command','care_technician_read',
                    'care_technician_quote_selection_guard','care_technician_invitation_withdraw',
                    'care_technician_job_command','care_technician_work_command',
                    'care_technician_completion_upload_access','care_completion_review_initialise',
                    'care_customer_completion_review_command');
```

On the local validation database D3 showed `service_role` with `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`
(from default privileges, beyond the `SELECT,INSERT,UPDATE` the files grant) and D4 showed `anon`/`authenticated` **true**
on the sequence. These are reproduced facts about the stub, not hosted facts; the checks exist so the hosted result is recorded.

### 3.5 Storage and data sanity

```sql
-- E1. Storage buckets: none public. Expected: 0 rows. (The nine files do not touch storage; 'private-media'
--     comes from baseline 202609200001 and is inserted with public=false.)
select id, name, public from storage.buckets where public is distinct from false;

-- E2. Inventory of all buckets for the evidence record. Expected: private-media, public=false.
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- E3. Policies on storage.objects, for review (the nine files add none; baseline adds the private_media_read_own SELECT policy).
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'storage' and tablename = 'objects' order by policyname;

-- E4. Data checks for 20261004150000's backfill: no completed journey may lack a review state. Expected: 0.
select count(*) as completed_without_review_state
from public.care_journeys where state = 'completed' and completion_review_state is null;

-- E5. Structural zero-state sanity (an install must not create data). Expected on a fresh install: all 0,
--     except any rows the application itself has since written.
select (select count(*) from public.care_experts)               as experts,
       (select count(*) from public.care_journeys)              as journeys,
       (select count(*) from public.care_reviewed_quotes)       as quotes,
       (select count(*) from public.care_journey_events)        as events,
       (select count(*) from public.care_journey_commands)      as commands,
       (select count(*) from public.care_technician_accounts)   as technician_accounts,
       (select count(*) from public.care_technician_invitations) as technician_invitations,
       (select count(*) from public.care_technician_commands)   as technician_commands;
```

### 3.6 Pass criteria

Post-install is accepted only if: A1 9×PASS; A2 0 rows; A3 = 17/8/9 (or the recorded, approved variant); A4
identical to the pre-install snapshot; B1 8×PASS; B2 0 rows; B3 0 rows; B4 19 rows (5 columns, 1 sequence, 4
constraints, 6 indexes, 3 triggers enabled); B5 true; C1 10×PASS; C2 true; C3 all 1; C4 10×PASS; D1/D2 0 rows;
D4 all false for `anon`/`authenticated` (otherwise recorded as a finding for review, see F5); D6/D7 0 rows;
E1 0 rows; E4 0. Any deviation → stop, record, do not continue to hosted acceptance.

## 4. Gap review: `staging-backup.yml` and `STAGING_BACKUP_EXECUTION.md` vs the nine-migration stack

Reviewed at the pin: `.github/workflows/staging-backup.yml` (blob `a1023d8fe055f676db3bb85953da2e38a748b22b`),
`docs/STAGING_BACKUP_EXECUTION.md` (blob `7b192d600bdb4d4a549d5a67488c96d44651a197`),
`ops/staging-backup/backup.mjs` (blob `05233be05d8a89123960c725876e58e54484e8b1`), and
`ops/staging-backup/recovery.mjs` / `recovery-contract.mjs`. The same blobs are on `origin/fix/phone-test-delivery`
(`47241fc…`, the only branch the workflow runs on). On the default branch `main` the workflow is an **older
blob** (`01647fa13bfd794f3098c182bbbaace9e215a2ac`) without the two CA-trust secrets and the v2 oracle summary text.
This review is a read of the repository only; hosted environment settings, secrets and run history were **not** inspected (UNVERIFIED).

| # | Area | What the repo shows | Gap for the nine-migration stack | Severity |
| --- | --- | --- | --- | --- |
| G1 | Revision gate | `backup.mjs` hard-codes `APPLICATION_SHA = '821125df9556225b4d34ff1aec4072c2d789b4cf'` (PR #35) and `validateGate` requires `REQUESTED_REVISION === APPLICATION_SHA` and `STAGING_APPROVED_REVISION === APPLICATION_SHA`. | Dispatching with `revision=18240dc…` fails the gate (`SKYCAR_BACKUP_FAILURE phase=configuration category=validation`). The workflow can only ever be run for `821125d`, i.e. the six-file packet. A source change, independent review, new operations commit on the allowed branch and a new `STAGING_BACKUP_APPROVED_WORKFLOW_SHA` pin are needed first. | **Blocker** |
| G2 | Empty-project-only scope | `EMPTY_TARGET_SQL` (run before and after capture) requires PostgreSQL 17, **no `public` base tables, no rows in `auth.users`, no storage buckets or objects, and zero rows in `supabase_migrations.schema_migrations`**. The doc says: "strictly the first empty-project restore point, not a general backup service." | A staging project that already has the eight baseline files (which the nine require) fails this gate (`Unexpected staging baseline` / `Unexpected migration history`). The workflow therefore cannot produce the pre-nine-migration restore point. If staging is actually empty (F2) the workflow is usable only before installing the baseline, and the install set must then be 17 files. | **Blocker** |
| G3 | Schemas captured | Three Supabase CLI `db dump` exports (`roles.sql`, `schema.sql`, `data.sql`) at CLI `2.117.0`; doc: "The CLI's schema filters omit Supabase-managed schemas and migration history." Data dump excludes `storage.buckets_vectors` and `storage.vector_indexes`. | The nine files only create objects in `public` (plus FKs to `auth.users`), so `public` is in scope. But `auth` (users referenced by `care_technician_accounts.user_id`, `care_technician_commands.actor_id`, `care_reviewed_quotes.submitted_by_technician`), `storage` rows (including `storage.buckets`) and `supabase_migrations.schema_migrations` are **not** in the archive. A populated restore needs those; whether recovery handles populated `auth.users` FKs is **UNVERIFIED** (the v2 contract is built around the empty managed baseline). | High |
| G4 | Storage objects | `backup.mjs` records `storageObjects: 'NOT_INCLUDED'`; doc: "Storage object bytes are not included." | Objects in the `private-media` bucket (created by baseline files; whether completion-evidence uploads, authorised by `care_technician_completion_upload_access`, also land there is **UNVERIFIED**) are not backed up. Rows referencing them (`care_journeys.completion_evidence` hashes/sizes) would restore without bytes. Needs a separate storage backup plan or an explicit "no staging objects worth keeping" decision recorded. | High |
| G5 | Version check | The only migration-history check is "count = 0" in `EMPTY_TARGET_SQL`. No check that the eight baseline versions are present, that the nine new versions are absent (pre) or present exactly once (post), and nothing compares blob SHAs. The oracle records the managed baseline, not application migrations. | Add the inventory/version assertions from sections 2.1 and 3.1 to the procedure (as a manual, recorded step at minimum). The workflow's `schema_migrations` row count cannot distinguish "empty" from "baseline-only". | High |
| G6 | Stale documentation | Doc and workflow refer to application `821125d` / PR #35, "the existing six-migration packet", and "empty" staging. Nothing refers to versions `20261003064126`–`20261101024732`, PR #74, or `18240dc`. | Doc must be updated (by a reviewed change) to the real install set and pin; until then it describes a different installation. | Medium |
| G7 | Restore test | Backup run records `restoreStatus: NOT_RUN`. `recovery.mjs restore-local` restores into a **fresh loopback-only local Supabase stack** and requires the target baseline to equal the encrypted source oracle; CI runs it on synthetic data. Doc: "Hosted connection, actual encrypted backup, private retention/decryption, actual-baseline restore, migrations, deployment and hosted/physical-phone acceptance remain **NOT RUN**." The doc cites failed hosted runs `36422281209` and `36601748743` and says failed runs must not be rerun. | No repo evidence of any successful hosted capture or of a restore rehearsal with the nine-file schema. The rehearsal must restore a populated baseline (+ nine) and then run section 3 against the restored copy; PostgreSQL 17.11 extension/operator behaviour changes are documented as a stop condition. | High |
| G8 | Trigger and protection | `workflow_dispatch` only (no schedule, `pull_request`, `pull_request_target` or `workflow_run`); `environment: skycar-staging`; job `if:` and the pre-checkout step both require `github.ref == refs/heads/fix/phone-test-delivery`; `GITHUB_SHA`/`GITHUB_WORKFLOW_SHA` must equal the `STAGING_BACKUP_APPROVED_WORKFLOW_SHA` variable; confirmation string `ISOLATED-STAGING-BACKUP-ONLY`; `contents: read`; concurrency group `skycar-staging-operations`; artifact is ciphertext only, 7-day retention. Doc states that branch backs frozen PR #31 and must not be edited until released. | Sound as a manual, protected design. Open points: environment required-reviewer and branch-policy settings, the pinned variable values and secret presence are **UNVERIFIED** from the repo; the default-branch (`main`) copy of the workflow differs from the execution-branch copy; installing a new operations commit means touching a branch tied to frozen PR #31. | Medium |
| G9 | Retention and custody | Artifact expires after 7 days; the administrator must download, checksum and keep it privately; decryption helper `decrypt.mjs`; key custody is owner-held RSA 3072+. Decryption is explicitly "not a database restore rehearsal". | Needs a dated custody record before migration (checklist row 11). Supabase-native backup/PITR is not exercised by this workflow at all. | Medium |
| G10 | Other staging workflow | `staging-readiness.yml` (blob `6e3976952eee9ee49b4311d15f9e02d88b6405e5`) gates on `vars.STAGING_APPROVED_REVISION`. | That variable must equal the revision actually being deployed/tested; today the doc ties it to `821125d`. Not read further. | Low |

Recommended order (documentation only; none of it is authorised by this PR): (1) founder confirms real
staging inventory (F2); (2) decide the install set (9 vs 8+9); (3) reviewed change to `backup.mjs`/workflow/doc
for the new pin and a populated-baseline backup contract, or an alternative backup method recorded by the
founder; (4) test restore on a disposable target; (5) re-run section 2, then install, then run section 3.

## 5. What this document does not establish

- It does not show that staging is ACTIVE_HEALTHY, non-production, backed up, restorable, RLS-clean or free of production credentials.
- It does not show the hosted migration inventory. Disposable CI passes in PR #74 are not hosted evidence.
- The SQL results quoted here come from a disposable local PostgreSQL 17.6 with stubs, not from Supabase.
- The `md5(prosrc)` fingerprints in C1 are derived from the pinned files by applying them locally; they bind
  function bodies, not file blobs (`schema_migrations.statements` is CLI-split text and cannot be hashed back to a Git blob).
