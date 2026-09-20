# Authenticated service-first Care entry

Issue #18's first bounded UI slice routes customers from an immediate repair or
cleaning need into the existing durable Care request contract. The public home,
Garage and My Jobs link to `/care/request`. An authenticated customer selects an
active vehicle already owned in Garage, chooses repair or cleaning, describes the
need and provides a timing preference.

Submission sends only the four fields published in `CARE_API.md` and one UUID
idempotency key. A transient or uncertain response locks the form and reuses the
exact key and body. A verified receipt navigates to `/care/requests/:id`. Archived
vehicles are excluded and no second vehicle ownership model is created.

Account revalidation on focus, page return or an explicit retry first clears the
prior account's vehicle list, draft, preferences and pending request key/body. A
received malformed 4xx is definitive and unlocks the form for correction; an
unreadable 5xx or network failure remains uncertain and preserves the exact
idempotent attempt.

## Honest boundary

This slice does not claim coverage, pricing, a technician, appointment or payment.
It does not implement new-user vehicle creation, private photo upload, Sale-Ready,
AI estimation or provider activation. Those need their own accepted contracts and
release evidence. A preferred window is visibly labelled as a preference only.

## Acceptance evidence

After `npm run build`, run the intercepted-fixture browser scenario:

```sh
PLAYWRIGHT_MODULE=<playwright-index.js> CHROMIUM_PATH=<chromium-binary> node tests/ui/care-entry.mjs
```

The fixture contains no customer data. It verifies the public entry link, active
vehicle selection, exact request payload, same-key/same-body uncertain retry,
receipt navigation, mobile layout, empty Garage, populated-draft redaction across
an account change, malformed-4xx correction and malformed-5xx exact retry.
Screenshots are synthetic UI evidence—not hosted Supabase, real sign-in, physical
device or production deployment evidence.

## Executed locally, 21 September 2026

- `npm run lint`, `npm run typecheck` and all 48 unit/API tests passed.
- The production build passed and generated `/care/request`.
- The built Care routes failed closed without activation/configuration.
- The Chromium scenario above passed every listed journey and `git diff --check`
  passed. All three generated images were visually inspected:
  - [Desktop request form](qa/care-entry/desktop-request.png)
  - [Mobile uncertain same-request recovery](qa/care-entry/mobile-uncertain-retry.png)
  - [Mobile session-required state](qa/care-entry/mobile-session-required.png)

No schema, migration, runtime dependency or environment variable is added.
