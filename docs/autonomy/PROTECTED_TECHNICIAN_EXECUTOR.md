# Protected technician executor — issue #120

This implementation connects the existing bounded coding engine to one reviewed
technician task, durable reservations, independent container validation and draft
PR creation. It is **manual and disabled until configured**. No schedule, issue
poller, nine-agent activation, merge, review approval or production promotion is
added. A successful offline test is not evidence of a live coding run.

## Exact first task

`technician-command-account-v1` implements a narrow part of issue #101: require a
command response account to match the `x-skycar-account` precondition before
accepting successful quote, decline, start or completion data. The fixed trusted
acceptance reproduces four cross-account failures on the current baseline and
checks four corresponding successful same-account responses.

The model receives eight committed UTF-8 files (at most 64,000 bytes each) at the
exact approved current-main SHA. Only these two paths may be returned, both as
complete files in an artifact limited to 160,000 bytes:

* `src/server/technician/http.mjs`
* `tests/unit/technician-commands.test.mjs`

Before inference, preflight checks the production baseline against a reviewed SHA-256.
Before any candidate execution and again in the publisher, the complete production
file must equal that baseline with exactly one insertion:
`requireTechnicianAccount(result.account,expectedAccount);` before result decoding.
No other production edits or formatting changes are accepted. This fixed-task
restriction prevents candidate code from replacing JSON serialization, stdout or
observation globals to forge probe evidence. The in-process probe alone cannot
prove arbitrary generated JavaScript safe. A new baseline or broader task requires
a new independently reviewed task definition; the policy never refreshes itself.
Generated tests remain untrusted and run only in the isolated unit container.

Six read-only dependency paths, the task prompt and test command are fixed in
`scripts/autonomy/technician_tasks.py`. Issue bodies never become prompts,
commands or path selectors. Issue #101 must remain open and carry both
`agent-approved` and `skycar-task:technician-command-account-v1`. Protected-work
labels block execution. Adding those labels is an operational approval after the
manifest and executor pass independent review; this change does not add them.

## Boundaries and spending

The controller uses separate credentials for coding, read-only organization
billing verification and draft publication. None enters the hosted model
environment. The model has no network, GitHub tools, delegated agents, credentials
or repository write access. Untrusted code runs only in a separate validation job:
pinned Node image, read-only mounts/root, non-root user, no network, no Linux
capabilities, no new privileges, bounded memory/CPU/processes/time/log output.
Only the eight source files and a read-only response adapter are mounted. A
trusted Python supervisor outside candidate execution generates fresh cases and
asserts all eight same-account/cross-account responses, repository-call arguments,
private headers and result bodies. An early successful process exit, missing
response, skipped case or forged TAP/summary cannot stand in for these assertions.
The unit suite also runs in isolation, as supporting evidence. Receipt version 2
requires the external supervisor and all eight completed acceptance cases; old
exit-status-only receipts cannot authorize publication. Each container is removed
and a successful daemon query must confirm its absence before validation proceeds.
The publisher checks evidence without importing or executing candidate code.

## Generated-branch build security

Every repository workflow job excludes `agent/` branches, including pull requests
whose **head** has that prefix. `vercel.json` disables automatic deployments for
`agent/**` using Vercel's documented minimatch branch setting. The generated files
cannot modify either control. Normal feature-branch CI still runs; a generated
draft needs full application CI on an independently reviewed branch before merge.

`generated-build-policy.json` pins the exact file set and SHA-256 of every
workflow and `vercel.json`. The controller reads committed files at the approved
SHA, checks the job exclusions and Vercel policy, and rejects new/changed/missing
workflows. Intentional build configuration changes require a reviewed policy
update, never an automatic refresh during execution.

Committed exclusions alone do not attest external integration settings. Before
any inference and again before publication/ref creation, the controller requires
`SKYCAR_GENERATED_BUILD_ATTESTATION` from the protected environment's variables.
Under the unchanged independent-review path, a reviewer must audit all connected build/deploy integrations,
confirm that generated branches cannot execute with application, deployment,
OIDC or automation-bypass credentials, and record the exact current-main SHA and
preflight `build_policy_sha256`. This is a protected human attestation, not a
claim that the controller reads Vercel account settings itself. It expires within
24 hours. Missing, stale, malformed or mismatched evidence blocks execution;
expiry during publication leaves the durable lease blocked without creating a ref.
No live attestation is installed by this PR.

