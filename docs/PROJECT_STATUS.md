# Skycar V2 — Project Status

Last updated: 2026-09-23. Evidence snapshot; refresh issue handoffs before execution.

## Product and current candidate

Services acquire customers; the free Garage retains them. Initial services are
cosmetic scratch/dent repair, detailing and cleaning. Follow DECISIONS D-006/D-007.
The separate private pilot is outside this repository and this test exercise.

The frozen application lineage is [PR #31](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/31)
`321723d` → [PR #34](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/34)
`bdb0807` → [PR #35](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/35)
`821125df9556225b4d34ff1aec4072c2d789b4cf`. PR #35 is the final reviewed
application candidate for the bounded phone-test milestone. It adds the reviewed
request-status sign-in return and mobile editable-control corrections to the
integrated Garage/Care, offer and secure sign-in work. PR #33 is a separate
documentation artifact; its branch and head must never be used as the deployment
checkout. These documents do not move or approve the frozen application candidate.

| State | Evidence |
| --- | --- |
| Implemented | Sign-in, Garage, service requests, My Jobs, request status; backend offers and private-photo API |
| Tested locally/CI | 153 unit/API tests, four built API suites, six browser suites, 18 Garage checks, 43 recovery scenarios; ten head/integration jobs passed |
| Technical review | PR #31, F1 and F2 received bounded independent technical PASS; distinct from formal GitHub/release approval |
| Staging preparation | Exact-`821125d` configuration, migration, synthetic-test, logging and rollback packet verified and writer-released |
| Hosted acceptance | NOT RUN; no hosted Auth/account/storage/rollback result claimed |
| Physical phone acceptance | NOT RUN; no test link delivered |
| Release | Draft/unmerged; no application deployment claimed |

Evidence: [PR #31 test checkpoint](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/31#issuecomment-5784499164),
[F1 technical PASS](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/34#issuecomment-5789255015),
[F2 technical PASS](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/pull/35#issuecomment-5790560620),
and [exact-revision preparation packet](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5791282351).
Counts describe the recorded application lineage; this documentation change reruns no application tests.

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

The administrator thread owns the staging approval-control decision and release
handoff. Current recorded settings require owner review but prevent owner
self-review, so an eligible distinct authorised reviewer and staging-only
disposition are still missing. A staging-only alternative has not been approved:
it requires explicit Product Owner confirmation and administrator verification
before any protection setting changes. Main and production requirements remain
unchanged. The exact approved HTTPS origin and execution disposition for
`821125df9556225b4d34ff1aec4072c2d789b4cf` must be recorded before hosted writes.
No credentials belong in public issues.

After that gate, the existing sequential Backend/App executor uses the completed
exact-revision packet to configure the protected runtime, applies the reviewed
six-migration inventory, and verifies hosted Auth, two-account RLS/private storage,
rollback and recovery before the phone handoff.
Use [STAGING_PHONE_TEST_RUNBOOK.md](STAGING_PHONE_TEST_RUNBOOK.md). Capture an actual
restore point and authorised recovery procedure; neither is verified yet.

The [exact-`821125d` preparation packet](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/issues/8#issuecomment-5791282351)
is complete and its writer is released; do not rerun unchanged preparation. PR #33
only aligns these two documents with that result and remains independent of staging
approval. Preserve one writer per scope.

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
