# Connected Care implementation checkpoint — 3 October 2026

## Status and ownership

This is the continuation of the authorised customer/operations journey work, isolated from `fix/phone-test-delivery`. The recovered source is based on `47241fceed8f5207de918906a35a7f3165c6b6c4`. The staging branch remained at that revision when checked. No newer ownership handoff appeared in issue #12 comments since 1 October. This run owns only the recovered journey source and photo privacy regression on `work/care-journey-checkpoint`; the separate premium design branch is untouched.

This is a development checkpoint, not a release candidate. The database migration exists and passed disposable PostgreSQL CI, but it has not been applied to hosted staging. No deployment, role grant, provider connection or payment integration was performed. Existing staging booking remains the previous version.

## Implemented through this increment

- Recovered the unfinished journey customer UI, API routes, access-cookie and photo-storage helpers from the preceding working copy.
- Clear unsaved photo selections and pending commands whenever the verified request/account scope changes, even if no command was pending.
- Clear drafts after an authorization denial.
- Ignore callbacks from photo decoding after the picker unmounts, preventing an old image from appearing in a different account.
- Retain a completed photo selection across refreshes for the same verified account.
- Added `tests/ui/care-journey-privacy.mjs` to the customer browser CI workflow.
- Added the private `/operations/care` workspace for exact request queue state, private evidence review, verified expert registration, human-reviewed quotes, explicit availability confirmation, work start, completion evidence and completion/cancellation commands.
- Kept “requested” and “confirmed” appointments visually and operationally distinct. Confirmation requires an explicit human availability assertion; the database remains authoritative for overlap prevention.
- Added safe exact retry for uncertain operations writes and cleared selected records, pending commands and unsaved completion evidence when the verified operations account changes.
- Rebuilt `supabase/migrations/20261003064126_care_connected_journey.sql` and its database acceptance suite. The database contract restricts access to the trusted service boundary, rechecks customer/guest/admin authority, enforces exact idempotency and state transitions, serialises expert capacity, verifies completion evidence metadata and writes Garage completion history atomically.
- Fixed the operations queue to fetch journey states for the exact request IDs in the queue rather than an unrelated latest-200 window.
- Added `tests/ui/care-operations.mjs` to the browser workflow.

## Verification

- Existing unit suite: 171 passed, zero failed or skipped.
- Production build and TypeScript: passed locally.
- ESLint: passed without warnings.
- Existing guest photo browser regression: preview/compression, review summary, exact upload retry and three responsive widths passed.
- New mocked browser regression: same-account draft retention, changed-account draft clearing, late decoder completion, authorization denial/re-entry, exact command retry and pending-command clearing on account change.
- Responsive widths: 320, 390 and 1440 pixels; no horizontal overflow or browser page errors in that fixture.
- Connected Care PostgreSQL 17 acceptance passed for exact head and integration candidates, including authority, idempotency, archive/ownership, quote eligibility/expiry, concurrent capacity confirmation, evidence hashes, rollback and Garage history.
- New mocked operator browser regression passed: private review, manual quote publication, disabled-until-asserted confirmation, exact ambiguous retry, operations account-switch clearing, completion upload/completion and three responsive widths.
- These browser checks use synthetic API responses. They do not prove database authorization, persistence or hosted end-to-end acceptance.

## Next work, in order

1. Connect the guest receipt and Garage My Jobs/status pages to the authoritative journey. Updated quote/fulfilment state must take precedence over old overdue/no-match messaging, and “requested” must never be presented as “confirmed”.
2. Add a connected customer browser story from receipt/My Jobs through quote choice, booking request, operations confirmation, completion evidence and Garage history.
3. Review the migration and operator candidate together. Identify the authorised test administrator separately; do not silently promote a customer.
4. Only then apply the migration to a disposable/staging database and run real API/RLS/storage/idempotency/state-transition acceptance with both allowed and denied sessions.
5. Validate the hosted customer and operator path before any staging release. No claim of full acceptance until actual saves, private-media reads and permission failures have been verified.

Keep human-reviewed quotes explicit. Ravin API credentials, payments and outbound notifications are not connected. Keep production/main, DNS and unrelated roadmap features outside this increment. Recheck current branches and ownership before the next write and preserve any later source changes.
