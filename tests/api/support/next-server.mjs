// Starts the built app on an OS-assigned port so API suites can run in parallel (and next to
// other checkouts or stale servers) without port collisions. Needs `npm run build` first.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const ansi = /\u001b\[[0-9;]*m/g;

export async function startNext(env, { timeoutMs = 45000 } = {}) {
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = once(server, 'exit');
  const stop = async () => { if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM'); await exited; };
  const deadline = Date.now() + timeoutMs;
  try {
    // The port is read back from this process's own banner, never guessed, so a server that
    // is already listening somewhere else cannot be mistaken for ours.
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Application did not report a port within ${timeoutMs} ms:\n${output}`)), timeoutMs);
      const read = chunk => {
        output += chunk;
        const match = /Local:\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(output.replace(ansi, ''));
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      };
      server.stdout.on('data', read);
      server.stderr.on('data', read);
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Application exited (${code}) before it was ready:\n${output}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    while (true) {
      if (server.exitCode !== null) throw new Error(`Application exited before it was ready:\n${output}`);
      try { const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1000) }); await response.text(); break; }
      catch { if (Date.now() > deadline) throw new Error(`Application did not become healthy on ${base}:\n${output}`); await delay(100); }
    }
    return { base, port, output: () => output, stop };
  } catch (error) { await stop(); throw error; }
}
