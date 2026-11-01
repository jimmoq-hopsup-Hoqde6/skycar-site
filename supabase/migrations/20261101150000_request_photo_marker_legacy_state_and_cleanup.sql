begin;

-- Follow-up to 20261101130000 (frozen; not edited). Four additions, all server-only,
-- none touching care_journey_command or its lock order:
--   1. marker_state: a marker is either 'recorded' (real manifest hash, set only
--      after Storage confirmed the set) or 'legacy_unknown' (photos are known to
--      exist, the hash is NOT known and is never invented: manifest_sha256 is NULL).
--   2. care_heal_request_photo_marker: quota-free heal. For a request with no marker it
--      looks at storage.objects metadata (a database read: no Storage API call, no body,
--      no quota table) and, only if a manifest and consecutive photo-1..N objects exist,
--      writes a 'legacy_unknown' marker. care_record_request_photos then upgrades such a
--      row to 'recorded' when the identical set is presented (the upgrade is the call
--      that creates the recorded set, so it returns replayed:false like a first write);
--      a different set is still IDEMPOTENCY_CONFLICT because Storage objects are
--      write-once.
--   3. care_backfill_legacy_photo_markers: one-time, idempotent run of the same heal over
--      all existing objects (skipped with a NOTICE when storage.objects is unavailable;
--      the lazy heal on the next upload then applies).
--   4. Marker cleanup: after-delete triggers on care_requests and care_guest_requests
--      (cascades included) remove the marker row, plus a one-time sweep of markers
--      whose request no longer exists.
-- Browser roles keep no privilege on any new or changed object.

alter table public.care_request_photo_sets
  add column marker_state text not null default 'recorded'
    check (marker_state in ('recorded', 'legacy_unknown')),
  alter column manifest_sha256 drop not null,
  add constraint care_request_photo_sets_state_hash
    check ((marker_state = 'recorded') = (manifest_sha256 is not null));

