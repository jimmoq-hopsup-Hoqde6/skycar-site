import { careApi } from "@/server/care/repository";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return careApi.retry(request, (await context.params).id);
}
