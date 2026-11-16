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
Only the eight source files and trusted acceptance directory are mounted. The
publisher checks evidence without importing or executing candidate code.

The new path does **not** accept operator-written billing receipts. Using the
pinned OpenAI SDK it reads project activity, this month's project costs and the
actual project hard limit from the provider Admin API:

* `admin.organization.projects.retrieve(project)`
* `admin.organization.usage.costs(...project_ids=[project]...)`
* `admin.organization.projects.spend_limit.retrieve(project)`

Only an active project with an enforced monthly USD hard limit no greater than
the exact requested budget and 500 cents is accepted. Cost pagination is bounded;
fractional cents round upward. A stale, missing, exhausted, inaccessible or soft
limit blocks execution. There is no automatic fallback or retry. Verification
runs before reservation/session creation, again before coding input and after
cleanup. The fingerprint binds the exact requested budget, selected project,
source, model, task prompt and effective request. Changing the budget invalidates
the previous authorization.

The project must be dedicated to this pilot and have no other workloads or
operators changing its cap during execution. Provider reporting/enforcement can
lag; a project cap is not an exact final-invoice guarantee. A read-only Admin
credential must actually be able to read project state, spend limits and costs;
403 responses block the run. No billing writes are implemented.

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
   activation of the enable variable, dispatch `run` with the exact SHA, budget
   and fingerprint. Existing environment approval is required before coding and
   again before publication. The workflow has no unattended trigger.
4. Inspect the tested draft PR and complete normal application CI and independent
   QA/security review. Draft creation does not authorize a merge or activation.

To stop new execution, set the enable variable to `false`. To stop an already
running invocation, cancel its workflow too. Cancellation requests cleanup;
host loss/SIGKILL can leave an uncertain session, which requires reconciliation.
Do not infer cleanup solely from a canceled workflow badge.

Existing repository Git integrations may build previews when a draft PR branch
is published. This implementation does not issue deployment or promotion calls.
Unattended polling and coordination of nine agents remain a separate reviewed
milestone after one real technician draft passes this complete supervised path.

## Verification

The offline suite uses simulated coding, billing and GitHub transports, including
the real pinned SDK with mock HTTP. It covers exact-budget binding, changed caps,
invalid billing, atomic-claim races, task replay, stop/rerun gates, unknown session
creation, cleanup, artifact/evidence tampering and draft-only publication.

```sh
python3 -m unittest discover -s tests/autonomy -p 'test_*.py' -v
```

Docker integration tests are skipped locally unless explicitly enabled. The
credential-free `Skycar protected executor isolation tests` GitHub workflow
enables them and must pass both a valid fix and rejection of an ineffective
candidate using the real pinned container. No OpenAI request or paid coding is
made by those tests.

```sh
SKYCAR_DOCKER_TESTS=1 python3 -m unittest discover \
  -s tests/autonomy -p 'test_executor_docker.py' -v
```
