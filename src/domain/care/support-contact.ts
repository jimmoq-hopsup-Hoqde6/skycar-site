// Customer support contact, read from server environment by the page and passed to the forms as
// props. The email has a public, non-secret default (the Skycar info mailbox); SKYCAR_SUPPORT_EMAIL
// overrides it when set to a valid address. The phone has NO default: it is shown only when
// SKYCAR_SUPPORT_PHONE is set to a valid number (see .env.example).

export const DEFAULT_SUPPORT_EMAIL = "info@skycar.au";

export type SupportContact = { email: string | null; phone: string | null };

const EMAIL = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{4,22}[0-9]$/;

export function readSupportContact(env: Record<string, string | undefined>): SupportContact {
  const email = env.SKYCAR_SUPPORT_EMAIL?.trim() ?? "";
  const phone = env.SKYCAR_SUPPORT_PHONE?.trim() ?? "";
  return {
    // A blank or invalid override falls back to the default rather than hiding the contact.
    email: email.length <= 254 && EMAIL.test(email) ? email : DEFAULT_SUPPORT_EMAIL,
    phone: PHONE.test(phone) ? phone : null,
  };
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

export function hasSupportContact(contact: SupportContact | undefined | null): contact is SupportContact {
  return !!contact && (!!contact.email || !!contact.phone);
}
