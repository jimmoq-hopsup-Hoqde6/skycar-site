import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnvironment, requireSupabasePublicConfig } from "@/server/env";

function privateResponse(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function refreshSupabaseSession(request: NextRequest) {
  let response = privateResponse(request);
  if (getPublicEnvironment() === "demo"
    && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    return response;
  }
  const { url, publishableKey } = requireSupabasePublicConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = privateResponse(request);
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims verifies the token and refreshes auth cookies when necessary.
  // Keep this call adjacent to client creation so the response cannot lose cookies.
  await supabase.auth.getClaims();
  return response;
}
