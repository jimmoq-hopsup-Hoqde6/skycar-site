import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/server/supabase/proxy";

export function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    "/auth/:path*",
    "/garage/:path*",
    "/care/:path*",
    "/api/v1/auth/:path*",
    "/api/v1/garage/:path*",
    "/api/v1/care/requests/:path*",
  ],
};
