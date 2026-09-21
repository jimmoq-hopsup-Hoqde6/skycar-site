export type Vehicle = {
  id: string; make: string; model: string; variant: string | null; year: number | null;
  registration: string | null; registration_state: string | null; revision: number;
  archived_at: string | null; created_at: string; updated_at: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type HistoryEvent = { id: string; event_type: string; occurred_at: string; source: string; payload: Record<string, unknown> };
export class ApiError extends Error {
  constructor(public code: string, message: string, public fieldErrors: Record<string, string> = {}, public retryable = false) { super(message); }
}
export async function garageApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/v1/garage/vehicles${path}`, { ...init, cache: 'no-store', credentials: 'same-origin' }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Unable to connect. Check your connection and try again.', {}, true);
  }
  let body;
  try { body = await response.json(); }
  catch { throw new ApiError('NETWORK_ERROR', 'Unable to read the response. Please try again.', {}, true); }
  if (!response.ok) throw new ApiError(body.error?.code ?? 'INTERNAL_ERROR', body.error?.message ?? 'Please try again.', body.error?.fieldErrors, body.error?.retryable ?? response.status >= 500);
  return body.data;
}
