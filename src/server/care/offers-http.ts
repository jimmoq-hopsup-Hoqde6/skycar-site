import { CareError, uuid } from "../../domain/care/request.ts";
import { careOffers } from "../../domain/care/offers.ts";
import type { CareOffer } from "../../domain/care/offers.ts";
import { API_ROUTE_TEMPLATES, ApiFault, withApiBoundary } from "../http/api-boundary.mjs";

export interface CareOffersRepository {
  list(requestId: string): Promise<unknown>;
}

type Dependencies = {
  enabled: () => boolean;
  connect: () => Promise<CareOffersRepository>;
};

type BoundaryOptions = {
  makeRequestId?: () => string;
  now?: () => number;
  logger?: { info: (entry: string) => void; error: (entry: string) => void };
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

export function careOfferHandlers(deps: Dependencies, boundaryOptions: BoundaryOptions = {}) {
  async function run(action: (repo: CareOffersRepository) => Promise<CareOffer[]>): Promise<CareOffer[]> {
    try {
      if (!deps.enabled()) throw new CareError("CARE_UNAVAILABLE");
      return await action(await deps.connect());
    } catch (error) {
      if (error instanceof CareError && error.code in errors) {
        const { status, message, retryable } = errors[error.code];
        throw new ApiFault(error.code, status, message, { retryable });
      }
      throw error;
    }
  }

  return {
    list: (request: Request, id: string) => withApiBoundary(
      request,
      API_ROUTE_TEMPLATES.careRequestOffers,
      async () => run(async repo => careOffers(await repo.list(uuid(id)))),
      boundaryOptions,
    ),
  };
}
