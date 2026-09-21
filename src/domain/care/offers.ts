import { CareError, uuid } from "./request.ts";

export type CareOfferSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "available";
  created_at: string;
};

export type CareOffer = {
  id: string;
  request_id: string;
  scope_summary: string;
  total_price_cents: number;
  currency: "AUD";
  adjustment_reason: string | null;
  status: "issued";
  expires_at: string;
  created_at: string;
  updated_at: string;
  slots: CareOfferSlot[];
};

function isoDate(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new CareError("TEMPORARILY_UNAVAILABLE");
  return value;
}

export function careOffers(value: unknown): CareOffer[] {
  if (!Array.isArray(value)) throw new CareError("TEMPORARILY_UNAVAILABLE");
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CareError("TEMPORARILY_UNAVAILABLE");
    const offer = raw as Record<string, unknown>;
    if (uuid(offer.id) !== offer.id || uuid(offer.request_id) !== offer.request_id ||
      typeof offer.scope_summary !== "string" || offer.scope_summary.length < 10 ||
      !Number.isSafeInteger(offer.total_price_cents) || Number(offer.total_price_cents) <= 0 ||
      offer.currency !== "AUD" || offer.status !== "issued" ||
      !(offer.adjustment_reason === null || typeof offer.adjustment_reason === "string") ||
      !Array.isArray(offer.slots)) throw new CareError("TEMPORARILY_UNAVAILABLE");

    const slots = offer.slots.map(rawSlot => {
      if (!rawSlot || typeof rawSlot !== "object" || Array.isArray(rawSlot)) throw new CareError("TEMPORARILY_UNAVAILABLE");
      const slot = rawSlot as Record<string, unknown>;
      if (uuid(slot.id) !== slot.id || slot.status !== "available") throw new CareError("TEMPORARILY_UNAVAILABLE");
      const starts_at = isoDate(slot.starts_at);
      const ends_at = isoDate(slot.ends_at);
      if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new CareError("TEMPORARILY_UNAVAILABLE");
      return { id: slot.id as string, starts_at, ends_at, status: "available" as const, created_at: isoDate(slot.created_at) };
    });

    return {
      id: offer.id as string,
      request_id: offer.request_id as string,
      scope_summary: offer.scope_summary,
      total_price_cents: offer.total_price_cents as number,
      currency: "AUD" as const,
      adjustment_reason: offer.adjustment_reason as string | null,
      status: "issued" as const,
      expires_at: isoDate(offer.expires_at),
      created_at: isoDate(offer.created_at),
      updated_at: isoDate(offer.updated_at),
      slots,
    };
  });
}
