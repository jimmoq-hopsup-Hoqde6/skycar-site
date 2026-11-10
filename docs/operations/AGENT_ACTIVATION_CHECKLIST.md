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
- PR #92 is draft and workflows are not on main; do not claim active background coding.
- Existing PR #84 remains a review candidate, not an integration approval.

## Policy
Do not merge, deploy, modify hosted databases, access customer data, activate payments, contact customers, change branch protection, or modify secrets automatically. Block on QA/Security failures. Require Product Owner approval for protected actions.
