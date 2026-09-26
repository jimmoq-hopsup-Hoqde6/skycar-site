import { careApi } from "@/server/care/repository";
export const dynamic = "force-dynamic";
export const GET = careApi.list;
export const POST = careApi.submit;
