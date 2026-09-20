# Technical lead delivery checklist

## Responsibilities
The technical lead reviews architecture, frontend/backend integration and technical readiness.
The project manager retains issue coordination under D-002.
Implementation roles retain the responsibilities in TEAM_OPERATING_SYSTEM.md.

## Task readiness
- One accountable role per task.
- Clear outcome, acceptance criteria and dependencies.
- Documented API contracts before integration.
- Verify the existing source and environment before introducing a replacement architecture.

## Review
- Require changed-source references and relevant test evidence.
- Verify loading, empty, error and success states where applicable.
- Check server-side permissions and authoritative business state.
- Return incomplete work with concrete corrections.
- Distinguish planned, implemented, tested, merged and deployed status.

## Exception reporting
Report discovered blockers, failed checks, dependency conflicts and delivery risks promptly during active work.
Include:
- Finding and evidence.
- Effect on scope or delivery.
- Recovery action and accountable role.
- Any decision needed from the product owner.

Keep routine technical decisions within the team. Escalate material scope, budget, commercial and release decisions.

## Coordination
Use issues, contracts and pull requests as required by the team operating system.
Separate conversations do not establish automatic communication or background monitoring.
This checklist does not configure automated supervision.

## Immediate dependency
Issue #1 remains the foundation gate. Audit existing source and record the actual architecture before expanding feature implementation.
