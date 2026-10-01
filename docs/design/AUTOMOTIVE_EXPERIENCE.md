# Skycar mobile experience — benchmark-led redesign

Date: 2026-10-02 (Australia/Adelaide)
Owner request: take useful patterns from three leading automotive apps and give Skycar a stronger first impression and easier ownership experience.

## The three references

These are selected design benchmarks, not an objective worldwide ranking. This research uses current manufacturer product pages and help documentation; no claim of hands-on testing in their signed-in native apps.

| Benchmark | Evidence from the official product | Pattern chosen for Skycar | Skycar's intended advantage |
| --- | --- | --- | --- |
| Tesla | Vehicle-centric controls; service requests, estimate review, appointment management, messages and service history. | Put the car and its next action at the centre; make the service journey legible. | Offer the same clear request entry without forcing a new customer to make an account. Keep uncertain submissions recoverable. |
| My Porsche | Strong visual vehicle presentation, linked multi-vehicle management, ownership/service history and a coherent brand experience. | Emotional car imagery, restrained typography and a personal vehicle identity. | Give ordinary cars the care and presentation usually reserved for a single premium marque. Use original Skycar assets, not copied screens. |
| My BMW | Vehicle status connected to service requirements and scheduling, with ownership support in one app. | Useful actions close to the vehicle record and a clear ownership workspace. | Bring saved vehicle details, service requests and next actions together across makes. Broader ownership intelligence needs real integrations before being presented as available. |

### Primary sources

- Tesla app: https://www.tesla.com/support/tesla-app
- Tesla service journey: https://www.tesla.com/support/service-visits
- My Porsche: https://www.porsche.com/australia/my-porsche-app/
- My BMW: https://www.bmw.com.au/en/offers-and-services/my-bmw-app-overview.html

## Implemented in this increment

1. Original photographic hero, responsive for phone and desktop, with car care as the primary action.
2. Compact repair/cleaning cards with the selected service carried into the guest form.
3. Mobile navigation: Home, Garage, Care, My Jobs. Existing destinations preserved; active screen indicated; iPhone safe-area padding. Navigation is omitted on sign-in pages to keep that flow focused.
4. Three-step guest intake: Your car → Location → Contact. Fields remain mounted, back/forward retains entries, each step validates, and final submission uses the existing endpoint and idempotency contract.
5. Uncertain request retry locks original fields and reuses exactly the original body/key. Success appears only after the existing strict receipt parser accepts the server response.
6. Personal Garage identity using actual saved make/model/year/registration, with edit/history/photo/archive actions and care shortcuts.
7. My Jobs cards promote the existing server-derived next action. No stage, deadline, quote or booking state is invented.
8. Focus states, 16px form text, reduced-motion support, and mobile-sized tap targets.

## Deliberately dependent on later verified work

The app has no connected-car telemetry or remote-control integration. Health scores, instant AI diagnostics, predictive servicing, confirmed appointments, payments, roadside cover and savings claims are not presented as working features by this increment. The private vehicle photo upload API also lacks a display/read contract, so the Garage does not pretend to show a saved customer photo.

The next material visual improvement is a verified customer-photo display path, followed by the real quote/appointment/completion journey as those backend contracts become available. These are follow-ups, not capabilities added here.

## Validation and limits

- ESLint, TypeScript, existing unit tests and production build pass.
- Local Chromium browser verification uses the production Next.js server.
- Layout and navigation tested at 320px, 390px and 1440px.
- Guest intake: required-field blocking, cleaning preselection, back/forward retention, final contact consent, 503 → 201 recovery, frozen fields, identical request key/body, confirmed receipt.
- Garage and My Jobs layout checks use synthetic data intercepted inside the browser only; no demo records are embedded in the product or inserted in a database.
- No browser JavaScript errors in the exercised flows.
- Hosted signed-in users, live database intake/delivery, real iPhone Safari, payments and operational fulfilment are not validated by these local checks.

## Original asset provenance

Asset: `public/images/skycar-studio-car-v2.webp` (optimized from the original generated PNG).
Method: built-in image generation tool; no manufacturer image is reused. The image is decorative and does not represent a specific customer's vehicle.

Prompt:
> Use case: product-mockup. Asset type: original hero photograph for Skycar, a premium multi-brand car ownership and care mobile web app. Create an exceptionally polished photorealistic automotive studio photograph, landscape 1536x1024 composition: one unbranded elegant graphite-silver modern five-door fastback car, front three-quarter view, facing toward the viewer and slightly left, realistic production-car proportions and realistic fine surface details. Car entirely visible with wheels and ground reflection, occupying central 70 percent of image width and lower half of frame. Deep midnight navy seamless studio background #0a1420. Beautiful precise soft white rim lighting across bonnet and roof; subtle icy cyan reflected light along lower side, restrained not neon. Premium European automotive campaign photographic quality, low camera angle, sophisticated cinematic contrast, clean quiet image. Leave generous dark negative space above the car and at the edges for responsive app cropping. No text, no logos, no badge, no people, no UI, no license plate letters, no watermark. This is a decorative brand image, not a specific customer's vehicle.

## Garage reference refinement — 2 October 2026

Marcel supplied a desktop Garage reference with a navy sidebar, light canvas,
large vehicle centrepiece, ownership cards, activity and a right action column.
The review now follows that visual direction at desktop and phone sizes. The
vehicle selector keeps multiple cars accessible; Overview and History use saved
records, with existing repair/cleaning, My Jobs, photo upload, editing and archive
flows. The reference's sample BMW statistics, health status, insurance, reminders,
valuation, membership and document controls are not backed by current contracts.
They are not presented as available features.

Photo upload can save a private original but currently has no authorised image
read/display endpoint. The centrepiece therefore uses an explicit generic photo
placeholder, rather than a fabricated customer-car image. Enabling that display
contract is the main remaining step toward the reference's visual impact.

Validation: lint, TypeScript, production build and 164 unit tests passed. Browser
fixtures cover 1440, 390 and 320 pixel layouts, selection, missing fields, Overview /
History, editor/cancel, archive filter, empty add and unauthenticated redaction.
Screenshots and fixture results are in docs/ui-review/garage-reference. Fixtures
are synthetic; no hosted authentication/database or real iPhone proof is claimed.
Newer fixes from the test branch are incorporated, including uncertain retry
preservation and photo-upload recovery. Existing browser regressions are adapted
for the selected-vehicle view and step-based guest intake.

Additional regression evidence: 18 existing Garage browser checks and all 43
Garage recovery scenarios passed, including pending/uncertain writes, focus and
page return, account replacement, failed validation and exact immutable retries.
