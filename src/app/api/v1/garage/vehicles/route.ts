import { handleGarage } from '@/server/garage/handler';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleGarage(request, 'list', undefined);
export const POST = (request: Request) => handleGarage(request, 'create', undefined);