The protected environment variable is a JSON object with exactly these fields
(replace placeholders only after the independent live audit):

```json
{
  "version": 1,
  "repository": "jimmoq-hopsup-Hoqde6/skycar-site",
  "source_sha": "FULL_CURRENT_MAIN_SHA",
  "policy_sha256": "PREFLIGHT_BUILD_POLICY_SHA256",
  "reviewer": "INDEPENDENT_GITHUB_LOGIN",
  "verified_at_utc": "YYYY-MM-DDTHH:MM:SS+00:00",
  "expires_at_utc": "YYYY-MM-DDTHH:MM:SS+00:00",
  "external_integrations_audited": true
}
```

The reviewer must differ from the repository owner. Retain the existing required
environment review and no-admin-bypass controls; the JSON does not replace them.
This original schema and its validation remain unchanged. The sole alternative is
the explicit D-009 owner exception described below; owner acceptance must never be
represented as independent review.
Source for Vercel's branch control:
https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled

### D-009 — one-run owner risk acceptance (unsigned until Marcel signs)

Marcel (@jimmoq-hopsup-Hoqde6) accepted responsibility for the remaining build-security
risk in owner decision D-009 in docs/DECISIONS.md. He authorized preparing this gate
change, not merging it, saving an attestation or running a paid task. Previous AI
reviews posted through Moogly88 are **not independent**. The owner exception does
not waive runtime billing verification or any execution, isolation or publication
control. No live API, deployment, migration or payment is authorized by this PR.

Owner checklist — Marcel must personally complete all items before signing:

- [ ] Unused GitHub Apps are uninstalled or suspended: Netlify, ChatGPT Codex
  Connector, and Cursor, Grok and Lovable if still installed. Check installation
  status, not merely a disconnected chat. Disabling Codex Connector can remove
  this chat's repository access; finish reviewing this PR first. Do not retain
  unused app access just to let the assistant continue operating.
- [ ] Vercel `skycar-v2-staging` Preview cannot read the Supabase secret/service-role
  key or other server secrets, including shared/branch-specific Preview variables
  and inherited settings. Verify names/scopes without displaying values. Remove
  server-secret availability from Preview, not just the branch build trigger.
  Preview Branch Tracking is off. Generated `agent/**` deployments remain disabled.
- [ ] The coding key is dedicated to the selected pilot project; the separate
  billing Admin key has only required read access; the publisher credential is
  dedicated and restricted to this repository's Contents/PR writes, with no
  approval/bypass or administration privileges. None is reused by other workloads.
  Actual runtime provider hard-limit/cost reads must still succeed; screenshots,
  checklist statements and key presence do not replace that check.

Signing sequence, after Marcel reviews and merges this gate PR himself:

1. Keep paid execution stopped while completing the checklist. Use the **new
   merged current-main SHA**, never the old `85308251` or this PR's unmerged SHA.
   Run credential-free `preflight` on that SHA to obtain the exact policy digest
   and request fingerprint for the selected project and budget (at most 500 cents).
   Do not reinitialize or reset the existing ledger.
2. When ready for the separately authorized single run, Marcel controls enabling
   the stop switch and dispatching `operation=run` with that exact SHA, budget and
   fingerprint. It will wait at the existing protected coding environment gate.
   Do **not** approve it yet. Copy its numeric Actions run ID; the acceptance must
   name that run, not the preflight's ID. A run ID is available before paid coding.
3. After personally completing the checklist, Marcel fills the unsigned template
   below and records his decision/evidence in issue #120. He creates/saves
   `SKYCAR_GENERATED_BUILD_ATTESTATION` himself as a **protected environment
   variable**, not a repository variable or secret. The `reviewer` field names
   him as the accepting owner, not an independent reviewer. This protected manual
   record is the sign-off; it is not a cryptographic signature or an AI statement
   on his behalf. No assistant may create or save it for him.
4. Marcel separately approves the waiting coding job in GitHub Actions. The
   publisher requires the existing second environment approval. Do not edit or
   renew acceptance between stages; expiry or a changed record blocks publication.
   Return the stop switch to false after the run, and cancel an in-flight run too
   if stopping it. Reconcile uncertain outcomes without starting a new session.

