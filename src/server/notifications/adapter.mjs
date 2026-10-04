const JOB_KEYS = [
  'attempt',
  'available_at',
  'channel',
  'delivery_id',
  'event_id',
  'locale',
  'recipient_id',
  'template',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  8 * 60 * 60_000,
  24 * 60 * 60_000,
  24 * 60 * 60_000,
  24 * 60 * 60_000,
  24 * 60 * 60_000,
];

export class NotificationJobError extends Error {
  constructor() {
    super('Notification job is invalid');
    this.name = 'NotificationJobError';
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readJob(value) {
  if (!exactKeys(value, JOB_KEYS)) throw new NotificationJobError();
  if (!UUID.test(value.delivery_id) || !UUID.test(value.event_id) || !UUID.test(value.recipient_id)) {
    throw new NotificationJobError();
  }
  if (value.channel !== 'email' || value.template !== 'care_update_available' || value.locale !== 'en-AU') {
    throw new NotificationJobError();
  }
  if (!Number.isInteger(value.attempt) || value.attempt < 0 || value.attempt > 9) {
    throw new NotificationJobError();
  }
  if (
    typeof value.available_at !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value.available_at) ||
    !Number.isFinite(Date.parse(value.available_at))
  ) {
    throw new NotificationJobError();
  }
  return value;
}

function clockInstant(now) {
  const value = now();
  const instant = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(instant)) throw new Error('Notification clock is invalid');
  return instant;
}

function retryResult(job, code, instant) {
  return {
    delivery_id: job.delivery_id,
    status: 'retry',
    code,
    available_at: new Date(instant + RETRY_DELAYS_MS[job.attempt]).toISOString(),
  };
}

function metadata(job, outcome) {
  return {
    event: 'notification_delivery',
    deliveryId: job.delivery_id,
    eventId: job.event_id,
    channel: job.channel,
    template: job.template,
    attempt: job.attempt,
    outcome,
  };
}

function safeLog(log, job, outcome) {
  try {
    log(metadata(job, outcome));
  } catch {
    // Delivery truth must not depend on observability availability.
  }
}

function validAuthorization(value) {
  if (exactKeys(value, ['allowed'])) return value.allowed === false;
  return exactKeys(value, ['allowed', 'destination']) &&
    value.allowed === true &&
    typeof value.destination === 'string' &&
    value.destination.length >= 3 &&
    value.destination.length <= 320 &&
    EMAIL.test(value.destination);
}

function validProviderMessageId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function providerOutcome(value) {
  if (exactKeys(value, ['provider_message_id', 'status']) && value.status === 'accepted' && validProviderMessageId(value.provider_message_id)) {
    return {kind: 'delivered', providerMessageId: value.provider_message_id};
  }
  if (exactKeys(value, ['code', 'status']) && value.status === 'retry' && value.code === 'PROVIDER_TEMPORARY') {
    return {kind: 'retry'};
  }
  if (
    exactKeys(value, ['code', 'status']) &&
    value.status === 'failed' &&
    ['PROVIDER_REJECTED', 'IDEMPOTENCY_CONFLICT'].includes(value.code)
  ) {
    return {kind: 'failed', code: value.code};
  }
  return {kind: 'retry'};
}

export function createNotificationAdapter({authorize, provider, log = () => {}, now = () => new Date()} = {}) {
  if (typeof authorize !== 'function' || !provider || typeof provider.send !== 'function' || typeof log !== 'function' || typeof now !== 'function') {
    throw new TypeError('Notification adapter dependencies are invalid');
  }

  return Object.freeze({
    async deliver(rawJob) {
      const job = readJob(rawJob);
      const instant = clockInstant(now);

      if (Date.parse(job.available_at) > instant) {
        const result = {delivery_id: job.delivery_id, status: 'not_due', code: 'NOT_DUE', available_at: job.available_at};
        safeLog(log, job, result.status);
        return result;
      }

      if (job.attempt === 9) {
        const result = {delivery_id: job.delivery_id, status: 'failed', code: 'ATTEMPTS_EXHAUSTED'};
        safeLog(log, job, result.status);
        return result;
      }

      let authorization;
      try {
        authorization = await authorize(job);
      } catch {
        const result = retryResult(job, 'AUTHORIZATION_UNAVAILABLE', instant);
        safeLog(log, job, result.status);
        return result;
      }

      if (!validAuthorization(authorization)) {
        const result = retryResult(job, 'AUTHORIZATION_UNAVAILABLE', instant);
        safeLog(log, job, result.status);
        return result;
      }

      if (!authorization.allowed) {
        const result = {delivery_id: job.delivery_id, status: 'failed', code: 'RECIPIENT_NOT_AUTHORIZED'};
        safeLog(log, job, result.status);
        return result;
      }

      let rawOutcome;
      try {
        rawOutcome = await provider.send({
          idempotency_key: job.delivery_id,
          channel: job.channel,
          destination: authorization.destination,
          template: job.template,
          locale: job.locale,
        });
      } catch {
        rawOutcome = null;
      }

      const outcome = providerOutcome(rawOutcome);
      let result;
      if (outcome.kind === 'delivered') {
        result = {
          delivery_id: job.delivery_id,
          status: 'delivered',
          code: 'DELIVERED',
          provider_message_id: outcome.providerMessageId,
        };
      } else if (outcome.kind === 'failed') {
        result = {delivery_id: job.delivery_id, status: 'failed', code: outcome.code};
      } else {
        result = retryResult(job, 'PROVIDER_TEMPORARY', instant);
      }

      safeLog(log, job, result.status);
      return result;
    },
  });
}
