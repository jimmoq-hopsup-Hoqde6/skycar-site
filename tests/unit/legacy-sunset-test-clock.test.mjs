import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { substituteSunsetClock } from '../integration/legacy-sunset-test-clock.mjs';

const migration = readFileSync(new URL('../../supabase/migrations/20261108120000_care_legacy_create_sunset.sql', import.meta.url), 'utf8');
const definition = migration.match(/create or replace function public\.care_submit_request\([^]*?\$\$;/)?.[0];

test('the sunset seam replaces only the two decision clocks in the production definition', () => {
  assert.ok(definition);
  const modified = substituteSunsetClock(definition);
  assert.equal(modified.replaceAll('legacy_sunset_test.clock_timestamp()', 'clock_timestamp()'), definition);
  assert.match(modified, /at_time timestamptz := clock_timestamp\(\)/);
  assert.match(modified, /at_time := clock_timestamp\(\)/);
  assert.match(modified, /care_legacy_create_open\(sampled.at\)/);
});

test('the sunset seam rejects missing, duplicated and already instrumented sites', () => {
  const site = 'public.care_legacy_create_open(clock_timestamp())';
  assert.throws(() => substituteSunsetClock(definition.replace(site, 'true')), /expected exactly one clock site/);
  assert.throws(() => substituteSunsetClock(`${definition}\n${site}`), /expected exactly one clock site/);
  assert.throws(() => substituteSunsetClock(definition.replace('from (select clock_timestamp() as at) as sampled', 'from (select now() as at) as sampled')), /expected exactly one clock site/);
  assert.throws(() => substituteSunsetClock(substituteSunsetClock(definition)), /original must not contain a test seam/);
});
