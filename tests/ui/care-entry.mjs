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
  console.log("Starting Care entry browser", output);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process", "--use-gl=angle", "--use-angle=swiftshader"], timeout: 15000 });
  const evidence = new URL("../../docs/qa/care-entry/", import.meta.url);
  await mkdir(evidence, { recursive: true });
  const vehicle = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", make: "Toyota", model: "Corolla", variant: "Ascent Sport", year: 2020, registration: "SKY123", registration_state: "SA", revision: 1, archived_at: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
  const otherVehicle = { ...vehicle, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", make: "Mazda", model: "CX-5", registration: "NEW456" };
  const requestId = "11111111-1111-4111-8111-111111111111";
  const received = { id: requestId, vehicle_id: vehicle.id, service: "repair", description: "Scratch on the left rear door", preferred_window: "flexible", quote_state: "in_review", assignment_state: "none", fulfilment_state: null, money_state: null, customer_stage: "request_received", next_action: "review_request", responsible_role: "operations", created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", next_update_at: "2026-09-20T13:00:00Z", events: [{ id: "22222222-2222-4222-8222-222222222222", sequence: 1, type: "request_received", occurred_at: "2026-09-20T12:00:00Z" }] };
  let vehicleMode = "ready";
  let vehicleLoads = 0;
  let deferredVehicleLoadStarted;
  let attempts = 0;
  const keys = [];
  const bodies = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/api/v1/garage/vehicles?*", async route => {
    vehicleLoads++;
    let mode = vehicleMode;
    if (mode.startsWith("deferred-")) {
      mode = mode.slice("deferred-".length);
      let release;
      const released = new Promise(resolve => { release = resolve; });
      deferredVehicleLoadStarted?.({ release });
      await released;
    }
    try {
      if (mode === "session") return await route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED", message: "Sign in." } } });
      if (mode === "error") return await route.fulfill({ status: 503, json: { error: { code: "TEMPORARILY_UNAVAILABLE", message: "Try again.", retryable: true } } });
      if (mode === "empty") return await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
      if (mode === "other") return await route.fulfill({ json: { data: { items: [otherVehicle], nextCursor: null } } });
      return await route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } });
    } catch {
      // A superseded validation request is deliberately aborted by the client.
    }
  });
  let submissionMode = "malformed503-then-success";
  let releaseDeferredSubmission;
  let deferredSubmissionStarted;
  await context.route("**/api/v1/care/requests", async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    bodies.push(route.request().postData());
    if (submissionMode === "malformed400") return route.fulfill({ status: 400, contentType: "text/plain", body: "not-json" });
    if (submissionMode === "malformed503") return route.fulfill({ status: 503, contentType: "text/plain", body: "not-json" });
    if (submissionMode === "malformed503-then-success" && attempts === 1) return route.fulfill({ status: 503, contentType: "text/plain", body: "not-json" });
    if (submissionMode === "deferred-success") {
      deferredSubmissionStarted?.();
      await new Promise(resolve => { releaseDeferredSubmission = resolve; });
    }
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
  const uncertainVehicleLoads = vehicleLoads;
  const uncertainRefresh = page.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await uncertainRefresh;
  assert.equal(vehicleLoads, uncertainVehicleLoads + 1);
  assert.equal(await page.getByLabel("Active Garage vehicle").inputValue(), vehicle.id);
  assert.equal(await page.getByLabel("Describe the damage or cleaning work").inputValue(), received.description);
  await page.screenshot({ path: new URL("mobile-uncertain-retry.png", evidence).pathname, fullPage: true });
  await page.getByRole("button", { name: "Check same request" }).click();
  await page.waitForURL(`${origin}/care/requests/${requestId}`);
  await page.getByText(received.description).waitFor();
  assert.equal(page.url(), `${origin}/care/requests/${requestId}`);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(JSON.parse(bodies[0]), { vehicle_id: vehicle.id, service: "repair", description: received.description, preferred_window: "flexible" });

  submissionMode = "malformed400";
  const validationPage = await context.newPage();
  await validationPage.goto(`${origin}/care/request`);
  await validationPage.getByLabel("Describe the damage or cleaning work").fill("Initial invalid response attempt");
  const validationStart = keys.length;
  await validationPage.getByRole("button", { name: "Submit for review" }).click();
  await validationPage.getByText("We could not confirm whether your request was saved.").waitFor();
  assert.equal(await validationPage.getByLabel("Describe the damage or cleaning work").isEnabled(), true);
  assert.equal(await validationPage.getByRole("button", { name: "Submit for review" }).isEnabled(), true);
  await validationPage.getByLabel("Describe the damage or cleaning work").fill("Corrected after definitive malformed response");
  submissionMode = "success";
  await validationPage.getByRole("button", { name: "Submit for review" }).click();
  await validationPage.waitForURL(`${origin}/care/requests/${requestId}`);
  assert.notEqual(keys[validationStart], keys[validationStart + 1]);
  assert.notEqual(bodies[validationStart], bodies[validationStart + 1]);

  const focusPage = await context.newPage();
  await focusPage.goto(`${origin}/care/request`);
  await focusPage.getByLabel("Detail or clean my car").check();
  await focusPage.getByLabel("Active Garage vehicle").selectOption(vehicle.id);
  await focusPage.getByLabel("Describe the damage or cleaning work").fill("Keep this same-account draft after focus");
  await focusPage.getByLabel("When would you prefer the work?").selectOption("seven_to_fourteen_days");
  const sameAccountRefresh = focusPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await focusPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sameAccountRefresh;
  await focusPage.getByLabel("Active Garage vehicle").waitFor();
  assert.equal(await focusPage.getByLabel("Active Garage vehicle").inputValue(), vehicle.id);
  assert.equal(await focusPage.getByLabel("Detail or clean my car").isChecked(), true);
  assert.equal(await focusPage.getByLabel("Describe the damage or cleaning work").inputValue(), "Keep this same-account draft after focus");
  assert.equal(await focusPage.getByLabel("When would you prefer the work?").inputValue(), "seven_to_fourteen_days");

  vehicleMode = "other";
  const changedAccountRefresh = focusPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await focusPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await changedAccountRefresh;
  await focusPage.getByLabel("Active Garage vehicle").waitFor();
  assert.equal(await focusPage.getByLabel("Active Garage vehicle").inputValue(), otherVehicle.id);
  assert.equal(await focusPage.getByLabel("Describe the damage or cleaning work").inputValue(), "");
  assert.equal(await focusPage.getByLabel("Fix scratches or dents").isChecked(), true);
  assert.equal(await focusPage.getByLabel("When would you prefer the work?").inputValue(), "flexible");

  vehicleMode = "ready";
  submissionMode = "deferred-success";
  const inFlightPage = await context.newPage();
  await inFlightPage.goto(`${origin}/care/request`);
  await inFlightPage.getByLabel("Describe the damage or cleaning work").fill("Keep one request while focus changes");
  const inFlightStart = keys.length;
  const started = new Promise(resolve => { deferredSubmissionStarted = resolve; });
  const submitClick = inFlightPage.getByRole("button", { name: "Submit for review" }).click();
  await started;
  const inFlightVehicleLoads = vehicleLoads;
  const inFlightRefresh = inFlightPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await inFlightPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await inFlightRefresh;
  assert.equal(vehicleLoads, inFlightVehicleLoads + 1);
  assert.equal(await inFlightPage.getByLabel("Describe the damage or cleaning work").inputValue(), "Keep one request while focus changes");
  assert.equal(keys.length, inFlightStart + 1);
  assert.equal(await inFlightPage.getByRole("button", { name: "Submitting…" }).isDisabled(), true);
  releaseDeferredSubmission();
  await submitClick;
  await inFlightPage.waitForURL(`${origin}/care/requests/${requestId}`);
  assert.equal(keys.length, inFlightStart + 1);
  assert.equal(bodies.length, inFlightStart + 1);

  // A POST completing first must wait for the latest same-account validation.
  // Superseding an earlier validation cannot make the POST navigate early.
  vehicleMode = "ready";
  submissionMode = "deferred-success";
  const samePostFirstPage = await context.newPage();
  await samePostFirstPage.goto(`${origin}/care/request`);
  await samePostFirstPage.getByLabel("Describe the damage or cleaning work").fill("Keep the original command through validation replacement");
  const samePostFirstStart = keys.length;
  const samePostStarted = new Promise(resolve => { deferredSubmissionStarted = resolve; });
  const samePostResponse = samePostFirstPage.waitForResponse(response => response.url().endsWith("/api/v1/care/requests") && response.request().method() === "POST");
  await samePostFirstPage.getByRole("button", { name: "Submit for review" }).click();
  await samePostStarted;
  vehicleMode = "deferred-ready";
  const firstValidationStarted = new Promise(resolve => { deferredVehicleLoadStarted = resolve; });
  await samePostFirstPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  const firstValidation = await firstValidationStarted;
  const latestValidationStarted = new Promise(resolve => { deferredVehicleLoadStarted = resolve; });
  await samePostFirstPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  const latestValidation = await latestValidationStarted;
  releaseDeferredSubmission();
  await samePostResponse;
  await samePostFirstPage.waitForTimeout(100);
  assert.equal(samePostFirstPage.url(), `${origin}/care/request`);
  assert.equal(keys.length, samePostFirstStart + 1);
  firstValidation.release();
  await samePostFirstPage.waitForTimeout(50);
  assert.equal(samePostFirstPage.url(), `${origin}/care/request`);
  const latestValidationResponse = samePostFirstPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  latestValidation.release();
  await latestValidationResponse;
  await samePostFirstPage.waitForURL(`${origin}/care/requests/${requestId}`);
  assert.equal(keys.length, samePostFirstStart + 1);
  assert.equal(bodies.length, samePostFirstStart + 1);

  // An account change during an in-flight POST must clear prior-account UI and
  // make the old success incapable of navigating even when POST finishes first.
  vehicleMode = "ready";
  submissionMode = "deferred-success";
  const switchedInFlightPage = await context.newPage();
  await switchedInFlightPage.goto(`${origin}/care/request`);
  await switchedInFlightPage.getByLabel("Describe the damage or cleaning work").fill("Private in-flight request from the first account");
  const switchedStarted = new Promise(resolve => { deferredSubmissionStarted = resolve; });
  const switchedPostResponse = switchedInFlightPage.waitForResponse(response => response.url().endsWith("/api/v1/care/requests") && response.request().method() === "POST");
  await switchedInFlightPage.getByRole("button", { name: "Submit for review" }).click();
  await switchedStarted;
  vehicleMode = "deferred-other";
  const switchedValidationStarted = new Promise(resolve => { deferredVehicleLoadStarted = resolve; });
  const switchedRefresh = switchedInFlightPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await switchedInFlightPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  const switchedValidation = await switchedValidationStarted;
  releaseDeferredSubmission();
  await switchedPostResponse;
  await switchedInFlightPage.waitForTimeout(100);
  assert.equal(switchedInFlightPage.url(), `${origin}/care/request`);
  switchedValidation.release();
  await switchedRefresh;
  await switchedInFlightPage.getByLabel("Active Garage vehicle").waitFor();
  assert.equal(await switchedInFlightPage.getByLabel("Active Garage vehicle").inputValue(), otherVehicle.id);
  assert.equal(await switchedInFlightPage.getByText("Private in-flight request from the first account").count(), 0);
  assert.equal(await switchedInFlightPage.getByLabel("Describe the damage or cleaning work").isEnabled(), true);
  assert.equal(await switchedInFlightPage.getByRole("button", { name: "Submit for review" }).isEnabled(), true);
  await switchedInFlightPage.waitForTimeout(100);
  assert.equal(switchedInFlightPage.url(), `${origin}/care/request`);
  assert.equal(await switchedInFlightPage.getByText(received.description).count(), 0);

  // A failed validation also fences a completed POST. Reloading the same owner
  // exposes only a safe replay of the original key/body.
  vehicleMode = "ready";
  submissionMode = "deferred-success";
  const failedValidationPage = await context.newPage();
  await failedValidationPage.goto(`${origin}/care/request`);
  await failedValidationPage.getByLabel("Describe the damage or cleaning work").fill("Retain this exact request after validation failure");
  const failedValidationStart = keys.length;
  const failedPostStarted = new Promise(resolve => { deferredSubmissionStarted = resolve; });
  const failedPostResponse = failedValidationPage.waitForResponse(response => response.url().endsWith("/api/v1/care/requests") && response.request().method() === "POST");
  await failedValidationPage.getByRole("button", { name: "Submit for review" }).click();
  await failedPostStarted;
  vehicleMode = "deferred-error";
  const failedGetStarted = new Promise(resolve => { deferredVehicleLoadStarted = resolve; });
  const failedGetResponse = failedValidationPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await failedValidationPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  const failedValidation = await failedGetStarted;
  releaseDeferredSubmission();
  await failedPostResponse;
  await failedValidationPage.waitForTimeout(100);
  assert.equal(failedValidationPage.url(), `${origin}/care/request`);
  failedValidation.release();
  await failedGetResponse;
  await failedValidationPage.getByRole("heading", { name: "We couldn’t load your vehicles" }).waitFor();
  assert.equal(failedValidationPage.url(), `${origin}/care/request`);
  vehicleMode = "ready";
  await failedValidationPage.getByRole("button", { name: "Try again" }).click();
  await failedValidationPage.getByRole("button", { name: "Check same request" }).waitFor();
  assert.equal(await failedValidationPage.getByLabel("Describe the damage or cleaning work").inputValue(), "Retain this exact request after validation failure");
  submissionMode = "success";
  await failedValidationPage.getByRole("button", { name: "Check same request" }).click();
  await failedValidationPage.waitForURL(`${origin}/care/requests/${requestId}`);
  assert.equal(keys.length, failedValidationStart + 2);
  assert.equal(keys[failedValidationStart], keys[failedValidationStart + 1]);
  assert.equal(bodies[failedValidationStart], bodies[failedValidationStart + 1]);

  // An uncertain command retains its exact key/body for the same account, but
  // sign-out/access loss must redact it instead of suppressing revalidation.
  vehicleMode = "ready";
  submissionMode = "malformed503";
  const uncertainSessionPage = await context.newPage();
  await uncertainSessionPage.goto(`${origin}/care/request`);
  await uncertainSessionPage.getByLabel("Describe the damage or cleaning work").fill("Private uncertain request from the first account");
  await uncertainSessionPage.getByRole("button", { name: "Submit for review" }).click();
  await uncertainSessionPage.getByRole("button", { name: "Check same request" }).waitFor();
  vehicleMode = "session";
  const uncertainSessionRefresh = uncertainSessionPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await uncertainSessionPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await uncertainSessionRefresh;
  await uncertainSessionPage.getByRole("heading", { name: "Sign in to request care" }).waitFor();
  assert.equal(await uncertainSessionPage.getByText("Private uncertain request from the first account").count(), 0);

  // A different authenticated account must also clear an uncertain command.
  // It cannot inherit the previous account's request body or retry control.
  vehicleMode = "ready";
  submissionMode = "malformed503";
  const uncertainAccountPage = await context.newPage();
  await uncertainAccountPage.goto(`${origin}/care/request`);
  await uncertainAccountPage.getByLabel("Describe the damage or cleaning work").fill("Private uncertain request before account switch");
  await uncertainAccountPage.getByRole("button", { name: "Submit for review" }).click();
  await uncertainAccountPage.getByRole("button", { name: "Check same request" }).waitFor();
  vehicleMode = "other";
  const uncertainAccountRefresh = uncertainAccountPage.waitForResponse(response => response.url().includes("/api/v1/garage/vehicles?") && response.request().method() === "GET");
  await uncertainAccountPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await uncertainAccountRefresh;
  await uncertainAccountPage.getByLabel("Active Garage vehicle").waitFor();
  assert.equal(await uncertainAccountPage.getByLabel("Active Garage vehicle").inputValue(), otherVehicle.id);
  assert.equal(await uncertainAccountPage.getByText("Private uncertain request before account switch").count(), 0);
  assert.equal(await uncertainAccountPage.getByRole("button", { name: "Check same request" }).count(), 0);
  assert.equal(await uncertainAccountPage.getByText("Submission not confirmed").count(), 0);
  assert.equal(await uncertainAccountPage.getByLabel("Describe the damage or cleaning work").inputValue(), "");
  assert.equal(await uncertainAccountPage.getByRole("button", { name: "Submit for review" }).isEnabled(), true);

  vehicleMode = "ready";
  const sessionPage = await context.newPage();
  await sessionPage.setViewportSize({ width: 390, height: 844 });
  await sessionPage.goto(`${origin}/care/request`);
  await sessionPage.getByLabel("Detail or clean my car").check();
  await sessionPage.getByLabel("Describe the damage or cleaning work").fill("Private draft from the first account");
  await sessionPage.getByLabel("When would you prefer the work?").selectOption("seven_to_fourteen_days");
  vehicleMode = "session";
  await sessionPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sessionPage.getByRole("heading", { name: "Sign in to request care" }).waitFor();
  assert.equal(await sessionPage.getByLabel("Active Garage vehicle").count(), 0);
  assert.equal(await sessionPage.getByText("Private draft from the first account").count(), 0);
  await sessionPage.screenshot({ path: new URL("mobile-session-required.png", evidence).pathname, fullPage: true });
  vehicleMode = "other";
  await sessionPage.getByRole("button", { name: "I’m signed in — try again" }).click();
  await sessionPage.getByLabel("Active Garage vehicle").waitFor();
  assert.equal(await sessionPage.getByLabel("Active Garage vehicle").inputValue(), otherVehicle.id);
  assert.equal(await sessionPage.getByLabel("Active Garage vehicle").locator(`option[value="${vehicle.id}"]`).count(), 0);
  assert.equal(await sessionPage.getByLabel("Describe the damage or cleaning work").inputValue(), "");
  assert.equal(await sessionPage.getByLabel("Fix scratches or dents").isChecked(), true);
  assert.equal(await sessionPage.getByLabel("When would you prefer the work?").inputValue(), "flexible");

  vehicleMode = "empty";
  const emptyPage = await context.newPage();
  await emptyPage.goto(`${origin}/care/request`);
  await emptyPage.getByRole("heading", { name: "Add a vehicle first" }).waitFor();
  assert.equal(await emptyPage.getByRole("link", { name: "Add a vehicle in Garage" }).getAttribute("href"), "/garage");
  console.log("PASS: service entry contract, GET/POST ordering fences, same-account pending preservation, pending-session revalidation, in-flight account-change isolation, validation-failure replay, malformed response recovery, account-switch draft redaction, receipt navigation and empty Garage");
} finally {
  if (browser) await browser.close();
  server.kill();
}
