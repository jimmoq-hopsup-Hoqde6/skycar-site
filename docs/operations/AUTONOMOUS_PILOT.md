# Skycar autonomous operations — safe pilot proposal

Status: PROPOSAL ONLY. No autonomous executor is installed or enabled by this document.

## Scope and current evidence
- GitHub Sprint 1 issues #87–#91 track work.
- Codex read-only audit was reported completed by Product Owner.
- PR #84 head `29dc4679b722f294b3cf554ba80f06ebdbf51101` is a review candidate, NOT approved for merge.
- Nine roles are proposed in draft PR #86, not nine running processes.
- Main branch is not the integration candidate; do not assume its code is ready.

## First safe automation milestone
1. Independently confirm current repository branch protections, rulesets, required CI checks, workflow permissions and runner sandbox limits.
2. Choose a supported Codex runner/API integration and verify credentials in a restricted environment; never commit tokens or give production secrets to coding jobs.
3. Create a manual-dispatch-only, no-write pilot that reads one specifically labelled issue, records exact SHA, and produces an audit artifact. No scheduled jobs until review.
4. In a separate authorized pilot, allow an isolated agent to propose changes on its own branch and open a DRAFT PR; no push to main or protected branches.
5. Trigger independent QA and Security review jobs using different agent sessions. Require human-reviewed evidence, not self-approval.
6. Only after controls are demonstrated, enable limited scheduling with concurrency=1, task leases, retry caps, daily budget ceiling, kill switch and audit logs.

## Nine specialist routing
Project Manager: #87/#50; Product Strategist: #71; UX/UI: #90; Mobile: #90; Backend: #88; AI Specialist: optional only; QA: #89/#90; Security: #89; Release: #8. One claimed task per agent, with file ownership and exact SHA recorded.

## Mandatory restrictions
- No automatic merge, production/staging deployment, hosted database migration, payment activation, customer contact, production data access, secrets editing, permission elevation or branch-protection edits.
- Do not let implementing agent approve its own PR.
- Backend migration and shared-contract writes require single-writer coordination through #50.
- Security findings block advancement. Product Owner approves protected actions individually.
- Default GitHub token read-only; elevate only narrowly for approved pilot branch/PR creation.
- Fail closed if Codex execution API, required checks, permissions or cost limits cannot be verified.

## Exit criteria for enabling unattended runs
- One read-only run verified with logs and SHA.
- One isolated draft-PR pilot verified.
- Independent QA and Security review demonstrated.
- Ruleset and required checks verified as enforced.
- Budget, sandbox, kill switch, alerts, audit trail and credential rotation documented.
- Product Owner separately authorizes unattended execution (NOT release).

## Open decisions
- Which supported Codex execution integration and account billing mechanism is available?
- Who holds the restricted GitHub App credential and controls the runner?
- What daily/monthly spend cap and alert destination should be used?
