# Skycar V2 — Project Status

Last updated: 2026-09-20

## Current product direction
Skycar V2 is a Garage-first automotive ownership platform. The product must remain useful even when a customer never books a technician.

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
The repository now contains the legacy small public website plus the merged Skycar V2 modular-monolith application scaffold. The V2 foundation is not production-ready and has not been deployed.

## Immediate priority
Build a stable application foundation before expanding features.

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
- Add vehicle
- Vehicle profile
- Vehicle history
- Condition summary
- Membership summary
- Recommended actions

### Phase 2 — Repair & Cleaning
Status: READY TO START IN PARALLEL
- Service selection
- Vehicle selection
- Guided photo upload
- Problem description
- Quote / estimate flow
- Availability selection
- Booking
- Payment
- Job status
- Before/after evidence
- Review and guarantee flow

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
- GitHub Actions run #6 passed dependency install from committed lockfile, lint, TypeScript checking, unit tests, Next.js build and environment-file guard.
- No production deployment or live billing/provider activation occurred.
- Issue #1 remains open for isolated database/RLS/storage verification and remaining operational foundation controls.
