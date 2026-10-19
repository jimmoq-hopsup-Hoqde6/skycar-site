# Developer 3 — technician UI handoff

User outcome: technicians can explore their day, inspect jobs and set working hours without altering bookings.

Branch: `feature/developer-3-technician-preview`. Base: `7912bc9c3375b713fa2e879ba66387d5a8f79feb`.
Exclusive scope: `src/app/technician-preview/**` and this document. Open `/technician-preview` locally. This is a standalone demo route with fictional data, not production navigation or authenticated technician functionality.

Implemented: date-selected job list, requested versus confirmed filters, job details, initially empty weekly availability, same-day minimum-15-minute validation, dated full-day exceptions, save/discard and explicit tab-only persistence. Demo fixtures use 19–20 October 2026. Cancellation-requested jobs remain in the confirmed filter. Schedule edits do not remove jobs.

Developer 1 owns all shared database, permission and booking-command work. No schema, environment, configuration, shared UI, API or frozen PR #60 changes. The #60 proposal is reference material, not an approved live dependency.

Integration handoff: provide a reviewed availability read/replace contract, revision conflict and retry behavior, authenticated account clearing, job read shape and permitted command transitions. Save must only report success after the server confirms it. Server remains capacity authority. Backend integration is blocked pending that handoff; mock UI work is not blocked.

Remaining: multiple windows per day, partial-day exceptions, full date-range validation, timezone-offset/DST serialization, account-switch/error recovery and reviewed job commands. No reschedule/cancel mutations are simulated. No production-readiness claim.

Validation: ESLint, TypeScript and production build passed. Browser interaction checks were attempted but could not run because the Playwright Chromium executable is absent in this environment. Mobile visual and interaction QA remains required before acceptance.
