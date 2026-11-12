import { guestCookie } from '@/server/care/journey/access.mjs';
import { getPublicEnvironment } from '@/server/env';
import { createHmac } from 'node:crypto';
import { saveGuestIntake } from '@/server/care/guest-intake.mjs';
import { guestHandler } from '@/server/care/guest-http.mjs';
import { GuestError } from '@/domain/care/guest.mjs';
import { createSupabaseTrustedServerClient } from '@/server/supabase/server';
import { featureEnabled, requireSupabaseSecretConfig } from '@/server/env';
import { SecretConfigurationError } from '@/server/supabase/secret-config.mjs';

export const runtime = 'nodejs';
export const POST = guestHandler({
  enabled: () => featureEnabled('CARE'),
  receiptHeaders: (key: string, receipt: {id:string}) => ({'Set-Cookie':guestCookie(requireSupabaseSecretConfig().secretKey,receipt.id,key,getPublicEnvironment()!=='demo')}),
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
    return saveGuestIntake({client,key,payload,fingerprint,photos});
  },
});
