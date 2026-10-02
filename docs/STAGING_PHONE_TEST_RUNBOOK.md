# Isolated staging and phone-test runbook

Status: existing resources provisioned; application not deployed and hosted/device acceptance NOT RUN.
Evidence snapshot: 2026-09-23. Reuse Supabase `skycar-v2-staging` and protected Vercel
`skycar-staging`; do not create duplicates. GitHub `skycar-staging` now exists with
only `fix/phone-test-delivery` allowed, owner review required, self-review prevented
and administrator bypass disabled. Current settings therefore still require an
eligible distinct authorised reviewer and staging-only execution disposition.
Any staging-only alternative requires explicit Product Owner confirmation and
administrator verification before use; none is approved by this runbook. The
approved origin and protected values are not claimed configured.
See [administrator checkpoint](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5787012631).
The reviewed application lineage is PR #31 `321723d` → PR #34 `bdb0807` → PR #35
`821125df9556225b4d34ff1aec4072c2d789b4cf`; [final bounded technical PASS](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/35#issuecomment-5790560620)
is not formal GitHub approval or hosted release authorisation.
Tracks: #1, #8 and the first bounded user-test milestone.
Candidate: exact PR #35 head `821125df9556225b4d34ff1aec4072c2d789b4cf`.
PR #33 is documentation only and is not a deployment checkout. Pin the approved
full application SHA in `STAGING_APPROVED_REVISION` before dispatch.

## Goal and supported scope

Prepare one isolated URL for the reviewed Garage → service request → My Jobs →
request-status journey. Acceptance uses two synthetic customer accounts and
synthetic private vehicle photos on a real phone-sized browser.

The candidate does **not** support technician capacity, customer offer selection,
booking confirmation, payment, live tracking, provider fulfilment or production
operation. An entered preferred window is not confirmed availability.

## Hard isolation requirements

Before any hosted mutation, the repository/release administrator must verify:

1. The existing Supabase staging project is verified separate from production, the existing public
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

A green readiness run is not hosted acceptance or release approval. The workflow
dispatch ref only selects the workflow definition; it is not the application
revision. The checked-out SHA must equal the independently approved exact
`STAGING_APPROVED_REVISION` or the run must fail.

GitHub accepts manual dispatch only after the workflow file exists on the default
branch. The current default-branch/Pages coupling means this draft must **not** be
merged merely to make the button appear: first establish the reviewed
non-publishing path required by #8, then rebind the workflow to the independently
accepted application revision.

## Migration preparation

The configuration contract, ordered migration hashes, synthetic A/B seed plan,
protected-host probe, redacted evidence rules and backup/rollback commands were
[verified against exact `821125d` and writer-released](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5791282351).
Do not rerun this unchanged preparation. Migration application, hosted backup and
restore verification remain NOT RUN.

Only after independent acceptance and explicit environment authorization, apply
the complete inventory once to the existing authorised isolated empty staging
project, in filename order:

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
2. Through the documented authenticated private-photo API (not a customer upload UI), upload a generated JPEG/PNG/WebP containing no person, plate, VIN, address or
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

The reviewed PR #31 → PR #34 → PR #35 application lineage carries a customer-facing email/password sign-in and local-device
sign-out path for pre-created synthetic staging accounts. It uses server-written
Supabase cookies, refreshes sessions at the Next.js proxy boundary, rejects
cross-origin writes and unsafe return paths, and returns generic provider failures.
PR #34 additionally makes an unauthenticated request-status page offer sign-in with
the exact request return path; the return performs GET revalidation only and no
automatic write. It does not add self-registration, password recovery, OAuth, magic links or an
admin/service-key path, so no Auth callback is required for this bounded flow.

Local executable evidence covers request validation, same-origin enforcement,
credential-error redaction, return-path safety and local sign-out. This source remains
draft, unmerged and undeployed. Bounded technical review passed; formal release approval remains outstanding. Hosted
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
2. under the recorded recovery authority, revoke/rotate staging keys and invalidate disposable sessions;
3. preserve redacted logs and the exact revision;
4. use the independently verified pre-migration restore procedure under explicit
   authority; do not assume a backup exists or delete the existing project;
5. record the failure in #8 using HANDOFF_RULES.md.

Never repair a failed staging exercise by mutating production, the private pilot
or the existing public site.

## Exact remaining resources/permissions

Preparation can complete in GitHub. A running phone-test instance still requires:

- execute the approved packet against the existing isolated Supabase staging project;
- configure the existing protected Vercel project with a verified HTTPS origin and Next.js server routes;
- repository/environment administrator access to configure protected secrets and
  reviewer gates;
- a recorded staging-only approval-control decision and exact-revision/origin disposition;
- release authorisation for exact PR #35 head `821125df9556225b4d34ff1aec4072c2d789b4cf`
  before applying migrations or deploying.

No payment/provider account, public DNS change or production credential is needed
for this first milestone.

## Phone instructions once provisioning is complete

1. Open the staging HTTPS URL followed by `/auth/sign-in` in Safari or Chrome.
2. Enter the disposable account email and password delivered privately. No token or cookie injection is needed.
3. In Garage, add a synthetic vehicle, then choose a service and submit a request. Customer photo-upload UI is not available in this candidate; the executor validates private photos through the API separately.
4. Open My Jobs, open the request, and confirm its status. A preferred window is not a booking confirmation.
5. Sign out, reload the protected page, then sign in as the second disposable account and confirm the first account’s data is absent.
6. Record browser/OS, step, visible error and request ID if anything fails. Do not share credentials or photos in GitHub.

Local built-server tests now verify configured HTTPS origins, secure HTTP-only cookies, account-cookie replacement, expired-session refresh, sign-out cookie deletion and private no-store responses using synthetic Auth. These tests do not establish hosted account isolation or a physical-phone pass.


## Hosted acceptance matrix — execution pending

Run only after the administrator records the exact revision, protected origin,
secret destinations, migration scope, synthetic coverage/response-policy settings,
execution path and recovery authority. Never invent commercial deadlines or enable
real providers for these tests. All rows below are **NOT RUN** for hosted/device
acceptance; local fixtures and CI are separate evidence.

| Case | Steps | Expected result | Status |
| --- | --- | --- | --- |
| Sign-in and persistence | A signs in, creates a synthetic vehicle, reloads Garage | Secure session; one persisted owned vehicle | NOT RUN |
| Request journey | A submits an in-scope service request; opens My Jobs then its status | Durable receipt and same request/status; no booking promise | NOT RUN |
| Ownership denial | B requests A vehicle/request/status IDs through each documented API | Same non-disclosing response as missing objects; no A data | NOT RUN |
| Account switch | Switch A to B during delayed A reads and after focus/page return | A labels, drafts and late responses cannot appear for B | NOT RUN |
| Refresh/sign-out | Exercise session expiry/refresh, sign out, reload protected pages | Refresh stays private; signed-out reads/writes fail closed | NOT RUN |
| Retry/no duplicate | Submit then replay identical key/body, including uncertain response recovery | One request; identical replay resolves original result | NOT RUN |
| Conflict retry | Reuse key with different body | Safe conflict; no second mutation | NOT RUN |
| Private photo API | A uploads synthetic supported image; B and signed-out session request its metadata/object | Owner-only access; private bucket; no public object access | NOT RUN |
| Request/status recovery | Reopen receipt after reload; delay old response and exercise approved synthetic state transition | Server-authoritative status; stale response cannot replace current state | NOT RUN |
| Physical phone | Marcel completes supported journey and signs out on actual Safari/Chrome phone | Usable layout and correct saved state; record actual device evidence | NOT RUN |

For each row capture exact application revision, browser/OS, timestamp, route
template, HTTP status, stable error code/request ID where available, expected versus
actual result and redacted screenshot or test assertion. Record PASS/FAIL only after
execution. Keep account/vehicle/request IDs, cookies, passwords, object paths and
photo contents out of public evidence. Stop on any cross-account disclosure.

Rollback remains proposed and NOT EXECUTED. Empty schema inspection is not a
backup or a restore test. Preserve the six-migration inventory and perform no hosted
writes until the existing administrator handoff is complete.
