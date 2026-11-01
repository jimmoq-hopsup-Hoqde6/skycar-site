import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Regression gate for lock ORDER across the integrated chain, in real concurrency (see the header of
// stress/week1-cross-lock-stress.sh). The injected-sleep test in week1-cross-lock-order.acceptance.mjs only sees
// locks taken late; this one lets about twelve sessions queue behind a holder and race when it releases, so any
// reordering between care_journey_command, care_submit_request, the photo-marker RPCs, the availability RPC,
// the customer review and vehicle archive shows up as 40P01.
// Mutation evidence (lock-order mutants applied to the migrations, this test must fail): see docs/CONCURRENCY_LOCK_ORDER_GATE.md.
export async function verifyCrossLockStress({ database }) {
  const iterations = Number(process.env.SKYCAR_STRESS_ITERATIONS ?? 4);
  const result = spawnSync('bash', ['tests/integration/stress/week1-cross-lock-stress.sh'], {
    encoding: 'utf8', env: { ...process.env, STRESS_DATABASE_URL: database, N: String(iterations) }, timeout: 600000,
  });
  const summary = /STRESS-SUMMARY iterations=(\d+) sessions_per_iter~12 deadlocks\(40P01\)=(\d+) stmt_timeouts=(\d+)/.exec(result.stdout);
  assert.ok(summary, `stress run produced no summary (exit ${result.status}): ${result.stdout}\n${result.stderr}`);
  const [, ran, deadlocks, timeouts] = summary.map(Number);
  assert.equal(ran, iterations * 5, `every iteration ran (3 random mixes and 2 ordered-queue runs per round): ${result.stdout}`);
  assert.equal(deadlocks, 0, `lock-order inversion: ${deadlocks} deadlock(s) in ${ran} iterations:\n${result.stdout}`);
  assert.equal(timeouts, 0, `statement timeouts (a session waited 20s): ${result.stdout}`);
  assert.equal(result.status, 0, `stress script failed: ${result.stdout}\n${result.stderr}`);
  console.log(`PASS: cross-lock stress ${ran} iterations, about 12 concurrent sessions each, 0 deadlocks, 0 timeouts.`);
}
