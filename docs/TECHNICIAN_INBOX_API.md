# Technician identity and private inbox — first increment

Draft on `feature/technician-inbox`, based on PR #48. Not migrated or deployed.

## Authority and lifecycle

The connected Care journey from PR #47 remains the booking authority. This increment does not consume the older draft `care_offers` ledger or create another booking lifecycle. Technician quote publication will extend the connected reviewed-quote contract in a subsequent reviewed increment. An invitation grants review access only; it is never acceptance, a reserved slot or a confirmed appointment.

An administrator links one already-authorised technician user to one active expert record. The account must already hold the server-granted `technician` role. Linking does not grant a role, verify credentials/insurance or create a user. Self-linking and implicit reassignment are forbidden. Operations is responsible for verifying identity before submitting the link.

New account, invitation and command tables have RLS and no anonymous/authenticated privileges. Service-only RPCs recheck the verified actor's stored role and active expert link. Every HTTP call verifies its cookie session first. Technicians receive no administrator access or customer Garage access.

## Operator commands

Existing `POST /api/v1/operations/care`, trusted origin and UUID `Idempotency-Key`:

| Action | Body |
| --- | --- |
| `bind_technician` | `{action, payload:{expert_id,user_id}}` |
| `invite_technician` | `{action,id:<request UUID>,payload:{expert_id}}` |
| `revoke_technician_invitation` | `{action,id:<request UUID>,payload:{expert_id}}` |

Bind requires an active expert and existing technician role. A different existing account/expert link returns `LINK_CONFLICT`; it is not overwritten. Invite requires an active linked technician, matching service/postcode, current insurance and a review/quotes-ready journey with no selected expert. Account requests require current vehicle ownership and an active vehicle. Missing service location returns `DETAILS_REQUIRED`. Revocation removes review access; it does not cancel an assigned booking. All commands are audited atomically and exact key/action/request/payload replay returns the original result with `replayed:true`. Changed reuse returns `IDEMPOTENCY_CONFLICT`.

Operations GET includes `technician_account_linked` on each expert and `technician_invitations` on a selected journey. No session, credential or password is exposed.

## Technician reads

| Route | Result |
| --- | --- |
| `GET /api/v1/technician/jobs` | Own profile, newest 50 eligible job summaries and `has_more` |
| `GET /api/v1/technician/jobs/{id}` | Own profile and the authorised job detail, including request photo slot numbers |
| `GET /api/v1/technician/jobs/{id}/photos/{slot}` | Verified private request image, never an object path/public URL |

No query parameters are accepted. UUIDs and photo slots 1–3 are validated. All responses/errors are private/no-store and vary by Cookie. JSON uses the canonical request-ID envelope; success carries server-owned `X-Skycar-Account`. Missing/foreign/revoked/ineligible jobs share 404 `NOT_FOUND`. Anonymous is 401; wrong role, inactive or missing link is 403. Missing migration/configuration fails closed with retryable 503; no demo-success fixtures.

Review access requires an active invitation, service/postcode/insurance eligibility, and a journey still open for review with no expert selected. Selection removes access from competing invitees. The selected expert can read their requested/confirmed/in-progress/completed/cancellation-requested job. Cancelled jobs are omitted. Role/link deactivation denies all subsequent reads.

Before confirmation, explicit contact/address fields are omitted. Once scheduled/in-progress/completed, only the selected technician receives service contact/address. Lists omit contact fields entirely. No other expert's quote, customer identifier, guest email, Garage registration/history, source payload, internal command or storage path is returned. Request descriptions/photos are customer-supplied evidence for authorised review; operations must consider sensitive content when inviting a technician.

The first inbox is read-only. It displays authoritative status and proposed/confirmed appointment wording, with expected payout unavailable until an approved server-owned payout contract exists. Availability editing, technician quote/decline commands, job progress/completion, payment and notifications remain follow-up work. Do not imply these actions are delivered.

## Acceptance and release

Disposable SQL tests must prove stored actor roles/link checks, invite/selected separation, denial of unrelated jobs/table mutation, contact redaction, competing selection, role/invitation revocation and exact admin replay/conflict/audit rollback. Unit/API tests cover strict response decoding, private errors and photo access. Browser fixtures cover operator link/invite/revoke handoff, an isolated technician session, inbox/detail, denied refresh clearing, confirmation contact visibility and 320/390/1440px layouts. Existing customer privacy regressions cover account changes and stale responses. Hosted Auth/RLS/Storage and physical-phone tests remain separate gates; no hosted role grant or migration is authorised by this document.

## Local checkpoint

- Build, lint and TypeScript pass; all 187 unit tests pass.
- All migrations apply to a disposable PGlite database; 46 technician SQL assertions pass, including permission denial, exact replay/conflict, contact redaction, competing selection, insurance failure and audit rollback. Real PostgreSQL CI remains required.
- Technician handoff browser, existing operations browser, connected customer story and customer privacy browser pass with mocked APIs. These prove screen behaviour, not hosted Supabase authorisation.
- This is self-authored implementation evidence. Independent review and hosted/physical-phone acceptance remain open.
