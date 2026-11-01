// Synthetic intercepted API fixtures: not live authentication, storage or database verification.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium ?? playwright.default?.chromium;
const port = 3198;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "-p", String(port)], { stdio: "ignore" });
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAFoAoADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDx+iiiuk5QooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACu60bRNI1K40mKKzhuImns0uyJ5EnjLyIkgkQnBQliFZOmUyck1wta8PifV4Ps5iulV7cxFJBDHvPlkFAzbcsFKrgMSPlHHApMaNdNCsk1e38OSQob26gAivvNJRp5NrR7cHaY/wCDOD99m7ABb630Kyl02O30tr2C+U/vVeTzSqu0OY1DY3sUL4YEfOowAOefh1nUIH0947jD6dJ5lqxRSYzu3dSORu5wcjJPHJp1pruo2NqLa3nVY1ZmQtEjNGSMEoxBZCcD7pHSizHdGtbaDby+C5rxki+3ndcxMbgBzEjKhAj3ZIOZGLYOPL69aueMdFsdNGoC3sLW1MOqPbW32W5abfEu/PmZdtrDEeAdpOW4445hdVvUljlWbDxwNbJ8i4EbKVK4xjkM3vznrS3WrX16bs3E+83dz9qmOxRul+b5uBx99uBgc+wosxXRv6vbaVZ2/wBt0/TbO7skn8pZDPMDgqSFnTcGWT5ScrhThsZxWmmhaTd+L9bs2sLO0sLK5exiJu2jAdpSiuWkk+ZlRXbAPJXoa5C/1zUNTjMd3Mrgv5jlYkQyPgjc5UAu3J5bJ5PqaZeate35uDczbzcXDXUpCKu6Vs5bge546DJxSsx3R0UuiW9sZ9LbS1luYdN+1y3H2jZMrmLzflRnCsqjhgFLcMc9BVyLw7pM9pe2/wBn2Xc0WmR2cvmNhJprRpWyM4O91C89N3GAK5+TxdrcxmaS7RnmSWN5Dbx7ykm7eu7bnadzcZwCcjBqlNrF/cQtDJcEoxgJAUD/AFMZji5Az8qkj36nJoswujp7zR9P0tbKX+zYbl7sW8flXNw0SRn7LBLIS25cMzSnGTgYPHTFTTtHt11fxJbSWMUjafE/kw39wIgjC5ij+d1dRkKzD72CemeKz5vFmtXN3cXU92ks1wUaQyW8bDci7VZQVwrBRjcMH3qlLq99PcajPJPul1HP2ptijzMyLIe3Hzqp4x0x0p2YXR0WreH7KbTILnSDZoTdyxSs98iLlYbdiiGRxuVXeUAjORjJPFS+ILDR/D2stajSVu4p7u4xumkBiiS4kiVEw33gI85bd1HHryTXc72MVkz5t4pHlRMDhnChjnryEX8vrWiPFOsCeac3Mbyyzvcl5LeNykrHLOhKnYSeflx0HpRZhdHQ2mjab517pcmn2ck0GtW+lreM8wJWQzAuQJAuf3akcY68VjSR6dqWnaq9tpi2L2CrLGyyOxdTIsZV9zEbvnByoX7p49Mdb+6S1ltlmYRSzJO47l0DBWz143t+f0q1fa9qOowNDczRlHcSSeXAkZlYZwzlVBc8nls9T60WFc6LRbbSb+Pw2k2iWe6/1c2U7rLOCY1+z9P3mAT5rZOPTGKpwW2nnUXS/s9KtcW5MIhupJoGk3KB5rJI7KMbsYI5254rEtdXvrL7F9nn2fYrk3Vv8inZKdmW5HP+rTg5HHuanXxBqCTGRPskZZDG6JZQqjqSDhkCbW5APIOCOKLDujcFtYWra9HcaBaF7O0juYQ9xK4y8sK8MkgDIVlJU9cEZJrkGIZiQoUE52joPzq5Jq19LJeO8+WvIlhn+RQGRWVlUDHygGNMYxgLjpxVKhCYUUUUxBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//2Q==', 'base64');
const requestId = "11111111-1111-4111-8111-111111111111";
const received = { id: requestId, vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", service: "repair", description: "Scratch on the left rear door", preferred_window: "flexible", quote_state: "in_review", assignment_state: "none", fulfilment_state: null, money_state: null, customer_stage: "request_received", next_action: "review_request", responsible_role: "operations", created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", next_update_at: "2026-09-20T13:00:00Z", events: [{ id: "22222222-2222-4222-8222-222222222222", sequence: 1, type: "request_received", occurred_at: "2026-09-20T12:00:00Z" }] };
const activeVehicle = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", make: "Toyota", model: "Corolla", variant: "Ascent Sport", year: 2020, registration: "SKY123", registration_state: "SA", revision: 1, archived_at: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
const base = { id: "11111111-1111-4111-8111-111111111111", vehicle_id: activeVehicle.id, vehicle_archived: false, service: "repair", quote_state: "in_review", assignment_state: "none", fulfilment_state: null, money_state: null, customer_stage: "request_received", next_action: "review_request", responsible_role: "operations", created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", next_update_at: "2026-09-20T13:00:00Z", is_overdue: true };
const account = "account-a";
let browser;
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, "test server must start");
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  // 1. My Jobs: photo hint from photo_count / has_photos; absent, zero and malformed values show nothing.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"];
    const items = [
      { ...base, id: ids[0], photo_count: 2, has_photos: true },
      { ...base, id: ids[1] },
      { ...base, id: ids[2], photo_count: 0, has_photos: false },
      { ...base, id: ids[3], photo_count: "many", has_photos: "yes" },
      { ...base, id: ids[4], photo_count: 1, has_photos: true },
    ];
    await context.route("**/api/v1/garage/vehicles?*", route => route.fulfill({ json: { data: { items: new URL(route.request().url()).searchParams.get("archived") === "true" ? [] : [activeVehicle], nextCursor: null } } }));
    await context.route("**/api/v1/care/requests?*", route => route.fulfill({ json: { data: { items, next_cursor: null, evaluated_at: new Date().toISOString() } } }));
    await page.goto(`${origin}/garage/jobs`);
    await page.getByRole("article").first().waitFor();
    const cards = page.getByRole("article");
    assert.equal(await cards.count(), 5);
    assert.equal(await cards.nth(0).getByText("2 photos sent").count(), 1);
    assert.equal(await cards.nth(4).getByText("1 photo sent").count(), 1);
    for (const index of [1, 2, 3]) assert.equal(await cards.nth(index).locator(".job-photos").count(), 0, `card ${index} has no hint`);
    assert.equal(await page.getByText(/no photos/i).count(), 0, "never claims there are no photos");
    assert.equal(await page.locator(".job-photos svg[aria-hidden='true']").count(), 2);
    assert.ok(await page.locator(".job-photos").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 14));
    for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await noOverflow(page), true, `jobs overflow at ${width}`); }
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 2. My Jobs request page: proxy-route thumbnails, 404 / 503 states, retry, never the signed-URL route.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const hits = { slot1: 0, slot2: 0, slot3: 0, journey: 0, signed: 0 };
    let journeyMode = "fail-once";
    await context.route(`**/api/v1/care/requests/${requestId}`, route => route.fulfill({ json: { data: received } }));
    await context.route(`**/api/v1/care/journey/${requestId}`, route => {
      hits.journey++;
      if (journeyMode === "fail-once" && hits.journey === 1) return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "x", retryable: true } } });
      return route.fulfill({ headers: { "X-Skycar-Account": account }, json: { data: { id: requestId, photos: [1, 2, 3] } } });
    });
    await context.route(`**/api/v1/care/journey/${requestId}/photos/*/url*`, route => { hits.signed++; return route.fulfill({ status: 500, body: "must not be called" }); });
    await context.route(new RegExp(`/api/v1/care/journey/${requestId}/photos/[123]$`), route => {
      const slot = route.request().url().slice(-1);
      hits[`slot${slot}`]++;
      if (slot === "2") return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "gone" } } });
      if (slot === "3" && hits.slot3 === 1) return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "x", retryable: true } } });
      return route.fulfill({ headers: { "X-Skycar-Account": account, "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" }, body: jpeg });
    });
    await page.goto(`${origin}/care/requests/${requestId}`);
    // Journey read fails once: a clear, retryable state, not a blank gap.
    await page.getByText("We could not check this request’s photos.").waitFor();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("heading", { name: "Photos you sent" }).waitFor();
    const first = page.getByAltText("Request photo 1");
    await first.waitFor();
    assert.equal(await first.evaluate(img => img.complete && img.naturalWidth > 0), true);
    await page.getByText("Request photo 2 is no longer available.").waitFor();
    await page.getByText("Request photo 3 could not be loaded.").waitFor();
    const box = await first.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `thumbnail ${box.width}x${box.height}`);
    const retry = page.locator("figure", { hasText: "photo 3 could not be loaded" }).getByRole("button", { name: "Try again" });
    assert.ok((await retry.boundingBox()).height >= 44);
    await retry.click();
    await page.getByAltText("Request photo 3").waitFor();
    assert.equal(hits.slot2, 1, "a 404 is not retried automatically");
    assert.equal(hits.signed, 0, "signed-URL route is not used");
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await noOverflow(page), true, `request page overflow at ${width}`);
      const widths = await page.locator(".journey-private-photos img").evaluateAll(list => list.map(img => [img.getBoundingClientRect().width, img.getBoundingClientRect().height]));
      for (const [w, h] of widths) assert.ok(w >= 44 && h >= 44, `thumb ${w}x${h} at ${width}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 3. No photos or no access to the journey read: the section is absent (no claim either way).
  for (const mode of ["empty", "denied"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    await context.route(`**/api/v1/care/requests/${requestId}`, route => route.fulfill({ json: { data: received } }));
    await context.route(`**/api/v1/care/journey/${requestId}`, route => mode === "empty"
      ? route.fulfill({ headers: { "X-Skycar-Account": account }, json: { data: { id: requestId, photos: [] } } })
      : route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "x" } } }));
    await page.goto(`${origin}/care/requests/${requestId}`);
    await page.getByRole("heading", { name: "Your request" }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByRole("heading", { name: "Photos you sent" }).count(), 0, mode);
    await context.close();
  }
  console.log("PASS: My Jobs photo hint (present, absent, zero, malformed), request-page proxy thumbnails >=44px at 320/390/1440, 404/503 states with retry, no signed-URL calls, absent section without photos/access");
} finally { if (browser) await browser.close(); server.kill("SIGTERM"); }
