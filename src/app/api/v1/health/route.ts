import { getPublicEnvironment } from "@/server/env";
import { withApiBoundary } from "@/server/http/api-boundary.mjs";
export const dynamic="force-dynamic";
export async function GET(request:Request){return withApiBoundary(request,"/api/v1/health",async()=>({status:"ok",service:"skycar-v2",environment:getPublicEnvironment()}))}
