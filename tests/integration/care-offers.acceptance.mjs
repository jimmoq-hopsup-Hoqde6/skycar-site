import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Called by the combined runner AFTER every migration and the existing journey
// assertions. Fixtures are disposable; no hosted credentials or live capacity.
export async function verifyCareOffers({ sql, auth, quote, garageCreate, carePayload, expectSqlError, result, waitForQuery }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const fails = (statement, code) => { expectSqlError(statement, code); checks++; };
  const json = statement => JSON.parse(sql(statement).split('\n')[0]);
  const literal = (value, type = 'text') => value === null ? 'null' : `${quote(value)}::${type}`;
  const service = (statement, claim = 'service_role') =>
    `begin; set local role service_role; set local request.jwt.claim.role = ${quote(claim)}; ${statement}; commit;`;

  const owner = randomUUID(), stranger = randomUUID(), technician = randomUUID();
  sql(`insert into auth.users(id) values (${quote(owner)}),(${quote(stranger)}),(${quote(technician)});
    insert into public.user_roles(user_id,role) values (${quote(technician)},'technician');`);
  const vehicle = garageCreate(owner, randomUUID(), 'Offer acceptance fixture');
  const receipt = json(auth(owner, `select public.care_submit_request(gen_random_uuid(),${quote(carePayload(vehicle.id))}::jsonb)`)).request;
  const requestId = receipt.id;
  const times = json(`select jsonb_build_object(
    'expiry',date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),
    'start',date_trunc('milliseconds',clock_timestamp()+interval '1 day'),
    'end',date_trunc('milliseconds',clock_timestamp()+interval '1 day 2 hours'),
    'secondStart',date_trunc('milliseconds',clock_timestamp()+interval '2 days'),
    'secondEnd',date_trunc('milliseconds',clock_timestamp()+interval '2 days 2 hours'))`);
  const slot = { starts_at: times.start, ends_at: times.end };
  const secondSlot = { starts_at: times.secondStart, ends_at: times.secondEnd };
  const base = { requestId, technician, scope: 'Repair and refinish rear bumper scratch', price: 49500,
    reason: null, expiry: times.expiry, slots: [slot] };
  function command(changes = {}) {
    const p = { ...base, key: randomUUID(), ...changes };
    const slotsSql = Object.hasOwn(changes, 'slotsSql') ? changes.slotsSql : `${quote(JSON.stringify(p.slots))}::jsonb`;
    return `select public.care_publish_offer(${literal(p.key,'uuid')},${literal(p.requestId,'uuid')},${literal(p.technician,'uuid')},
      ${literal(p.scope)},${literal(p.price,'integer')},${literal(p.reason)},${literal(p.expiry,'timestamptz')},${slotsSql})`;
  }
  const publishResult = changes => json(service(command(changes)));
  const publish = changes => publishResult(changes).offer_id;
  const get = actor => json(auth(actor, `select public.care_get_offers(${quote(requestId)}::uuid)`));
  const snapshot = () => json(`select jsonb_build_object(
    'offers',(select jsonb_agg(to_jsonb(o) order by o.id) from public.care_offers o where request_id=${quote(requestId)}::uuid),
    'slots',(select jsonb_agg(to_jsonb(s) order by s.id) from public.care_offer_slots s join public.care_offers o on o.id=s.offer_id where o.request_id=${quote(requestId)}::uuid),
    'commands',(select jsonb_agg(to_jsonb(c) order by c.idempotency_key) from public.care_offer_commands c join public.care_offers o on o.id=c.offer_id where o.request_id=${quote(requestId)}::uuid),
    'audits',(select count(*) from public.audit_events where action='care.offer_issued' and resource_id=${quote(requestId)}))`);

  equal(get(owner), [], 'owner sees an honest empty offer list');
  fails(auth(stranger, `select public.care_get_offers(${quote(requestId)}::uuid)`), 'NOT_FOUND');
  fails(auth(stranger, `select public.care_get_offers(${quote(randomUUID())}::uuid)`), 'NOT_FOUND');
  fails(`begin; set local role anon; select public.care_get_offers(${quote(requestId)}::uuid); commit;`, 'permission denied');
  fails(auth(owner, 'select * from public.care_offers'), 'permission denied');
  fails(auth(owner, 'select * from public.care_offer_slots'), 'permission denied');
  for (const table of ['care_offers', 'care_offer_slots', 'care_offer_commands']) {
    fails(auth(owner, `insert into public.${table} default values`), 'permission denied');
    fails(auth(owner, `delete from public.${table}`), 'permission denied');
  }
  fails(auth(owner, `set local request.jwt.claim.role='service_role'; ${command()}`), 'permission denied');
  fails(`begin; set local role anon; set local request.jwt.claim.role='service_role'; ${command()}; commit;`, 'permission denied');
  fails(service(command(), ''), 'FORBIDDEN');
  fails(service(command(), 'authenticated'), 'FORBIDDEN');
  fails(service(command({ technician: stranger })), 'FORBIDDEN');
  fails(service(command({ requestId: randomUUID() })), 'NOT_FOUND');
  sql(`delete from public.user_roles where user_id=${quote(owner)}::uuid and role='customer'`);
  fails(auth(owner, `select public.care_get_offers(${quote(requestId)}::uuid)`), 'FORBIDDEN');
  sql(`insert into public.user_roles(user_id,role) values (${quote(owner)},'customer')`);

  const firstKey = randomUUID();
  const firstResult = publishResult({ key: firstKey });
  equal(firstResult.replayed, false, 'first publication is not a replay');
  const first = firstResult.offer_id;
  let offers = get(owner);
  equal(offers.length, 1, 'one customer-safe offer');
  equal(offers[0].id, first);
  equal(offers[0].request_id, requestId);
  equal(offers[0].total_price_cents, 49500);
  equal(offers[0].slots.length, 1);
  equal(Date.parse(offers[0].slots[0].starts_at), Date.parse(times.start));
  equal('technician_id' in offers[0], false, 'private account ID is not returned');
  equal('offer_id' in offers[0].slots[0], false);
  const audit = json(`select jsonb_build_object('actor',actor_user_id,'technician',metadata->>'technician_id','type',metadata->>'actor_type')
    from public.audit_events where action='care.offer_issued' and metadata->>'offer_id'=${quote(first)}`);
  equal(audit, { actor: null, technician, type: 'service_role' }, 'service publishing must not impersonate the technician in audit');
  const unchanged = json(auth(owner, `select public.care_get_request(${quote(requestId)}::uuid)`));
  equal(unchanged.customer_stage, receipt.customer_stage);
  equal(unchanged.assignment_state, 'none');
  equal(unchanged.fulfilment_state, null);
  equal(unchanged.money_state, null);
  equal(unchanged.events, receipt.events, 'offer preparation does not claim a booking or delivered notification');

  const beforeReplay = snapshot();
  const replay = publishResult({
    key: firstKey,
    scope: `  ${base.scope}  `,
    expiry: new Date(times.expiry).toISOString(),
    slots: [{ starts_at: new Date(times.start).toISOString(), ends_at: new Date(times.end).toISOString() }],
  });
  equal(replay, { offer_id: first, replayed: true }, 'same canonical command reconciles to the original offer');
  equal(snapshot(), beforeReplay, 'replay creates no offer, slot, command or audit duplicate');
  fails(service(command({ key: firstKey, price: 49501 })), 'IDEMPOTENCY_CONFLICT');
  equal(snapshot(), beforeReplay, 'conflicting key reuse cannot mutate the original result');

  const invalid = [
    ['SQL-null slots', { slotsSql: 'null' }], ['JSON-null slots', { slots: null }],
    ['non-array slots', { slots: {} }], ['scalar slots', { slots: 'invalid' }],
    ['empty slots', { slots: [] }], ['too many slots', { slots: Array(21).fill(slot) }],
    ['null idempotency key', { key: null }],
    ['null request', { requestId: null }], ['null technician', { technician: null }],
    ['null price', { price: null }], ['zero price', { price: 0 }], ['negative price', { price: -1 }],
    ['null scope', { scope: null }], ['short scope', { scope: 'short' }], ['long scope', { scope: 'x'.repeat(2001) }],
    ['short reason', { reason: 'x' }], ['long reason', { reason: 'x'.repeat(1001) }],
    ['null expiry', { expiry: null }], ['infinite expiry', { expiry: 'infinity' }],
    ['expired quote', { expiry: '2000-01-01T00:00:00Z' }],
    ['quote outlives appointment start', { expiry: times.end }],
    ['null slot', { slots: [null] }], ['array slot', { slots: [[]] }],
    ['missing start', { slots: [{ ends_at: times.end }] }],
    ['null start', { slots: [{ ...slot, starts_at: null }] }],
    ['null end', { slots: [{ ...slot, ends_at: null }] }],
    ['numeric time', { slots: [{ ...slot, starts_at: 123 }] }],
    ['invalid time', { slots: [{ ...slot, starts_at: 'not a time' }] }],
    ['infinite time', { slots: [{ ...slot, ends_at: 'infinity' }] }],
    ['timezone missing', { slots: [{ ...slot, starts_at: '2030-01-01T00:00:00' }] }],
    ['invalid calendar date', { slots: [{ starts_at: '2030-02-30T00:00:00Z', ends_at: '2030-03-02T00:00:00Z' }] }],
    ['past appointment', { slots: [{ starts_at: '2000-01-01T00:00:00Z', ends_at: '2000-01-01T01:00:00Z' }] }],
    ['non-positive duration', { slots: [{ ...slot, ends_at: times.start }] }],
    ['unknown slot field', { slots: [{ ...slot, reserved: true }] }],
    ['duplicate slot', { slots: [slot, slot] }],
    ['overlapping slots', { slots: [slot, { starts_at: times.start, ends_at: times.secondEnd }] }],
    ['invalid second slot', { slots: [slot, { ...secondSlot, ends_at: null }] }],
  ];
  for (const [label, changes] of invalid) {
    const before = snapshot();
    fails(service(command(changes)), 'VALIDATION_FAILED');
    equal(snapshot(), before, `${label}: no supersession, offer, slot or audit may survive a rejected command`);
  }
  console.log(`PASS: ${invalid.length} invalid offer commands roll back without changing the previously issued offer.`);

  const replacement = publish({ price: 51000, reason: 'Updated scope after review', slots: [slot, secondSlot] });
  equal(sql(`select status from public.care_offers where id=${quote(first)}::uuid`), 'superseded');
  offers = get(owner);
  equal(offers.map(o => o.id), [replacement]);
  equal(offers[0].slots.length, 2);
  equal(offers[0].total_price_cents, 51000);
  equal(offers[0].adjustment_reason, 'Updated scope after review');
  sql(`update public.care_offer_slots set starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+interval '1 hour'
    where id=${quote(offers[0].slots[0].id)}::uuid`);
  offers = get(owner);
  equal(offers[0].slots.length, 1, 'already-started appointment is not available even while its end is future');
  sql(`update public.care_offer_slots set status='withdrawn' where offer_id=${quote(replacement)}::uuid`);
  equal(get(owner), [], 'no selectable slots means no selectable offer');

  const boundary = publish({ expiry: times.start });
  equal(get(owner).map(o => o.id), [boundary], 'offer may expire exactly at appointment start');
  const expired = json(`begin; update public.care_offers set expires_at=statement_timestamp() where id=${quote(boundary)}::uuid;
    set local role authenticated; set local request.jwt.claim.sub=${quote(owner)};
    select public.care_get_offers(${quote(requestId)}::uuid); commit;`);
  equal(expired, [], 'quote is unavailable at its exact expiry boundary');
  const withdrawn = publish();
  sql(`update public.care_offers set status='withdrawn' where id=${quote(withdrawn)}::uuid`);
  equal(get(owner), [], 'withdrawn offers remain hidden');

  publish();
  const beforeAuditFailure = snapshot();
  sql(`create function public.test_offer_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'TEST_OFFER_AUDIT_FAILURE'; end $$;
    create trigger test_offer_audit_failure before insert on public.audit_events for each row execute function public.test_offer_audit_failure();`);
  try {
    fails(service(command()), 'TEST_OFFER_AUDIT_FAILURE');
    equal(snapshot(), beforeAuditFailure, 'audit failure rolls back slots, new offer and old-offer supersession');
  } finally {
    sql('drop trigger test_offer_audit_failure on public.audit_events; drop function public.test_offer_audit_failure();');
  }

  const duplicateKey = randomUUID();
  const duplicateTag = 'offers_duplicate_publication_holds_idempotency_lock';
  const duplicateCommand = command({ key: duplicateKey, price: 52000 });
  const firstDuplicate = result(service(`${duplicateCommand}; select pg_sleep(1); /* ${duplicateTag} */`));
  await waitForQuery(duplicateTag);
  const secondDuplicate = result(service(duplicateCommand));
  const duplicateResults = await Promise.all([firstDuplicate, secondDuplicate]);
  for (const outcome of duplicateResults) equal(outcome.error, undefined, outcome.output);
  const duplicateEvidence = json(`select jsonb_build_object(
    'command_count',(select count(*) from public.care_offer_commands where idempotency_key=${quote(duplicateKey)}::uuid),
    'offer_id',(select offer_id from public.care_offer_commands where idempotency_key=${quote(duplicateKey)}::uuid),
    'audit_count',(select count(*) from public.audit_events a join public.care_offer_commands c
      on c.idempotency_key=${quote(duplicateKey)}::uuid and a.metadata->>'offer_id'=c.offer_id::text
      where a.action='care.offer_issued'))`);
  equal(duplicateEvidence.command_count, 1, 'concurrent identical commands persist one reconciliation record');
  equal(duplicateEvidence.audit_count, 1, 'concurrent identical commands emit one audit event');
  equal(get(owner).map(o => o.id), [duplicateEvidence.offer_id], 'concurrent identical commands create one issued offer');
  const duplicateReplay = publishResult({ key: duplicateKey, price: 52000 });
  equal(duplicateReplay, { offer_id: duplicateEvidence.offer_id, replayed: true }, 'completed concurrent command remains replayable');

  // Different keys remain distinct commands and preserve serialized
  // supersession. This is not capacity reservation or double-booking protection.
  const tag = 'offers_publication_holds_shared_request';
  const firstPublication = result(service(`${command({ price: 53000 })}; select pg_sleep(1); /* ${tag} */`));
  await waitForQuery(tag);
  const secondPublication = result(service(command({ price: 54000 })));
  const results = await Promise.all([firstPublication, secondPublication]);
  for (const outcome of results) equal(outcome.error, undefined, outcome.output);
  equal(sql(`select count(*) from public.care_offers where request_id=${quote(requestId)}::uuid and technician_id=${quote(technician)}::uuid and status='issued'`), '1');
  equal(get(owner).length, 1, 'concurrent supersession leaves one issued offer');

  let before = snapshot();
  sql(`update public.care_requests set assignment_state='accepted' where id=${quote(requestId)}::uuid`);
  fails(service(command()), 'INVALID_TRANSITION');
  equal(snapshot(), before, 'already-assigned request rejects another offer');
  sql(`update public.care_requests set assignment_state='none',customer_stage='no_match',next_action='choose_recovery',responsible_role='customer',next_update_at=null where id=${quote(requestId)}::uuid`);
  fails(service(command()), 'INVALID_TRANSITION');
  equal(snapshot(), before, 'no-match request must be reopened before publishing');
  sql(`update public.care_requests set customer_stage='request_received',next_action='review_request',responsible_role='operations',next_update_at=clock_timestamp()+interval '1 hour' where id=${quote(requestId)}::uuid`);
  sql(auth(owner, `select public.garage_mutate_vehicle('archive',${quote(vehicle.id)}::uuid,'{"expected_revision":1}'::jsonb,gen_random_uuid(),gen_random_uuid())`));
  before = snapshot();
  fails(service(command()), 'NOT_FOUND');
  equal(snapshot(), before, 'archived vehicle cannot receive new offers');
  console.log(`PASS: ${checks} offer database assertions, including authorization, time boundaries, rollback and serialized supersession (disposable SQL/auth stubs, not hosted acceptance).`);
}
