# Skycar autonomous agent execution — activation checklist

## Objective
Run nine role-scoped agents as independent, auditable jobs controlled by GitHub issue state and a project-manager policy, with ChatGPT CEO providing periodic oversight. ChatGPT conversation itself is not a persistent execution service.

## Required infrastructure
1. Dedicated restricted execution identity (GitHub App preferred), limited to this repository. Never use an owner personal access token or production credentials.
2. Supported Codex execution method and billing account, verified in an isolated runner. Existing ChatGPT/Codex UI access does not automatically provide CI credentials.
3. Repository-scoped credentials in GitHub Actions secrets, configured by the owner/admin through GitHub UI. No secrets in issues, PRs, logs or chats.
4. Runner policy: isolated ephemeral environment; outbound network allowlist where supported; max 1 concurrent coding job initially; explicit time, token and budget ceilings; kill switch.
5. Protected branch rules, required checks and review approvals verified independently. No auto-merge or deployment.
6. Agent instructions from draft PR #86 reviewed before adoption. Each agent has its own task queue/permissions; the nine roles need not all write code simultaneously.

## Safe rollout
- Phase A: read-only workflow pilot on PR #92, manual dispatch, with logs and artifact.
- Phase B: one write-enabled coding agent in a sandbox, allowed to open draft PR only, reviewed by separate QA/Security sessions.
- Phase C: autonomous issue queue and scheduled execution for nine roles after checks, quotas, and independent review gates proven.
- Phase D: daily CEO oversight and exception reports; no protected action without owner approval.

## Current blockers
- Codex CI runner and credentials are not verified.
- Current branch protection/rulesets, cost cap and secret scope have not been verified.
- PR #92 is open and currently marked ready for review (not merged); its manual-only workflows are not on main, so they cannot be dispatched yet. Do not claim active background coding.
- Existing PR #84 remains a review candidate, not an integration approval.

## Policy
Do not merge, deploy, modify hosted databases, access customer data, activate payments, contact customers, change branch protection, or modify secrets automatically. Block on QA/Security failures. Require Product Owner approval for protected actions.

## 11 November 2026 — read-only verification checkpoint
- PR #92 head `a2fff75d1b7c7e3d679702bb3a7f12da44f8acab` is open and unmerged; no submitted reviews were returned. Existing Skycar CI passed on the head in [run 42728300983](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/42728300983); that is NOT evidence an AI executor ran.
- GitHub's main-branch snapshot reports `protected: true` and 10 required CI contexts, but the integration cannot read the full branch-protection endpoint (HTTP 403); protection enforcement and bypass permissions need an admin read before activation.
- GitHub requires `workflow_dispatch` files to be on the default branch to be runnable; the three manual-only PR #92 pilots therefore cannot be launched from the current unmerged state. [GitHub documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).
- A separate narrowly scoped proposal adds a `pull_request` trigger to existing no-secret policy tests so the nine-role routing test can produce CI evidence before main changes. It does not enable Codex, expense-bearing calls, write permissions or a schedule.
- Before any unattended coding, confirm restricted runner credentials, OpenAI project budget hard stop, operator kill switch, isolation, independent QA/Security gates and human authorization; then run one narrowly scoped agent draft-PR pilot.
