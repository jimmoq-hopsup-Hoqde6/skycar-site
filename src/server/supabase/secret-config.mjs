export class SecretConfigurationError extends Error {
  constructor() { super('Supabase server key configuration is invalid'); }
}

// Remove only accidental paste formatting. Never log or expose this value.
export function serverSecret(value) {
  if (typeof value !== 'string') throw new SecretConfigurationError();
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1,-1).trim();
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) return key;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));
      // Shape check only. Supabase still verifies the actual API credential.
      if (claims.role === 'service_role') return key;
    } catch { /* Invalid legacy key. */ }
  }
  throw new SecretConfigurationError();
}
