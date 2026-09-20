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
This repository currently contains a very small public website foundation. The production Skycar V2 application architecture has not yet been established in this repository.

## Immediate priority
Build a stable application foundation before expanding features.

### Phase 0 — Foundation
Status: NOT STARTED
- Confirm frontend framework and project structure
- Confirm backend runtime and database
- Environment configuration
- Authentication and role model
- CI checks
- Shared API conventions
- Error reporting and logging

### Phase 1 — Garage
Status: NOT STARTED
- Account onboarding
- Add vehicle
- Vehicle profile
- Vehicle history
- Condition summary
- Membership summary
- Recommended actions

### Phase 2 — Repair & Cleaning
Status: NOT STARTED
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
