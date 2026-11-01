// The signed-URL route (GET /api/v1/care/journey/:id/photos/:slot/url) is not a display path:
// the account-bound proxy route is the only one. Attach this to a Playwright browser and call
// assertNone() at the end of a flow to prove no page, in any context, ever requested it.
import assert from "node:assert/strict";

export const signedUrlRoute = /\/photos\/[^/?#]+\/url(?:[?#]|$)|\/completion-photos\/[^/?#]+\/url(?:[?#]|$)/;

export function guardSignedUrls(browser) {
  const calls = new Set();
  const watch = context => context.on("request", request => { if (signedUrlRoute.test(new URL(request.url()).pathname + new URL(request.url()).search)) calls.add(request.url()); });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => { const context = await newContext(...args); watch(context); return context; };
  return { assertNone() { assert.deepEqual([...calls], [], "no page may request the signed-URL photo route"); } };
}
