# Connected service journey — implementation draft

Not deployed or ready for integration. The recovered API/UI source compiles, but the database migration/RPC draft was not retained. Database guarantees below describe the required contract, not verified deployed behaviour. See CARE_JOURNEY_CHECKPOINT.md for the next implementation steps.

## Routes

- GET /api/v1/care/journey/:id — owner session or request-specific guest HttpOnly cookie. Returns request summary, reviewed quotes, current booking stage, recorded events and bounded private photo counts.
- POST /api/v1/care/journey/:id — same authority, trusted origin, UUID Idempotency-Key. Actions update_details, select_quote, request_cancel. Customer selection requests an appointment; it does not confirm capacity or take payment.
- POST /api/v1/care/journey/:id/photos — owner session or guest cookie, trusted origin; multipart photos, at most three JPEG/PNG/WebP images, each <=900 KB. Immutable manifest/slots preserve partial-upload recovery.
- GET /api/v1/care/journey/:id/photos/:slot — verified customer or admin; private/no-store binary image, never a public storage URL.
- GET /api/v1/operations/care — verified admin session; bounded queue and expert registry.
- POST /api/v1/operations/care — verified admin, trusted origin, UUID Idempotency-Key. Create expert, publish quote, confirm booking, start work, complete work, cancel booking.

All writes derive actor authority from server-verified sessions or a verified guest capability; browser actor IDs and roles are never trusted. The database rechecks administrator/customer authority. Unknown body fields, invalid prices/times and unsupported transitions fail closed. Commands, projection changes and events are transactional. Provider capacity is locked and checked for overlapping confirmed/in-progress appointments. No fixtures or invented assessments are returned by hosted APIs.

The guest receipt establishes its cookie only after successful intake and selected photo uploads. The link is usable in that browser. Cross-device recovery and outbound notification delivery require a separate verified contact channel.
