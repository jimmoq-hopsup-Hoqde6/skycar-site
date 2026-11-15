# Technician fulfilment API — M3 slice 1

Status: proposed implementation contract, based on frozen #56. Completion evidence and customer sign-off are reserved follow-up slices.

POST /api/v1/technician/jobs/{id}, existing private envelope/origin/account rules:
- Idempotency-Key: UUID; X-Skycar-Account: verified technician UUID.
- Body exactly {"action":"start","payload":{}}.
- Result exactly {"id":UUID,"action":"start","state":"in_progress","quote_id":null,"replayed":boolean}.
- HTTP 401/403/404/409/503 follow TECHNICIAN_QUOTES_API.md; errors remain private/no-store.

Server-only RPC care_technician_work_command(p_actor uuid,p_key uuid,p_action text,p_id uuid,p_payload jsonb), security invoker executable only by service_role. Actor comes from verified session, never body. Stored technician role, active expert/account mapping and current source vehicle ownership/archive checks are mandatory. Lock order: expert/account share; actor/key advisory; vehicle; account request; journey. Shared care_technician_commands ledger makes reuse of quote/decline keys conflict.

New starts require selected expert, selected reviewed quote belonging to that journey/expert, scheduled state, non-null appointment already started, current service/postcode eligibility and insurance covering appointment end/current Adelaide date. Assignment, rather than old invitation status, authorises fulfilment. Job cannot start while booking_requested, cancellation_requested, cancelled or completed.

Exact retry rechecks current role/link/source and selected assignment before returning recorded result, even after later completion. No duplicate transition/event/audit. A new key after a successful start returns INVALID_TRANSITION. Atomic updates: care_journeys.state=in_progress + revision; account care_requests.fulfilment_state=in_progress; work_started event; care.technician_start audit; command/result. Audit failure rolls all back. Existing operations start and capacity-checked confirmation remain unchanged. No payout/payment change.

GET projections are unchanged: customer and selected technician read the same care_journeys state. Frontend offers start only on selected scheduled jobs after local appointment start (server is authoritative), asks technician confirmation, binds write to current account, and preserves exact body/key after uncertain reply. Private drafts/results clear on denied/different-account access.

Acceptance: guest/account positive start + shared read; early/unassigned/invalid-state/malformed/role/link/source/eligibility negatives; exact and cross-action retries; rollback; real PostgreSQL concurrent same-key and start/cancel race; mocked two-session browser handoff and account safety. Independent/hosted/device acceptance stays separate under #51/#8.

## M3 slice 2 — technician completion contract (published before consumption)

Base: frozen #57 1ffff272ff67f8b55383292e065663daa0d31515. Dedicated feature/technician-completion branch.

POST /api/v1/technician/jobs/{id}/completion-photos:
- same trusted origin, no query, current X-Skycar-Account UUID precondition; multipart/form-data with only photos, 1–3 JPEG/PNG/WebP files of 128–900000 bytes, bounded whole body 2800000 bytes; magic bytes checked server-side.
- success private envelope 201 data {"stored":1..3}, verified account header. Current linked active technician/selected expert/source ownership and in_progress state checked before storage.
- shared private care-completion/{id} manifest and immutable photo slots; retry must use identical count/order/bytes. A different manifest returns 409 IDEMPOTENCY_CONFLICT and never overwrites. Partial storage failure is retryable; upload never completes work. Storage and PostgreSQL cannot be one transaction: completion rechecks all live authority/state and every uploaded byte before committing.
- no client-supplied storage paths, evidence hashes, expert or owner IDs. Upload is content-idempotent, distinct from database command keys.

GET completion-photos/{slot}: private bytes with account header, selected technician only in_progress/completed, current source/link/role checks. Detail adds optional completion_photos slots, only for selected in_progress/completed. Customer completion list/bytes are visible after committed completed state; operations keeps authorised pre-completion evidence preview.

POST existing technician jobs/{id}: {"action":"complete","payload":{}} with required UUID Idempotency-Key/current account header.
- server reads immutable private manifest and downloads/verifies every size/SHA/MIME byte; caller cannot provide evidence metadata.
- service-only care_technician_work_command adds complete with derived evidence payload. Current role/link/expert/selected quote and source ownership required even for replay. New complete only in_progress. Insurance/service coverage was gated at start; later expiry does not prevent recording already-performed work.
- same shared actor/key command ledger; exact retry returns recorded result, conflicting key/action/payload fails. Success result {"id":UUID,"action":"complete","state":"completed","quote_id":null,"replayed":boolean}.
- atomic journey completion_evidence/state/revision, account fulfilment_state, one care_service_completed vehicle-history event, work_completed event, care.technician_complete audit and command result. No payment or customer acceptance implied; those lifecycles remain separate. Operations completion retains its existing path and permissions.

