import { createHmac } from 'node:crypto';
import { storeGuestPhotos } from '@/server/care/guest-photos.mjs';
import { guestReceipt } from '@/domain/care/guest.mjs';
import { guestHandler } from '@/server/care/guest-http.mjs';
import { GuestError } from '@/domain/care/guest.mjs';
import { createSupabaseTrustedServerClient } from '@/server/supabase/server';
import { featureEnabled, requireSupabaseSecretConfig } from '@/server/env';
import { SecretConfigurationError } from '@/server/supabase/secret-config.mjs';

export const runtime = 'nodejs';
export const POST = guestHandler({
  enabled: () => featureEnabled('CARE'),
  save: async (key: string, payload: Record<string,unknown>, request: Request, photos: {bytes: Buffer; mimeType: string; hash: string}[]) => {
    let secretKey:string;
    try { ({secretKey}=requireSupabaseSecretConfig()); }
    catch(error) {
      if(error instanceof SecretConfigurationError) throw new GuestError('CONFIGURATION_UNAVAILABLE');
      throw new GuestError('UNAVAILABLE');
    }
    // Vercel owns this header. Never retain raw network addresses in the queue.
    const address = request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim();
    if (!address) throw new GuestError('UNAVAILABLE');
    const fingerprint = createHmac('sha256',secretKey).update(address).digest('hex');
    const client = createSupabaseTrustedServerClient();
    const {data,error,status} = await client.rpc('care_submit_guest_request',{
      p_key:key,p_payload:payload,p_fingerprint:fingerprint,
    });
    if (error) {
      if(status===401 || status===403) throw new GuestError('CONFIGURATION_UNAVAILABLE');
      if (error.code === 'P0001' && ['RATE_LIMITED','IDEMPOTENCY_CONFLICT','VALIDATION_FAILED'].includes(error.message)) throw new GuestError(error.message);
      throw new GuestError('UNAVAILABLE');
    }
    const receipt = guestReceipt(data);
    await storeGuestPhotos(client.storage.from('private-media'), receipt.id, photos);
    return receipt;
  },
});
