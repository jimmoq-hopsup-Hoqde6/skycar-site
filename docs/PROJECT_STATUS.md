# Skycar V2 — Project Status

Last updated: 2026-09-21

## Current product direction
Skycar V2 uses services as the acquisition engine and the Garage as the retention engine. Public entry is service-led around immediate cosmetic Care needs; after acquisition, the free Garage becomes the persistent customer home and must remain useful even when the customer is not booking a technician.

Core product areas:
- Garage / vehicle profile
- Membership and partner benefits
- Repair and cleaning marketplace
- Condition / damage assessment
- Technician workspace
- Fleet workspace
- Admin / operations
- Payments, booking and notifications

## Current repository state
The repository contains the legacy small public website plus the merged Skycar V2 modular-monolith application scaffold. The V2 foundation is not production-ready and has not been deployed. Executable Garage and Repair & Cleaning work now exists in open pull requests, but none of those feature PRs has been merged to `main` or accepted for production use.

Active implementation evidence:
- PR #16: durable Care request receipt, authoritative status/events, overdue/no-match recovery and restricted worker contract.
- PR #17: ownership-scoped Garage vehicle list/create/detail/edit/archive/history with audited mutation controls and responsive UI.
- PR #19: customer Care request status/timeline UI with overdue/no-match handling and committed synthetic desktop/mobile evidence, stacked on #16.
- PR #20: owner-scoped My Jobs/Care request list API with pagination, vehicle filtering and overdue summaries, stacked on #16.
- PR #21: combined Garage/Care integration-verification branch applying every public migration together and testing the shared vehicle/permission boundary; Technical Lead accepted this combined boundary evidence only, not the full feature/release scope.
- PR #22: authenticated Garage-linked My Jobs UI, reload-safe Care reopening and authenticated service-first Care entry. Technical Lead accepted the bounded My Jobs and reload-recovery slices. The first service-entry privacy/error findings were corrected at `a0458c8`, but re-review found a remaining same-account focus/in-flight revalidation defect that can discard drafts/pending idempotency state; service-entry acceptance remains blocked until corrected.
- PR #23: server-owned Repair/Cleaning service catalogue plus a strict coverage contract that fails closed with `COVERAGE_UNAVAILABLE` until an authoritative coverage resolver is approved and connected. Technical Lead found resolver exceptions could violate the published 503 contract; corrective head `a0f2aed` now normalizes thrown/invalid resolver outcomes to redacted retryable 503 responses and has green exact-head application/Care checks. Technical Lead re-review remains required.

## Immediate priority
Correct PR #22 so same-account focus/page-return revalidation preserves the current draft and never clears/supersedes an in-flight or uncertain submission, while still clearing state on access loss/account change. Then obtain Technical Lead re-review of PR #22 and PR #23 exact head `a0f2aed`, and record the reviewed dependency/integration sequence for #16/#20/#17/#19/#21/#22/#23 before any merge. Inline vehicle creation remains blocked until the #22 service-entry slice is accepted. Hosted Supabase/session/private-storage verification, signed-in device QA and remaining #1/#8 release gates are still open.

### Phase 0 — Foundation
Status: IN PROGRESS
- [x] Architecture contract and modular source structure
- [x] Next.js/React/TypeScript + Supabase/PostgreSQL baseline
- [x] Exact direct dependency versions and package-lock.json
- [x] Demo/staging/production configuration contract
- [x] Verified-session server auth boundary and server-granted role model
- [x] Versioned /api/v1 baseline
- [x] Initial Garage vehicle/history/media schema and RLS policies
- [x] Private storage policy baseline
- [x] Care quote/assignment/fulfilment state separation
- [x] CI install/lint/typecheck/unit/build checks passing on PR #13
- [ ] Execute migration against isolated hosted Supabase test project
- [ ] Prove hosted two-user negative RLS/storage authorization tests
- [ ] Complete application logging/audit/error middleware baseline
- [ ] Verify staging environment and rollback/restore setup

### Phase 1 — Garage
Status: IMPLEMENTED IN DRAFT PRS — NOT MERGED
- [x] Ownership-scoped add/edit/archive vehicle contract and UI in PR #17
- [x] Vehicle detail and history in PR #17
- [x] Audited/idempotent Garage mutation path in PR #17
- [x] Combined Garage/Care shared vehicle and permission verification in draft PR #21
- [x] Garage-linked My Jobs UI for saved Care requests in draft PR #22
- [ ] Hosted Supabase/PostgREST/session verification
- [ ] Signed-in device QA
- [ ] Customer-owned vehicle photo using the actual car with a clean/plain-background derived display image; original media remains private
- [ ] Condition summary
- [ ] Membership summary
- [ ] Recommended actions