Unsigned example only — placeholders intentionally cannot pass validation:

```json
{
  "version": 1,
  "repository": "jimmoq-hopsup-Hoqde6/skycar-site",
  "source_sha": "FULL_NEW_MERGED_CURRENT_MAIN_SHA",
  "policy_sha256": "NEW_PREFLIGHT_BUILD_POLICY_SHA256",
  "reviewer": "jimmoq-hopsup-Hoqde6",
  "verified_at_utc": "YYYY-MM-DDTHH:MM:SS+00:00",
  "expires_at_utc": "YYYY-MM-DDTHH:MM:SS+00:00",
  "external_integrations_audited": true,
  "attestation_type": "owner_risk_acceptance",
  "independent_review": false,
  "decision_id": "D-009",
  "run_id": "WAITING_PAID_WORKFLOW_RUN_ID",
  "project_id": "SELECTED_PILOT_PROJECT_ID",
  "task_id": "technician-command-account-v1",
  "budget_cents": 500,
  "request_fingerprint": "NEW_PREFLIGHT_REQUEST_FINGERPRINT",
  "draft_only": true,
  "max_runs": 1,
  "checklist": {
    "unused_apps_suspended_or_uninstalled": true,
    "preview_secrets_removed_and_tracking_off": true,
    "dedicated_credentials_verified": true
  }
}
```

The expiry must be after verification and no more than 24 hours later, both UTC.
All checklist values must reflect Marcel's actual completed verification. The
owner acknowledges residual build risk; `external_integrations_audited=true` does
not claim independence. No signed/usable acceptance is committed or installed.

The atomic Git notes ledger stores D-009 and the canonical acceptance SHA-256
before creating a session. Only one owner-acceptance reservation is allowed across
the ledger's entire history, including failed/uncertain and published runs. New
SHA, task, run ID, project, month or timestamps cannot reset it. The same run may
finish validation/publication using its existing lease, but cannot repeat coding.
Switching from owner acceptance to independent attestation mid-run (or vice versa)
is rejected, as is changing any owner-acceptance field. The generated draft clearly
labels D-009 as owner-accepted and not independent. Broader/repeated or unattended
operation requires a new decision; this path never implements those operations.

The new path does **not** accept operator-written billing receipts. Using the
pinned OpenAI SDK it reads project activity, this month's project costs and the
actual project hard limit from the provider Admin API:

* `admin.organization.projects.retrieve(project)`
* `admin.organization.usage.costs(...project_ids=[project]...)`
* `admin.organization.projects.spend_limit.retrieve(project)`

For the owner-authorized one-run pilot experiment, an active project with a
monthly USD limit no greater than the exact requested budget and 500 cents,
API `enforcement.status=inactive`, and spend below that limit is accepted.
`enforcing`, missing and unknown states are rejected. This reverses the previous
status admission rule; it is an owner-authorized billing-policy change, not
confirmed provider semantics. The public reference lists inactive/enforcing but
does not establish that inactive means configured-and-below-limit. Do not describe
this check as independent API verification that the dashboard hard-limit toggle
is enabled, or claim tests prove that interpretation.

Before approving any paid run, the owner must verify the exact organization and
project in OpenAI Platform, confirm Project settings → Limits shows the US$5
(or lower approved) limit and **Enforce a hard limit** enabled, and record that
verification with the new source/run-bound owner acceptance in issue #120.
Keep the dedicated project free of other workloads or cap changes during the run.
The controller relies on that manual precondition for the toggle; it still reads
project state, limit amount/currency/interval and current-month costs from the
provider. The read-only diagnostic may test the new status rule while stopped,
without paid-run acceptance or a session. A successful diagnostic does not prove
the toggle is enabled and does not authorize paid coding. Cost pagination is bounded;
fractional cents round upward. Stale, missing, exhausted or inaccessible evidence
blocks execution; a disabled hard-limit toggle must block owner approval. There is no automatic fallback or retry. Verification
runs before reservation/session creation, again before coding input and after
cleanup. The fingerprint binds the exact requested budget, selected project,
source, model, task prompt and effective request. Changing the budget invalidates
the previous authorization.

