import test from "node:test";
import assert from "node:assert/strict";
import { startNext } from "./support/next-server.mjs";

test("built Next.js Care routes publish the catalogue and fail closed without activation/configuration", { timeout: 30000 }, async () => {
  for (const feature of ["false", "true"]) {
    const app = await startNext({ ...process.env, FEATURE_CARE: feature, SKYCAR_ENV: "demo", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" });
    const base = app.base;
    try {
      const catalogue = await fetch(`${base}/api/v1/care/services`, { signal: AbortSignal.timeout(2000) });
      assert.equal(catalogue.status, 200);
      assert.equal(catalogue.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=60");
      assert.deepEqual((await catalogue.json()).data.services, [
        { id: "repair", name: "Scratch & dent repair" },
        { id: "cleaning", name: "Detailing & cleaning" },
      ]);

      const coverage = await fetch(`${base}/api/v1/care/coverage`, {
        method: "POST",
        // Send the real browser origin, not Next's internal normalized hostname.
        headers: { origin: base, "content-type": "application/json" },
        body: JSON.stringify({ service: "repair", postcode: "5000" }),
        signal: AbortSignal.timeout(2000),
      });
      const coverageBody = await coverage.json();
      assert.equal(coverage.status, 503, JSON.stringify(coverageBody));
      assert.equal(coverage.headers.get("cache-control"), "no-store");
      assert.equal(coverageBody.error.code, "COVERAGE_UNAVAILABLE");
      assert.equal(coverageBody.error.retryable, true);
      assert.equal(coverageBody.data, undefined);

      for (const [path, method] of [
        ["/api/v1/care/requests", "GET"],
        ["/api/v1/care/requests", "POST"],
        ["/api/v1/care/requests/11111111-1111-4111-8111-111111111111", "GET"],
        ["/api/v1/care/requests/11111111-1111-4111-8111-111111111111/retry", "POST"],
      ]) {
        const response = await fetch(base + path, { method, signal: AbortSignal.timeout(2000) });
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        const body = await response.json();
        assert.equal(body.error.code, "CARE_UNAVAILABLE");
        assert.ok(body.meta.requestId);
        assert.equal(body.data, undefined);
      }
    } finally {
      await app.stop();
    }
  }
});
