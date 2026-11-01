# V2 nine-migration install: manifest, pre-migration checklist, post-migration verification, backup gap review

> **Revision 3 (adds section 9: pre-launch ops for request-photo uploads). Revision 2 added sections 6-8: staging inventory reconciliation, backup design proposal, why the 27-29 Sep runs failed.**
>
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
| F2 | **Conflicting staging-state descriptions; resolved in favour of the 20 Oct readback (section 6).** `docs/STAGING_BACKUP_EXECUTION.md` (at the pin) describes staging as an **empty** project with no applied migration history and a six-migration packet at `821125d`. The later 20 Oct 2026 readback in issue #8 (comment 6289948265) reports **eight baseline migrations installed** and the pending candidates **not** applied. | Section 6 (quoted with comment id, author and time). | The nine-file install set is consistent with the 20 Oct readback (eight baseline + nine). The 20 Oct text is a reported read by the owner account, not something re-observed here; current state **UNVERIFIED** and must be re-read (the project was INACTIVE on 11 Oct and at the start of 20 Oct). |
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
| 6 | `schema_migrations` inventory recorded | Run P1-P2 in section 2.1 | Output saved; the eight baseline **names** present (hosted versions may be generated at install time and differ from repository filenames, section 6); no unexpected rows; none of the nine new names present | saved output | UNVERIFIED |
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

**Version caveat.** The 20 Oct readback says hosted migration versions "were generated on installation and
differ from repository filenames". If the nine are applied through the Supabase CLI (`db push`) the versions
equal the filename prefixes and A1 applies. If they are applied through any path that generates versions
(for example the connector `apply_migration`), A1 will correctly FAIL on versions; use A1n (name, count and
order based) instead and record the actual hosted versions. Either way A2/A3 must show no duplicate and no
baseline replay (the baseline count must stay at 8 and the new rows at exactly 9).

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

A1n (use instead of A1 when hosted versions were generated at install time; also run locally, 9 PASS / 0 order violations):

