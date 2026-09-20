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
- PR #22: authenticated Garage-linked My Jobs UI, reload-safe Care reopening and authenticated service-first Care entry. Technical Lead accepted the bounded My Jobs and reload-recovery slices; service-entry findings were corrected at exact head `a0458c8` with green exact-head checks, but Technical Lead re-review is still required before that slice is accepted.
- PR #23: server-owned Repair/Cleaning service catalogue plus a strict coverage contract that fails closed with `COVERAGE_UNAVAILABLE` until an authoritative coverage resolver is approved and connected. Exact-head application and Care database checks pass; review is still required.

## Immediate priority
Record the reviewed dependency/integration sequence for #16/#20/#17/#19/#21/#22/#23 before any merge. Re-review PR #22 head `a0458c8` for the service-entry privacy/error-handling corrections and review PR #23 head `b57ee5f` as the bounded catalogue/coverage contract. Inline vehicle creation remains queued until the returned #22 findings are accepted and the dependency route is documented. Hosted Supabase/session/private-storage verification, signed-in device QA and remaining #1/#8 release gates are still open.

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
- [x] Service-entry account-change privacy and malformed-response corrections implemented at PR #22 head `a0458c8`
- [x] Server-owned Repair/Cleaning catalogue and fail-closed coverage API implemented in PR #23
- [ ] Project Manager dependency/integration route and individual feature acceptance before merge
- [ ] Technical Lead re-review/acceptance of PR #22 service-entry corrections
- [ ] Technical/dependency review of PR #23 catalogue/coverage contract
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

## Latest verified checkpoint — 2026-09-21 07:59 ACST
- `main` still contains no merged current feature PR before this status-only alignment.
- Since the 06:01 checkpoint, PR #22 advanced one corrective commit from `2ac83e9` to `a0458c8`. The change spans 8 files: Care entry UI docs/evidence, `src/domain/care/submission-recovery.ts`, `src/features/care/request-form.tsx`, the Care-entry Chromium test and submission unit coverage.
- The PR #22 correction clears prior-account draft/service/window/vehicle/pending state during account revalidation, ignores stale in-flight results across account changes, treats unreadable 4xx as definitive/editable, and preserves exact-key/body recovery only for malformed 5xx/network uncertainty. Local lint, TypeScript, 48 unit/API tests, production build, Care smoke, targeted Chromium acceptance and `git diff --check` passed; exact-head Skycar CI run `35538212887` and Care database acceptance run `35538212889` passed. Technical Lead re-review remains pending.
- New draft PR #23 at `b57ee5f` adds 9 files (+388/-1) for the server-owned Repair/Cleaning catalogue and strict coverage contract: `GET /api/v1/care/services`, same-origin `POST /api/v1/care/coverage`, contract docs, domain/server code and tests. Coverage returns authoritative available/unavailable only when a resolver can decide and otherwise fails closed with retryable `503 COVERAGE_UNAVAILABLE`.
- PR #23 local verification passed ESLint, TypeScript, 50 unit/API tests, production build, built-route Care smoke and `git diff --check`; exact-head Skycar CI run `35541368809` and Care database acceptance run `35541368845` passed. No hosted coverage provider/resolver is connected or claimed.
- Merge/integration remains blocked because the reviewed dependency route for #16/#20/#17/#19/#21/#22/#23 is not recorded; PR #9 also remains stale/unsuperseded. Hosted Supabase/PostgREST/JWT/RLS/private-storage verification, signed-in device QA and remaining #1/#8 operational/release controls remain open.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
