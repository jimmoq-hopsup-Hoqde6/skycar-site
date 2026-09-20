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
- PR #22: authenticated Garage-linked My Jobs UI plus reload-safe Care reopening and the first authenticated service-first Care entry for scratch/dent and detail/clean, stacked on #21. Exact-head application and Care PostgreSQL checks pass, but the latest service-entry increment still requires acceptance review.

## Immediate priority
Record the reviewed dependency/integration sequence for #16/#20/#17/#19/#21/#22 before any merge, then review PR #22 head `2ac83e9` as a bounded service-entry increment. The combined Garage/Care database-boundary evidence and the earlier My Jobs presentation slice are technically accepted, but individual feature acceptance, hosted Supabase/session/private-storage verification, signed-in device QA and remaining release gates are still open. If review finds no blocker, the next concrete frontend task is inline vehicle creation in the service journey through the existing audited Garage API, preserving one shared vehicle identity.

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
- [x] Technical Lead accepted the bounded synthetic My Jobs presentation slice in PR #22
- [x] Cross-reload uncertain-write recovery for Care reopening in PR #22
- [x] First service-first scratch/dent and detail/clean entry slice in PR #22
- [ ] Project Manager dependency/integration route and individual feature acceptance before merge
- [ ] Latest PR #22 service-entry increment acceptance review
- [ ] Inline new-vehicle creation in the service journey using the audited Garage API
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

## Latest verified checkpoint — 2026-09-21 06:01 ACST
- `main` still contains no merged current feature PR before this status-only alignment. PR #22 advanced two commits since the 04:01 checkpoint: `fd782da` (`Recover uncertain Care retry after reload`) and `2ac83e9` (`Add authenticated Care service entry`).
- Relative to prior PR #22 head `5c5f741`, the two commits change 25 files. Material code/docs include `src/domain/care/retry-recovery.ts`, `src/domain/care/submission.ts`, `src/features/care/request-form.tsx`, `src/app/care/request/page.tsx`, Care status/My Jobs/Garage navigation updates, `tests/ui/care-entry.mjs`, `tests/unit/care-retry-recovery.test.mjs`, `tests/unit/care-submission.test.mjs`, `docs/CARE_ENTRY_UI.md`, `docs/CARE_STATUS_UI.md` and new/updated synthetic QA screenshots.
- `fd782da` adds tab-scoped reload recovery for uncertain Care reopening, storing only request ID, idempotency key and start time, reusing the exact key after reload and clearing recovery on authoritative or definitive outcomes. Local verification passed lint, TypeScript, 45 unit/API tests, production build, built-route fail-closed smoke, Chromium reload/reconciliation acceptance and `git diff --check`; exact-head application CI and Care database acceptance both passed.
- Current PR #22 head `2ac83e9` adds the approved service-first entry: public scratch/dent and detail/clean choices, authenticated `/care/request`, active owner-scoped Garage vehicle selection, exact published Care payload/idempotency handling, receipt navigation, Garage/My Jobs links and explicit failure/empty/session states. Local verification passed lint, TypeScript, 47 unit/API tests, production build, built Care-route smoke, Chromium service-entry acceptance and `git diff --check`; exact-head GitHub application and Care PostgreSQL checks both completed successfully.
- Technical Lead acceptance exists for the earlier bounded My Jobs slice at `5c5f741`; no acceptance review for latest service-entry head `2ac83e9` is recorded yet. Merge remains blocked on the Project Manager dependency/integration sequence and individual feature acceptance.
- Remaining release blockers/gates: hosted Supabase/PostgREST/session/private-storage verification, signed-in physical-device QA, inline new-vehicle creation for new service entrants, guided private photo/media intake, coverage/capacity handling, notification delivery/operational wiring and remaining #1/#8 controls.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
