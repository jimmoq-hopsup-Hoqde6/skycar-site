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

Account revalidation on focus, page return or an explicit retry preserves the
draft when the selected owned vehicle is still present. An access failure or a
vehicle set that no longer contains the selection clears the prior vehicle list,
draft, preferences and pending request key/body. Revalidation continues while an
idempotent attempt is in flight or uncertain. Submission success, error and
finalizer effects wait for the latest identity and vehicle-ownership validation;
an older validation that is aborted or superseded cannot release the result.
Same-owner recovery keeps the exact key and body. An account or ownership change
invalidates the old attempt, while a failed validation prevents navigation and
retains only that exact command for later reconciliation after Garage reloads.
A received malformed 4xx is definitive and unlocks the form for correction; an
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
same-account focus preservation, and one-command behavior across in-flight and
uncertain focus. Its ordering matrix independently defers the ownership GET and
submission POST to cover GET-first and POST-first completion, a superseded or
aborted validation followed by the latest check, changed-account redaction,
sign-out, and validation failure followed by exact-key/body reconciliation. It
also verifies that no stale outcome navigates or mutates a replacement account,
plus receipt navigation, mobile layout, empty Garage, malformed-4xx correction
and malformed-5xx exact retry.
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
