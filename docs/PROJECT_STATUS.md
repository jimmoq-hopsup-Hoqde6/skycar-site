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
- PR #22: authenticated Garage-linked My Jobs UI, reload-safe Care reopening and authenticated service-first Care entry. Technical Lead accepted the bounded My Jobs and reload-recovery slices. Exact head `cef948a` fixes the same-account focus/page-return draft-loss and duplicate-key issue, but re-review found a remaining pending-session privacy/stale-navigation blocker: pending/uncertain state can suppress identity revalidation, leaving prior-account data visible or allowing an old response to navigate a changed session. Service-entry acceptance remains blocked.
- PR #23: server-owned Repair/Cleaning service catalogue plus a strict coverage contract that fails closed with `COVERAGE_UNAVAILABLE` until an authoritative coverage resolver is approved and connected. Corrective head `a0f2aed` is technically accepted for the bounded catalogue/coverage contract. No resolver/provider, real coverage area, price or appointment is approved or connected.
- PR #24: first private Garage vehicle-photo intake contract and backend implementation at `f284c5f`, with bounded JPEG/PNG/WebP intake, server-derived private metadata and green application/Garage/Care/combined checks. Technical Lead acceptance is withheld because an authenticated security-definer RPC can bypass HTTP photo validation and upload-before-metadata failure/race cleanup is not yet proven. No frontend or derivative processor may consume this contract yet.

## Immediate priority
Correct PR #22 so pending/in-flight/uncertain Care attempts preserve the exact idempotency key/body for the same account while still revalidating current session and vehicle ownership on focus/page return; account/access changes must clear prior-account UI and ignore stale outcomes. In parallel, correct PR #24 so photo metadata recording is available only through a trusted server boundary and upload-before-metadata failures/races are safely reconciled or cleaned without deleting a successfully committed object. Then obtain Technical Lead re-review of those exact heads and publish the reviewed dependency/integration sequence for #16/#20/#17/#19/#21/#22/#23/#24 before any merge. PR #9 also needs an explicit corrected or superseded disposition. Hosted Supabase/session/private-storage verification, signed-in device QA and remaining #1/#8 release gates are still open.

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
- [x] Application request-ID, canonical error and redacted structured-log boundary
- [ ] Verify staging environment and rollback/restore setup

### Phase 1 — Garage
Status: IMPLEMENTED IN DRAFT PRS — NOT MERGED
- [x] Ownership-scoped add/edit/archive vehicle contract and UI in PR #17
- [x] Vehicle detail and history in PR #17
- [x] Audited/idempotent Garage mutation path in PR #17
- [x] Combined Garage/Care shared vehicle and permission verification in draft PR #21
- [x] Garage-linked My Jobs UI for saved Care requests in draft PR #22
- [x] Initial private original vehicle-photo intake implemented in draft PR #24
- [ ] Correct PR #24 trusted-server metadata boundary and upload-failure/race reconciliation
- [ ] Hosted Supabase/PostgREST/session/private-storage verification
- [ ] Signed-in device QA
- [ ] Clean/plain-background derived display image for the customer-owned vehicle; original media remains private
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
- [x] Same-account focus/page-return draft preservation and in-flight duplicate-key correction implemented at PR #22 head `cef948a`
- [ ] Correct PR #22 pending/uncertain identity revalidation so sign-out/account change clears prior-account data and stale POST outcomes cannot navigate the new session
- [x] Server-owned Repair/Cleaning catalogue and fail-closed coverage API implemented in PR #23
- [x] PR #23 resolver-failure contract corrected at `a0f2aed` so thrown/invalid resolver outcomes return the documented retryable 503 contract
- [x] Technical Lead accepted the corrected bounded PR #23 catalogue/coverage contract at `a0f2aed`
- [ ] Project Manager dependency/integration route and individual feature acceptance before merge
- [ ] Technical Lead re-review/acceptance of the next PR #22 service-entry correction
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

## Latest verified checkpoint — 2026-09-21 12:01 ACST
- Before this status-only alignment, `main` remained at `74768d1` with no merged feature PRs after the 09:59 checkpoint.
- PR #22 advanced one implementation commit from `a0458c8` to `cef948a`, changing 6 files (+93/-16) across `src/features/care/request-form.tsx`, `tests/ui/care-entry.mjs`, `docs/CARE_ENTRY_UI.md` and three regenerated synthetic QA PNGs. The correction preserves same-account draft/vehicle state and prevents focus from discarding an in-flight idempotency attempt. Exact-head GitHub Skycar CI run `35548453210` and Care database acceptance run `35548453274` passed. Technical Lead re-review still withholds service-entry acceptance because pending/uncertain state suppresses identity revalidation, so account/access changes can retain prior-account UI or accept stale navigation.
- PR #23 received no new implementation commit after `a0f2aed`; Technical Lead re-review accepted that bounded server-owned catalogue/fail-closed coverage contract. It remains draft/unmerged, and no authoritative resolver/provider is connected.
- New draft PR #24 (`feature/garage-vehicle-photo`) is stacked on #21 at exact head `f284c5f`; it is 2 commits / 12 changed files (+565/-5) and adds `docs/GARAGE_VEHICLE_PHOTO_API.md`, the Garage photo route/domain/repository, migration `202609200300_garage_vehicle_photos.sql`, unit/API/RLS coverage and the combined-migration allow-list update. Local evidence reports lint, TypeScript, 39 unit/API tests, production build, Garage photo fail-closed smoke, 34 Garage migration/RLS/RPC assertions and `git diff --check` passed. Exact-head GitHub Skycar CI `35549968425`, Garage PostgreSQL `35549968399`, Care database `35549968416` and Garage/Care integration `35549968398` all passed; the combined suite still reports 54 assertions. Technical Lead acceptance is withheld for the direct authenticated RPC validation bypass and unproven orphan-object reconciliation race.
- Merge/integration remains blocked because the reviewed dependency route for #16/#20/#17/#19/#21/#22/#23/#24 is still not recorded; stale PR #9 is still neither corrected nor explicitly superseded. Hosted Supabase/PostgREST/JWT/RLS/private-storage verification, signed-in device QA and remaining #1/#8 operational/release controls remain open.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
