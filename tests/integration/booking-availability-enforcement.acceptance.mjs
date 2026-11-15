import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tomorrowAt, publishAvailability} from './availability-fixture.mjs';

// 20261115090000_care_booking_availability_enforcement.sql: a technician-linked expert's published
// availability must cover the slot on technician quote, admin publish_quote, customer select_quote and
// admin confirm. Regression for gap-audit probe P2 (15 Nov 2026): before this file a quote outside the
// published hours reached `scheduled`. Disposable database only.
export async function verifyBookingAvailabilityEnforcement({sql, quote, result}) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const json = statement => JSON.parse(sql(statement).split('\n')[0]);
  const fails = (statement, code, label) => {
    assert.throws(() => sql(statement), error => `${error.message}\n${error.stderr ?? ''}`.includes(`ERROR:  ${code}`), label ?? code);
    checks++;
  };
  const service = body => `begin;set local role service_role;${body};commit;`;
  const [admin, customer, tech, opsOnlyTech] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  sql(`insert into auth.users(id) values(${[admin, customer, tech, opsOnlyTech].map(quote).join('),(')});
    insert into public.user_roles(user_id,role) values(${quote(admin)},'admin'),(${quote(customer)},'customer'),(${quote(tech)},'technician')
    on conflict do nothing;`);
  const journey = (action, id, payload, actor = admin, key = randomUUID()) => service(
    `select public.care_journey_command(${quote(action)},${id ? `${quote(id)}::uuid` : 'null'},${quote(actor)}::uuid,null,${quote(key)}::uuid,${quote(JSON.stringify(payload))}::jsonb)`);
  const techCommand = (payload, id, key = randomUUID()) => service(
    `select public.care_technician_job_command(${quote(tech)}::uuid,${quote(key)}::uuid,'quote',${quote(id)}::uuid,${quote(JSON.stringify(payload))}::jsonb)`);
  const adminCommand = (action, id, payload) => service(
    `select public.care_technician_admin_command(${quote(admin)}::uuid,gen_random_uuid(),${quote(action)},${id ? `${quote(id)}::uuid` : 'null'},${quote(JSON.stringify(payload))}::jsonb)`);
  const [expert, opsExpert] = [randomUUID(), randomUUID()];
  sql(`insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until) values
    (${quote(expert)},'Availability probe','Synthetic availability expert',array['repair'],array['5000'],'2030-12-31'),
    (${quote(opsExpert)},'Operations managed','Synthetic operations-managed expert',array['repair'],array['5000'],'2030-12-31');`);
  json(adminCommand('bind_technician', null, {expert_id: expert, user_id: tech}));
  const times = json(`select jsonb_build_object('expiry',date_trunc('seconds',clock_timestamp()+interval '1 hour'),
    'in_start',${tomorrowAt(10)},'in_end',${tomorrowAt(11)},'late_start',${tomorrowAt(11)},'late_end',${tomorrowAt(12)},'out_start',${tomorrowAt(22)},'out_end',${tomorrowAt(23)},
    'night_start',${tomorrowAt(23)},'night_end',${tomorrowAt(25)},
    'weekday',extract(isodow from date_trunc('day', clock_timestamp() at time zone 'Australia/Adelaide') + interval '1 day')::int,
    'date',to_char(date_trunc('day', clock_timestamp() at time zone 'Australia/Adelaide') + interval '1 day','YYYY-MM-DD'))`);
  const hours = (starts_at, ends_at, exceptions = []) => JSON.stringify({timezone: 'Australia/Adelaide', weekly_windows: [{weekday: times.weekday, starts_at, ends_at}], exceptions});
  let revision = 0;
  const publish = payload => { json(publishAvailability(quote, tech, payload, revision)); revision++; };
  const slot = (inside = true) => ({scope_summary: 'Replace the cracked mirror housing', total_price_cents: 22000, expires_at: times.expiry,
    starts_at: inside ? times.in_start : times.out_start, ends_at: inside ? times.in_end : times.out_end});
  const vehicleFor = () => {
    const vehicle = randomUUID(), id = randomUUID();
    sql(`insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(customer)},'Mazda','Availability',2021);
      insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes)
       values(${quote(id)},${quote(customer)},${quote(vehicle)},'repair','Synthetic availability request','flexible',clock_timestamp()+interval '1 hour',30);
      insert into public.care_journeys(id,account_request_id,customer_details,state) values(${quote(id)},${quote(id)},'{"postcode":"5000"}','review');`);
    return id;
  };
  const state = id => sql(`select state from public.care_journeys where id=${quote(id)}::uuid`);
  const commandCount = () => sql(`select count(*) from public.care_technician_commands where actor_id=${quote(tech)}::uuid`);

  // ---- 1. Never published: technician quote and admin publish both fail closed. -------------------------
  const a = vehicleFor();
  json(adminCommand('invite_technician', a, {expert_id: expert}));
  fails(techCommand(slot(), a), 'AVAILABILITY_REQUIRED');
  fails(journey('publish_quote', a, {expert_id: expert, ...slot()}), 'AVAILABILITY_REQUIRED');
  equal(commandCount(), '0', 'a rejected quote stores no command');

  // ---- 2. Probe P2: published tomorrow 09:00-12:00 only; a 22:00 quote is refused. -----------------------
  publish(hours('09:00', '12:00'));
  const reusedKey = randomUUID();
  fails(techCommand(slot(false), a, reusedKey), 'AVAILABILITY_SLOT_UNAVAILABLE', 'quote outside published hours');
  fails(journey('publish_quote', a, {expert_id: expert, ...slot(false)}), 'AVAILABILITY_SLOT_UNAVAILABLE', 'admin publish outside published hours');
  fails(techCommand({...slot(), starts_at: times.night_start, ends_at: times.night_end}, a), 'AVAILABILITY_SLOT_UNAVAILABLE', 'a slot crossing local midnight');
  equal(sql(`select count(*) from public.care_reviewed_quotes where journey_id=${quote(a)}::uuid`), '0');
  equal(state(a), 'review');
  // The refused key stored nothing, so the same key may carry a corrected slot; it then replays.
  const inside = json(techCommand(slot(), a, reusedKey));
  equal([inside.state, inside.replayed], ['quotes_ready', false]);
  equal(json(techCommand(slot(), a, reusedKey)).replayed, true);

  // ---- 3. Customer selection re-checks the slot against the current schedule. ----------------------------
  publish(hours('09:00', '10:00'));
  fails(journey('select_quote', a, {quote_id: inside.quote_id, address: '1 King William St'}, customer), 'AVAILABILITY_SLOT_UNAVAILABLE');
  equal([state(a), sql(`select status from public.care_reviewed_quotes where id=${quote(inside.quote_id)}::uuid`)], ['quotes_ready', 'issued'], 'rejected selection changes nothing');
  publish(hours('09:00', '12:00'));
  equal(json(journey('select_quote', a, {quote_id: inside.quote_id, address: '1 King William St'}, customer)).state, 'booking_requested');

  // ---- 4. Admin confirm re-checks it again; replays stay idempotent afterwards. ----------------------------
  publish(hours('09:00', '12:00', [{date: times.date, windows: []}]));
  fails(journey('confirm', a, {availability_confirmed: true}), 'AVAILABILITY_SLOT_UNAVAILABLE', 'exception day closes the slot');
  equal(state(a), 'booking_requested');
  publish(hours('09:00', '12:00'));
  const confirmKey = randomUUID();
  equal(json(journey('confirm', a, {availability_confirmed: true}, admin, confirmKey)).state, 'scheduled');
  publish(hours('09:00', '10:00'));
  const replay = json(journey('confirm', a, {availability_confirmed: true}, admin, confirmKey));
  equal([replay.replayed, replay.state, state(a)], [true, 'scheduled', 'scheduled'], 'a confirmed booking replays after the schedule changes');

  // ---- 5. Expert with no linked technician login: refused at every entry point (Marcel, 15 Nov 2026:
  // "Every technician needs a login"). No operations fallback: availability_confirmed does not help.
  const b = vehicleFor();
  const quotesFor = id => sql(`select count(*) from public.care_reviewed_quotes where journey_id=${quote(id)}::uuid`);
  // (a) admin publish_quote
  fails(journey('publish_quote', b, {expert_id: opsExpert, ...slot()}), 'EXPERT_ACCOUNT_REQUIRED', 'publish for an unlinked expert');
  equal([quotesFor(b), state(b)], ['0', 'review'], 'nothing published');
  // (b) customer select_quote of a quote that names an unlinked expert (inserted directly: it can no longer be published)
  const unlinkedQuote = randomUUID();
  sql(`insert into public.care_reviewed_quotes(id,journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at)
     values(${quote(unlinkedQuote)},${quote(b)},${quote(opsExpert)},'Operations managed','Synthetic','Synthetic legacy quote',10000,'issued',${quote(times.expiry)},${quote(times.in_start)},${quote(times.in_end)});
    update public.care_journeys set state='quotes_ready' where id=${quote(b)}::uuid;`);
  fails(journey('select_quote', b, {quote_id: unlinkedQuote, address: '2 King William St'}, customer), 'EXPERT_ACCOUNT_REQUIRED', 'select of an unlinked expert');
  equal([state(b), sql(`select status from public.care_reviewed_quotes where id=${quote(unlinkedQuote)}::uuid`)], ['quotes_ready', 'issued']);
  // (c) admin confirm of a booking request that names an unlinked expert (pre-existing row shape)
  sql(`update public.care_reviewed_quotes set status='selected' where id=${quote(unlinkedQuote)}::uuid;
    update public.care_journeys set state='booking_requested',selected_quote_id=${quote(unlinkedQuote)},expert_id=${quote(opsExpert)},
      starts_at=${quote(times.in_start)},ends_at=${quote(times.in_end)},customer_details=customer_details||'{"address":"2 King William St"}' where id=${quote(b)}::uuid;`);
  const unlinkedConfirmKey = randomUUID();
  fails(journey('confirm', b, {availability_confirmed: true}, admin, unlinkedConfirmKey), 'EXPERT_ACCOUNT_REQUIRED', 'confirm of an unlinked expert, even with the operations attestation');
  equal(state(b), 'booking_requested');
  equal(sql(`select count(*) from public.care_journey_commands where idempotency_key=${quote(unlinkedConfirmKey)}::uuid`), '0', 'the refused confirm stored no command');
  // (d) technician quote: a technician login with no linked expert cannot quote at all (existing FORBIDDEN), so an
  // unlinked expert is unreachable here; the helper itself answers EXPERT_ACCOUNT_REQUIRED.
  sql(`insert into public.user_roles(user_id,role) values(${quote(opsOnlyTech)},'technician') on conflict do nothing;`);
  fails(service(`select public.care_technician_job_command(${quote(opsOnlyTech)}::uuid,gen_random_uuid(),'quote',${quote(b)}::uuid,${quote(JSON.stringify(slot()))}::jsonb)`), 'FORBIDDEN', 'unlinked technician login');
  fails(service(`select public.care_assert_expert_slot_available(${quote(opsExpert)}::uuid,${quote(times.in_start)}::timestamptz,${quote(times.in_end)}::timestamptz)`), 'EXPERT_ACCOUNT_REQUIRED', 'helper: never linked');
  // A linked account that is deactivated keeps the existing EXPERT_UNAVAILABLE answer (technician quote included).
  const c0 = vehicleFor();
  json(adminCommand('invite_technician', c0, {expert_id: expert}));
  sql(`update public.care_technician_accounts set active=false where expert_id=${quote(expert)}::uuid`);
  fails(service(`select public.care_assert_expert_slot_available(${quote(expert)}::uuid,${quote(times.in_start)}::timestamptz,${quote(times.in_end)}::timestamptz)`), 'EXPERT_UNAVAILABLE', 'helper: linked but inactive');
  assert.throws(() => sql(techCommand(slot(), c0)), /EXPERT_UNAVAILABLE|FORBIDDEN/, 'technician quote while the link is inactive'); checks++;
  equal(quotesFor(c0), '0');
  sql(`update public.care_technician_accounts set active=true where expert_id=${quote(expert)}::uuid`);
  // Linking a technician login (and publishing) makes the same unlinked-expert booking confirmable.
  sql(`insert into public.care_technician_accounts(expert_id,user_id) values(${quote(opsExpert)},${quote(opsOnlyTech)});`);
  json(publishAvailability(quote, opsOnlyTech, hours('09:00', '12:00')));
  equal(json(journey('confirm', b, {availability_confirmed: true}, admin, unlinkedConfirmKey)).state, 'scheduled', 'the refused key is reusable once linked');

  // ---- 6. Concurrency: confirm and replace serialise on the schedule advisory lock. -----------------------
  // (i) replace removing the slot holds its locks; confirm waits, then refuses (never books outside).
  const race = async (firstSql, secondSql, tag) => {
    const first = result(`begin;/* ${tag} */set local role service_role;${firstSql};select pg_sleep(1.5);commit;`);
    for (let i = 0; i < 200 && sql(`select count(*) from pg_stat_activity where wait_event='PgSleep' and query like ${quote(`%${tag}%`)}`) === '0'; i++) await new Promise(r => setTimeout(r, 20));
    const second = result(secondSql);
    let waited = false;
    for (let i = 0; i < 60 && !waited; i++) { waited = sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and state='active' and pid<>pg_backend_pid() and query not like ${quote(`%${tag}%`)} and query like '%care_%'`) !== '0'; if (!waited) await new Promise(r => setTimeout(r, 20)); }
    return {outcomes: await Promise.all([first, second]), waited};
  };
  const classify = o => o.error ? (o.output.includes('deadlock') ? '40P01' : (o.output.match(/ERROR:\s+([A-Z_]+)/) ?? [, 'OTHER'])[1]) : 'ok';
  const c = vehicleFor();
  publish(hours('09:00', '12:00'));
  json(adminCommand('invite_technician', c, {expert_id: expert}));
  // A later slot: job `a` already holds 10:00-11:00 for this expert (capacity would say SLOT_UNAVAILABLE).
  const cq = json(techCommand({...slot(), starts_at: times.late_start, ends_at: times.late_end}, c));
  json(journey('select_quote', c, {quote_id: cq.quote_id, address: '3 King William St'}, customer));
  let raced = await race(`select public.care_technician_replace_availability(${quote(tech)}::uuid,gen_random_uuid(),${revision},${quote(hours('00:00', '09:00'))}::jsonb)`,
    journey('confirm', c, {availability_confirmed: true}), `avail_first_${c}`);
  revision++;
  equal(raced.outcomes.map(classify), ['ok', 'AVAILABILITY_SLOT_UNAVAILABLE'], 'confirm decided on the schedule committed while it waited');
  equal(raced.waited, true, 'confirm waited on the schedule lock');
  equal(state(c), 'booking_requested');
  // (ii) confirm holds the schedule lock (after its check); the later replace waits and both commit.
  publish(hours('09:00', '12:00'));
  raced = await race(`select public.care_journey_command('confirm',${quote(c)}::uuid,${quote(admin)}::uuid,null,gen_random_uuid(),'{"availability_confirmed":true}'::jsonb)`,
    service(`select public.care_technician_replace_availability(${quote(tech)}::uuid,gen_random_uuid(),${revision},${quote(hours('00:00', '09:00'))}::jsonb)`), `confirm_first_${c}`);
  revision++;
  equal(raced.outcomes.map(classify), ['ok', 'ok']);
  equal(raced.waited, true, 'replace waited on the confirm-held schedule lock');
  equal(state(c), 'scheduled');
  // ---- 7. Catalog (last, so mutation checks prove the behaviour above, not just the source): helper is service_role-only, SECURITY INVOKER, empty search_path, volatile. ------------
  const helper = 'public.care_assert_expert_slot_available(uuid,timestamptz,timestamptz)';
  equal(sql(`select prosecdef::text||'|'||provolatile::text||'|'||coalesce(proconfig=array['search_path=""'],false)::text from pg_proc where oid=${quote(helper)}::regprocedure`), 'false|v|true');
  equal(sql(`select has_function_privilege('service_role',${quote(helper)},'execute')::text||has_function_privilege('anon',${quote(helper)},'execute')::text||has_function_privilege('authenticated',${quote(helper)},'execute')::text||has_function_privilege('public',${quote(helper)},'execute')::text`), 'truefalsefalsefalse');
  fails(`select public.care_assert_expert_slot_available(${quote(expert)}::uuid,now(),now()+interval '1 hour')`, 'FORBIDDEN', 'owner/superuser session is not the API role');
  // Confirm: the availability check is the last tier, after the capacity advisory lock and the schedule lock.
  const body = sql("select pg_get_functiondef('public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure)");
  const confirmAt = body.indexOf("elsif p_action='confirm' then");
  const order = ["'care:expert-capacity:'", "'care:technician-availability-schedule:'", 'care_assert_expert_slot_available(journey.expert_id', "set state='scheduled'"].map(m => body.indexOf(m, confirmAt));
  assert.ok(order.every((at, i) => at > confirmAt && (i === 0 || at > order[i - 1])), `confirm lock/check order ${order}`); checks++;
  for (const marker of ['care_assert_expert_slot_available(target_expert_id,start_time,end_time)', 'care_assert_expert_slot_available(quote_row.expert_id,quote_row.starts_at,quote_row.ends_at)']) {
    assert.ok(body.includes(marker), marker); checks++;
  }
  assert.ok(sql("select pg_get_functiondef('public.care_technician_job_command(uuid,uuid,text,uuid,jsonb)'::regprocedure)").includes('care_assert_expert_slot_available(expert.id,start_time,end_time)')); checks++;

  console.log(`PASS: ${checks} booking availability enforcement checks (quote, publish, select, confirm, replay, concurrency).`);
}
