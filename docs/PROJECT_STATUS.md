# Skycar V2 — Project Status

Last updated: 2026-09-23. Evidence snapshot; refresh issue handoffs before execution.

## Product and current candidate

Services acquire customers; the free Garage retains them. Initial services are
cosmetic scratch/dent repair, detailing and cleaning. Follow DECISIONS D-006/D-007.
The separate private pilot is outside this repository and this test exercise.

The single application candidate is [PR #31](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/31),
branch `fix/phone-test-delivery`, head `321723da4126f750235f0d1e8188c211142b89a9`,
base `626bcf0fd07088d548aa63db4fb1773d63e98e1e`, tested integration candidate
`23380f0fff8eb4d8efad36ab811fe03d968e2d1d`. It integrates the corrected Garage/Care,
offer and secure sign-in work. Older feature PRs are inputs, not competing candidates.
This documentation proposal does not move or approve that frozen application head.

| State | Evidence |
| --- | --- |
| Implemented | Sign-in, Garage, service requests, My Jobs, request status; backend offers and private-photo API |
| Tested locally/CI | 153 unit/API tests, four built API suites, six browser suites, 18 Garage checks, 43 recovery scenarios; ten head/integration jobs passed |
| Technical review | Bounded independent technical PASS recorded; distinct from formal GitHub/release approval |
| Hosted acceptance | NOT RUN; database remains empty at last verified baseline |
| Physical phone acceptance | NOT RUN; no test link delivered |
| Release | Draft/unmerged; no application deployment claimed |

Evidence: [exact test checkpoint and writer release](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/31#issuecomment-5784499164),
[technical disposition](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/31#issuecomment-5784577405).
Counts describe the recorded application revision; this documentation change reruns no application tests.

## Existing staging resources — reuse, do not recreate

- Supabase `skycar-v2-staging`: isolated Sydney project, healthy and empty at the recorded baseline.
- Vercel `skycar-staging`: All Deployments login protection recorded; no Git connection,
  deployment or environment values at the latest inspection.
- GitHub `skycar-staging`: created; restricted to branch `fix/phone-test-delivery`;
  owner is required reviewer; self-review prevented; administrator bypass disabled.
- Main protections and Pages configuration have been inspected. Their existence is
  not authorisation to merge or deploy this application.

See [resource checkpoint](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/12#issuecomment-5784547148),
[control inspection](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5785971805),
and [administrator update](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5787012631).

## Exact remaining gate and owners

The administrator thread owns the independent-reviewer/release handoff. A distinct
eligible GitHub reviewer is not yet verified. The owner cannot approve a run that
it initiated while self-review prevention is enabled. Do not remove that protection.
Approved revision/origin, protected secret destinations and staging execution
scope still require a recorded disposition. No credentials belong in public issues.

After that gate, the existing sequential Backend/App executor configures the
protected runtime, applies the reviewed six-migration inventory, and verifies
hosted Auth, two-account RLS/private storage, and recovery before the phone handoff.
Use [STAGING_PHONE_TEST_RUNBOOK.md](STAGING_PHONE_TEST_RUNBOOK.md). Capture an actual
restore point and authorised recovery procedure; neither is verified yet.

Independent preparation can continue: the [assigned two-file handoff correction](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5787021875)
is documentation-only, on a separate branch targeting the existing integration
branch. Preserve one writer per scope. Schedules being enabled does not prove work
has started; require an acknowledgement and concrete result.

## First phone test and later scope

Supported target: sign-in → Garage vehicle → service request → My Jobs → status →
sign-out. Hosted and physical-device cases remain NOT RUN until recorded.
Private-photo upload/isolation is an API acceptance task; no customer upload UI is
claimed. Do not instruct Marcel to find a missing upload control.

Offer options do not prove technician capacity. Offer selection, confirmed booking,
payment, live tracking, fulfilment and completion evidence remain later increments.
Next product work follows reviewed quotes → authoritative availability → race-safe
booking confirmation → payments → completion evidence. Membership, benefits,
condition reports and a marketplace retain their own dependencies and commercial gates.
