# V2 nine-migration install: manifest, pre-migration checklist, post-migration verification, backup gap review

> **Revision 9 (adds section 14.2.1: do not install the section 14.2 coverage blob; validated integration pins). Revision 8 (adds section 14: version mapping, week1-candidate delta, history-repair plan). Revision 7 (adds section 13: restore test of the logical export). Revision 6 (adds section 12: changed install set `60a48da`, pre-checks P9 to P11). Revision 5 (adds section 11: install results of 1 Nov 2026). Revision 4 (adds section 10: live staging inventory of 1 Nov 2026, the sequence-revoke migration `20261101133000` in the install set, and checklist items 14-15 with query P8). Revision 3 added section 9: pre-launch ops for request-photo uploads. Revision 2 added sections 6-8: staging inventory reconciliation, backup design proposal, why the 27-29 Sep runs failed.**
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

> ## INSTALL SET UPDATE (1 Nov 2026): sequence-revoke migration `20261101133000` is now part of the install set
>
> | Field | Value |
> | --- | --- |
> | File | `supabase/migrations/20261101133000_revoke_public_sequence_grants.sql` |
> | Blob SHA | `fcdfe66f90d54d8130d07c8ce3cd3b2afcaa5097` |
> | Commit | `39a2f89a4fe04cb5c02c863742ccbe075158827c` ("Revoke public sequence privileges from PUBLIC, anon and authenticated"), on branch `fix/sequence-grant-revoke`, committed 1 Nov 2026 19:38 ACDT (09:08Z) |
> | QA | **PASS at `39a2f89`**, as stated by the owner in the instruction for this revision; the QA record itself was not read here, so treat it as **UNVERIFIED** from this document's point of view |
> | Files in the commit | the migration (47 lines), `tests/integration/sequence-grant-revoke.acceptance.mjs` (63 lines), and a 6-line change to `tests/integration/garage-care-db.test.mjs` |
> | Blob checked | read from `git ls-tree 39a2f89` on the fetched branch; the file is not in the section 1 manifest, which stays pinned to `18240dc…` |
>
> The install set is therefore the nine files in section 1 **plus** this tenth file, applied last (its version sorts after every file in
> the manifest). The section 1 manifest, pin and F4 hash script cover the original nine only; verify the tenth file's blob SHA
> separately (`git rev-parse 39a2f89:supabase/migrations/20261101133000_revoke_public_sequence_grants.sql` must print the blob above).
> What the file does: for every non-extension sequence in `public` that the migration role can act as, `revoke all ... from public, anon, authenticated`
> and `grant usage, select ... to service_role`; then `alter default privileges in schema public revoke all on sequences from anon, authenticated`
> (only for the role that runs the migration). It skips, with a NOTICE, any sequence owned by a role it cannot act as, and its default-privilege change does not
> cover sequences created by `supabase_admin`. That is why checklist item 14 and query P8 exist.
> Live context (section 10, L15): on 1 Nov 19:31 ACDT staging showed `anon` and `authenticated` holding SELECT, UPDATE and USAGE on `audit_events_id_seq`.
> `care_journey_events_id_seq` does not exist there yet (it appears only once the connected-journey file is installed).
> Because this addition postdates the pin, checklist items 1, 2 and 13 must be read as covering the ten-file set; the owner's approval (item 1) is **not** recorded
> for the tenth file in this document.

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
| 14 | Hosted default privileges for sequences recorded (`supabase_admin` and `postgres`), and public sequence owners recorded, before installing `20261101133000` | Run P8 and P8b in section 2.1 against hosted staging inside `begin read only; … rollback;` | P8 output saved; P8b shows every `public` sequence owned by `postgres` (or by a role the migration role can act as). Any `supabase_admin`-owned sequence, or a `supabase_admin` default ACL granting `anon`/`authenticated` on sequences, is recorded as a finding: the migration will not revoke it and needs its own explicit REVOKE decision | redacted output | UNVERIFIED |
| 15 | Blob of the tenth file re-verified | `git rev-parse 39a2f89:supabase/migrations/20261101133000_revoke_public_sequence_grants.sql` | Prints `fcdfe66f90d54d8130d07c8ce3cd3b2afcaa5097`; applied last, after the nine files | command output | UNVERIFIED |

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

-- P8. Default privileges for sequences (read-only). Run on hosted BEFORE install (and after 20261101133000).
--     ALTER DEFAULT PRIVILEGES is per creating role: 20261101133000 only changes the default ACL of the role
--     that runs it (usually postgres). A sequence created by supabase_admin keeps supabase_admin's defaults.
--     Record every row. Expected before the revoke: anon / authenticated holding SELECT, UPDATE, USAGE on
--     sequences for supabase_admin (and/or postgres) is the known Supabase default. After the revoke,
--     the postgres row must show no anon/authenticated grant; supabase_admin rows are reported as found.
select r.rolname                                   as creating_role,
       coalesce(n.nspname, '(all schemas)')        as in_schema,
       d.defaclobjtype                             as objtype_s_is_sequence,
       case when a.grantee = 0 then 'PUBLIC' else g.rolname end as grantee,
       a.privilege_type,
       d.defaclacl::text                           as defaclacl
from pg_default_acl d
join pg_roles r on r.oid = d.defaclrole
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
left join pg_roles g on g.oid = a.grantee
where d.defaclobjtype = 'S'
  and r.rolname in ('supabase_admin', 'postgres')
order by r.rolname, n.nspname nulls first, grantee, a.privilege_type;

-- P8b. Who owns each existing public sequence, and who holds privileges on it (read-only).
--      20261101133000 skips (with a NOTICE) any sequence owned by a role the migration role cannot act as,
--      so a supabase_admin-owned sequence would stay exposed. Expected owner: postgres.
select c.relname as sequence, pg_get_userbyid(c.relowner) as owner, c.relacl::text as acl
from pg_class c
where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace
order by c.relname;
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

## 10. Live inventory 2026-11-01 (read-only, Supabase connector)

Collected 1 Nov 2026 on 19:30 to 19:35 ACDT (Australia/Adelaide, UTC+10:30; the advisor `observed_at` is 09:02Z, 19:32 ACDT) through the Supabase connector. Only list, get and single-SELECT calls were issued. No migration, DDL, DML, branch, pause, restore, deploy, key or secret call was made. No keys or secrets appear here. An earlier attempt between about 18:50 and 19:25 ACDT timed out on every database call (hibernated project); the 19:30 retry succeeded.

