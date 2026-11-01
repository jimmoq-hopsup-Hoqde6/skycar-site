import test from "node:test";
import assert from "node:assert/strict";
import { photoKind } from "../../src/domain/care/photo-types.ts";
import { PhotoUploadError, formatCountdown, parseRetryAfter, uploadRequestPhotos } from "../../src/domain/care/request-photos.ts";

const id = "11111111-1111-4111-8111-111111111111";
const file = (name = "a.jpg", type = "image/jpeg") => new File([new Uint8Array(200)], name, { type });
const reply = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const failure = async promise => promise.then(() => assert.fail("expected rejection"), error => { assert.ok(error instanceof PhotoUploadError); return error; });

test("photoKind accepts the server formats and HEIC/HEIF input, nothing else", () => {
  assert.equal(photoKind({ type: "image/jpeg", name: "a.jpg" }), "jpeg");
  assert.equal(photoKind({ type: "IMAGE/PNG", name: "a" }), "png");
  assert.equal(photoKind({ type: "image/webp", name: "a" }), "webp");
  assert.equal(photoKind({ type: "image/heic", name: "a" }), "heic");
  assert.equal(photoKind({ type: "image/heif", name: "a" }), "heic");
  assert.equal(photoKind({ type: "", name: "IMG_1.HEIC" }), "heic");
  assert.equal(photoKind({ type: "", name: "IMG_1.heif" }), "heic");
  for (const bad of [{ type: "", name: "a.jpg" }, { type: "image/gif", name: "a.gif" }, { type: "application/pdf", name: "a.heic" }, { type: "constructor", name: "a" }, { type: "image/svg+xml", name: "a.svg" }]) assert.equal(photoKind(bad), null);
});

test("upload posts multipart photos to the existing owner route and requires a matching stored count", async () => {
  let seen;
  await uploadRequestPhotos(id, [file("a.jpg"), file("b.jpg")], async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ data: { stored: 2 } }), { status: 201 }); });
  assert.equal(seen.url, `/api/v1/care/journey/${id}/photos`);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.credentials, "same-origin");
  assert.ok(seen.init.body instanceof FormData);
  assert.equal(seen.init.body.getAll("photos").length, 2);
  assert.equal(seen.init.headers, undefined, "content-type must be left to the browser for the multipart boundary");
  const short = await failure(uploadRequestPhotos(id, [file(), file()], reply(201, { data: { stored: 1 } })));
  assert.equal(short.code, "INVALID_RESPONSE"); assert.equal(short.retryable, true);
});

test("upload refuses bad input before any network call", async () => {
  const never = async () => assert.fail("must not fetch");
  for (const [rid, files] of [["not-a-uuid", [file()]], [id, []], [id, [file(), file(), file(), file()]]]) {
    const error = await failure(uploadRequestPhotos(rid, files, never));
    assert.equal(error.code, "VALIDATION_FAILED"); assert.equal(error.retryable, false);
  }
});

test("upload maps failures to retryable or terminal outcomes", async () => {
  const net = await failure(uploadRequestPhotos(id, [file()], async () => { throw new TypeError("failed"); }));
  assert.deepEqual([net.code, net.retryable], ["NETWORK_ERROR", true]);
  const down = await failure(uploadRequestPhotos(id, [file()], reply(503, { error: { code: "TEMPORARILY_UNAVAILABLE", message: "Try again." } })));
  assert.deepEqual([down.status, down.retryable, down.message], [503, true, "Try again."]);
  const flagged = await failure(uploadRequestPhotos(id, [file()], reply(409, { error: { code: "X", message: "m", retryable: true } })));
  assert.equal(flagged.retryable, true);
  const garbled = await failure(uploadRequestPhotos(id, [file()], reply(502, "<html>")));
  assert.deepEqual([garbled.code, garbled.retryable], ["INVALID_RESPONSE", true]);
  const okGarbled = await failure(uploadRequestPhotos(id, [file()], reply(201, "nope")));
  assert.equal(okGarbled.retryable, true);
  for (const status of [400, 401, 403, 404, 409, 413]) {
    const error = await failure(uploadRequestPhotos(id, [file()], reply(status, { error: { code: "E", message: "No." } })));
    assert.deepEqual([error.status, error.retryable], [status, false]);
  }
  const unknown = await failure(uploadRequestPhotos(id, [file()], reply(400, { error: {} })));
  assert.equal(unknown.message, "We could not save the photos.");
});

const limited = (headers, message = "Too many photo uploads. Wait a little, then retry the same photos.") => async () => new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message, retryable: true } }), { status: 429, headers });

test("429 RATE_LIMITED keeps the server message, is retryable and carries Retry-After seconds", async () => {
  const error = await failure(uploadRequestPhotos(id, [file()], limited({ "Retry-After": "1800" })));
  assert.deepEqual([error.status, error.code, error.retryable, error.retryAfter], [429, "RATE_LIMITED", true, 1800]);
  assert.equal(error.message, "Too many photo uploads. Wait a little, then retry the same photos.");
  const missing = await failure(uploadRequestPhotos(id, [file()], limited({})));
  assert.deepEqual([missing.retryable, missing.retryAfter], [true, undefined]);
  const odd = await failure(uploadRequestPhotos(id, [file()], async () => new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "m" } }), { status: 429, headers: { "Retry-After": "soon" } })));
  assert.deepEqual([odd.retryable, odd.retryAfter], [true, undefined], "429 is retryable even if the body omits the flag");
});

test("Retry-After is only read from a 429 and only as whole seconds", async () => {
  const other = await failure(uploadRequestPhotos(id, [file()], async () => new Response(JSON.stringify({ error: { code: "E", message: "m" } }), { status: 503, headers: { "Retry-After": "30" } })));
  assert.equal(other.retryAfter, undefined);
  for (const [value, expected] of [["30", 30], [" 3600 ", 3600], ["0", undefined], ["-5", undefined], ["1.5", undefined], ["Wed, 21 Oct 2026 07:28:00 GMT", undefined], ["", undefined], [null, undefined], ["1234567", undefined]]) assert.equal(parseRetryAfter(value), expected, String(value));
});

test("countdown is formatted m:ss without negative values", () => {
  assert.equal(formatCountdown(3600), "60:00");
  assert.equal(formatCountdown(61), "1:01");
  assert.equal(formatCountdown(9), "0:09");
  assert.equal(formatCountdown(0.2), "0:01");
  assert.equal(formatCountdown(-4), "0:00");
});
