# Explicit project hard-limit mode

The bounded coding pilot defaults to session spend control and a US$1 request
budget. The maximum accepted request budget is US$5. A rejected session spend
parameter never triggers an automatic fallback or retry.

For providers that reject session `spend_control`, an operator can explicitly
select `--budget-mode project`. Before every invocation, independently inspect
the selected project's actual enforced hard limit in OpenAI Platform. Ensure
other workloads cannot consume or change that shared project limit during the
run. The limit applies to the project, not exclusively to this session; billing
updates and enforcement can lag. Do not describe it as an exact final-charge
guarantee.

Record that observation in a current-UID-owned regular UTF-8 JSON file outside
the checkout, with mode 0600, no symlink components, at most 4096 bytes, and exactly
these fields (replace the illustrative values with the verified observation):

```json
{
  "mode": "operator_verified_project_hard_limit",
  "project_id": "proj_REPLACE",
  "sha": "REPLACE_WITH_FULL_APPROVED_COMMIT_SHA",
  "task": "queue-input-validation-v1",
  "hard_limit_enforced": true,
  "limit_cents": 500,
  "observed_spend_cents": 0,
  "verified_at_utc": "REPLACE_WITH_CURRENT_TIMEZONE_AWARE_ISO_TIMESTAMP"
}
```

The receipt is an operator statement. It is not provider verification,
cryptographic evidence, permission to spend, or a replacement for owner approval.
The runner rejects stale observations (older than five minutes), future dates,
wrong source SHA, task or project, duplicate/extra fields, invalid types,
non-enforced limits, and limits above the requested budget or US$5. It rechecks
the receipt and client project before submitting the coding task. An expired
receipt during provisioning stops the task and triggers session cleanup.

Run offline preflight with the selected source SHA and receipt:

```sh
python scripts/autonomy/bounded_coding_pilot.py \
  --root /path/to/checkout --sha FULL_APPROVED_COMMIT_SHA \
  --budget-cents 500 --budget-mode project --project-id proj_REPLACE \
  --project-budget-confirmation /private/path/project-budget.json
```

The returned request fingerprint binds the effective API request, the exact
requested budget in cents, source, task, model and complete receipt. Changing
the requested budget invalidates the previous authorization even when the same
receipt remains valid. Project-mode fingerprints issued before this correction
must be regenerated and approved again. Have that exact request approved through the existing
owner process. Only then use `--execute`, a new output directory, and that exact
`--request-fingerprint` while the same receipt is still fresh. Securely supply
`OPENAI_API_KEY` to the controller's environment; never place it in a command,
receipt, repository, sandbox or logs. Do not change a timestamp after approval.

Project mode explicitly binds the SDK client to `--project-id` and omits only the
unsupported session `spend_control` field from a copy of the request. It records
the normalized observation in state, without claiming that the API returned a
session budget. Default session mode still requires the returned session budget
to match. Network-disabled sandboxing, no injected credentials, no tools or
delegation, the two-file task scope, artifact validation, redacted failures,
cleanup and owner approval remain in place. This mode adds no queue activation,
scheduling, GitHub writes, merge or deployment path.

## Live implementation evidence, 16 November 2026

One separately authorized hosted coding turn implemented this change from source
commit `8afcd6a39f9dc78ffa1b2cc2e9972df43ba69f09`, after the operator observed an
enforced US$5 project limit. The generated artifact SHA-256 was
`c196ffe3bf30a0b8f3d445a1a0d585b75b3fb861d7d61b40126c76e1afde0150`.
The returned two files were inspected and then tested alongside the existing
suite and eight operator-written acceptance tests: 61 tests passed. Verification
used a read-only candidate/runtime filesystem, private temporary storage,
cleared environment, no mounted credentials, resource limits, and a seccomp
policy denying network syscalls. The generated code was not run in the
credentialed controller.

The implementation task used an operator-controlled driver. A subsequent live
verification invoked the unchanged committed CLI itself from source commit
`82112fb0b117dfe63f2eefe63f557905701a4b04`. It completed the bounded queue-validation
task, downloaded the expected two-file artifact, and deleted its session.
Subsequent retrieval returned HTTP 404. The generated artifact SHA-256 was
`595c6b8ffea0e46bfd0d99d9c00bf51a87d7ba15074204a6be431a2a46c0f262`.
The resulting combined code passed 75 tests in a separate credential-free
sandbox, including five fixed operator acceptance tests. The queue-validation
task is complete in this candidate; do not spend money replaying it. A new task
requires a separate reviewed scope and approval. Independent review and protected
integration are still required before operational adoption. No unattended work
was enabled.
