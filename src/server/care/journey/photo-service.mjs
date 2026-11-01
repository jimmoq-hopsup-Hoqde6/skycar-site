// Request-photo server logic with injected dependencies, so route behaviour is
// unit-testable without Next, Supabase or Storage. Nothing here reads or logs a
// service key.
import { GuestError } from '../../../domain/care/guest.mjs';
import { manifestDigest, storeCarePhotos, verifyStoredCarePhotos } from '../guest-photos.mjs';

export const PHOTO_UPLOAD_LIMIT = 10;
export const PHOTO_UPLOAD_WINDOW_SECONDS = 3600;
export class PhotoError extends Error {
  constructor(code, retryAfter) { super(code); this.name = 'PhotoError'; this.code = code; this.retryAfter = retryAfter; }
}

export function quotaSubject(access) {
  if (typeof access?.account !== 'string' || !access.account) throw new PhotoError('UNAVAILABLE');
  return `journey-photos:${access.account}`.slice(0, 80);
}

// Reserve-before-store: the slot is taken atomically in the database before any
// body is read, so concurrent uploads can never exceed the limit. The caller
// must release it on every path except a call that created the photo marker.
export async function reservePhotoSlot(db, access, { limit = PHOTO_UPLOAD_LIMIT, windowSeconds = PHOTO_UPLOAD_WINDOW_SECONDS } = {}) {
  const subject = quotaSubject(access);
  const { data, error } = await db.rpc('care_reserve_photo_upload_slot', { p_subject: subject, p_limit: limit, p_window_seconds: windowSeconds });
  // Fail closed: if the counter cannot be read the upload is not accepted.
  if (error || !data || typeof data.allowed !== 'boolean') throw new PhotoError('UNAVAILABLE');
  if (!data.allowed) throw new PhotoError('RATE_LIMITED', Math.max(1, Math.min(windowSeconds, Number(data.retry_after_seconds) || windowSeconds)));
  if (typeof data.window_start !== 'string') throw new PhotoError('UNAVAILABLE');
  return { subject, windowStart: data.window_start };
}

// Best effort and never throws: a failed release leaves the slot held until the
// window ends (conservative) and must not hide the error that caused the release.
export async function releasePhotoSlot(db, reservation) {
  try {
    const { error } = await db.rpc('care_release_photo_upload_slot', { p_subject: reservation.subject, p_window_start: reservation.windowStart });
    return !error;
  } catch { return false; }
}

// The marker of a request (account or guest), or null. state 'recorded' carries the real
// manifest hash; state 'legacy_unknown' means photos are known to exist but the hash is not
// known (manifestSha256 is null, count is only what was observed). Unknown (a read error or
// an unrecognised row) is treated as "no marker": the upload then takes the normal quota and
// Storage path, which is idempotent, so a failed read can never grant a free pass.
export async function recordedPhotoSet(db, requestId, kind = 'account') {
  try {
    const { data, error } = await db.from('care_request_photo_sets').select('manifest_sha256,photo_count,marker_state').eq('request_id', requestId).eq('request_kind', kind).maybeSingle();
    if (error || !data) return null;
    const state = data.marker_state ?? 'recorded';
    const count = Number(data.photo_count);
    if (!Number.isInteger(count) || count < 1 || count > 3) return null;
    if (state === 'recorded' && typeof data.manifest_sha256 === 'string') return { state, manifestSha256: data.manifest_sha256, count };
    if (state === 'legacy_unknown' && data.manifest_sha256 == null) return { state, manifestSha256: null, count };
    return null;
  } catch { return null; }
}

export async function recordRequestPhotos(db, requestId, { count, manifestSha256 }, kind = 'account') {
  const { data, error } = await db.rpc('care_record_request_photos', { p_request_id: requestId, p_count: count, p_manifest_sha256: manifestSha256, p_kind: kind });
  if (error) throw new PhotoError(error.code === 'P0001' && error.message === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'UNAVAILABLE');
  return data;
}

// Quota-free heal for a request with no marker. One database call: when Storage metadata
// shows a complete set (manifest + consecutive photo-1..N) a 'legacy_unknown' marker (no hash)
// is written; otherwise nothing is. It never reads the quota table, never calls Storage and
// never invents a hash. Returns the marker ({state, manifestSha256, count}) or null.
export async function healPhotoMarker(db, requestId, kind = 'account') {
  const { data, error } = await db.rpc('care_heal_request_photo_marker', { p_request_id: requestId, p_kind: kind });
  if (error || !data || typeof data.state !== 'string') throw new PhotoError('UNAVAILABLE');
  if (data.state === 'recorded' && typeof data.manifest_sha256 === 'string') return { state: 'recorded', manifestSha256: data.manifest_sha256, count: Number(data.photo_count) };
  if (data.state === 'legacy_unknown') return { state: 'legacy_unknown', manifestSha256: null, count: Number(data.photo_count) };
  return null;
}