| # | Checklist item | Status | Source and time (ACDT) |
| --- | --- | --- | --- |
| L1 | Project `oelorquxkddvilopmibh`, name `skycar-v2-staging` | VERIFIED | `list_projects`, `get_project`, 1 Nov 19:23 |
| L2 | Only project visible to the connector; it is not production. A production project elsewhere is UNVERIFIED | VERIFIED (visible scope only) | `list_projects` |
| L3 | Status `ACTIVE_HEALTHY`; region `ap-southeast-2`; Postgres 17.6.1.166 (`ga`); created 2026-09-22T17:55:29Z | VERIFIED | `get_project`, 19:23 |
| L4 | Org `srsguzzcfunwmedokszi`, plan `free`, tier `tier_free` | VERIFIED | `list_organizations`, `get_organization` |
| L5 | No development branches; no edge functions | VERIFIED | `list_branches`, `list_edge_functions` |
| L6 | Applied migrations: exactly 8, matching the eight baseline families in section 6 (`foundation`, `care_requests`, `care_my_jobs`, `garage_mutations`, `garage_vehicle_photos`, `care_offers`, `staging_access_hardening`, `care_guest_requests`) | VERIFIED | `list_migrations`, 19:30; `schema_migrations` row count 8 |
| L7 | Hosted versions (below) differ from repo filenames; the names match | VERIFIED | `list_migrations` |
| L8 | None of the nine manifest migrations is recorded (no connected journey, technician inbox, quotes, work start, completion, customer completion review, security fix, replay authority or final lock authority) | VERIFIED by absence of any ninth-or-later row and of the objects in L12 | `list_migrations`, object query 19:31 |
| L9 | Q6 verdict for `20261101130000` (photo flag and upload quota) | VERIFIED: `ABSENT` | `execute_sql` Q6 SELECT, 19:31 |
| L10 | Statement text of the 8 applied migrations equals the repo files | UNVERIFIED (names and count only; statements not hashed against the repo) | not compared |
| L11 | RLS on all 16 public tables: `relrowsecurity` true on all 16; `relforcerowsecurity` false on all 16. Tables with RLS and zero policies: `audit_events`, `care_guest_requests`, `care_notification_outbox`, `care_offer_commands`, `care_offer_slots`, `care_offers`, `care_request_commands`, `care_response_policy`, `garage_mutations`. Policies: `care_request_events` 1, `care_requests` 1, `media_assets` 3, `profiles` 2, `user_roles` 1, `vehicle_history` 2, `vehicles` 4 | VERIFIED | `execute_sql` over `pg_class` and `pg_policy`, 19:31 |
| L12 | Connected-journey and completion objects: absent. No relation or function in `public` matches `journey`, `completion`, `reviewed_quote`, `care_experts` or `photo` except the baseline `garage_*_vehicle_photo` functions. `care_journey_events_id_seq` does not exist | VERIFIED | `execute_sql` catalog query, 19:31 |
| L13 | `storage.buckets`: one bucket, `private-media`, `public = false`, no size limit, no MIME restriction | VERIFIED | `execute_sql`, 19:31 |
| L14 | Counts: `auth.users` 1, `storage.objects` 3, `storage.buckets` 1 | VERIFIED | `execute_sql`, 19:31 |
| L15 | Grants to `anon`, `authenticated`, PUBLIC (from `aclexplode` on `pg_class` and `pg_proc`, schema `public`). Tables: `authenticated` has SELECT only on `care_request_events`, `care_requests`, `profiles`, `user_roles`, `vehicle_history`, `vehicles`; `anon` and PUBLIC have none. Functions: `authenticated` has EXECUTE on `care_get_offers`, `care_get_request`, `care_list_requests`, `care_retry_request`, `care_submit_request`, `garage_mutate_vehicle`; none for `anon` or PUBLIC. Sequences: `audit_events_id_seq` has SELECT, UPDATE, USAGE for both `anon` and `authenticated` | VERIFIED | `execute_sql`, 19:31 |
| L16 | Security advisors: INFO `rls_enabled_no_policy` x9 (the tables above); WARN `authenticated_security_definer_function_executable` x6 (the six functions above); WARN `auth_leaked_password_protection` disabled | VERIFIED | `get_advisors`, observed 19:32 |
| L17 | Backups and PITR | UNVERIFIED. The connector exposes no backup listing. Plan is `free`; under Supabase's published plan rules that means no scheduled backups and no PITR, so none should be assumed. Use the section 7 route before any migration | `get_organization` plus plan rules |
| L18 | Hibernation | VERIFIED as an event: DB calls timed out and the advisor reported "hibernated" from about 18:50 to 19:25, while `get_project` read `ACTIVE_HEALTHY`. The project answered at 19:30. Expect it to hibernate again when idle | `list_migrations`, `execute_sql`, `get_advisors` |

Hosted migration versions (name; the repo file it corresponds to):
`20260928230146 foundation` (202609200001), `20260930225800 care_requests` (202609200002), `20260930225820 care_my_jobs` (202609200003), `20260930225838 garage_mutations` (202609200100), `20260930225859 garage_vehicle_photos` (202609200300), `20260930225917 care_offers` (202609220100), `20260930230048 staging_access_hardening` (202609300001), `20261001023756 care_guest_requests` (20261001030000).

### Notes for the installer

1. Staging currently holds the eight baseline migrations only. The nine-file stack and `20261101130000` are not installed.
2. `anon` holds SELECT, UPDATE and USAGE on `audit_events_id_seq` (migration `20261101133000` is now in the install set to revoke this; see the install set update at the top and checklist items 14-15). This is likely a Supabase default privilege rather than a migration grant, but the cause is UNVERIFIED. Review it in the access-hardening follow-up. It is already present before any of the nine files is applied.
3. The existing data is small (1 auth user, 3 storage objects) but real. No backup route is available on the free plan, so run section 7 before applying anything.
4. Re-run section 3 and 9.4 SQL after any install; the hosted version numbers differ from the repo filenames, so match by name, as the sections do.

## 11. Install results 2026-11-01 (staging project `oelorquxkddvilopmibh` only)

Executed 1 Nov 2026 from 20:39 to 20:44 ACDT (Australia/Adelaide, UTC+10:30) by the Grok Bot executor, under the founder's approval (owner messages t15s1, answered 20:36 ACDT, and t11u). Org `srsguzzcfunwmedokszi` was on the **pro** plan (verified with `get_organization`). Nothing outside staging was touched: no production, no Vercel, no workflow dispatch, no PR, no merge, no rollback, no ad-hoc fix. No keys, connection strings or backup contents appear here.

### 11.1 Backup (logical export, taken before any change)

The direct and pooler Postgres endpoints were unreachable from the executor box (only HTTP and HTTPS egress), so `pg_dump` was not possible. The founder approved a logical export through the Supabase connector (`execute_sql`, read-only SELECTs) instead.

| Item | Value |
| --- | --- |
| Location (executor box only, not committed) | `/workspace/backups/staging-oelorquxkddvilopmibh-20261101T203900+1030/`, directory mode 700, files mode 600 |
| Manifest | `MANIFEST.json`, sha256 `925e98210d611c528505600738b8192f978847fd07a1dbb1fc91431b583dd8a8`; lists sha256 and size for 31 files |
| Size | 31 files totalling 300,547 bytes, plus the manifest itself |
| Contents | row data (JSON) for 16 public tables, `auth.users`, `storage.buckets`, `storage.objects` (metadata), `supabase_migrations.schema_migrations`; catalog JSON for relations and columns, constraints, indexes, triggers, policies, types, sequences with values, schemas and ACLs, default ACLs, extensions, role names; `schema.sql` (catalog-derived reference) and `functions.sql` (`pg_get_functiondef`) |
| Not included | storage object **bytes** (3 objects; the connector has no storage download and the storage API needs a service key), role passwords, other `auth` tables; this is not a `pg_dump` and not a restore-tested artefact |

Verification, all against independent live queries (VERIFIED, 20:39 to 20:40 ACDT):

