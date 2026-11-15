#!/usr/bin/env node
// Prints the SQL that makes the database coverage table equal to src/server/care/coverage-areas.json.
//
// The JSON file stays the single source of truth for the launch area. The table the database
// enforces at request creation is a generated mirror of it, built through the SAME
// buildCoverageIndex() the /api/v1/care/coverage resolver uses (so a file the resolver rejects
// cannot be turned into a migration). To change coverage: regenerate the JSON
// (build-coverage-areas.py), then put this script's output in a NEW forward-only migration whose
// name contains "care_service_coverage". Never edit an applied migration.
//
// Usage: node scripts/coverage-data/build-coverage-migration.mjs > block.sql
import { readFileSync } from 'node:fs';
import { buildCoverageIndex } from '../../src/server/care/coverage-resolver.ts';

export function coverageSeedSql(data) {
  const index = buildCoverageIndex(data);
  const lines = [
    '-- BEGIN GENERATED COVERAGE SEED (scripts/coverage-data/build-coverage-migration.mjs)',
    'delete from public.care_service_coverage;',
  ];
  for (const service of [...index.keys()].sort()) {
    const postcodes = [...index.get(service)].sort();
    lines.push(`insert into public.care_service_coverage(service, postcode)`);
    lines.push(`  select '${service}', code from unnest(array[`);
    for (let i = 0; i < postcodes.length; i += 12) lines.push(`    ${postcodes.slice(i, i + 12).map(code => `'${code}'`).join(',')}${i + 12 < postcodes.length ? ',' : ''}`);
    lines.push('  ]) as code;');
  }
  lines.push(`insert into public.care_service_coverage_meta(singleton, area_id, version)`);
  lines.push(`  values (true, '${data.areaId}', '${data.version}')`);
  lines.push(`  on conflict (singleton) do update set area_id = excluded.area_id, version = excluded.version, updated_at = clock_timestamp();`);
  lines.push('-- END GENERATED COVERAGE SEED');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(new URL('../../src/server/care/coverage-areas.json', import.meta.url), 'utf8'));
  process.stdout.write(`${coverageSeedSql(data)}\n`);
}
