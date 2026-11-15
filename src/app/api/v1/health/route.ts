import { getPublicEnvironment } from "@/server/env";
import { API_ROUTE_TEMPLATES, withApiBoundary } from "@/server/http/api-boundary.mjs";
export const dynamic="force-dynamic";
export async function GET(request:Request){return withApiBoundary(request,API_ROUTE_TEMPLATES.health,async()=>({status:"ok",service:"skycar-v2",environment:getPublicEnvironment()}))}
