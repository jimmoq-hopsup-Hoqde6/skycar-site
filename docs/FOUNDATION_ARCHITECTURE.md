# Skycar V2 — Foundation Architecture

Status: ACCEPTED IMPLEMENTATION BASELINE  
Date: 2026-09-20  
Tracks: Issue #1

## 1. Architecture style

Skycar V2 starts as a modular monolith. One deployable application owns shared identity, vehicle, membership, Care, technician, fleet and admin domains. Boundaries are enforced in code and data contracts so domains can be separated later if evidence requires it.

Do not create separate customer, technician, fleet and admin backends.

## 2. Technology baseline

- Web: TypeScript, React and Next.js App Router.
- Persistence: PostgreSQL through Supabase.
- Authentication: Supabase Auth with verified server-session identity.
- Private media: Supabase Storage private buckets with authorised signed access.
- Billing: Stripe behind a server-side adapter. Live Care payment/payout design remains commercially gated.
- Async work: durable inbox/outbox jobs for provider callbacks, notifications, retries and reconciliation.
- External services: replaceable adapters. No vendor SDK may become the domain model.
- Delivery: responsive web first. Native applications are outside the first release.

Exact runtime and package versions must be resolved and pinned when the application scaffold is created. A committed lockfile is required.

## 3. Environments

Three explicit modes:
- demo: labelled fixtures; no live keys;
- staging: isolated auth/database/storage and provider test accounts;
- production: real approved integrations only; no mock fallback.

Missing production configuration disables the affected module or fails health/deploy validation. It never produces fake success.

## 4. Source layout

```text
src/app/                    routes, layouts, route handlers
src/features/garage/        vehicle UI and projections
src/features/benefits/      partner catalogue and redemption UI
src/features/membership/    plan and billing projections
src/features/roadside/      per-vehicle enrolment/help
src/features/care/          request, quote, scheduling and job UI
src/features/technician/    assigned work/capacity/earnings UI
src/features/fleet/         organisation-scoped workspace
src/features/admin/         operational exception tooling
src/features/sell/          reserved, feature-gated future flow
src/domain/                 pure rules, states, money/value types
src/server/auth/            verified actor and capability checks
src/server/repositories/    scoped persistence
src/server/integrations/    vendor adapters
src/server/jobs/            inbox/outbox/reconciliation
supabase/migrations/        reviewed versioned migrations
tests/unit/
tests/rls/
tests/api/
tests/integration/
tests/e2e/
```

React components do not own authoritative business transitions.

## 5. Domain ownership

### Identity and access
Owns authenticated actor, staff grants, organisations, invitations and capabilities. Roles cannot be self-granted through editable profile metadata.

### Garage
Owns the customer's private vehicle dossier, vehicle metadata, odometer events, sourced history, reminders and archive state.

The Garage vehicle record is the shared vehicle reference for customer Care. Care must not create a second customer-vehicle ownership table.

### Membership and entitlements
Owns versioned plans, membership lifecycle and dated feature entitlements. Billing state and entitlement state are related but not identical.

### Partners and roadside
Owns partner contracts/offers, eligibility, redemption, savings confirmation and provider-backed roadside enrolment. Provider confirmation is distinct from Skycar membership payment.

### Care
Owns service requests, reviewed quote versions, capacity, assignment, job execution, variations, evidence and outcomes.

### Money
Owns payment, refund, ledger, dispute and payout records. Amounts use integer minor units and explicit currency. Money state is never inferred from job state.

### Media and evidence
Owns private object metadata, upload intents, scan/validation state and authorised access. Original customer media is private by default.

### Technician
Owns provider profile, approved capabilities, service area, availability and job-scoped access.

### Fleet
Owns organisations, branch-scoped access and fleet-specific vehicle/approval records. Fleet is not required to block consumer foundation work.

### Admin / operations
Owns audited operational actions and exception queues. Admin authority is server-granted and MFA-gated for sensitive access.

### Intelligence
Stores model/provider suggestions, versions and review outcomes. AI findings never become ownership, payment or repair truth without the relevant domain transition.

### Sell
Reserved for later approved public snapshots/listings and controlled redacted handover. It cannot expose the prior owner's private dossier.

### Privacy / support
Cross-domain workflows for consent, export/deletion requests, support cases and retention.

