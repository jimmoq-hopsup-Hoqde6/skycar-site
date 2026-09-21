import { CareError, uuid } from "../../domain/care/request.ts";
import { careOffers } from "../../domain/care/offers.ts";
import type { CareOffer } from "../../domain/care/offers.ts";

export interface CareOffersRepository {
  list(requestId: string): Promise<unknown>;
}

type Dependencies = {
  enabled: () => boolean;
  connect: () => Promise<CareOffersRepository>;
};

const errors: Record<string, { status: number; message: string; retryable: boolean }> = {
  VALIDATION_FAILED: { status: 400, message: "Check the request details.", retryable: false },
  UNAUTHENTICATED: { status: 401, message: "Sign in to continue.", retryable: false },
  FORBIDDEN: { status: 403, message: "This action is not permitted.", retryable: false },
  NOT_FOUND: { status: 404, message: "Request not found.", retryable: false },
  CARE_UNAVAILABLE: { status: 503, message: "Care offers are not currently enabled.", retryable: false },
  TEMPORARILY_UNAVAILABLE: { status: 503, message: "Unable to load technician offers.", retryable: true },
  INTERNAL_ERROR: { status: 500, message: "Unable to process your request.", retryable: false },
};

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" },
  });
}

export function careOfferHandlers(deps: Dependencies) {
  async function run(action: (repo: CareOffersRepository) => Promise<CareOffer[]>) {
    const requestId = crypto.randomUUID();
    try {
      if (!deps.enabled()) throw new CareError("CARE_UNAVAILABLE");
      const data = await action(await deps.connect());
      return json({ data, meta: { requestId } }, 200);
    } catch (error) {
      const code = error instanceof CareError && error.code in errors ? error.code : "INTERNAL_ERROR";
      const { status, message, retryable } = errors[code];
      if (status >= 500) console.error(JSON.stringify({ event: "care_offer_api_failure", requestId, code }));
      return json({ error: { code, message, fieldErrors: {}, retryable }, meta: { requestId } }, status);
    }
  }

  return {
    list: (id: string) => run(async repo => careOffers(await repo.list(uuid(id)))),
  };
}
