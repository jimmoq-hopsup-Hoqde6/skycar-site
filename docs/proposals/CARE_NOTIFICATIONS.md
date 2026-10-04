# Care notification delivery contract

Status: provider-independent M5 proposal for issue #52. This contract is
published before adapter consumption. It does not activate a provider, worker,
schedule, external message or hosted change.

## Separate facts

Skycar must never treat these as the same state:

1. **Stored event** — an authoritative domain transition committed with its
   audit record.
2. **Queued delivery** — a private outbox row says an approved recipient may
   need a message about that event.
3. **Provider accepted** — the configured provider accepted one idempotent send.
4. **Delivered** — the provider supplied the level of delivery evidence defined
   by its future reviewed adapter/webhook contract.

The current `care_notification_outbox` records event intent with `pending`,
`delivered` and `failed` fields, but no worker/provider is connected. Existing
rows must not be called delivered. This adapter returns a delivery decision; a
future restricted worker owns transactional outbox updates.

## First bounded message

Only the generic account message template is defined:

`care_update_available` — “There is an update to your Skycar service request.
Sign in to view it.”

The message contains no name, vehicle, registration, address, service details,
price, technician, issue text, payment state or photo. The authenticated product
view remains the source of truth. Guest cross-device recovery is not yet
implemented, so guest email/SMS delivery is outside this packet.

No marketing or promotional channel is authorised. Transactional consent and
channel eligibility still require a recorded product/legal decision before real
sends. Test authorization is synthetic and grants no real consent.

## Adapter job

The restricted worker will supply this exact object only after claiming a due
outbox row:

```json
{
  "delivery_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "event_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "recipient_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "channel": "email",
  "template": "care_update_available",
  "locale": "en-AU",
  "attempt": 0,
  "available_at": "2026-10-05T00:00:00Z"
}
```

- UUID `delivery_id` is the stable provider idempotency key for this queued
  recipient/channel/event delivery. It must not be regenerated on retry.
- UUID `event_id` is the authoritative existing Care event identifier.
- UUID `recipient_id` is an internal account reference, never a destination.
- First scope supports `email` only. Adding SMS, push or in-app delivery requires
  a contract revision and channel-specific consent/receipt semantics.
- `attempt` is zero-based, from 0 through 9. Attempts 0–8 may call the
  provider; attempt 9 is the exhausted sentinel and is terminal before
  authorization/provider work. The adapter never increments it.
- `available_at` is an absolute finite instant. A future worker must claim rows
  safely; the adapter also refuses a future job without contacting a provider.
- Unknown keys, malformed identifiers/instants, unsupported templates/channels,
  or out-of-range attempts fail closed before authorization.

## Injected authorization and endpoint resolution

The adapter receives a trusted `authorize(job)` dependency. It must recheck
current authority on every attempt, including a repeated delivery ID, before
provider deduplication:

- the event and outbox row still identify this exact recipient;
- the recipient is the current owner allowed to read the request;
- account/channel contact is verified and currently usable;
- required transactional consent is present and not withdrawn;
- the event/template/channel combination is allowed;
- the account and request have not moved into a state that suppresses delivery.

The exact authorization result is either `{allowed:false}` or
`{allowed:true,destination:string}`. A denied/wrong/withdrawn recipient is a
permanent `RECIPIENT_NOT_AUTHORIZED` result and the provider is never called.
An unavailable or malformed authorization dependency is retryable
`AUTHORIZATION_UNAVAILABLE`; the provider is still never called.
The destination is bounded, passed directly to the provider and never included
in result objects or logs.

This separation prevents a queue record from becoming a permanent entitlement
to contact someone. The provider adapter never queries auth, customer, journey
or consent tables itself.

## Provider interface and idempotency

The provider dependency implements:

```text
send({idempotency_key, channel, destination, template, locale})
```

It returns one of:

- `{status:"accepted",provider_message_id:string}`
- `{status:"retry",code:"PROVIDER_TEMPORARY"}`
- `{status:"failed",code:"PROVIDER_REJECTED"|"IDEMPOTENCY_CONFLICT"}`

Provider-specific errors, response bodies and credentials never escape this
interface. Unexpected exceptions become retryable `PROVIDER_TEMPORARY` without
raw error text in the result or logs.

The stable `delivery_id` is passed as `idempotency_key`. The worker may call the
adapter more than once after an ambiguous reply; the provider contract must
deduplicate the exact key/input. Reuse with changed channel, destination,
template or locale is an `IDEMPOTENCY_CONFLICT`, never a second send. The test
sink implements this behavior in memory; it is not durable provider evidence.

