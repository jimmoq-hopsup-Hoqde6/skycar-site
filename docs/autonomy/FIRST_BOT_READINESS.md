# First bot: verified bounded task, awaiting independent review

On 16 November 2026 the actual reusable CLI at commit
`82112fb0b117dfe63f2eefe63f557905701a4b04` completed one hosted coding task.
The task rejected malformed queue input and added regression tests. This
candidate includes that output and only the runner files needed to reproduce
the controlled pilot. It is based directly on protected `main` at
`bc0bd627593a0bf50e090c77195b1e3c63d7f1eb`.

This avoids merging the older pilot branch stack, which also contains obsolete
read-only/planning workflows and unrelated staging configuration. Those files
are not part of this candidate. Existing main workflows, branch protections,
review requirements and the protected smoke-test environment are unchanged.

## Verified path

1. Clean checkout and exact source SHA checked; two committed input files only.
2. Pinned OpenAI 3.49.0 and SOCKS dependency started successfully.
3. Actual Platform project hard limit observed as enforced: US$5, with US$1.49
   already recorded before this invocation. The same project limit was retained.
4. Explicit project mode preflight generated a request fingerprint and bound the
   SDK client to the selected project. The operator approved one invocation.
5. One credential-free, network-disabled small hosted sandbox completed the
   coding turn, with no external tools or delegation.
6. The controller downloaded and validated the exact two-file artifact and
   requested cleanup. Subsequent session retrieval returned HTTP 404.
7. Generated files were inspected, then tested with the existing runner suite
   and fixed operator checks in a separate sandbox: 75 tests passed, including
   600 baseline routing comparisons and real CLI rejection cases. The sandbox
   had a read-only candidate/runtime, private temporary filesystem, cleared
   environment, no mounted credentials, resource limits and denied network
   syscalls. These checks are operator validation, not independent QA approval.
8. The one-off verification key is revoked; no credential is included here.

The published suite contains 70 offline tests. Five additional sandbox acceptance
tests require network syscall isolation and a committed-baseline fixture, so they
were run separately and are not included in normal GitHub CI discovery.

Evidence: session
`sess_049b187b66117da7006afac78b843881958239273ca938e376`, turn
`turn_049b187b66117da7006afac7ac013c81958ec69b07195a0a45`, create request
`req_38344194198e4b98a353c2dd444074a1`, artifact SHA-256
`595c6b8ffea0e46bfd0d99d9c00bf51a87d7ba15074204a6be431a2a46c0f262`.

## Offline startup checks

```sh
python3 -m venv /tmp/skycar-pilot-venv
/tmp/skycar-pilot-venv/bin/pip install -r scripts/autonomy/requirements-pilot.txt
/tmp/skycar-pilot-venv/bin/python -m unittest discover -s tests/autonomy -p 'test_*.py' -v
```

See [project-budget operation](PROJECT_BUDGET_MODE.md) for the private, fresh
operator observation and exact-fingerprint procedure. Do not insert keys into
commands, logs, source, receipts or model input. The default session-budget mode
still fails closed when the service rejects its spend parameter; project mode
must always be selected and verified explicitly.

## Remaining operational gates

The queue-validation task is now complete. Do not replay it as useful new work.
The runner still has one fixed task, not a general issue executor. New coding
work needs an independently reviewed task definition and exact source scope.

Before operational use, obtain independent QA/security review of this clean
candidate and satisfy all protected-main checks. The implementing operator
cannot provide that independent approval using another connected account.
No merge or deployment has been performed.

No paid GitHub workflow, schedule, issue consumer, durable task ledger or
automatic PR publisher is installed here. The only added workflow runs offline
tests without credentials. A first unattended bot still requires a reviewed
activation change, a dedicated credential confined to the protected environment,
concurrency and task leases, spending/retry controls, a kill switch, and explicit
owner authorization. The smoke secret `SKYCAR_OPENAI_SMOKE_KEY` remains dedicated
to the existing connection test; it was not repurposed for coding.
