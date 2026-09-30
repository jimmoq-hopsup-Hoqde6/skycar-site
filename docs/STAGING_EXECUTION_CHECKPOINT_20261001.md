# Staging execution checkpoint — 1 October 2026

The approved isolated Vercel staging project has a successful Preview deployment of application commit `1192d7436c5562bd1d121ae575c2839b7140438f`. All deployment domains require Vercel team authentication. The staging Supabase server key is a write-only Vercel Secret scoped to the `fix/phone-test-delivery` Preview branch. The exact branch alias is configured as the application origin.

Before migration, every application table, Auth users and storage objects had zero rows. The existing remote foundation migration statements matched `202609200001_foundation.sql` exactly; the baseline statements were captured before changes. This was an empty-data schema checkpoint, not a full infrastructure backup or restore drill.

Installed database migrations: foundation; care_requests; care_my_jobs; garage_mutations; garage_vehicle_photos; care_offers; staging_access_hardening. Storage bucket `private-media` remains private. The staging-only response policy is 30 minutes to acknowledgement and 120 minutes to escalation; this config is for synthetic tests and does not activate real provider fulfilment.

The hardening migration revokes inherited broad anon/customer table grants and client execution of the Auth trigger. The subsequent security advisor has no anonymous SECURITY DEFINER execution finding. Six authenticated SECURITY DEFINER functions remain deliberately callable and enforce ownership and role checks. Eight internal tables deliberately have RLS without client policies. Performance advisories remain to be reviewed before production-scale use.

Acceptance remains pending: disposable Auth account creation, hosted customer sign-in, vehicle creation, private photo upload, request submission, My Jobs/status, account isolation and actual phone verification. The landing and sign-in pages load, but this is not yet a completed customer-flow acceptance or a production release.
