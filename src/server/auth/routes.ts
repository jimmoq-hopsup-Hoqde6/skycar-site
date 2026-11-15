import { createAuthHandlers } from "@/server/auth/http.mjs";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const authApi = createAuthHandlers({ connect: createSupabaseServerClient });
