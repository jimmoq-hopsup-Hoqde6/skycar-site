# Skycar AI Development Team — Proposed Operating Model

Status: PROPOSED — branch review required; does not supersede accepted decisions.
Owner: Product Owner. Orchestration owner: Project Manager (per D-002).
Scope: Skycar V2 web foundation and proposed iOS/Android mobile application.

## Roles and accountability
| Role | Owns | Output | Must not do autonomously |
| --- | --- | --- | --- |
| Product Owner (human) | Vision, commercial decisions, budgets, legal and final release approval | Approved scope and release decisions | Delegation of final accountability |
| AI Project Manager | Priorities, dependencies, issue hygiene, integration order, weekly status | Issues, acceptance criteria, PR sequencing | Override accepted decisions or merge blocked work |
| Product Strategist | Customer journeys, scope proposals, service-led acquisition and Garage retention | Product briefs, acceptance proposals | Change approved business model |
| UX/UI Designer | Customer, technician, fleet and admin flows; accessibility | Design specs, screen states, review evidence | Treat mockups as accepted implementation |
| Mobile Developer | Proposed Expo/React Native iOS/Android client; API integration | Mobile PRs and tests | Duplicate backend business rules |
| Backend Developer | Existing Next.js/Supabase APIs, database migrations, auth, booking/payment states | Versioned contracts, migrations, backend PRs | Change production data or permissions without approval |
| AI Specialist | Optional condition/media assistance, evaluation, privacy-preserving AI integration | Experiments, evaluation reports | Deploy AI processing of private photos without approval |
| QA Engineer | Unit, integration, E2E, device and regression verification | Test plans, reproducible bug reports | Mark unverified hosted/device tests as passed |
| Security Engineer | Auth, RLS, private storage, account switching, threat reviews | Security review and blocking findings | Waive release gates |
| Release Manager | CI, staging, backups, rollout and rollback | Release checklist, release candidate | Deploy, publish or purchase services without approval |

## Existing source of truth
Follow docs/DECISIONS.md, GitHub issue acceptance criteria, docs/ARCHITECTURE.md, docs/PROJECT_STATUS.md, and docs/TEAM_OPERATING_SYSTEM.md in that order. Existing accepted decisions D-001 through D-007 remain binding. No agent may rely on another chat's memory.

## Delegation protocol
1. Project Manager identifies a ready GitHub issue and checks accepted decisions, dependencies and blocking PRs.
2. Specialist writes a short plan and acceptance criteria in the issue or PR.
3. Implementation uses a dedicated feature/fix branch; never directly commits to main.
4. Backend contracts precede client implementation when authoritative data or permissions are involved.
5. QA verifies automated checks; Security reviews auth, account boundaries, payments, private media and migrations.
6. Project Manager reviews dependency/integration order. Human approves merges that change shared contracts, security, production, pricing or releases.
7. Update project status after approved merge. Preserve links to test evidence.

## Automation and approval policy
Autonomous within scoped tasks: read-only analysis, issue drafts, specs, documentation, code changes on isolated branches, local/test-environment checks and draft pull requests.
Human approval required: merge to main, production/staging deployment that affects live systems, app-store submission, purchasing services, production data deletion/migration, credentials/permission changes, payment processing, material architecture/business/legal decisions.
Security and QA blockers cannot be bypassed by another agent.
Never paste secrets into issues, prompts, logs or code.

## Coordination reality
These are defined responsibilities, not automatically provisioned independent always-on agents. GitHub stores work and decisions; Codex/Work or another supported executor must be explicitly configured to run each role. Agent-to-agent communication occurs through issues, specs, PRs and reviews rather than assumed shared memory.

## Immediate integration priorities
1. Audit open PRs and verify current CI; reconcile docs/PROJECT_STATUS.md with actual heads.
2. Resolve the documented PR #22 account-switching privacy/stale-response blocker.
3. Complete independent security review and hosted verification for PR #24 private photo boundary.
4. Review PR #25 observability and establish safe integration sequencing for #16–#25.
5. Establish mobile architecture decision and separate Expo/React Native client plan only after existing backend contracts are mapped.
6. Do not claim a release-ready marketplace, bookings, payments or mobile app before evidence supports it.
