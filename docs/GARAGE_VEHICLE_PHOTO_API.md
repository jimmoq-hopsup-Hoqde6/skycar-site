# Garage actual-vehicle photo API — private-original slice

Tracks #2 and D-006. This contract is published before frontend consumption. It
implements private intake of a customer's actual vehicle photo; it does not claim
that clean/plain-background display processing is available.

## POST `/api/v1/garage/vehicles/{vehicleId}/photo`

Requires `FEATURE_GARAGE=true`, configured public Supabase session settings, the
server-only `SUPABASE_SECRET_KEY`, a verified cookie session and an active vehicle
owned by that session. Missing and other-owner vehicle IDs return
the same `404 NOT_FOUND`; archived vehicles return `409 VEHICLE_ARCHIVED`.

The request body is the image bytes, not JSON:

- `Origin` must exactly match the request URL origin and cross-site requests fail
  closed.
- `Idempotency-Key` is a UUID scoped to the authenticated actor.
- `Content-Type` must be `image/jpeg`, `image/png` or `image/webp`.
- Body size is 128 bytes through 10,000,000 bytes. The server reads a bounded
  stream and checks that JPEG/PNG/WebP magic bytes match the declared media type.

Skycar derives the private bucket, object path, owner, vehicle, purpose, digest and
processing state. Clients cannot send those authoritative values. The original is
stored under the authenticated user's private path; neither the path nor a public
URL appears in the response.

First success returns `201`; an exact replay returns `200`:

```json
{
  "data": {
    "id": "asset-uuid",
    "vehicle_id": "vehicle-uuid",
    "purpose": "vehicle_original",
    "mime_type": "image/jpeg",
    "size_bytes": 245300,
    "processing_state": "stored",
    "created_at": "2026-09-21T00:00:00Z",
    "original_status": "stored",
    "display_status": "unavailable",
    "replayed": false
  },
  "meta": { "requestId": "request-uuid" }
}
```

`display_status: "unavailable"` is intentional. No background-removal adapter is
approved or connected, so this slice never substitutes the private original or
pretends that the clean-background derivative exists. A later contract will add
processor ownership, derived private assets, failure/retry and authorised signed
display access before the Garage UI consumes this endpoint.

## Retry and errors

The same actor/key/vehicle/media type/exact bytes replays one metadata record and
one history/audit event. Reusing the key with different bytes, media type or vehicle
returns `409 IDEMPOTENCY_CONFLICT`. The trusted server reserves authoritative
metadata before storage. If storage succeeded but final confirmation was interrupted,
retrying the exact bytes reconciles that reservation and deterministic private path.
Definitive upload failures remain recorded as failed/quarantined metadata rather than
deleting an object that a concurrent successful attempt may have committed.

| Status | Code | Meaning / client action |
| --- | --- | --- |
| 400 | `INVALID_IMAGE`, `VALIDATION_FAILED` | Choose a complete supported image; do not reuse the failed body blindly. |
| 401 | `UNAUTHENTICATED` | Clear private UI state and sign in. |
| 403 | `ORIGIN_REJECTED` | Reload from Skycar; never retry cross-origin. |
| 404 | `NOT_FOUND` | Vehicle is unavailable without ownership disclosure. |
| 409 | `VEHICLE_ARCHIVED` | Archived vehicles cannot receive a new photo. |
| 409 | `IDEMPOTENCY_CONFLICT` | Do not silently create another key for the same uncertain attempt. |
| 413 | `PAYLOAD_TOO_LARGE` | Select an image no larger than 10 MB. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Use JPEG, PNG or WebP. |
| 503 | `GARAGE_UNAVAILABLE`, `TEMPORARILY_UNAVAILABLE` | Preserve exact bytes/key and retry after recovery. |
| 500 | `INTERNAL_ERROR` | Generic failure only; storage/database details stay private. |

All responses use `Cache-Control: private, no-store` and `Vary: Cookie`.

## Security and verification boundary

Migration `202609200300_garage_vehicle_photos.sql` revokes direct authenticated
metadata writes and direct execution of all photo mutation functions. Reservation,
finalisation and quarantine functions are executable only by `service_role`; the
application obtains the actor from the separately verified cookie session and passes
only server-derived metadata through that trusted server client. Reservation validates
ownership and active state before upload. Finalisation verifies storage and records
history/audit exactly once. Direct authenticated Storage writes/deletes are revoked;
the bucket remains private and owner-readable under the existing D-006 policy.

Disposable PostgreSQL and injected-handler tests do not establish hosted Supabase
Storage/JWT behavior. Release still requires isolated two-user PostgREST/storage
negative tests, signed-in device upload evidence, processor approval and derived
image privacy/quality verification. No production migration or provider activation
is authorised by this contract.