// Stores one photo set and records its marker. `stateOpen` is false when the journey has
// moved past the upload window. Then nothing new may be written, but if the identical
// complete set already sits in Storage (a marker 503 followed by a transition) the marker
// is healed from it, so has_photos cannot stay false while photos exist.
// Completion evidence has no marker. Returns {recorded} when a marker was written or confirmed.
export async function savePhotoSet({ db, bucket, prefix, photos, requestId, kind, completion = false, stateOpen = true }) {
  if (!stateOpen) {
    const existing = completion ? null : await verifyStoredCarePhotos(bucket, prefix, photos).catch(() => null);
    if (!existing) throw new PhotoError('INVALID_TRANSITION');
    return { recorded: await recordRequestPhotos(db, requestId, existing, kind) };
  }
  let stored;
  try { stored = await storeCarePhotos(bucket, prefix, photos); }
  catch (error) { throw new PhotoError(error instanceof Error && 'code' in error ? String(error.code) : 'UNAVAILABLE'); }
  // Storage stays the source of truth; a marker failure is a retryable 503 and the
  // identical retry re-records it idempotently.
  if (!completion && stored) return { recorded: await recordRequestPhotos(db, requestId, stored, kind) };
  return null;
}

// POST /api/v1/care/journey/:id/photos. Order: ownership -> content type -> CSRF ->
// marker lookup (one PK read) -> quota-free heal when there is no marker (one database call,
// no Storage) -> quota reservation (account upload of a request with no marker only) ->
// bounded body -> validation -> hash compare -> storage -> DB marker.
// A request with a 'recorded' marker never touches Storage: an identical body (same manifest
// hash) returns success, a different one IDEMPOTENCY_CONFLICT, and neither takes quota.
// A legacy request (photos already in Storage, no marker or 'legacy_unknown') gets a
// 'legacy_unknown' marker from the heal, never reserves quota (so it works at the limit), and
// goes through the idempotent Storage path: slots are verified against the body (a different
// body is IDEMPOTENCY_CONFLICT from the write-once objects, a partial set is completed), then
// the marker is upgraded to 'recorded' with the real hash of the body. Otherwise a slot is
// kept only by the call that creates the marker (save returns {recorded:{replayed:false}});
// invalid bodies, failures and 503s release it. Guest and admin-completion uploads take no
// quota (their sets are write-once; guests are limited by intake).
export async function handlePhotoUpload(request, id, deps) {
  const completion = new URL(request.url).searchParams.get('kind') === 'completion';
  const access = await deps.access(request, id, completion);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'multipart/form-data') throw new PhotoError('VALIDATION_FAILED');
  if (!deps.isTrustedWrite(request)) throw new PhotoError('CSRF_FAILED');
  let recorded = completion ? null : await deps.recordedSet(access);
  // A failed heal is not an error: the upload then takes the normal quota and Storage path.
  if (!completion && !recorded) recorded = await Promise.resolve().then(() => deps.healMarker(access)).catch(() => null);
  const limited = !completion && access.kind === 'account';
  let reservation = null;
  if (limited && !recorded) reservation = await deps.reserveQuota(access);
  let keep = false;
  try {
    const bytes = await deps.readBody(request, 2_800_000);
    let photos;
    try {
      const data = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') } }).formData();
      if ([...data.keys()].some(key => key !== 'photos')) throw new Error();
      photos = await deps.readPhotos(data.getAll('photos'));
      if (!photos.length) throw new Error();
    } catch { throw new PhotoError('VALIDATION_FAILED'); }
    if (recorded?.state === 'recorded') {
      const incoming = manifestDigest(photos);
      if (incoming.count !== recorded.count || incoming.manifestSha256 !== recorded.manifestSha256) throw new PhotoError('IDEMPOTENCY_CONFLICT');
      return { status: 201, data: { stored: photos.length }, account: access.account };
    }
    const outcome = await deps.save(access, photos, completion);
    keep = reservation !== null && outcome?.recorded?.replayed === false;
    return { status: 201, data: { stored: photos.length }, account: access.account };
  } finally {
    if (reservation && !keep) await deps.releaseQuota(access, reservation);
  }
}

// Guest intake: records the marker after the photos are stored, like the authenticated path.
// A request that already has a recorded set is compared by manifest hash BEFORE any Storage
// call (an intake retry with the same Idempotency-Key costs zero Storage I/O; different
// photos are IDEMPOTENCY_CONFLICT). With no marker, or a 'legacy_unknown' one, the immutable
// slots are written/verified idempotently and the marker is then recorded (or upgraded with
// the real hash). Guests take no quota. Errors are GuestError codes for guestHandler.
export async function saveGuestIntakePhotos({ db, bucket, requestId, photos }) {
  if (!photos.length) return null;
  try {
    const recorded = await recordedPhotoSet(db, requestId, 'guest');
    if (recorded?.state === 'recorded') {
      const incoming = manifestDigest(photos);
      if (incoming.count !== recorded.count || incoming.manifestSha256 !== recorded.manifestSha256) throw new PhotoError('IDEMPOTENCY_CONFLICT');
      return { replayed: true };
    }
    const stored = await storeCarePhotos(bucket, `guest-requests/${requestId}`, photos);
    await recordRequestPhotos(db, requestId, stored, 'guest');
    return { replayed: false };
  } catch (error) {
    if (error instanceof PhotoError) throw new GuestError(error.code === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'UNAVAILABLE');
    throw error;
  }
}
