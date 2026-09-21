import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

test("built Next.js Care routes publish the catalogue and fail closed without activation/configuration", { timeout: 30000 }, async () => {
  for (const feature of ["false", "true"]) {
    const port = feature === "false" ? 3317 : 3318;
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: { ...process.env, FEATURE_CARE: feature, SKYCAR_ENV: "demo", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    server.stdout.on("data", chunk => { output += chunk; });
    server.stderr.on("data", chunk => { output += chunk; });
    const exited = once(server, "exit");
    try {
      let ready = false;
      for (let i = 0; i < 75; i++) {
        try {
          const health = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(500) });
          await health.text();
          ready = true;
          break;
        } catch { await delay(100); }
      }
      assert.ok(ready, `Local application failed to start: ${output}`);

      const catalogue = await fetch(`${base}/api/v1/care/services`, { signal: AbortSignal.timeout(2000) });
      assert.equal(catalogue.status, 200);
      assert.equal(catalogue.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=60");
      assert.deepEqual((await catalogue.json()).data.services, [
        { id: "repair", name: "Scratch & dent repair" },
        { id: "cleaning", name: "Detailing & cleaning" },
      ]);

      const coverage = await fetch(`${base}/api/v1/care/coverage`, {
        method: "POST",
        // next start normalises the server-side request URL to localhost even
        // when the test binds 127.0.0.1.
        headers: { origin: `http://localhost:${port}`, "content-type": "application/json" },
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
      server.kill("SIGTERM");
      await exited;
    }
  }
});
