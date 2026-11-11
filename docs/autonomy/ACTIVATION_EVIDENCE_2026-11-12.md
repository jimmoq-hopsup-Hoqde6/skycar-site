# Skycar autonomy activation: independent evidence and go/no-go gates
**Evidence checkpoint: 12 November 2026 — non-production, read-only audit**

This record is advisory. It does **not** authorize any merge, workflow activation, paid API call, credentials change, deployment or agent execution. Live unattended coding remains **NOT VERIFIED**.

## Verified repository snapshots
| Component | Exact evidence | What it proves |
|---|---|---|
| Main | `7912bc9c3375b713fa2e879ba66387d5a8f79feb`; GitHub branch API reported `protected: true` and ten required CI contexts | Some CI protection is configured; review requirements and bypass policy NOT independently verified |
| Nine-agent plan | PR #86 at `7c47924ff57b4fd2abf1df5ceefd1ccbab6dc813`, open draft | Role definitions only, not independently running jobs |
| Operating workflows | PR #92 at `a2fff75d1b7c7e3d679702bb3a7f12da44f8acab`, open, not merged | Manual-only pilot definitions and queue routing; not an active scheduler/executor |
| Routing-policy verification | Draft PR #98 at `53e2e08a9261a1e381897fb0597e260a1482df03`; policy run [42915143617](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/42915143617) and Skycar CI [42915143413](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/42915143413) **completed successfully** | Read-only unit/CI checks work for this exact SHA, not live agent execution |
| Hosted single-task controller | Draft PR #95 at `f10a36fe98961dc1dcfbace37d9323752e1f3ffe`; [offline test run 42799542977](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/42799542977) and [Skycar CI 42799542083](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/42799542083) **completed successfully** | A bounded controller has offline verification; NO live Agents API session, generated code or autonomous draft PR proved |
| Pilot activation review | PR #96 at `005bb89772cda9860c450df389a1da65f90be689`, open draft | Workflow proposal resides outside `.github/workflows`, not executable from GitHub Actions |
| App vertical slice | Issue #90 open; PR #99 at `4c63b67d1dc84bae07435368b9f922285e391694` open draft; five latest PR #99 CI workflow families green | Progress on customer request status/phone behavior, **not** full connected customer→technician→Garage or physical-device acceptance |

No submitted GitHub PR reviews were returned on #92, #95, #96 or #98 at this checkpoint. A passing workflow cannot replace independent QA/Security review.

## Blockers and their exact release criteria
1. **Independent review:** Assign distinct humans/agent sessions to QA and Security, record each independent PASS/BLOCK decision tied to the reviewed SHA; self-review prohibited. Review #95's API/session cleanup, budget boundary, untrusted inputs and artifact validation, plus #98's routing tests.
2. **Identity and secret scope:** Verify an application/project key with *only* necessary Agents API and inference scopes; keep it outside the sandbox. No key or credential is to be pasted into issues, chats, logs or PRs. Reviewers must verify permission boundaries without reading secret values. Current connector cannot inspect required-reviewer or bypass settings; an administrator must verify those in GitHub before any paid activation.
3. **Cost and kill switch:** A $1 per-session `spend_control` in a proposed controller is **not** evidence of an account-wide or monthly spend ceiling. Independently verify session, model, hosting, retry, duplicate-session and platform billing limits. Stop on uncertain state, avoid automatic retries after ambiguous failures.
4. **First no-secret run:** Verify the runner on an immutable SHA using a manual no-credential preflight, retain logs/artifact and link them to #91. GitHub workflow_dispatch definitions must be present on the repository default branch to be dispatchable; the files in unmerged #92 are not yet eligible. Do not merge them merely to run a test.
5. **First paid sandbox test (separate authorization required):** Exact model, task, files, SHA, fingerprint and cost ceiling must be owner-approved. Supply *only* allowed files to an ephemeral network-disabled sandbox. Retrieve output and independently inspect it outside the credentialed runner; never execute generated code with a secret available.
6. **First draft PR:** If the artifact passes independent test and file scope checks, publish a separate *draft* PR on a new branch with exact SHA and evidence. No main changes, workflow/permission changes, hosted database writes, payments or deployment.
7. **Nine-role scale-out:** Only after the above are proven, establish task leases, idempotent scheduling, one writer for shared migrations, per-role permissions, independent QA/Security handoffs, audit evidence, budget limits, emergency stop and recurring exception reports. ChatGPT CEO oversight is periodic; it is not an always-running worker process.

## Decisions and next action
**Decision: HOLD unattended/paid execution.** The CI successes establish useful progress, but key and environment isolation, independently recorded reviews, billing constraints and the real first-run evidence remain open.

**Next action:** commission independent QA/Security review of **#95, #96 and #98** at the immutable SHAs above, capture PASS/BLOCK in #91, then perform a credential-free pilot preflight through an approved runner before requesting any paid session authorization.

No protected action is authorized by this document. Issues #87–#91 and #8 remain the source of their respective acceptance/release requirements.

Official references: [GitHub workflow_dispatch event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch); [OpenAI Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart); [OpenAI-hosted sandbox isolation](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted).
