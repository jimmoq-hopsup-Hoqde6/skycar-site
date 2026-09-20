import { createSupabaseServerClient } from "@/server/supabase/server";
export type Actor={userId:string;email:string|null};
export async function requireActor():Promise<Actor>{const supabase=await createSupabaseServerClient();const{data,error}=await supabase.auth.getClaims();if(error||!data?.claims?.sub)throw new Error("UNAUTHENTICATED");return{userId:data.claims.sub,email:typeof data.claims.email==="string"?data.claims.email:null}}
