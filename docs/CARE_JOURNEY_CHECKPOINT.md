# Connected Care implementation checkpoint — 3 October 2026

## Status and ownership

This is the continuation of the authorised customer/operations journey work, isolated from `fix/phone-test-delivery`. The recovered source is based on `47241fceed8f5207de918906a35a7f3165c6b6c4`. The staging branch remained at that revision when checked. No newer ownership handoff appeared in issue #12 comments since 1 October. This run owns only the recovered journey source and photo privacy regression on `work/care-journey-checkpoint`; the separate premium design branch is untouched.

This is a source checkpoint, not a release candidate. No database migration, hosted verification, deployment, role grant, provider connection or payment integration was performed. Existing staging booking remains the previous version.

## Implemented in this increment

- Recovered the unfinished journey customer UI, API routes, access-cookie and photo-storage helpers from the preceding working copy.
- Clear unsaved photo selections and pending commands whenever the verified request/account scope changes, even if no command was pending.
- Clear drafts after an authorization denial.
- Ignore callbacks from photo decoding after the picker unmounts, preventing an old image from appearing in a different account.
- Retain a completed photo selection across refreshes for the same verified account.
- Added `tests/ui/care-journey-privacy.mjs` to the customer browser CI workflow.

## Verification

- Existing unit suite: 171 passed, zero failed or skipped.
- Production build and TypeScript: passed locally.
- ESLint: passed without warnings.
- Existing guest photo browser regression: preview/compression, review summary, exact upload retry and three responsive widths passed.
- New mocked browser regression: same-account draft retention, changed-account draft clearing, late decoder completion, authorization denial/re-entry, exact command retry and pending-command clearing on account change.
- Responsive widths: 320, 390 and 1440 pixels; no horizontal overflow or browser page errors in that fixture.
- These browser checks use synthetic API responses. They do not prove database authorization, persistence or hosted end-to-end acceptance.

## Next work, in order

1. Run the generated `20261003064126_care_connected_journey.sql` and `tests/integration/care-journey.acceptance.mjs` against the disposable PostgreSQL 17 CI service. Local lint, TypeScript, 171 unit tests and production build pass, but this environment has no local PostgreSQL executable, so SQL acceptance remains pending until CI reports an exact revision.
2. Review and correct any SQL acceptance finding before applying a migration anywhere. The migration is not applied to hosted staging. Its intended contract is service-only tables/RPC, administrator/customer/guest authority checks, exact idempotency, vehicle/archive locking, expert service/postcode/insurance eligibility, quote expiry, serialized capacity confirmation, completion-photo hashes and Garage history.
3. Finish `/operations/care` UI: queue, request photos, expert registry, quotes, explicit confirmation of availability, start/completion/cancellation. An admin account must be identified and authorised separately; do not silently promote a customer.
4. Fix operations queue state lookup: the current draft loads the latest 200 journeys independently of its request queue. Fetch states for the actual queue IDs so older requests cannot appear incorrectly as under review.
5. Connect guest receipt and My Jobs/status to the authoritative journey. Ensure updated fulfilment/quote state takes precedence over old overdue/no-match messaging. Add customer request photos via the journey and finish the quote-to-completion browser scenarios.
6. Inspect private photo revalidation and pending write races, then perform database/API/hosted acceptance. No claim of full acceptance until actual saves and permission failures have been verified.

Keep human-reviewed quotes explicit. Ravin API credentials, payments and outbound notifications are not connected. Keep production/main, DNS and unrelated roadmap features outside this increment. Recheck current branches and ownership before the next write and preserve any later source changes.
