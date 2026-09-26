import { createSupabaseServerClient } from '@/server/supabase/server';
import { featureEnabled } from '@/server/env';
import { GarageError } from '@/domain/garage/vehicles.mjs';
import { createGarageHandler } from './http.mjs';
import { garageRepository } from './repository';

export const handleGarage = createGarageHandler(async () => {
  if (!featureEnabled('GARAGE') || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new GarageError('GARAGE_UNAVAILABLE', 503, 'Garage is not available yet. Please try again later.');
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) throw new GarageError('UNAUTHENTICATED', 401, 'Sign in to access your Garage.');
  return { repository: garageRepository(client, data.claims.sub) };
});
