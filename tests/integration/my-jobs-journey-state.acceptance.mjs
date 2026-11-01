import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyMyJobsJourneyState({ sql, auth, quote, garageCreate, carePayload }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const owner = randomUUID();
  sql(`insert into auth.users(id) values (${quote(owner)});`);
  const vehicle = garageCreate(owner, randomUUID(), 'Journey status');
  const submitted = JSON.parse(sql(auth(owner,
    `select public.care_submit_request(${quote(randomUUID())}::uuid, ${quote(carePayload(vehicle.id))}::jsonb)`,
  )).split('\n')[0]);
  const requestId = submitted.request.id;
  const list = () => JSON.parse(sql(auth(owner, 'select public.care_list_requests()')).split('\n')[0]).items.find(item => item.id === requestId);
  equal(list().journey_state, null);
  equal(list().completion_review_state, null);
  sql(`insert into public.care_journeys(id, account_request_id, state) values (${quote(requestId)}::uuid, ${quote(requestId)}::uuid, 'cancellation_requested')`);
  equal(list().journey_state, 'cancellation_requested');
  equal(list().quote_state, submitted.request.quote_state, 'journey projection does not rewrite the request');
  sql(`update public.care_journeys set state='completed' where id=${quote(requestId)}::uuid`);
  equal(list().journey_state, 'completed');
  equal(list().completion_review_state, 'awaiting_review');
  sql(`update public.care_journeys set completion_review_state='issue_reported', completion_issue_details='Synthetic private completion issue' where id=${quote(requestId)}::uuid`);
  equal(list().completion_review_state, 'issue_reported');
  assert.equal(JSON.stringify(list()).includes('Synthetic private completion issue'), false);
  checks += 1;
  console.log(`PASS: ${checks} My Jobs journey-state projection assertions (disposable database).`);
}
