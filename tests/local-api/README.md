# Genuine local API acceptance

This opt-in harness runs the built Skycar HTTP app against real Supabase Auth
(GoTrue), PostgREST, Supabase Storage and PostgreSQL. It does not intercept API
responses or replace Auth/Storage with stubs. The small gateway only forwards
requests to loopback services and strips Supabase URL prefixes.

It covers synthetic account sign-in, vehicle/request creation, private request
photos, technician linking/invitation/availability/quote, customer selection,
two overlapping HTTP booking confirmations, technician start/completion with
stored valid synthetic PNG evidence, customer review/retry and exactly-once Garage history. It
also checks amount/media references, cross-account denial, direct private
Storage denial, dual-role replay denial, revoked technician access, account
switching and sign-out.

## Prerequisites

Use a trusted disposable development computer, not a production server. Install
official distributions and verify their published checksums. The locally
verified versions were:

- PostgreSQL 17.6, with `btree_gist` installed, and its client utilities.
- [Supabase Auth v2.197.0](https://github.com/supabase/auth/releases/tag/v2.197.0),
  including its bundled migrations. Linux amd64 asset SHA-256:
  `b5c2991d1df760c9b099c1c2395a94bd1c2f83ed58901934921997179dc9f7ea`.
- [PostgREST v16.5](https://github.com/PostgREST/postgrest/releases/tag/v16.5).
  Linux static x86-64 asset SHA-256:
  `5099e7ada38f9f6846cd87c14c5f158b7c165f1e9959665ad412e61f4dceba95`.
- [Supabase Storage v1.28.0](https://github.com/supabase/storage/tree/v1.28.0),
  commit `4155c4c89d43b5ab0c9a6031b1d4fcdeabac9ddb`, installed with its
  lockfile (`npm ci`) and built (`npm run build`). This pinned release supports
  Node 24; newer Storage source may require a newer Node runtime.
- Node 24 and this repository's locked dependencies (`npm ci --ignore-scripts`).

## Run

Provide absolute paths to the installed binaries/source. No hosted URL, key,
account, email provider or database connection is accepted:

```sh
SKYCAR_LOCAL_API_TEST=1 \
SKYCAR_POSTGRES_BIN=/absolute/path/to/postgresql/bin \
SKYCAR_AUTH_BIN=/absolute/path/to/auth \
SKYCAR_POSTGREST_BIN=/absolute/path/to/postgrest \
SKYCAR_STORAGE_SOURCE=/absolute/path/to/built/storage-source \
node tests/local-api/run.mjs
```

Set `SKYCAR_LOCAL_REVIEW_MODE=issue` on a separate invocation to exercise the
customer report-an-issue path instead of confirmation (default `confirm`).
Issue mode checks invalid and cross-account reports, exact replay, changed-payload
conflict, rejection of a later confirmation, preserved issue details, and one
issue event/audit/command alongside exactly-once Garage history. Each invocation
uses a fresh database and accounts. Run both modes for both review outcomes.

The runner refuses occupied ports 3340, 55431 and 55433–55436, creates a fresh
PostgreSQL cluster/database, installs real Auth and Storage schemas followed
by all filename-ordered Skycar migrations, and launches loopback-only services.
It rejects checkout `.env` files, copies app source to the private temporary
directory, links installed dependencies and makes a fresh Webpack production
build with only generated local settings. It never reuses an existing `.next`
build or changes the checkout's build output.
It generates local-only expiring JWT keys and synthetic `example.invalid`
accounts. SMTP points only to a closed loopback port; there are no outbound
emails, payments, dispatches or hosted writes. Direct SQL is used only to
bootstrap local roles/policy and deliberately change disposable roles for
negative tests; journey operations use the real application HTTP endpoints.

The printed temporary artifact directory contains logs, the result JSON,
synthetic database/files and ephemeral credentials. Keep it private and do not
commit or upload it. Process groups are stopped after the run and on catchable SIGINT/SIGTERM.
A SIGKILL or machine failure cannot run JavaScript cleanup. No application code
or migration is changed. Inspect fixture logs before retrying a failed run;
each retry starts a new database rather than repairing a partially run test.

## Limits

A pass is local API evidence, not hosted acceptance or release approval. The
runner uses a transparent gateway rather than Kong, local HTTP rather than
TLS, a filesystem Storage backend and synthetic identities. Image transforms,
S3 protocol, queues, external delivery and OAuth are disabled. Hosted versions,
configuration, security settings, backups/recovery and permissions still need
separate validation. There is no browser or physical-device UI coverage here;
account-switch assertions concern HTTP cookies and command identity binding,
not stale rendered UI. This focused matrix does not replace the larger
PostgreSQL concurrency suite or every negative case listed in #90.

The fixture uses real time and a short future appointment window, so severely
loaded machines may need a larger fixture window; do not weaken application
validation to accommodate a slow test. Do not point production clients at this
trust-authenticated disposable local PostgreSQL cluster.
