# Skycar V2 — Backend Workstream

Owner: Backend Developer
Coordinator: Project Manager

## Foundation
- Runtime/framework decision
- Database and migration strategy
- Environment management
- Authentication
- RBAC / permission middleware
- API versioning
- Structured error model
- Logging
- Audit logging
- Background jobs
- Storage abstraction
- Testing foundation
- CI integration

## Core data model
- users
- roles / memberships
- vehicles
- vehicle_history
- condition_reports
- media_assets
- services
- quote_requests
- quotes
- technician_profiles
- technician_services
- technician_availability
- bookings
- booking_events
- payments
- payouts
- memberships
- entitlements
- fleet_organizations
- fleet_members
- fleet_vehicles
- inspections
- disputes
- notifications
- audit_events

## Repair & Cleaning APIs
Minimum contracts:
- create quote request
- attach photos
- list service categories
- calculate/request estimate
- capture customer availability
- create booking
- retrieve booking
- cancel booking
- assign technician
- technician accept/decline
- update job status
- upload before/after evidence
- complete job
- submit review
- open guarantee/dispute case

## Payment rules
- Never accept authoritative price from client
- Record payment lifecycle separately from booking lifecycle
- Make operations idempotent
- Persist external provider IDs
- Handle webhook replay safely
- Log refunds and manual overrides

## Security rules
- Enforce object-level authorization
- Validate uploads
- Restrict private media
- Protect admin endpoints
- Rate-limit public/auth endpoints
- Validate webhook signatures
- Sanitize external integration payloads

## Backend handoff requirement
Before frontend integrates a feature, provide:
- endpoint
- method
- auth requirement
- request example
- response example
- validation errors
- state transitions
- known edge cases
