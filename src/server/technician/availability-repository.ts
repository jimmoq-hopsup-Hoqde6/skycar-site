import 'server-only';
import { createSupabaseServerClient, createSupabaseTrustedServerClient } from '@/server/supabase/server';
import { featureEnabled } from '@/server/env';
import { availabilityFault, availabilityWriteFault } from './availability-http.mjs';

async function sessionAccess(expectedAccount?: string) {
  if (!featureEnabled('CARE')) throw availabilityFault('UNAVAILABLE');
  const session = await createSupabaseServerClient();
  const auth = await session.auth.getUser();
  if (auth.error || !auth.data.user) throw availabilityFault('UNAUTHENTICATED');
  const actor = auth.data.user.id;
  if (expectedAccount !== undefined && actor !== expectedAccount) throw availabilityFault('FORBIDDEN');
  const roles = await session.from('user_roles').select('role').eq('user_id', actor).eq('role', 'technician');
  if (roles.error) throw availabilityFault('UNAVAILABLE');
  if (!roles.data?.length) throw availabilityFault('FORBIDDEN');
  return { db: createSupabaseTrustedServerClient(), actor };
}

function faultFrom(error: { code?: string; message?: string }) {
  throw availabilityFault(error.code === 'P0001' && error.message ? error.message : 'UNAVAILABLE');
}

export async function readTechnicianAvailability() {
  const { db, actor } = await sessionAccess();
  const result = await db.rpc('care_technician_availability_read', { p_actor: actor });
  if (result.error) faultFrom(result.error);
  return { account: actor, data: result.data };
}

export async function replaceTechnicianAvailability(
  key: string,
  command: { expectedRevision: number; payload: Record<string, unknown> },
  expectedAccount: string,
) {
  const { db, actor } = await sessionAccess(expectedAccount);
  const result = await db.rpc('care_technician_replace_availability', {
    p_actor: actor,
    p_key: key,
    p_expected_revision: command.expectedRevision,
    p_payload: command.payload,
  });
  if (result.error) throw availabilityWriteFault(result.error);
  return { account: actor, data: result.data };
}
