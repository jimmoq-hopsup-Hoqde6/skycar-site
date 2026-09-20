import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

test("built Next.js Care routes fail closed without activation/configuration", { timeout: 30000 }, async () => {
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
      for (const [path, method] of [
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
