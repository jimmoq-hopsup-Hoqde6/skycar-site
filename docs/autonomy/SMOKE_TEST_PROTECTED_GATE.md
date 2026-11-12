# Skycar OpenAI smoke test — protected gate proposal (13 Nov 2026)

**Status:** Not activated. This document and workflow change are a stacked draft proposal on PR #103. No key was read, moved, created or tested. No workflow was dispatched and no paid model request was made.

## Why this gate is needed
PR #103 is manually triggered and has no GitHub token permissions, but on its current head it reads the repository-scoped `OPENAI_API_KEY`. Anyone with sufficient repository workflow access could attempt to run a version of the workflow from another branch. A main-only `if` guard **alone is not a credential boundary** if a writer can change the workflow in their branch.

This patch instead binds the single connection job to environment `skycar-agent-pilot` and requests a separate secret named `SKYCAR_OPENAI_SMOKE_KEY`. There is deliberately **no fallback** to `OPENAI_API_KEY`. Missing access causes a safe failure before the API request. The job runs only when dispatched on `main` and on the first attempt.

## Required independent checks before any merge or dispatch
1. Independent QA and Security review the exact workflow SHA and confirm the manual-only/no-checkout/no-write/no-log-secret behavior.
2. Repository administrator confirms `skycar-agent-pilot` **already exists**; requires a Product Owner reviewer; restricts deployments to `main`; cannot be bypassed by administrators; and has no other unreviewed workflow entry points. Merely naming an environment in YAML does **not** establish these controls.
3. Administrator creates the dedicated **environment-scoped** `SKYCAR_OPENAI_SMOKE_KEY` only after the owner approves this particular API smoke test and its small variable cost. Ensure no repository/organization secret of the same name exists. Do not paste secret values into GitHub issues, PRs, logs or chat.
4. Assess and separately remediate the existing repository-scoped `OPENAI_API_KEY`; this proposal **does not** restrict or revoke it from other workflows.
5. Confirm OpenAI API project access, model availability, billing/spend alerts and any provider controls. No claim of a hard account-wide cap is made.
6. Verify default-branch workflow presence only after independent review and owner-approved merge through branch protection. GitHub workflow_dispatch cannot be launched from this unmerged stacked draft workflow.
7. Product Owner explicitly authorizes one manual smoke run. Record run URL, SHA, environment approval trail, PASS/FAIL and sanitized cost evidence in issue #91.

## If any check is missing
**NO-GO.** Do not dispatch, enable recurrence, publish changes or activate a coding executor. A successful smoke test would prove basic OpenAI API reachability only, not Codex autonomy, independent QA or nine running agents.

## Proven independent evidence so far
- Parent PR #103 at `f0346cd923ea01945e052fd630b47c288169c47d` is open/draft with general Skycar CI passing in [run 43310528321](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/43310528321). That run is **not** the connection test.
- No submitted GitHub PR reviews were returned for PRs #92/#95/#96/#98/#102/#103 in the 13 Nov review.
- PR #92 and #95/#96/#98/#102 remain unmerged. The Codex/API coding controller has not been verified in a live paid run.
