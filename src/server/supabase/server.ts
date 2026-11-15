import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireSupabasePublicConfig, requireSupabaseSecretConfig } from "@/server/env";
export async function createSupabaseServerClient(){const cookieStore=await cookies();const{url,publishableKey}=requireSupabasePublicConfig();return createServerClient(url,publishableKey,{cookieOptions:{httpOnly:true,sameSite:"lax",secure:process.env.SKYCAR_ENV!=="demo"},cookies:{getAll(){return cookieStore.getAll()},setAll(cookiesToSet){try{cookiesToSet.forEach(({name,value,options})=>cookieStore.set(name,value,options))}catch{/* Server Components may be read-only. */}}}})}
export function createSupabaseTrustedServerClient(){const{url,secretKey}=requireSupabaseSecretConfig();return createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
