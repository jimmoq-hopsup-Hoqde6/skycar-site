const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function canonicalOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || value !== url.origin) return null;
    return url;
  } catch { return null; }
}

// A proxy can reconstruct Request.url using an internal hostname. The public
// origin is deployment configuration, never an arbitrary forwarded header.
export function isTrustedWriteOrigin(request, {
  appOrigin = process.env.SKYCAR_APP_ORIGIN,
  environment = process.env.SKYCAR_ENV ?? 'demo',
} = {}) {
  const origin = canonicalOrigin(request.headers.get('origin'));
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site') return false;

  if (appOrigin !== undefined) {
    const trusted = canonicalOrigin(appOrigin);
    if (!trusted || (trusted.protocol !== 'https:' &&
      !(environment === 'demo' && loopback.has(trusted.hostname)))) return false;
    return origin.origin === trusted.origin;
  }

  // Hosted environments must explicitly name their one approved public origin.
  if (environment !== 'demo') return false;
  const target = new URL(request.url);
  let expected = target.origin;
  const host = request.headers.get('host');
  if (host && loopback.has(target.hostname)) {
    // Next normalizes loopback Request URLs to localhost. Recover the actual
    // local browser host only when it is also loopback on the same port.
    const local = canonicalOrigin(`${target.protocol}//${host}`);
    if (!local || !loopback.has(local.hostname) || local.port !== target.port) return false;
    expected = local.origin;
  }
  return origin.origin === expected;
}
