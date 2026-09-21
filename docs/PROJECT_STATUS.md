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
The repository contains the legacy small public website plus the merged Skycar V2 modular-monolith application scaffold. The V2 foundation is not production-ready and has not been deployed. Executable Garage and Repair & Cleaning work exists in open pull requests, but none of those feature PRs has been merged to `main` or accepted for production use.

Active implementation evidence:
- PR #16: durable Care request receipt, authoritative status/events, overdue/no-match recovery and restricted worker contract.
- PR #17: ownership-scoped Garage vehicle list/create/detail/edit/archive/history with audited mutation controls and responsive UI.
- PR #19: customer Care request status/timeline UI with overdue/no-match handling and committed synthetic desktop/mobile evidence, stacked on #16.
- PR #20: owner-scoped My Jobs/Care request list API with pagination, vehicle filtering and overdue summaries, stacked on #16.
- PR #21: combined Garage/Care integration-verification branch applying every public migration together and testing the shared vehicle/permission boundary; Technical Lead accepted this combined boundary evidence only, not the full feature/release scope.
- PR #22: authenticated Garage-linked My Jobs UI, reload-safe Care reopening and authenticated service-first Care entry. Technical Lead accepted the bounded My Jobs and reload-recovery slices. Exact head `cef948a` fixes the same-account focus/page-return draft-loss and duplicate-key issue, but re-review found a remaining pending-session privacy/stale-navigation blocker: pending/uncertain state can suppress identity revalidation, leaving prior-account data visible or allowing an old response to navigate a changed session. Service-entry acceptance remains blocked.
- PR #23: server-owned Repair/Cleaning service catalogue plus a strict coverage contract that fails closed with `COVERAGE_UNAVAILABLE` until an authoritative coverage resolver is approved and connected. Corrective head `a0f2aed` is technically accepted for the bounded catalogue/coverage contract. No resolver/provider, real coverage area, price or appointment is approved or connected.
- PR #24: first private Garage vehicle-photo intake contract and backend implementation. Security-correction head `4a2900d` moves all photo mutation behind a server-only trusted client, revokes authenticated Storage/RPC mutation, reserves authoritative metadata before upload, and adds durable reconciliation/quarantine behavior. Exact-head application, Garage PostgreSQL, Care database and combined Garage/Care checks are green. Technical Lead re-review and hosted Supabase two-account/private-Storage plus signed-in-device verification remain open; no frontend or derivative processor may consume the contract before review clears.
- PR #25: new main-based foundation observability draft at `11a53dd` adds server-owned request IDs, canonical API envelopes, no-store headers, redacted allow-listed completion logs, logging-failure isolation, and first adoption by `GET /api/v1/health`. Exact-head application CI is green. Technical Lead review and hosted log collection/retention/access/alerting remain open; it is unmerged and undeployed.

## Immediate priority
Correct PR #22 so pending/in-flight/uncertain Care attempts preserve the exact idempotency key/body for the same account while still revalidating current session and vehicle ownership on focus/page return; account/access changes must clear prior-account UI and ignore stale outcomes. Obtain Technical Lead re-review of PR #24's corrected trusted photo boundary and Technical Lead review of PR #25's observability boundary. The Project Manager still needs to publish the reviewed dependency/integration sequence for #16/#20/#17/#19/#21/#22/#23/#24 and decide the safe reviewed merge/rebase point for independent main-based PR #25 before feature integration. PR #9 also needs an explicit corrected or superseded disposition. Hosted Supabase/session/private-storage verification, signed-in device QA, hosted logging controls and remaining #1/#8 release gates are still open.

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
- [x] Application request-ID, canonical error and redacted structured-log boundary implemented in draft PR #25
- [ ] Technical Lead acceptance/merge of PR #25 and hosted log collection/retention/access/alerting
- [ ] Verify staging environment and rollback/restore setup

### Phase 1 — Garage
Status: IMPLEMENTED IN DRAFT PRS — NOT MERGED
- [x] Ownership-scoped add/edit/archive vehicle contract and UI in PR #17
- [x] Vehicle detail and history in PR #17
- [x] Audited/idempotent Garage mutation path in PR #17
- [x] Combined Garage/Care shared vehicle and permission verification in draft PR #21
- [x] Garage-linked My Jobs UI for saved Care requests in draft PR #22
- [x] Initial private original vehicle-photo intake implemented in draft PR #24
- [x] PR #24 trusted-server metadata boundary and upload-failure/race reconciliation correction implemented at `4a2900d`
- [ ] Technical Lead re-review/acceptance of PR #24 corrected head
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

## Latest verified checkpoint — 2026-09-21 14:01 ACST
- Material progress occurred after the 12:01 checkpoint. No feature PR was merged or deployed.
- PR #24 advanced one corrective commit from `f284c5f` to `4a2900d` (`fix(garage): secure vehicle photo persistence`): 9 files changed, +286/-102. The correction adds the server-only `SUPABASE_SECRET_KEY` trusted client, revokes authenticated Storage writes/deletes and photo mutation RPC execution, reserves authoritative metadata before upload, and reconciles uncertain post-upload finalisation without race-deleting a valid object. Local exact-tree evidence reports lint/TypeScript PASS, 41 unit/API tests PASS, production build PASS, Garage photo fail-closed smoke PASS, 46 Garage migration/RLS/RPC assertions PASS and `git diff --check` PASS. Exact-head GitHub checks all completed successfully: application run `35557571865`, Garage PostgreSQL `35557571914`, Care database `35557571889`, and combined Garage/Care `35557571961`. Technical Lead re-review is still required; hosted Supabase/Storage and signed-in-device evidence remains missing.
- New draft PR #25 (`fix/foundation-observability`) was opened from `main` at exact head `11a53dd`: 1 commit / 7 files / +285/-3. It adds `docs/FOUNDATION_OBSERVABILITY.md`, `src/server/http/api-boundary.mjs`, API-boundary unit tests, wires `/api/v1/health` through the boundary, updates architecture/status docs and ignores `*.tsbuildinfo`. Local evidence reports clean dependency install, lint, TypeScript, 9 unit tests, production build, built-server health smoke and `git diff --check` all PASS. Exact-head GitHub application CI run `35559461134` completed successfully. Technical Lead review and hosted logging controls are still open.
- PR #22 remains unchanged at `cef948a` since the prior checkpoint and still has the pending-session identity-revalidation/privacy blocker. PR #23 remains accepted only for its bounded `a0f2aed` catalogue/coverage contract.
- Merge/integration remains blocked because the reviewed dependency route for #16/#20/#17/#19/#21/#22/#23/#24 is still not recorded; the safe reviewed merge/rebase point for independent PR #25 is also not recorded, and stale PR #9 is still neither corrected nor explicitly superseded.
- No production deployment, live billing/provider activation, DNS change, destructive database change or live migration occurred.

## Product priority update — 2026-09-20
Decision D-007 approved: Services acquire customers; Garage retains them.

Active build priority:
1. Lean authenticated Garage: real vehicle identity/image, ownership, history, reminders, documents and My Jobs.
2. Service-first acquisition/Care: scratch/dent and detail/clean entry, shared vehicle, private photos, coverage, durable request/status.
3. Technician/operations fulfilment required to complete Care jobs.
4. Sale-Ready acquisition extension after the core Care path is usable.

Issue #18 tracks the public service-first entry journey. This priority change does not replace the shared Garage/Care architecture or duplicate vehicle ownership.
