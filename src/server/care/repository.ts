import "server-only";
import { CareError } from "@/domain/care/request";
import type { CareInput, CareReceipt } from "@/domain/care/request";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { featureEnabled } from "@/server/env";
import { careHandlers } from "@/server/care/http";

const publicErrors = new Set(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED", "IDEMPOTENCY_CONFLICT", "INVALID_TRANSITION", "POLICY_UNAVAILABLE"]);

export const careApi = careHandlers({
  enabled: () => featureEnabled("CARE"),
  connect: async () => {
    let db: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    try { db = await createSupabaseServerClient(); }
    catch { throw new CareError("CARE_UNAVAILABLE"); }
    const { data, error } = await db.auth.getClaims();
    if (error || !data?.claims?.sub) throw new CareError("UNAUTHENTICATED");
    async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await db.rpc(name, args);
      if (error) {
        if (error.code === "P0001" && publicErrors.has(error.message)) throw new CareError(error.message);
        // Missing rollout schema/policy/provider must never fall back to fixtures.
        throw new CareError("TEMPORARILY_UNAVAILABLE");
      }
      if (data === null) throw new CareError("TEMPORARILY_UNAVAILABLE");
      return data as T;
    }
    return {
      submit: (key: string, input: CareInput) => rpc<{ request: CareReceipt; replayed: boolean }>("care_submit_request", { p_key: key, p_payload: input }),
      get: (id: string) => rpc<CareReceipt>("care_get_request", { p_id: id }),
      retry: (id: string, key: string) => rpc<{ request: CareReceipt; replayed: boolean }>("care_retry_request", { p_id: id, p_key: key }),
    };
  },
});
