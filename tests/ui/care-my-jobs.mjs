// Synthetic intercepted API fixtures: not live authentication or database verification.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium ?? playwright.default?.chromium;
const port = 3188;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
server.stdout.on("data", chunk => { output += chunk; });
server.stderr.on("data", chunk => { output += chunk; });
let browser;
try {
  let ready = false;
  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline) {
    if (server.exitCode !== null) throw new Error('Fixture server exited before readiness');
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      await response.text();
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Fixture server was not ready within 30 seconds');
  console.log("Starting My Jobs browser", output);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process", "--use-gl=angle", "--use-angle=swiftshader"], timeout: 15000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const evidence = new URL("../../docs/qa/care-my-jobs/", import.meta.url);
  await mkdir(evidence, { recursive: true });
  const activeVehicle = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", make: "Toyota", model: "Corolla", variant: "Ascent Sport", year: 2020, registration: "SKY123", registration_state: "SA", revision: 1, archived_at: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
  const archivedVehicle = { ...activeVehicle, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", make: "Mazda", model: "3", registration: null, archived_at: "2026-09-19T00:00:00Z" };
  const accountBVehicle = { ...activeVehicle, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", make: "PRIVATE_B", model: "Car B", registration: "B456" };
  const base = { id: "11111111-1111-4111-8111-111111111111", vehicle_id: activeVehicle.id, vehicle_archived: false, service: "repair", quote_state: "in_review", assignment_state: "none", fulfilment_state: null, money_state: null, customer_stage: "request_received", next_action: "review_request", responsible_role: "operations", created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", next_update_at: "2026-09-20T13:00:00Z", is_overdue: true };
  const noMatch = { ...base, id: "22222222-2222-4222-8222-222222222222", vehicle_id: archivedVehicle.id, vehicle_archived: true, service: "cleaning", customer_stage: "no_match", next_action: "choose_recovery", responsible_role: "customer", next_update_at: null, is_overdue: false };
  const delayed = { ...base, id: "33333333-3333-4333-8333-333333333333", customer_stage: "delayed", next_action: "review_overdue_request", created_at: "2026-09-18T12:00:00Z" };
  const accountBJob = { ...base, id: "44444444-4444-4444-8444-444444444444", vehicle_id: accountBVehicle.id, description: "Account B only" };
  let mode = "ready";
  let firstList = true;
  let vehicleLoads = 0;
  const requestedCursors = [];
  await page.route("**/api/v1/garage/vehicles?*", async route => {
    vehicleLoads++;
    const url = new URL(route.request().url());
    if (mode === "session") return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
    if (mode === "accountB") {
      const items = url.searchParams.get("archived") === "true" ? [] : [accountBVehicle];
      return route.fulfill({ json: { data: { items, nextCursor: null } } });
    }
    const items = url.searchParams.get("archived") === "true" ? [archivedVehicle] : [activeVehicle];
    return route.fulfill({ json: { data: { items, nextCursor: null } } });
  });
  await page.route("**/api/v1/care/requests?*", async route => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    requestedCursors.push(cursor);
    if (firstList) { firstList = false; await new Promise(resolve => setTimeout(resolve, 250)); }
    if (mode === "offline") return route.abort();
    if (mode === "session") return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
    if (mode === "access") return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } });
    if (mode === "accountB") return route.fulfill({ json: { data: { items: [accountBJob], next_cursor: null, evaluated_at: "2026-09-20T14:02:00Z" } } });
    if (mode === "empty") return route.fulfill({ json: { data: { items: [], next_cursor: null, evaluated_at: "2026-09-20T14:00:00Z" } } });
    if (url.searchParams.get("vehicle_id") === archivedVehicle.id) return route.fulfill({ json: { data: { items: [noMatch], next_cursor: null, evaluated_at: "2026-09-20T14:00:00Z" } } });
    return route.fulfill({ json: { data: cursor ? { items: [delayed], next_cursor: null, evaluated_at: "2026-09-20T14:01:00Z" } : { items: [base, noMatch], next_cursor: "page-two", evaluated_at: "2026-09-20T14:00:00Z" } } });
  });
  page.setDefaultTimeout(10000);
  const navigation = page.goto(`${origin}/garage/jobs`);
  await page.getByText("Loading your requests…").waitFor();
  await navigation;
  await page.getByRole("heading", { name: "Toyota Corolla · SKY123" }).waitFor();
  assert.equal(await page.getByRole("link", { name: /View request and timeline/ }).count(), 2);
  await page.screenshot({ path: new URL("desktop-list.png", evidence).pathname, fullPage: true });
  await page.getByRole("button", { name: "Load more requests" }).click();
  await page.getByRole("heading", { name: "Toyota Corolla · SKY123" }).nth(1).waitFor();
  assert.equal(await page.getByRole("link", { name: /View request and timeline/ }).count(), 3);
  assert.ok(requestedCursors.includes("page-two"));

  // Successful account replacement must refetch ownership and never restore
  // account A's vehicle labels from a stale React closure.
  const beforeAccountSwitchLoads = vehicleLoads;
  mode = "accountB";
  const accountBJobs = page.waitForResponse(response => response.url().includes("/api/v1/care/requests?") && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await accountBJobs;
  await page.getByRole("heading", { name: "PRIVATE_B Car B · B456" }).waitFor();
  assert.equal(await page.getByText("Toyota Corolla · SKY123").count(), 0);
  assert.equal(await page.getByRole("option", { name: /Toyota/ }).count(), 0);
  assert.equal(await page.getByRole("option", { name: /PRIVATE_B/ }).count(), 1);
  assert.ok(vehicleLoads >= beforeAccountSwitchLoads + 2, "account replacement must reread active and archived vehicles");

  const beforePageShowLoads = vehicleLoads;
  const pageShowJobs = page.waitForResponse(response => response.url().includes("/api/v1/care/requests?") && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await pageShowJobs;
  assert.ok(vehicleLoads >= beforePageShowLoads + 2, "pageshow revalidation must reread vehicle ownership");
  assert.equal(await page.getByText("Toyota Corolla · SKY123").count(), 0);

  // Restore the first synthetic account for the remaining archived/stale cases.
  mode = "ready";
  const accountARestore = page.waitForResponse(response => response.url().includes("/api/v1/care/requests?") && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await accountARestore;
  await page.getByRole("heading", { name: "Toyota Corolla · SKY123" }).first().waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByLabel("Vehicle").selectOption(archivedVehicle.id);
  await page.getByText("Showing saved history for archived vehicle").waitFor();
  await page.getByText("Archived vehicle history").waitFor();
  await page.screenshot({ path: new URL("mobile-archived-filter.png", evidence).pathname, fullPage: true });
  mode = "offline";
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("alert").filter({ hasText: "Last checked information" }).waitFor();
  assert.equal(await page.getByRole("link", { name: /View request and timeline/ }).count(), 1);
  await page.screenshot({ path: new URL("mobile-stale-retry.png", evidence).pathname, fullPage: true });
  mode = "session";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("heading", { name: "Sign in to see My Jobs" }).waitFor();
  assert.equal(await page.getByRole("link", { name: /View request and timeline/ }).count(), 0);
  assert.equal(await page.getByRole("option", { name: /Mazda/ }).count(), 0);
  await page.screenshot({ path: new URL("mobile-session-required.png", evidence).pathname, fullPage: true });
  mode = "empty";
  await page.getByRole("button", { name: "I’m signed in — try again" }).click();
  await page.getByRole("heading", { name: "No requests yet" }).waitFor();
  mode = "access";
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("heading", { name: "These requests are unavailable" }).waitFor();
  assert.equal(await page.getByRole("link", { name: /View request and timeline/ }).count(), 0);
  console.log("PASS: loading, owner list, A→B focus/pageshow vehicle revalidation, prior-account label redaction, archived history, pagination, stale retry, session redaction, empty and access-denied states");
} finally {
  if (browser) await browser.close();
  server.kill();
}
