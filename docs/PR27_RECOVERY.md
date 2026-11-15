# PR #27 recovery evidence

Source head: `bdd1fdff4228e655c249cb878208836a1f3ed37e`.
Base: `d717760145ae438560a1d469c4f9500cdab5baef`.
Verified merge candidate: `18dcb10ecc74cce19be5d11d0af9d80dcb611635`.
Source tree: `f14a5bb9e634d42bef93e7a0b1c495cbb9ecf390` (matched to local tests).
The later documentation-only checkpoint does not change executable source;
its own configured head/candidate checks are recorded in the PR conversation.

## Changes and acceptance

- Separate ordinary My Jobs list clearing from identity-boundary filter reset.
  The archived-history assertion is retained and strengthened with selected-value
  and filtered-count checks. Visibility return also revalidates ownership.
- Retain a Garage command outside VehicleEditor: original account, exact key/body,
  method and path survive focus/pageshow/visible revalidation. Private UI is hidden
  while verification is pending or failed. Same-account recovery resumes the same
  attempt; missing account metadata fails closed; replacement identity drops it.
- Fence both save and archive results against the active command and verified
  account. Late success/error cannot replace B's editor, restore A's labels, invoke
  A's old list loader or unlock a replacement command.
- Add the documented authenticated account metadata and optional write precondition.
  The Garage UI supplies it on every mutation. The server rejects mismatches before
  mutation/ledger access, including account replacement between a read and a write.
  No migration or dependency change is needed; existing API callers stay compatible.

## Executed verification

All five workflows passed both head and integration jobs (10 jobs):

| Workflow | Run | Result |
| --- | --- | --- |
| Application | [35664355899](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/35664355899) | PASS both |
| Garage PostgreSQL | [35664356061](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/35664356061) | PASS both |
| Care database | [35664355983](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/35664355983) | PASS both |
| Combined migrations/ownership/retry | [35664356022](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/35664356022) | PASS both |
| Customer browser acceptance | [35664356146](https://github.com/jimmoq-hopsup-Hoqde6/skycar-site/actions/runs/35664356146) | PASS both |

Both final browser logs were read, not inferred from workflow colour. They report
Care entry, My Jobs, request status, the connected Garage → request → My Jobs →
status journey with exactly one submission, 18 existing Garage assertions and
43 new Garage recovery scenarios passing. The new matrix covers create/edit/archive,
pending/uncertain responses, focus/pageshow/visibility, same account/replacement,
failed validation/sign-out/missing metadata, and late success/error. It checks exact
command equality on retries and exactly one committed synthetic mutation.

Local locked dependency installation, lint, TypeScript, 87 unit/API tests, production
build and both built API smoke tests passed. Local Chromium cannot create required
sockets, so browser proof comes from disposable CI runners. Database proof also
comes from CI. Browser fixtures are synthetic; they are not hosted auth/RLS proof.

## Handoff and remaining release requirements

The PR conversation records the exact final head, workflow results and explicit
writer release for independent review. Implementation verification is not independent
approval. Main remains unchanged and no deployment was performed.

Still required before release:
1. Qualified independent Technical Lead/QA acceptance of the corrected candidate.
2. Authenticated repository settings: decouple automatic Pages publication from
   routine main/docs updates, enforce required checks, and verify rollback controls.
   The settings browser is signed out and connector settings writes are unavailable.
3. An approved isolated Supabase environment with disposable A/B accounts; real
   authentication, private-photo access, recovery, hosted logs and physical-device
   verification. This recovery had no credentials/environment for those checks.

The Garage recovery scope is focus/pageshow within the same mounted page (including
BFCache restoration). It does not persist a Garage command across hard reload or
route unmount; no private command payload is written to local/session storage.