### Phase 2 — Repair & Cleaning
Status: IN PROGRESS — PR #16 REVIEW-READY; PR #19/#20/#21/#22/#23 DRAFT
- [x] Durable request acknowledgement and authoritative request status/events in PR #16
- [x] Customer next-update deadline, overdue/no-match recovery and owner retry in PR #16
- [x] Customer request detail/status timeline UI in PR #19
- [x] Synthetic desktop/mobile visual acceptance evidence for PR #19
- [x] Owner-scoped My Jobs request list backend in PR #20
- [x] Combined Garage/Care schema and permission verification in PR #21
- [x] Technical Lead accepted the combined Garage/Care database-boundary evidence in PR #21
- [x] Garage-linked account-wide My Jobs list UI in PR #22
- [x] Technical Lead accepted the bounded synthetic My Jobs presentation slice in PR #22
- [x] Cross-reload uncertain-write recovery for Care reopening in PR #22
- [x] Technical Lead accepted the bounded cross-reload recovery slice in PR #22
- [x] First service-first scratch/dent and detail/clean entry implementation in PR #22
- [x] Initial service-entry account-change privacy and malformed-response corrections implemented at PR #22 head `a0458c8`
- [ ] Correct PR #22 same-account focus/page-return draft preservation and in-flight idempotency handling
- [x] Server-owned Repair/Cleaning catalogue and fail-closed coverage API implemented in PR #23
- [x] PR #23 resolver-failure contract corrected at `a0f2aed` so thrown/invalid resolver outcomes return the documented retryable 503 contract
- [ ] Project Manager dependency/integration route and individual feature acceptance before merge
- [ ] Technical Lead re-review/acceptance of PR #22 service-entry correction
- [ ] Technical Lead re-review/acceptance of PR #23 corrected catalogue/coverage contract
- [ ] Inline new-vehicle creation in the service journey using the audited Garage API
- [ ] Guided private photo upload / media processing
- [ ] Approved authoritative coverage resolver and operational ownership
- [ ] Technician offers containing price and actual appointment options
- [ ] Race-safe booking acceptance
- [ ] Payment lifecycle kept separate from quote/assignment/fulfilment state
- [ ] Proactive notification delivery adapter and retry visibility
- [ ] Technician travel / ETA controls for active appointments only
- [ ] Before/after completion evidence
- [ ] Review, guarantee and dispute flow
- [ ] Same-technician rebooking and recurring cleaning after core booking flow

Approved requirements: Issue #14 defines the end-to-end booking, customer status, offer, payment/completion, rebooking and recurring-care contract. Approval is specification evidence only; it is not full implementation or release completion.

### Phase 3 — Technician
Status: NOT STARTED
- Technician onboarding
- Service area
- Skills/services
- Availability
- Job feed
- Accept/decline
- Job workflow
- Evidence upload
- Earnings

### Phase 4 — Fleet
Status: NOT STARTED
- Fleet organization
- Vehicle register
- Inspections
- Damage records
- Repair routing
- Cost visibility
- Status dashboard

### Phase 5 — Admin
Status: NOT STARTED
- User/technician management
- Booking oversight
- Pricing/configuration
- Disputes/guarantee cases
- Payments oversight
- Service coverage
- Fleet account management
- Audit log

## Release gate
No public production release until:
- Auth and permissions verified
- Payment state machine verified
- Booking state machine verified
- Customer/technician data separation verified
- Upload security verified
- Core error handling implemented
- Backup/recovery plan documented

## Latest verified checkpoint — 2026-09-21 09:59 ACST
- `main` had no merged feature changes since the 07:59 checkpoint before this status-only alignment.
- PR #22 remains at `a0458c8`; no new implementation commit landed in the interval. Technical Lead re-review resolved the earlier account-change draft leak and malformed-4xx retry lock but found a new blocker: ordinary same-account focus/page-return currently clears draft/selected-vehicle/pending submission state, and focus during an in-flight POST can discard the existing idempotency attempt and permit a second-key submission. Service-entry acceptance and inline vehicle creation remain blocked pending this correction.
- PR #23 advanced one corrective commit from `b57ee5f` to `a0f2aed` (`Normalize Care coverage resolver failures`), changing 2 files with +38/-20: `src/server/care/catalogue-http.ts` and `tests/unit/care-catalogue.test.mjs`. Generic resolver timeout/exception, explicit unavailable errors and malformed decisions now converge on the documented redacted retryable `503 COVERAGE_UNAVAILABLE`; unexpected failures outside the resolver boundary remain redacted non-retryable 500.
- PR #23 exact-head local evidence reports ESLint, TypeScript, 52 unit/API tests, production build, built Care catalogue/coverage smoke and `git diff --check` passed. Exact-head GitHub `application` run `35543637375` and `care-postgres` run `35543637372` both completed successfully. Technical Lead re-review of `a0f2aed` is still pending.
- Merge/integration remains blocked because the reviewed dependency route for #16/#20/#17/#19/#21/#22/#23 is not recorded; hosted Supabase/PostgREST/JWT/RLS/private-storage verification, signed-in device QA and remaining #1/#8 operational/release controls remain open. No authoritative coverage resolver/provider is approved or connected.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