Frontend: selected in-progress job offers up to three prepared/compressed photos and explicit completion confirmation; exact files retained for uncertain upload retry and exact body/key for command retry; different-account/denied reads or writes clear private files/previews/drafts/attempts. Upload success refreshes saved photos; completion is separate action. Customer sees same completed record and private evidence.

Acceptance: bounded/auth/origin/account media HTTP tests, byte-integrity/storage retry tests, SQL guest/account completion/one history/role-link-source-denials/replay/conflict/audit rollback/real races, and two-session browser upload→complete→customer evidence with uncertain retries and account clearing. Independent/hosted/device gates #51/#8 stay HIGH PRIORITY. Customer review/issue reporting is pending, not self-approved.

Recovery clarification: technician detail completion_photos lists ready slots only after every private image verifies. During in_progress an incomplete set yields no ready slots and the upload control stays available to reselect identical files/order after a browser restart. Immutable storage still rejects a changed set. Completed evidence failures remain unavailable errors. No second media ledger or booking state is introduced.

Upload preflight: service-only care_technician_completion_upload_access(p_actor uuid,p_id uuid) returns true for a currently linked technician's selected in_progress job, including source ownership and unarchived account vehicle. Historical selected inbox/media read permissions are preserved. The upload preflight and completion commit are independent current-authority checks.

## M3 slice 3 — customer completion review contract (published before consumption)

Base: frozen #58 75713f15d12a3ca89531e1146b8e6213ccf0a2bf. Dedicated feature/customer-completion-review branch.

Data remains separated:
- care_journeys.state remains completed after technician/operations completion.
- completion_review_state is a separate nullable lifecycle: awaiting_review, confirmed, issue_reported. A forward trigger sets awaiting_review whenever work first becomes completed; existing completed test rows are backfilled.
- completion_issue_details is private, trimmed plain text only for issue_reported, 10–2000 characters. No public review, rating, payment, refund, payout, technician penalty or external notification is created.

Existing POST /api/v1/care/journey/{id}, same guest HttpOnly capability/account ownership/origin/idempotency/account-response rules:
- {"action":"confirm_completion","payload":{}}.
- {"action":"report_completion_issue","payload":{"details":"..."}}.
- success keeps state:"completed" and returns exact {"id":UUID,"state":"completed","revision":integer,"review_state":"confirmed"|"issue_reported","replayed":boolean}.
- only the owning customer/guest, never admin/technician, can write. Job must be completed with verified completion evidence and review_state awaiting_review. One final outcome only; new keys after either outcome return INVALID_TRANSITION.
- report text is required exact shape, trimmed, length 10–2000; confirmation payload is exactly empty. No attachments in this slice.
- a service-only security-invoker care_customer_completion_review_command rechecks current customer role/account vehicle ownership or guest capability, locks in Garage/Care order, shares care_journey_commands actor-scope/key ledger with existing customer commands, and atomically writes review state/revision, completion_confirmed or completion_issue_reported event, audit and exact result. Exact retry remains valid with the same current access and produces no duplicate event. Audit failure rolls back.

GET customer/operations projection adds completion_review:{state,issue_details}. issue_details is present only for issue_reported. Technician projection remains unchanged and never receives issue text. Events expose only the outcome type, never the report text.

Customer UI after completed evidence:
- awaiting_review shows two explicit paths: confirm the completed work, or report a private issue with 10–2000 characters. Copy states that neither action charges/releases/refunds money.
- exact key/body is retained after an uncertain reply. 401/403/404 or account/capability change clears issue draft, private journey and pending attempt.
- confirmed and issue_reported render final acknowledgement and no duplicate controls. Issue report directs the customer that Skycar operations will review it; no promise of refund/resolution timing.
- operations can read the private issue through the existing authorised journey projection for manual follow-up. No notification send.

Acceptance: guest/account positive outcomes; admin/technician/other owner denial; not-completed/missing-evidence/final-state/shape/length/replay/key-conflict/source-transfer negatives; event/audit rollback and real concurrent confirm-vs-issue race; customer/operations projection privacy; mocked browser exact retry/account clearing and responsive states. Independent/hosted/device gates #51/#8 remain HIGH PRIORITY.
