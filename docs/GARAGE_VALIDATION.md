# Garage first slice — validation and handoff

Date: 20 September 2026. Tracks #2; release gates #1/#8 remain open.

## Implemented

- `/garage`: own-vehicle list, add/edit form, explicit archive confirmation, archived
  list and sourced history view. Desktop/mobile layouts, loading/empty/error states.
- Six documented HTTP operations with verified session, server feature gate, strict
  validation, same-origin writes, private no-store responses and bounded pagination.
- Atomic vehicle mutation RPC: derived owner, row revision check, retry ledger,
  history and audit records. No direct client vehicle/history writes. No hard delete.
- An uncertain save retains its original key/payload and blocks further edits until
  retried. Conflict responses retain unsaved form input. No production fixtures.

No dependency versions, live environment settings or production data were changed.
The optional test runners below use temporary tooling outside the application lockfile.

## Executed locally

| Check | Result | Scope |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed | Committed application lockfile |
| `npm run lint` | Passed | Application and test source |
| `npm run typecheck` | Passed | TypeScript |
| `npm test` | 10 tests passed | 3 existing Care rules and 7 Garage domain/HTTP tests |
| `npm run build` | Passed | Production build with Garage page and API routes |
| Garage PostgreSQL runner | 26 checks passed | Both migrations executed in PGlite; two-user RLS, RPC ownership, replay/payload conflict, stale revision, archive, privilege denial, history/audit and transaction rollback |
| Garage Chromium runner | 14 checks passed | Desktop/mobile viewport, history, stale-edit input preservation, retry key/payload reuse, archive, expired-session rendering, overflow and runtime errors |

The PostgreSQL runner uses PGlite 0.5.8 with minimal Supabase auth/storage schema
stubs. It executes PostgreSQL policies and PL/pgSQL, but **does not verify hosted
Supabase, PostgREST JWT/session integration, Storage service behavior or multi-connection
concurrency**. The browser runner uses Playwright 1.63.0 and Chromium 153, with
intercepted synthetic API responses. Only the unconfigured endpoint's 503/no-store
behavior is checked against the real local server. It is **not a signed-in end-to-end
database test or a real iPhone/Safari test**.

The standard Playwright CDN timed out. An npm-distributed Chromium package
(@sparticuz/chromium 153.0.0) supplied the local executable; no browser change ships
with the app. Direct git push lacked credentials; GitHub connector publication was used.

## Reproduce optional checks

```sh
npm install --prefix /tmp/garage-validation --no-audit --no-fund @electric-sql/pglite@0.5.8 playwright@1.63.0
GARAGE_PGLITE_MODULE=/tmp/garage-validation/node_modules/@electric-sql/pglite/dist/index.js node tests/rls/garage.postgres.mjs

# With a local production server running on port 3100 and a compatible Chromium:
GARAGE_PLAYWRIGHT_MODULE=/tmp/garage-validation/node_modules/playwright/index.mjs \
GARAGE_BROWSER_PATH=/path/to/chromium node tests/e2e/garage.browser.mjs
```

Run the browser fixture suite against a **local, unconfigured** build only. Its first
check expects Garage to be disabled; it must not target a production service. Set
GARAGE_TEST_ORIGIN to change the local origin. Screenshots write to `.garage-qa/`.

## Screenshots

These show synthetic Toyota/Mazda/Honda fixtures, never customer data.

- [Desktop Garage](qa/garage-desktop.png)
- [Mobile Garage](qa/garage-mobile.png)
- [Mobile vehicle form](qa/garage-mobile-form.png)

## Blockers and next tasks

**BLOCKED BY:** no configured isolated Supabase URL/public key or authenticated test
session in this execution environment; FEATURE_GARAGE remains off.
**WHY:** local stubs/fixtures cannot prove live session, RLS, PostgREST and device flows.
**OWNER:** Backend Developer / Technical Lead for isolated integration setup and
evidence; App Developer / QA for signed-in devices.
**REQUIRED ACTION:** apply migrations to an isolated project, verify two independent
users through PostgREST, exercise replay/stale-edit races with independent sessions,
then run signed-in browser and mobile Safari journeys. Keep the release gate closed.

This PR covers the first vehicle-management slice, not all of #2. Follow-ups remain:
onboarding/session-entry and refresh integration; owner-entered odometer and reminder
APIs; vehicle-photo upload/derived background processing; real condition/membership
projections; Garage/My Jobs integration after the Care contract. API consumers must
not restore direct vehicle/history writes. Care vehicle references remain unchanged.

No deployment or live migration is claimed. PROJECT_STATUS.md must be updated after
review/merge, rather than presenting an unmerged implementation as main-branch delivery.
