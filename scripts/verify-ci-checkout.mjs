import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function sha(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error('Missing or invalid event commit SHA.');
  }
  return value;
}

// Raw commit parents remain available even in a shallow checkout.
// Event values are compared as data, never interpolated into shell commands.
export function verifyCheckout({ cwd, mode, eventName, event, githubSha }) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const checkedOut = sha(git('rev-parse', 'HEAD'));
  const trigger = sha(githubSha);
  if (mode !== 'head' && mode !== 'integration') throw new Error('Unknown checkout mode.');
  if (eventName === 'push' && mode === 'head') {
    if (checkedOut !== trigger || sha(event.after) !== trigger || event.deleted) {
      throw new Error('Checkout does not match the pushed commit.');
    }
    return { mode, checkedOut, head: trigger };
  }
  if (eventName !== 'pull_request') throw new Error('Unsupported verification event.');
  const head = sha(event.pull_request?.head?.sha);
  const base = sha(event.pull_request?.base?.sha);
  if (mode === 'head') {
    if (checkedOut !== head) throw new Error('Checkout does not match the pull request head.');
  } else {
    if (checkedOut !== trigger) throw new Error('Checkout does not match the event merge candidate.');
    const header = git('cat-file', '-p', 'HEAD').split('\n\n', 1)[0];
    const parents = header.split('\n').filter(line => line.startsWith('parent ')).map(line => line.slice(7));
    if (parents.length !== 2 || parents[0] !== base || parents[1] !== head) {
      throw new Error('Merge candidate does not contain the event base and head in order.');
    }
  }
  return { mode, checkedOut, head, base };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCheckout({
    cwd: process.cwd(),
    mode: process.env.CI_CHECKOUT_MODE,
    eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    githubSha: process.env.GITHUB_SHA,
  });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Verified ${result.mode} checkout\n\n` +
      Object.entries(result).filter(([key]) => key !== 'mode')
        .map(([key, value]) => `- ${key}: \`${value}\`\n`).join(''));
  }
}