```sql
-- A1n. Name-based variant of A1 for projects whose hosted versions were generated at installation
-- (20 Oct readback: "hosted migration versions ... differ from repository filenames"). Record the actual
-- versions in the evidence log; the check is then on names, count and order. Expected: 9 rows, all PASS.
with expected(ord, name) as (values
  (1,'care_connected_journey'),(2,'technician_inbox'),(3,'technician_quotes'),(4,'technician_work_start'),
  (5,'technician_completion'),(6,'customer_completion_review'),(7,'completion_review_security_fix'),
  (8,'completion_review_replay_authority'),(9,'completion_review_final_lock_authority'))
select e.ord, e.name, count(m.*) as rows_for_name, min(m.version) as hosted_version,
       case when count(m.*) = 1 then 'PASS' else 'FAIL' end as status
from expected e
left join supabase_migrations.schema_migrations m on m.name = e.name
group by e.ord, e.name order by e.ord;

-- A1n-order. The nine names must have been applied in manifest order (hosted versions strictly increasing
-- with ord) and after every baseline name. Expected: 0 rows.
with expected(ord, name) as (values
  (1,'care_connected_journey'),(2,'technician_inbox'),(3,'technician_quotes'),(4,'technician_work_start'),
  (5,'technician_completion'),(6,'customer_completion_review'),(7,'completion_review_security_fix'),
  (8,'completion_review_replay_authority'),(9,'completion_review_final_lock_authority'))
select a.name as earlier_in_manifest, b.name as later_in_manifest
from expected a join expected b on a.ord < b.ord
join supabase_migrations.schema_migrations ma on ma.name = a.name
join supabase_migrations.schema_migrations mb on mb.name = b.name
where ma.version >= mb.version;
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

## 5. What this document does not establish (see also sections 6-8)

- It does not show that staging is ACTIVE_HEALTHY, non-production, backed up, restorable, RLS-clean or free of production credentials.
- It does not show the hosted migration inventory. Disposable CI passes in PR #74 are not hosted evidence.
- The SQL results quoted here come from a disposable local PostgreSQL 17.6 with stubs, not from Supabase.
- The `md5(prosrc)` fingerprints in C1 are derived from the pinned files by applying them locally; they bind
  function bodies, not file blobs (`schema_migrations.statements` is CLI-split text and cannot be hashed back to a Git blob).

## 6. Staging inventory reconciliation (read-only, repository evidence only)

No Supabase connector, project credential or database access was available while writing this section, so **no
hosted fact was observed directly**. Items are labelled **VERIFIED** only when they were read from a file,
comment, run or log in the repository during this review (source named); hosted facts that are only reported
in prose are **UNVERIFIED** and show their source.

### 6.1 The 20 October readback (quoted)

- Where: issue #8, comment `6289948265` -
  https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-6289948265
- Posted by: `jimmoq-hopsup-Hoqde6` (author association OWNER). The comment text says it is the "existing sole
  Backend/DevOps" owner's read-only continuation "requested by Marcel"; whether a person or an agent session
  wrote it is not stated.
- Posted: 2026-10-20T11:36:02Z = **20 Oct 2026, 22:06 (Australia/Adelaide, UTC+10:30)**. An earlier comment
  (`6289648961`, 2026-10-20T11:17:41Z = 21:47 Adelaide) reported the same project **INACTIVE**.
- Exact words relied on: "Supabase `...` is ACTIVE_HEALTHY"; "Eight baseline migrations installed (foundation,
  Care requests/My Jobs, Garage mutations/photos, offers, access hardening, guest requests)"; "Connected
  journey table and completion-review RPC are absent. The eight pending candidate migrations below have not
  been applied."; "Sixteen public tables have RLS enabled. `private-media` exists with public=false. anon/authenticated
  have no direct guest-request SELECT privilege"; "Only one customer role exists; no admin/operator or technician
  roles"; "Existing hosted migration versions were generated on installation and differ from repository
  filenames, reconcile names/content, do not replay the eight baseline migrations"; "Existing populated
  baseline cannot be treated as an empty-schema recovery fixture. No backup/recovery success is established
  by project resumption."
- **The comment does not list the hosted version numbers.** It gives names only, so "exact versions" cannot be
  quoted from it; the hosted versions are **UNVERIFIED** and (by its own statement) differ from the repository
  prefixes. Its eight pending files are given as SHA-256 values, not Git blobs.
- Cross-check done here: the eight SHA-256 values in that comment equal the SHA-256 of the same eight files at
  `18240dc` (recomputed from the pinned tree). The ninth file did not exist then (it is added by PR #74).
  The eight baseline names it lists correspond one-to-one to the eight baseline files in section 1.

### 6.2 Inventory table

| Item | Status | Evidence source |
| --- | --- | --- |
| Eight baseline migrations exist in the repository at the pin, with the blob SHAs in section 1 | VERIFIED | `git ls-tree` at `18240dc` |
| The nine candidate files match the PR #74 comment and the tree | VERIFIED | section 1 script, PR #74 comment `6552566823` |
| The eight earlier pending files are byte-identical to the ones the 20 Oct readback hashed | VERIFIED | SHA-256 recomputed from the pinned tree vs comment `6289948265` |
| Staging project was ACTIVE_HEALTHY on 20 Oct 22:06 Adelaide | UNVERIFIED (reported) | comment `6289948265`; not re-observed |
| Staging project is ACTIVE_HEALTHY now | UNVERIFIED | no newer record found; project was INACTIVE on 11 Oct (comment `6106946644`) and 20 Oct 21:47 (comment `6289648961`) and had to be restored; free-plan projects pause after a week of inactivity (Supabase pricing page), plan tier UNVERIFIED |
| Eight baseline migrations installed (by name) | UNVERIFIED (reported 20 Oct) | comment `6289948265` |
| Hosted versions/names/statements of the eight | UNVERIFIED | not quoted anywhere; comment says they differ from filenames |
| Nine (or the earlier eight) pending migrations not yet applied | UNVERIFIED (reported absent on 20 Oct for the eight; the ninth did not exist) | comment `6289948265`; no later record found in issue #8 |
| 16 public tables, RLS enabled on all | UNVERIFIED (reported) | comment `6289948265` ("metadata checks, not hosted JWT/media acceptance") |
| `private-media` bucket public=false | UNVERIFIED (reported) | same |
| Roles: one customer, no admin/operator/technician | UNVERIFIED (reported) | same |
| Staging is non-production | UNVERIFIED | marker variable `STAGING_ISOLATION_MARKER=skycar-v2-isolated-staging` appears in run logs, but that proves only that a variable was set; no production-ref comparison was recorded |
| Backup / PITR / any successful backup or restore | NOT ESTABLISHED | workflow history: 3 runs, all failed (section 8); 20 Oct readback: "No backup/recovery success is established" |
| Plan tier (daily backups / PITR entitlement) | UNVERIFIED | not recorded anywhere found |
| Secrets/variables | UNVERIFIED | never read; last independent readback of `skycar-staging` controls was 29 Sep (comment `5891303025`) and showed the two CA secrets absent, since reported added (3rd run log shows both set) |
| Env/branch secret configuration for the candidate preview | UNVERIFIED (reported) | comment `6289948265`: `SUPABASE_SECRET_KEY` scoped only to Preview branch `fix/phone-test-delivery`; `SKYCAR_APP_ORIGIN` points at the old branch URL |

### 6.3 Reconciliation

- **Which source is newer:** the 20 Oct 2026 readback (22:06 Adelaide) is newer than the statements in
  `STAGING_BACKUP_EXECUTION.md`, which are tied to application `821125d`/PR #35 and to backup runs of
  27-30 Sep (last failed run 2026-09-29T20:59Z). Nothing in issue #8 between 30 Sep (last comment
  2026-09-30T11:36Z) and 4 Oct mentions installing migrations; the baseline installation itself is **not
  recorded in any comment I could read**, so its date, executor and method are unknown.
- **Which is authoritative:** neither is authoritative proof of present hosted state. For *intent*, the 20 Oct
  readback is the later and more specific record (eight baseline, populated, versions generated at install),
  and the "empty / six migrations" wording in `STAGING_BACKUP_EXECUTION.md` should be treated as **stale**
  (it is also explicitly about the failed first-capture plan). For *current* state, only a fresh read-only
  inventory (section 2.1, P1-P7) is authoritative, and it has not been done.
- **Why the two can both be true:** the docs describe the project when the empty-project backup was attempted
  (27-30 Sep, all attempts failed, so the project could still have been empty then); the readback describes it
  three weeks later after an unrecorded baseline installation.
- **What is still unproven:** current project health; exact hosted versions and names; whether any of the
  pending files has since been applied; non-production confirmation; RLS/grants/buckets (only reported
  metadata); backup entitlement; any backup or restore at all; storage object contents.
- **Practical consequence:** the install set is the nine files on top of the eight installed baseline
  migrations (not 8+9), but only after the inventory is re-read; the backup workflow as written cannot take
  the pre-install restore point (section 4 G1/G2, section 8).

## 7. Proposed backup route for a populated project (design only; nothing implemented or executed)

Principles: defence in depth (platform backup **and** an independent logical export), restore is proven only by
restoring into a **new, disposable** target and running section 3 against it, no production credentials,
manual/protected trigger, ciphertext-only artifacts, and no step that mutates staging.

### 7.1 Layer A: Supabase platform backups (daily or PITR) with a test restore

- Confirm the staging project's plan. Per Supabase's published docs (checked 1 Nov 2026): the Free plan has
  **no** automatic backups and no PITR and cannot use "Restore to a new project"; Pro/Team/Enterprise take daily
  backups (7/14/up to 30 days), PITR is a paid add-on (requires at least Small compute; it replaces daily backups).
  Plan tier and any backup entitlement for the staging project are **UNVERIFIED**.
- If entitled: record the newest backup/PITR timestamp before install; **test restore with "Restore to a new
  project"** (database-only copy including `auth` data and the encryption root key) rather than an in-place
  restore, which overwrites the project and makes it inaccessible during the restore. Then run P1-P7 and
  section 3 against the copy. Restored projects reconfigure compute/SSL but not Storage objects, Edge
  Functions or app secrets (docs: database-only copy).
- If not entitled (Free): Layer A does not exist. Either upgrade (a purchase decision for the founder), or rely
  on Layer B alone and record that explicitly.

### 7.2 Layer B: logical export of a populated project (replaces the empty-only capture)

Roles, schema and data in separate files, from a PostgreSQL 17 client matching the server major version:

1. `roles.sql`: roles (`supabase db dump --role-only` or `pg_dumpall --roles-only` equivalent).
2. `schema.sql` and `data.sql`: **explicitly include** `public`, `auth`, `storage` (rows of `storage.buckets` and
   `storage.objects` metadata) and `supabase_migrations` (`schema_migrations`), because the default CLI
   dump filters omit Supabase-managed schemas and migration history (documented in
   `STAGING_BACKUP_EXECUTION.md`). Use `pg_dump --schema=public --schema=auth --schema=storage
   --schema=supabase_migrations` (or the CLI's `--schema` option; CLI 2.117.0 flags are **UNVERIFIED** here),
   keep `--use-copy`/`--no-owner`-style options consistent with the documented restore recipe, and keep the
   existing exclusion of `storage.buckets_vectors`/`storage.vector_indexes`.
3. Record in the (authenticated, signed) manifest: server version, per-schema table row counts,
   `schema_migrations` rows (version, name), `md5` of migration `statements` where present, bucket list,
   `storage.objects` count and total size, and the sha256 of each dump file.
4. Vault/encrypted-column caveat: dumps never contain the root encryption key; if Vault or column encryption is
   used, the key must be retrieved from the active project and held under the same custody rules. Whether
   staging uses Vault is **UNVERIFIED**.

### 7.3 Layer C: storage object export

`pg_dump` captures object *metadata* only. Add a separate export of bucket contents (at minimum
`private-media`) via the project's S3-compatible Storage endpoint or the CLI's recursive copy (flags
**UNVERIFIED**), with: a pre/post object-count and byte-size comparison against `storage.objects`, per-object
checksums in the manifest, the same encryption wrapper as the database dumps, and an explicit "restore bytes
into the restored target and verify path/owner/`public=false`" step. If the founder decides that no staging
object is worth keeping, record that decision and still back up the metadata so rows and bytes cannot drift
silently. Any S3 access keys are new secrets and are outside this document's authority.

### 7.4 Changes needed to `ops/staging-backup/backup.mjs` and `.github/workflows/staging-backup.yml`

Reviewed code change in a separate PR with independent review; none of this is done or authorised here.

| # | Change | Where | Reason |
| --- | --- | --- | --- |
| C1 | Remove the hard-coded `APPLICATION_SHA`; take the requested revision as an input and compare it with `STAGING_APPROVED_REVISION` (and require it to be the manifest pin, e.g. `18240dc...`) | `backup.mjs` `validateGate` (lines ~17, 108-110) | Gate currently only passes for `821125d` |
| C2 | Replace `EMPTY_TARGET_SQL` with an **inventory gate**: PostgreSQL 17, expected baseline `schema_migrations` names present, none of the nine new names present (pre-install mode) or all nine present once (post-install mode), RLS enabled on all public tables, all buckets private; failure is a distinct `baseline`-class code with the offending object names but no data | `backup.mjs` | The empty-only gate rejects every populated project |
| C3 | Make "before" and "after" gates compare **equal inventories** (row counts per schema, migration rows, bucket/object counts) so a concurrent change aborts the run | `backup.mjs` | Detects drift between capture start and end |
| C4 | Dump `auth`, `storage` metadata and `supabase_migrations` explicitly; drop the "managed baseline" assumption from the oracle or extend recovery contract v3 to know populated `auth.users` FKs and `schema_migrations` | `backup.mjs`, `recovery-contract.mjs`, `recovery.mjs` | Section 7.2 |
| C5 | Add storage object export (7.3) with a count/size/checksum manifest, or an explicit documented opt-out | `backup.mjs`, workflow | Section 7.3 |
| C6 | Add a `restoreStatus` path that is not hard-wired `NOT_RUN`: record a rehearsal result only when a separate rehearsal job (below) passes | `backup.mjs`, workflow | Backup without a restore is not evidence |
| C7 | Add a **restore-rehearsal job** (loopback-only, disposable local Supabase stack, same recovery helper) that restores the decrypted artifact and runs sections 2.1 and 3 SQL read-only against it | workflow + `recovery.mjs` | Restore-test criterion |
| C8 | Keep: `workflow_dispatch` only, `skycar-staging` environment with required reviewers, branch restriction, approved-workflow-SHA pin, confirmation string, `contents: read`, concurrency group, ciphertext-only artifact with short retention, no schedule/PR triggers | workflow | Existing protections are sound (G8) |
| C9 | Move execution off the branch tied to frozen PR #31, or get an explicit release of that branch | operations decision | G8 |
| C10 | Add TLS/connectivity pre-diagnostics (section 8.3) that run before the baseline gate | `backup.mjs` | The previous three failures were opaque |
| C11 | Update `STAGING_BACKUP_EXECUTION.md` (stale six-migration/empty wording), `STAGING_APPROVED_REVISION` handling, and the workflow summary text; refresh synthetic contract tests (`tests/ops/staging-backup.test.mjs`) to cover populated fixtures | docs/tests | G6 |

### 7.5 Restore-rehearsal acceptance criteria

All must hold, with evidence in the installation record, before any install is released:

1. Restore target is a **new disposable** project (Layer A) or a loopback-only disposable stack (Layer B); never the staging project itself, never production.
2. Restored `supabase_migrations.schema_migrations` equals the pre-install snapshot (rows, names, versions) with no duplicates.
3. Row counts for every `public`, `auth` (users, identities) and `storage` (buckets, objects) table equal the manifest.
4. P6/P7 and section 3.2 B2/B3 pass: RLS enabled on all public tables, no unexpected policies, buckets `public=false`.
5. Section 3.3/3.4 grant checks match the reviewed expectations (recorded deviations explained, e.g. F5).
6. Storage bytes restored and sha256-compared for every object in scope, or the documented opt-out is signed off.
7. Functional probe on the restored copy with synthetic data only: a service-role RPC call succeeds and an `anon`/`authenticated` call is denied.
8. Time to restore (RTO) and age of the restore point (RPO) are recorded; the artifact decrypts with the owner-held key and its sha256 matches the manifest.
9. The rehearsal is repeated after any change to the backup tooling or the migration set.

## 8. Why the 27-29 Sep backup runs failed (logs read-only)

Times: UTC from the API, with Adelaide (ACST, UTC+9:30 before 4 Oct) in brackets. Workflow `staging-backup.yml`
(`workflow_dispatch`, branch `fix/phone-test-delivery`). **There have been exactly three runs, all failed, none
since 29 Sep** (`list_workflow_runs` returns 3).

| Run | Dispatched | Operations SHA | Failed step | Final message in the log |
| --- | --- | --- | --- | --- |
| `36325849443` | 2026-09-27T14:25Z (28 Sep 00:55) | `a601410` | step 8 "Capture encrypted read-only export" (job 22:29:49-22:30:11Z, 28 Sep 07:59) | "Staging backup stopped; no raw diagnostic or backup content published. Check approved configuration and private recovery procedure." (no phase/category) |
| `36422281209` | 2026-09-28T12:30Z (28 Sep 22:00) | `6a278b9` | same step (12:38:19-12:38:20Z, 28 Sep 23:08) | `SKYCAR_BACKUP_FAILURE phase=baseline-before category=command` |
| `36601748743` | 2026-09-29T16:59Z (30 Sep 02:29) | `785d18b` | same step (20:59:50-20:59:51Z, 30 Sep 06:29) | `SKYCAR_BACKUP_FAILURE phase=baseline-before category=command` |

What the logs prove:

- Every step before capture succeeded: approved-SHA check, checkout, Node setup, locked CLI install,
  PostgreSQL 17 client install (`pg_dump 17.11`), gate verification.
- Run 1 failed in under 2 s inside capture with only the generic message. Runs 2 and 3 failed in about 1-2 s at
  phase **`baseline-before`**, category **`command`**: the *first* `psql` call (`EMPTY_TARGET_SQL`) exited
  non-zero. Per `STAGING_BACKUP_EXECUTION.md`, the category `baseline` is reserved for the query's exact
  `Unexpected staging baseline`/`Unexpected migration history` exceptions; `command` means psql failed
  some other way. So the project was **not** (provably) rejected as non-empty; the run never got a result.
- In run 2 the environment lists no `STAGING_SUPABASE_DB_CA_*` secrets; run 3 lists both set, and fails the
  same way. Runs 2-3 used the same host/user/ref secrets (values masked).
- No dump, ciphertext or artifact was produced in any run; no later run exists.

What they do **not** prove (cause **UNVERIFIED**; the stderr is deliberately suppressed): TLS/CA trust, wrong
credentials, wrong host form, network reachability, a server-version mismatch, or a SQL/permission error. The
review comments say the same ("proves the initial psql command failed, not why").

### 8.3 Candidate causes to test in a diagnostics-only change (hypotheses, not findings)

1. **Reachability:** GitHub-hosted runners are IPv4-oriented; a Supabase *direct* database host may require
   IPv6 or an add-on, whereas the pooler host is IPv4. The host secret form is not visible. Test with a
   non-secret `getaddrinfo`/TCP-connect probe that prints only success/failure per address family.
2. **TLS:** verify-full against the project CA vs system trust (runs 1-2 had no CA secret; run 3 had one).
3. **Authentication:** user/password mismatch for the chosen host (direct host uses `postgres`, the pooler
   uses `postgres.<ref>`).
4. **Privilege or server state:** the gate reads `auth.users`, `storage.buckets`, `storage.objects`; a role without
   rights, or an INACTIVE (paused) project, fails the same way. The project was INACTIVE on 11 and 20 Oct
   (before restoration), which proves it can be paused; its state on 27-29 Sep is **UNVERIFIED**.
5. **Gate design:** independent of the above, the empty-only gate (G1/G2) would reject the populated baseline
   now reported, so even a working connection would end in `category=baseline`.

PR #45 (merged into `fix/phone-test-delivery` as `1192d74`) added finer failure categories for the baseline
psql calls, but no run has used it, so the cause remains unproven.

### 8.4 Required before another run

Do not rerun the failed runs (they must stay immutable per the owner's rules); a new run needs a new reviewed
disposition, the corrected gate (C1/C2), the diagnostics (C10), and a fresh read-only inventory (section 2.1).

## 9. Pre-launch ops: request-photo uploads (monitoring, rollback, edge rate limiting)

Scope: the request-photo feature on `feature/request-photos-backend` (head `950a17c452a012ffb37604f33261920b1f8a2f97` when
this was written). It adds the server upload route `POST /api/v1/care/journey/{id}/photos`, the Storage layout (manifest + up to
three photos per request), and migration `20261101130000_request_photo_flag_and_upload_quota.sql` (final blob
`848ca31e0d610e990ebf98ab5e1542150a29e2b1`). **That migration is not one of the nine files in section 1 and is not approved,
applied or scheduled by this document.** Facts below come from the branch contents; anything about hosted staging, Vercel or
Supabase configuration is **UNVERIFIED** unless it says otherwise. Nothing here has been run against a hosted system. The SQL
was exercised only against a local throwaway PostgreSQL with the migration applied (synthetic, empty tables).

What the code and migration actually bound (from the branch):

- The application quota is `PHOTO_UPLOAD_LIMIT = 10` successful uploads per subject per `PHOTO_UPLOAD_WINDOW_SECONDS = 3600`
  (`src/server/care/journey/photo-service.mjs`). The route replies `429` with `Retry-After` when exhausted.
- Per-photo cap `PHOTO_MAX_BYTES = 900_000`, up to three photos per request (`src/server/care/guest-photos.mjs`); a request
  that is too large gets `413`; a Storage or database fault gets `503`.
- By design **rejected bodies, retries after a 503 and identical replays never consume quota** (migration header comment): the
  server reserves a slot before storing and releases it on any failure or reject. The consequence for ops is that the
  database quota does **not** limit how many rejected or invalid requests a client can send. Every one of them still costs a
  serverless invocation, body parsing and bandwidth. That is the gap section 9.3 closes at the edge.

### 9.1 Monitoring

The application emits no metrics, traces or structured logs for this feature. A grep of `src/`, `ops/`, `.github/` and
`package.json` at the branch head for Sentry, Datadog, OpenTelemetry, metrics, `console.*` and similar found only UI
`role="alert"` elements and the backup CLI's own stderr. So the only server-side evidence is whatever the hosting platform
records per request (status code, path, time, IP; UNVERIFIED which of these the project's plan keeps and for how long); error
codes such as `RATE_LIMITED` exist only in response bodies. The alerts below are therefore status-code based. Adding one
structured log line per upload outcome (code, subject hash, byte counts, no photo data) is a code change this document does not make.
Minimum set before real users upload photos. Each item needs a named owner and a place where the alert lands; neither exists yet.

| Signal | Where | Alert condition (starting values, tune after the first week) | Why |
| --- | --- | --- | --- |
| Route status mix for `POST /api/v1/care/journey/*/photos` (2xx, 400, 401/403, 413, 429, 503, other 5xx) | Vercel runtime logs / log drain (UNVERIFIED which plan retains logs and for how long) | 5xx or 503 above 2% of requests over 15 minutes with at least 20 requests; any sustained 5xx other than the mapped 503 | 503 means Storage or the quota/marker RPC failed; other 5xx means an unmapped fault |
| 429 volume and distinct subjects | same logs | more than 20 `429` in 10 minutes, or one subject receiving 429 repeatedly | abuse or a client retry loop; 429 only appears for the authenticated quota |
| 413 and 400 volume per IP | same logs | more than 30 per IP in 10 minutes | the flood the quota cannot see (section 9.3) |
| RPC missing or not callable | Supabase API logs (UNVERIFIED access) | any `PGRST202` or "function ... does not exist" for `care_reserve_photo_upload_slot`, `care_release_photo_upload_slot`, `care_record_request_photos` | the app was deployed before the migration, or the migration was rolled back; uploads fail closed |
| Quota slot leak | SQL M3 below, run daily by hand until automated | `gap` greater than 0 on any closed window | releases are failing, so honest users hit 429 early |
| Quota table growth | SQL M1 | `rows_older_than_2h` rising day over day | rows are pruned only when the same subject opens a new window; abandoned subjects are never pruned |
| Storage growth | Supabase dashboard storage usage (UNVERIFIED which bucket and quota) | bucket size above 50% of the plan allowance, or growth above 3x the 7-day average | free-plan limits and cost; a photo set is at most 3 x 900,000 bytes plus a manifest |
| Marker without a request (orphan) | SQL M4 | any row | marker has no foreign key by design |
| Edge firewall hits | Vercel Firewall dashboard (section 9.3) | any rule trigger on the photo route | confirms the rule is live and shows its false-positive rate |

Read-only SQL (run in a read-only transaction; every statement is a SELECT):

```sql
-- M1 quota-table growth and staleness (rows are pruned only when a subject opens a new window; abandoned subjects are never pruned)
select count(*) as rows_total,
       count(*) filter (where window_start < now() - interval '2 hours') as rows_older_than_2h,
       min(window_start) as oldest_window_start,
       coalesce(sum(uploads) filter (where window_start >= now() - interval '1 hour'), 0) as slots_held_last_hour
from public.care_photo_upload_quota;
-- M2 markers recorded per day and photos per marker (successful uploads)
select date_trunc('day', recorded_at) as day, request_kind, count(*) as markers, sum(photo_count) as photos
from public.care_request_photo_sets
where recorded_at >= now() - interval '14 days'
group by 1, 2 order by 1 desc, 2;
-- M3 slot-leak check for closed one-hour windows (PHOTO_UPLOAD_WINDOW_SECONDS = 3600 on the branch): only a call that creates a
-- marker keeps its slot, so slots_kept should equal markers_recorded in the same window. slots_kept > markers_recorded means
-- releases are failing (quota is being consumed by uploads that did not succeed). Expected: gap = 0 on every row.
select q.window_start, q.slots_kept, coalesce(m.markers_recorded, 0) as markers_recorded,
       q.slots_kept - coalesce(m.markers_recorded, 0) as gap
from (select window_start, sum(uploads) as slots_kept from public.care_photo_upload_quota
      where window_start < date_trunc('hour', now()) group by window_start) q
left join lateral (select count(*) as markers_recorded from public.care_request_photo_sets s
      where s.recorded_at >= q.window_start and s.recorded_at < q.window_start + interval '1 hour') m on true
order by q.window_start desc limit 24;
-- M4 markers whose request no longer exists (orphans; marker has no FK by design)
select s.request_id, s.request_kind, s.recorded_at
from public.care_request_photo_sets s
where (s.request_kind = 'account' and not exists (select 1 from public.care_requests r where r.id = s.request_id))
   or (s.request_kind = 'guest'   and not exists (select 1 from public.care_guest_requests g where g.id = s.request_id))
limit 50;
```

### 9.2 Rollback

The migration is additive: two new tables, three new functions, and a `CREATE OR REPLACE` of
`public.care_list_requests(integer, uuid, timestamptz, uuid)` (same signature and grants, two extra JSON fields). The rollback
therefore has two parts, in this order, and the order matters because the app calls the new functions.

1. **Stop traffic to the feature first.** Roll the application back to the last good deployment (Vercel: promote or redeploy
   the previous deployment) or disable the route at the edge (section 9.3 block rule). I found no photo-specific feature flag: the
   flags visible in `staging-readiness.yml` are `FEATURE_GARAGE`, `FEATURE_CARE`, `FEATURE_BENEFITS`, `FEATURE_SELL`, so turning
   the feature off in the app means a redeploy (UNVERIFIED that no other flag exists elsewhere). Do this before touching the database.
2. **Revert the database objects only if needed.** Leaving the additive objects in place is safe and is the default: the older
   application ignores the two extra fields and never calls the new functions. Revert only if a defect in the objects themselves
   is the cause. Before the install, capture the current definition and keep it with the change record:

   ```sql
   -- run BEFORE the install; store the output outside the database
   select pg_get_functiondef('public.care_list_requests(integer,uuid,timestamptz,uuid)'::regprocedure);
   select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
   ```

   Revert script (to be reviewed; destructive: it deletes every photo marker and quota row; the Storage objects stay):

   ```sql
   begin;
   -- 1. restore care_list_requests from the definition captured before the install (paste it here, unchanged)
   --    <output of pg_get_functiondef from the pre-install capture>
   -- 2. then drop the new objects
   drop function if exists public.care_record_request_photos(uuid, integer, text, text);
   -- superseded revisions of the same file (054e5d8, 538ccca), if one of them was ever applied:
   drop function if exists public.care_record_request_photos(uuid, integer, text);
   drop function if exists public.care_consume_photo_upload_quota(text, integer, integer);
   drop function if exists public.care_reserve_photo_upload_slot(text, integer, integer);
   drop function if exists public.care_release_photo_upload_slot(text, timestamptz);
   drop table if exists public.care_request_photo_sets;
   drop table if exists public.care_photo_upload_quota;
   -- 3. remove the history row ONLY after step 1 and 2 succeeded, matching on the name AND the recorded version
   --    delete from supabase_migrations.schema_migrations where version = '<recorded version>' and name = 'request_photo_flag_and_upload_quota';
   commit;
   ```

   Then re-run the absence check in 9.4: the expected verdict is `ABSENT`.
3. **Data and Storage.** Photos already written to private Storage are not removed by the revert. Decide separately whether to
   delete them; do not delete without a recorded owner decision. Without the markers the photos stay orphaned but private.
4. **Backup.** A rollback that drops tables needs the populated-project backup from section 7 taken first. Today the backup
   workflow cannot back up a populated project (finding F3), so the revert script above must not be run on hosted staging until
   that is fixed or an equivalent dump exists (UNVERIFIED: no such dump is evidenced in the repository).
5. **Who and when.** Decision owner for a rollback: the founder (UNVERIFIED who is on call). Practise the application rollback and the revert script on a throwaway database before launch; the local rehearsal behind this section covered only the apply and the absence check, not a revert.

### 9.3 Edge or platform rate limiting for rejected photo-upload requests

Problem: the database quota reserves a slot only for a request that is accepted far enough to store, and releases it for any
failure, so unauthenticated floods, oversized bodies (413), malformed bodies (400) and replays are not limited by the database
at all, and they can reach the serverless function. The limit must sit in front of the function.

Proposed rule (starting values; none of this is configured, and whether the project plan supports platform rate limiting,
custom WAF rules and log retention is UNVERIFIED):

| Setting | Proposal |
| --- | --- |
| Match | method `POST`, path pattern `/api/v1/care/journey/*/photos` (and the guest photo path if one is exposed; confirm the guest route list before launch) |
| Key | client IP; if the platform supports it, add the session cookie or `Authorization` presence as a second key so that shared NAT users are not blocked together |
| Counts | every response, including 4xx and 5xx, not only successes; this is the point of the rule |
| Limit | 20 requests per minute per IP on the path, with a stricter 5 per minute for requests the platform can see failing (4xx), if the platform supports conditional counting |
| Action | rate limit with `429` and a `Retry-After`, then a temporary block (for example 10 minutes) after repeated violations |
| Body size | reject above 2,800,000 bytes at the edge if the platform allows (3 x 900,000 plus form overhead); a code comment in `src/domain/garage/photo.mjs` cites Vercel's 4.5 MB request payload limit, which is above the app limit, so only an edge rule stops a body between 2.8 MB and 4.5 MB from reaching the function |
| Staging first | deploy in log-only mode for a week, review false positives against the monitoring in 9.1, then enforce |
| Kill switch | a pre-written block-all rule for the path (section 9.2 step 1), owned by the founder |

Acceptance for this item before launch: the rule exists and is enforced in staging; a scripted burst of invalid requests
from one IP is answered `429` at the edge (confirmed in the platform's firewall log, not only by the app); a normal user doing
three uploads in a minute is not blocked; and the app quota still returns its own `429` for an authenticated user
after ten successful uploads. None of that has been tested.

### 9.4 Absence check for migration 20261101130000 (read-only)

Use before the install (expected verdict `ABSENT`) and after a rollback. Hosted versions can differ from filenames, so history
is matched by version, by name and by statement text. Run inside `begin read only; ... rollback;`. Validated only against a
local throwaway PostgreSQL: it returned `ABSENT` on a database without the objects, and `PRESENT_OR_PARTIAL` when only the
migration was applied, when only a history row with the name existed, when only the superseded function
`care_consume_photo_upload_quota` existed, and when only a history row with different version and name but matching
statement text existed. It has never been run against hosted staging.

Revision history of the file on the branch (all by `jimmoq-hopsup-Hoqde6`, committer time Australia/Adelaide, +10:30):

| Commit | Time | Blob | Bytes | Objects |
| --- | --- | --- | --- | --- |
| `054e5d8` (also the content at `5ac91d7`) | 1 Nov 17:41 | `2bba66d7a818ccb06b97382408b2c9731aa4e9e3` | 9,019 | two tables; `care_record_request_photos(uuid,integer,text)`; `care_consume_photo_upload_quota` |
| `538ccca` (also on `feat/request-photos-display`) | 1 Nov 17:57 | `8e38bcbc813571d24260d8aac5a88ea3c9579baf` | 10,586 | two tables; `care_record_request_photos(uuid,integer,text)`; reserve and release functions replace consume |
| `dc2eddc` (current at `950a17c`) | 1 Nov 18:17 | `848ca31e0d610e990ebf98ab5e1542150a29e2b1` | 11,235 | `care_request_photo_sets` gains the `request_kind` column; `care_record_request_photos` gains `p_kind` (4 arguments) |

```sql
-- READ-ONLY. Confirms that migration 20261101130000 (request_photo_flag_and_upload_quota) is ABSENT.
-- Run as: begin read only; <this file>; rollback;   (SELECTs only; nothing is created or changed.)
-- Pinned to the file at feature/request-photos-backend dc2eddc and 950a17c, blob 848ca31e0d610e990ebf98ab5e1542150a29e2b1.
-- Earlier revisions (blob 2bba66d7… at 054e5d8 and 5ac91d7; blob 8e38bcbc… at 538ccca) created the same tables and care_consume_photo_upload_quota; those are covered too.
-- Hosted versions can differ from filenames, so history is checked by version, by name AND by statement text.