| Check | Result |
| --- | --- |
| Exported row count equals live `count(*)` for every one of 20 tables | all 20 match (public: `audit_events` 3, `care_guest_requests` 4, `care_notification_outbox` 1, `care_offer_commands` 0, `care_offer_slots` 0, `care_offers` 0, `care_request_commands` 1, `care_request_events` 1, `care_requests` 1, `care_response_policy` 1, `garage_mutations` 1, `media_assets` 1, `profiles` 1, `user_roles` 1, `vehicle_history` 2, `vehicles` 1; `auth.users` 1, `storage.buckets` 1, `storage.objects` 3, `schema_migrations` 8) |
| Every live table, function (17), policy (15), trigger (9), index (61), constraint (89, by count) and sequence appears in the export | all match |
| Sequence values, bucket ids, object names, user ids | match (`audit_events_id_seq` last_value 3) |
| Restore test | **not performed** (UNVERIFIED) |

### 11.2 Pre-checks (VERIFIED, 20:40 ACDT)

| Check | Result |
| --- | --- |
| Blob SHAs re-read from git | all 10 match, bytes equal: nine at `18240dc137a66660ef9251101df906159ffae9a4` (`de4b31ad`, `55d44862`, `67734980`, `1e8a70c8`, `0d4bb716`, `37bd21c7`, `b8476976`, `9da56890`, `52f11c3e`) and `20261101133000_revoke_public_sequence_grants.sql` blob `fcdfe66f90d54d8130d07c8ce3cd3b2afcaa5097` at `39a2f89a4fe04cb5c02c863742ccbe075158827c` |
| P1 | database `postgres`, role `postgres`, PostgreSQL 17.6, pg17 true |
| P2 | the 8 baseline names; versions `20260928230146` to `20261001023756` |
| P3, P4 | 0 rows (none of the nine installed, no created object present) |
| P5 | 9 of 9 prerequisites exist |
| P6, P7 | 0 tables without RLS; one bucket `private-media`, `public = false` |
| P8 | `postgres` default ACL for public sequences granted `anon` and `authenticated` SELECT, UPDATE, USAGE; **`supabase_admin` also has default ACLs on public sequences granting `anon` and `authenticated` the same** |
| P8b | one sequence, `audit_events_id_seq`, owner `postgres`, ACL included `anon` and `authenticated` |
| `20261101130000` (photos) | skipped as instructed |

### 11.3 Apply (each file applied through the connector `apply_migration`, one call per file, exact file bytes, each file carries its own `begin; … commit;`)

`apply_migration` assigns versions at call time, so hosted versions differ from repository filenames (as for the baseline). All ten returned `{"success":true}` and are recorded in `supabase_migrations.schema_migrations` (re-read with `list_migrations`). Times are ACDT (version timestamps are UTC, +10:30).

| # | Name | Repo file | Hosted version (UTC) | Applied (ACDT) | Bytes sent | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `care_connected_journey` | `20261003064126_…` | `20261101101109` | 20:41:09 | 28842 | success |
| 2 | `technician_inbox` | `20261004090000_…` | `20261101101123` | 20:41:23 | 11644 | success |
| 3 | `technician_quotes` | `20261004124000_…` | `20261101101132` | 20:41:32 | 10565 | success |
| 4 | `technician_work_start` | `20261004133000_…` | `20261101101140` | 20:41:40 | 4223 | success |
| 5 | `technician_completion` | `20261004140000_…` | `20261101101148` | 20:41:48 | 7984 | success |
| 6 | `customer_completion_review` | `20261004150000_…` | `20261101101156` | 20:41:56 | 6943 | success |
| 7 | `completion_review_security_fix` | `20261020183000_…` | `20261101101204` | 20:42:04 | 5903 | success |
| 8 | `completion_review_replay_authority` | `20261020183001_…` | `20261101101212` | 20:42:12 | 6355 | success |
| 9 | `completion_review_final_lock_authority` | `20261101024732_…` | `20261101101220` | 20:42:20 | 6365 | success |
| 10 | `revoke_public_sequence_grants` | `20261101133000_…` | `20261101101228` | 20:42:28 | 2570 | success |

### 11.4 Post-checks (VERIFIED, about 20:43 ACDT)

| Check | Result |
| --- | --- |
| A1n | 9 of 9 PASS, one row per name, hosted versions as in 11.3 |
| A1n-order | 0 rows (applied in manifest order, after the baseline) |
| A1, A2, A3 (version-based) | **Expected FAIL on versions only**: hosted versions are generated (section 3.1 caveat). Totals: 18 rows = 8 baseline + 10 installed; max version `20261101101228` |
| A4 (by name) | the 8 baseline statement md5s are identical to the pre-install P2 output |
| B1 to B5 | B1 8 of 8 PASS (RLS enabled, not forced); B2 0 rows; B3 0 rows; B4 19 of 19 present or enabled; B5 true |
| C1 to C4 | C1 10 of 10 PASS (SECURITY INVOKER, empty `search_path`, body matches); C2 final-lock order true; C3 one overload each; C4 10 of 10 PASS (`service_role` only; no `anon`, `authenticated` or PUBLIC execute) |
| D1, D2 | 0 rows; D3 `service_role` privileges on 8 new tables; D6, D7 0 rows |
| D4 (`care_journey_events_id_seq`) | `anon_any` false, `authenticated_any` false, `service_role` USAGE and SELECT true |
| E1 | 0 rows; E2 `private-media`, public false; E3 policy `private_media_read_own`; E4 0; E5 all eight new tables 0 rows |
| Sequence grants (public) | P8b: `audit_events_id_seq` and `care_journey_events_id_seq`, owner `postgres`, ACL `postgres` and `service_role` only (the `anon` and `authenticated` grants seen before are gone) |
| P8 after | `postgres` default ACL for public sequences: `postgres`, `service_role` only. **`supabase_admin` default ACLs for public sequences still grant `anon` and `authenticated`**; the migration cannot change them (finding, below) |
| Table, function and sequence grants to `anon`, `authenticated`, PUBLIC (public schema) | none for `anon` or PUBLIC; `authenticated` has SELECT only on `care_request_events`, `care_requests`, `profiles`, `user_roles`, `vehicle_history`, `vehicles` and EXECUTE only on `care_get_offers`, `care_get_request`, `care_list_requests`, `care_retry_request`, `care_submit_request`, `garage_mutate_vehicle`; no sequence grants |
| Row counts | all 20 pre-existing tables unchanged against the backup counts; only `schema_migrations` changed (8 to 18); the 8 new tables hold 0 rows |
| Q6 (`20261101130000`) | `ABSENT` |
| RLS | all 24 public tables RLS enabled, none forced |

Advisors (`get_advisors`, about 20:43 ACDT):
- Security: INFO `rls_enabled_no_policy` x17 (the 9 seen earlier plus `care_experts`, `care_journey_commands`, `care_journey_events`, `care_journeys`, `care_reviewed_quotes`, `care_technician_accounts`, `care_technician_commands`, `care_technician_invitations`; by design, access is `service_role` only); WARN `authenticated_security_definer_function_executable` x6 (the same six baseline functions, unchanged); WARN `auth_leaked_password_protection` disabled (unchanged). No new WARN or ERROR from the install.
- Performance: WARN `auth_rls_initplan` x13 (baseline policies on `profiles`, `user_roles`, `vehicles`, `vehicle_history`, `media_assets`, `care_requests`); INFO `unindexed_foreign_keys` x10, INFO `unused_index` x16, INFO `auth_db_connections_absolute` x1.

### 11.5 Findings and surprises

