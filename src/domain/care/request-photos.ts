// Signed-in request photos use the existing owner route
// POST /api/v1/care/journey/:id/photos (multipart, 1-3 JPEG/PNG/WebP, each <= 900 KB).
// There is no signed-in create-with-photos route, so this runs after the request exists.
export class PhotoUploadError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  // Seconds from the server's Retry-After header (429 only). Display and gating only: the server decides.
  retryAfter?: number;
  constructor(code: string, message: string, status: number, retryable: boolean, retryAfter?: number) {
    super(message);
    this.code = code; this.status = status; this.retryable = retryable; this.retryAfter = retryAfter;
  }
}

// Retry-After is delay-seconds (the photo route sends a whole number of seconds).
// Anything else is ignored rather than guessed.
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return seconds >= 1 ? seconds : undefined;
}

export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadRequestPhotos(id: string, files: File[], fetcher: typeof fetch = fetch): Promise<void> {
  if (!uuidPattern.test(id) || files.length < 1 || files.length > 3) throw new PhotoUploadError("VALIDATION_FAILED", "Choose one to three photos.", 0, false);
  const form = new FormData();
  files.forEach(file => form.append("photos", file));
  let response: Response;
  try {
    response = await fetcher(`/api/v1/care/journey/${encodeURIComponent(id)}/photos`, {
      method: "POST", cache: "no-store", credentials: "same-origin", body: form, signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new PhotoUploadError("NETWORK_ERROR", "We could not confirm whether the photos reached Skycar.", 0, true);
  }
  let envelope: { data?: { stored?: unknown }; error?: { code?: unknown; message?: unknown; retryable?: unknown } };
  try { envelope = await response.json(); }
  catch { throw new PhotoUploadError("INVALID_RESPONSE", "We could not confirm whether the photos were saved.", response.status, response.status >= 500 || response.ok); }
  if (!response.ok) {
    const error = envelope.error ?? {};
    const code = typeof error.code === "string" ? error.code : "INTERNAL_ERROR";
    const message = typeof error.message === "string" ? error.message : "We could not save the photos.";
    const limited = response.status === 429;
    throw new PhotoUploadError(code, message, response.status, error.retryable === true || response.status >= 500 || limited, limited ? parseRetryAfter(response.headers.get("Retry-After")) : undefined);
  }
  if (envelope.data?.stored !== files.length) throw new PhotoUploadError("INVALID_RESPONSE", "We could not confirm that all photos were saved.", response.status, true);
}
