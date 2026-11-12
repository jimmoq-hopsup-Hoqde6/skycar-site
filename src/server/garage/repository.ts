import type { SupabaseClient } from '@supabase/supabase-js';
import { GarageError, publicVehicle } from '@/domain/garage/vehicles.mjs';

const columns = 'id,make,model,variant,year,registration,registration_state,revision,archived_at,created_at,updated_at';
type Query = { limit: number; after: string | null; archived: boolean };
type DatabaseError = { message: string; code?: string };

function databaseFailure(error: DatabaseError): never {
  const known: Record<string, [number, string]> = {
    UNAUTHENTICATED: [401, 'Your session has expired. Please sign in again.'],
    NOT_FOUND: [404, 'Vehicle not found.'],
    REVISION_CONFLICT: [409, 'This vehicle changed. Reload it before saving again.'],
    VEHICLE_ARCHIVED: [409, 'This vehicle has been archived.'],
    IDEMPOTENCY_CONFLICT: [409, 'This retry key was already used for a different request.'],
    VALIDATION_FAILED: [400, 'Check the vehicle details.'],
  };
  const match = known[error.message];
  if (match) throw new GarageError(error.message, match[0], match[1]);
  throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'Your Garage is temporarily unavailable. Please try again.');
}

export function garageRepository(client: SupabaseClient, userId: string) {
  async function get(id: string) {
    const { data, error } = await client.from('vehicles').select(columns).eq('owner_id', userId).eq('id', id).maybeSingle();
    if (error) databaseFailure(error);
    if (!data) throw new GarageError('NOT_FOUND', 404, 'Vehicle not found.');
    return data;
  }
  return {
    get,
    async list({ limit, after, archived }: Query) {
      let query = client.from('vehicles').select(columns).eq('owner_id', userId).order('id').limit(limit + 1);
      query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
      if (after) query = query.gt('id', after);
      const { data, error } = await query;
      if (error) databaseFailure(error);
      const rows = data ?? [];
      return { items: rows.slice(0, limit).map(publicVehicle), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    },
    async history(id: string, { limit, after }: Query) {
      await get(id); // identical not-found response for missing and other-owner IDs
      let query = client.from('vehicle_history').select('id,event_type,occurred_at,source,payload,created_at').eq('vehicle_id', id).order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
      if (after) {
        // Both components are strictly validated by parseVehicleQuery before interpolation.
        const [timestamp, cursorId] = after.split('|');
        query = query.or(`occurred_at.lt.${timestamp},and(occurred_at.eq.${timestamp},id.lt.${cursorId})`);
      }
      const { data, error } = await query;
      if (error) databaseFailure(error);
      const rows = data ?? [];
      return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? `${rows[limit - 1].occurred_at}|${rows[limit - 1].id}` : null };
    },
    async mutate(command: string, id: string | null, payload: Record<string, unknown>, key: string, requestId: string) {
      const { data, error } = await client.rpc('garage_mutate_vehicle', {
        p_command: command, p_vehicle_id: id, p_payload: payload, p_key: key, p_request_id: requestId,
      });
      if (error) databaseFailure(error);
      if (!data || typeof data !== 'object' || !data.id) throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'Your Garage is temporarily unavailable.');
      return data;
    },
  };
}
