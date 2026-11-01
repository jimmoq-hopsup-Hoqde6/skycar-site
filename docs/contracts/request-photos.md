# Customer request photos: contract

Status: proposal for review. Frontend-authored; grounded in `5374cea`. Nothing here changes the backend. Section 6 lists every backend item and whether it exists today.

## 1. Signed-in request form: 0-3 photos, same as the guest flow

**Today**
- Guest form (`guest-request-form.tsx`): optional 0-3 photos, sent in the same multipart request as the details (`POST /api/v1/care/guest-requests`, parts `details` + `photos`). Photos are written after the intake RPC succeeds (`guest-photos.mjs`).
- Signed-in form (`request-form.tsx`): no photo picker. `POST /api/v1/care/requests` is JSON only.
- A signed-in request can still get photos after it exists: `POST /api/v1/care/journey/:id/photos` accepts an owner session (`journeyAccess` resolves `care_requests` rows, checks `customer_id` and the `customer` role). Allowed only while the journey is absent, `review` or `quotes_ready`. The journey page already uses it (`journey/customer.tsx`, shown only while the request has no photos).

**Contract (no backend change)**
1. Request form shows the shared `DamagePhotos` picker, optional, 0-3, same labels and copy as the guest flow.
2. Submit = two calls: (a) existing `POST /api/v1/care/requests` (unchanged); (b) if photos were chosen, `POST /api/v1/care/journey/{request.id}/photos` as multipart with only `photos` parts.
3. The request is the source of truth. If (a) succeeds and (b) fails, the request exists without photos. UI must say so, keep the exact prepared files for a retry, and offer "continue without photos" (the journey page picker remains available while no photos are stored).
4. Retries must resend the same bytes: the server stores a write-once manifest with SHA-256 per slot (`storeCarePhotos`); different bytes for an existing manifest return `IDEMPOTENCY_CONFLICT`.
5. Not atomic. Only a backend change (section 6, N1) makes request + photos one commit point.

**Known limits of the existing route**
- One batch only: after a manifest exists, no photo can be added, replaced or removed (no route for it).
- Signed-in account uploads were not rate limited in `5374cea`. The backend draft branch adds a limit of 10 successfully recorded sets per hour (section 5, N6). Guests are limited inside the intake RPC.

## 2. HEIC

| | A. Client-side (browser decodes, re-encodes to JPEG) | B. Server-side (accept HEIC, convert on the server) |
|---|---|---|
| Fits today's contract | Yes: server still sees JPEG <= 900 KB | No: new validation, a decoder (libheif/sharp) in the Node runtime, new size caps |
| Size/limits | Phone HEIC often 2-5 MB; resized in the browser before upload | Raw HEIC would exceed the 900 KB and 2.8 MB body caps and Vercel's request-body limit |
| Reliability | Depends on the browser: Safari can decode HEIC, Chrome/Firefox generally cannot | Works for any browser |
| Security | Server keeps strict magic-byte allow-list (JPEG/PNG/WebP) | Adds a native image parser to the attack surface |
| Cost | None | Dependency, build/runtime risk, compute per upload |

**Recommendation: A, without a new dependency.** The picker already re-encodes everything to JPEG on a canvas (<= 1200 px, quality 0.78, <= 900 KB), so a HEIC file the browser can decode needs no extra code beyond allowing it through validation. Keep `accept` as JPEG/PNG/WebP: iOS Safari then hands over a JPEG for library/camera picks (documented WebKit behaviour; verify on a real device, it is not tested here). If the browser cannot decode a HEIC file, show a specific message. A bundled WASM decoder is a later option and needs owner approval for the dependency and licence (libheif is LGPL). Server-side conversion is not recommended.

## 3. Counts and sizes

| Rule | Value | Enforced by |
|---|---|---|
| Photos per request | 0-3 in the form (optional); route needs 1-3 per upload call | picker; `readGuestPhotos` (max 3), route rejects empty |
| Slot order | 1-3, UI labels Whole car / Affected area / Close-up | slots in manifest; labels are UI only |
| Input file | JPEG/PNG/WebP, <= 15 MB, <= 60 MP (HEIC: see 2) | picker |
| Stored file | JPEG/PNG/WebP, 128-900,000 bytes, magic bytes must match MIME | `readGuestPhotos` |
| Whole body | <= 2,800,000 bytes | `boundedBody` |

## 4. Private media paths and ownership

