# Issue 66: completion-review replay and concurrency correction

20 October 2026. Developer 1 backend/security continuation. Base PR #69 exact
7609b9bc6e121a78b5634b89c0b41901158a90e1. Original branch remains unchanged;
correction branch is fix/issue-66-replay-concurrency.

## Reproduced and corrected

PR #69 returns an existing successful result before checking its new vehicle
archive/source-request locks. A customer can confirm, archive the vehicle, then
replay the same key and still receive success despite current-source denial for
new commands. The added archive/replay assertion fails on #69 with
`Missing expected rejection: NOT_FOUND`.

The new forward migration moves current vehicle/request authority ahead of
idempotent result return. It preserves actor/key → vehicle → request → journey
lock order, and rechecks current customer/privileged roles after a possible lock
wait. A replay after revoked authority is denied, while a normal unchanged retry
returns the same saved result without another event/audit/history mutation.
Existing role exclusions, guest capability behavior and final-outcome semantics
are retained. No archived/frozen migration is rewritten.

Migration was created using Supabase CLI migration new. Its CLI timestamp was
earlier than #69's existing future-dated 20261020183000 predecessor. The generated
file is explicitly allocated the next ordered version 20261020183001 so it runs
after that predecessor. This is ordering metadata, not a claim of execution at
that clock time. Only the disposable combined migration inventory is extended.

## Tests

- Regression reproduced before correction in PGlite 0.5.8 with the full migration
  set and disposable repository auth/storage shims.
- After correction: 63 non-concurrent customer-review SQL assertions pass in
  PGlite, including archive replay denial, normal replay, role removal, both
  privileged roles for confirm/issue replay and source transfer denial.
- npm run check: lint, typecheck, 205 unit tests and production build pass.
- Focused integration-file lint and git diff --check pass.

Real multi-connection tests are registered in the existing combined PostgreSQL
suite, which runs automatically for PR head and integration revisions:

- customer quote-selection versus completion-review with one shared key and
  vehicle, both first-writer orders; loser must conflict with exactly one command;
- a blocked successful-result replay while another connection grants a
  technician role, archives the vehicle or changes request ownership;
- observable PostgreSQL PgSleep/Lock barriers ensure the intended overlap;
- original customer/guest authority, dual-role denial, changed-input conflict,
  audit rollback and confirm-versus-issue race coverage remains in place.

No local real PostgreSQL concurrency pass is claimed. Remote CI must verify the
new cases, and an independent reviewer must assess the exact resulting revision.
Successful embedded tests do not establish hosted JWT/storage/device acceptance.

## Release boundaries

This fixes a bounded #66 implementation gap and adds its missing tests. It does
not close #66 or approve #69. No UI, payment, availability, shared provider,
role grant, secret, environment, protected control, hosted migration or manual
deployment is changed. Publication may trigger the existing automatic PR preview.
Existing sole DevOps executor under #8 retains staging/recovery/deployment;
independent security acceptance and #8 hosted/device release gates still apply.
