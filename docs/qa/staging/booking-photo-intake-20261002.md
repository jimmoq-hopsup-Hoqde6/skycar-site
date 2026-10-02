# Booking photo intake — protected staging

The guest booking journey now has a prominent manual-entry/Garage choice, illustrated wide/area/close-up photo guidance, optional three-photo uploads with previews and removal, and a summary before contact submission. The receipt explains review, quote confirmation and expert/appointment confirmation as separate steps.

## References and application

- DingGo FAQ https://www.dinggo.com.au/faq — three guided damage photos, quality review, then quotes with scope/price/availability. Applied the guided capture pattern; their network statistics and response-time promises are not Skycar claims.
- AutoGuru FAQ https://www.autoguru.com.au/faqs/autoguru — vehicle/location intake and distinction between routine fixed-price jobs and custom complex repair quotes. Applied vehicle-first entry and explicit quote confirmation.

## Storage and recovery

JSON intake remains compatible. Multipart intake bounds the entire streamed request at 2.8 MB, accepts no unknown fields, validates the same contact/consent contract and limits three images to 900 KB each. The client decodes and re-encodes JPEG/PNG/WebP to JPEG at up to 1200 px, strips original metadata/names, and keeps the exact prepared files and request key across ambiguous retries.

Only after the trusted intake RPC validates the request key, payload and existing rate limits are attachments written to the private-media bucket under guest-requests/{server-generated-request-id}. An immutable manifest records slot, MIME, byte count and SHA-256; immutable photo slots reconcile exact partial retries by content hash. Guests have no photo read endpoint, public URL, bucket permission or direct database grant. A confirmed receipt is returned only after every selected photo upload succeeds. A partial failure may leave the contact request plus manifest/partial photos for reconciliation; operations must check the manifest against all slots before reviewing attachments.

Guest request photos are new. Garage account requests keep their existing account privacy/recovery contracts; request-specific damage attachments are not yet added to that separate flow. Garage vehicle photos remain supported.

AI damage assessment, cost estimation, automated expert dispatch, guest quote delivery and offer acceptance are not integrated. No fabricated price, rating, availability or booked status is shown. The existing offer lifecycle integration gate remains in force.

## Verification

- Lint, typecheck and production build pass.
- 171 unit tests pass, including multipart privacy/validation, immutable attachments, exact retries, changed-content rejection and storage failures.
- Guest/photo recovery browser regression passes.
- New booking-photo browser regression passes: actual image decoding/re-encoding, preview, summary, lost-response retry with identical prepared image and key, receipt, no page errors and 320/390/1440 px layouts.
- Staging bucket is private; authenticated read policy requires the first path component to equal auth.uid(), which guest-request paths cannot satisfy.

Hosted deployment and a synthetic saved photo request are checked separately after publishing the staging branch.
