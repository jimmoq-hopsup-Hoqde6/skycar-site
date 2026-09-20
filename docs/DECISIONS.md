# Skycar V2 — Decision Log

This file records implementation decisions that affect more than one workstream.

## D-001 — Repository as shared source of truth
Date: 2026-09-20
Status: ACCEPTED

All implementation-critical decisions, contracts, tasks and progress must be represented in GitHub. Separate ChatGPT roles/chats must not depend on shared conversational memory.

## D-002 — Project Manager is orchestration owner
Date: 2026-09-20
Status: ACCEPTED

The Project Manager coordinates frontend/backend dependencies, issue priority, acceptance criteria and project status.

## D-003 — Garage-first product
Date: 2026-09-20
Status: ACCEPTED

Skycar V2 must provide ongoing value through the customer's Garage, vehicle records, membership and benefits even if no repair technician is booked.

## D-004 — Repair & Cleaning remains a core module, not the whole product
Date: 2026-09-20
Status: ACCEPTED

Service booking is a major workflow but Skycar must not depend entirely on technician marketplace volume for product utility.

## D-005 — Backend owns authoritative business state
Date: 2026-09-20
Status: ACCEPTED

Pricing, permissions, booking state, payment state and entitlement rules are server authoritative.

## Decision template
### D-XXX — Title
Date:
Status: PROPOSED / ACCEPTED / SUPERSEDED

Decision:

Reason:

Impact:
