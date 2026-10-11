# Customer–technician review, staging disposition and availability handoff

Recorded 11 October 2026, Australia/Adelaide. Requested by Marcel; coordination
through #51, #8, #53 and #50. This is a separate read-only technical review pass
of a frozen implementation, not a separately authenticated human/GitHub approval.

## Verdict

**BLOCKED for independent acceptance and hosted release.** R1 is reproduced.
R2 is a source-confirmed lock-order risk requiring a real concurrent regression.
Staging is unavailable and its protected-control readback is incomplete. No
merge, deployment, migration, role grant, recovery dispatch or provider action
was performed. Frozen implementation branches remain untouched.

Reviewed application: PR #59, `37fbd6e413440f0b01f0932fc96d9e5f069d9370`,
tree `3f73f4238c042b2d32491d246e2a19dca6838cfa`, base
`75713f15d12a3ca89531e1146b8e6213ccf0a2bf`. Its dependency stack includes
connected journey #47, technician inbox #49, quote/decline #56, work start #57
and private completion #58. Availability packet: #60,
`5a554f074d6c1539501f741fc4d4f94f16dd85a4`.

## Findings for the single implementation writer

### R1 — P2, completion review contradicts the actor contract (reproduced)

`docs/TECHNICIAN_FULFILMENT_API.md` says only the owning customer/guest, never
admin/technician, can confirm or report a completion issue. In
`20261004150000_customer_completion_review.sql`, the RPC checks existence of a
customer role but does not exclude admin or technician roles. Foundation user
creation grants a customer role, so adding a privileged role need not remove it.

Reproduction on the exact frozen migration set:

1. Create a synthetic owner with customer+admin roles; create its vehicle,
   completed account request and completed journey with evidence metadata.
2. As the trusted server role, call `care_customer_completion_review_command`
   using the owner as actor, a fresh key and `confirm_completion` with `{}`.
3. The RPC returns `review_state: confirmed`, rather than denial.
4. Repeat with customer+technician roles: the same result occurs.

The executable review harness reproduces both cases. Existing tests deny
admin-only/technician-only actors but omit dual-role owners. This does **not**
demonstrate cross-customer access: request ownership remains enforced.

Required correction: Delivery & Review assigns one forward-migration writer.
Either enforce the published exclusion before writes and replay, or obtain an
explicit reviewed contract decision allowing a dual-role owner to act in a
customer capacity. Add both confirm and private-issue cases, replay after role
changes, and customer/guest positives. Do not silently reinterpret the contract.

### R2 — P2, shared command ledger has opposite lock ordering (static finding)

The existing `care_journey_command` acquires actor/key advisory lock before
vehicle/request locks for select/publish/confirm. The new completion-review RPC
acquires vehicle/request locks before that **same** actor/key advisory lock.

For one customer's two requests on the same vehicle and one reused key:
transaction A can hold the vehicle in completion review; transaction B can
hold the actor/key lock in quote selection. A then waits for B's advisory lock
while B waits for A's vehicle lock. This is a possible deadlock instead of the
promised deterministic key-conflict response. The existing completion race
suite covers confirm-versus-issue on one journey, not this cross-RPC order.

Required correction: agree one shared lock hierarchy and test the conflicting
cross-action key on two real PostgreSQL connections, in both acquisition orders,
plus same-key replay, archive/transfer and audit rollback. Embedded PGlite is
single-connection evidence and cannot establish this race; no concurrent local
reproduction is claimed. Keep the original frozen migration unmodified.

## Evidence and limits

Fresh checks on frozen #59:

- `npm run check`: lint, typecheck, 205/205 unit tests and production build pass.
- All migrations load in a fresh in-memory PGlite 0.5.8 database using the
  repository's disposable auth/storage shims.
- Existing SQL suites re-executed without concurrent helpers: inbox 46,
  quotes 53, start 40, completion 57, customer review 43: **239 assertions pass**.
- Two additional dual-role contract violations reproduce.
- Frozen #60 availability reference suite: **8/8 pass**.

Run the review reproduction from this checkout:

```sh
npm install --prefix /tmp/skycar-review-runtime --no-audit --no-fund @electric-sql/pglite@0.5.8
SKYCAR_REVIEW_PGLITE_MODULE=/tmp/skycar-review-runtime/node_modules/@electric-sql/pglite/dist/index.js node tests/review/technician-boundaries.20261011.mjs
```

The reproduction intentionally asserts the observed violation; its successful
exit is evidence of a finding, not approval. No application dependency or CI
configuration was changed. Existing SQL suite log labels mention races; local
counts above omit race helpers. They are not hosted JWT/RLS/storage proof.

Fresh GitHub reads confirm all five historical #59 workflow families succeeded:
Skycar CI 37210509521; Care database 37210509532; Garage PostgreSQL 37210509576;
combined PostgreSQL 37210509550; customer browser 37210509549. Downloaded head
job logs prove checkout `37fbd6e...`; combined job 111460562288 records 46 inbox,
62 quotes, 47 start, 64 completion and 47 customer-review assertions, including
real PostgreSQL races. Browser head job 111460562186 records connected mocked
technician/customer completion, retries and draft-clearing passes. Those are
historical CI results, not new browser execution or real hosted acceptance.

Reviewed boundaries preserve service-only SQL execution, current technician
role/link/source checks, invited versus selected contact projection, explicit
requested versus confirmed appointments, half-open capacity overlap checks,
byte-derived completion evidence and atomic history/audit/command writes.
Private issue text is absent from technician projection and event/audit copy.
Work, customer review and money lifecycles remain separate. These observations
do not waive R1/R2 or hosted/device acceptance.

## Staging disposition — existing sole Backend/DevOps owner (#8)

Fresh read-only evidence:

- Supabase project `oelorquxkddvilopmibh`, named `skycar-v2-staging`, reports
  **INACTIVE**. Migration-inventory SQL terminated with connection timeout.
  Current hosted migrations, grants, roles and private storage cannot be verified.
- Vercel lookup of #59 automatic PR preview `5Zn6FrddVBNfEZFm2T3dfWEiUx8k`
  returns team-scope **403 forbidden** for `team_ZCcZjfqL0qDx9Muhv1tdo9ZO`.
  No independently authenticated Vercel CLI is available here.
- GitHub records an automatic Ready PR preview, but that does not prove a
  connected staging backend or hosted customer–technician workflow.
- #8 records Marcel's prior pin update as completed by the owner; persisted
  readback remains outstanding. Do not ask him to repeat that update.

BLOCKED BY: inactive database, deployment-scope access and outstanding protected
control readback. OWNER: existing sole Backend/DevOps executor, with existing
QA/release reviewer. No new installer or guessed individual is assigned.

Next actions in that existing queue:

1. Report why the project is inactive and obtain the existing reviewed recovery
   disposition before resumption. Verify non-production identity and recoverable
   backup; do not replay disposable bootstrap against hosted Supabase.
2. Read back saved operations/application pins, secret **names only**, owner
   reviewer, self-review setting, administrator bypass setting, allowed branch
   and zero tags, isolation/port and recovery-key fingerprint comparison. Keep
   all values of credentials and private recovery material out of artifacts.
3. Resolve scoped read access to the same Vercel staging team; verify exact
   immutable runtime revision, origin, preview flags and private storage.
4. After R1/R2 disposition and independent release acceptance, review the whole
   migration stack and authorised synthetic operator/technician/customer roles.
   Installation remains exclusively with the existing DevOps owner.
5. Run real unmocked hosted customer A/B, unrelated technician and guest tests:
   own/other/anonymous job and media; revoked role/link; request→quote→selection
   →explicit capacity confirmation→start→upload→completion→confirm/issue;
   exact retries/conflicts, overlapping confirmations and audit/history counts.
6. Verify same-browser guest recovery, unrelated-browser denial, account-switch
   stale-response clearing, direct storage denial and physical iPhone flow.
   Record route templates/status codes/revision without private IDs or media.

Stop on privacy leaks, duplicate mutations or false confirmation. No protected
run is released here; failed backup runs remain immutable and are not rerun.
**Hosted and physical-device checks remain BLOCKED, not completed.**

## Availability implementation handoff — #53 / frozen #60

Assessment: useful contract/reference packet, not persisted availability.
Conditional handoff prepared; implementation cannot start until Delivery &
Review acknowledges the accepted descendant of #59, one backend/migration
writer, exact paths and allocated migration timestamp. No new schema is written.

One contract finding needs resolution: the packet says overnight availability
can be split across adjacent days, but its executable minute validator rejects
`24:00`. A same-day interval ending at midnight cannot be represented faithfully
by ending at `23:59`. Decide an end-only next-day-midnight boundary, or explicitly
exclude overnight windows in this MVP, and add a scenario before acceptance.

| Owner lane | Exact proposed file intersections | Deliverable |
| --- | --- | --- |
| Single Backend/migration writer | new forward migration; new `src/domain/technician/availability.mjs`; new `src/server/technician/availability-repository.ts`; new `src/server/technician/availability-http.mjs`; new `src/app/api/v1/technician/availability/route.ts` | private schedule/revision/idempotency storage and authenticated GET/PUT |
| Same shared-domain writer | reviewed forward replacement of `care_technician_job_command`, quote-selection guard and `care_journey_command` confirmation; `src/server/technician/http.mjs` error mapping | authoritative schedule/eligibility rechecks and one lock hierarchy |
| UX/App after contract acceptance | new `src/features/technician/availability.tsx`; new `src/app/technician/availability/page.tsx`; bounded `src/features/technician/inbox.tsx`, `src/features/care/journey/customer.tsx`, `src/features/care/journey/operations.tsx` copy/navigation | weekly windows/exceptions, empty/error/stale/retry/account-clear states |
| QA after harness-owner allocation | new `tests/integration/technician-availability.acceptance.mjs`; new unit/browser suites; existing combined harness/CI owned separately | PostgreSQL concurrency/authority, strict HTTP, recovery and DST evidence |
| Existing DevOps only | #8 release/runbook evidence | reviewed staging installation and real hosted/iPhone acceptance |

Storage and protocol requirements: Adelaide IANA timezone, canonical weekly
windows, dated replacement exceptions, explicit valid DST offsets, bounded
payload sizing sufficient for the documented maxima, optimistic revision,
stable exact key/body replay and current role/link checks before replay. No
public/authenticated direct schedule table/RPC access. Keep `care_journeys` as
the only capacity ledger; proposals and booking requests reserve nothing.

Acceptance must include missing schedule, stale revision, changed-key conflict,
unknown/oversized fields, role/link/account/source revocation, spring gaps,
autumn folds, adjacent slots, quote/selection/confirmation rechecks, competing
confirmation versus schedule edit, cancellation-request hold versus cancelled
release and rollback. Preserve operations-authored manual-availability quotes
using stored provenance. Schedule edits cannot erase confirmed commitments.

Rescheduling remains a separately reviewed delta: retain the confirmed interval
while a proposed replacement is considered; swap atomically on the same journey
after capacity checks, retain the original on rejection. No second booking row,
automatic booking confirmation, payment integration, outbound send or promised
urgent capacity belongs to this handoff.

Next Delivery & Review action: allocate the correction writer for R1/R2, review
the midnight contract decision, then acknowledge availability base/paths/owner.
Existing DevOps owns staging recovery and checks; authorisation or receipt from
another session is not inferred from publication of this packet.
