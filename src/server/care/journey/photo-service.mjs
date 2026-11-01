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

export async function consumePhotoQuota(db, access, { limit = PHOTO_UPLOAD_LIMIT, windowSeconds = PHOTO_UPLOAD_WINDOW_SECONDS } = {}) {
  const { data, error } = await db.rpc('care_consume_photo_upload_quota', { p_subject: quotaSubject(access), p_limit: limit, p_window_seconds: windowSeconds });
  // Fail closed: if the counter cannot be read the upload is not accepted.
  if (error || !data || typeof data.allowed !== 'boolean') throw new PhotoError('UNAVAILABLE');
  if (!data.allowed) throw new PhotoError('RATE_LIMITED', Math.max(1, Math.min(windowSeconds, Number(data.retry_after_seconds) || windowSeconds)));
  return data;
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
// CSRF -> upload quota -> bounded body -> validation -> storage -> DB marker.
export async function handlePhotoUpload(request, id, deps) {
  const completion = new URL(request.url).searchParams.get('kind') === 'completion';
  const access = await deps.access(request, id, completion);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'multipart/form-data') throw new PhotoError('VALIDATION_FAILED');
  if (!deps.isTrustedWrite(request)) throw new PhotoError('CSRF_FAILED');
  // Administrator completion evidence is a separate trusted workflow, not a customer upload.
  if (!completion) await deps.consumeQuota(access);
  const bytes = await deps.readBody(request, 2_800_000);
  let photos;
  try {
    const data = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') } }).formData();
    if ([...data.keys()].some(key => key !== 'photos')) throw new Error();
    photos = await deps.readPhotos(data.getAll('photos'));
    if (!photos.length) throw new Error();
  } catch { throw new PhotoError('VALIDATION_FAILED'); }
  await deps.save(access, photos, completion);
  return { status: 201, data: { stored: photos.length }, account: access.account };
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
