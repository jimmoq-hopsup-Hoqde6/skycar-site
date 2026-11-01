// Optional customer support contact, read from server environment by the page and passed to the
// forms as props. Nothing is hardcoded: when neither value is configured the forms show no
// contact line. Configure SKYCAR_SUPPORT_EMAIL and/or SKYCAR_SUPPORT_PHONE (see .env.example).

export type SupportContact = { email: string | null; phone: string | null };

const EMAIL = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{4,22}[0-9]$/;

export function readSupportContact(env: Record<string, string | undefined>): SupportContact {
  const email = env.SKYCAR_SUPPORT_EMAIL?.trim() ?? "";
  const phone = env.SKYCAR_SUPPORT_PHONE?.trim() ?? "";
  return {
    email: email.length <= 254 && EMAIL.test(email) ? email : null,
    phone: PHONE.test(phone) ? phone : null,
  };
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

export function hasSupportContact(contact: SupportContact | undefined | null): contact is SupportContact {
  return !!contact && (!!contact.email || !!contact.phone);
}
