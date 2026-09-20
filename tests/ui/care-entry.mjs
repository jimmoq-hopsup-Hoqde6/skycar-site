// Synthetic intercepted API fixtures: not live authentication or database verification.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium ?? playwright.default?.chromium;
const port = 3189;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
server.stdout.on("data", chunk => { output += chunk; });
server.stderr.on("data", chunk => { output += chunk; });
let browser;
try {
  for (let i = 0; i < 20; i++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log("Starting Care entry browser", output);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process", "--use-gl=angle", "--use-angle=swiftshader"], timeout: 15000 });
  const evidence = new URL("../../docs/qa/care-entry/", import.meta.url);
  await mkdir(evidence, { recursive: true });
  const vehicle = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", make: "Toyota", model: "Corolla", variant: "Ascent Sport", year: 2020, registration: "SKY123", registration_state: "SA", revision: 1, archived_at: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
  const requestId = "11111111-1111-4111-8111-111111111111";
  const received = { id: requestId, vehicle_id: vehicle.id, service: "repair", description: "Scratch on the left rear door", preferred_window: "flexible", quote_state: "in_review", assignment_state: "none", fulfilment_state: null, money_state: null, customer_stage: "request_received", next_action: "review_request", responsible_role: "operations", created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", next_update_at: "2026-09-20T13:00:00Z", events: [{ id: "22222222-2222-4222-8222-222222222222", sequence: 1, type: "request_received", occurred_at: "2026-09-20T12:00:00Z" }] };
  let vehicleMode = "ready";
  let attempts = 0;
  const keys = [];
  const bodies = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/api/v1/garage/vehicles?*", route => {
    if (vehicleMode === "session") return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED", message: "Sign in." } } });
    if (vehicleMode === "empty") return route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } });
  });
  await context.route("**/api/v1/care/requests", async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    bodies.push(route.request().postData());
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: { code: "TEMPORARILY_UNAVAILABLE", message: "Unable to save or load your request. Retry with the same request key.", retryable: true } } });
    return route.fulfill({ status: 201, json: { data: { request: received, replayed: false } } });
  });
  await context.route(`**/api/v1/care/requests/${requestId}`, route => route.fulfill({ json: { data: received } }));

  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.getByRole("link", { name: "Start a repair or cleaning request" }).click();
  await page.getByRole("heading", { name: /What does your car need today/ }).waitFor();
  await page.getByLabel("Active Garage vehicle").selectOption(vehicle.id);
  await page.getByLabel("Describe the damage or cleaning work").fill(received.description);
  await page.screenshot({ path: new URL("desktop-request.png", evidence).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByRole("button", { name: "Check same request" }).waitFor();
  await page.getByText("Do not change the details yet.").waitFor();
  assert.equal(await page.getByLabel("Describe the damage or cleaning work").isDisabled(), true);
  await page.screenshot({ path: new URL("mobile-uncertain-retry.png", evidence).pathname, fullPage: true });
  await page.getByRole("button", { name: "Check same request" }).click();
  await page.waitForURL(`${origin}/care/requests/${requestId}`);
  await page.getByText(received.description).waitFor();
  assert.equal(page.url(), `${origin}/care/requests/${requestId}`);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(JSON.parse(bodies[0]), { vehicle_id: vehicle.id, service: "repair", description: received.description, preferred_window: "flexible" });

  vehicleMode = "session";
  const sessionPage = await context.newPage();
  await sessionPage.setViewportSize({ width: 390, height: 844 });
  await sessionPage.goto(`${origin}/care/request`);
  await sessionPage.getByRole("heading", { name: "Sign in to request care" }).waitFor();
  assert.equal(await sessionPage.getByLabel("Active Garage vehicle").count(), 0);
  await sessionPage.screenshot({ path: new URL("mobile-session-required.png", evidence).pathname, fullPage: true });

  vehicleMode = "empty";
  const emptyPage = await context.newPage();
  await emptyPage.goto(`${origin}/care/request`);
  await emptyPage.getByRole("heading", { name: "Add a vehicle first" }).waitFor();
  assert.equal(await emptyPage.getByRole("link", { name: "Add a vehicle in Garage" }).getAttribute("href"), "/garage");
  console.log("PASS: public service entry, active vehicle, exact contract, uncertain same-key retry, receipt navigation, mobile, session and empty Garage states");
} finally {
  if (browser) await browser.close();
  server.kill();
}
