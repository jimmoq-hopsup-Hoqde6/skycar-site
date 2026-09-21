import { careOfferApi } from "@/server/care/offers-repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return careOfferApi.list((await context.params).id);
}
