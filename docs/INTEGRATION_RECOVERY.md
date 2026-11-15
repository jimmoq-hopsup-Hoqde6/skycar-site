# Integration recovery proposal — 21 September 2026

This is an executable-CI correction and a concrete routing proposal for #1/#8/#12.
It does not approve merges, rebase existing feature branches or complete a product
milestone. One executor owns `fix/ci-integration-verification`; accepted feature
heads remain stable. Project Manager routing acceptance and Technical Lead review
are still required before executing the feature sequence below. No separate chat
or GitHub identity is assumed to be working on it.

## Verification correction

Previously `Skycar CI / application` checked out a mutable PR branch, so success
did not establish that it built with its target branch. It could also generate
and push a missing lockfile with a write-capable token.

The corrected workflow keeps `application` for the event's immutable head SHA and
adds `integration` for the event's GitHub merge-candidate SHA. Both run the same
clean install, lint, TypeScript, unit, production-build and environment-file
checks. Neither persists Git credentials nor has repository write permission.
`npm ci` fails on missing/inconsistent locks; dependency changes must be reviewed
as source, never generated and committed by verification.

Before installing dependencies, `scripts/verify-ci-checkout.mjs` verifies the
checked-out commit. Integration requires exactly two parents, in base/head order,
matching the event. The job summary records the head, base and tested candidate.
Wrong revisions, changed parents and unsupported event types fail closed. Raw
commit inspection works in a shallow checkout. Regression tests construct real
disposable Git commits, including a candidate with the same tree but wrong parents.

