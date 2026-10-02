# Combined Skycar test build — 2 October 2026

The protected `skycar-v2-staging` preview combines the approved premium design from `design/skycar-premium-ui` (20004e5) with the verified guest and Garage flows from `fix/phone-test-delivery` (c7e8072).

- Premium home, vehicle cards, job cards and mobile navigation.
- Three-step guest request with previous-step values retained, validation, and exact retries after uncertain responses. No account or payment required.
- Garage and My Jobs entry points continue to submit account-associated requests.
- Selected-photo and saved-photo previews on the photo page; saved photos on Garage cards.
- Saved images are served through a session-authenticated, private/no-store route. Vehicle ownership, media metadata and Storage reads use the session client and existing RLS. No public buckets or signed download links. Account headers bind browser responses to the verified account, and private pixels clear on account revalidation.

Validation: lint, TypeScript, production build, 168 unit tests; built API activation, origin and cookie checks; Care entry, My Jobs, status, guest/photo recovery and full customer journey browser acceptance. Synthetic browser checks include 320/390/1440px home overflow, decodable selected/saved previews, and preview removal after failed identity verification.

Earlier hosted acceptance confirmed guest request b3c4beb6-7e0c-4da7-99cf-be0d4ecd3b21 and private stored photo 0688b25c-f8bf-4523-aea5-958fe4a9fb22. Hosted preview retrieval of that photo passed after deployment: the authenticated browser decoded the 640px saved image. Physical iPhone review remains a user check; browser viewport checks do not replace it.
