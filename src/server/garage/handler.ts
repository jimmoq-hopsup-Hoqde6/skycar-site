import { createSupabaseServerClient, createSupabaseTrustedServerClient } from '@/server/supabase/server';
import { featureEnabled } from '@/server/env';
import { GarageError } from '@/domain/garage/vehicles.mjs';
import { createGarageHandler } from './http.mjs';
import { garageRepository } from './repository';
import { createGaragePhotoHandler } from './photo-http.mjs';
import { garagePhotoRepository } from './photo-repository';
import { SecretConfigurationError } from '../supabase/secret-config.mjs';

async function garageContext() {
  if (!featureEnabled('GARAGE') || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new GarageError('GARAGE_UNAVAILABLE', 503, 'Garage is not available yet. Please try again later.');
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) throw new GarageError('UNAUTHENTICATED', 401, 'Sign in to access your Garage.');
  return { client, userId: data.claims.sub };
}

export const handleGarage = createGarageHandler(async () => {
  const { client, userId } = await garageContext();
  return { repository: garageRepository(client, userId), userId };
});

export const handleGaragePhoto = createGaragePhotoHandler(async () => {
  const { client, userId } = await garageContext();
  try {
    return { repository: garagePhotoRepository(createSupabaseTrustedServerClient(), userId) };
  } catch (error) {
    if (error instanceof SecretConfigurationError) {
      throw new GarageError('CONFIGURATION_UNAVAILABLE', 503, 'Photo uploads are unavailable right now. This upload was not saved. Please try again later.');
    }
    throw new GarageError('GARAGE_UNAVAILABLE', 503, 'Garage is not available yet. Please try again later.');
  }
});
