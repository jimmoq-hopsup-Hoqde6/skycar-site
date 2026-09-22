import { isTrustedWriteOrigin } from '../http/request-origin.mjs';
import {
  API_ROUTE_TEMPLATES,
  ApiFault,
  apiResult,
  withApiBoundary,
} from '../http/api-boundary.mjs';

const MAX_BODY_BYTES = 8192;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_RETURN_ROOTS = ['/garage', '/care/request', '/care/requests'];

function fault(code, status, message, options = {}) {
  throw new ApiFault(code, status, message, options);
}

function requireSameOrigin(request) {
  if (!isTrustedWriteOrigin(request)) fault('CSRF_FAILED', 403, 'Submit this request from Skycar.');
}

async function readJson(request) {
  requireSameOrigin(request);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    fault('UNSUPPORTED_MEDIA_TYPE', 415, 'Use application/json.');
  }

  const reader = request.body?.getReader();
  if (!reader) fault('VALIDATION_FAILED', 400, 'Check the sign-in details.');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        fault('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fault('VALIDATION_FAILED', 400, 'Check the sign-in details.'); }
}

function strictObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fault('VALIDATION_FAILED', 400, 'Check the sign-in details.');
  }
  const actual = Object.keys(value);
  if (actual.some(key => !keys.includes(key))) {
    fault('VALIDATION_FAILED', 400, 'Check the sign-in details.');
  }
  return value;
}

export function safeReturnPath(value, fallback = '/garage') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/')
    || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    fault('VALIDATION_FAILED', 400, 'Choose a valid Skycar return page.');
  }
  let parsed;
  try { parsed = new URL(value, 'https://skycar.invalid'); }
  catch { fault('VALIDATION_FAILED', 400, 'Choose a valid Skycar return page.'); }
  if (parsed.origin !== 'https://skycar.invalid'
    || !SAFE_RETURN_ROOTS.some(root => parsed.pathname === root || parsed.pathname.startsWith(`${root}/`))) {
    fault('VALIDATION_FAILED', 400, 'Choose a valid Skycar return page.');
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function signInInput(value) {
  const input = strictObject(value, ['email', 'password', 'next']);
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (email.length < 3 || email.length > 320 || !EMAIL_PATTERN.test(email)
    || password.length < 1 || password.length > 1024) {
    fault('VALIDATION_FAILED', 400, 'Check the sign-in details.');
  }
  return { email, password, redirectTo: safeReturnPath(input.next) };
}

export function createAuthHandlers(dependencies, boundaryOptions = {}) {
  return {
    signIn(request) {
      return withApiBoundary(request, API_ROUTE_TEMPLATES.authSignIn, async () => {
        const { email, password, redirectTo } = signInInput(await readJson(request));
        const client = await dependencies.connect();
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) fault('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.');
        return apiResult({ redirectTo }, { headers: { Vary: 'Cookie' } });
      }, boundaryOptions);
    },

    signOut(request) {
      return withApiBoundary(request, API_ROUTE_TEMPLATES.authSignOut, async () => {
        const body = strictObject(await readJson(request), []);
        if (Object.keys(body).length) fault('VALIDATION_FAILED', 400, 'Check the sign-out request.');
        const client = await dependencies.connect();
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) fault('SIGN_OUT_FAILED', 503, 'Unable to sign out. Please try again.', { retryable: true });
        return apiResult({ redirectTo: '/auth/sign-in' }, { headers: { Vary: 'Cookie' } });
      }, boundaryOptions);
    },
  };
}
