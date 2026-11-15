# Skycar Autonomous Agent Operating Contract (STAGED — NOT ACTIVE)

This document defines the nine autonomous development agents and their coordination contract. It is configuration guidance only. No runner, schedule, workflow dispatch, or API call is activated by this file.

## Executive controller
The AI Project CEO prioritizes approved GitHub issues, allocates work, resolves non-protected tradeoffs, and publishes status. In unattended operation this requires a **separately deployed orchestrator service**; a ChatGPT conversation itself is not a persistent controller.

## Nine roles and deliverables
| Role | Input | Allowed output | Required handoff |
|---|---|---|---|
| Project Manager | Approved backlog and dependency graph | Sprint plan, issue routing, blocker report | Product + Engineering |
| Product | Requirements, user journeys | Acceptance criteria, feature scope proposal | UX + Engineering |
| UX/UI | Accepted product brief | Accessible designs, design tokens, UI review | Mobile |
| Mobile | Approved mobile issue | Isolated iOS/Android code branch, draft PR | QA + Security |
| Backend | Approved backend issue | Isolated backend code branch, migrations in PR only | QA + Security |
| AI Specialist | Approved AI feature issue | Prompt/model evaluation, tests, draft PR | QA + Security |
| QA | Immutable PR commit SHA | Reproducible test report, PASS/BLOCK | Release |
| Security | Immutable PR commit SHA | Threat assessment, severity-ranked PASS/BLOCK | Release |
| Release | QA/Security results + CI | Release readiness report only | Product Owner |

## Orchestrator state machine
BACKLOG -> SPECIFIED -> READY -> ASSIGNED -> DRAFT_PR -> CI_CHECK -> INDEPENDENT_QA -> INDEPENDENT_SECURITY -> READY_FOR_HUMAN_REVIEW.
On failure -> BLOCKED or FIX_REQUESTED -> new code commit -> repeat independent checks at the new SHA.
Never automatically transition to MERGED, PRODUCTION_DEPLOYED, PAYMENT_ENABLED, or LIVE_DATA_ACCESS.

## Execution contract (for future runner implementation)
- Trigger: manual dry run first; later scheduled/queue-driven only after explicit activation.
- Work selection: GitHub issues explicitly labeled for agent execution, excluding security-sensitive and production tasks.
- Isolation: one issue per ephemeral runner/worktree/branch; no cross-agent mutable workspace.
- Permissions: default read-only; short-lived narrowly scoped write token only for code branch/draft PR operations.
- Credentials: GitHub Actions secret OPENAI_API_KEY; never print, commit, or expose to PR jobs from forks.
- Model access: bounded token/request budgets, per-task cap, daily cap, retries and kill switch.
- Logging: issue ID, role, commit SHA, model usage estimate, CI evidence, QA/Security verdict, errors.
- Independence: implementer cannot sign off their own QA or Security review.
- Concurrency: single coding pilot first; expand only after observed success and spending review.
- Safety: pin actions/dependencies, restrict GitHub workflow permissions, block prompt-injection from issues/PR content, never run untrusted code with secrets.
- Approval gates: human owner approval for merges, production deployments, payments, live customer data, major architecture changes, and material spend.

## Activation checklist (ALL must be verified)
- [ ] Audit existing workflows and repository protection/rulesets.
- [ ] Implement and review actual runner + queue + agent prompts/config.
- [ ] Verify secret access without exposing secret values.
- [ ] Verify budget limits, failure handling, audit trail, and emergency stop.
- [ ] Execute isolated manual pilot and verify draft PR creation.
- [ ] Obtain independent QA and Security verdicts on exact SHA.
- [ ] Obtain explicit owner authorization to enable unattended execution.
- [ ] Enable schedule/runner and monitor first unattended cycle.

**Current state:** staged design only. This file intentionally contains no executable automation.
