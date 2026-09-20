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


## D-006 — Skycar V2 foundation architecture
Date: 2026-09-20
Status: ACCEPTED

Decision:
Use a TypeScript/Next.js modular monolith with Supabase/PostgreSQL authentication, persistence and private storage; durable inbox/outbox jobs; replaceable provider adapters; and Stripe behind a server-side adapter. Customer, technician, fleet and admin share one domain model and permission system.

Garage owns the private customer vehicle dossier. Care references that vehicle record rather than creating a second ownership model. Care quote, assignment, fulfilment and money lifecycles remain separate.

Garage and Repair & Cleaning may proceed in parallel only after shared auth, types/interfaces and migration ownership are merged. Backend contracts precede frontend integration.

Reason:
This keeps the Garage-first product independent of Care capacity while preventing duplicated identity, vehicle, payment and permission logic as separate workstreams begin.

Impact:
Issue #1 is the blocking foundation. Issue #2 and Issues #3/#4 are unblocked only by the foundation gate. Live deployment, Care money model, Plus pricing and provider commitments remain separately gated.

Reference:
docs/FOUNDATION_ARCHITECTURE.md

## D-007 — Garage mutation boundary
Date: 2026-09-20
Status: IMPLEMENTATION OF ACCEPTED #2 / D-006

Decision:
Own-vehicle create/edit/archive goes through one authenticated, atomic database RPC.
The RPC derives ownership from auth.uid(), rejects unknown fields, checks the expected
vehicle revision, and records mutation history, audit metadata and idempotent results
in the same transaction. Direct authenticated writes to public.vehicles and its
system-created vehicle_history are revoked; owner-entered events require a future
validated Garage event API rather than direct database inserts.
Vehicle identity, existing read policies and Care references remain unchanged.

Reason:
An HTTP-only check can be bypassed by clients of the exposed database API. The same
ownership, retry and stale-edit rules must hold at both boundaries.

Impact:
Garage UI consumes docs/GARAGE_API.md. Other workstreams must not write vehicles
directly or introduce another ownership model. New migration remains subject to
isolated database and release verification under #1/#8. No live migration is authorised
or performed by committing the implementation.
