import { handleGarage } from '@/server/garage/handler';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleGarage(request, 'archive', (await context.params).id);
}