**Exists today**
- Bucket `private-media`, `public = false` (`202609200001_foundation.sql`).
- Paths: guest `guest-requests/{id}/`, signed-in `care-requests/{id}/`, completion `care-completion/{id}/`; each has `manifest.json` (slot, mime, size, sha256, written once) plus `photo-1..3` (`journey/repository.ts`, `photoPrefix`).
- Storage RLS: `private_media_read_own` lets an authenticated user read objects whose first folder equals their `auth.uid()`. Care paths start with `care-requests`, so it never matches them. Insert/delete policies were dropped and `insert, update, delete on storage.objects` revoked from `authenticated` (`202609200300_garage_vehicle_photos.sql`).
- All care reads/writes use the trusted server client after `journeyAccess` checks ownership (customer id + role), guest cookie, or admin. No browser access to Storage and no public URLs.
- Garage vehicle photos are a separate path (`media_assets`, `/api/v1/garage/vehicles/:id/photo`) and unrelated to request photos.

**Proposed**
- No new RLS or Storage policy. Keep the server-mediated model; do not grant `authenticated` any direct Storage access to `care-requests/`.
- The signed-in path `care-requests/{id}` is implemented but not shown to be verified against hosted Supabase in `docs/` (the hosted checks recorded there cover guest photos). Backend/QA should run the hosted acceptance for it before launch (section 6, E7).

## 5. Showing request photos in My Jobs and Garage

**Read path today** (one path for owner, guest and admin)
- `GET /api/v1/care/journey/:id` returns `photos: [slots]` (from the manifest).
- `GET /api/v1/care/journey/:id/photos/:slot` returns bytes: `private, no-store`, `Vary: Cookie`, `X-Skycar-Account`. `PrivateJourneyPhoto` fetches it, checks the account header, shows a blob URL. **No signed URLs exist, and the backend has removed the signed-URL route (N4).**
- My Jobs: cards link to `/care/journey/:id`; the photos show there. The list (`care_list_requests` / `CareListItem`) has no photo field, so no thumbnails or counts on cards.
- Garage: shows vehicle photo and completion history only; nothing about request photos.

**Proposed**
- My Jobs: keep photos on the journey page. For card hints a photo count needs a DB-visible value (N2, now present on the backend draft branch); the frontend must not fetch a journey per card.
- Garage: no request photos now. If wanted, per-vehicle request history needs N3. Completion evidence already reaches Garage history as events.
- Signed URLs: **dropped (N4).** The backend removed the signed-URL route in `950a17c`. The proxy route `GET /api/v1/care/journey/:id/photos/:slot` is the **sole display path**. It keeps the account-binding header and `no-store`, and avoids bearer links to private images.

**Status on the backend draft branch `feature/request-photos-backend` (`950a17c`, not merged).** Verified against that branch's code; everything below is draft until merged.

**Upload limit (N6).** `POST /api/v1/care/journey/:id/photos` allows **10 successfully recorded photo sets per hour** per signed-in account (fixed window of 3600s, atomic database counter). A slot is **reserved before anything is stored** and **released if that call fails**: invalid, oversized or CSRF-rejected bodies, storage or marker 503s. **Conflicts (409 `IDEMPOTENCY_CONFLICT`) and replays of a recorded set never reserve a slot, so they have nothing to release.** Only the call that records the request's photo marker keeps its slot. So an identical retry after a 503 counts **once**, and **re-sending an already recorded set is free**, even at the limit (such a call never reserves; this needs the marker, see below). **Guest uploads and admin completion uploads (`?kind=completion`) take no quota**; their sets are write-once, and guests are limited by intake. If the counter cannot be read, the route fails closed with 503. The eleventh new set in a window returns `429 {"error":{"code":"RATE_LIMITED","message":"...","retryable":true}}` with `Retry-After: <integer seconds>`, and nothing is stored. The wait is the rest of the fixed window, so it **can still be up to 3600s**. A crash between reserve and release holds the slot until the window ends. The limit bounds stored sets, not request volume: rejected bodies are bounded by the 2.8 MB body cap and platform throttling. The frontend (#79) shows the server message, disables retry with a countdown from `Retry-After`, and resends the same files. Success is unchanged (201 `{data:{stored:n}}`). Verified against `feature/request-photos-backend` at `9d3baac`; at `950a17c` a re-send of a recorded set is answered from the stored manifest hash (identical: 201; different: 409 `IDEMPOTENCY_CONFLICT`), still free. **"No Storage I/O" holds only when a marker exists.** With no marker (an older request, or a marker write that failed) the route first checks Storage read-only, and only then records the marker.

**Photo marker behind `photo_count` / `has_photos` (N2).** The write-once table `care_request_photo_sets` is set by the trusted route only, for non-completion uploads, after Storage confirms the manifest, through the service-role RPC `care_record_request_photos`. It is idempotent, and a different count or hash returns `IDEMPOTENCY_CONFLICT`. `care_list_requests` returns `photo_count` (0-3, coalesced to 0) and `has_photos` on each item. There is **no backfill**: old requests and requests without a marker report 0, so the UI must never claim "no photos" from a zero. Requests photographed before the backend migration have no marker until the identical photos are re-sent. If recording the marker fails, the route returns a **retryable 503** (`retryable:true`) and releases the quota slot. Re-sending the same photos fixes it, because Storage and the marker are both idempotent for an identical resend, and that retry counts once. **Healing is not free:** with no marker the re-send is a new set for the quota, so an account already at the limit gets `429 RATE_LIMITED` with `Retry-After` and the marker stays missing until the window resets. At `950a17c` the marker also stores the manifest SHA-256 and a request kind. **Guest uploads also get a marker (the backend is adding this; treat it as pending until it lands on `feature/request-photos-backend`).** Only account markers feed `care_list_requests`, because guests have no My Jobs list. If a marker write fails (503) and the journey then leaves `review`/`quotes_ready`, `has_photos` stays false until the owner re-sends the identical complete set, which verifies Storage read-only and records the marker.

**Decision: signed URLs (N4) are dropped; the proxy route is the sole display path.** The backend branch had added `GET /api/v1/care/journey/:id/photos/:slot/url`; it was removed again in `cf0637e` (part of `950a17c`). Every page that shows photos uses the proxy route: the request page, customer journey and operations pages through `PrivateJourneyPhoto`, and **the technician pages through their own proxy fetch, not `PrivateJourneyPhoto`**: a local `PrivatePhoto` in `technician/inbox.tsx` calls the technician routes `/api/v1/technician/jobs/:id/photos/:slot` and `.../completion-photos/:slot` (verified at `5374cea`), not the journey route. Both are same-origin proxies; neither uses signed URLs. #80 enforces this: UI tests fail if any of those pages request a `/photos/:slot/url` URL, and a unit test fails if browser code references it. This resolves the earlier open question; no further QA ruling is needed.

## 6. Backend needs

Tag: **EXISTING** = in `5374cea`, no change; **NEW** = needs backend work. N2 and N6 are now **PRESENT (draft)** on `feature/request-photos-backend` (`950a17c`); N4 is **DROPPED**, pending review and merge.

| # | Item | Tag | Needed for |
|---|---|---|---|
| E1 | `POST /api/v1/care/journey/:id/photos` for owner (`care-requests/{id}`), multipart `photos` 1-3, states absent/review/quotes_ready | EXISTING | signed-in photos (two-call flow) |
| E2 | `GET /api/v1/care/journey/:id` `photos: [slots]` | EXISTING | showing photos |
| E3 | `GET /api/v1/care/journey/:id/photos/:slot` private bytes + `X-Skycar-Account` | EXISTING | showing photos |
| E4 | Storage bucket `private-media`, write-once `manifest.json` + `photo-N`, service-role writes | EXISTING | storage |
| E5 | Storage RLS: `private_media_read_own` (first folder = uid, inert for care paths); insert/delete removed, writes revoked from `authenticated` | EXISTING | ownership model |
| E6 | Ownership checks in `journeyAccess` for `care_requests` (`customer_id` equals the session user, `customer` role, vehicle owner match) | EXISTING | auth |
| E7 | Hosted acceptance of the signed-in photo path (upload, read, cross-account denial) | EXISTING route, **NEW verification** | launch confidence |
| N1 | Optional: `POST /api/v1/care/requests` accepts multipart (`details` + `photos`) so request and photos share one idempotency key | NEW route change (no migration if photos are written after the RPC, as the guest route does) | atomic UX |
| N2 | Optional: photo count/flag on `care_list_requests` (manifests live in Storage, so a DB column or view set by the trusted route, with a migration) | **PRESENT (draft)**: `care_request_photo_sets` + `care_record_request_photos` + list projection | My Jobs card hint |
| N3 | Optional: per-vehicle request photo/history read for Garage | NEW route (maybe RPC) | Garage display |
| N4 | Optional: signed-URL route (short TTL, after `journeyAccess`) | **DROPPED**: removed from the backend branch in `950a17c`; the proxy route is the sole display path (section 5) | nothing |
| N5 | Optional: replace/remove or add-more photo route (today write-once, one batch) | NEW route + manifest rules | edit after submit |
| N6 | Optional: per-account upload rate limit on the photo route | **PRESENT (draft)**: 10 recorded sets/hour per signed-in account, 429 `RATE_LIMITED` + `Retry-After` | abuse control |
| N7 | Only if option B for HEIC is chosen: server decoder and new validation/caps | NEW | not recommended |

Nothing is required from the backend for the minimum flow (sections 1-3 with E1-E6). This document adds no migrations, RLS, RPCs or storage policies.
