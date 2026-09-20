import { NextResponse } from "next/server";
import { getPublicEnvironment } from "@/server/env";
export const dynamic="force-dynamic";
export async function GET(){const requestId=crypto.randomUUID();return NextResponse.json({data:{status:"ok",service:"skycar-v2",environment:getPublicEnvironment()},meta:{requestId}})}
