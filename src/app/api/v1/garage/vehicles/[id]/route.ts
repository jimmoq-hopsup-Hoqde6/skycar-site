import { handleGarage } from '@/server/garage/handler';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleGarage(request, 'get', (await context.params).id);
}
export async function PATCH(request: Request, context: Context) {
  return handleGarage(request, 'update', (await context.params).id);
}
