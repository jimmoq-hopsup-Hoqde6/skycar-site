# Skycar V2 — Handoff Rules

## Project Manager -> Developer
Every implementation task must include:
- user outcome
- scope
- acceptance criteria
- dependencies
- non-goals
- priority
- target product area

## Backend -> Frontend
For each API:
- route + method
- auth
- request schema/example
- response schema/example
- errors
- state rules
- test data notes

Frontend should not integrate undocumented endpoints.

## Frontend -> Backend
When requesting backend changes:
- screen/flow
- data needed
- action user is taking
- expected success result
- expected failure cases
- whether request blocks current work

## Developer -> Project Manager
When work is complete:
- link PR
- summarize change
- confirm acceptance criteria
- call out remaining risks
- list follow-ups
- note schema/env/config changes

## Blockers
A blocker must be recorded in the relevant GitHub issue. Do not leave blockers only in chat.

Format:
- BLOCKED BY:
- WHY:
- OWNER:
- REQUIRED DECISION/ACTION:

## Change control
Do not silently change:
- core navigation
- booking lifecycle
- payment lifecycle
- user roles
- pricing logic
- membership entitlement
- database contracts used by another workstream

Create/update a decision entry first.
