import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireSupabasePublicConfig } from "@/server/env";

export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const privateResponse = () => {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
  };
  // Routes still enforce configuration and verified sessions themselves.
  // An unconfigured demo must reach their existing fail-closed responses.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return privateResponse();
  }
  const { url, publishableKey } = requireSupabasePublicConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.SKYCAR_ENV !== "demo" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims verifies the token and refreshes auth cookies when necessary.
  // Keep this call adjacent to client creation so the response cannot lose cookies.
  try { await supabase.auth.getClaims(); }
  catch {
    return NextResponse.json({ error: { code: "AUTH_UNAVAILABLE", message: "Unable to verify your session. Please retry." } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  return privateResponse();
}
