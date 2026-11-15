# Isolated staging and phone-test runbook

Status: preparation only — no environment has been created, migrated or deployed.
Tracks: #1, #8 and the first bounded user-test milestone.
Candidate: `fix/phone-test-delivery`, integrating corrected PR #27 and PR #29 plus the PR #30 authentication preparation. Pin its reviewed full SHA in `STAGING_APPROVED_REVISION` before dispatch.

## Goal and supported scope

Prepare one isolated URL for the reviewed Garage → service request → My Jobs →
request-status journey. Acceptance uses two synthetic customer accounts and
synthetic private vehicle photos on a real phone-sized browser.

The candidate does **not** support technician capacity, customer offer selection,
booking confirmation, payment, live tracking, provider fulfilment or production
operation. An entered preferred window is not confirmed availability.

## Hard isolation requirements

Before any hosted mutation, the repository/release administrator must verify:

1. A new Supabase staging project is separate from production, the existing public
   site and the separate private pilot. It contains no copied customer data,
   credentials, object paths or infrastructure identifiers.
2. A non-public staging runtime/URL is separate from GitHub Pages and public DNS.
   Merging documentation or application work must not publish it automatically.
3. GitHub environment `skycar-staging` has required reviewer approval and no
   deployment branch wildcard broader than the reviewed staging route.
4. Environment variable `STAGING_ISOLATION_MARKER` equals
   `skycar-v2-isolated-staging`.
5. These GitHub environment secrets are configured without writing their values
   to issues, logs, artifacts or repository files:
   - `STAGING_SUPABASE_URL`
   - `STAGING_SUPABASE_PUBLISHABLE_KEY`
   - `STAGING_SUPABASE_SECRET_KEY`
6. Runtime flags are exactly:
   `SKYCAR_ENV=staging`, `FEATURE_GARAGE=true`,
   `FEATURE_CARE=true`, `FEATURE_BENEFITS=false`,
   `FEATURE_SELL=false`.
7. `SKYCAR_APP_ORIGIN` and environment variable `STAGING_APP_ORIGIN` must both be the exact HTTPS application origin, without a trailing slash. Set `STAGING_APPROVED_REVISION` to the reviewed full 40-character SHA. Forwarded headers are never an origin allowlist.

The publishable key may be sent to the browser. The secret key is server-only and
must never use a `NEXT_PUBLIC_` name. Rotate it after any suspected disclosure.

## Prepared non-deploying workflow

`.github/workflows/staging-readiness.yml` is manual-dispatch only, read-only
against GitHub and bound to the protected environment variable `STAGING_APPROVED_REVISION`. It:

- requires the protected environment and an explicit isolation confirmation;
- checks only the presence and shape of staging configuration;
- checks out the immutable reviewed revision;
- runs locked install, lint, TypeScript, unit tests and production build;
- rejects committed environment files and the server secret in browser output;
- never applies a migration, starts a deployment, contacts the staged API,
  creates an account or activates a provider.

A green readiness run is not hosted acceptance or release approval.

GitHub accepts manual dispatch only after the workflow file exists on the default
branch. The current default-branch/Pages coupling means this draft must **not** be
merged merely to make the button appear: first establish the reviewed
non-publishing path required by #8, then rebind the workflow to the independently
accepted application revision.

## Migration preparation

Only after independent acceptance and explicit environment authorization, apply
the complete inventory once to a brand-new empty staging project, in filename
order:

1. `202609200001_foundation.sql`
2. `202609200002_care_requests.sql`
3. `202609200003_care_my_jobs.sql`
4. `202609200100_garage_mutations.sql`
5. `202609200300_garage_vehicle_photos.sql`
6. `202609220100_care_offers.sql`

Before application:

- capture the empty-project migration list and a backup/restore point;
- review every migration and confirm the target project reference is staging;
- verify the Data API exposure/grants expected by these migrations;
- confirm `private-media` is private and storage policies remain owner-scoped;
- do not run the local PostgreSQL fixture scripts against Supabase.

After application, record the remote migration list and run Supabase security and
performance advisors. An unavailable advisor is not a pass.

## Synthetic account and private-photo acceptance

Create exactly two disposable email/password customer accounts through the
approved staging Auth path. Use generated addresses, unique passwords stored only
in the approved secret channel, and no real customer identity.