-- Q1. Migration history. Expected: 0 rows. Any row means something with this version, name or content is recorded.
select 'schema_migrations' as source, version, name,
       case when version = '20261101130000' then 'version match' end as by_version,
       case when name ilike '%request_photo%' or name ilike '%photo_flag%' or name ilike '%upload_quota%' then 'name match' end as by_name,
       case when array_to_string(statements, E'\n') ~* '(care_request_photo_sets|care_photo_upload_quota|care_record_request_photos|care_reserve_photo_upload_slot|care_release_photo_upload_slot|care_consume_photo_upload_quota)'
            then 'statement text match' end as by_content
from supabase_migrations.schema_migrations
where version = '20261101130000'
   or name ilike '%request_photo%' or name ilike '%photo_flag%' or name ilike '%upload_quota%'
   or array_to_string(statements, E'\n') ~* '(care_request_photo_sets|care_photo_upload_quota|care_record_request_photos|care_reserve_photo_upload_slot|care_release_photo_upload_slot|care_consume_photo_upload_quota)'
order by version;

-- Q2. Latest recorded versions (context; compare with the inventory taken before the install).
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;

-- Q3. Objects the file CREATES must not exist (2 tables, 3 functions; plus care_consume_photo_upload_quota from the superseded revision 054e5d8). Expected: 0 rows.
select 'table' as kind, c.oid::regclass::text as object
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('care_request_photo_sets', 'care_photo_upload_quota')
union all
select 'function', p.oid::regprocedure::text
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('care_record_request_photos', 'care_reserve_photo_upload_slot', 'care_release_photo_upload_slot', 'care_consume_photo_upload_quota')
union all
-- implicit objects created with the tables (primary-key indexes, constraints, row type)
select 'index/constraint/type', x.name
from (
  select i.relname as name from pg_class i where i.relnamespace = 'public'::regnamespace
    and i.relname in ('care_request_photo_sets_pkey', 'care_photo_upload_quota_pkey')
  union all
  select t.typname from pg_type t where t.typnamespace = 'public'::regnamespace
    and t.typname in ('care_request_photo_sets', 'care_photo_upload_quota')
) x;