1. **`pg_dump` was impossible from the executor box** (only HTTP and HTTPS egress); the logical export has no restore test and no storage object bytes. Take a platform backup or a `pg_dump` from a networked machine if a restorable copy is required.
2. **`supabase_admin` default ACLs** on public sequences still grant `anon` and `authenticated` SELECT, UPDATE and USAGE. Sequences created by `supabase_admin` in `public` in future would be exposed again. No such sequence exists now (both are owned by `postgres`). Needs an explicit decision (a separate `alter default privileges for role supabase_admin`, which `postgres` may not be allowed to run).
3. **Hosted versions are generated** (`20261101101109` to `20261101101228`), not the repository filenames, so A1, A2 and A3 fail by design; A1n and A4 by name are the valid checks.
4. Not verified: the QA record for `39a2f89`, an application-level test against the installed schema, edge or rate-limit behaviour, and any restore of the logical export.

## 12. Update 2 Nov 2026: changed install set, new pre-checks (docs only, nothing applied)

Written 2 Nov 2026 at about 01:15 ACDT (Australia/Adelaide, UTC+10:30). Everything below was read-only; no migration was applied, nothing was created and no grants were changed.

### 12.1 The install set has changed

- The set to install is now **`integration/week1-candidate` @ `60a48dab27b72cdfd987fa5e2293aa26adc78919`**: 26 migration files, last `20261101160000_care_service_coverage_enforcement.sql` (VERIFIED by `git ls-tree` on 2 Nov 2026).
- Compared with staging (18 migration rows: 8 baseline plus the ten from section 11), the 26 files add **8 not yet installed**: `20261101062300_technician_availability`, `20261101062400_my_jobs_journey_status`, `20261101063000_technician_availability_enforcement_delta`, `20261101120000_care_journey_command_lock_order`, `20261101130000_request_photo_flag_and_upload_quota`, `20261101140000_revoke_supabase_admin_sequence_default_acl`, `20261101150000_request_photo_marker_legacy_state_and_cleanup`, `20261101160000_care_service_coverage_enforcement`. The ten files already installed have the same git blob at `60a48da` as at the pins in section 11 (VERIFIED).
- `20261101130000` (photos) was skipped in section 11; it is part of this set, so that skip no longer applies. Re-confirm the intended order and the Q6 check before use.
- **Status: QA is PENDING** on the 26-file set at `60a48da` and on the ops scripts at `cd1e3ae4a515d7f2f3cab4e9c28c392b281c19d4`. Nothing here is approved for installing. Installing needs **Marcel's direct approval** and a **verified backup** taken first (section 11.1 describes the logical export route and its limits; it is not a restore-tested copy). Re-run P1 to P8b and re-verify every blob SHA at the then-current pin immediately before any apply.
- Note: `fix/supabase-admin-sequence-default-acl` head was `6fe754b1f9e170cbd98dedbde3517a3f4f1baa88` on 2 Nov 2026 (a runbook-only change on top of `cd1e3ae`: `docs/SUPABASE_ADMIN_SEQUENCE_DEFAULT_ACL.md` and one acceptance test, no change to the scripts or the migration). The pin of record stays `cd1e3ae`.

### 12.2 New pre-checks

All are read-only SELECTs. Results below are from staging on 2 Nov 2026 shortly before this was written (VERIFIED).

**P9: `btree_gist` (needed by `20261101063000`, GiST exclusion constraints on uuid and smallint)** BLOCKING if both parts fail.

```sql
select
  (select jsonb_agg(to_jsonb(a)) from (select name, default_version, installed_version
     from pg_available_extensions where name = 'btree_gist') a) as available,
  (select jsonb_agg(to_jsonb(e)) from (select e.extname, n.nspname as schema, e.extversion
     from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'btree_gist') e) as installed,
  has_database_privilege('postgres', current_database(), 'CREATE') as postgres_create_on_db,
  has_schema_privilege('postgres', 'extensions', 'CREATE') as postgres_create_on_extensions_schema,
  (select rolsuper from pg_roles where rolname = 'postgres') as postgres_is_superuser;
```

