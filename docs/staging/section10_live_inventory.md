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
