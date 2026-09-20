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
- PR #21: combined Garage/Care integration-verification branch applying every public migration together and testing the shared vehicle/permission boundary.

## Immediate priority
Route PR #21 through Technical Lead/Project Manager dependency and acceptance review, then use the verified shared Garage/Care boundary to implement the Garage-linked My Jobs list/timeline. The previously identified separate-bootstrap integration evidence gap is closed by green combined verification, but hosted Supabase/session/private-storage, signed-in device QA and remaining release gates are still open.

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
- [x] Combined Garage/Care shared vehicle and permission verification in draft PR #21
- [ ] Hosted Supabase/PostgREST/session verification
- [ ] Signed-in device QA
- [ ] Customer-owned vehicle photo using the actual car with a clean/plain-background derived display image; original media remains private
- [ ] Condition summary
- [ ] Membership summary
- [ ] Recommended actions
- [ ] My Jobs integration for pending, upcoming and past Repair & Cleaning jobs

### Phase 2 — Repair & Cleaning
Status: IN PROGRESS — PR #16 REVIEW-READY; PR #19/#20/#21 DRAFT
- [x] Durable request acknowledgement and authoritative request status/events in PR #16
- [x] Customer next-update deadline, overdue/no-match recovery and owner retry in PR #16
- [x] Customer request detail/status timeline UI in PR #19
- [x] Synthetic desktop/mobile visual acceptance evidence for PR #19
- [x] Owner-scoped My Jobs request list backend in PR #20
- [x] Combined Garage/Care schema and permission verification in PR #21
- [ ] Technical Lead/Project Manager dependency and integration acceptance review
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

## Latest verified checkpoint — 2026-09-21 02:00 ACST
- `main` still contains no merged current feature PR. The status document is updated to reflect verified but unmerged branch evidence.
- PR #21 head `61975a3` is mergeable and draft. All four exact-head checks passed: application CI, Care PostgreSQL, Garage PostgreSQL and combined Garage/Care PostgreSQL. The combined suite applied every public migration in filename order and passed 54 assertions covering shared vehicle identity, two-account isolation, archive/history behaviour, idempotent replay/conflict, direct-write denial, audit/outbox rollback and both lock orderings for archive versus Care intake/retry.
- PR #19 advanced to head `3d58562`. Five synthetic fixture-only desktop/mobile screenshots now cover overdue receipt/timeline, stale refresh, no-match recovery and access-expired redaction. Exact-head application CI and Care PostgreSQL acceptance both passed.
- PR #16 remains at `915acbb`, PR #17 at `bca07a5`, and PR #20 at `4902335`; their previously recorded exact-head checks remain green. No acceptance review has been recorded on PR #21.
- Remaining blockers/gates are Technical Lead/Project Manager dependency/acceptance review, hosted Supabase/PostgREST/session/private-storage verification, signed-in device QA, cross-reload uncertain-write recovery for the Care status UI, notification delivery worker wiring and the remaining #1/#8 operational/release controls.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
