import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabasePublicConfig } from "@/server/env";
export async function createSupabaseServerClient(){const cookieStore=await cookies();const{url,publishableKey}=requireSupabasePublicConfig();return createServerClient(url,publishableKey,{cookies:{getAll(){return cookieStore.getAll()},setAll(cookiesToSet){try{cookiesToSet.forEach(({name,value,options})=>cookieStore.set(name,value,options))}catch{/* Server Components may be read-only. */}}}})}
