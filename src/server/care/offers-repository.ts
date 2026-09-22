import "server-only";
import { CareError } from "@/domain/care/request";
import { careOfferHandlers } from "@/server/care/offers-http";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { featureEnabled } from "@/server/env";

const publicErrors = new Set(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED"]);

export const careOfferApi = careOfferHandlers({
  enabled: () => featureEnabled("CARE"),
  connect: async () => {
    let db: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    try { db = await createSupabaseServerClient(); }
    catch { throw new CareError("CARE_UNAVAILABLE"); }

    const { data, error } = await db.auth.getClaims();
    if (error || !data?.claims?.sub) throw new CareError("UNAUTHENTICATED");

    return {
      list: async (requestId: string) => {
        const { data, error } = await db.rpc("care_get_offers", { p_request_id: requestId });
        if (error) {
          if (error.code === "P0001" && publicErrors.has(error.message)) throw new CareError(error.message);
          throw new CareError("TEMPORARILY_UNAVAILABLE");
        }
        if (data === null) throw new CareError("TEMPORARILY_UNAVAILABLE");
        return data;
      },
    };
  },
});
