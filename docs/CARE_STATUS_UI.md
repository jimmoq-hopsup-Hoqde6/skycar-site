# Customer request status — implementation checkpoint

## Scope

Issue #4: `/care/requests/:id` consumes the published `CARE_API.md` GET and retry contracts. This is a request-specific screen, not a complete My Jobs list or service-entry flow. It is based on PR #16 and remains draft pending accepted integration and signed-in QA. No private-pilot code or evidence is imported.

The screen shows the recorded receipt, ordered events, next-update deadline and responsible role. An elapsed deadline is displayed as overdue without waiting for the worker. Reopening is offered only for `no_match`; no technician, booking, quote or payment is inferred. Unsupported responses fail closed. Refresh failures label retained data as stale; access failures remove private details. An uncertain reopening reuses its key while the page remains open. Keep the page open to resolve an uncertain write; cross-reload recovery is a follow-up before release.

## Executed locally, 20 September 2026

- `npm run check`: lint, TypeScript, 22 existing unit tests and production build passed.
- After adding presentation regression tests, `npm test`: 25 tests passed (22 existing + 3 new); lint passed again.
- `node --test tests/api/care-smoke.test.mjs`: built routes fail closed with Care disabled or unconfigured; passed.
- `tests/ui/care-status.mjs`: Chromium synthetic intercepted-API scenarios passed for overdue-before-worker, 390px overflow, stale failure notice, no-match, uncertain retry key reuse, reopened receipt and expired-session redaction. Mobile screenshot inspected locally. These are not live Supabase, real sign-in, physical-device or deployment tests.

Browser runner needs Playwright and Chromium installed externally. Run against the production build with `PLAYWRIGHT_MODULE` pointing to Playwright's module and `CHROMIUM_PATH` to Chromium (omit these for a standard installation). In this runtime the extracted Chromium additionally needed its shared-library directory and a fontconfig file pointing to installed fonts. An initial browser visibility failure was traced to missing fonts; the suite passed after correcting runtime font configuration. No application checks were weakened.

## Gates and next steps

- No schema, environment or production dependency change; no deployment or activation performed.
- PR #16 backend acceptance/integration review is still required. Garage integration and isolated Supabase/session/device evidence remain missing.
- Full pending/upcoming/past My Jobs needs an accepted owner-scoped list/pagination/grouping contract. Consume that separately when published and accepted; do not invent endpoints or lifecycle states.
- Session entry, cross-reload uncertain-write recovery and linked service-entry navigation remain follow-ups. The existing root navigation is unchanged.
- Worker scheduling, response policy and notification delivery are backend/operations gates; the UI does not imply those processes are active.