-- Q3b. If either table exists, which revision shaped it? request_kind exists only from dc2eddc (blob 848ca31e...). Expected: 0 rows.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name in ('care_request_photo_sets', 'care_photo_upload_quota')
order by table_name, ordinal_position;

-- Q4. The file also REPLACES public.care_list_requests(integer, uuid, timestamptz, uuid) to add photo_count/has_photos.
--     The replaced body must NOT reference the new marker table or fields. Expected: 1 row, replaced_by_this_migration = false.
select p.oid::regprocedure::text as function,
       p.prosrc ~* '(care_request_photo_sets|photo_count|has_photos)' as replaced_by_this_migration,
       p.prosecdef as security_definer,
       md5(p.prosrc) as body_md5
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname = 'care_list_requests';

-- Q5. Any grant or privilege that would only exist if the file ran. Expected: 0 rows.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('care_request_photo_sets', 'care_photo_upload_quota');

-- Q6. One-line verdict. Expected: ABSENT.
select case when
         not exists (select 1 from supabase_migrations.schema_migrations
                     where version = '20261101130000'
                        or name ilike '%request_photo%' or name ilike '%photo_flag%' or name ilike '%upload_quota%'
                        or array_to_string(statements, E'\n') ~* '(care_request_photo_sets|care_photo_upload_quota|care_record_request_photos|care_reserve_photo_upload_slot|care_release_photo_upload_slot|care_consume_photo_upload_quota)')
         and to_regclass('public.care_request_photo_sets') is null
         and to_regclass('public.care_photo_upload_quota') is null
         and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                         and p.proname in ('care_record_request_photos', 'care_reserve_photo_upload_slot', 'care_release_photo_upload_slot', 'care_consume_photo_upload_quota'))
         and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                         and p.proname = 'care_list_requests' and p.prosrc ~* '(care_request_photo_sets|has_photos)')
       then 'ABSENT' else 'PRESENT_OR_PARTIAL: investigate before any install' end as migration_20261101130000;
```
