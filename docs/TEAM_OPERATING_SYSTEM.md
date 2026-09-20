# Skycar V2 — Team Operating System

## Purpose
This repository is the shared source of truth for the entire Skycar V2 product team.

## Roles
### Product Owner
- Owns commercial vision, scope approval, pricing, partnerships and final product decisions.
- Should only be pulled into decisions that materially affect customer experience, commercial model, legal exposure, brand or budget.

### Project Manager
- Owns roadmap, priorities, dependencies, issue hygiene, acceptance criteria and release readiness.
- Converts product decisions into executable work for frontend and backend.
- Maintains PROJECT_STATUS.md.
- Prevents duplicate or conflicting implementation.

### App Developer
- Owns customer, technician, fleet and admin frontend implementation.
- Builds only against documented API contracts.
- Raises backend requirements before inventing local workarounds.
- Keeps UI states for loading, empty, error and success cases.

### Backend Developer
- Owns data model, APIs, auth, permissions, payments, booking/job state, notifications, integrations, audit logs and security.
- Publishes contracts before frontend integration.
- Maintains migrations and backward compatibility during active development.

## Working Rule
No role should rely on another chat's memory. Anything that affects implementation must be written into this repository.

## Source-of-truth order
1. DECISIONS.md
2. GitHub issue acceptance criteria
3. ARCHITECTURE.md
4. PROJECT_STATUS.md
5. FRONTEND_TASKS.md / BACKEND_TASKS.md
6. Chat discussions

If two sources conflict, the higher item wins.

## Delivery workflow
1. Project Manager creates/updates issue.
2. Backend defines contract first when data/API work is required.
3. Frontend implements against the contract.
4. Each change is delivered through a dedicated branch and pull request.
5. PR includes screenshots or API examples where relevant.
6. Project Manager checks acceptance criteria and dependency impact.
7. Merge only when required tests pass and no blocking dependency remains.
8. PROJECT_STATUS.md is updated after merge.

## Branch naming
- feature/<area>-<short-name>
- fix/<area>-<short-name>
- chore/<short-name>

Examples:
- feature/repair-booking-flow
- feature/api-bookings
- fix/garage-empty-state

## Commit guidance
Use concise imperative commits:
- Add repair service selector
- Create booking status transition validation
- Fix customer vehicle deletion state

## Pull request minimum
Every PR must state:
- What changed
- Why
- Screens or API examples
- Tests performed
- Dependencies introduced or removed
- Follow-up work
- Whether schema/config/env vars changed

## Definition of Ready
A task is ready when:
- User outcome is clear
- Acceptance criteria are written
- Dependencies are identified
- API/data contract is known or explicitly part of the task
- No unresolved product decision blocks implementation

## Definition of Done
A task is done when:
- Acceptance criteria pass
- Error/loading/empty states are handled
- Permissions are enforced
- Tests pass
- No secrets are committed
- Documentation is updated
- Relevant analytics/audit events are included where required
- Project status is updated

## Coordination rule
Frontend and backend do not need to talk directly in chat. They coordinate through issues, contracts, PRs and these documents. The Project Manager owns orchestration and resolves conflicts.
