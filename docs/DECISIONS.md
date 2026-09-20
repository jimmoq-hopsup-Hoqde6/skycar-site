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


## D-007 — Services acquire customers; Garage retains them
Date: 2026-09-20
Status: ACCEPTED

Decision:
Skycar's public acquisition experience is service-led. Customers enter through an immediate vehicle need, initially focused on cosmetic Repair & Cleaning and a later Sale-Ready journey. The logged-in Garage remains the persistent customer home and retention layer.

Initial public service choices should stay narrow and understandable:
- Fix scratches or dents
- Detail or clean my car
- Prepare my car for sale (staged after the core Care path is usable)

A customer may begin a service journey before understanding or actively choosing the Garage proposition. When the customer creates/saves the vehicle needed for the service, that same authorised vehicle record becomes their free Garage vehicle. Care references the Garage vehicle ID; it does not create a separate vehicle ownership model.

The Garage remains useful independently of technician bookings, with vehicle identity, actual customer vehicle image, records/history, jobs, documents and reminders. Skycar+ and broader ownership benefits may increase retention later but must not block the free Garage.

Reason:
Customers are more likely to arrive with urgent, concrete intent such as cleaning, detailing, scratches, dents or preparing a car for sale. Services provide a clearer acquisition and early monetisation wedge, while Garage provides continuity and repeat value after the immediate problem is solved.

Impact:
- Marketing/public entry is service-first, not Garage-first.
- Logged-in home remains Garage-first.
- Build Garage and Care in parallel on the shared foundation.
- Prioritise a short service request path and manual/operational fulfilment before advanced automation.
- Do not broaden V1 into mechanical repairs, roadside, insurance, nationwide coverage or a full vehicle marketplace.
- Sale-Ready becomes the next acquisition extension after the core service flow, without replacing Garage.
