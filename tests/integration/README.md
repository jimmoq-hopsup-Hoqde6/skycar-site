# Care PostgreSQL acceptance

Run against a **fresh, disposable local PostgreSQL 17 database** named
`skycar_test`, using a superuser only for test bootstrap:

```
CARE_TEST_DATABASE_URL=postgresql://postgres:disposable_test_only@localhost:5432/skycar_test node --test tests/integration/care-db.test.mjs
```

Requires `psql` and Node 24. The runner refuses non-local URLs and any database
name other than `skycar_test`; it also refuses a non-empty public schema.
Never point these fixtures at a Supabase project or a customer database.

The suite applies the foundation, Care receipt and My Jobs list migrations,
supplies minimal auth/storage schema shims,
then executes the actual PostgreSQL functions, grants, row-level policies,
rollback and concurrent writes. SQL assertions run under authenticated, anon,
service_role and bootstrap roles. The concurrency cases use separate psql
connections and overlapping transactions. The CI service is isolated and
discarded at job completion; no deployment secrets are needed.

My Jobs assertions cover both ownership checks, archived history, strict list
arguments, stable keyset order including equal timestamps and microseconds,
updates/new arrivals between pages, honest overdue/no-match summaries and no
read side effects. Application query/cursor tests additionally exercise filter
binding and malformed tokens. List responses are current per-page reads, not a
frozen multi-page snapshot.

This does not prove Supabase JWT verification, hosted Storage isolation,
notification delivery, scheduled deadline monitoring or browser behaviour.
Those remain distinct integration/release gates in #1/#8.

## Combined Garage/Care acceptance and legacy sunset

The full 27-migration suite uses a separate **fresh local PostgreSQL 17 database**
named `skycar_integration_test`:

```
GARAGE_CARE_TEST_DATABASE_URL=postgresql://postgres:disposable_test_only@127.0.0.1:5432/skycar_integration_test node --test tests/integration/garage-care-db.test.mjs
```

The bootstrap also creates cluster-wide API roles. Use a fresh disposable cluster
for each run, not just a new database in an already bootstrapped cluster.

The legacy-create hard cap stays **2026-11-21T13:30:00Z**. Coverage tests must pass
both before and after that wall-clock date without skipping the open-window
cases. `legacy-sunset-test-clock.mjs` temporarily instruments only the two sunset
decision clock expressions in the installed `care_submit_request` definition:
its initial fast refusal and its post-lock increment. It does not replace the
production predicate, cap, CHECK, grants, security mode, lock statements, or
request/event timestamps. The installed submit and predicate bodies must match
the production migration exactly before instrumentation. Missing, repeated or
already instrumented clock sites fail rather than silently changing the seam.

The private, API-inaccessible clock is a VOLATILE SQL function reading a test
row. This lets another session advance it after `pg_stat_activity` proves a
creator is waiting for the audit row. Every run tests:

- Successful legacy creation one microsecond before the real cap, with telemetry.
- Rejection exactly at and one microsecond after the cap, plus preserved replay,
  in-area creation and out-of-area rejection.
- An audit wait crossing an earlier stored deadline and the actual hard cap,
  with no persisted request, command, event, outbox or audit effects.
- An independently committed early-close while the creator waits. The original
  STABLE predicate must see that update in the later post-lock SQL statement.
- Postcode creation and early-close updates do not wait for the audit row.

The fixture settles pending sessions and restores the original function in a
`finally` block. It compares the restored definition and security metadata,
checks the predicate and CHECK are unchanged, and removes/checks for test-clock
residue. The rest of the combined suite runs the uninstrumented production
function and uses postcode-bearing payloads. The earlier `care-db.test.mjs`
intentionally tests only the first three migrations, before any sunset exists.

This is a test-clock seam, not whole-system time travel: it proves the sunset
branch's real predicates and concurrent SQL behavior at controlled instants.
It does not simulate every timestamp in PostgreSQL or change the system clock.

### Optional negative controls

On another **fresh disposable cluster/database**, run:

```
GARAGE_CARE_TEST_DATABASE_URL=postgresql://postgres:disposable_test_only@127.0.0.1:5432/skycar_integration_test node --test tests/integration/legacy-sunset-mutation.test.mjs
```

This applies the actual migrations, validates/installs the seam, then deliberately
breaks only the disposable installed submit function. It checks that the real
regression rejects (1) a missing post-lock predicate and (2) a switch boolean
cached before waiting, with deadline checks retained. Each negative control
requires the specific incorrect *successful waiter* outcome, so a timeout,
source-verification failure or unrelated SQL error cannot count as proof.
The original function is restored after each mutation. No application code or
migration is modified by these tests.
