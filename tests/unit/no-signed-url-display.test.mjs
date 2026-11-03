import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The proxy route (GET .../photos/:slot) is the only photo display path. No page or component may
// call the signed-URL route (.../photos/:slot/url). The route itself lives under src/app/api and src/server.
function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path === join("src", "app", "api") ? [] : sources(path);
    return /\.(tsx?|jsx?|mjs|css)$/.test(name) ? [path] : [];
  });
}

test("no browser code requests the signed-URL photo route", () => {
  const files = [...sources(join("src", "app")), ...sources(join("src", "features")), ...sources(join("src", "domain"))];
  assert.ok(files.length > 20);
  const offenders = files.filter(file => /photos\/[^"'`\s]*\/url\b|\$\{[^}]*\}\/url\b|signed[-_ ]?url/i.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("every photo display component uses the shared proxy-only component", () => {
  const files = sources(join("src", "features", "care", "journey"));
  const fetchers = files.filter(file => /\/photos\/\$\{[^}]+\}/.test(readFileSync(file, "utf8")) && !file.endsWith("private-photo.tsx"));
  assert.deepEqual(fetchers, [], "only private-photo.tsx builds photo read URLs for display");
});
