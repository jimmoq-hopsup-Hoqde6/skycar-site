# Hosted customer-flow verification — 1 October 2026

Protected isolated staging application revision `512f7043096208e2b45f0b0045e01cfc578ddb4f` is deployed Ready as a Preview.

PASS: disposable customer A signs in; Garage loads; a synthetic 2020 Toyota vehicle saves; repair request submits; status shows receipt and next-update deadline; My Jobs lists the same request. Database checks confirm one matching vehicle and request.

PASS: lint, TypeScript, 153 unit tests and production build. Photo upload form is deployed and accepts the synthetic PNG through the browser chooser. Uploads are capped at 4 MB. Exact uncertain retries retain the same file and idempotency key.

BLOCKED: hosted photo save returned temporary-unavailable. Supabase edge logs show POST to garage_reserve_vehicle_photo rejected with HTTP 401. Database confirms zero media assets and zero storage objects. The configured server credential needs correction; no credential values were retrieved or recorded. Photo previews remain unavailable.

Pending: customer B creation and cross-account hosted privacy verification, actual phone acceptance, and successful private photo storage after credential correction. Care requests record review progress; no confirmed booking, pricing, coverage, technician, fulfilment or payment acceptance is claimed.