[GitHub documents](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
that pull-request `GITHUB_SHA` refers to its merge commit. Conflicted PRs do not run
these workflows; lack of a run is not acceptance. A base change requires fresh
candidate evidence before integration; an old head run alone is insufficient.
If a stale event/candidate pair fails validation, trigger a fresh PR event and
review the new evidence instead of relaxing the parent check.

No branch-protection configuration is changed here. Require both application and
integration evidence in review, then configure enforced required checks through
the repository owner's reviewed controls. The public branch read on 21 September
reported main unprotected. CI is not a substitute for that setting or approval.

## Exact route submitted for review

Start: main `d717760145ae438560a1d469c4f9500cdab5baef`. The CI correction is stage 0,
before #25, after its own review and resolution of the Pages release gate. For
each subsequent stage, the same executor takes Backend/App responsibilities
sequentially, rechecks the remote SHA/claim and stops on unexpected writer activity.
The target is the result of the preceding accepted stage. Use non-force updates;
publish any conflict resolution and renewed checks for review before merging.

| Order | Input head | Current base | Exact overlap action and checks |
| --- | --- | --- | --- |
| 1: #25 | `d68d622dd2921b32c3055991f49d53689051f9f6` | main | First feature insertion: API boundary/health only. Keep stage-0 CI; reconcile architecture prose without dropping Care state separation. Application + integration + boundary tests + health smoke. |
| 2: #17 | `bca07a5827a830a3eb95ea52f77e089cca9a9bd5` | main | Garage implementation/migration; retain current decisions and stage-0 CI. Application + integration + Garage PostgreSQL and independent-session concurrency; Garage browser evidence. |
| 3: #16 | `915acbb42b4df9ea2a7c0eb8311bf006b9a33b11` | main | Care receipt/deadline/worker. Preserve Garage ownership and separate states. Restore Care smoke in the shared check action, for both jobs. Application + integration + Care database + Garage regression + combined migration evidence. |
| 4: #20 | `49023354b5c2f07bb647dec7cbbd13124f0e8552` | feature/care-backend | Retarget after #16; isolate list/pagination delta. Preserve archived history and microsecond cursor tests. Application + integration + Care/combined database + smoke. |
| 5: #19 | `3d5856277006a2acc2f6d6fbf79a1466613da8ef` | feature/care-backend | Retarget after #16; status/timeline delta only. Application + integration + Care status browser/visual evidence. |
| 6: #21 | `61975a3182cebbe25fe91cb3feb047f27e1665f4` | main | Evidence-only proposal: extract combined test/workflow/documentation, not the parent implementations again. Application + integration + all three PostgreSQL suites. |
| 7: #23 | `a0f2aed53a3cdf06adcba4de52581f85680bd34c` | feature/garage-care-integration | Extract delta from #21 after parents land; catalogue/coverage only. Preserve expanded Care smoke; application + integration + catalogue and Care/combined database. No resolver activation. |
| 8: #24 | `4a2900d13827ff56b916a0bbc8dfb645cc4e67eb` | feature/garage-care-integration | Extract delta from #21; preserve its corrected combined-test schema expectation, trusted-server boundary and photo smoke. Put both smoke suites in the shared action. Application + integration + Garage/Care/combined PostgreSQL + photo tests. |
| 9: #22 | `b025786bbd43bf67430ae8b093de8b5d74105053` | feature/garage-care-integration | #22 already contains #19's status code: retain newer reload recovery, do not re-add the older version. Reconcile shared Garage view/styles and landing page. Application + integration + Care database + status/My Jobs/Care-entry/Garage browser evidence. |

The route retains the Technical Lead's order, adds a discrete CI prerequisite and
makes #23 then #24 sequential. It is not approval to bypass hosted or release
gates. No feature route adopts #25 in this CI PR; that needs the contract review
below after routing acceptance.

### #21 and #9 dispositions proposed

Git ancestry confirms #16, #17 and #20 are already ancestors of #21; #21 is an
ancestor of #22, #23 and #24. #21's new blobs absent from all three direct parents
are the combined workflow, combined test, integration documentation, `.gitignore`
and `DECISIONS.md`. Extract the three evidence files; reconcile ignore/decision
changes against current accepted decisions. There is no new #21 migration.
Retain #24's later combined-test correction. Do not merge #21 wholesale after
merging its parents. Mark it superseded only after the extracted evidence is
reviewed and recorded; it remains open now.

#9 at `f8ea5acdc48ef17798bffac8cd486da9d41ce884` is proposed superseded, not merged.
Its checklist's immediate dependency predates the merged foundation and current
accepted branch corrections. Existing TEAM_OPERATING_SYSTEM/HANDOFF_RULES and
current #1/#12 controls remain authoritative. PM should record the disposition
before closing #9; this PR does not close it or silently replace those controls.

## Backend migration and API adoption inputs

Backend owns additive migrations in filename order, not PR merge order:
`202609200001` foundation, `202609200002` Care requests, `202609200003` My Jobs,
`202609200100` Garage mutations, `202609200300` vehicle photos. Combined tests must
apply all of them. Photo mutation uses server-only `SUPABASE_SECRET_KEY`; never
copy it into client or ordinary-user test contexts. No live migration is run.

| Route family | Contract to preserve when adopting #25 | Required regression |
| --- | --- | --- |
| Garage list/detail/history/create/edit/archive | Garage errors/field errors, ownership, origin checks, revisions, exact command replay, `Vary: Cookie`, private no-store; the same request ID reaches the audit call | Existing Garage HTTP/RPC/ownership/concurrency suites plus header/log redaction assertions |
| Care list/submit/detail/retry | Existing status codes, 201 initial/200 replay, errors and retry flags; especially `CARE_UNAVAILABLE`, `POLICY_UNAVAILABLE`, and Care's nonretryable `INTERNAL_ERROR` must not inherit the generic boundary default | Care API/domain/list tests, built smoke, deadline/duplicate/overdue/ownership PostgreSQL suites |
| Services/coverage | Public catalogue behavior; every failed/malformed coverage resolver returns documented retryable 503 `COVERAGE_UNAVAILABLE` | Catalogue resolver regression and built Care smoke |
| Vehicle photo | 201 initial/200 replay, existing Garage errors, bounded bytes/types, trusted RPC/storage boundary, uncertain upload reconciliation/quarantine | Photo unit/API, Garage PostgreSQL and combined migration tests; hosted private-storage gate separately |

Register each static template explicitly. Never log a runtime URL/ID/body/provider
error. Avoid double wrapping, nested envelopes or duplicate completion logs. Keep
exact client retry semantics; the generic boundary's defaults do not override the
published feature contracts. These are review inputs, not completed adoption.

## Non-deploying status path and remaining release control

Keep status corrections on this draft review branch or in issue/PR comments until
the release control is approved. Do not merge documentation to main under the
assumption that it cannot deploy. Public run
[35561481589](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/35561481589)
is a successful dynamic Pages deployment of main `d717760`; this is the recorded
rollback revision, not proof that rollback has been exercised. The dynamic Pages
workflow is separate from this repository's application CI; changing CI does not
disable it. Exact Pages source-folder/settings and rendered artifact need an
authorized settings/artifact inspection before any release change.

Proposed control for owner review: move Pages to an explicitly approved release
source or manual workflow with protected environment review, then prove that a
documentation-only candidate cannot invoke deployment. Preserve the legacy Pages
artifact and document its restoration procedure before changing the source.
No Pages/DNS/settings or deployment change is made here. #8 remains open.

| Milestone | Implemented | Verified | Accepted | Merged | Deployed |
| --- | --- | --- | --- | --- | --- |
| Foundation scaffold | Yes | Recorded CI | Scaffold | Yes | V2 deployment unverified |
| #16/#17/#19/#20 | Branch source | Recorded local/disposable CI | Individual full acceptance pending | No | No verified V2 deployment |
| #21 | Combined test code | Recorded PostgreSQL evidence | Bounded boundary evidence | No | No verified V2 deployment |
| #22 | UI/recovery and docs | CI/browser at `b025786` | Behavior at `904fb7c`; doc confirmation pending | No | No verified V2 deployment |
| #23/#24/#25 | Branch source | Recorded CI | Bounded technical acceptances | No | No verified V2 deployment |

Hosted two-account JWT/PostgREST/private-storage access, signed-in physical devices,
logging operations and restore/rollback remain unverified. This PR adds no
commercial decision, provider, customer data, schema or runtime environment change.
The separate private pilot was not accessed or counted.
