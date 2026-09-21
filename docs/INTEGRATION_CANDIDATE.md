# Customer journey integration candidate — 21 September 2026

## Ownership and disposition
Marcel explicitly requested execution of review/integration recovery. This session
owns `fix/customer-journey-integration` exclusively. It adopts the technically
accepted PR #26 sequence for isolated preparation. Existing feature branches stay
unchanged. This candidate is reviewable preparation, not independent approval,
authorization to merge main, or release acceptance.

PR #9's old routing proposal is superseded. PR #21 contributes only combined
workflow/test/documentation evidence; its parents are not merged twice. Both remain
open for traceability until review records their final disposition.

## Inputs and order
Main baseline: `d717760145ae438560a1d469c4f9500cdab5baef`.

| Stage | PR | Verified input |
| --- | --- | --- |
| 0 | #26 | 7317a5c89fab47930b4a100c70400fd3adaacab4 |
| 1 | #25 | d68d622dd2921b32c3055991f49d53689051f9f6 |
| 2 | #17 | bca07a5827a830a3eb95ea52f77e089cca9a9bd5 |
| 3 | #16 | 915acbb42b4df9ea2a7c0eb8311bf006b9a33b11 |
| 4 | #20 | 49023354b5c2f07bb647dec7cbbd13124f0e8552 |
| 5 | #19 | 3d5856277006a2acc2f6d6fbf79a1466613da8ef |
| 6 | #21 evidence only | 61975a3182cebbe25fe91cb3feb047f27e1665f4 |
| 7 | #23 | a0f2aed53a3cdf06adcba4de52581f85680bd34c |
| 8 | #24 | 4a2900d13827ff56b916a0bbc8dfb645cc4e67eb |
| 9 | #22 | b025786bbd43bf67430ae8b093de8b5d74105053 |

Local source trees for #22–#26 were compared against GitHub Git tree IDs and
matched exactly before integration. Local preparation commit IDs differ from
GitHub API-created commits; tree equality, not local author metadata, identifies
the source. Catalogue/photo/My Jobs are extracted as deltas from #21.

## Conflict resolutions and connected flow
- Preserve #26's immutable-head and ordered merge-parent CI over older workflows.
- Combine ignore rules; retain observability and Garage artifacts exclusions.
- Retain #24's corrected combined migration test expectation and secure photo RPC.
- Retain #22's newer status/reload/account-switch source and evidence over #19.
- Add a My Jobs return link on the request status page.
- Add a connected synthetic mobile journey: Garage → request submission → receipt
  → My Jobs → same request → overdue status, asserting exactly one submission.
- Restore both built API smoke suites inside the shared application check action.
- Run every database and customer browser suite on both immutable head and candidate,
  with provenance checks, read-only tokens and non-persisted credentials. Remove
  path filters which could otherwise skip relevant integration checks.
- Preserve browser output as separately named CI artifacts. Existing checked-in
  screenshots remain historical fixture evidence, not newly rendered proof.

## Test matrix
| Boundary | Required evidence on both revisions |
| --- | --- |
| Application | locked install, lint, types, 84 unit/API tests, production build, two built API smoke tests |
| Garage database | permissions, mutation rollback and independent-session concurrency |
| Care database | deadlines, duplicate submissions, owner lists, retry and cursor behavior |
| Combined database | every migration, shared vehicle ownership, archive/submit/retry races |
| Browser | Garage, Care entry account-order regressions, My Jobs, status recovery, connected journey |

Local locked offline install, lint, types, 84 tests, build and two smoke suites
passed before the small navigation/test addition. Final exact-candidate GitHub
results belong in the PR review. Chromium could not launch locally because socket
creation is prohibited; no local browser pass is claimed. PostgreSQL is not
installed locally; disposable CI databases supply that evidence.

No API contract, dependency, pricing, provider or feature activation changes.
Existing feature routes retain their published envelopes; #25 logging adoption
outside health remains separate reviewed work, not silently completed here.

## Release control — still a main-merge gate
GitHub reports main unprotected. The connector lacks settings mutation capability;
the browser is signed out, so Pages source/approval settings cannot yet be changed.
The prior successful dynamic Pages run is 35561481589 at main `d717760`.

Before any main update, an authenticated repository-settings session must:
1. Inspect and record the current Pages branch/folder and published artifact.
2. Preserve the known published revision on a dedicated release source, or switch
   to an explicit release workflow with protected approval. Do not unpublish the
   existing site or activate a new V2 deployment.
3. Verify routine main/documentation updates cannot trigger publishing.
4. Require current application/integration and applicable domain checks for merge.
5. Record the rollback source and an approved rollback procedure.

Changing the application CI YAML alone does not disable dynamic Pages. This
candidate does not claim to solve that settings gate or exercise rollback.

## Hosted acceptance — still required
Use an isolated approved Supabase project, two disposable test accounts and no
production data. Apply additive migrations in filename order; configure public
credentials and the server-only secret through secure environment settings.
Verify real sign-in/session changes, owner A vs B denial, private photo URLs,
metadata-RPC denial for ordinary clients, cleanup/reconciliation and signed-in
physical devices. See existing hosted verification documentation. Do not put
keys/passwords in issues, logs or chat. Missing access is not a reason to stop
isolated integration preparation, but it prevents claiming end-to-end readiness.
