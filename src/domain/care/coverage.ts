// Browser-side reading of the coverage decision (POST /api/v1/care/coverage).
// Pure and dependency-free so it can be unit-tested. This module holds NO suburb,
// postcode or region list: the server is the only authority (docs/contracts/service-coverage.md).

export type CoverageService = "repair" | "cleaning";

export type CoverageOutcome =
  | { kind: "in_area"; postcode: string }
  | { kind: "out_of_area"; postcode: string }
  | { kind: "invalid_input" }
  // The server could not (or the browser could not confirm that it did) make a decision.
  | { kind: "unknown"; reason: "unavailable" | "network" | "unexpected" };

export const POSTCODE_PATTERN = /^[0-9]{4}$/;

export function normalisePostcode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isPostcodeShape(value: unknown): value is string {
  return typeof value === "string" && POSTCODE_PATTERN.test(value);
}

// `status` and `body` come from the HTTP response; `sent` is what the browser asked about.
// Anything that is not an exact, matching decision is treated as unknown, never as in-area.
export function readCoverageResponse(status: number, body: unknown, sent: { service: CoverageService; postcode: string }): CoverageOutcome {
  const envelope = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (status === 200 && envelope) {
    const data = envelope.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const value = data as Record<string, unknown>;
      const keys = Object.keys(value).sort().join(",");
      if (keys === "coverage,postcode,service" && value.service === sent.service && value.postcode === sent.postcode) {
        if (value.coverage === "available") return { kind: "in_area", postcode: sent.postcode };
        if (value.coverage === "unavailable") return { kind: "out_of_area", postcode: sent.postcode };
      }
    }
    return { kind: "unknown", reason: "unexpected" };
  }
  const error = envelope?.error && typeof envelope.error === "object" ? (envelope.error as Record<string, unknown>) : null;
  if (status === 400 && error?.code === "VALIDATION_FAILED") return { kind: "invalid_input" };
  if (status === 503 && error?.code === "COVERAGE_UNAVAILABLE") return { kind: "unknown", reason: "unavailable" };
  return { kind: "unknown", reason: status >= 500 ? "unavailable" : "unexpected" };
}

export async function checkCoverage(
  sent: { service: CoverageService; postcode: string },
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CoverageOutcome> {
  if (!isPostcodeShape(sent.postcode)) return { kind: "invalid_input" };
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch("/api/v1/care/coverage", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: sent.service, postcode: sent.postcode }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });
  } catch {
    return { kind: "unknown", reason: "network" };
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* unreadable body is handled by status below */ }
  return readCoverageResponse(response.status, body, sent);
}
