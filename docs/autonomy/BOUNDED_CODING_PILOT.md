# First bounded coding pilot

## Status

Implemented controller and offline tests; **not activated, no live API run, no generated code, no draft-PR cycle proven**. The live workflow is an inert `.yml.example` outside `.github/workflows`. The only active new workflow runs offline tests with no secrets. This is the first coding milestone, not nine autonomous developers.

## Narrow task

The first task hardens input validation in `scripts/autonomy/queue_dry_run.py` and adds tests in `tests/autonomy/test_queue_dry_run.py`. This is a real missing validation case in the existing routing helper. Only those two committed files are supplied to the model. The full repository, Git metadata, environment files, API key, GitHub token and customer data are not supplied.

The controller uses the official OpenAI Agents API with a small hosted sandbox, explicitly disabled outbound network, no external tools/plugins/vaults, and no subagents. It uses `gpt-6-astra` from the current official quickstart. A one-session spend control of 100 US cents is requested and confirmed before coding input is submitted. This is **not a monthly account-wide cap**; confirm service billing, container charges and enforcement before any paid run. Existing budget comments are proposals, not proof of enforced caps.

## Offline verification

```sh
python3 -m venv /tmp/skycar-pilot-venv
/tmp/skycar-pilot-venv/bin/pip install -r scripts/autonomy/requirements-pilot.txt
/tmp/skycar-pilot-venv/bin/python -m unittest discover -s tests/autonomy -p 'test_*.py' -v
python3 scripts/autonomy/bounded_coding_pilot.py --sha "$(git rev-parse HEAD)"
```

The preflight performs no network calls and prints the task, exact source SHA, model, budget, file scope and request fingerprint. A fingerprint binds these parameters; **it is not an authorization credential, a one-use token or a spending ledger**. The controller refuses to overwrite an existing output directory but does not prevent launching another run with another directory. Every invocation needs separately verified approval and previous-run reconciliation. No automatic retry, queue or schedule is provided.

Tests include real pinned SDK 3.49.0 serialization, streaming, success/failure handling and artifact download using a mocked HTTP transport. They are not live account/access checks. SDK 3.13.0 does not support all methods/fields needed here and must not be used.

## Activation gate

Before the first live run, the owner must approve the exact reviewed controller commit, reuse of the existing GitHub `OPENAI_API_KEY`, transmission of the two named source files to OpenAI, paid session amount/billing, and temporary session cleanup. Verify the existing key has `api.agents.read`, `api.agents.write`, and `api.responses.write`; granting new key permissions requires separate approval. Never paste or retrieve the secret value into chat.

If running in GitHub, first independently review this code and the inert workflow template, create/verify a protected `skycar-agent-pilot` environment with owner review, and authorize activation of the precise workflow. Do not assume an environment name alone creates approval protection. The workflow uses a read-only GitHub token and no repository publishing rights. Activating a workflow that uses a stored credential for ongoing access needs explicit approval. Do not bypass branch protection or merge PR #92 just to make a dispatch button appear.

After approval, on the reviewed commit and with the existing key securely supplied only to the controller:

```sh
python3 scripts/autonomy/bounded_coding_pilot.py --sha FULL_REVIEWED_SHA \
  --budget-cents 100 --execute --request-fingerprint REVIEWED_FINGERPRINT \
  --output /absolute/new/pilot-evidence
```

The template allows only a manual first workflow attempt and one concurrent job. It has no scheduled trigger. The fingerprint is checked against the exact request, but authorization remains an external owner-review requirement.

## Outcomes and recovery

- Creation is not coding success. The session ID is persisted before input, readiness is checked, and the input submission key is persisted before streaming.
- Only a successful root turn with the exact expected artifact can produce `artifact_validated_NOT_TESTED`. A failed/cancelled/disconnected turn blocks advancement.
- Source and output are untrusted. The controller validates exact paths, JSON schema, byte limits, duplicate keys and task identity. It never executes output.
- SIGTERM/SIGINT/deadline initiate cancellation and bounded cleanup. SIGKILL, host loss or an uncertain create response cannot guarantee cleanup. Inspect `state.json` and reconcile the session in OpenAI before starting again. Do not blindly repeat a create or coding input.
- Cleanup requests session deletion only after downloading the output, or after failure. The saved local state/artifact remain. Server resource cleanup is asynchronous; `deletion_requested` is not proof it has physically completed.
- Do not upload logs containing keys, source dumps or unredacted customer data. The runner deliberately does not print raw SDK errors or model/tool output.

## After the first successful run

Use the trusted artifact reviewer to create a review patch without applying or executing it:

```sh
python3 scripts/autonomy/review_pilot_artifact.py --root . --sha FULL_REVIEWED_SHA \
  --artifact /absolute/pilot-evidence/changes.json --state /absolute/pilot-evidence/state.json \
  --output /absolute/new/review-output
```

Then run the generated candidate tests in a fresh disposable sandbox with no credentials, no network and no production data. Use independent fixed acceptance assertions as well as the generated tests. Independently inspect the diff and obtain QA/security verdicts on the exact artifact hash. Publish only a draft PR on a new branch after those checks and applicable authorization. Do not execute generated Python in the credential-bearing controller or automatically merge/deploy it.

Automatic draft-PR publishing, a durable single-use job ledger, enforced monthly/project budgets, independent automated reviewer handoffs and scheduled queue execution remain future milestones. They are intentionally not claimed as completed by this pilot.

## Official interfaces verified

- https://developers.openai.com/api/docs/guides/agents-api/quickstart
- https://developers.openai.com/api/reference/python/resources/beta/subresources/agents/subresources/sessions/methods/create
- https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted
- https://developers.openai.com/api/docs/guides/agents-api/environments/files
- https://developers.openai.com/api/docs/guides/agents-api/sessions
