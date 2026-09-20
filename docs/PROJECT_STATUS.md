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
The repository contains the legacy small public website plus the merged Skycar V2 modular-monolith application scaffold. The V2 foundation is not production-ready and has not been deployed. Garage and Repair & Cleaning feature work are cleared to start in parallel, but no executable feature implementation has yet landed on their feature branches.

## Immediate priority
Continue the remaining Foundation security/operational verification while delivering the first executable Garage and Repair & Cleaning slices in parallel. Backend contracts land before frontend integration.

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
- [ ] Execute migration against isolated Supabase test project
- [ ] Prove two-user negative RLS/storage authorization tests
- [ ] Complete application logging/audit/error middleware baseline
- [ ] Verify staging environment and rollback/restore setup

### Phase 1 — Garage
Status: READY TO START IN PARALLEL
- Account onboarding
- Add/edit/archive vehicle
- Vehicle profile
- Vehicle history
- Customer-owned vehicle photo using the actual car with a clean/plain-background derived display image; original media remains private
- Condition summary
- Membership summary
- Recommended actions
- My Jobs entry point for pending, upcoming and past Repair & Cleaning jobs

### Phase 2 — Repair & Cleaning
Status: READY TO START IN PARALLEL
- Service selection
- Vehicle selection
- Guided photo upload
- Problem description
- Quote / estimate flow
- Durable request acknowledgement and customer next-update deadline
- Customer status timeline / My Jobs contract
- Availability selection
- Technician offers containing price and actual appointment options
- Race-safe booking acceptance
- Payment lifecycle kept separate from quote/assignment/fulfilment state
- Job status and proactive notifications
- Technician travel / ETA controls for active appointments only
- Before/after completion evidence
- Review, guarantee and dispute flow
- Same-technician rebooking and recurring cleaning after core booking flow

Approved requirements: Issue #14 defines the end-to-end booking, customer status, offer, payment/completion, rebooking and recurring-care contract. Approval is specification evidence only; it is not implementation or test completion.

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

## Latest verified checkpoint — 2026-09-20
- PR #11 merged architecture contract.
- PR #13 merged executable foundation scaffold as commit 23468048a391cc6c16ae87afcd34abadf82f9522.
- GitHub Actions run #8 on main passed dependency install, lint, TypeScript checking, unit tests, Next.js build and environment-file guard.
- Issue #14 records approved end-to-end Repair & Cleaning requirements and sequencing; no feature implementation or tests are claimed by that issue.
- Issue #2 now records the approved actual-vehicle-photo/plain-background Garage requirement using the existing private vehicle media ownership model.
- Feature branches `feature/garage-foundation` and `feature/care-backend` had not advanced beyond the prior main application commit at the time of this status update.
- No production deployment, live billing/provider activation, DNS change or destructive database change occurred.
- Issue #1 remains open for isolated database/RLS/storage verification and remaining operational foundation controls.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
