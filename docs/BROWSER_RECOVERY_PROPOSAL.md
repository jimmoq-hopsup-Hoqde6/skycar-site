# Browser-accessible staging recovery proposal

Status: DRAFT FOR INDEPENDENT REVIEW, 26 September 2026. This document is
a proposal, not an execution authorisation or amendment to
[STAGING_BACKUP_EXECUTION.md](STAGING_BACKUP_EXECUTION.md).
It addresses the owner's phone/iPad-only access. A personal desktop is not required.
No host, account subscription, real recovery key or archive has been created.

## Scope and frozen inputs

Assignment: [#8 comment 5846675384](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5846675384).
The existing sole Backend/DevOps executor owns this one-file proposal.
Independent review and the CEO delivery delegate control the next handoff.

| Item | Immutable reference |
| --- | --- |
| Accepted operations source | cf90135793fcae4527dc0f566ae5d0c3f27fff59 |
| Main registration / this proposal base | 7912bc9c3375b713fa2e879ba66387d5a8f79feb |
| Installed operations | 49c84fa540c95f9ba51a7c61f928a32b455ae8d1 |
| Application candidate PR #35 | 821125df9556225b4d34ff1aec4072c2d789b4cf |
| Staging packet PR #33 | 88ee9b9fede109db42891aee83c22aad07729c5e |

Connection metadata was saved and verified by administrator handoff
[#12 comment 5846589239](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/12#issuecomment-5846589239).
Do not repeat metadata/password-reset requests. Presence is not connection success.
No application, migration, workflow, script, pin, branch protection or environment
change belongs in this proposal.

## Candidate and approval envelope

Propose one temporary owner-controlled DigitalOcean Basic Regular VM:
Ubuntu 24.04 LTS x86-64, 4 GiB RAM, 2 vCPU, 80 GiB root disk. Its public management
address is needed for the documented browser console; do not select a Private
Droplet without a separately designed management route.
The proposed size is conservative, not measured capacity acceptance.

| Component | Proposed amount / lifecycle |
| --- | --- |
| Basic Regular VM | US$0.03571/hour, US$24 monthly maximum for this specific plan; 24 hours about US$0.86 |
| Spaces Standard private ciphertext archive | US$5 monthly base; remain within included 250 GiB and 1 TiB outbound transfer |
| Separate owner Bitwarden Free vault | US$0 candidate; PEM text in a private secure note, no paid attachment dependency |
| First-month approval ceiling to present | US$35 equivalent INCLUDING provider taxes, excluding bank FX fees; not approved and not a technical billing cap |

Nominal persistent VM plus archive is US$29 before tax. At an illustrative 10%
tax it is US$31.90. Checkout currency/tax and any existing-account charges must be
verified before presenting the concrete activation decision. Reject substitutions,
overages, snapshots, automatic VM backups, volumes, paid vault or uncapped v5 plans.
Do not represent budget alerts as an enforced limit.

Compute authority, if granted later, should expire after one 24-hour setup/recovery
session; destroy compute earlier on success or abandonment. A powered-off VM still
incurs charges. Archive retention proposed: 30 days, with an owner decision before
renewal or deletion. Do not automatically delete the only accepted restore point.
A later recovery session needs separate compute approval; estimate the same
24-hour compute allowance plus then-current archive/tax charges. A reviewer must
accept a retention extension before the last copy expires.

Prices and console prerequisites checked against official sources on 26 September:
[VM pricing](https://www.digitalocean.com/pricing/droplets),
[Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/),
[console](https://docs.digitalocean.com/products/droplets/how-to/connect-with-console/),
[destruction](https://docs.digitalocean.com/products/droplets/how-to/destroy/),
[free vault](https://bitwarden.com/products/personal/).
These are prospective resources; no account availability or checkout is verified.

## Alternatives and outstanding purchase condition

First prefer an existing owner-controlled machine, private archive service and
encrypted vault if independently evidenced as satisfying this packet. None is
currently established. The existing application/database hosts do not establish a
recovery workstation. Codespaces is not an accepted substitute for real key custody:
the current contract keeps private keys out of GitHub. A managed Supabase restore
may be assessed separately but does not itself validate this encrypted archive's
decryption or independent custody. No paid upgrade or new database is proposed here.
Paid hosting is a candidate, not proven to be the only solution.

No existing test VM is available in current evidence. Physical iPad browser-console
and transfer demonstrations are UNAVAILABLE BEFORE PURCHASE. This is a gate, not
permission to purchase a VM to make the demonstration possible. Delegate must resolve
it through an existing suitable demonstration facility or return a specifically
reviewed limited trial proposal for owner approval, acknowledging the usability risk.

## Toolchain and database bootstrap

| Component | Proposed pin / evidence |
| --- | --- |
| OS | Ubuntu 24.04 LTS x86-64; record exact provider image ID and package versions before execution |
| Node | 24.19.0 proposed to match recorded independent review; verify official distribution checksum before use |
| Supabase CLI | 2.117.0, installed from accepted ops package-lock with npm ci |
| Synthetic database | PostgreSQL server/client 17.6, matching accepted CI fixture |
| Actual managed baseline | Hosted version recorded 17.6.1.166; matching bootstrap artifact/digest NOT YET VERIFIED |
| Recovery helper | unchanged decrypt.mjs and backup.mjs from accepted operations SHA |

A generic postgres:17.6 instance and the CI fixture's minimal auth/storage tables
are only a synthetic test. The CLI excludes managed schema definitions; the real
archive cannot be declared restorable solely because that fixture passes.
The actual disposable target needs the matching managed roles, Auth/Storage tables,
functions, extensions, grants and relevant bootstrap migrations. Before real use,
the executor must inventory these prerequisites read-only, resolve a verifiable
Supabase bootstrap release/image plus digest and migration versions, and return that
manifest for independent acceptance. Do not infer equivalence from PostgreSQL major
17 alone, invent an image digest, or modify exported SQL to suppress errors.
This unresolved bootstrap manifest makes this draft NOT EXECUTION READY.

Restore strictly into a disposable local target in roles → schema → data order,
with psql -X and ON_ERROR_STOP=1, using the accepted packet. Capture errors privately;
a missing role/schema/extension or permission failure is a stop condition. Review
the cause before a correction; do not keep restoring into a partially failed target.
Never use the hosted staging database as a rehearsal destination.
[Official restore prerequisites](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Isolation and private handling

Use a non-root recovery account with mode-0700 workspace and umask 077.
Use administrative privilege only for verified tool installation and resource limits.
PostgreSQL listens only on loopback or a Unix socket, with no public listener,
port forwarding or database firewall ingress. Restrict management ingress to the
documented console requirements and explicitly authorised owner access; verify the
console still works with those rules. Do not guess provider source ranges.

Disable shell tracing, history, terminal/session recording and diagnostic uploads
before secret handling. Never use a model-visible terminal/screenshot for real key
material or plaintext SQL. Owner MFA and provider/vault recovery must remain usable
from the iPad if the VM is lost. Provider console and hypervisor access remain trust
dependencies; this design does not hide in-use secrets from the hosting provider.
Record this risk for the owner before any activation.

The staging database password and connection secrets stay in protected GitHub
Actions. They never go to this VM. Do not grant the recovery VM production or
staging database network access. Only ciphertext is transferred from the capture path.

## Owner-only key ceremony and iPad transfer

Perform this only after the revised packet, host activation and private transfer
mechanism are accepted. Generate/select RSA at least 3072 bits on the approved host,
not this chat runtime or Actions. Store an encrypted private PEM in the separate
owner-only vault secure note; keep its passphrase under the owner's independent
recovery control. Do not put the passphrase in shell arguments, environment variables,
GitHub, chat or a console transcript. Only public SPKI PEM and its lowercase SHA-256
DER fingerprint may enter the staging environment.

Proposed private transfer mechanism: owner-operated SSH/SFTP client on iPad, with
host-key fingerprint verified out of band against provider records/console,
key-based authentication and a restricted SSH route. This is a candidate transport;
the particular iPad client, zero-cost availability and vault-to-file round trip
remain UNVERIFIED. Browser console alone is not accepted file-transfer proof.
No public web server, public bucket URL or key pasted into an echoed shell command.
An alternative private browser transfer route requires a separately verified design.

First use a disposable synthetic key: transfer the encrypted PEM to owner iPad
storage, save it as a vault secure note, remove the local test copy, retrieve it
again, transfer it privately back and compare exact-byte checksum plus public-key
fingerprint. Keep private content off recording/screen sharing and purge clipboard
and downloaded test copies. Only after this round trip passes may a real key use
the same route. An uploaded key alone does not establish owner custody.
[Vault encryption](https://bitwarden.com/help/vault-data/).

The existing helper does not accept an encrypted-PEM passphrase option. The owner
must privately unlock the encrypted key into mode-0600 volatile storage (mode-0700
tmpfs directory, no swap exposure) before invoking the unchanged helper. Use the
tool's interactive passphrase prompt outside model observation; do not invent helper
options. Remove that temporary unencrypted key after decryption.

## Synthetic capacity procedure and actual result

Actual result on 26 September: NOT RUN. Runtime inspection found Node but neither
psql nor Docker; no no-cost PostgreSQL recovery facility was established.
Peak combined memory, disk and elapsed recovery time are UNKNOWN.
The six green installed-revision workflows are prior synthetic correctness evidence,
not a 4-GiB capacity measurement. No new paid resource was created to fill the gap.

Reproducible plan for a reviewer-approved no-cost Linux facility:

1. Obtain the accepted source at cf90135793fcae4527dc0f566ae5d0c3f27fff59 in a
   disposable workspace; verify exact revision and lockfile. Install the table's
   toolchain, recording versions and checksums.
2. Put the PostgreSQL server AND Node/test descendants into ONE cgroup v2 unit
   with MemoryMax=4294967296, MemorySwapMax=0 and CPUQuota=200%. Do not use only
   --max-old-space-size or separately allocate 4 GiB to each process. Include the
   database server in the unit's process tree; if accounting/control cannot be
   verified, report capacity NOT RUN.
3. Initialise a disposable PG17.6 cluster, loopback 127.0.0.1:5432, with only
   synthetic-ci-only credentials. Start it within that unit. In the accepted tree run:
   npm ci --prefix ops/staging-backup --no-audit --no-fund
   and SKYCAR_BACKUP_POSTGRES_TEST=1 node --test tests/ops/staging-backup-postgres.test.mjs.
   This fixture creates skycar_fixture and skycar_restore, exports, encrypts,
   decrypts and asserts the synthetic sentinel after restore.
4. Record the whole unit's memory.peak, memory.events (including oom/oom_kill),
   elapsed time, baseline/end/peak workspace and PG-data bytes. Sample disk usage
   during execution rather than substituting final disk usage for peak.
   Record image/tool versions, command exit, test skip count and assertion result.
5. Separately exercise the unchanged encryptBundle/decryptBundle with deterministic
   synthetic SQL bundles at small and near accepted size limits. Record logical,
   base64 JSON, compressed/envelope and restored sizes. Use valid SQL for the
   restore test; random bytes alone test crypto capacity only. An ephemeral
   synthetic RSA key is not real recovery custody and must never be configured
   into the staging environment.
6. Proposed pass: no skipped fixture, exact restored sentinel/hashes, no OOM,
   memory peak below 3 GiB (1 GiB reserve), and peak temporary storage below 20 GiB.
   Failure returns measured evidence for review rather than buying a bigger VM.
   A tiny fixture pass cannot establish worst-case 160-MiB decompression capacity.
7. Run the same complete measurement with the accepted managed bootstrap before
   real archive acceptance. This additional run is mandatory even if the synthetic
   stand-in fixture passes.

The aggregate cgroup/setup harness and matching managed-bootstrap manifest still
need to be executed/verified on a suitable facility; these steps are a test
specification, not claimed tested shell automation. No change to CI is authorised
by this one-file proposal.

## Archive retention and VM-loss rehearsal

Propose a private Spaces bucket, no CDN/public ACL, containing encrypted archive
and redacted manifest only. The private key belongs to the independent vault,
not the bucket/provider account. Verify unauthenticated access is denied.
Transfer ciphertext from the approved Actions artifact before its seven-day expiry;
verify SHA-256 before upload and after authenticated re-download. Use a temporary
bucket-scoped credential with minimum permissions, privately provisioned and revoked
after the session. An owner-only dashboard transfer is acceptable if demonstrated.
Do not claim object retention or access protection from configuration intent alone.

Before real keys, rehearse VM loss using only synthetic data:

1. Complete the vault/key round trip and privately retain synthetic ciphertext.
2. Make the first workspace unavailable. Use a fresh disposable workspace with
   no cached key, archive or storage credentials; on an existing host this tests
   workspace loss only. Do not label it complete provider/VM loss until owner
   account recovery and fresh-host access also work.
3. Recover the key from the independent vault and ciphertext from private durable
   storage through the validated iPad route. Compare retained checksum and public
   fingerprint, then decrypt with the unchanged full-tag helper.
4. Restore roles/schema/data into the isolated target and assert the sentinel.
   For the actual archive, validate the empty-baseline inventory and managed
   prerequisites; record full-tag decryption and each restore exit separately.
5. Report only hashes, versions, redacted storage/custodian acknowledgement and
   pass/fail. A decryption PASS alone is never a database-recovery PASS.

## Physical iPad acceptance and finite cleanup

Owner tests on the actual iPad and iPadOS/Safari version: provider and vault MFA,
open console, type/paste a harmless command, disconnect/reconnect, private synthetic
file/key transfer, vault retrieval and clean-workspace recovery. Record input,
clipboard/download restrictions and pass/fail without secrets or account screenshots.
All physical-iPad results are NOT RUN. Browser emulation cannot satisfy this gate.

After accepted private archive/key retention and recovery, stop database processes;
remove the exact disposable plaintext workspace, temporary keys and credentials,
revoke temporary access and destroy the authorised VM. Confirm destruction and
billing/resource state in the provider, including absence of snapshots/volumes.
Deletion of the VM is not a claim of forensic secure erasure. Do not delete the
separate vault key or durable encrypted restore point during compute cleanup.
On failure, stop before the 24-hour limit and escalate with a redacted cause;
do not retain sensitive disk snapshots as a shortcut.

## Review handoff and completion gate

Independent reviewer must assess this exact document revision. Outstanding evidence:
aggregate capacity/managed-bootstrap compatibility, named private iPad transfer
route, actual device demonstration, owner key/archive custody and checkout-inclusive
cost. No definitive all-in charge or device compatibility is asserted.

Only after those gates and explicit owner activation approval may configuration
proceed. The unchanged protected backup workflow still requires its legitimate
exact-run environment approval. Actual capture, private retention, full-tag
decryption and authorised disposable restore must then pass before migrations or
the frozen application deployment. Phone-test URL and hosted acceptance remain
NOT RUN. Main/production protection and existing sole-executor ownership persist.
