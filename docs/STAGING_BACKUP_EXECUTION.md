# Protected pre-migration staging backup

This is an operations-only installation proposal, not permission to merge, deploy,
migrate, change environment rules, or execute an unreviewed workflow. It is for the
existing isolated **empty** staging project only. Application candidate remains
`821125df9556225b4d34ff1aec4072c2d789b4cf` (PR #35). The application is not checked
out or deployed by this workflow. Production, Pages and the private pilot are out
of scope. The saved database password is not yet a tested connection.

## Installation and approval gates

GitHub requires a manually dispatched workflow to exist on the default branch.
The environment permits only `fix/phone-test-delivery`. Consequently this PR alone
is not executable. Installation must follow all these steps:

1. Independent Technical Lead review of the exact operations PR revision and its
   head/integration checks. Obtain existing main merge and Pages release gates;
   do not disable them. This PR does not change the existing main CI or Pages
   workflow. A main merge can run existing publishing jobs and is not authorised
   simply because these files are operations-only.
2. With those gates satisfied, register these operations files on main through
   the reviewed merge. Do not merge the application stack merely to register a
   workflow. Do not use privileged PR triggers or a dispatch workaround.
3. Obtain a separate bounded installation assignment/review for **identical
   operations files only** on the already allowed execution branch. That branch
   currently backs frozen PR #31: do not edit it until explicitly released for
   this installation. Do not broaden the environment branch allowlist. Record
   the resulting immutable operations commit, verify app files were unchanged,
   and pin that SHA in `STAGING_BACKUP_APPROVED_WORKFLOW_SHA`.
4. Administrator verifies the existing isolated connection metadata, approved
   application SHA, owner-controlled encryption public key/fingerprint, and
   private recovery custody below. Retain required owner approval, disabled
   admin bypass and all production/main/Pages protections. No paid services.
5. Dispatch `staging-backup.yml` on the allowed branch with the exact application
   SHA as `revision` and `ISOLATED-STAGING-BACKUP-ONLY` as confirmation. The owner
   reviews the exact operations commit before approving this environment job.
   Workflow SHA, event SHA and actual checkout must match the approved operations
   SHA. A changed branch must fail closed until independently accepted and repinned.

The password is never retrievable by this chat runtime. Only the approved capture
step receives it. Do not retrieve or print it, enable debug logging, add shell
tracing, or rerun with debug enabled. No `pull_request_target`, `workflow_run`,
provider activation, auto-approval or automatic deployment path is introduced.

## Protected environment contract

All values belong only to the existing `skycar-staging` environment. Connection
metadata is stored as secrets to avoid routine Actions environment logging.
Copy it from the authenticated existing project's **Session pooler** connection
screen; do not invent region/host/ref or use a transaction pooler.

| Kind | Name | Requirement |
| --- | --- | --- |
| Existing secret | `STAGING_SUPABASE_DB_PASSWORD` | Marcel's saved database password; do not reset or duplicate requests |
| Secret | `STAGING_SUPABASE_PROJECT_REF` | Administrator-verified existing isolated project ref |
| Secret | `STAGING_SUPABASE_DB_HOST` | Its session pooler `aws-…pooler.supabase.com` hostname |
| Secret | `STAGING_SUPABASE_DB_USER` | `postgres.` followed by that exact project ref |
| Variable | `STAGING_SUPABASE_DB_PORT` | `5432` |
| Variable | `STAGING_ISOLATION_MARKER` | `skycar-v2-isolated-staging` |
| Variable | `STAGING_APPROVED_REVISION` | Exact application SHA above |
| Variable | `STAGING_BACKUP_APPROVED_WORKFLOW_SHA` | Independently reviewed, installed operations commit on the allowed branch |
| Variable | `STAGING_BACKUP_PUBLIC_KEY` | Owner-held RSA public key in SPKI PEM, at least 3072 bits |
| Variable | `STAGING_BACKUP_KEY_SHA256` | Lowercase SHA-256 of that key's SPKI DER bytes |

Only password presence has been verified in the prior handoff. This PR does not
claim the other values are configured. Verify the supplied public key fingerprint
against the owner's retained key before approving any export. On an owner's
private recovery workstation, an example key setup is:

```sh
umask 077
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out staging-backup-private.pem
openssl pkey -in staging-backup-private.pem -pubout -out staging-backup-public.pem
openssl pkey -pubin -in staging-backup-public.pem -outform DER | openssl dgst -sha256
```

The private key must remain in owner-controlled encrypted storage/password
manager, separate from the archive, never in GitHub, Actions, chat or public logs.
Do not run this key-generation example in a public Actions job. The private key is
needed to recover a backup; losing it makes the ciphertext unusable.

## Capture behavior and limitations

Locked Supabase CLI `2.117.0` generates its official roles/schema/data dump
commands using `--dry-run` and a credential-free localhost placeholder; its five
known connection exports are strictly checked and removed. Real connection
values are supplied only through the database subprocess environment, never
interpolated into shell or passed to the CLI. The generated script is captured
privately, never printed. It runs with PostgreSQL 17 client tools on the runner. This
local execution deliberately retains `PGSSLMODE=verify-full`, the system CA trust
store, connection timeout and read-only session options; the CLI's generated
script otherwise does not propagate the database URL's TLS options. Invalid TLS,
host, user/ref, revision, missing config, unexpected baseline or any command
failure aborts without an artifact. Do not relax TLS to recover a failed run.

Before and after capture, read-only checks require PostgreSQL 17, no public base
tables, no Auth users, no storage buckets/objects, and no applied migration
history. This is strictly the first empty-project restore point, not a general
backup service. Missing managed schemas or unexpected state also fail closed.
Keep other database writers/migration executors stopped for the entire capture;
three exports are not a shared cross-file snapshot. Concurrency serialises these
backup jobs only, not dashboard users or other workflows.

The inventory is `roles.sql`, `schema.sql`, `data.sql`, with documented vector
table exclusions. The CLI's schema filters omit Supabase-managed schemas and
migration history. Storage object bytes are **not** included. The empty-baseline
check prevents treating this workflow as a complete backup of a populated
project. Future populated backups need a separate reviewed contract; do not
reuse this export design as comprehensive disaster recovery.

Each successful export is bundled with per-file hashes, application/operations
revisions, timestamp and `restoreStatus: NOT_RUN`. A fresh AES-256-GCM key encrypts
the compressed bundle; RSA-OAEP-SHA256 wraps that key using the approved public
key. Header metadata is authenticated. Only `backup.enc.json` is uploaded; no
SQL, private key, connection string or raw subprocess errors. Temporary SQL is
removed on handled success/failure; runner-local plaintext exists during capture.
Abrupt runner termination relies on disposal of the hosted runner, not a secure
erase guarantee. The size/time caps intentionally reject unexpectedly large data.

## Private retention and recovery acceptance

The repository is public: treat artifact accessibility as untrusted. Encryption
is required even if download currently requires authentication. The encrypted
artifact expires after **7 days**. The administrator must download it into
owner-controlled private durable storage, record its checksum and key custody,
and verify decryption before any migration. A transient Actions artifact alone
is not the accepted durable restore point. Only redacted custody/checksum,
run ID, exact operations/application revisions and pass/fail belong in #8.

Use the reviewed helper only on that private recovery workstation:

```sh
umask 077
node ops/staging-backup/decrypt.mjs backup.enc.json staging-backup-private.pem recovered-backup
```

It verifies authenticated encryption and all three file hashes, then creates a
new mode-0700 directory with mode-0600 SQL files. Do not upload the decrypted
directory. Successful decryption is **not** a database restore rehearsal.

Follow the already reviewed recovery packet and Supabase's restore prerequisites
for an authorised disposable local equivalent: managed Auth/Storage schemas must
already exist; restore roles, schema, then data with `ON_ERROR_STOP=1`. Never run
a restore against the hosted target, live site or private pilot as a test. No new
hosted resource or paid restore plan is authorised here. Record the actual
rehearsal result and limitations before the first hosted migration. Failed
decryption/restore means stop; retain the empty existing staging database.

After the privately retained restore point and recovery evidence are accepted,
resume the existing six-migration packet at exact application `821125d`, followed
by hosted A/B ownership/RLS, private-photo API, retry, protected origin and mobile
acceptance. This workflow performs none of those steps. No physical-phone result
is implied by browser emulation or disposable CI recovery.

## Verification evidence categories

- `staging-backup-tests.yml` tests exact PR head and main integration candidate
  without environment secrets. Unit tests cover rejection, encryption integrity,
  cleanup and failure redaction. Disposable PostgreSQL 17 tests execute actual
  pinned-CLI generated dumps and restore synthetic data, plus baseline rejection.
- The local runtime may lack PostgreSQL/Docker; a skipped local fixture is not a
  pass. CI fixture success is not hosted credential/TLS/backup evidence.
- Hosted connection, actual encrypted backup, private retention/decryption,
  actual-baseline restore, migrations, deployment and hosted/physical-phone
  acceptance remain **NOT RUN** until separately evidenced.

References: [Supabase backups](https://supabase.com/docs/guides/platform/backups),
[Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[GitHub manual dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
