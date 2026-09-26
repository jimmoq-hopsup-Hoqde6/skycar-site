import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const [
  nearLimitPath,
  outputPath,
  memoryMaxBytes,
  memorySwapMaxBytes,
  cpuQuota,
  memoryPeakBytes,
  oomEvents,
  oomKillEvents,
  diskPeakBytes,
  elapsedSeconds,
  runnerFreeBytes,
  nodeVersion,
  postgresVersion,
  supabaseCliVersion,
  acceptedOperationsSha,
] = process.argv.slice(2);

const nearLimit = JSON.parse(readFileSync(nearLimitPath, 'utf8'));
assert.deepEqual(Object.keys(nearLimit).sort(), [
  'classification',
  'envelopeBytes',
  'fileBytes',
  'jsonBytes',
  'logicalBytes',
  'passed',
].sort());
assert.equal(nearLimit.classification, 'synthetic-crypto-only');
assert.equal(nearLimit.passed, true);

const values = {
  fixture_passed: 'true',
  fixture_skipped: '0',
  near_limit_crypto_passed: String(nearLimit.passed),
  near_limit_logical_bytes: String(nearLimit.logicalBytes),
  near_limit_json_bytes: String(nearLimit.jsonBytes),
  near_limit_envelope_bytes: String(nearLimit.envelopeBytes),
  memory_max_bytes: memoryMaxBytes,
  memory_swap_max_bytes: memorySwapMaxBytes,
  cpu_quota: cpuQuota,
  memory_peak_bytes: memoryPeakBytes,
  oom_events: oomEvents,
  oom_kill_events: oomKillEvents,
  disk_peak_bytes: diskPeakBytes,
  elapsed_seconds: elapsedSeconds,
  runner_free_bytes: runnerFreeBytes,
  node_version: nodeVersion,
  postgres_version: postgresVersion,
  supabase_cli_version: supabaseCliVersion,
  accepted_operations_sha: acceptedOperationsSha,
};

for (const [name, value] of Object.entries(values)) {
  assert.match(name, /^[a-z0-9_]+$/);
  assert.match(value, /^[A-Za-z0-9./-]+$/);
}

writeFileSync(
  outputPath,
  `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n')}\n`,
  // This file contains only the validated synthetic values above. It must be
  // readable by the non-root Actions runner after the container exits.
  { mode: 0o644, flag: 'wx' },
);
chmodSync(outputPath, 0o644);
