import { isTrustedWriteOrigin } from "../http/request-origin.mjs";
import {
  CareCatalogueError,
  coverageInput,
  type Coverage,
  type CoverageInput,
} from "../../domain/care/catalogue.ts";

type Service = Readonly<{ id: "repair" | "cleaning"; name: string }>;

type Dependencies = {
  services: readonly Service[];
  resolveCoverage: (input: CoverageInput) => Promise<Coverage>;
};

const errors: Record<string, { status: number; message: string; retryable: boolean }> = {
  VALIDATION_FAILED: { status: 400, message: "Check the coverage details.", retryable: false },
  CSRF_FAILED: { status: 403, message: "Submit this request from Skycar.", retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, message: "Request body is too large.", retryable: false },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Use application/json.", retryable: false },
  COVERAGE_UNAVAILABLE: { status: 503, message: "Coverage cannot be confirmed right now.", retryable: true },
  INTERNAL_ERROR: { status: 500, message: "Unable to process the coverage request.", retryable: false },
};

function json(body: unknown, status: number, cacheControl: string) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" },
  });
}

async function readBody(request: Request): Promise<unknown> {
  if (!isTrustedWriteOrigin(request)) {
    throw new CareCatalogueError("CSRF_FAILED");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new CareCatalogueError("UNSUPPORTED_MEDIA_TYPE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new CareCatalogueError("VALIDATION_FAILED");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) {
        await reader.cancel();
        throw new CareCatalogueError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CareCatalogueError("VALIDATION_FAILED"); }
}

export function careCatalogueHandlers(deps: Dependencies) {
  async function run(action: () => Promise<{ data: unknown; status: number }>) {
    const requestId = crypto.randomUUID();
    try {
      const result = await action();
      return json({ data: result.data, meta: { requestId } }, result.status, "no-store");
    } catch (error) {
      const code = error instanceof CareCatalogueError && error.code in errors ? error.code : "INTERNAL_ERROR";
      const { status, message, retryable } = errors[code];
      // Do not log request bodies, postcodes, cookies or resolver/provider details.
      if (status >= 500) console.error(JSON.stringify({ event: "care_coverage_api_failure", requestId, code }));
      return json({ error: { code, message, fieldErrors: {}, retryable }, meta: { requestId } }, status, "no-store");
    }
  }

  return {
    list: async () => {
      const requestId = crypto.randomUUID();
      return json(
        { data: { services: deps.services }, meta: { requestId } },
        200,
        "public, max-age=300, stale-while-revalidate=60",
      );
    },
    check: (request: Request) => run(async () => {
      const input = coverageInput(await readBody(request));
      let coverage: Coverage;
      try {
        coverage = await deps.resolveCoverage(input);
      } catch {
        // Resolver outages are one public condition regardless of provider or
        // transport details. Do not let adapter exceptions change the API.
        throw new CareCatalogueError("COVERAGE_UNAVAILABLE");
      }
      if (coverage !== "available" && coverage !== "unavailable") {
        throw new CareCatalogueError("COVERAGE_UNAVAILABLE");
      }
      return { data: { ...input, coverage }, status: 200 };
    }),
  };
}
