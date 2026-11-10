# Mounted component regressions

## Photo picker refresh

Run the mounted React component regression from the repository root:

```sh
npm ci --ignore-scripts
npm install --prefix /tmp/skycar-component-tests --cache /tmp/skycar-component-cache --ignore-scripts --no-audit --no-fund happy-dom@20.8.4
HAPPY_DOM_MODULE=/tmp/skycar-component-tests/node_modules/happy-dom/lib/index.js \
  node --test tests/components/photo-picker-refresh.test.mjs
```

To reproduce failures, add `PHOTO_TEST_BASELINE=fa3859b` for the original photo
and service-draft loss, or `PHOTO_TEST_BASELINE=f0d99a5` for the follow-up
write/read ordering and saved-image retry regressions. Use
`PHOTO_TEST_BASELINE=5b8e39e` for the latest upload-receipt and partial-set
recovery regressions. The harness loads tracked
component source through `git show`, without changing the checkout.

The expanded suite has 56 tests. Against `5b8e39e`, 15 fail: malformed upload
receipts discard files, partial uploads cannot be recovered after reload, and
saving service details discards selected photos. All 56 pass with the complete
fix. Earlier fixes also cover write/read races and saved-image retries.

The tests mount the actual `CustomerJourney`, `TechnicianInbox`, and `DamagePhotos`
components. API responses, image decoding, and canvas output are controlled
fixtures. Coverage includes:

- Focus-before-change and change-before-focus, multiple lifecycle events, and
  partial-set upload prevention.
- Hidden/inert drafts during revalidation and account/request/expert changes,
  including leaving and returning to the same account.
- Deferred POST success, 401/403/404, and changed-account responses racing GETs;
  older successful reads cannot reopen a denied view.
- Exact ordered photo bytes and customer idempotency key across lost-response
  retries, and confirmed technician decline versus late GET.
- Failed saved request/completion image reads retry after successful verification
  without remounting the local upload picker.

- The actual immutable-storage helper writes a manifest, fails on the second
  image, then accepts an exact same-set retry after a fresh component mount.
  Existing bytes remain unchanged, duplicate clicks send once, and different
  bytes cannot replace the set.
- Malformed upload receipts retain exact files/key even when a subsequent read
  reveals manifest slots. Recovery cancellation, request/account changes and
  closed states discard late decoding without reopening recovery.
- HEIC is rejected before decoding. The picker and server still accept only
  JPEG/PNG/WebP; this test does not establish any browser's native HEIC support.

The current signed-in initial request form is JSON-only with no photo picker.
These tests cover adding/recovering photos on an existing journey, not the
proposed two-call initial submission in draft PR #78. Recovery must use all
original files in their original order, preferably in the same browser/device.
Different re-encoding can change immutable bytes and remains a conflict; a
partial set cannot be completed after the server's upload window closes.

This is **not** a browser codec, pixel-layout, native camera, or hosted auth test.

The complementary browser regression is `tests/ui/photo-picker-refresh.mjs`.
It requires a production build and the existing Playwright setup documented by
`.github/workflows/care-entry-ui.yml`; `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` can point
to external test-only installations. It uses real browser image preparation and
synthetic API routes. Native-device acceptance still needs an iPhone/Android
camera or photo chooser.

## Request status and reopening recovery

From the repository root, with the same test-only Happy DOM installation:

```sh
HAPPY_DOM_MODULE=/tmp/skycar-component-tests/node_modules/happy-dom/lib/index.js \
  node --test tests/components/request-status-recovery.test.mjs
```

The 44 tests mount the production `RequestStatus` component. Add
`STATUS_TEST_BASELINE=9cd560e` to load the original tracked component and reproduce
26 failures without changing the checkout. Coverage includes:

- Pending reads/retries across request changes, unmount, StrictMode cleanup,
  and newer lifecycle reads. Old responses cannot restore private data, reset
  a replacement request's attempt, or leave its actions locked.
- Focus, pageshow and visibility changes during a retry, including actual
  abort rejection and a late response from a transport that ignores abort.
  Cancellation is an uncertain write, not proof that the server rolled it back.
- Exact key/body reuse after interruption, network failure, reload, and malformed
  or wrong-request retry responses. No retry is sent automatically.
- Access-denied revalidation removes private details and pending recovery;
  transient manual refresh instead labels the last verified receipt as stale.
- A confirmed replay can return the current `no_match` receipt after the original
  reopening cycle finished. That acknowledgement resolves the original key and
  allows a new explicit review rather than trapping the customer in recovery.
- Session storage property denial or quota errors preserve in-memory retry
  without claiming that a reload can recover the attempt.
- Quote review belongs to the customer; later connected stages do not reuse
  stale request ownership when the receipt lacks a current next action owner.

Running `node --test tests/components/*.test.mjs` with `HAPPY_DOM_MODULE` executes
100 mounted tests across both suites. These are controlled-fetch DOM tests, not
live database, browser rendering, real session, or physical-device acceptance.
