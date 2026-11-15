import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readReceipt} from '../../src/domain/care/presentation.ts';

// 20261115100000_care_request_postcode_and_update_recheck.sql. Regression for gap-audit probe P1
// (15 Nov 2026): update_details moved an account journey to 5290 (outside the service area) and it
// was accepted. Disposable database only.

// Rows that exist BEFORE 20261115100000 is applied (garage-care-db.test.mjs calls this after the sunset
// proof and before the later files), so the backfill is exercised on real pre-migration data.
const seeded = {};
export function seedRequestPostcodeBackfill({sql, quote}) {
  const customer = randomUUID(), vehicle = randomUUID();
  const ids = {fromCommand: randomUUID(), journeyWins: randomUUID(), legacy: randomUUID(), legacyEmptyJourney: randomUUID(), malformed: randomUUID()};
  const request = id => `insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes)
    values(${quote(id)},${quote(customer)},${quote(vehicle)},'repair','Synthetic backfill request','flexible',clock_timestamp()+interval '1 hour',30);`;
  const command = (id, payload) => `insert into public.care_request_commands(customer_id,operation,idempotency_key,payload,request_id)
    values(${quote(customer)},'submit',gen_random_uuid(),${quote(JSON.stringify(payload))}::jsonb,${quote(id)});`;
  const journey = (id, details) => `insert into public.care_journeys(id,account_request_id,customer_details,state) values(${quote(id)},${quote(id)},${quote(JSON.stringify(details))}::jsonb,'review');`;
  const core = {vehicle_id: vehicle, service: 'repair', description: 'Synthetic backfill request', preferred_window: 'flexible'};
  sql(`insert into auth.users(id) values(${quote(customer)});
    insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(customer)},'Kia','Backfill',2019);
    ${Object.values(ids).map(request).join('\n')}
    ${command(ids.fromCommand, {...core, postcode: '5000'})}
    ${command(ids.journeyWins, {...core, postcode: '5000'})}${journey(ids.journeyWins, {name: 'Pat', phone: '0400000000', suburb: 'Mount Gambier', postcode: '5290'})}
    ${command(ids.legacy, core)}
    ${command(ids.legacyEmptyJourney, core)}${journey(ids.legacyEmptyJourney, {})}
    ${command(ids.malformed, {...core, postcode: '50000'})}`);
  Object.assign(seeded, ids, {customer, vehicle});
}

