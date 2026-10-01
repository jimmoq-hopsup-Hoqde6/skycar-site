import { createHmac } from 'node:crypto';
import { guestHandler } from '@/server/care/guest-http.mjs';
import { GuestError } from '@/domain/care/guest.mjs';
import { createSupabaseTrustedServerClient } from '@/server/supabase/server';
import { featureEnabled, requireSupabaseSecretConfig } from '@/server/env';

export const runtime = 'nodejs';
export const POST = guestHandler({
  enabled: () => featureEnabled('CARE'),
  save: async (key: string, payload: Record<string,unknown>, request: Request) => {
    const {secretKey} = requireSupabaseSecretConfig();
    // Vercel owns this header. Never retain raw network addresses in the queue.
    const address = request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim();
    if (!address) throw new GuestError('UNAVAILABLE');
    const fingerprint = createHmac('sha256',secretKey).update(address).digest('hex');
    const {data,error} = await createSupabaseTrustedServerClient().rpc('care_submit_guest_request',{
      p_key:key,p_payload:payload,p_fingerprint:fingerprint,
    });
    if (error) {
      if (error.code === 'P0001' && ['RATE_LIMITED','IDEMPOTENCY_CONFLICT','VALIDATION_FAILED'].includes(error.message)) throw new GuestError(error.message);
      throw new GuestError('UNAVAILABLE');
    }
    return data;
  },
});
