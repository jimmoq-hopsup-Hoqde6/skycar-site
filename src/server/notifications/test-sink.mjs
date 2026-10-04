function fingerprint(input) {
  return JSON.stringify({
    channel: input.channel,
    destination: input.destination,
    template: input.template,
    locale: input.locale,
  });
}

export function createNotificationTestSink({outcomes = []} = {}) {
  if (!Array.isArray(outcomes)) throw new TypeError('Test sink outcomes must be an array');

  const calls = [];
  const messages = [];
  const keys = new Map();
  let outcomeIndex = 0;

  return {
    calls,
    messages,
    async send(input) {
      calls.push({...input});
      const currentFingerprint = fingerprint(input);
      const prior = keys.get(input.idempotency_key);

      if (prior && prior.fingerprint !== currentFingerprint) {
        return {status: 'failed', code: 'IDEMPOTENCY_CONFLICT'};
      }
      if (prior?.accepted) return {...prior.accepted};
      if (!prior) keys.set(input.idempotency_key, {fingerprint: currentFingerprint});

      const configured = outcomes[outcomeIndex++];
      if (configured instanceof Error) throw configured;
      const outcome = configured ?? {
        status: 'accepted',
        provider_message_id: `test-message-${messages.length + 1}`,
      };

      if (outcome.status === 'accepted') {
        const accepted = {...outcome};
        keys.get(input.idempotency_key).accepted = accepted;
        messages.push({...input, provider_message_id: outcome.provider_message_id});
        return accepted;
      }
      return {...outcome};
    },
  };
}
