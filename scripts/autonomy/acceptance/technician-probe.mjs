// This is an untrusted-process adapter, not the authority that decides acceptance.
// Only run after the trusted validator enforces the exact pinned production edit.
// Candidate-controlled observations alone cannot prove arbitrary JavaScript safe.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const input = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.SKYCAR_CANDIDATE_ROOT || '/workspace';
const {createTechnicianHandlers} = await import(pathToFileURL(root + '/src/server/technician/http.mjs'));
const responses = [];
for (const item of input) {
  const calls = [];
  const handlers = createTechnicianHandlers({async command(job, key, command, expected) {
    calls.push({job, key, command, expected});
    return {account: item.returned_account, data: item.result};
  }}, {logger: {info(){}, error(){}}, origin: {environment: 'demo', appOrigin: undefined}});
  const response = await handlers.command(new Request(`http://localhost/api/v1/technician/jobs/${item.job}`, {
    method: 'POST', headers: {origin: 'http://localhost', 'content-type': 'application/json',
      'idempotency-key': item.key, 'x-skycar-account': item.expected_account},
    body: JSON.stringify(item.command),
  }), item.job);
  responses.push({case: item.case, nonce: item.nonce, calls, status: response.status,
    headers: {cache: response.headers.get('Cache-Control'), vary: response.headers.get('Vary'),
      account: response.headers.get('X-Skycar-Account')}, body: await response.json()});
}
process.stdout.write(JSON.stringify({version: 1, responses}));