For account A:

1. Sign in and add a synthetic vehicle.
2. Upload a generated JPEG/PNG/WebP containing no person, plate, VIN, address or
   real vehicle metadata.
3. Submit one repair or cleaning request with a unique idempotency key.
4. Confirm it appears in My Jobs and opens the request-status timeline.
5. Repeat the same write and confirm no duplicate vehicle/request/photo event.

For account B:

1. Sign in on a separate private browser session.
2. Confirm A's vehicle, job, status and photo metadata/object are unavailable.
3. Attempt A's known IDs through the API and confirm the same non-disclosing
   response used for missing objects.
4. Switch A → B in one browser and confirm all A labels and stale responses are
   removed.

Then sign out and confirm protected views/data fail closed. Delete both accounts
and all synthetic rows/objects after evidence capture.

## Prepared authentication entry

The integration candidate carries forward PR #30’s preparation of a customer-facing email/password sign-in and local-device
sign-out path for pre-created synthetic staging accounts. It uses server-written
Supabase cookies, refreshes sessions at the Next.js proxy boundary, rejects
cross-origin writes and unsafe return paths, and returns generic provider failures.
It does not add self-registration, password recovery, OAuth, magic links or an
admin/service-key path, so no Auth callback is required for this bounded flow.

Local executable evidence covers request validation, same-origin enforcement,
credential-error redaction, return-path safety and local sign-out. This source is
still draft, unmerged, undeployed and awaiting revision-specific review. Hosted
acceptance must separately prove cookie refresh/expiry, A → B replacement and
sign-out against the authorised isolated Supabase project. Do not work around a
missing hosted environment by sharing raw tokens, injecting cookies on Marcel's
phone or exposing an admin/service key.

## Logging and evidence

For each tested request, retain only:

- timestamp and exact application revision;
- route template, HTTP status, stable error code and request ID;
- pass/fail step and redacted screenshot where useful;
- browser/OS model for the physical-phone pass.

Do not record cookies, tokens, emails, user/vehicle/request IDs, raw object paths,
photo contents, query strings or provider/database error text in public GitHub.

Browser mobile emulation is preliminary evidence. The milestone is not physically
verified until Marcel signs in on the isolated URL and completes the supported
journey on his phone.

## Rollback and stop conditions

Stop immediately on a wrong project reference, non-empty unexpected schema,
public bucket, cross-account visibility, secret in browser/log output, automatic
Pages/public-DNS change or any real customer record.

Rollback order:

1. disable access to the staging runtime without changing public DNS;
2. revoke/rotate staging keys and invalidate disposable sessions;
3. preserve redacted logs and the exact revision;
4. restore the pre-migration staging backup or delete only the authorised isolated
   staging project;
5. record the failure in #8 using HANDOFF_RULES.md.

Never repair a failed staging exercise by mutating production, the private pilot
or the existing public site.

## Exact remaining resources/permissions

Preparation can complete in GitHub. A running phone-test instance still requires:

- one authorised, isolated Supabase staging project;
- one protected non-public staging runtime/URL capable of Next.js server routes;
- repository/environment administrator access to configure protected secrets and
  reviewer gates;
- revision-specific review of the integrated customer Auth entry;
- formal release disposition for PR #27 before applying migrations or deploying.

No payment/provider account, public DNS change or production credential is needed
for this first milestone.

## Phone instructions once provisioning is complete

1. Open the staging HTTPS URL followed by `/auth/sign-in` in Safari or Chrome.
2. Enter the disposable account email and password delivered privately. No token or cookie injection is needed.
3. In Garage, add a synthetic vehicle and photo, then choose a service and submit a request.
4. Open My Jobs, open the request, and confirm its status. A preferred window is not a booking confirmation.
5. Sign out, reload the protected page, then sign in as the second disposable account and confirm the first account’s data is absent.
6. Record browser/OS, step, visible error and request ID if anything fails. Do not share credentials or photos in GitHub.

Local built-server tests now verify configured HTTPS origins, secure HTTP-only cookies, account-cookie replacement, expired-session refresh, sign-out cookie deletion and private no-store responses using synthetic Auth. These tests do not establish hosted account isolation or a physical-phone pass.
