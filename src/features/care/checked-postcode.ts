// Hand-off of the postcode a signed-in customer already typed for the service-area check, so the
// "Service details" form on the journey page can offer it instead of asking again.
//
// This is a browser convenience only: it carries a value the customer typed in this tab to the next page.
// Nothing is decided or persisted here. The postcode is saved only when the customer submits the existing
// "update_details" action, and the server validates it exactly as before. The value lives in sessionStorage
// (this tab only, gone when the tab closes), is keyed by request id, and is dropped once details are saved.
// If storage is unavailable the form simply starts empty.
import { isPostcodeShape, normalisePostcode } from "../../domain/care/coverage.ts";

const PREFIX = "skycar:checked-postcode:";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

export function rememberCheckedPostcode(requestId: string, postcode: string): void {
  const code = normalisePostcode(postcode);
  if (!ID.test(requestId) || !isPostcodeShape(code)) return;
  try { storage()?.setItem(PREFIX + requestId.toLowerCase(), code); } catch { /* storage full or blocked: the form starts empty */ }
}

export function readCheckedPostcode(requestId: string): string {
  if (!ID.test(requestId)) return "";
  try {
    const code = normalisePostcode(storage()?.getItem(PREFIX + requestId.toLowerCase()) ?? "");
    return isPostcodeShape(code) ? code : "";
  } catch { return ""; }
}

export function forgetCheckedPostcode(requestId: string): void {
  if (!ID.test(requestId)) return;
  try { storage()?.removeItem(PREFIX + requestId.toLowerCase()); } catch { /* nothing to forget */ }
}
