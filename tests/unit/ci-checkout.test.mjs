import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { verifyCheckout } from '../../scripts/verify-ci-checkout.mjs';

const cwd = mkdtempSync(join(tmpdir(), 'skycar-ci-checkout-'));
after(() => rmSync(cwd, { recursive: true, force: true }));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
git('init', '--quiet');
git('config', 'user.name', 'CI fixture');
git('config', 'user.email', 'ci@example.invalid');
writeFileSync(join(cwd, 'fixture'), 'base');
git('add', 'fixture');
git('commit', '--quiet', '-m', 'base');
const base = git('rev-parse', 'HEAD');
writeFileSync(join(cwd, 'fixture'), 'head');
git('commit', '--quiet', '-am', 'head');
const head = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const candidate = git('commit-tree', tree, '-p', base, '-p', head, '-m', 'candidate');
const reversed = git('commit-tree', tree, '-p', head, '-p', base, '-m', 'wrong order');
const event = { pull_request: { head: { sha: head }, base: { sha: base } } };
function verify(commit, options = {}) {
  git('checkout', '--quiet', '--detach', commit);
  return verifyCheckout({ cwd, mode: 'integration', eventName: 'pull_request', event, githubSha: candidate, ...options });
}

test('exact head is verified separately from the merge candidate', () => {
  assert.equal(verify(head, { mode: 'head' }).checkedOut, head);
  assert.throws(() => verify(candidate, { mode: 'head' }), /pull request head/);
});
test('integration verifies both event parents and emits all three commits', () => {
  assert.deepEqual(verify(candidate), { mode: 'integration', checkedOut: candidate, head, base });
});
test('an individually valid head cannot masquerade as integration evidence', () => {
  assert.throws(() => verify(head), /event merge candidate/);
  assert.throws(() => verify(head, { githubSha: head }), /event base and head/);
});
test('integration rejects reversed parents even with the same source tree', () => {
  assert.throws(() => verify(reversed, { githubSha: reversed }), /event base and head/);
});
test('integration rejects stale base and stale head event pairs', () => {
  const stale = 'a'.repeat(40);
  for (const side of ['base', 'head']) {
    const changed = structuredClone(event);
    changed.pull_request[side].sha = stale;
    assert.throws(() => verify(candidate, { event: changed }), /event base and head/);
  }
});
test('raw commit parents are verifiable in a shallow checkout', () => {
  writeFileSync(join(cwd, '.git/shallow'), `${candidate}\n`);
  try { assert.equal(verify(candidate).base, base); }
  finally { rmSync(join(cwd, '.git/shallow')); }
});
test('push verification requires the exact non-deleted push revision', () => {
  assert.equal(verify(head, { mode: 'head', eventName: 'push', event: { after: head }, githubSha: head }).head, head);
  assert.throws(() => verify(head, { mode: 'head', eventName: 'push', event: { after: base }, githubSha: head }), /pushed commit/);
  assert.throws(() => verify(head, { mode: 'head', eventName: 'push', event: { after: head, deleted: true }, githubSha: head }), /pushed commit/);
});
test('unsupported events, malformed revisions and invalid modes fail closed', () => {
  assert.throws(() => verify(candidate, { eventName: 'pull_request_target' }), /Unsupported/);
  assert.throws(() => verify(candidate, { mode: 'unknown' }), /Unknown/);
  assert.throws(() => verify(candidate, { event: {} }), /invalid event commit/);
  assert.throws(() => verify(candidate, { githubSha: 'main; echo injected' }), /invalid event commit/);
});