-- Same signature, return shape and grants as 20261101130000. Now SECURITY DEFINER so
-- service_role keeps select+insert only (no update/delete privilege on the table) while
-- this function performs the legacy_unknown -> recorded upgrade. Lock order: the
-- request row is only KEY SHARE locked (blocks a concurrent delete, so no orphan marker
-- can be written), then the marker row; nothing else is locked.
create or replace function public.care_record_request_photos(
  p_request_id uuid,
  p_count integer,
  p_manifest_sha256 text,
  p_kind text default 'account'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  stored public.care_request_photo_sets;
  inserted boolean := false;
begin
  if p_request_id is null or p_count is null or p_count not between 1 and 3
    or p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_kind is null or p_kind not in ('account', 'guest') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if p_kind = 'account' then
    perform 1 from public.care_requests where id = p_request_id for key share;
  else
    perform 1 from public.care_guest_requests where id = p_request_id for key share;
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  insert into public.care_request_photo_sets(request_id, request_kind, photo_count, manifest_sha256, marker_state)
  values (p_request_id, p_kind, p_count, p_manifest_sha256, 'recorded')
  on conflict (request_id) do nothing
  returning * into stored;
  inserted := found;
  if not inserted then
    select * into stored from public.care_request_photo_sets where request_id = p_request_id for update;
    if stored.request_kind <> p_kind then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if stored.marker_state = 'legacy_unknown' then
      -- The count of a legacy row is only what was observed in Storage; the caller's
      -- verified count replaces it. The hash comes from the identical set just presented.
      update public.care_request_photo_sets
      set marker_state = 'recorded', manifest_sha256 = p_manifest_sha256, photo_count = p_count
      where request_id = p_request_id;
      inserted := true; -- the upgrade creates the recorded set: the caller that did it keeps its quota slot
    elsif stored.photo_count <> p_count or stored.manifest_sha256 <> p_manifest_sha256 then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;
  return jsonb_build_object('request_id', p_request_id, 'photo_count', p_count, 'replayed', not inserted);
end;
$$;

-- What Storage metadata shows for one request: the number of photos (1..3) when a manifest
-- and consecutive photo-1..photo-N objects of the private-media bucket exist, else NULL.
-- Metadata only: file contents are not read, so nothing here can yield a hash.
create or replace function public.care_observed_request_photo_count(p_request_id uuid, p_kind text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  prefix text;
  has_manifest boolean;
  slots integer;
  leaves text[];
begin
  if p_request_id is null or p_kind is null or p_kind not in ('account', 'guest') then
    return null;
  end if;
  if to_regclass('storage.objects') is null or not has_table_privilege(current_user, 'storage.objects', 'select') then
    return null;
  end if;
  prefix := case p_kind when 'account' then 'care-requests/' else 'guest-requests/' end || p_request_id::text || '/';
  select coalesce(bool_or(leaf = 'manifest.json'), false),
    (count(*) filter (where leaf ~ '^photo-[0-9]+$'))::integer,
    array_agg(leaf order by leaf) filter (where leaf ~ '^photo-[0-9]+$')
  into has_manifest, slots, leaves
  from (
    select substr(o.name, length(prefix) + 1) as leaf
    from storage.objects o
    where o.bucket_id = 'private-media' and starts_with(o.name, prefix)
  ) observed;
  if has_manifest and slots between 1 and 3 and leaves = (array['photo-1', 'photo-2', 'photo-3'])[1:slots] then
    return slots;
  end if;
  return null;
end;
$$;

-- Quota-free heal. Never reads or writes the upload quota table and never touches Storage
-- itself. Returns the request's marker if it has one (a recorded marker is never changed),
-- else writes a 'legacy_unknown' marker (NULL hash) when Storage metadata shows a complete
-- set, else {"state":"none"}.
create or replace function public.care_heal_request_photo_marker(
  p_request_id uuid,
  p_kind text default 'account'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  stored public.care_request_photo_sets;
  observed integer;
  inserted boolean := false;
begin
  if p_request_id is null or p_kind is null or p_kind not in ('account', 'guest') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if p_kind = 'account' then
    perform 1 from public.care_requests where id = p_request_id for key share;
  else
    perform 1 from public.care_guest_requests where id = p_request_id for key share;
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  select * into stored from public.care_request_photo_sets where request_id = p_request_id;
  if not found then
    observed := public.care_observed_request_photo_count(p_request_id, p_kind);
    if observed is null then
      return jsonb_build_object('state', 'none', 'healed', false);
    end if;
    insert into public.care_request_photo_sets(request_id, request_kind, photo_count, manifest_sha256, marker_state)
    values (p_request_id, p_kind, observed, null, 'legacy_unknown')
    on conflict (request_id) do nothing
    returning * into stored;
    inserted := found;
    if not inserted then
      select * into stored from public.care_request_photo_sets where request_id = p_request_id;
    end if;
  end if;
  if stored.request_kind <> p_kind then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  return jsonb_build_object('request_id', p_request_id, 'photo_count', stored.photo_count,
    'state', stored.marker_state, 'manifest_sha256', stored.manifest_sha256, 'healed', inserted);
end;
$$;

-- One-time backfill: the same heal for every request that has objects. Idempotent (existing
-- markers are never touched). Returns how many legacy markers it wrote.
create or replace function public.care_backfill_legacy_photo_markers() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  result jsonb;
  added integer := 0;
begin
  if to_regclass('storage.objects') is null then
    raise notice 'care_backfill_legacy_photo_markers: storage.objects is not available; skipped (lazy heal applies)';
    return 0;
  end if;
  if not has_table_privilege(current_user, 'storage.objects', 'select') then
    raise notice 'care_backfill_legacy_photo_markers: no select on storage.objects; skipped (lazy heal applies)';
    return 0;
  end if;
  for candidate in
    select distinct
      case split_part(o.name, '/', 1) when 'care-requests' then 'account' else 'guest' end as kind,
      split_part(o.name, '/', 2)::uuid as request_id
    from storage.objects o
    where o.bucket_id = 'private-media'
      and o.name ~ '^(care-requests|guest-requests)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  loop
    begin
      result := public.care_heal_request_photo_marker(candidate.request_id, candidate.kind);
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'NOT_FOUND' then raise; end if; -- Storage objects of a request that no longer exists
      continue;
    end;
    if (result ->> 'healed')::boolean then
      added := added + 1;
    end if;
  end loop;
  return added;
end;
$$;

-- Cleanup. The marker table spans two parent tables, so a foreign key cannot cover it;
-- these triggers delete the marker with its request (direct deletes and FK cascades).
-- The delete is a leaf write after the request row is already locked, so it adds no
-- lock-order edge. The function is executable by no browser or service role.
create or replace function public.care_delete_request_photo_marker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.care_request_photo_sets where request_id = old.id and request_kind = tg_argv[0];
  return null;
end;
$$;

create trigger care_requests_photo_marker_cleanup
  after delete on public.care_requests
  for each row execute function public.care_delete_request_photo_marker('account');
create trigger care_guest_requests_photo_marker_cleanup
  after delete on public.care_guest_requests
  for each row execute function public.care_delete_request_photo_marker('guest');

-- One-time sweep of markers left behind by requests deleted before these triggers existed.
delete from public.care_request_photo_sets m
where (m.request_kind = 'account' and not exists (select 1 from public.care_requests r where r.id = m.request_id))
   or (m.request_kind = 'guest' and not exists (select 1 from public.care_guest_requests g where g.id = m.request_id));

revoke all on function public.care_record_request_photos(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.care_record_request_photos(uuid, integer, text, text) to service_role;
revoke all on function public.care_heal_request_photo_marker(uuid, text) from public, anon, authenticated;
grant execute on function public.care_heal_request_photo_marker(uuid, text) to service_role;
revoke all on function public.care_observed_request_photo_count(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.care_backfill_legacy_photo_markers() from public, anon, authenticated, service_role;
revoke all on function public.care_delete_request_photo_marker() from public, anon, authenticated, service_role;

select public.care_backfill_legacy_photo_markers();

commit;
