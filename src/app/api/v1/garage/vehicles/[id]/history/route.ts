import { handleGarage } from '@/server/garage/handler';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleGarage(request, 'history', (await context.params).id);
}
