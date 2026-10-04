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
