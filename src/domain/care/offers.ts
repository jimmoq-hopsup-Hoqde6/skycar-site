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

const absoluteTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function unavailable(): never {
  throw new CareError("TEMPORARILY_UNAVAILABLE");
}

function repositoryUuid(value: unknown): string {
  try {
    const parsed = uuid(value);
    if (parsed !== value) unavailable();
    return parsed;
  } catch {
    return unavailable();
  }
}

function isoDate(value: unknown): string {
  if (typeof value !== "string" || !absoluteTimestamp.test(value) || !Number.isFinite(Date.parse(value))) unavailable();
  return value;
}

export function careOffers(value: unknown, expectedRequestId: string): CareOffer[] {
  const requestId = uuid(expectedRequestId);
  if (!Array.isArray(value)) unavailable();
  const offerIds = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) unavailable();
    const offer = raw as Record<string, unknown>;
    const offerId = repositoryUuid(offer.id);
    const offerRequestId = repositoryUuid(offer.request_id);
    if (offerIds.has(offerId) || offerRequestId !== requestId ||
      typeof offer.scope_summary !== "string" || [...offer.scope_summary].length < 10 || [...offer.scope_summary].length > 2000 ||
      !Number.isSafeInteger(offer.total_price_cents) || Number(offer.total_price_cents) <= 0 || Number(offer.total_price_cents) > 2147483647 ||
      offer.currency !== "AUD" || offer.status !== "issued" ||
      !(offer.adjustment_reason === null ||
        (typeof offer.adjustment_reason === "string" && [...offer.adjustment_reason].length >= 3 && [...offer.adjustment_reason].length <= 1000)) ||
      !Array.isArray(offer.slots) || offer.slots.length < 1 || offer.slots.length > 20) unavailable();
    offerIds.add(offerId);

    const expires_at = isoDate(offer.expires_at);
    const created_at = isoDate(offer.created_at);
    const updated_at = isoDate(offer.updated_at);
    const slotIds = new Set<string>();

    const slots = offer.slots.map(rawSlot => {
      if (!rawSlot || typeof rawSlot !== "object" || Array.isArray(rawSlot)) unavailable();
      const slot = rawSlot as Record<string, unknown>;
      const id = repositoryUuid(slot.id);
      if (slotIds.has(id) || slot.status !== "available") unavailable();
      slotIds.add(id);
      const starts_at = isoDate(slot.starts_at);
      const ends_at = isoDate(slot.ends_at);
      if (Date.parse(ends_at) <= Date.parse(starts_at) || Date.parse(expires_at) > Date.parse(starts_at)) unavailable();
      return { id, starts_at, ends_at, status: "available" as const, created_at: isoDate(slot.created_at) };
    });

    const orderedSlots = [...slots].sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));
    for (let index = 1; index < orderedSlots.length; index++) {
      if (Date.parse(orderedSlots[index].starts_at) < Date.parse(orderedSlots[index - 1].ends_at)) unavailable();
    }

    return {
      id: offerId,
      request_id: offerRequestId,
      scope_summary: offer.scope_summary,
      total_price_cents: offer.total_price_cents as number,
      currency: "AUD" as const,
      adjustment_reason: offer.adjustment_reason as string | null,
      status: "issued" as const,
      expires_at,
      created_at,
      updated_at,
      slots,
    };
  });
}
