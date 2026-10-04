# Technician quote and decline commands — M2

First implementation increment based on PR #49 `d1c47e71f1d3a2d2ab08f3f0686799a376c5c9e5`. Draft development only; no hosted migration or release acceptance.

## Authority

Use the connected `care_reviewed_quotes` ledger from D-008. The server derives the technician's linked expert from the verified session; clients never submit an actor, expert ID, ownership or booking state. Technician proposals are expert-reviewed quotes, not AI estimates or operations approval. A proposed appointment is not reserved. Customer selection continues to request a booking; existing atomic operations confirmation remains the capacity authority. Payment/payout and later work-progress commands are separate.

## Commands

`POST /api/v1/technician/jobs/{id}` requires verified technician session, trusted origin, JSON content type and UUID `Idempotency-Key` plus required `X-Skycar-Account` from the last verified read. The server compares this account precondition to the verified session before any mutation; it never authenticates from the header. Query parameters are rejected. Body limit 16 KiB.

| Action | Payload | Result |
| --- | --- | --- |
| `quote` | `{scope_summary,total_price_cents,expires_at,starts_at,ends_at}` | `{id,action,state,quote_id,replayed}` |
| `decline` | `{}` | `{id,action,state,quote_id:null,replayed}` |

Body is exactly `{action,payload}`. Scope is 10–2000 trimmed characters, price is an integer 1–100000000 cents AUD, dates are explicit UTC/offset instants with seconds. Expiry is future and no later than start; start is future; end follows start and duration is at most seven days. Insurance must cover the appointment end in Adelaide. Proposed work must match expert service area/capability and current insurance. Inputs do not grant credentials or verify insurance authenticity.

Only an active, linked, authorised technician with an active eligible invitation can quote/decline an unselected review/quotes-ready job. Account requests require current vehicle ownership and an unarchived vehicle. Selected or closed jobs reject new commands. Each new quote supersedes only this expert's previous issued quote; other experts remain untouched. Decline revokes own invitation and withdraws own technician-submitted issued quotes. Operations may reinvite; old quotes stay withdrawn.

Provenance records the submitting technician privately. Customer selection rechecks active invitation, current role/link and expert for technician-origin quotes. Operations revocation withdraws technician-origin issued proposals atomically; admin-authored quotes keep their established behavior. No quote/booking ledger is duplicated. A withdrawal emits `quote_withdrawn`; the customer sees the remaining current options, or returns to review if none remain.

## Retry and permission contract

Role/link and current source ownership checks precede replay. Commands serialize by actor/key, then vehicle/request/journey. Exact actor/key/action/job/payload replay returns the stored result with `replayed:true`, including after that decline removed review access. Changed reuse is 409 `IDEMPOTENCY_CONFLICT`. New writes after withdrawal, selection or closure are rejected. Data mutation, events, audit and idempotency record commit atomically. No anonymous/authenticated direct table or RPC execution.

All JSON/errors are private/no-store, vary by Cookie, carry canonical request IDs; success carries server-owned `X-Skycar-Account`. Errors: 400 `VALIDATION_FAILED`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`/`CSRF_FAILED`, 404 `NOT_FOUND`, 409 `INVALID_TRANSITION`/`IDEMPOTENCY_CONFLICT`/`EXPERT_UNAVAILABLE`, 413 `PAYLOAD_TOO_LARGE`, retryable 503 `TECHNICIAN_UNAVAILABLE`. Unknown infrastructure exceptions are redacted.

GET detail optionally adds `own_quotes`: latest 20 quotes for this linked expert only, with ID, scope, AUD price, status and times. No other expert's proposal, actor/source IDs or customer contact becomes visible. Legacy detail decoding still accepts a missing `own_quotes` during fixture compatibility; new repository returns it. Lists remain unchanged.

## Frontend recovery

Quote form accepts device-local dates, converts them to exact instants and explicitly labels device timezone and Adelaide display. Refresh/account change discards drafts. On uncertain writes retain the exact key/body and allow only retry until reconciled. Denied/different-account writes clear private data/drafts/pending action. A focus refresh returning the same account may reconcile a stored uncertain result; no automatic repeated POST. A changed account cannot inherit an old action.

## Acceptance

- Disposable SQL: role/link/invitation/source checks, own-only supersession/decline, future times/insurance, exact replay/conflict, audit rollback, stale/competing customer selection and revoked proposal denial.
- Unit/API: strict body/response, origin/body cap/idempotency, private errors, bounded decoder and trusted account.
- Browser: technician quote/decline, same customer proposal, exact retry, denied/account-change clearing, refresh/stale outcomes and responsive layout.
- Independent review plus real hosted Auth/RLS/Storage and physical phone acceptance remain release gates. Expected payout stays unavailable.

## Local implementation checkpoint

- Build, TypeScript and lint pass; all 195 unit tests pass, including eight new command/decoder/account-precondition tests.
- All migrations apply in disposable PGlite. Existing 46 technician inbox assertions and 53 new quote/decline assertions pass. PostgreSQL-only exact-key/selection races and overlapping confirmation are wired into combined CI and are not claimed as locally run.
- New two-session quote/selection/decline browser passes, including exact retry after a lost reply, 401/403/404 and changed-account writes, draft clearing and 320/390/1440px layouts. Existing technician handoff, connected customer story and customer privacy browsers pass. APIs are mocked for browser presentation evidence.
- Screenshot: CI artifact `.garage-qa/technician-quote-mobile.png`. Self-authored evidence only; independent review and hosted/phone acceptance remain open.
- Proposal/decline is implemented; independent acceptance, persisted availability calendar, work progress/evidence/customer review and money/notifications remain later milestones.