Expected: either `installed` is non-empty, or `available` is non-empty and the CREATE privilege is true. Staging result:
- available: `btree_gist`, default version `1.7`, `installed_version` null.
- installed: none. Installed extensions are `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`.
- `has_database_privilege('postgres', 'postgres', 'CREATE')` true; `has_schema_privilege('postgres', 'extensions', 'CREATE')` true and for `public` true.
- `postgres`: `rolsuper` false, `rolcreatedb` true, `rolcreaterole` true, `rolbypassrls` true, `rolreplication` true, `rolinherit` true. Database owner is `postgres`.
- Memberships of `postgres` (not exhaustive of privileges): `anon`, `authenticated`, `authenticator`, `service_role`, `pg_monitor`, `pg_read_all_data`, `pg_signal_backend`, `pg_create_subscription` (all with admin option) and `supabase_privileged_role` (no admin option). It is not a member of `supabase_admin`.
- Supabase documentation: the `postgres` role is intentionally not a superuser, and extension creation is gated by the `supautils` extension. `btree_gist` is on `supautils.privileged_extensions`, so `postgres` may create it (the supabase/postgres repository, `supautils.conf.j2`; the Supabase docs on roles and superuser access, and the extensions guide). Supabase creates such extensions as `supabase_admin` even when `postgres` runs `create extension`.
- Result: **PASS expected** but the actual `create extension` is UNVERIFIED until the migration runs. The migration creates it `with schema extensions` when that schema exists (it does), so its objects do not land in `public` owned by `supabase_admin` (VERIFIED by reading the file at `60a48da`; Supabase's guidance for avoiding `supabase_admin` default ACLs on `public` objects is the same).
- If the migration fails here, stop. The fix is a person with the right access running `create extension if not exists btree_gist with schema extensions;` (the Dashboard Database > Extensions page does this); it is not an ad-hoc fix to make during the install.

**P10: storage schema USAGE** (the migrations reference `storage.*`, for example `20261101150000`, and `foundation` creates the bucket and policies)

```sql
select has_schema_privilege('postgres', 'storage', 'USAGE') as postgres_storage_usage,
       has_schema_privilege('postgres', 'storage', 'CREATE') as postgres_storage_create,
       (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'storage') as storage_owner,
       (select nspacl::text from pg_namespace where nspname = 'storage') as storage_acl;
```

Expected: `postgres_storage_usage` true. Staging: usage **true**, create **false**, owner `supabase_admin`, ACL `{supabase_admin=UC/supabase_admin,postgres=U*/supabase_admin,anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin,supabase_storage_admin=U*C*/supabase_admin,dashboard_user=UC/supabase_admin}`. All objects in the install set that exist in `public` are owned by `postgres` (26 relations and sequences, 27 functions at that time). **PASS**. Use `postgres` as the migration owner for every check, since that is the role that applied all of the section 11 migrations.

**P11 (NON-BLOCKING): `supabase_admin` sequence default-ACL ops step**

This is the open finding of section 11.5 (item 2). It does **not** block installing the migration set: the sequences that exist are owned by `postgres` and are already revoked (D4, P8b). It is an exposure for sequences that `supabase_admin` might create in `public` in future (for example by an extension installed into `public`).

- Scripts: `scripts/ops/sequence-default-acl-gate.sql` (read-only) and `scripts/ops/supabase-admin-sequence-default-acl.sql` on branch `fix/supabase-admin-sequence-default-acl` @ `cd1e3ae4a515d7f2f3cab4e9c28c392b281c19d4`. QA PENDING.
- The ops script must run **as `supabase_admin`** (or a member of it). A hosted customer cannot act as `supabase_admin`, so it may have to go through Supabase support; Supabase's knowledge base also states these defaults cannot be changed by customers. If that stays impossible, accept the risk in writing and keep extensions out of `public` (create them `with schema extensions`).
- Order: apply the migrations (including `20261101133000` and `20261101140000`) first, then the ops script.
- Read-only gate. Run the full script with `psql -X -v ON_ERROR_STOP=1 -f scripts/ops/sequence-default-acl-gate.sql`: a final `GO` row means go; any finding raises `SKYCAR-SEQ-ACL: NO-GO`. Because the gate fails by raising, the connector cannot show its row set. Its findings SELECT (the text between the `findings:begin` and `findings:end` markers) was run as a plain read-only SELECT:

Staging result today, **NO-GO as expected** (6 findings, all `default_acl`, creator `supabase_admin`, scope `public`): grantees `anon` and `authenticated`, each with `SELECT`, `UPDATE` and `USAGE`. There is **no** `sequence` finding (no public sequence grants anon, authenticated or PUBLIC anything) and **no** global (all-schemas) default ACL. The full set of sequence default ACLs on staging: `supabase_admin` in `public`, `graphql_public`, `graphql` (grants to `anon`, `authenticated`, `service_role`) and `extensions`, `realtime`; `postgres` in `public` (`service_role` only) and `storage`; `supabase_auth_admin` in `auth`.

After the ops script and the migration, the gate must print `GO`. Until then the gate result NO-GO is the known state and is **non-blocking** for the install.

## 13. Restore test of the section 11.1 logical export (2 Nov 2026, docs only; no data in this note)

Executed 2 Nov 2026 between about 01:17 and 01:23 ACDT (Australia/Adelaide, UTC+10:30) on the executor box. The export was restored into a throwaway local PostgreSQL 17.6 cluster (temporary directory, port 54329, bound to 127.0.0.1 only, trust auth, `fsync` off), from a fresh `initdb`. Staging was only read (SELECT) for comparison; nothing was written to it. The cluster and every file derived from the data were deleted afterwards (see 13.4).

### 13.1 What was restored, and how

Order used: roles, schemas, stubs, enum types; 20 `create table` statements from `schema.sql`; row data from `data/*.json` through `jsonb_populate_recordset` (before constraints, so every foreign key was validated while being added); the 89 constraints from `schema.sql` (primary key, unique, check, then foreign key); the 61 indexes from `schema.sql` (constraint-backed ones skipped); `functions.sql` as is (17 functions); the 9 triggers from `schema.sql`; RLS flags; the 15 policies, rebuilt from `catalog_policies.json` (`schema.sql` holds them only as comments); sequence values; owners; table, column, function, sequence and schema ACLs from the catalog JSON; default ACLs last. The scripts are on the box only (`/workspace/bin/restore_test/`); they are not in git.

### 13.2 Results (VERIFIED, a single clean pass: the restore script returned exit 0 with an empty error log)

| Check | Result |
| --- | --- |
| Row counts equal the manifest | all 20 tables match; 32 rows in total |
| Object counts equal the manifest | 16 tables, 17 functions, 15 policies, 9 triggers, 61 indexes, 89 constraints, 2 sequences: all equal |
| Names and definitions against the catalog JSON | constraint, index, trigger (including enabled state) and policy definition text identical; function definition text, owner, `security definer` and ACL identical for all 17 |
| Columns | name, type, not null, default, identity and generated expression identical for all 20 tables |
| RLS | enabled and forced flags and owners identical (19 tables with RLS enabled; `supabase_migrations.schema_migrations` has none, as in the export) |
| ACLs | table, column (9), sequence, schema (`auth`, `extensions`, `storage`, `public`) and all 24 default ACL entries identical to the export |
| Sequences | `audit_events_id_seq` last_value 3 and `refresh_tokens_id_seq` 6, owner, start and increment identical |
| Data fidelity | restored rows equal the exported JSON in all 20 tables, including generated columns |
| Foreign keys | 21 of 21 validated when added after the load |
| Against staging today (read-only) | per-table row hash (md5 over `to_jsonb` rows, session time zone UTC) equal for all 19 original tables except `supabase_migrations.schema_migrations`, which has 18 rows live against 8 in the export, as expected after section 11 |
| Behavioural smoke test | as `authenticated` with a stub `auth.uid()`: the owner sees their vehicle, another user sees 0 rows, `audit_events` is not readable, and `anon` cannot read `vehicles`; and, as in the pre-install state, `authenticated` could still call `nextval` on `audit_events_id_seq` (the exposure that migration `20261101133000` removed on staging) |

### 13.3 Stubs, failures and gaps

Failures along the way were all in the restore tooling, not in the export, and were fixed before the final pass: (1) multi-line constraint definitions were split by my first parser; (2) the default ACL entries for three schemas needed those schemas to exist; (3) the owner entry and grant-option flags of default ACLs, and column ACLs, were not applied by my first script; (4) my verification had compared with the wrong session time zone and search path. None is a defect of the backup, though items (3) show `schema.sql` alone is not enough: grants and policies are comments there and have to be rebuilt from the catalog JSON.

Stubs needed (they are not in the export): roles (names and attributes only, `NOLOGIN`, no passwords, no memberships, no per-role settings); empty schemas `graphql`, `graphql_public`, `realtime` (only so their default ACLs could be restored); `auth.uid()` and `auth.role()` (JWT-claim based), `storage.foldername()`; no-op trigger functions `storage.protect_delete`, `protect_bucket_control_columns`, `update_updated_at_column`, `enforce_bucket_name_length`, `enforce_bucket_lifecycle_service_role` (the real bodies are not in the export); enum `storage.buckettype` (labels guessed: `STANDARD`, `ANALYTICS`, `VECTOR`); standalone sequence `auth.refresh_tokens_id_seq` (its table is not exported). The local cluster has `pgcrypto` and `uuid-ossp`; `pg_stat_statements` and `supabase_vault` were not restored.

Gaps that remain (UNVERIFIED or not covered): storage object **bytes** (3 objects; only the metadata rows are in the export); **role passwords**, memberships and per-role settings; every `auth` table other than `auth.users`, the real `auth` and `storage` functions, `realtime`, `vault` and other platform schemas; `pg_stat_statements` and `supabase_vault` contents. The export has `auth.users` password hashes, so the backup directory stays mode 700 with mode 600 files.

**Verdict:** a usable restore of the application data and `public` schema: rebuilding the application tables, functions, policies, grants and data into a fresh Postgres 17 works and matches the live staging data. It is not a full-project restore: it cannot restore storage file contents or the platform roles and schemas, so it is a recovery aid for the `public` data and definitions, and a platform backup (or `pg_dump` from a networked machine) remains needed for a complete restore.

### 13.4 Clean-up

The cluster was stopped and its directory deleted. All generated SQL containing row data, the scratch queries and one stray connector output file that held a copy of `auth.users` were deleted. A search of `/workspace`, `/tmp` and the home directory for the user's id, e-mail address and password-hash prefix found no copy outside the backup directory. The backup directory is mode 700 with all files mode 600, and its 31 files still match the manifest sha256 values.

## 14. Mapping of hosted history to repo files, the week1-candidate delta and a history-repair plan (2 Nov 2026, docs only; nothing was run or changed)

Written 2 Nov 2026 at about 01:40 ACDT (Australia/Adelaide, UTC+10:30). The only access to staging was read-only SELECTs (`schema_migrations` rows, with an md5 of each `statements` value). Everything in 14.3 is a plan that was **not run**.

### 14.1 Exact mapping: hosted `supabase_migrations.schema_migrations` (staging, 18 rows) to repo files

Hosted rows were read about 01:38 ACDT. Repo side: `integration/week1-candidate` @ `60a48dab27b72cdfd987fa5e2293aa26adc78919`, read with `git ls-tree` and `git rev-parse` (VERIFIED). For the ten files installed in section 11, the blob at the source commit (`18240dc137a66660ef9251101df906159ffae9a4` for the nine, `39a2f89a4fe04cb5c02c863742ccbe075158827c` for `20261101133000`) **is identical** to the blob at `60a48da` (all ten). The md5 column compares `md5(array_to_string(statements, E'\n'))` on the hosted row (each row holds one statement element) with `md5` of the repo file bytes.

| # | Hosted version | Name | Repo filename (at `60a48da`) | Blob SHA (full, at `60a48da`) | Source commit | Blob at source = blob at `60a48da` | md5 hosted `statements` vs md5 repo file |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `20260928230146` | `foundation` | `202609200001_foundation.sql` | `a1d1cf28b896474e3e3a972e5857993126acc921` | `23468048a391cc6c16ae87afcd34abadf82f9522 (commit that first added the file; no pin of record)` | n/a (no pin) | equal only without the file's final newline (hosted 5261 chars, file 5262 bytes; `2f6520431e51f1a2632c93b7068e8f67`) |
| 2 | `20260930225800` | `care_requests` | `202609200002_care_requests.sql` | `5fa6a6f399ade7fc8dbecd2b4e779f4a877fb40f` | `4120275b64f34da325aa6a0763c0d1202895cca2 (commit that first added the file; no pin of record)` | n/a (no pin) | equal (`e1c92eea238c72850f3435ad6a989ab8`) |
| 3 | `20260930225820` | `care_my_jobs` | `202609200003_care_my_jobs.sql` | `d74c23175405f2846e61046c19ed901050f58b19` | `4120275b64f34da325aa6a0763c0d1202895cca2 (commit that first added the file; no pin of record)` | n/a (no pin) | equal (`4c72d480b8f6d2644917c1ed3095027d`) |
| 4 | `20260930225838` | `garage_mutations` | `202609200100_garage_mutations.sql` | `07f2f8b701ed86f5ba5d2b5bac7ea279c935e0fa` | `4120275b64f34da325aa6a0763c0d1202895cca2 (commit that first added the file; no pin of record)` | n/a (no pin) | equal (`e3b0b1da00f1a3872951eda4d2c4e16a`) |
| 5 | `20260930225859` | `garage_vehicle_photos` | `202609200300_garage_vehicle_photos.sql` | `16eab45434c926b8ec783f49db6d0474ad8ba1c4` | `4120275b64f34da325aa6a0763c0d1202895cca2 (commit that first added the file; no pin of record)` | n/a (no pin) | equal (`e6119d2fd52bb1eec1ebe1f379a568f4`) |
| 6 | `20260930225917` | `care_offers` | `202609220100_care_offers.sql` | `82f09e2b26b8cb351c814d32f2306697fc4d8711` | `822261797da4617fce896be680e7c97a0655c0d4 (commit that first added the file; no pin of record)` | n/a (no pin) | equal (`0a9eeed77849b3d243b1a81f64a93a26`) |
| 7 | `20260930230048` | `staging_access_hardening` | `202609300001_staging_access_hardening.sql` | `0d21a113d00f8b7491a44ab226ca670094243b61` | `512f7043096208e2b45f0b0045e01cfc578ddb4f (commit that first added the file; no pin of record)` | n/a (no pin) | equal (`e215de4491956900c7e2d1d95a15c277`) |
| 8 | `20261001023756` | `care_guest_requests` | `20261001030000_care_guest_requests.sql` | `173148e6cc448b9e10e52006e21bc68609105e7f` | `072c30b76c83df84e416ce3b861c909fa9b3cdf5 (commit that first added the file; no pin of record)` | n/a (no pin) | equal (`5ecdd8b60d8adbec523ef531de26c0d0`) |
| 9 | `20261101101109` | `care_connected_journey` | `20261003064126_care_connected_journey.sql` | `de4b31ad085e9d5f0c410b825cf37565208ff0f5` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`bcb7e78db9e9978871c50e64d67482cd`) |
| 10 | `20261101101123` | `technician_inbox` | `20261004090000_technician_inbox.sql` | `55d448620035d8eaa1f0040f3121fb53a0e03e7e` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`1cc59c190332937285764d4f63eae76c`) |
| 11 | `20261101101132` | `technician_quotes` | `20261004124000_technician_quotes.sql` | `6773498011dd697f1f327b5684b0dca8f29b061e` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`e457b1427af7a1e96036ae12fe764f80`) |
| 12 | `20261101101140` | `technician_work_start` | `20261004133000_technician_work_start.sql` | `1e8a70c873b3ddd0ba63fba9652b890a8efd9488` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`df0e454414cb04b0090e2d4c4e0152d5`) |
| 13 | `20261101101148` | `technician_completion` | `20261004140000_technician_completion.sql` | `0d4bb71697ea671963647372e33a040a52ef4dbe` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`c6c097b3ba1a2425e78bd715f24503cf`) |
| 14 | `20261101101156` | `customer_completion_review` | `20261004150000_customer_completion_review.sql` | `37bd21c7e08d7d20c44fa1ca342d598f6c309c7a` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`5a24b36f6154ae1d2813079fe6b8b694`) |
| 15 | `20261101101204` | `completion_review_security_fix` | `20261020183000_completion_review_security_fix.sql` | `b8476976ffecc30721e3b358ddf95229871f9875` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`14bd8f30507e476a382db4fddbd6b209`) |
| 16 | `20261101101212` | `completion_review_replay_authority` | `20261020183001_completion_review_replay_authority.sql` | `9da568903d8d95718e382897670fbbf34bfe53e6` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`e14c549c99e05a1de1037fe4fe5ecb04`) |
| 17 | `20261101101220` | `completion_review_final_lock_authority` | `20261101024732_completion_review_final_lock_authority.sql` | `52f11c3e9edca2cb6f57c66d1377bee1cd59618e` | `18240dc137a66660ef9251101df906159ffae9a4` | identical | equal (`b913b530c5c1850a667783e71a56941d`) |
| 18 | `20261101101228` | `revoke_public_sequence_grants` | `20261101133000_revoke_public_sequence_grants.sql` | `fcdfe66f90d54d8130d07c8ce3cd3b2afcaa5097` | `39a2f89a4fe04cb5c02c863742ccbe075158827c` | identical | equal (`99dd5e9b2bdcadd8032084aa0c95b523`) |

