// Synthetic intercepted API fixtures: not live authentication, storage or database verification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium ?? playwright.default?.chromium;
const port = 3197;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "-p", String(port)], { stdio: "ignore" });
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAFoAoADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDx+iiiuk5QooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACu60bRNI1K40mKKzhuImns0uyJ5EnjLyIkgkQnBQliFZOmUyck1wta8PifV4Ps5iulV7cxFJBDHvPlkFAzbcsFKrgMSPlHHApMaNdNCsk1e38OSQob26gAivvNJRp5NrR7cHaY/wCDOD99m7ABb630Kyl02O30tr2C+U/vVeTzSqu0OY1DY3sUL4YEfOowAOefh1nUIH0947jD6dJ5lqxRSYzu3dSORu5wcjJPHJp1pruo2NqLa3nVY1ZmQtEjNGSMEoxBZCcD7pHSizHdGtbaDby+C5rxki+3ndcxMbgBzEjKhAj3ZIOZGLYOPL69aueMdFsdNGoC3sLW1MOqPbW32W5abfEu/PmZdtrDEeAdpOW4445hdVvUljlWbDxwNbJ8i4EbKVK4xjkM3vznrS3WrX16bs3E+83dz9qmOxRul+b5uBx99uBgc+wosxXRv6vbaVZ2/wBt0/TbO7skn8pZDPMDgqSFnTcGWT5ScrhThsZxWmmhaTd+L9bs2sLO0sLK5exiJu2jAdpSiuWkk+ZlRXbAPJXoa5C/1zUNTjMd3Mrgv5jlYkQyPgjc5UAu3J5bJ5PqaZeate35uDczbzcXDXUpCKu6Vs5bge546DJxSsx3R0UuiW9sZ9LbS1luYdN+1y3H2jZMrmLzflRnCsqjhgFLcMc9BVyLw7pM9pe2/wBn2Xc0WmR2cvmNhJprRpWyM4O91C89N3GAK5+TxdrcxmaS7RnmSWN5Dbx7ykm7eu7bnadzcZwCcjBqlNrF/cQtDJcEoxgJAUD/AFMZji5Az8qkj36nJoswujp7zR9P0tbKX+zYbl7sW8flXNw0SRn7LBLIS25cMzSnGTgYPHTFTTtHt11fxJbSWMUjafE/kw39wIgjC5ij+d1dRkKzD72CemeKz5vFmtXN3cXU92ks1wUaQyW8bDci7VZQVwrBRjcMH3qlLq99PcajPJPul1HP2ptijzMyLIe3Hzqp4x0x0p2YXR0WreH7KbTILnSDZoTdyxSs98iLlYbdiiGRxuVXeUAjORjJPFS+ILDR/D2stajSVu4p7u4xumkBiiS4kiVEw33gI85bd1HHryTXc72MVkz5t4pHlRMDhnChjnryEX8vrWiPFOsCeac3Mbyyzvcl5LeNykrHLOhKnYSeflx0HpRZhdHQ2mjab517pcmn2ck0GtW+lreM8wJWQzAuQJAuf3akcY68VjSR6dqWnaq9tpi2L2CrLGyyOxdTIsZV9zEbvnByoX7p49Mdb+6S1ltlmYRSzJO47l0DBWz143t+f0q1fa9qOowNDczRlHcSSeXAkZlYZwzlVBc8nls9T60WFc6LRbbSb+Pw2k2iWe6/1c2U7rLOCY1+z9P3mAT5rZOPTGKpwW2nnUXS/s9KtcW5MIhupJoGk3KB5rJI7KMbsYI5254rEtdXvrL7F9nn2fYrk3Vv8inZKdmW5HP+rTg5HHuanXxBqCTGRPskZZDG6JZQqjqSDhkCbW5APIOCOKLDujcFtYWra9HcaBaF7O0juYQ9xK4y8sK8MkgDIVlJU9cEZJrkGIZiQoUE52joPzq5Jq19LJeO8+WvIlhn+RQGRWVlUDHygGNMYxgLjpxVKhCYUUUUxBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//2Q==', 'base64');
const vehicle = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", make: "Toyota", model: "Corolla", variant: "Ascent Sport", year: 2020, registration: "SKY123", registration_state: "SA", revision: 1, archived_at: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
const requestId = "11111111-1111-4111-8111-111111111111";
const received = { id: requestId, vehicle_id: vehicle.id, service: "repair", description: "Scratch on the left rear door", preferred_window: "flexible", quote_state: "in_review", assignment_state: "none", fulfilment_state: null, money_state: null, customer_stage: "request_received", next_action: "review_request", responsible_role: "operations", created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", next_update_at: "2026-09-20T13:00:00Z", events: [{ id: "22222222-2222-4222-8222-222222222222", sequence: 1, type: "request_received", occurred_at: "2026-09-20T12:00:00Z" }] };
let browser;
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, "test server must start");
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  async function scenario(photoMode, run) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const creates = [];
    const uploads = [];
    await context.route("**/api/v1/garage/vehicles?*", route => route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } }));
    await context.route("**/api/v1/care/requests", route => {
      if (route.request().method() !== "POST") return route.continue();
      creates.push(route.request().headers()["idempotency-key"]);
      return route.fulfill({ status: 201, json: { data: { request: received, replayed: false } } });
    });
    await context.route(`**/api/v1/care/requests/${requestId}`, route => route.fulfill({ json: { data: received } }));
    await context.route(`**/api/v1/care/journey/${requestId}/photos`, async route => {
      const request = route.request();
      const form = await new Response(request.postDataBuffer(), { headers: { "content-type": request.headers()["content-type"] } }).formData();
      const files = form.getAll("photos");
      uploads.push(await Promise.all(files.map(async file => ({ type: file.type, size: file.size, hash: createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex") }))));
      const outcome = photoMode(uploads.length);
      if (outcome === "abort") return route.abort("failed");
      if (outcome === "limited") return route.fulfill({ status: 429, headers: { "Retry-After": "3" }, json: { error: { code: "RATE_LIMITED", message: "Too many photo uploads. Wait a little, then retry the same photos.", retryable: true } } });
      if (outcome === "limited-no-header") return route.fulfill({ status: 429, json: { error: { code: "RATE_LIMITED", message: "Too many photo uploads. Wait a little, then retry the same photos.", retryable: true } } });
      if (outcome === "invalid") return route.fulfill({ status: 400, json: { error: { code: "VALIDATION_FAILED", message: "Check the details, price and appointment times.", retryable: false } } });
      if (outcome === "toolarge") return route.fulfill({ status: 413, json: { error: { code: "PAYLOAD_TOO_LARGE", message: "Choose up to three smaller photos.", retryable: false } } });
      if (outcome === "conflict") return route.fulfill({ status: 409, json: { error: { code: "INVALID_TRANSITION", message: "Photos can no longer be added to this request." } } });
      return route.fulfill({ status: 201, json: { data: { stored: files.length } } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${origin}/care/request/garage`);
    await page.getByLabel("Active Garage vehicle").selectOption(vehicle.id);
    await page.getByLabel("Describe the damage or cleaning work").fill(received.description);
    await run({ page, creates, uploads });
    assert.deepEqual(pageErrors, []);
    await context.close();
  }
  const submit = page => page.getByRole("button", { name: "Submit for review" }).click();

  // 1. No photos: create only, the photo route is never called.
  await scenario(() => "ok", async ({ page, creates, uploads }) => {
    assert.equal(await page.getByRole("group", { name: /5\. Add photos/ }).count(), 1);
    await submit(page);
    await page.waitForURL(`${origin}/care/requests/${requestId}`);
    assert.equal(creates.length, 1); assert.equal(uploads.length, 0);
  });

  // 2. A JPEG plus a HEIC-labelled file are re-encoded to JPEG; an unconfirmed upload retries the same bytes without a second create.
  await scenario(n => (n === 1 ? "abort" : "ok"), async ({ page, creates, uploads }) => {
    const input = page.getByLabel("Add damage photos");
    assert.match(await input.getAttribute("accept"), /image\/jpeg/);
    await input.setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
    await input.setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: jpeg });
    await page.getByRole("button", { name: "Remove photo 2" }).waitFor();
    await submit(page);
    await page.getByRole("button", { name: "Retry photo upload" }).waitFor();
    await page.getByText("Photo upload not confirmed").waitFor();
    assert.equal(await page.getByLabel("Describe the damage or cleaning work").isDisabled(), true);
    assert.equal(await input.isDisabled(), true);
    await page.getByRole("button", { name: "Retry photo upload" }).click();
    await page.waitForURL(`${origin}/care/requests/${requestId}`);
    assert.equal(creates.length, 1);
    assert.equal(uploads.length, 2);
    assert.deepEqual(uploads[0], uploads[1]);
    assert.equal(uploads[1].length, 2);
    for (const file of uploads[1]) { assert.equal(file.type, "image/jpeg"); assert.ok(file.size >= 128 && file.size <= 900000); }
  });

  // 3. A refused upload keeps the saved request, offers a link, and does not allow a duplicate create.
  await scenario(() => "conflict", async ({ page, creates, uploads }) => {
    await page.getByLabel("Add damage photos").setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
    await submit(page);
    await page.getByText("Request saved without photos").waitFor();
    assert.equal(await page.getByRole("button", { name: "Submit for review" }).isDisabled(), true);
    const link = page.getByRole("link", { name: "Continue without photos" });
    assert.equal(await link.getAttribute("href"), `/care/requests/${requestId}`);
    assert.ok((await link.boundingBox()).height >= 44, "continue link is a 44px target");
    // Photos are write-once on the server after a conflict, so no "different photos" offer here.
    assert.equal(await page.getByRole("button", { name: "Choose different photos" }).count(), 0);
    assert.equal(creates.length, 1); assert.equal(uploads.length, 1);
    await link.click();
    await page.waitForURL(`${origin}/care/requests/${requestId}`);
  });

  // 3b. A refused upload (400 / 413) stored nothing: continue without photos, or choose different photos for the SAME saved request.
  for (const [mode, label] of [["invalid", "400"], ["toolarge", "413"]]) {
    await scenario(n => (n === 1 ? mode : n === 2 ? mode : "ok"), async ({ page, creates, uploads }) => {
      const input = page.getByLabel("Add damage photos");
      await input.setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
      await input.setInputFiles({ name: "side.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await page.getByRole("button", { name: "Remove photo 2" }).waitFor();
      await submit(page);
      await page.getByText("Photos not accepted").waitFor();
      await page.setViewportSize({ width: 320, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label + ": no horizontal scroll at 320 with recovery actions");
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.getByRole("button", { name: "Submit for review" }).isDisabled(), true, label + ": no way to create a second request");
      const cont = page.getByRole("link", { name: "Continue without photos" });
      const choose = page.getByRole("button", { name: "Choose different photos" });
      assert.ok((await cont.boundingBox()).height >= 44 && (await cont.boundingBox()).width >= 44);
      assert.ok((await choose.boundingBox()).height >= 44 && (await choose.boundingBox()).width >= 44);
      assert.equal(await page.getByLabel("Describe the damage or cleaning work").isDisabled(), true);
      assert.equal(await input.isDisabled(), true);
      await choose.click();
      // Only the photo picker opens; the saved request details stay locked and nothing is uploaded until photos are chosen.
      assert.equal(await input.isDisabled(), false);
      assert.equal(await page.getByLabel("Describe the damage or cleaning work").isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Remove photo 1" }).count(), 0, "old photos are cleared");
      const upload = page.getByRole("button", { name: "Upload these photos" });
      assert.equal(await upload.isDisabled(), true);
      assert.ok((await upload.boundingBox()).height >= 44);
      await input.setInputFiles({ name: "smaller.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
      await upload.click();
      // A second refusal keeps the same way forward.
      await page.getByText("Photos not accepted").waitFor();
      assert.equal(await page.getByRole("button", { name: "Choose different photos" }).count(), 1);
      await page.getByRole("button", { name: "Choose different photos" }).click();
      await input.setInputFiles({ name: "third.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
      await page.getByRole("button", { name: "Upload these photos" }).click();
      await page.waitForURL(`${origin}/care/requests/${requestId}`);
      assert.equal(creates.length, 1, label + ": still exactly one create (no duplicate request)");
      assert.deepEqual(uploads.map(batch => batch.length), [2, 1, 1]);
    });
  }

  // 3c. After a refused upload the user can also just continue without photos.
  await scenario(() => "invalid", async ({ page, creates }) => {
    await page.getByLabel("Add damage photos").setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
    await submit(page);
    await page.getByText("Photos not accepted").waitFor();
    await page.getByRole("link", { name: "Continue without photos" }).click();
    await page.waitForURL(`${origin}/care/requests/${requestId}`);
    assert.equal(creates.length, 1);
  });

  // 4. A HEIC file this browser cannot decode is refused with a specific message and nothing is attached.
  await scenario(() => "ok", async ({ page, uploads }) => {
    await page.getByLabel("Add damage photos").setInputFiles({ name: "IMG_0002.heic", mimeType: "image/heic", buffer: Buffer.from("not a decodable image".repeat(20)) });
    await page.getByText(/cannot open HEIC photos/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Remove photo 1" }).count(), 0);
    await submit(page);
    await page.waitForURL(`${origin}/care/requests/${requestId}`);
    assert.equal(uploads.length, 0);
  });

  // 5. 429: server message, disabled retry with a countdown, then the same files are retried without a second create.
  await scenario(n => (n === 1 ? "limited" : "ok"), async ({ page, creates, uploads }) => {
    await page.getByLabel("Add damage photos").setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
    await submit(page);
    await page.getByText("Photo upload limit reached").waitFor();
    await page.getByText("Too many photo uploads. Wait a little, then retry the same photos.").waitFor();
    const retry = page.getByRole("button", { name: /^Retry in \d+:\d\d$/ });
    await retry.waitFor();
    assert.equal(await retry.isDisabled(), true);
    assert.equal((await retry.boundingBox()).height >= 44, true);
    assert.equal(await page.getByRole("link", { name: "Continue without photos" }).count(), 1);
    await page.getByRole("button", { name: "Retry photo upload" }).waitFor({ timeout: 8000 });
    assert.equal(uploads.length, 1, "no upload while the countdown runs");
    await page.getByRole("button", { name: "Retry photo upload" }).click();
    await page.waitForURL(`${origin}/care/requests/${requestId}`);
    assert.equal(creates.length, 1); assert.equal(uploads.length, 2);
    assert.deepEqual(uploads[0], uploads[1]);
  });

  // 5b. 429 without Retry-After: message shown, retry stays available (the server decides).
  await scenario(n => (n === 1 ? "limited-no-header" : "ok"), async ({ page, creates, uploads }) => {
    await page.getByLabel("Add damage photos").setInputFiles({ name: "front.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByRole("button", { name: "Remove photo 1" }).waitFor();
    await submit(page);
    await page.getByText("Photo upload limit reached").waitFor();
    const retry = page.getByRole("button", { name: "Retry photo upload" });
    assert.equal(await retry.isDisabled(), false);
    await retry.click();
    await page.waitForURL(`${origin}/care/requests/${requestId}`);
    assert.equal(creates.length, 1); assert.deepEqual(uploads[0], uploads[1]);
  });

  // 6. Responsive widths.
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.route("**/api/v1/garage/vehicles?*", route => route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } }));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/care/request/garage`);
    await page.getByLabel("Add damage photos").waitFor({ state: "attached" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal scroll at ${width}`);
  }
  console.log("PASS: signed-in request photos: 0-3 picker, JPEG/HEIC prepare, exact-byte retry without second create, 429 countdown retry, saved-without-photos recovery (Continue without photos; Choose different photos for 400/413 on the same request), HEIC refusal, three widths");
} finally { if (browser) await browser.close(); server.kill("SIGTERM"); }
