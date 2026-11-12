import { GuestError, guestReceipt } from '../../domain/care/guest.mjs';
import { saveGuestIntakePhotos } from './journey/photo-service.mjs';

// Database decisions that are safe to show the customer. OUT_OF_AREA and COVERAGE_UNAVAILABLE come
// from care_submit_guest_request's service-area check (migration 20261101160000).
export const GUEST_DB_ERRORS = ['RATE_LIMITED', 'IDEMPOTENCY_CONFLICT', 'VALIDATION_FAILED', 'OUT_OF_AREA', 'COVERAGE_UNAVAILABLE'];

// Creates the guest request, and only then stores its photos through saveGuestIntakePhotos, which
// writes the immutable manifest and slots and then records the photo marker on the request. Every
// database rejection (including the service-area check) throws before `store` is reached, so a
// rejected request does no Storage, photo or marker I/O at all.
export async function saveGuestIntake({ client, key, payload, fingerprint, photos, store = saveGuestIntakePhotos }) {
  const { data, error, status } = await client.rpc('care_submit_guest_request', {
    p_key: key, p_payload: payload, p_fingerprint: fingerprint,
  });
  if (error) {
    if (status === 401 || status === 403) throw new GuestError('CONFIGURATION_UNAVAILABLE');
    if (error.code === 'P0001' && GUEST_DB_ERRORS.includes(error.message)) throw new GuestError(error.message);
    throw new GuestError('UNAVAILABLE');
  }
  const receipt = guestReceipt(data);
  await store({ db: client, bucket: client.storage.from('private-media'), requestId: receipt.id, photos });
  return receipt;
}
