# Care technician offers API — first fulfilment slice (#14)

Contract version: 1. Scope: reviewed technician offers and real appointment
options after a Care request exists. This contract does **not** accept an offer,
reserve a slot, create a booking, charge a customer or start fulfilment.

## Customer read

`GET /api/v1/care/requests/:id/offers`

Requires a verified customer session and `FEATURE_CARE=true`. The database
derives the caller from `auth.uid()`; a foreign or missing request returns the
same 404. Responses are private/no-store.

Only currently issued, unexpired offers are returned. Each offer contains:

```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "request_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "scope_summary": "Repair and refinish rear bumper scratch",
  "total_price_cents": 49500,
  "currency": "AUD",
  "adjustment_reason": "Estimate increased after technician photo review",
  "status": "issued",
  "expires_at": "2026-09-24T06:00:00Z",
  "created_at": "2026-09-22T00:30:00Z",
  "updated_at": "2026-09-22T00:30:00Z",
  "slots": [
    {
      "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "starts_at": "2026-09-23T00:30:00Z",
      "ends_at": "2026-09-23T03:30:00Z",
      "status": "available",
      "created_at": "2026-09-22T00:30:00Z"
    }
  ]
}
```

Technician identity is deliberately not exposed by this first backend contract.
A later reviewed presentation contract may expose approved profile/review fields;
the customer must never receive private technician account data.

## Publishing boundary

`care_publish_offer(...)` is service-role only. It validates:
- existing request;
- a server-granted technician role;
- positive AUD total price;
- scope and optional adjustment explanation;
- future offer expiry;
- one to twenty future appointment windows.

Publishing a newer offer for the same request/technician supersedes the previous
issued offer. It records an audit event. Authenticated clients have no direct
table write grants and cannot call the publishing function.

This slice intentionally does not modify `care_requests` customer projection.
The future reviewed integration step will move a request to `offers_ready` only
when the offer/slot set is authoritative. Until then existing request/status UI
must not fabricate that stage.

## Errors

400 VALIDATION_FAILED, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND,
503 CARE_UNAVAILABLE / TEMPORARILY_UNAVAILABLE, 500 INTERNAL_ERROR.

## Next dependency

After this contract is reviewed and database-tested:
1. approved technician profile fields for comparison;
2. race-safe single operation that accepts offer + appointment slot;
3. booking projection;
4. separate payment lifecycle.

No payment provider, production migration, live technician dispatch or booking
activation is authorised by this change.
