# Garage / Care combined database verification

Scope: integration evidence for D-006, Issue #1 and the first accepted #14
increments. This does not add a product state, deploy migrations or replace the
separate Garage and Care acceptance suites.

The combined check starts with an empty disposable PostgreSQL 17 database,
installs the same minimal auth/storage test shims used by the existing Care
suite, discovers every public migration and applies them in filename order. It
fails if the expected migration set changes without updating this acceptance
boundary.

It then verifies the integrated behavior that the separate feature suites could
not prove:

- an owner creates a Garage vehicle and uses that exact ID for Care submit,
  detail and My Jobs list;
- another account cannot read/mutate that vehicle or Care request;
- Garage history, Care events, audit records and notification intents are
  written once across exact retries;
- authenticated clients cannot bypass either module with direct vehicle,
  history, request or event writes;
- archiving retains authorised Care detail/list history, rejects new intake and
  keeps an exact prior submission retry safe;
- deliberately failing Garage audit or Care outbox writes rolls back the whole
  corresponding mutation;
- independent transactions exercise both orderings of archive versus new Care
  intake and archive versus no-match recovery. The row lock winner determines
  whether the Care action commits before archive or fails honestly after it;
  no partial command/event is left behind.

Reproduce in a fresh local PostgreSQL database named
`skycar_integration_test`:

```sh
GARAGE_CARE_TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/skycar_integration_test \
  node --test tests/integration/garage-care-db.test.mjs
```

Safety and evidence limits: the script rejects non-local hosts and any other
database name. The auth/storage objects are minimal SQL shims. Passing this
suite is not hosted Supabase, PostgREST, private-media, signed-in browser/device,
backup/restore or production evidence. No response time, provider, price,
payment or deployment configuration is selected by the test.

Source boundary: only this public repository's migrations and contracts are
used. The separate private pilot is not synchronized, imported or counted as
verification.
