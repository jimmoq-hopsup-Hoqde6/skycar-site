import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// 20261115110000_care_photo_storage_visibility.sql (gap audit #3). A local MODEL of hosted Supabase
// Storage, built inside one transaction and rolled back, on disposable PostgreSQL only:
//   * storage.objects owned by supabase_storage_admin, RLS enabled and not forced (8 Nov gate capture);
//   * the one recorded policy, private_media_read_own: SELECT to authenticated, own folder only;
//   * the care photo functions owned by a non-superuser "migration role", with or without USAGE on
//     storage, SELECT on storage.objects and BYPASSRLS (the hosted value of rolbypassrls for the real
//     owner is NOT known here; see /workspace/audit/proposed-devops-storage-readability-check.md).
// It is not evidence of hosted behaviour.
const FUNCTIONS = ['public.care_photo_storage_visibility()', 'public.care_observed_request_photo_count(uuid, text)',
  'public.care_heal_request_photo_marker(uuid, text)', 'public.care_backfill_legacy_photo_markers()'];

export async function verifyStorageReadability({sql, quote, database}) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const ok = (value, label) => { assert.ok(value, label); checks++; };
  const roles = ['supabase_storage_admin', 'photo_owner_plain', 'photo_owner_bypass'];
  sql(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
    if not exists (select 1 from pg_roles where rolname='photo_owner_plain') then create role photo_owner_plain nologin nosuperuser nobypassrls; end if;
    if not exists (select 1 from pg_roles where rolname='photo_owner_bypass') then create role photo_owner_bypass nologin nosuperuser bypassrls; end if;
  end $$;`);
  // One guest request with a complete two-photo set in Storage metadata, and no marker.
  const guest = randomUUID();
  sql(`insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(${quote(guest)},gen_random_uuid(),${quote('d'.repeat(64))},
      ${quote(JSON.stringify({name: 'Storage Model', phone: '0400000000', postcode: '5000', suburb: 'Adelaide', vehicle: 'Synthetic Mazda 3', service: 'repair', description: 'A synthetic storage model request'}))}::jsonb);
    insert into storage.objects(bucket_id,name) values ${['manifest.json', 'photo-1', 'photo-2'].map(leaf => `('private-media',${quote(`guest-requests/${guest}/${leaf}`)})`).join(',')};`);
  const markers = () => sql(`select count(*) from public.care_request_photo_sets where request_id=${quote(guest)}::uuid`);
  equal(markers(), '0');

  // Hosted-like model, then the functions handed to `owner`, then `body`; always rolled back.
  const hosted = ({owner, usage = true, select = true, policies = ''}) => `
    alter table storage.objects owner to supabase_storage_admin;
    alter table storage.objects enable row level security;
    drop policy if exists private_media_read_own on storage.objects;
    create policy private_media_read_own on storage.objects for select to authenticated
      using (bucket_id = 'private-media' and (storage.foldername(name))[1] = (auth.uid())::text);
    ${policies}
    revoke all on schema storage from ${owner}; revoke all on storage.objects from ${owner};
    ${usage ? `grant usage on schema storage to ${owner};` : ''}
    ${select ? `grant select on storage.objects to ${owner};` : ''}
    grant create, usage on schema public to ${owner};
    grant all on all tables in schema public to ${owner};
    -- Hosted: the migration role owns the public tables as well as the functions, so public RLS does not
    -- apply to it; only storage.objects (owned by supabase_storage_admin) is in question.
    do $o$ declare t record; begin
      for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I owner to %I', t.tablename, '${owner}');
      end loop; end $o$;
    ${FUNCTIONS.map(fn => `alter function ${fn} owner to ${owner};`).join('\n')}`;
  const run = (setup, body) => {
    const out = spawnSync('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `begin; ${setup}; ${body}; rollback;`], {encoding: 'utf8'});
    assert.equal(out.status, 0, out.stderr); checks++;
    return {rows: out.stdout.trim().split('\n'), stderr: out.stderr};
  };
  const healAsApp = `set local role service_role; select public.care_heal_request_photo_marker(${quote(guest)}::uuid, 'guest'); reset role;
    select count(*) from public.care_request_photo_sets where request_id=${quote(guest)}::uuid`;
  const unreadable = (label, setup, reason) => {
    const out = run(setup, healAsApp);
    equal(JSON.parse(out.rows[0]), {state: 'none', healed: false, storage: reason}, `${label}: the heal says why`);
    equal(out.rows[1], '0', `${label}: nothing healed`);
    ok(new RegExp(`WARNING:\\s+CARE_PHOTO_STORAGE_UNREADABLE: role \\w+ cannot read storage.objects \\(${reason}\\)`).test(out.stderr), `${label}: a WARNING names the reason: ${out.stderr}`);
  };
  const readable = (label, setup) => {
    const out = run(setup, healAsApp);
    const result = JSON.parse(out.rows[0]);
    equal([result.state, result.healed, result.photo_count, result.manifest_sha256, out.rows[1]], ['legacy_unknown', true, 2, null, '1'], `${label}: heals the set`);
    equal(/CARE_PHOTO_STORAGE_UNREADABLE/.test(out.stderr), false, `${label}: no warning`);
  };

  // 1. Grants present but RLS hides every row from a plain (no BYPASSRLS) owner: before this migration the
  //    heal returned {"state":"none"} silently, as if there were no photos.
  unreadable('USAGE+SELECT, RLS on, no BYPASSRLS', hosted({owner: 'photo_owner_plain'}), 'rls_hidden');
  //    The hazard itself: that role sees no rows at all, with no error (what 150000 would have counted).
  const seen = owner => run(hosted({owner}), `set local role ${owner}; select count(*) from storage.objects where name like ${quote(`guest-requests/${guest}/%`)}`).rows[0];
  equal(seen('photo_owner_plain'), '0', 'RLS silently hides the objects from a plain owner');
  equal(seen('photo_owner_bypass'), '3', 'BYPASSRLS sees all three objects');
  // 2. The same grants with BYPASSRLS (what a hosted `postgres` owner needs): works.
  readable('USAGE+SELECT+BYPASSRLS', hosted({owner: 'photo_owner_bypass'}));
  // 3. No BYPASSRLS, but an unconditional permissive SELECT policy for the owner: works.
  readable('USAGE+SELECT+policy using(true)', hosted({owner: 'photo_owner_plain', policies: 'create policy care_photo_owner_read on storage.objects for select to photo_owner_plain using (true);'}));
  // 4. ... narrowed by a restrictive policy: not trusted (a partial view could undercount).
  unreadable('permissive true + restrictive', hosted({owner: 'photo_owner_plain', policies: `create policy care_photo_owner_read on storage.objects for select to photo_owner_plain using (true);
    create policy care_photo_owner_narrow on storage.objects as restrictive for select to photo_owner_plain using (bucket_id = 'other');`}), 'rls_hidden');
  // 5. A policy that is conditional (not "true") does not count either.
  unreadable('conditional policy only', hosted({owner: 'photo_owner_plain', policies: `create policy care_photo_owner_read on storage.objects for select to photo_owner_plain using (bucket_id = 'private-media');`}), 'rls_hidden');
  // 6. Missing grants, in the order the function checks them.
  unreadable('no USAGE on schema storage', hosted({owner: 'photo_owner_bypass', usage: false}), 'no_usage');
  unreadable('USAGE, no SELECT on storage.objects', hosted({owner: 'photo_owner_bypass', select: false}), 'no_select');
  unreadable('no storage schema', 'alter schema storage rename to storage_hidden', 'no_schema');
  // 7. Table owner (RLS not forced) reads; forced RLS on the owner does not.
  readable('owner of storage.objects', `${hosted({owner: 'photo_owner_plain'})}; alter table storage.objects owner to photo_owner_plain`);
  unreadable('owner with FORCE ROW LEVEL SECURITY', `${hosted({owner: 'photo_owner_plain'})}; alter table storage.objects owner to photo_owner_plain; alter table storage.objects force row level security`, 'rls_hidden');
  // 8. The local harness default (superuser owner, no model) is readable.
  equal(sql('select public.care_photo_storage_visibility()'), 'readable');

  // 9. Backfill: skips with a NOTICE (never a silent 0) under RLS; works with BYPASSRLS.
  const backfillPlain = run(hosted({owner: 'photo_owner_plain'}), 'select public.care_backfill_legacy_photo_markers()');
  equal(backfillPlain.rows[0], '0');
  ok(/NOTICE:\s+care_backfill_legacy_photo_markers: row-level security on storage.objects hides rows from role photo_owner_plain; skipped/.test(backfillPlain.stderr), backfillPlain.stderr);
  const backfillBypass = run(hosted({owner: 'photo_owner_bypass'}), `select public.care_backfill_legacy_photo_markers(); select count(*) from public.care_request_photo_sets where request_id=${quote(guest)}::uuid`);
  ok(Number(backfillBypass.rows[0]) >= 1, `backfill heals with BYPASSRLS: ${backfillBypass.rows}`);
  equal(backfillBypass.rows[1], '1');
  const backfillNoUsage = run(hosted({owner: 'photo_owner_bypass', usage: false}), 'select public.care_backfill_legacy_photo_markers()');
  ok(/has no USAGE on schema storage; skipped/.test(backfillNoUsage.stderr), 'the 150000 NOTICE text is unchanged');

  // 10. Everything was rolled back; grants and ownership are as installed.
  equal(markers(), '0');
  equal(sql("select pg_get_userbyid(relowner) from pg_class where oid='storage.objects'::regclass"), sql('select current_user'));
  equal(sql(`select string_agg(pg_get_userbyid(proowner), ',') from pg_proc where oid in (${FUNCTIONS.map(fn => `${quote(fn)}::regprocedure`).join(',')})`).split(',').every(o => o === sql('select current_user')), true);
  const fn = 'public.care_photo_storage_visibility()';
  equal(sql(`select string_agg(r||':'||has_function_privilege(r,${quote(fn)},'execute')::text,',' order by r) from unnest(array['anon','authenticated','service_role']) r`),
    'anon:false,authenticated:false,service_role:false');
  equal(sql(`select has_function_privilege('service_role','public.care_heal_request_photo_marker(uuid,text)','execute')::text||has_function_privilege('authenticated','public.care_heal_request_photo_marker(uuid,text)','execute')::text`), 'truefalse');
  sql(`delete from storage.objects where name like ${quote(`guest-requests/${guest}/%`)}; delete from public.care_guest_requests where id=${quote(guest)}::uuid;
    ${roles.slice(1).map(r => `drop owned by ${r}; drop role ${r};`).join(' ')}`);
  console.log(`PASS: ${checks} storage readability checks on a local hosted-Storage model (RLS, USAGE/SELECT, BYPASSRLS, heal and backfill).`);
}
