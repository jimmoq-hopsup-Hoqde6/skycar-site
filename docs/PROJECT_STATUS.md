# Skycar V2 — Project Status

Last updated: 2026-09-20

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
- PR #19: customer Care request status/timeline UI with overdue/no-match handling, stacked on #16.
- PR #20: owner-scoped My Jobs/Care request list API with pagination, vehicle filtering and overdue summaries, stacked on #16.

## Immediate priority
Complete combined Garage/Care migration and permission verification before integration acceptance, while preserving the service-first acquisition / Garage-retention architecture. Individual PR checks are green, but combined schema compatibility and hosted/session/device gates remain open.

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
Status: IMPLEMENTED IN DRAFT PR #17 — NOT MERGED
- [x] Ownership-scoped add/edit/archive vehicle contract and UI in PR #17
- [x] Vehicle detail and history in PR #17
- [x] Audited/idempotent Garage mutation path in PR #17
- [ ] Hosted Supabase/PostgREST/session verification
- [ ] Signed-in device QA
- [ ] Customer-owned vehicle photo using the actual car with a clean/plain-background derived display image; original media remains private
- [ ] Condition summary
- [ ] Membership summary
- [ ] Recommended actions
- [ ] My Jobs integration for pending, upcoming and past Repair & Cleaning jobs

### Phase 2 — Repair & Cleaning
Status: IN PROGRESS — PR #16 REVIEW-READY; PR #19/#20 DRAFT/STACKED
- [x] Durable request acknowledgement and authoritative request status/events in PR #16
- [x] Customer next-update deadline, overdue/no-match recovery and owner retry in PR #16
- [x] Customer request detail/status timeline UI in PR #19
- [x] Owner-scoped My Jobs request list backend in PR #20
- [ ] Combined Garage/Care schema and permission acceptance
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

## Latest verified checkpoint — 2026-09-20 23:58 ACST
- `main` contains the merged foundation plus accepted D-007 service-acquisition/Garage-retention documentation; no current feature PR is merged.
- PR #16 head `915acbb` is mergeable and exact-head application CI + PostgreSQL acceptance are green; acceptance/dependency review remains required before merge.
- PR #17 head `bca07a5` is mergeable but draft; application CI + PostgreSQL verification are green. Hosted Supabase/PostgREST/session and signed-in device evidence remain missing.
- PR #19 head `99998f6` is a mergeable draft stacked on #16. Exact-head Skycar CI and Care database acceptance are green; hosted/session/device acceptance remains open.
- PR #20 head `4902335` is a mergeable draft stacked on #16. Application CI passed install/lint/typecheck/29 unit/API tests/build/env guard/built-route smoke; PostgreSQL 17 acceptance passed all five integration groups with no skipped checks.
- Delivery review found that individual green suites do not yet prove the combined Garage/Care database boundary because the current Garage and Care database test bootstraps exercise their migrations separately. Combined migration/permission verification is therefore the immediate integration blocker, not a demonstrated runtime failure.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