Reading it:
- **Rows 9 to 18** (installed in section 11): hosted statements are **byte-identical** to the repo files at `60a48da` (md5 equal for all ten).
- **Rows 2 to 8** (baseline): byte-identical to the files at `60a48da`.
- **Row 1** (`foundation`): the hosted text equals the repo file only without its final newline (5261 against 5262). Same content otherwise; the baseline was not applied by this install and its original source commit is not on record, so the "source commit" shown for rows 1 to 8 is only the commit that first added the file (UNVERIFIED as the applied source).
- Hosted versions are generated at apply time (`20260928…` to `20261001…` for the baseline, `20261101101109` to `20261101101228` for rows 9 to 18). **No hosted version equals a repo filename version.** Names do match, one to one (18 of 18), which is why A1n and name-based checks are the valid ones.
- The repo baseline files use 12-digit versions (`202609200001`, `202609200002`, `202609200003`, `202609200100`, `202609200300`, `202609220100`, `202609300001`); the other repo files use 14 digits.
- Extra columns on the hosted table: `created_by`, `idempotency_key` (unique), `rollback`.

### 14.2 Delta: in `60a48da` but not on staging (8 files, in repo version order)

All eight blobs read at `60a48da` (VERIFIED). Apply order is the repo version order, which is also the order in the integration branch. `20261101133000` is already on staging, so on the repo-version timeline it sits between 3 and 4 below; `20261101140000` follows `20261101133000` (the sequence-grant work), which staging already has; dependencies between the other seven were not analysed beyond the file headers (UNVERIFIED).

