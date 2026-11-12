import { careOfferApi } from "@/server/care/offers-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return careOfferApi.list(request, (await context.params).id);
}