export async function verifyRequestPostcodeRecheck({sql, auth, quote, garageCreate, result}) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const fails = (statement, code, label = code) => {
    assert.throws(() => sql(statement), error => `${error.message}\n${error.stderr ?? ''}`.includes(/^[A-Z_]+$/.test(code) ? `ERROR:  ${code}` : code), label);
    checks++;
  };
  const stored = id => sql(`select coalesce(service_postcode,'-')||'|'||service_postcode_source from public.care_requests where id=${quote(id)}::uuid`);
  const otherCovered = service => sql(`select postcode from public.care_service_coverage where service=${quote(service)} and postcode<>'5000' order by postcode limit 1`);
  const outside = '5290';
  equal(sql(`select count(*) from public.care_service_coverage where postcode=${quote(outside)}`), '0', '5290 is outside both lists');

  // ---- 1. Backfill of pre-migration rows. ----------------------------------------------------------
  assert.ok(seeded.fromCommand, 'seedRequestPostcodeBackfill ran before the migration');
  equal(stored(seeded.fromCommand), '5000|backfill', 'submit command postcode is backfilled');
  equal(stored(seeded.journeyWins), '5290|backfill', 'the saved journey postcode wins and is copied without a coverage re-check');
  equal(stored(seeded.legacy), '-|unknown', 'legacy four-key create stays unknown');
  equal(stored(seeded.legacyEmptyJourney), '-|unknown');
  equal(stored(seeded.malformed), '-|unknown', 'a malformed value is never copied');

  // ---- 2. Schema: unknown <-> null, format, trigger functions not callable by API roles. -------------
  fails(`update public.care_requests set service_postcode='5000' where id=${quote(seeded.legacy)}::uuid`, 'care_requests_service_postcode_source');
  fails(`update public.care_requests set service_postcode_source='submit' where id=${quote(seeded.legacy)}::uuid`, 'care_requests_service_postcode_source');
  fails(`update public.care_requests set service_postcode='500A',service_postcode_source='submit' where id=${quote(seeded.legacy)}::uuid`, 'care_requests_service_postcode_format');
  for (const fn of ['care_request_record_submit_postcode()', 'care_journey_recheck_postcode()', 'care_journey_sync_request_postcode()']) {
    equal(sql(`select string_agg(r||':'||has_function_privilege(r,'public.${fn}','execute')::text,',' order by r) from unnest(array['anon','authenticated','service_role']) r`),
      'anon:false,authenticated:false,service_role:false', fn);
  }
  equal(sql("select position('care_legacy_create_open(sampled.at)' in pg_get_functiondef('public.care_submit_request(uuid,jsonb)'::regprocedure)) > 0"), 't', 'the sunset body of care_submit_request is still the installed one');

  // ---- 3. Submit persists the checked postcode. ----------------------------------------------------
  const owner = randomUUID();
  sql(`insert into auth.users(id) values(${quote(owner)}); insert into public.user_roles(user_id,role) values(${quote(owner)},'customer') on conflict do nothing;`);
  const vehicle = garageCreate(owner, randomUUID(), 'Postcode');
  const body = (postcode, service = 'repair') => JSON.stringify({vehicle_id: vehicle.id, service, description: 'Scratch on the rear bumper', preferred_window: 'flexible', ...(postcode ? {postcode} : {})});
  const submit = (key, payload) => JSON.parse(sql(auth(owner, `select public.care_submit_request(${quote(key)}::uuid,${quote(payload)}::jsonb)`))).request;
  const submitKey = randomUUID();
  const created = submit(submitKey, body('5000'));
  equal(stored(created.id), '5000|submit');
  // The typed app contract reads the real snapshot: both fields present and valid.
  equal([created.service_postcode, created.service_postcode_source], ['5000', 'submit'], 'the submit receipt carries the stored postcode');
  equal(readReceipt(created, created.id).service_postcode_source, 'submit', 'readReceipt accepts the database receipt');
  equal(submit(submitKey, body('5000')).id, created.id, 'replay is unchanged');
  equal(stored(created.id), '5000|submit');
  fails(auth(owner, `select public.care_submit_request(gen_random_uuid(),${quote(body(outside))}::jsonb)`), 'OUT_OF_AREA', 'submit still rejects out of area');

  // ---- 4. Probe P1: account update_details re-checks coverage. --------------------------------------
  const journey = (id, action, payload, {actor = owner, guestKey = null, key = randomUUID()} = {}) =>
    `begin;set local role service_role;select public.care_journey_command(${quote(action)},${quote(id)}::uuid,${actor ? `${quote(actor)}::uuid` : 'null'},${guestKey ? `${quote(guestKey)}::uuid` : 'null'},${quote(key)}::uuid,${quote(JSON.stringify(payload))}::jsonb);commit;`;
  const details = postcode => ({name: 'Pat Lee', phone: '0400000000', suburb: 'Adelaide', postcode});
  const snapshot = id => sql(`select concat_ws('|',j.customer_details->>'postcode',j.state,j.revision,
      (select count(*) from public.care_journey_events e where e.journey_id=j.id and e.type='details_updated'),
      (select count(*) from public.care_reviewed_quotes q where q.journey_id=j.id and q.status='issued'))
    from public.care_journeys j where j.id=${quote(id)}::uuid`);
  sql(journey(created.id, 'update_details', details('5000')));
  equal(stored(created.id), '5000|update_details');
  const expert = randomUUID();
  sql(`insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until) values(${quote(expert)},'Coverage expert','Synthetic coverage expert',array['repair','cleaning'],array['5000'],'2030-12-31');
    insert into public.care_reviewed_quotes(journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at)
     values(${quote(created.id)},${quote(expert)},'Coverage expert','Synthetic coverage expert','Synthetic repair scope',10000,'issued',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour');
    update public.care_journeys set state='quotes_ready' where id=${quote(created.id)}::uuid;`);
  const before = snapshot(created.id);
  const rejectedKey = randomUUID();
  fails(journey(created.id, 'update_details', details(outside), {key: rejectedKey}), 'OUT_OF_AREA', 'P1: moving the journey out of area is refused');
  equal(snapshot(created.id), before, 'refusal changes nothing: postcode, state, revision, events, issued quotes');
  equal(stored(created.id), '5000|update_details');
  equal(sql(`select count(*) from public.care_journey_commands where idempotency_key=${quote(rejectedKey)}::uuid`), '0', 'no command row for the refused key');
  // The refused key stored nothing, so it can carry a corrected (covered) postcode.
  const moved = otherCovered('repair');
  equal(JSON.parse(sql(journey(created.id, 'update_details', details(moved), {key: rejectedKey}))).replayed, false);
  equal(stored(created.id), `${moved}|update_details`, 'the accepted change is copied to the request');
  equal(snapshot(created.id).split('|').slice(0, 2), [moved, 'review'], 'a postcode change still withdraws quotes and returns to review');
  equal(JSON.parse(sql(journey(created.id, 'update_details', details(moved), {key: rejectedKey}))).replayed, true, 'replay unchanged');

  // ---- 5. COVERAGE_UNAVAILABLE: fail closed, nothing written. Unchanged postcode is not a coverage decision.
  for (const setup of ["delete from public.care_service_coverage where service='repair';", 'delete from public.care_service_coverage_meta;']) {
    fails(`begin;${setup}${journey(created.id, 'update_details', details('5000')).replace('begin;', '')}`, 'COVERAGE_UNAVAILABLE', setup);
    equal(sql(`begin;${setup}${journey(created.id, 'update_details', {...details(moved), name: 'Pat Q Lee'}).replace('begin;', '').replace(/commit;$/, '')}rollback;`).length > 0, true, 'a name-only change does not need the list');
  }
  equal(stored(created.id), `${moved}|update_details`);

  // ---- 6. Legacy (unknown) request: its first saved postcode is checked, then recorded. ---------------
  const legacy = randomUUID();
  sql(`insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes)
      values(${quote(legacy)},${quote(owner)},${quote(vehicle.id)},'cleaning','Synthetic legacy request','flexible',clock_timestamp()+interval '1 hour',30);`);
  equal(stored(legacy), '-|unknown', 'a request created without a postcode (legacy shape) is unknown');
  const legacyReceipt = JSON.parse(sql(auth(owner, `select public.care_get_request(${quote(legacy)}::uuid)`)));
  equal([legacyReceipt.service_postcode, readReceipt(legacyReceipt, legacy).service_postcode_source], [null, 'unknown'], 'a legacy receipt (null, unknown) is readable');
  fails(journey(legacy, 'update_details', details(outside)), 'OUT_OF_AREA');
  equal(stored(legacy), '-|unknown');
  sql(journey(legacy, 'update_details', details('5000')));
  equal(stored(legacy), '5000|update_details');
  // ---- 7. Guest journey: the service comes from the guest payload. ------------------------------------
  const guest = randomUUID(), guestKey = randomUUID();
  sql(`insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(${quote(guest)},${quote(guestKey)},${quote('c'.repeat(64))},
    ${quote(JSON.stringify({name: 'Guest Owner', phone: '0400000000', postcode: '5000', suburb: 'Adelaide', vehicle: 'Synthetic Yaris', service: 'cleaning', description: 'A synthetic interior clean'}))}::jsonb);`);
  fails(journey(guest, 'update_details', details(outside), {actor: null, guestKey}), 'OUT_OF_AREA', 'guest move out of area');
  const guestMoved = otherCovered('cleaning');
  sql(journey(guest, 'update_details', details(guestMoved), {actor: null, guestKey}));
  equal(sql(`select customer_details->>'postcode' from public.care_journeys where id=${quote(guest)}::uuid`), guestMoved);

  // ---- 8. Concurrency: two changes on one journey serialise on the journey lock; no deadlock. ---------
  sql(journey(created.id, 'update_details', details('5000')));
  const tag = `postcode_race_${created.id}`;
  const parked = result(`begin;/* ${tag} */set local role service_role;select public.care_journey_command('update_details',${quote(created.id)}::uuid,${quote(owner)}::uuid,null,gen_random_uuid(),${quote(JSON.stringify(details(moved)))}::jsonb);select pg_sleep(1);commit;`);
  for (let i = 0; i < 200 && sql(`select count(*) from pg_stat_activity where wait_event='PgSleep' and query like ${quote(`%${tag}%`)}`) === '0'; i++) await new Promise(r => setTimeout(r, 20));
  const racing = result(journey(created.id, 'update_details', details(outside)));
  const outcomes = (await Promise.all([parked, racing])).map(o => o.error ? (o.output.includes('deadlock') ? '40P01' : (o.output.match(/ERROR:\s+([A-Z_]+)/) ?? [, 'OTHER'])[1]) : 'ok');
  equal(outcomes, ['ok', 'OUT_OF_AREA']);
  equal(stored(created.id), `${moved}|update_details`);
  // Catalog last, so the mutation checks are killed by the behaviour above.
  equal(sql(`select string_agg(tgname,',' order by tgname) from pg_trigger where not tgisinternal and tgname in ('care_request_record_submit_postcode','care_journey_recheck_postcode','care_journey_sync_request_postcode')`),
    'care_journey_recheck_postcode,care_journey_sync_request_postcode,care_request_record_submit_postcode');
  console.log(`PASS: ${checks} request postcode persistence and update-details coverage checks (backfill, submit, P1, unavailable, legacy, guest, race).`);
}