| Order | Full filename | Blob SHA (full) | Bytes | First added in |
| --- | --- | --- | --- | --- |
| 1 | `20261101062300_technician_availability.sql` | `9c2f5846017ecfeefe0f1064d2cff8d8e7fddf16` | 17404 | `4d778d1` (PR #76) |
| 2 | `20261101062400_my_jobs_journey_status.sql` | `92866f98bbf91e9fe2f198dea24fe7ef0918eb87` | 3172 | `4d778d1` (PR #76) |
| 3 | `20261101063000_technician_availability_enforcement_delta.sql` | `bd68031b5657a8901947aa65c770dbc9cc5a251b` | 21959 | `be732e6` |
| 4 | `20261101120000_care_journey_command_lock_order.sql` | `65a7bb48dc58efbc5c060c4a1e09c3a26edef070` | 26472 | `469eef7` |
| 5 | `20261101130000_request_photo_flag_and_upload_quota.sql` | `848ca31e0d610e990ebf98ab5e1542150a29e2b1` | 11235 | `054e5d8` |
| 6 | `20261101140000_revoke_supabase_admin_sequence_default_acl.sql` | `64348849ab8120f3cca860247c50ccbe55d233a5` | 4881 | `e52810c` (same blob at `cd1e3ae` and `60a48da`) |
| 7 | `20261101150000_request_photo_marker_legacy_state_and_cleanup.sql` | `a21d73d524a0a1ce6fbdd17ea8755d97100e3498` | 11951 | `c56bfe8` |
| 8 | `20261101160000_care_service_coverage_enforcement.sql` | `9a48a2123fd7ed568a03091a1a4d842c375e7bba` | 14869 | `7f8071f` |

Status: **`60a48da` is QA BLOCKED and will be superseded by a later candidate commit.** Nothing in this list is approved for installing; re-derive the list, the blobs and the order from the superseding commit, and re-run pre-checks P1 to P11, before use. `20261101063000` needs `btree_gist` (P9); `20261101130000` was skipped in section 11 and is in this set.

### 14.2.1 Superseding pins (8 Nov 2026, repository evidence only; nothing applied)

The table in 14.2 is the historical delta at `60a48da`. Row 8's blob `9a48a212` (`7f8071f`, 14869 bytes) has **no** `care_service_coverage_compat`. Do not install that blob.

Validated `integration/week1-candidate` `ff2c94105e76a0412f47fa5a73b832a01f8df9ba`, read with `git rev-parse` on that commit (not from a hosted database):

| File | Blob to use | Replaces |
| --- | --- | --- |
| `20261101150000_request_photo_marker_legacy_state_and_cleanup.sql` | `4d6c540c2961c1199575b55f955e70077d5db34f` | section 14.2 row 7 `a21d73d524a0a1ce6fbdd17ea8755d97100e3498` |
| `20261101160000_care_service_coverage_enforcement.sql` | `837ba184cc5905e85961057d6ca028eed09156c9` | section 14.2 row 8 `9a48a212`. This blob is `0eb3e74` and includes the compat switch. |

Apply `837ba184` immediately before `20261108120000_care_legacy_create_sunset.sql` (blob `de25cefcad5fcc837e84efe1e9a74422aa18adfc` at `6ccf1e16b9711d2dca6417de521ef1d45fff9d23` on `cursor/legacy-create-sunset-78bd`). Neither `4d6c540c` nor `837ba184` is edited by that sunset. This note does not record a hosted apply and does not approve an install.

### 14.3 Plan (NOT RUN): make hosted history match the repo filenames before production

**Current policy until this is approved and done:** keep applying by name with `apply_migration` on staging (hosted versions stay generated). Names are the join key.

**Why bother:** the Supabase CLI compares local files with the remote table by version. Today `supabase migration list` and `supabase db push` would show the 18 hosted versions as "remote only" and all 26 repo files as "local only", and `db push` stops with a request to repair the history. Production should not start with that mismatch. The cleanest production path is to apply the files there with the CLI (`supabase db push`) from the repo so versions equal the filenames from the start, and only repair staging if staging history must also match; this plan covers repairing staging.

**Prerequisites (all required before running anything):**
1. **Marcel's direct approval**, in his own words, for this specific change to staging (and a separate one for production).
2. **A verified backup** taken immediately before: re-run the logical export (section 11.1, at minimum `supabase_migrations.schema_migrations` with every column, including `created_by`, `idempotency_key`, `rollback`) and, preferably, a Supabase platform backup. The restore test (section 13) shows the export is usable for `public` data and history rows.
3. All wanted delta files already applied, so the repo-version order matches the history order (otherwise `db push` later reports "found local migration files to be inserted before the last migration on remote database" and needs `--include-all`).
4. The QA-approved final candidate commit identified (not `60a48da`), and its filenames and blobs re-verified against the hosted names.
5. Someone with direct Postgres access as `postgres` (the owner of the table) or the CLI linked to the project. The box and the Supabase connector cannot do this: the connector `execute_sql` is used read-only here, and `apply_migration` would only add a new row with another generated version.
6. Read-only baseline captured (14.3.3 queries 1 and 2), with the output saved with mode 600.

**14.3.1 Option A: `supabase migration repair`**

Mechanics (from the CLI reference): `--status reverted <version>` **deletes** the row for that version; `--status applied <version>` **inserts** a row from the local file (version, name, statements; newer CLIs upsert on conflict). It changes only the history table and runs no SQL. Needs `supabase link` or `--db-url`, and the database password.

Shape of the run, not to be executed now: for each of the 18 hosted versions run `supabase migration repair <hosted_version> --status reverted`, then for each of the 18 repo versions (those files that exist on staging) run `supabase migration repair <repo_version> --status applied`, then `supabase migration list` to confirm LOCAL equals REMOTE for those rows.

Risks:
- **Data loss in the history rows between the two steps:** `reverted` deletes the row, including `created_by`, `idempotency_key`, `rollback` and the exact `statements` text. The re-inserted row is built from the local file and the CLI splits the file into several statements, so the stored `statements` will **not** be byte-identical to the current rows, and `created_by` and `idempotency_key` become NULL. A saved copy of the current rows is essential.
- **Not atomic:** each repair is its own call. A failure half way leaves some versions missing and others duplicated; if a hosted and a repo version are both present, the CLI sees both.
- **Wrong direction is silent:** `applied` for a file that was never run records a lie, and `reverted` for a file that ran makes a later `db push` try to run it again (most files here are not idempotent: `create table`, `create function` without `or replace`), failing or double-applying. Only mark `applied` for a file whose effect is verified on staging (verification SQL below).
- Uses the database password and a direct connection; the project must not be paused, and the pooler or direct connection must be reachable from the machine that runs it.
- The 12-digit baseline versions (`202609200001` and the like) are accepted by the CLI as numeric prefixes, but that is UNVERIFIED against the platform's own tooling (dashboard migration list).

**14.3.2 Option B: SQL `UPDATE` of `version` on `schema_migrations`**

Not to be executed now. Idea: rename each hosted version to its repo version, keyed on `name`, in one transaction, leaving `name`, `statements`, `created_by`, `idempotency_key` and `rollback` untouched, so the history rows stay byte-identical apart from `version`.

```sql
-- NOT RUN. Needs approval and a verified backup. Run as postgres, in one transaction.
begin;
lock table supabase_migrations.schema_migrations in share row exclusive mode;

with m(hosted_version, name, repo_version) as (values
  ('20260928230146', 'foundation', '202609200001'),
  ('20260930225800', 'care_requests', '202609200002'),
  ('20260930225820', 'care_my_jobs', '202609200003'),
  ('20260930225838', 'garage_mutations', '202609200100'),
  ('20260930225859', 'garage_vehicle_photos', '202609200300'),
  ('20260930225917', 'care_offers', '202609220100'),
  ('20260930230048', 'staging_access_hardening', '202609300001'),
  ('20261001023756', 'care_guest_requests', '20261001030000'),
  ('20261101101109', 'care_connected_journey', '20261003064126'),
  ('20261101101123', 'technician_inbox', '20261004090000'),
  ('20261101101132', 'technician_quotes', '20261004124000'),
  ('20261101101140', 'technician_work_start', '20261004133000'),
  ('20261101101148', 'technician_completion', '20261004140000'),
  ('20261101101156', 'customer_completion_review', '20261004150000'),
  ('20261101101204', 'completion_review_security_fix', '20261020183000'),
  ('20261101101212', 'completion_review_replay_authority', '20261020183001'),
  ('20261101101220', 'completion_review_final_lock_authority', '20261101024732'),
  ('20261101101228', 'revoke_public_sequence_grants', '20261101133000')
)
update supabase_migrations.schema_migrations s
   set version = m.repo_version
  from m
 where s.version = m.hosted_version and s.name = m.name;
-- expected: UPDATE 18

-- guard: abort unless exactly the expected history results
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 18 then raise exception 'row count changed'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version ~ '^2026(0928|0930|1001)[0-9]{6}$' and name in ('foundation','care_requests','care_my_jobs','garage_mutations','garage_vehicle_photos','care_offers','staging_access_hardening','care_guest_requests')) then raise exception 'baseline version not renamed'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version like '2026110110%') then raise exception 'hosted generated version still present'; end if;
end $$;
commit;   -- use rollback; instead to abandon
```

Risks:
- It is a hand edit of a platform-owned table. Supabase may add triggers, columns or checks (the table already has `created_by`, `idempotency_key`, `rollback`); a platform or dashboard feature that keys on those values (for example the `idempotency_key`) could behave unexpectedly. UNVERIFIED how the platform reads these rows.
- `version` is the primary key: a collision aborts the statement (safe), but a typo in the mapping silently records the wrong version for a name; the guard above and the verification queries are the protection.
- `apply_migration` calls made afterwards still generate a timestamp version, so new rows will again differ from the filenames; this must be done when the set is complete, immediately before the CLI becomes the only way to apply.
- If a repo file is later edited and renamed, the history will not follow; it only records what was applied.
- Preferably run by a person in the SQL editor or `psql`; the connector's `execute_sql` is read-only here and is not a route for it.

**14.3.3 Read-only verification SQL (safe to run at any time, SELECT only)**

```sql
-- 1. Before: the hosted rows and their identifiers (save the output, mode 600).
select version, name, md5(array_to_string(statements, E'\n')) as statements_md5,
       created_by, idempotency_key is not null as has_idem
from supabase_migrations.schema_migrations order by version;

-- 2. Before: which names are on staging (expect 18; the 8 baseline names and the 10 from section 11).
select name from supabase_migrations.schema_migrations order by name;

-- 3. Before/after: the schema itself must not change in a history-only repair. Compare this fingerprint before and after.
select md5(string_agg(x, '|' order by x)) as schema_fingerprint, count(*) as objects from (
  select 'f:'||p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid)) as x
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all select 't:'||c.relname||c.relrowsecurity::text from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
  union all select 'p:'||schemaname||'.'||tablename||'.'||policyname||md5(coalesce(qual,'')||coalesce(with_check,'')) from pg_policies where schemaname='public'
  union all select 'i:'||indexname||md5(indexdef) from pg_indexes where schemaname='public'
) q;

-- 4. After: every hosted version must equal the repo version for its name (copy the repo mapping into the VALUES list).
with m(name, repo_version) as (values
  ('foundation','202609200001'), ('care_requests','202609200002'), ('care_my_jobs','202609200003'),
  ('garage_mutations','202609200100'), ('garage_vehicle_photos','202609200300'), ('care_offers','202609220100'),
  ('staging_access_hardening','202609300001'), ('care_guest_requests','20261001030000'),
  ('care_connected_journey','20261003064126'), ('technician_inbox','20261004090000'), ('technician_quotes','20261004124000'),
  ('technician_work_start','20261004133000'), ('technician_completion','20261004140000'),
  ('customer_completion_review','20261004150000'), ('completion_review_security_fix','20261020183000'),
  ('completion_review_replay_authority','20261020183001'), ('completion_review_final_lock_authority','20261101024732'),
  ('revoke_public_sequence_grants','20261101133000'))
select m.name, m.repo_version, s.version as hosted_version,
       case when s.version = m.repo_version then 'PASS' else 'FAIL' end as status
from m full join supabase_migrations.schema_migrations s on s.name = m.name
order by coalesce(m.repo_version, s.version);
-- expected: 18 rows, all PASS, no row with a NULL side.

-- 5. After: no generated versions left, and history order equals repo order.
select count(*) filter (where version like '2026110110%') as generated_left,
       count(*) as total,
       string_agg(name, ',' order by version) as names_in_version_order
from supabase_migrations.schema_migrations;
-- expected: generated_left 0; total 18 (more once the delta is applied); names_in_version_order equals the
-- repo filename order of query 4 (the 18 names as listed there, ordered by repo_version).

-- 6. After, Option B only: statements and other columns untouched (md5 equal to query 1's saved output, row for row, by name).
```

On the CLI side, after a repair `supabase migration list` must show every local file with a matching remote version and nothing remote-only. For Option A the `statements` md5 will legitimately differ from the saved one (statements are re-split), so compare names and versions only.

**14.3.4 Rollback**

- Before anything: the saved copy of query 1 (all columns, not only these) is the rollback source. Keep it in the mode-700 backup directory.
- **Option B:** run the same `UPDATE` with the mapping reversed (`set version = hosted_version where version = repo_version and name = …`) inside one transaction; or, before commit, issue `rollback;`. The `UPDATE` is atomic, so there is no half state. Then re-run queries 1 and 3 and compare with the saved output.
- **Option A:** run `supabase migration repair <repo_version> --status reverted` for each, then re-insert the saved original rows (version, name, statements, created_by, idempotency_key, rollback) by a transactional `INSERT` from the saved JSON, since `--status applied` cannot recreate the original hosted versions or the original columns.
- A history repair never touches schema objects, so there is nothing to undo in the schema; if query 3's fingerprint differs after a repair, stop and investigate before doing anything else.
- If the history table itself is damaged, restore its rows from the logical export (section 13 shows the export restores `schema_migrations`).
