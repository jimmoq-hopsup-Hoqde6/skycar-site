import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// Delta on top of PR #76's availability schema: overlap constraints, the read-only
// care_technician_availability_check() seam, no new sequences, forward-only.
export async function verifyTechnicianAvailabilityDelta({ sql, quote, result, waitForQuery }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const run = statement => Promise.resolve().then(() => sql(statement));
  const fail = async (statement, expected) => {
    await assert.rejects(() => run(statement), error => `${error.message}\n${error.stderr || ''}`.includes(expected), expected);
    checks += 1;
  };
  const service = statement => `begin; set local role service_role; ${statement}; commit;`;
  const delta = '20261101063000_technician_availability_enforcement_delta.sql';
  const migrations = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.includes(delta) && delta > '20261101062400_my_jobs_journey_status.sql', 'delta sorts after #76 migrations');
  checks += 1;

  const seedTechnician = async (statementRunner = run) => {
    const user = randomUUID();
    const expert = randomUUID();
    await statementRunner(`insert into auth.users(id) values (${quote(user)});
      insert into public.user_roles(user_id, role) values (${quote(user)},'technician');
      insert into public.care_experts(id, business_name, description, services, postcodes, insurance_valid_until)
        values (${quote(expert)},'Synthetic expert','Disposable availability delta fixture',array['repair'],array['5000'],'2030-12-31');
      insert into public.care_technician_accounts(expert_id, user_id) values (${quote(expert)},${quote(user)});`);
    return { user, expert };
  };
  const body = (weekly = [], exceptions = []) => JSON.stringify({ timezone: 'Australia/Adelaide', weekly_windows: weekly, exceptions });
  const replaceSql = (user, payload, revision, key = randomUUID()) => service(
    `select public.care_technician_replace_availability(${quote(user)}::uuid, ${quote(key)}::uuid, ${revision}, ${quote(payload)}::jsonb)`);
  const adl = local => `('${local}'::timestamp at time zone 'Australia/Adelaide')`;
  const off = (local, offset) => `'${local}${offset}'::timestamptz`;
  const verdict = async (expert, starts, ends) => (await run(service(
    `select public.care_technician_availability_check(${quote(expert)}::uuid, ${starts}, ${ends})`))).split('\n')[0];

  // ---- Catalog: signatures, volatility, privileges, search_path, no sequences. -----------------------
  const fns = ['care_technician_availability_check(uuid,timestamptz,timestamptz)',
    'care_technician_availability_offset_instant(date,integer,text)', 'care_technician_availability_wall_instant(timestamp)'];
  for (const fn of fns) {
    equal(await run(`select prosecdef::text||'|'||coalesce(proconfig=array['search_path=""'],false)::text from pg_proc where oid='public.${fn}'::regprocedure`),
      'false|true', `${fn} is SECURITY INVOKER with an empty search_path`);
    equal(await run(`select has_function_privilege('service_role','public.${fn}','execute')::text||has_function_privilege('anon','public.${fn}','execute')::text||has_function_privilege('authenticated','public.${fn}','execute')::text||has_function_privilege('public','public.${fn}','execute')::text`),
      'truefalsefalsefalse', `${fn} is service_role only`);
  }
  equal(await run(`select string_agg(proname||':'||provolatile::text, ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('care_technician_availability_check','care_technician_availability_offset_instant','care_technician_availability_wall_instant')`),
    'care_technician_availability_check:s,care_technician_availability_offset_instant:i,care_technician_availability_wall_instant:s', 'stable check, immutable index helper');
  const checkSource = await run(`select pg_get_functiondef('public.care_technician_availability_check(uuid,timestamptz,timestamptz)'::regprocedure)`);
  for (const forbidden of ['care_journeys', 'care_journey_commands', 'pg_advisory', 'for update', 'for share', 'insert into', 'update public', 'delete from']) {
    assert.ok(!checkSource.toLowerCase().includes(forbidden), `check must not contain ${forbidden}`); checks += 1;
  }
  // (3) #76 created no identity/serial column, so there is nothing to revoke: the only public
  // sequences are the two that predate availability (tracked separately in the sequence-grant issue draft).
  equal(await run(`select count(*) from pg_class where relkind='S' and relname like '%availability%'`), '0', 'availability tables own no sequence');
  equal(await run(`select string_agg(relname, ',' order by relname) from pg_class where relkind='S' and relnamespace='public'::regnamespace`),
    'audit_events_id_seq,care_journey_events_id_seq', 'no sequence was added by availability or this delta');
  equal(await run(`select count(*) from information_schema.columns where table_schema='public' and table_name like 'care_technician_availability%' and (is_identity='YES' or column_default like 'nextval%')`), '0', 'no identity/serial availability column');
  equal(await run(`select string_agg(conname||':'||contype::text, ',' order by conname) from pg_constraint where conname in ('care_technician_availability_exception_windows_instant_order','care_technician_availability_exception_windows_no_overlap','care_technician_availability_windows_no_overlap')`),
    'care_technician_availability_exception_windows_instant_order:c,care_technician_availability_exception_windows_no_overlap:x,care_technician_availability_windows_no_overlap:x', 'overlap exclusion + instant-order constraints exist');
  equal(await run(`select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='x'`), '2', 'the two exclusion constraints are the only ones in public');

  // ---- Check function authorisation and validation. --------------------------------------------------
  const a = await seedTechnician();
  await fail(`begin; set local role authenticated; select public.care_technician_availability_check(${quote(a.expert)}::uuid, now(), now() + interval '1 hour'); commit`, 'permission denied');
  await fail(`begin; set local role anon; select public.care_technician_availability_check(${quote(a.expert)}::uuid, now(), now() + interval '1 hour'); commit`, 'permission denied');
  await fail(`select public.care_technician_availability_check(${quote(a.expert)}::uuid, now(), now() + interval '1 hour')`, 'FORBIDDEN');
  for (const [starts, ends] of [['null', 'now()'], ['now()', 'null'], ['now()', 'now()'], ["now() + interval '1 hour'", 'now()'], ["'infinity'::timestamptz", "'infinity'::timestamptz"], ['now()', "'infinity'::timestamptz"]]) {
    await fail(service(`select public.care_technician_availability_check(${quote(a.expert)}::uuid, ${starts}, ${ends})`), 'VALIDATION_FAILED');
  }
  await fail(service(`select public.care_technician_availability_check(null, now(), now() + interval '1 hour')`), 'VALIDATION_FAILED');

  // ---- Behaviour. -------------------------------------------------------------------------------------
  equal(await verifyUnpublished(), 'AVAILABILITY_REQUIRED', 'unpublished schedule');
  async function verifyUnpublished() { return verdict(a.expert, adl('2027-01-04 09:00'), adl('2027-01-04 10:00')); }
  // Monday 09:00-17:00; Sunday 02:00-04:00 and 04:30-06:00 (DST-sensitive weekly rows).
  const weekly = [
    { weekday: 1, starts_at: '09:00', ends_at: '17:00' },
    { weekday: 7, starts_at: '02:00', ends_at: '04:00' },
    { weekday: 7, starts_at: '04:30', ends_at: '06:00' },
  ];
  equal(JSON.parse((await run(replaceSql(a.user, body(weekly), 0))).split('\n')[0]).revision, 1);
  equal(await verdict(a.expert, adl('2027-01-04 09:00'), adl('2027-01-04 10:00')), 'AVAILABLE', 'inside a Monday window');
  equal(await verdict(a.expert, adl('2027-01-04 09:00'), adl('2027-01-04 17:00')), 'AVAILABLE', 'window is half-open: may end exactly at its end');
  equal(await verdict(a.expert, adl('2027-01-04 16:00'), adl('2027-01-04 17:00')), 'AVAILABLE', 'last hour');
  equal(await verdict(a.expert, adl('2027-01-04 08:59'), adl('2027-01-04 10:00')), 'SLOT_UNAVAILABLE', 'starts before the window');
  equal(await verdict(a.expert, adl('2027-01-04 16:00'), adl('2027-01-04 17:01')), 'SLOT_UNAVAILABLE', 'ends after the window');
  equal(await verdict(a.expert, adl('2027-01-05 09:00'), adl('2027-01-05 10:00')), 'SLOT_UNAVAILABLE', 'Tuesday has no window');
  equal(await verdict(a.expert, adl('2027-01-04 23:00'), adl('2027-01-05 01:00')), 'SLOT_UNAVAILABLE', 'crossing local midnight is never inside one window');
  equal(await verdict(a.expert, `('2027-01-03 22:30:00+00')::timestamptz`, `('2027-01-04 00:00:00+00')::timestamptz`), 'AVAILABLE', 'Adelaide summer (+10:30) date is taken from the local calendar day, not UTC');
  equal(await verdict(a.expert, adl('2027-01-10 02:30'), adl('2027-01-10 03:30')), 'AVAILABLE', 'ordinary Sunday early window is fine');
  // DST: weekly wall times that are ambiguous (fall-back 2027-04-04 02:xx) or nonexistent
  // (spring-forward 2027-10-03 02:xx) fail closed; unambiguous windows the same day still work.
  equal(await verdict(a.expert, adl('2027-04-04 03:30'), adl('2027-04-04 03:45')), 'SLOT_UNAVAILABLE', 'fall-back: window starting at ambiguous 02:00 fails closed');
  equal(await verdict(a.expert, adl('2027-04-04 04:30'), adl('2027-04-04 05:30')), 'AVAILABLE', 'fall-back: unambiguous window the same day');
  equal(await verdict(a.expert, adl('2027-10-03 03:30'), adl('2027-10-03 03:45')), 'SLOT_UNAVAILABLE', 'spring-forward: window starting at nonexistent 02:00 fails closed');
  equal(await verdict(a.expert, adl('2027-10-03 04:30'), adl('2027-10-03 05:30')), 'AVAILABLE', 'spring-forward: unambiguous window the same day');
  equal(await verdict(a.expert, adl('2027-10-03 05:00'), adl('2027-10-03 06:00')), 'AVAILABLE', 'window ending on a clean wall time');

  // Exceptions replace the weekly rows for their date; [] closes the day; explicit offsets pick the repeated hour.
  const exceptions = [
    { date: '2027-01-11', windows: [] },
    { date: '2027-01-18', windows: [{ starts_at: '12:00', starts_at_offset: '+10:30', ends_at: '13:00', ends_at_offset: '+10:30' }] },
    { date: '2027-04-04', windows: [{ starts_at: '02:30', starts_at_offset: '+09:30', ends_at: '02:45', ends_at_offset: '+09:30' }] },
  ];
  equal(JSON.parse((await run(replaceSql(a.user, body(weekly, exceptions), 1))).split('\n')[0]).revision, 2);
  equal(await verdict(a.expert, adl('2027-01-11 09:00'), adl('2027-01-11 10:00')), 'SLOT_UNAVAILABLE', 'closed exception date beats the Monday window');
  equal(await verdict(a.expert, adl('2027-01-18 12:00'), adl('2027-01-18 13:00')), 'AVAILABLE', 'exception window');
  equal(await verdict(a.expert, adl('2027-01-18 09:00'), adl('2027-01-18 10:00')), 'SLOT_UNAVAILABLE', 'exception replaces, not extends, the Monday window');
  equal(await verdict(a.expert, off('2027-04-04 02:30:00', '+09:30'), off('2027-04-04 02:45:00', '+09:30')), 'AVAILABLE', 'explicit offset selects the second 02:30 on fall-back day');
  equal(await verdict(a.expert, off('2027-04-04 02:30:00', '+10:30'), off('2027-04-04 02:45:00', '+10:30')), 'SLOT_UNAVAILABLE', 'the first 02:30 is a different instant');
  equal(await verdict(a.expert, off('2027-04-04 02:30:00', '+09:30'), off('2027-04-04 02:50:00', '+09:30')), 'SLOT_UNAVAILABLE', 'beyond the exception window');
  equal(await verdict(a.expert, adl('2027-04-04 04:30'), adl('2027-04-04 05:30')), 'SLOT_UNAVAILABLE', 'exception date replaced the weekly Sunday windows');
  // Published-but-empty is a real statement (revision 1), not "never published".
  const b = await seedTechnician();
  equal(await verdict(b.expert, adl('2027-01-04 09:00'), adl('2027-01-04 10:00')), 'AVAILABILITY_REQUIRED', 'second expert unpublished');
  await run(replaceSql(b.user, body(), 0));
  equal(await verdict(b.expert, adl('2027-01-04 09:00'), adl('2027-01-04 10:00')), 'SLOT_UNAVAILABLE', 'published empty schedule is unavailable, not required');
  equal(await verdict(randomUUID(), adl('2027-01-04 09:00'), adl('2027-01-04 10:00')), 'AVAILABILITY_REQUIRED', 'unknown expert has no schedule');

  // ---- Read-only and lock-free: never waits on, nor makes anything wait on, schedule or journey rows. ----
  {
    const tag = `availability_delta_lock_${randomUUID().replaceAll('-', '')}`;
    const holder = result(`begin; select '${tag}'; select 1 from public.care_technician_availability where expert_id=${quote(a.expert)}::uuid for update;
      select 1 from public.care_journeys limit 1 for update; select pg_sleep(2); commit`);
    await waitForQuery(tag);
    await new Promise(resolve => setTimeout(resolve, 300));
    const started = Date.now();
    equal(await verdict(a.expert, adl('2027-01-04 09:00'), adl('2027-01-04 10:00')), 'AVAILABLE', 'check ran while the schedule row was locked');
    assert.ok(Date.now() - started < 1500, 'check must not wait behind row locks'); checks += 1;
    const finished = await holder;
    assert.equal(finished.error, undefined, finished.output); checks += 1;
  }

  // ---- Constraints at table level (direct service_role writes bypass the RPC's own validation). --------
  const c = await seedTechnician();
  await run(`insert into public.care_technician_availability(expert_id, revision) values (${quote(c.expert)}, 1)`);
  const win = (weekday, start, end) => service(`insert into public.care_technician_availability_windows(expert_id, weekday, starts_minute, ends_minute) values (${quote(c.expert)}, ${weekday}, ${start}, ${end})`);
  await run(win(1, 540, 720));
  await fail(win(1, 600, 780), 'care_technician_availability_windows_no_overlap');
  await fail(win(1, 540, 720), 'duplicate key');
  await fail(win(1, 500, 541), 'care_technician_availability_windows_no_overlap');
  await run(win(2, 540, 720));
  await run(win(1, 800, 900));
  await run(win(2, 720, 800));
  equal(await run(`select count(*) from public.care_technician_availability_windows where expert_id=${quote(c.expert)}`), '4', 'other weekday, disjoint and touching half-open windows are allowed');
  await run(`insert into public.care_technician_availability_exception_days(expert_id, exception_date) values (${quote(c.expert)}, '2027-04-04')`);
  const exw = (start, end, so, eo) => service(`insert into public.care_technician_availability_exception_windows(expert_id, exception_date, starts_minute, ends_minute, starts_offset, ends_offset) values (${quote(c.expert)}, '2027-04-04', ${start}, ${end}, '${so}', '${eo}')`);
  // Wall minutes overlap (130-160 vs 140-170) but the instants are an hour apart: both are real, disjoint periods.
  await run(exw(130, 160, '+10:30', '+10:30'));
  await run(exw(140, 170, '+09:30', '+09:30'));
  await fail(exw(175, 190, '+10:30', '+09:30'), 'care_technician_availability_exception_windows_no_overlap'); // instants overlap although wall minutes do not
  await fail(exw(150, 165, '+09:30', '+10:30'), 'care_technician_availability_exception_windows_instant_order'); // ends before it starts
  await fail(exw(130, 160, '+10:30', '+10:30'), 'duplicate key');
  equal(await run(`select count(*) from public.care_technician_availability_exception_windows where expert_id=${quote(c.expert)}`), '2');

  // Through #76's RPC the new constraints now reject the two inputs it used to accept silently.
  const d = await seedTechnician();
  const one = (so, eo, s, e) => body([], [{ date: '2027-04-04', windows: [{ starts_at: s, starts_at_offset: so, ends_at: e, ends_at_offset: eo }] }]);
  await fail(replaceSql(d.user, one('+09:30', '+10:30', '02:30', '02:45'), 0), 'care_technician_availability_exception_windows_instant_order');
  await fail(replaceSql(d.user, body([], [{ date: '2027-04-04', windows: [
    { starts_at: '02:00', starts_at_offset: '+09:30', ends_at: '02:50', ends_at_offset: '+09:30' },
    { starts_at: '02:55', starts_at_offset: '+10:30', ends_at: '03:10', ends_at_offset: '+09:30' }] }]), 0), 'care_technician_availability_exception_windows_no_overlap');
  equal(await run(`select count(*) from public.care_technician_availability where expert_id=${quote(d.expert)}`), '0', 'rejected replacement rolled back, including the revision row');
  equal(JSON.parse((await run(replaceSql(d.user, one('+10:30', '+09:30', '02:30', '02:45'), 0))).split('\n')[0]).revision, 1, 'valid fall-back window (first 02:30 to second 02:45) is still accepted');
  equal(await verdict(d.expert, off('2027-04-04 02:30:00', '+10:30'), off('2027-04-04 02:45:00', '+09:30')), 'AVAILABLE', 'window spanning the repeated hour covers its real 1h15m');
  equal(await verdict(d.expert, off('2027-04-04 02:50:00', '+10:30'), off('2027-04-04 02:10:00', '+09:30')), 'AVAILABLE', 'sub-slot inside it');

  // ---- Authority: FOR SHARE on expert + account before the advisory waits, role re-checked after. -------
  {
    const lockSql = (name, hold) => `begin; select pg_advisory_xact_lock(hashtextextended(${quote(name)}, 0)); select pg_sleep(${hold}); commit`;
    const waitingOnLock = async tag => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await run(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event_type='Lock' and query like ${quote(`%${tag}%`)}`) === '1') { checks += 1; return; }
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`${tag} never waited on a lock`);
    };
    const tagFor = label => `availability_delta_${label}_${randomUUID().replaceAll('-', '')}`;
    const writeWith = (tech, key, tag) => result(replaceSql(tech.user, body([{ weekday: 1, starts_at: '09:00', ends_at: '12:00' }]), 0, key).replace(/; commit;$/, `; commit; /* ${tag} */`));
    // lock: which advisory lock the holder parks the write behind. change: the authority change committed during the wait.
    const scenario = async ({ label, lock, change, blocked, expected }) => {
      const tech = await seedTechnician();
      const key = randomUUID();
      const tag = tagFor(label);
      const lockName = lock === 'schedule' ? `care:technician-availability-schedule:${tech.expert}` : `care:technician-availability:${tech.user}:${key}`;
      const holder = result(lockSql(lockName, 1.5) + `; select '${tag}_holder'`);
      await waitForQuery(`${tag}_holder`);
      await new Promise(resolve => setTimeout(resolve, 200));
      const write = writeWith(tech, key, tag);
      await waitingOnLock(tag);
      let changed = null;
      if (change) {
        changed = result(`${change(tech)} /* ${tag}_change */`);
        if (blocked) {
          await waitingOnLock(`${tag}_change`);   // the revoker is queued behind the write's FOR SHARE
          assert.equal(await run(`select count(*) from public.care_technician_availability where expert_id=${quote(tech.expert)}`), '0'); checks += 1;
        }
      }
      const [heldResult, writeResult, changeResult] = await Promise.all([holder, write, changed]);
      assert.equal(heldResult.error, undefined, heldResult.output); checks += 1;
      if (changeResult) { assert.equal(changeResult.error, undefined, changeResult.output); checks += 1; }
      const rows = await run(`select count(*) from public.care_technician_availability where expert_id=${quote(tech.expert)}`);
      if (expected) {
        assert.ok(`${writeResult.error || ''}${writeResult.output || ''}`.includes(expected), `${label}: ${writeResult.output}`); checks += 1;
        equal(rows, '0', `${label}: nothing written`);
      } else {
        assert.equal(writeResult.error, undefined, `${label}: ${writeResult.output}`); checks += 1;
        equal(rows, '1', `${label}: write committed before the queued authority change`);
      }
      return tech;
    };
    const roleDelete = tech => `delete from public.user_roles where user_id=${quote(tech.user)}`;
    await scenario({ label: 'control', lock: 'schedule' });
    // The role is not row-locked: it is re-checked after the advisory locks and the write is refused.
    await scenario({ label: 'role_schedule', lock: 'schedule', change: roleDelete, expected: 'FORBIDDEN' });
    await scenario({ label: 'role_idempotency', lock: 'idempotency', change: roleDelete, expected: 'FORBIDDEN' });
    // Account and expert rows are share-locked before the wait: the change queues until the write ends.
    const deactivated = await scenario({ label: 'account_deactivate', lock: 'schedule', blocked: true,
      change: tech => `update public.care_technician_accounts set active=false where user_id=${quote(tech.user)}` });
    equal(await run(`select active from public.care_technician_accounts where user_id=${quote(deactivated.user)}`), 'f', 'queued account deactivation applied after the write');
    await scenario({ label: 'expert_deactivate', lock: 'schedule', blocked: true,
      change: tech => `update public.care_experts set active=false where id=${quote(tech.expert)}` });
    const deleted = await scenario({ label: 'account_delete', lock: 'idempotency', blocked: true,
      change: tech => `delete from public.care_technician_accounts where user_id=${quote(tech.user)}` });
    equal(await run(`select count(*) from public.care_technician_accounts where user_id=${quote(deleted.user)}`), '0', 'queued account deletion applied after the write');
    // Already-revoked authority is refused before any lock, new key or replay.
    {
      const tech = await seedTechnician();
      const key = randomUUID();
      await run(replaceSql(tech.user, body(), 0, key));
      await run(`update public.care_technician_accounts set active=false where user_id=${quote(tech.user)}`);
      await fail(replaceSql(tech.user, body(), 0, key), 'NOT_FOUND');
      await fail(replaceSql(tech.user, body(), 1), 'NOT_FOUND');
    }

    // ---- No deadlock with care_technician_admin_command (expert KEY SHARE, then advisory care:technician-link). ----
    const admin = randomUUID();
    await run(`insert into auth.users(id) values (${quote(admin)}); insert into public.user_roles(user_id, role) values (${quote(admin)}, 'admin')`);
    const bind = tech => service(`select public.care_technician_admin_command(${quote(admin)}::uuid, ${quote(randomUUID())}::uuid, 'bind_technician', null, ${quote(JSON.stringify({ expert_id: tech.expert, user_id: tech.user }))}::jsonb)`);
    // (a) admin bind parked while holding expert KEY SHARE + the global link advisory lock: the availability write is not blocked.
    {
      const tech = await seedTechnician();
      const tag = tagFor('admin_first');
      const parked = result(bind(tech).replace(/; commit;$/, `; select pg_sleep(1.5); commit; /* ${tag} */`));
      await waitForQuery(tag);
      await new Promise(resolve => setTimeout(resolve, 200));
      const started = Date.now();
      const written = await result(replaceSql(tech.user, body([{ weekday: 2, starts_at: '09:00', ends_at: '12:00' }]), 0));
      assert.equal(written.error, undefined, written.output); checks += 1;
      assert.ok(Date.now() - started < 1200, 'availability write must not wait behind the admin bind'); checks += 1;
      const parkedResult = await parked;
      assert.equal(parkedResult.error, undefined, parkedResult.output); checks += 1;
    }
    // (b) availability write parked behind its schedule advisory lock while holding FOR SHARE on expert + account: the admin bind is not blocked.
    {
      const tech = await seedTechnician();
      const tag = tagFor('availability_first');
      const holder = result(lockSql(`care:technician-availability-schedule:${tech.expert}`, 1.5) + `; select '${tag}_holder'`);
      await waitForQuery(`${tag}_holder`);
      await new Promise(resolve => setTimeout(resolve, 200));
      const write = writeWith(tech, randomUUID(), tag);
      await waitingOnLock(tag);
      const started = Date.now();
      const bound = await result(bind(tech));
      assert.equal(bound.error, undefined, bound.output); checks += 1;
      assert.ok(Date.now() - started < 1200, 'admin bind must not wait behind the availability write'); checks += 1;
      const [heldResult, writeResult] = await Promise.all([holder, write]);
      assert.equal(heldResult.error, undefined, heldResult.output); checks += 1;
      assert.equal(writeResult.error, undefined, writeResult.output); checks += 1;
      assert.ok(!/deadlock/i.test(`${bound.output}${writeResult.output}`)); checks += 1;
    }
  }

  // ---- Forward-only, on a scratch database that already holds data written under #76. -------------------
  const base = new URL(process.env.GARAGE_CARE_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new URL(base); admin.pathname = '/postgres';
  const psql = (url, args) => execFileSync('psql', [url.toString(), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const scratchDb = async (name, seed, work) => {
    const scratch = new URL(base); scratch.pathname = `/${name}`;
    psql(admin, ['-c', `drop database if exists ${name} with (force)`, '-c', `create database ${name}`]);
    try {
      const bootstrap = readFileSync('tests/integration/bootstrap.sql', 'utf8').split('\n').filter(line => !/^create role /.test(line)).join('\n');
      psql(scratch, ['-c', bootstrap]);
      for (const migration of migrations.filter(name => name !== delta)) psql(scratch, ['-f', `supabase/migrations/${migration}`]);
      const seedOn = text => psql(scratch, ['-c', text]);
      await seed(seedOn);
      return await work(scratch);
    } finally {
      psql(admin, ['-c', `drop database if exists ${name} with (force)`]);
    }
  };
  const seedScratch = async seedOn => {
    const t = await seedTechnician(async text => seedOn(text));
    const t2 = await seedTechnician(async text => seedOn(text));
    seedOn(replaceSql(t.user, body(weekly, exceptions), 0));
    return { t, t2 };
  };
  const snapshotSql = `
    select 'fn '||p.oid::regprocedure::text||' '||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace in ('public'::regnamespace,'auth'::regnamespace) and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
    union all select 'col '||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'') from information_schema.columns where table_schema='public'
    union all select 'con '||conrelid::regclass::text||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
    union all select 'pol '||tablename||' '||policyname||' '||cmd||' '||coalesce(qual,'')||' '||coalesce(with_check,'')||' '||roles::text from pg_policies where schemaname='public'
    union all select 'trg '||tgrelid::regclass::text||' '||tgname||' '||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace)
    union all select 'rls '||relname||' '||relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
    union all select 'tgrant '||table_name||' '||grantee||' '||privilege_type from information_schema.role_table_grants where table_schema='public'
    union all select 'fgrant '||routine_name||' '||grantee||' '||privilege_type from information_schema.routine_privileges where routine_schema='public' and grantee in ('anon','authenticated','service_role')
    union all select 'seq '||relname||' '||coalesce(relacl::text,'') from pg_class where relkind='S' and relnamespace='public'::regnamespace`;
  await scratchDb('skycar_availability_delta_scratch', async seedOn => { await seedScratch(seedOn); }, async scratch => {
    const before = psql(scratch, ['-c', snapshotSql]).split('\n').filter(Boolean);
    psql(scratch, ['-f', `supabase/migrations/${delta}`]);
    const after = psql(scratch, ['-c', snapshotSql]).split('\n').filter(Boolean);
    const beforeSet = new Set(before); const afterSet = new Set(after);
    equal(before.filter(row => !afterSet.has(row)).map(row => row.replace(/ [0-9a-f]{32}$/, '')), ['fn care_technician_replace_availability(uuid,uuid,integer,jsonb)'],
      'the only existing object that changes is the body of #76 care_technician_replace_availability; care_journey_command, every other function, column, constraint, policy, trigger, RLS flag, sequence and grant is unchanged');
    const additions = after.filter(row => !beforeSet.has(row));
    equal(additions.filter(row => !/availability/.test(row)), [], 'every addition belongs to availability');
    equal(additions.filter(row => row.startsWith('seq ')), [], 'no sequence added');
    equal(['fn ', 'con ', 'fgrant '].map(prefix => additions.filter(row => row.startsWith(prefix)).length), [4, 3, 3], 'adds three functions (+ the replaced body), three constraints and three service_role grants');
    equal(psql(scratch, ['-c', `select prosecdef::text||'|'||(proconfig=array['search_path=""'])::text||'|'||(select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges where routine_name='care_technician_replace_availability' and grantee in ('anon','authenticated','service_role','PUBLIC')) from pg_proc where proname='care_technician_replace_availability'`]).trim(), 'false|true|service_role', 'replaced function keeps SECURITY INVOKER, empty search_path and service_role-only execute');
    equal(psql(scratch, ['-c', `select count(*) from public.care_technician_availability_windows; select count(*) from public.care_technician_availability_exception_windows`]).trim().split('\n'), ['3', '2'], 'existing #76 rows survive');
    assert.throws(() => psql(scratch, ['-f', `supabase/migrations/${delta}`]), /already exists/); checks += 1;
  });
  // Rows written under #76's weaker validation block the delta with a readable preflight error and a full rollback.
  await scratchDb('skycar_availability_delta_bad_scratch', async seedOn => {
    const t = await seedTechnician(async text => seedOn(text));
    const t2 = await seedTechnician(async text => seedOn(text));
    seedOn(replaceSql(t.user, one('+09:30', '+10:30', '02:30', '02:45'), 0));
    seedOn(replaceSql(t2.user, body([], [{ date: '2027-04-04', windows: [
      { starts_at: '02:00', starts_at_offset: '+09:30', ends_at: '02:50', ends_at_offset: '+09:30' },
      { starts_at: '02:55', starts_at_offset: '+10:30', ends_at: '03:10', ends_at_offset: '+09:30' }] }]), 0));
  }, async scratch => {
    assert.throws(() => psql(scratch, ['-f', `supabase/migrations/${delta}`]),
      error => /AVAILABILITY_DELTA_PREFLIGHT_FAILED: 0 weekly overlaps, 1 inverted exception windows, 1 exception instant overlaps/.test(`${error.stderr}`)); checks += 1;
    equal(psql(scratch, ['-c', `select count(*) from pg_proc where proname like 'care_technician_availability_%instant' or proname='care_technician_availability_check'; select count(*) from pg_constraint where conname like 'care_technician_availability%no_overlap' or conname like '%instant_order'`]).trim().split('\n'), ['0', '0'], 'failed migration rolled back completely');
  });
  console.log(`PASS: ${checks} technician availability delta assertions: overlap constraints, DST-aware check seam, no new sequences, lock-free, forward-only with existing data (disposable database, not hosted Auth).`);
}