The project must be dedicated to this pilot and have no other workloads or
operators changing its cap during execution. Provider reporting/enforcement can
lag; a project cap is not an exact final-invoice guarantee. A read-only Admin
credential must actually be able to read project state, spend limits and costs;
403 responses block the run. No billing writes are implemented.

## Full requested-budget headroom — proposed additional fail-closed guard

A successful read-only `verify-billing` means that project state, monthly USD
limit, API enforcement state and recent cost data passed their existing checks.
It **does not** mean that the entire proposed session budget fits in the
*remaining* monthly project cap, that the dashboard hard-limit switch was
independently verified, or that a paid run is authorized. The diagnostic now
reports nominal remaining headroom and `full_request_fits` without launching
coding. Paid execution must additionally reject a request before ledger
reservation, and again before model input, when
`observed_spend_cents + requested_budget_cents > limit_cents`.

[Read-only run #14 on 20 November 2026](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/44739405461)
returned 187 cents of spend under a 500-cent project cap. That snapshot gives
313 cents of *nominal* room, not 500. A 500-cent paid request must therefore
remain blocked; simply passing billing diagnostics or a protected preflight is
not sufficient. Actual remaining spend can change, and provider enforcement
may lag. Once a genuine paid session runs, post-run billing checks actual
spend but deliberately do not re-demand the *original unused* full budget, to
avoid stranding legitimate validation/publication solely because model usage
increased as expected.

Do not silently lower the approved request or raise the provider cap. Any
reconfiguration (such as a separately approved fresh dedicated project) needs
new provider evidence, exact-source budget fingerprint, personal owner acceptance
and all protected environment plus QA/Security gates. This proposal is draft-only
and does not authorize approval of any waiting workflow run.

## Durable reservations and recovery

`refs/notes/skycar-executor-ledger-v1` stores a separate single-file ledger tree,
not an application branch. Each update creates a child commit and fast-forwards
without force. Concurrent sibling updates cannot both succeed. Initialization
is a separate protected, inference-free action; missing history never resets
automatically. The GitHub ref behavior and permissions still require operational
verification before the first live pilot.

One global lease covers coding through publication. Each task/SHA is permanently
reserved before creating a session. Full requested budgets accumulate to at most
500 cents per UTC month and are never automatically refunded. Changing months,
canceling a workflow, deleting a session or a failed job cannot release an
uncertain lease. Rerun attempts are blocked. Unknown creation outcomes never
start another paid session.

Successful coding requires session deletion followed by a provider 404 before
the ledger can advance. A failed or uncertain run stays blocked for owner
reconciliation against session/cost evidence. Do not delete or rewrite ledger
history to retry. There is deliberately no automated recovery/reset command.
The publisher records a candidate commit before creating its prefixed branch.
An uncertain PR creation can be reconciled against that exact existing draft
without creating a second PR or making another coding call.

## Configure only after independent review

Retain existing protected-main requirements and `skycar-agent-pilot` protections:
required owner review, no admin bypass, only the `main` branch and no tags. Do not
repurpose `SKYCAR_OPENAI_SMOKE_KEY`.

Repository variables:

| Variable | Value |
| --- | --- |
| `SKYCAR_CODING_PROJECT_ID` | Dedicated approved OpenAI project ID |
| `SKYCAR_OPENAI_ORGANIZATION_ID` | Its organization ID |
| `SKYCAR_EXECUTOR_ENABLED` | Absent or `false` until the reviewed pilot; `true` permits one manually approved invocation |

Protected environment secrets:

| Secret | Required scope |
| --- | --- |
| `SKYCAR_OPENAI_CODING_KEY` | Dedicated selected-project coding credential |
| `SKYCAR_OPENAI_BILLING_READ_KEY` | Separate Admin credential with only the reads described above |
| `SKYCAR_PR_PUBLISHER_TOKEN` | Dedicated fine-grained token/App token, this repository only, Contents and Pull requests write |

The temporary workflow token handles ledger/control reads and writes. The
publisher credential is injected only after validation, in a fresh job with no
OpenAI credentials. It cannot approve or bypass protected main through this code.
GitHub permissions are coarser than individual refs: protecting main and keeping
candidate code out of the credentialed controller remain essential. Install
credentials through a secure secret destination, never through source, issue
comments, shell arguments, model input or diagnostic output.

After the protected merge and secure configuration:

1. Dispatch `skycar-technician-executor.yml` on `main`, operation `preflight`,
   with its full reviewed current-main SHA and selected budget (maximum 500).
   Inspect its nonsecret request/fingerprint artifact. No inference occurs.
2. Initialize the ledger once using `initialize-ledger`; approve the existing
   protected environment gate. This does not enable inference.
3. After task-label approval, owner attestation of the live dedicated cap and
   a current independent generated-build attestation (or the exact D-009 owner
   acceptance following the separate signing sequence above) in the protected environment,
   and activation of the enable variable, dispatch `run` with the exact SHA, budget
   and fingerprint. Existing environment approval is required before coding and
   again before publication. The workflow has no unattended trigger.
4. Inspect the tested draft PR and complete normal application CI and independent
   QA/security review. Draft creation does not authorize a merge or activation.

To stop new execution, set the enable variable to `false`. To stop an already
running invocation, cancel its workflow too. Cancellation requests cleanup;
host loss/SIGKILL can leave an uncertain session, which requires reconciliation.
Do not infer cleanup solely from a canceled workflow badge.

Generated branches must not build previews automatically. The committed exclusions
and current independent attestation or one-run D-009 owner acceptance gate publication. This
implementation does not issue deployment or promotion calls.
Unattended polling and coordination of nine agents remain a separate reviewed
milestone after one real technician draft passes this complete supervised path.

## Verification

The offline suite uses simulated coding, billing and GitHub transports, including
the real pinned SDK with mock HTTP. It covers exact-budget binding, changed caps,
invalid billing, atomic-claim races, task replay, stop/rerun gates, unknown session
creation, cleanup, artifact/evidence tampering, all eight externally supervised
assertions, missing/expired build attestation and draft-only publication.

```sh
python3 -m unittest discover -s tests/autonomy -p 'test_*.py' -v
```

Docker integration tests are skipped locally unless explicitly enabled. The
credential-free `Skycar protected executor isolation tests` GitHub workflow
enables them and must pass a valid fix and reject an ineffective candidate,
an early zero exit, and a forged passing summary using the real pinned container.
The early-exit regressions also verify publication remains blocked.
No OpenAI request or paid coding is
made by those tests.

```sh
SKYCAR_DOCKER_TESTS=1 python3 -m unittest discover \
  -s tests/autonomy -p 'test_executor_docker.py' -v
```

### Safe failure diagnostics

Run #9 (`44531352122`) stopped at `billing_proof` before reservation/session
creation. Do not rerun it to diagnose billing. The new protected manual
`verify-billing` operation reads provider costs, project state and hard limit
while the executor remains stopped. It uses only the billing Admin credential
and read-only GitHub permissions; it has no coding/publisher credential and does
not reserve the ledger, create a coding session or publish. It still requires
reviewed current-main source and the existing protected environment approval.
Select this operation after this change is reviewed and merged, using that new
full main SHA and the approved budget. It does not require a paid-run acceptance
or fingerprint, and does not consume the one-run D-009 exception.

Proof rejection now includes an allowlisted `failure.billing_reason`: schema,
project, currency, interval, enforcement, requested_budget, limit_type,
limit_range, spend_type, spend_range or freshness. Arbitrary provider values and
exception messages are never included. Successful diagnosis prints only the
validated budget proof. This identifies which condition to repair without
weakening the hard-limit gate. A green diagnostic is not paid-run authorization;
any subsequent paid pilot still requires a new exact-source, run-bound acceptance
and protected approvals under the existing process.

The controller reports a fixed `failure.stage` instead of printing exception
messages or provider response bodies. Pre-session gates distinguish source and
fingerprint approval, workflow context, current main, environment protection,
issue approval, build acceptance, provider billing and durable reservation.
Provider billing distinguishes `billing_costs`, `billing_project`,
`billing_hard_limit` and `billing_proof`; these are diagnostic labels, not
permission to bypass a failed check. Existing safe HTTP status/request metadata
is retained. Unknown labels fall back to `protected_executor`.

A blocked run remains blocked. Inspect the durable ledger before any retry;
failures after reservation may have incurred costs and require reconciliation.
Do not rerun an old attempt or reset the ledger. After a source change, obtain a
new exact-main fingerprint and owner-signed, run-bound acceptance through the
existing protected process. Diagnostics do not authorize inference, merge,
publication or deployment.
