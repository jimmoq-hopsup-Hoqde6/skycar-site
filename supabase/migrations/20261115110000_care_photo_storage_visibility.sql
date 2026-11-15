begin;

-- Gap audit #3 (15 Nov 2026): hosted Storage readability. Forward-only; 20261101150000 is not edited.
--
-- care_observed_request_photo_count (150000) answered NULL ("unknown") without a word when the
-- function owner could not read storage.objects, so the lazy heal returned {"state":"none"} exactly as
-- if no photos existed. It also only checked privileges: on hosted Supabase storage.objects has RLS on
-- (owner supabase_storage_admin, not forced; 8 Nov gate capture), and a definer owner that is not the
-- table owner, not superuser and without BYPASSRLS sees only rows its policies allow. The one policy
-- recorded there (private_media_read_own) is for `authenticated`, so such an owner would see zero rows
-- and the heal would silently find nothing, even with USAGE and SELECT granted.
--
-- This file:
--   * adds care_photo_storage_visibility() (SECURITY INVOKER, so it judges the definer function that
--     calls it, i.e. its owner; executable only by that owner): one ordered decision:
--       no_schema | no_usage | no_relation | no_select | rls_hidden | readable
--     rls_hidden = RLS applies to this role (RLS on; not superuser, not BYPASSRLS, not the table owner
--     unless forced) and no permissive, unconditional (qual true) SELECT/ALL policy covers it, or a
--     restrictive SELECT/ALL policy covers it. Catalog reads only (pg_namespace, pg_class, pg_roles,
--     pg_policy); it never reads storage.objects rows.
--   * re-creates care_observed_request_photo_count to raise a WARNING (CARE_PHOTO_STORAGE_UNREADABLE)
--     and return NULL for anything but readable (it used to return NULL silently, and could undercount
--     under RLS);
--   * re-creates care_heal_request_photo_marker to add "storage": <reason> to its {"state":"none"}
--     answer when Storage was unreadable (NOTICE/WARNING are not visible through PostgREST);
--   * re-creates care_backfill_legacy_photo_markers to skip with a NOTICE when RLS hides rows.
-- Same signatures, owners and grants (CREATE OR REPLACE keeps them). The three functions must keep one
-- owner (the migration role), which is also the only role that may execute the visibility helper. No lock is added; the heal's lock
-- order is unchanged. This migration does not run the backfill and reads no Storage rows when applied.

create function public.care_photo_storage_visibility() returns text
language plpgsql stable security invoker set search_path = '' as $$
declare
  me oid := (select oid from pg_catalog.pg_roles where rolname = current_user);
  is_super boolean;
  can_bypass boolean;
  rls_on boolean;
  rls_forced boolean;
  owner_oid oid;
begin
  if to_regnamespace('storage') is null then return 'no_schema'; end if;
  if not has_schema_privilege(current_user, 'storage', 'usage') then return 'no_usage'; end if;
  if to_regclass('storage.objects') is null then return 'no_relation'; end if;
  if not has_table_privilege(current_user, 'storage.objects', 'select') then return 'no_select'; end if;
  select r.rolsuper, r.rolbypassrls into is_super, can_bypass from pg_catalog.pg_roles r where r.oid = me;
  select c.relrowsecurity, c.relforcerowsecurity, c.relowner into rls_on, rls_forced, owner_oid
    from pg_catalog.pg_class c where c.oid = 'storage.objects'::regclass;
  if not rls_on or is_super or can_bypass then return 'readable'; end if;
  if pg_catalog.pg_has_role(me, owner_oid, 'USAGE') and not rls_forced then return 'readable'; end if;
  -- RLS applies. Readable only if some permissive policy shows every row and no restrictive one narrows it.
  if exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'storage.objects'::regclass and not p.polpermissive and p.polcmd in ('r', '*')
         and (0::oid = any(p.polroles) or exists (select 1 from unnest(p.polroles) pr where pg_catalog.pg_has_role(me, pr, 'USAGE'))))
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'storage.objects'::regclass and p.polpermissive and p.polcmd in ('r', '*')
         and pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
         and (0::oid = any(p.polroles) or exists (select 1 from unnest(p.polroles) pr where pg_catalog.pg_has_role(me, pr, 'USAGE')))) then
    return 'rls_hidden';
  end if;
  return 'readable';
