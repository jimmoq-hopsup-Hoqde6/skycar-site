import { CareError, careInput, object, uuid } from "../../domain/care/request.ts";
import type { CareInput, CareReceipt } from "../../domain/care/request.ts";
import { careListPage, careListQuery } from "../../domain/care/list.ts";
import type { CareListQuery, CareListRows } from "../../domain/care/list.ts";

export interface CareRepository {
  list(query: CareListQuery): Promise<CareListRows>;
  submit(key: string, input: CareInput): Promise<{ request: CareReceipt; replayed: boolean }>;
  get(id: string): Promise<CareReceipt>;
  retry(id: string, key: string): Promise<{ request: CareReceipt; replayed: boolean }>;
}

type Dependencies = {
  enabled: () => boolean;
  // Production factory must verify the session before returning a scoped repo.
  connect: () => Promise<CareRepository>;
};

const errors: Record<string, { status: number; message: string; retryable: boolean }> = {
  VALIDATION_FAILED: { status: 400, message: "Check the request details.", retryable: false },
  UNAUTHENTICATED: { status: 401, message: "Sign in to continue.", retryable: false },
  FORBIDDEN: { status: 403, message: "This action is not permitted.", retryable: false },
  CSRF_FAILED: { status: 403, message: "Submit this request from Skycar.", retryable: false },
  NOT_FOUND: { status: 404, message: "Request or vehicle not found.", retryable: false },
  IDEMPOTENCY_CONFLICT: { status: 409, message: "This request key was already used for different details.", retryable: false },
  INVALID_TRANSITION: { status: 409, message: "This request cannot be retried in its current state.", retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, message: "Request body is too large.", retryable: false },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Use application/json.", retryable: false },
  CARE_UNAVAILABLE: { status: 503, message: "Care requests are not currently enabled.", retryable: false },
  POLICY_UNAVAILABLE: { status: 503, message: "Care response times have not been configured.", retryable: false },
  TEMPORARILY_UNAVAILABLE: { status: 503, message: "Unable to save or load your request. Retry with the same request key.", retryable: true },
  INTERNAL_ERROR: { status: 500, message: "Unable to process your request.", retryable: false },
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new CareError("CSRF_FAILED");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new CareError("UNSUPPORTED_MEDIA_TYPE");
  }
  // Read a bounded stream; Content-Length alone cannot be trusted.
  const reader = request.body?.getReader();
  if (!reader) throw new CareError("VALIDATION_FAILED");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) {
        await reader.cancel();
        throw new CareError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CareError("VALIDATION_FAILED"); }
}

export function careHandlers(deps: Dependencies) {
  async function run(action: (repo: CareRepository) => Promise<{ data: unknown; status: number }>) {
    const requestId = crypto.randomUUID();
    try {
      if (!deps.enabled()) throw new CareError("CARE_UNAVAILABLE");
      const result = await action(await deps.connect());
      return json({ data: result.data, meta: { requestId } }, result.status);
    } catch (error) {
      const code = error instanceof CareError && error.code in errors ? error.code : "INTERNAL_ERROR";
      const { status, message, retryable } = errors[code];
      // Do not log request bodies, cookies, provider errors or vehicle identifiers.
      if (status >= 500) console.error(JSON.stringify({ event: "care_api_failure", requestId, code }));
      return json({ error: { code, message, fieldErrors: {}, retryable }, meta: { requestId } }, status);
    }
  }
  return {
    list: (request: Request) => run(async repo => {
      const query = careListQuery(new URL(request.url).searchParams);
      return { data: careListPage(await repo.list(query), query), status: 200 };
    }),
    submit: (request: Request) => run(async repo => {
      const body = await readBody(request);
      const result = await repo.submit(uuid(request.headers.get("idempotency-key")), careInput(body));
      return { data: result, status: result.replayed ? 200 : 201 };
    }),
    get: (id: string) => run(async repo => ({ data: await repo.get(uuid(id)), status: 200 })),
    retry: (request: Request, id: string) => run(async repo => {
      if (Object.keys(object(await readBody(request))).length) throw new CareError("VALIDATION_FAILED");
      const result = await repo.retry(uuid(id), uuid(request.headers.get("idempotency-key")));
      return { data: result, status: 200 };
    }),
  };
}
