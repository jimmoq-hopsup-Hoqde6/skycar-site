// Request-photo server logic with injected dependencies, so route behaviour is
// unit-testable without Next, Supabase or Storage. Nothing here reads or logs a
// service key; signed URLs are returned only to the caller who passed access.
export const PHOTO_UPLOAD_LIMIT = 10;
export const PHOTO_UPLOAD_WINDOW_SECONDS = 3600;
// Short, fixed server-side TTL. 120 s covers an <img> load plus one retry of a
// <= 900,000 byte file on a slow mobile link (about 7 s at 1 Mbps), while a
// leaked bearer URL stops working within two minutes. Not client-selectable.
export const SIGNED_URL_TTL_SECONDS = 120;
export const MIN_SIGNED_URL_TTL_SECONDS = 60;
export const MAX_SIGNED_URL_TTL_SECONDS = 300;

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

// A request whose photo set is already recorded can store nothing new (the
// manifest is write-once), so uploads to it are free. Unknown means "not recorded".
export async function hasRecordedPhotos(db, requestId) {
  try {
    const { data, error } = await db.from('care_request_photo_sets').select('request_id').eq('request_id', requestId).maybeSingle();
    return !error && Boolean(data);
  } catch { return false; }
}

export async function recordRequestPhotos(db, requestId, { count, manifestSha256 }) {
  const { data, error } = await db.rpc('care_record_request_photos', { p_request_id: requestId, p_count: count, p_manifest_sha256: manifestSha256 });
  if (error) throw new PhotoError(error.code === 'P0001' && error.message === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'UNAVAILABLE');
  return data;
}

export function clampSignedUrlTtl(value) {
  const ttl = Number.isInteger(value) ? value : SIGNED_URL_TTL_SECONDS;
  return Math.min(MAX_SIGNED_URL_TTL_SECONDS, Math.max(MIN_SIGNED_URL_TTL_SECONDS, ttl));
}

export async function signedPhotoUrl({ storage, prefix, manifest, slot, ttl = SIGNED_URL_TTL_SECONDS, now = () => Date.now() }) {
  const meta = manifest.find(entry => entry.slot === slot);
  if (!meta) throw new PhotoError('NOT_FOUND');
  const seconds = clampSignedUrlTtl(ttl);
  const { data, error } = await storage.createSignedUrl(`${prefix}/photo-${slot}`, seconds);
  if (error || !data || typeof data.signedUrl !== 'string') throw new PhotoError('UNAVAILABLE');
  return {
    slot, url: data.signedUrl, mime_type: meta.mime_type, size_bytes: meta.size_bytes,
    expires_in: seconds, expires_at: new Date(now() + seconds * 1000).toISOString(),
  };
}

// POST /api/v1/care/journey/:id/photos. Order: ownership -> content type ->
// CSRF -> quota reservation (account uploads without a recorded set) -> bounded
// body -> validation -> storage -> DB marker. Quota policy: a slot is kept only
// by the call that creates the marker (save returns {recorded:{replayed:false}}).
// Invalid or rejected bodies, any failure/503, and replays release the slot.
// Guest and admin-completion uploads are not account uploads and are not limited
// (their sets are write-once; guests are limited by intake).
export async function handlePhotoUpload(request, id, deps) {
  const completion = new URL(request.url).searchParams.get('kind') === 'completion';
  const access = await deps.access(request, id, completion);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'multipart/form-data') throw new PhotoError('VALIDATION_FAILED');
  if (!deps.isTrustedWrite(request)) throw new PhotoError('CSRF_FAILED');
  const limited = !completion && access.kind === 'account';
  let reservation = null;
  if (limited && !(await deps.hasRecordedPhotos(access))) reservation = await deps.reserveQuota(access);
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
    const outcome = await deps.save(access, photos, completion);
    keep = reservation !== null && outcome?.recorded?.replayed === false;
    return { status: 201, data: { stored: photos.length }, account: access.account };
  } finally {
    if (reservation && !keep) await deps.releaseQuota(access, reservation);
  }
}

// GET /api/v1/care/journey/:id/photos/:slot/url
export async function handlePhotoUrl(request, id, slotValue, deps) {
  if (!/^[1-3]$/.test(slotValue)) throw new PhotoError('NOT_FOUND');
  const completion = new URL(request.url).searchParams.get('kind') === 'completion';
  const access = await deps.access(request, id);
  if (completion) await deps.completionVisible(access);
  const data = await deps.sign(access, Number(slotValue), completion);
  return { status: 200, data, account: access.account };
}
