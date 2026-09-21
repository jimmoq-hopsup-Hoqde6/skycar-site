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
async function garageResponse<T>(path: string, init: RequestInit = {}): Promise<{ data: T; meta?: { accountId?: string } }> {
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
  return body;
}
export async function garageApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await garageResponse<T>(path, init)).data;
}
export async function garageAccountPage(path: string, init: RequestInit = {}) {
  const result = await garageResponse<Page<Vehicle>>(path, init);
  const accountId = result.meta?.accountId;
  if (typeof accountId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
    throw new ApiError('ACCOUNT_UNVERIFIED', 'We could not verify your account. Try loading your Garage again.', {}, true);
  }
  return { page: result.data, accountId };
}
