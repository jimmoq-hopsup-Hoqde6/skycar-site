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