end;
$$;
revoke all on function public.care_photo_storage_visibility() from public, anon, authenticated, service_role;

create or replace function public.care_observed_request_photo_count(p_request_id uuid, p_kind text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  prefix text;
  has_manifest boolean;
  slots integer;
  leaves text[];
  visibility text;
begin
  if p_request_id is null or p_kind is null or p_kind not in ('account', 'guest') then
    return null;
  end if;
  -- 20261115110000: one ordered visibility decision (see care_photo_storage_visibility). Anything but
  -- 'readable' is still "unknown" (NULL), but no longer silent: a WARNING names the role and the reason.
  visibility := public.care_photo_storage_visibility();
  if visibility <> 'readable' then
    raise warning 'CARE_PHOTO_STORAGE_UNREADABLE: role % cannot read storage.objects (%); photo count unknown, no marker healed', current_user, visibility
      using hint = 'Grant USAGE on schema storage and SELECT on storage.objects to the owner of the care photo functions, and make sure row-level security does not hide rows from it (BYPASSRLS or an unconditional SELECT policy).';
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


create or replace function public.care_heal_request_photo_marker(
  p_request_id uuid,
  p_kind text default 'account'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  stored public.care_request_photo_sets;
  observed integer;
  inserted boolean := false;
  storage_state text;
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
      -- 20261115110000: say why when Storage metadata could not be read (app-visible; NOTICEs are not).
      storage_state := public.care_photo_storage_visibility();
      return jsonb_build_object('state', 'none', 'healed', false)
        || case when storage_state <> 'readable' then jsonb_build_object('storage', storage_state) else '{}'::jsonb end;
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


create or replace function public.care_backfill_legacy_photo_markers() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  result jsonb;
  added integer := 0;
begin
  -- Prerequisite, checked explicitly and one step at a time (each later call raises 42501 when an
  -- earlier privilege is missing): schema storage exists, the migration role has USAGE on it, then
  -- storage.objects exists and the role can SELECT it. Any miss is a NOTICE and a skipped backfill, never
  -- a failed migration: the lazy heal on the next upload applies instead. Hosted Supabase `postgres`
  -- has USAGE on storage (verified on staging 1 Nov 2026); if a project's role does not, grant it and
  -- run `select public.care_backfill_legacy_photo_markers();` again (idempotent).
  if to_regnamespace('storage') is null then
    raise notice 'care_backfill_legacy_photo_markers: schema storage does not exist; skipped (lazy heal applies)';
    return 0;
  end if;
  if not has_schema_privilege(current_user, 'storage', 'usage') then
    raise notice 'care_backfill_legacy_photo_markers: role % has no USAGE on schema storage; skipped (lazy heal applies; grant usage on schema storage to that role and re-run the function)', current_user;
    return 0;
  end if;
  if to_regclass('storage.objects') is null then
    raise notice 'care_backfill_legacy_photo_markers: storage.objects is not available; skipped (lazy heal applies)';
    return 0;
  end if;
  if not has_table_privilege(current_user, 'storage.objects', 'select') then
    raise notice 'care_backfill_legacy_photo_markers: role % has no SELECT on storage.objects; skipped (lazy heal applies)', current_user;
    return 0;
  end if;
  -- 20261115110000: SELECT is not enough when row-level security hides rows from this role.
  if public.care_photo_storage_visibility() = 'rls_hidden' then
    raise notice 'care_backfill_legacy_photo_markers: row-level security on storage.objects hides rows from role %; skipped (lazy heal applies; give that role BYPASSRLS or an unconditional SELECT policy and re-run the function)', current_user;
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


revoke all on function public.care_observed_request_photo_count(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.care_backfill_legacy_photo_markers() from public, anon, authenticated, service_role;
revoke all on function public.care_heal_request_photo_marker(uuid, text) from public, anon, authenticated;
grant execute on function public.care_heal_request_photo_marker(uuid, text) to service_role;

commit;
