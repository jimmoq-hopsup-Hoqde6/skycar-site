# Skycar V2 — Architecture Contract

## Objective
Keep product areas modular while sharing a common identity, vehicle, booking, payment and notification foundation.

## Logical domains
### Identity
Users, roles, sessions, consent, permissions.

### Garage
Vehicles, ownership, vehicle metadata, service history, condition records.

### Marketplace
Services, service areas, pricing inputs, quote requests, technician matching.

### Bookings
Availability, booking creation, assignment, status transitions, cancellation and completion.

### Media
Customer photos, inspection images, before/after evidence, upload metadata and access control.

### Payments
Payment intent, authorization/capture, refunds, technician payout records and reconciliation.

### Membership
Plans, entitlements, partner benefits and eligibility.

### Technician
Provider profile, capabilities, service area, availability, jobs and earnings.

### Fleet
Organizations, members, vehicles, inspections, repair tasks and reporting.

### Admin
Operational controls, disputes, overrides, audit log and configuration.

## Required role model
Minimum roles:
- customer
- technician
- fleet_member
- fleet_admin
- admin

A user may hold multiple roles.

## API conventions
- Version APIs from the beginning.
- Use stable resource IDs.
- Return structured validation errors.
- Never use display text as a state identifier.
- Backend owns authoritative business state.
- Frontend may optimistically render only when rollback is safe.

## Care state baseline (supersedes the original combined booking chain)
Accepted D-006 and Issue #14 require separate quote, assignment, fulfilment
and money lifecycles. See FOUNDATION_ARCHITECTURE.md section 9 and
[CARE_API.md](CARE_API.md). Customer stages are server-owned projections,
not another booking state machine. Refunds and disputes never imply a
physical-work transition. No client may write authoritative states.

## Security baseline
- No secrets in frontend code or repository
- Least-privilege access
- Signed/private media access where appropriate
- Server-side authorization for every protected action
- Input validation for all public endpoints
- Rate limiting for sensitive/public endpoints
- Audit important admin and payment actions
- Do not trust client-provided price, role or booking status

## Integration boundaries
Third-party services must be wrapped behind internal adapters so vendors can be replaced without rewriting core product flows.

Likely adapter categories:
- payments
- email/SMS/push
- vehicle/history data
- damage/condition AI
- maps/geocoding
- file storage
- analytics

## Non-negotiable implementation rule
Frontend must not embed business rules that belong to the backend. The backend is authoritative for price, eligibility, permissions, booking state and payment state.
