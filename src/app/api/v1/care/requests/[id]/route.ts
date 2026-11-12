import { careApi } from "@/server/care/repository";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return careApi.get((await context.params).id);
}