Provider `accepted` is recorded by the adapter as `delivered` only for the test
sink's declared acceptance semantics. A future real provider contract must say
whether acceptance, webhook delivery or another receipt advances the durable
outbox to `delivered`. Until then, no real provider is allowed.

## Adapter outcomes

Every resolved adapter result contains exactly:

```text
{delivery_id,status,code,provider_message_id?,available_at?}
```

- `delivered` + `DELIVERED` includes an opaque provider message ID.
- `retry` + `AUTHORIZATION_UNAVAILABLE` or `PROVIDER_TEMPORARY` includes the
  next absolute `available_at`.
- `failed` + `RECIPIENT_NOT_AUTHORIZED`, `PROVIDER_REJECTED`,
  `IDEMPOTENCY_CONFLICT` or `ATTEMPTS_EXHAUSTED` is terminal.
- `not_due` + `NOT_DUE` includes the existing `available_at` and makes no
  authorization/provider call.

The adapter throws validation errors for a malformed trusted-worker job; it does
not convert programmer/queue corruption into a delivery outcome.

## Retry schedule and visibility

Retry delay after failed attempt 0–8 is deterministic for this boundary:

`60s, 5m, 30m, 2h, 8h, 24h, 24h, 24h, 24h`; attempt 9 is terminal.

The adapter calculates the next time from its injected clock. The future worker
atomically increments attempts, stores the stable code and moves `available_at`,
or marks the row terminal. Provider error bodies are never stored in
`last_error`; future migration should rename or constrain it to a stable code.

Operations need counts and oldest age for pending/retrying/terminal delivery,
plus the stable failure code. Customer/technician screens must continue reading
authoritative journey state even if delivery fails. Notification failure cannot
roll back, advance, cancel, charge, refund or pay a job.

## Logging

One allow-listed metadata event is emitted after each resolved attempt:

```json
{
  "event": "notification_delivery",
  "deliveryId": "uuid",
  "eventId": "uuid",
  "channel": "email",
  "template": "care_update_available",
  "attempt": 0,
  "outcome": "delivered"
}
```

Logs never include recipient IDs, destination/contact, message copy, customer or
vehicle fields, provider response/error text, consent data, credentials or
provider message IDs. A failing log sink cannot change the delivery result.

## Future integration request

No integration is part of this packet. Delivery & Review must allocate one
Backend/outbox owner before changes to shared source. The exact future request:

1. Publish a forward migration that expands the outbox to stable
   delivery-per-channel IDs, bounded failure codes, claim leases and attempt
   timestamps without rewriting prior migrations.
2. Map only approved Care events to the generic template. The existing
   `care_append_event` atomic event/outbox behavior remains; connected journey
   events need a separately reviewed outbox bridge, not direct provider calls
   from command RPCs.
3. Add a service-only claim/finalize worker with `FOR UPDATE SKIP LOCKED`, lease
   recovery, exact outcome transitions and audit/metrics. No public HTTP worker
   or browser database grant.
4. Implement a trusted authorization resolver that joins the current event,
   request ownership, verified contact and consent at every attempt.
5. Configure a reviewed provider adapter, secrets and webhook/inbox contract in
   a protected environment. Required environment names are not chosen until the
   provider is approved; no secret values belong in GitHub or logs.
6. Add real PostgreSQL concurrency/lease/deduplication/rollback tests, provider
   sandbox evidence, wrong-recipient tests, monitoring/recovery runbook and #8
   staging/release acceptance.

Files expected to intersect later include a new forward migration, a restricted
worker under `src/server/jobs/`, outbox repository, provider adapter and focused
integration tests. Journey RPC/repository changes remain blocked until their
current owner hands them over. Payment state remains entirely separate.

## Acceptance for this isolated packet

Unit tests must prove:

- repeated delivery uses the same provider key and produces one sink message;
- changed input on the same key conflicts;
- retryable failure produces the documented next time and can later succeed;
- permanent provider rejection is terminal;
- wrong/withdrawn recipient never reaches the provider;
- future/not-due and exhausted attempts do not call authorization/provider;
- malformed jobs fail before dependencies;
- destinations, message content and raw provider errors never appear in
  results/logs.

These are local contract tests only. They do not establish stored worker state,
real consent, real provider delivery, hosted operation or production readiness.
