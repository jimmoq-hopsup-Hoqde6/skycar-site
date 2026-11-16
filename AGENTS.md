# Skycar agent instructions

Read these files before proposing work:
1. docs/DECISIONS.md
2. docs/TEAM_OPERATING_SYSTEM.md
3. docs/AI_TEAM.md
4. docs/ARCHITECTURE.md
5. docs/PROJECT_STATUS.md
6. Relevant GitHub issues, PRs and workstream tasks

The Project Manager owns orchestration; specialist roles do not override accepted product or architecture decisions.
Skycar V2 is service-led for acquisition and Garage-led for retention. Preserve existing Next.js/TypeScript/Supabase architecture and server-authoritative booking, payment, identity and permission boundaries.
Do not invent mobile app implementation status: this repository currently contains a web foundation; Expo/React Native is a proposal requiring architecture review.

## Execution constraints
- Never write directly to main. Use isolated branches and draft PRs.
- Never merge, deploy, purchase, submit to app stores, alter production data, or change credentials/permissions without explicit human approval.
- Do not bypass failing tests, privacy blockers, security findings, or release gates.
- Check existing open PRs and dependency chains before editing shared code.
- Use issue acceptance criteria and document API contracts before frontend/mobile integration.
- Keep secrets out of repository, issues, logs and model prompts.
- Report what was tested versus not tested, with evidence and remaining risks.
- Use docs/AI_TEAM.md for role boundaries and review responsibilities.
