# Guest service intake — 1 October 2026

Implemented application revision `072c30b76c83df84e416ce3b861c909fa9b3cdf5` on the protected staging branch. `/care/request` is now a guest form and bypasses Supabase session middleware. Optional saved-vehicle requests remain at `/care/request/garage`. Garage, history and vehicle photos remain authenticated.

The guest queue does not create Auth users or Garage vehicles. Contact details are stored only in a private RLS-enabled table, inaccessible to anon/authenticated browser roles. A server-only RPC validates fields, consent, exact retries and rate limits. Successful receipts contain only reference, stage and creation time; there is no public read endpoint. Queue review is manual; no automated email/SMS delivery or guest status portal is claimed.

PASS: lint, TypeScript, all 158 unit tests and production build. Transactional Supabase checks verified safe receipt fields, exact replay after network-address changes, changed-payload rejection, required consent, rate limiting, browser access denial and rollback of all test fixtures.

PASS: hosted guest form opens without Skycar login and accepts synthetic details. BLOCKED: live synthetic submission reached care_submit_guest_request but received Supabase HTTP 401; zero matching guest rows were stored. Correcting the Vercel server key remains necessary for hosted guest saving and vehicle photo uploads. Hosted success and actual phone acceptance are not claimed.
