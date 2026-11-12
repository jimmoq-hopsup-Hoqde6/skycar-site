import { handleGaragePhoto, handleGaragePhotoRead } from '@/server/garage/handler';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleGaragePhotoRead(request, (await context.params).id);
}

export async function POST(request: Request, context: Context) {
  return handleGaragePhoto(request, (await context.params).id);
}