## 6. Access model

Server identity is derived from the verified session. Every protected read/write is authorised against current grants.

Baseline:
- customer: own Garage, own membership and own Care requests;
- technician: assigned job data required to fulfil work only;
- fleet_member/fleet_admin: explicit organisation/branch scope;
- admin/support/finance: capability-specific audited access;
- guest: approved public content only.

PostgreSQL RLS is the baseline for exposed private tables. Service-role operations remain server-only and require explicit actor/capability checks.

Negative access tests are mandatory; hiding navigation is not security.

## 7. API contract

Root: `/api/v1`.

Success:
```json
{"data":{},"meta":{"requestId":"..."}}
```

Error:
```json
{"error":{"code":"VALIDATION_FAILED","message":"...","fieldErrors":{},"retryable":false},"meta":{"requestId":"..."}}
```

Use stable error codes, bounded cursor pagination and strict validation. Unknown owner/role/price/state fields are rejected rather than silently trusted.

Cookie-authenticated writes require same-origin/CSRF protections appropriate to the chosen implementation.

## 8. Concurrency and side effects

Sensitive operations use idempotency keys scoped to actor + operation + payload hash. Reuse with a different payload is a conflict.

Use transactions plus an outbox so business state and required asynchronous work commit together. Provider callbacks use authenticated, deduplicated inbox records. Retries must be safe.

Capacity reservation, quote acceptance, redemptions and money transitions require atomic conflict protection.

## 9. Care lifecycle

Do not collapse Care into one status.

Quote:
`draft -> in_review -> issued -> accepted | declined | expired | superseded`

Assignment:
`none -> offered -> reserved -> accepted -> cancelled | expired`

Fulfilment:
`scheduled -> ready -> in_progress -> paused -> completed -> validated -> closed`

Cancellation, dispute and rework are linked exception workflows.

Payment, refund, settlement and technician payout are separate Money states.

Rules:
- no charge for an unarrangeable job;
- no work on unapproved extra scope;
- no payout merely because UI says completed;
- no client-controlled authoritative transition.

## 10. Garage/Care parallel-development contract

Garage and Care may start in parallel only after the shared foundation contracts are merged.

Shared:
- authenticated actor;
- vehicle record ID;
- media primitives;
- audit/event envelope;
- error model;
- feature flags;
- notification boundary;
- date/time and money types.

Garage owns vehicle identity/history. Care consumes a permitted vehicle reference and adds Care-specific records. Care cannot mutate ownership or rewrite Garage history directly; completion emits an authorised event/projected Garage history entry.

Backend contracts are published before frontend integration. Each workstream uses a dedicated branch and PR.

## 11. Security baseline

- no secrets in browser bundles or repository;
- private media bucket, authorised short-lived access;
- no public VIN/rego or job-photo access;
- upload type/size/content validation;
- webhook signature validation;
- rate limits on auth/public/sensitive endpoints;
- audited privileged actions;
- no globally cached private Garage data;
- feature flags enforced server-side;
- no production mock fallback.

## 12. CI and test baseline

The scaffold must define CI stages for:
1. formatting/lint;
2. TypeScript checking;
3. unit/domain tests;
4. database migration + RLS tests;
5. API/integration tests;
6. browser/e2e tests;
7. production build;
8. secret/dependency scanning.

Issue #1 is not complete merely because this document exists. It closes only after the executable scaffold, migration/RLS baseline, environment setup, CI and documented clean-checkout commands satisfy its acceptance criteria.

## 13. Deployment boundary

The current repository contains a small public marketing site. Foundation work must not silently overwrite that site or change DNS. The application deployment target/path must be explicit before public deployment.

## 14. Architecture gates

After this contract plus the shared auth/types/migration ownership are merged:
- Issue #2 Garage may proceed;
- Issue #3 Care backend may proceed;
- Issue #4 Care frontend may proceed against documented backend contracts.

Technician, Fleet and expanded Admin build on the same foundation; they do not create parallel databases or independent auth systems.

## 15. Explicitly deferred

- live Care payment/payout model;
- production Plus pricing;
- provider-backed roadside;
- AI vendor selection;
- native mobile apps;
- full Fleet;
- public Sell marketplace;
- prize/giveaway mechanics.

These are reserved behind domain boundaries and feature gates, not simulated as active.
