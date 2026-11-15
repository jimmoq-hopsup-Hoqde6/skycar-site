"use client";

import { hasSupportContact, telHref, type SupportContact } from "@/domain/care/support-contact";
import { type CoverageOutcome } from "@/domain/care/coverage";
import "./coverage-notice.css";

type Blocking = Extract<CoverageOutcome, { kind: "out_of_area" | "unknown" }>;

// Shown when the area check did not return "in area". `invalid_input` is shown on the field
// itself (see CoveragePostcodeError), and "in area" needs no notice beyond CoverageConfirmed.
export function CoverageNotice({ outcome, contact, busy, onRetry, onChangePostcode }: {
  outcome: Blocking;
  contact?: SupportContact | null;
  busy?: boolean;
  onRetry: () => void;
  onChangePostcode: () => void;
}) {
  const out = outcome.kind === "out_of_area";
  return <section className="coverage-notice" data-coverage={out ? "out_of_area" : "unknown"} data-contact={contact?.email && contact.phone ? "email-phone" : contact?.email ? "email" : contact?.phone ? "phone" : "none"} role="alert" aria-labelledby="coverage-notice-title">
    <h3 id="coverage-notice-title">{out ? `We don’t cover ${outcome.postcode} yet` : "We can’t check your area right now"}</h3>
    {out
      ? <p>Skycar is starting in Adelaide and the Adelaide Hills, so we can’t take a request for {outcome.postcode} yet. Check the postcode, or get in touch and we’ll tell you when we reach your area. Nothing has been submitted.</p>
      : <p>We couldn’t confirm whether we cover your postcode, so nothing has been submitted. Please try again in a moment{hasSupportContact(contact) ? ", or contact us" : ""}.</p>}
    {hasSupportContact(contact) && <p className="coverage-contact">Contact Skycar: {contact.phone && <a href={telHref(contact.phone)}>{contact.phone}</a>}{contact.phone && contact.email && " · "}{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}</p>}
    <div className="coverage-actions">
      {out
        ? <button type="button" onClick={onChangePostcode}>Change postcode</button>
        : <button type="button" disabled={busy} onClick={onRetry}>{busy ? "Checking…" : "Try again"}</button>}
    </div>
  </section>;
}

export function CoveragePostcodeError({ id }: { id: string }) {
  return <p className="coverage-field-error" id={id} role="alert">Enter your 4-digit postcode, for example 5000.</p>;
}

export function CoverageConfirmed({ postcode }: { postcode: string }) {
  return <p className="coverage-confirmed" role="status">Skycar covers {postcode}. A quote, expert and appointment still need confirmation.</p>;
}
