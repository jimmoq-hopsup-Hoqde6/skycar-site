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
- PR #22: authenticated Garage-linked My Jobs UI with Garage vehicle filtering, archived-history labels, pagination, request-detail links, stale/error recovery and committed desktop/mobile evidence, stacked on #21.

## Immediate priority
Record the reviewed dependency/integration sequence for #16/#20/#17/#19/#21 before any merge, and route draft PR #22 through dependency/acceptance review. The combined Garage/Care database-boundary evidence is accepted as resolved, but individual feature acceptance, hosted Supabase/session/private-storage verification, signed-in device QA and remaining release gates are still open. If no review finding blocks #22, the next dependency-independent Care frontend slice is cross-reload uncertain-write recovery for request submission/retry.

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
Status: IN PROGRESS — PR #16 REVIEW-READY; PR #19/#20/#21/#22 DRAFT
- [x] Durable request acknowledgement and authoritative request status/events in PR #16
- [x] Customer next-update deadline, overdue/no-match recovery and owner retry in PR #16
- [x] Customer request detail/status timeline UI in PR #19
- [x] Synthetic desktop/mobile visual acceptance evidence for PR #19
- [x] Owner-scoped My Jobs request list backend in PR #20
- [x] Combined Garage/Care schema and permission verification in PR #21
- [x] Technical Lead accepted the combined Garage/Care database-boundary evidence in PR #21
- [x] Garage-linked account-wide My Jobs list UI in PR #22
- [ ] Project Manager dependency/integration route and individual feature acceptance before merge
- [ ] PR #22 dependency/acceptance review
- [ ] Cross-reload uncertain-write recovery for Care request submission/retry
- [ ] Service-first public entry for scratch/dent and detail/clean (#18)
- [ ] Guided private photo upload / media processing
- [ ] Coverage/capacity handling
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

## Latest verified checkpoint — 2026-09-21 04:01 ACST
- `main` still contains no merged current feature PR. This status document records verified but unmerged branch evidence.
- PR #21 remains at `61975a3`; Technical Lead review accepted the combined database-boundary evidence as resolving the prior separate-bootstrap gap. This is evidence acceptance only and does not approve merging the full stacked feature set or release.
- Draft PR #22 head `5c5f741` adds authenticated `/garage/jobs`, a Garage My Jobs entry, owner-scoped Care request summaries, active/archived vehicle filtering, opaque cursor pagination, request-detail links, fail-closed response validation, access/session redaction and stale-data retry. It changes 25 files (+727/-2) and has no schema, environment, provider or commercial-policy change.
- PR #22 local exact-tree verification passed lint, TypeScript, 42 unit/API tests, production build, built Care-route fail-closed smoke, synthetic Chromium My Jobs acceptance and `git diff --check`. Four fixture-only desktop/mobile screenshots are committed. Exact-head GitHub Skycar CI and Care PostgreSQL acceptance both completed successfully.
- PR #22 is open, draft and mergeable. No review finding is recorded on #22 yet. Individual feature/dependency acceptance and the Project Manager integration route remain open.
- Remaining blockers/gates are hosted Supabase/PostgREST/session/private-storage verification, signed-in physical-device QA, PR #19 cross-reload uncertain-write recovery, notification delivery worker wiring and remaining #1/#8 operational/release controls.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
