# Skycar autonomous agent execution — activation checklist

## Objective
Run nine role-scoped agents as independent, auditable jobs controlled by GitHub issue state and a project-manager policy, with ChatGPT CEO providing periodic oversight. ChatGPT conversation itself is not a persistent controller.

## Verified evidence snapshot — 16 November 2026
- PR #92 is open and unmerged at `a2fff75d1b7c7e3d679702bb3a7f12da44f8acab`. Its proposed manual workflows are not on `main`, and a proposed paid planner in it references a broad repository secret without a protected environment. This stacked remediation proposes removing that workflow.
- PR #113 merged on 15 November at `bc0bd627593a0bf50e090c77195b1e3c63d7f1eb`, adding the separately protected *connection-only* smoke workflow to `main`.
- GitHub Actions connection-test runs [43719166648](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/43719166648) and [43720859192](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/43720859192) completed successfully at `bc0bd627...`; a preceding run [43717788726](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/43717788726) failed. These prove step-level workflow success, not an unattended Codex coding session.
- All nine-agent executor jobs, branch-writing draft PR cycle, independent QA/Security session separation, daily spend limit and cancellation controls remain unverified. Do not mark them active.

## Required infrastructure
1. Dedicated restricted execution identity (GitHub App preferred), limited to this repository. Never use an owner personal access token or production credentials.
2. Supported Codex execution method and billing account, verified in an isolated runner. A successful API smoke test does not establish the Codex runner.
3. A **dedicated least-privileged, environment-scoped** agent credential (not a general repository-scoped API key), configured by an authorized administrator after verifying required environment reviewers, branch rules, bypass policy and access. Do not read or disclose secret values.
4. Runner policy: isolated ephemeral environment; outbound network controls where supported; max 1 concurrent coding job initially; per-run and cumulative spending stops, retries and kill switch.
5. Protected branch rules, required checks and independent review approvals verified. No auto-merge or deployment.
6. Nine role instructions from PR #86 independently reviewed. Each agent has a scoped task queue/permissions; nine roles do not imply nine simultaneous coding jobs.

## Safe rollout
- Phase A: credential-free, read-only issue inspection and routing policy test, independently reviewed. The manual workflows proposed in unmerged PR #92 cannot be dispatched from the default branch.
- Phase B: one separately authorized, isolated Codex coding agent allowed only to create a draft PR; independent QA and Security sessions verify its exact commit.
- Phase C: only after observed successful runs and owner authorization, implement bounded scheduling/queues for nine roles. Maintain concurrency and budget limits.
- Phase D: daily CEO oversight and exception reporting, with owner approval for all protected actions.

## Blocking no-go conditions
- Any workflow using a broad repository-scoped API key for model calls without protected environment and cumulative spend gate.
- Missing independent review of changed automation code or unverified environment restrictions/branch-protection enforcement.
- Unmeasured or unlimited per-run/daily/monthly cost, unbounded retries, missing kill switch or missing isolated audit log.
- Missing reproducible draft-PR coding pilot with independent QA and Security verdict.

## Policy
Do not merge, deploy, modify hosted databases, access customer data, activate payments, contact customers, change branch protection, or modify secrets automatically. Block on QA/Security failures. Require Product Owner approval for protected actions.
