begin;

-- Forward-only delta on top of 20261101062300_technician_availability.sql (PR #76).
-- It adds the items below and changes none of #76's tables or grants (it replaces one #76 function body, see 4):
--   1. database-level overlap rejection on the window tables;
--   2. care_technician_availability_check(), the read-only seam the quote /
--      selection / confirmation commands can call later;
--   3. nothing for sequences: #76 created no identity/serial columns, so there is
--      no sequence to revoke (asserted in tests/integration/technician-availability-delta.acceptance.mjs);
--   4. care_technician_replace_availability re-checks role and expert link after its locks.
-- care_journey_command and every existing migration are untouched. The check never
-- reads or locks care_journeys: confirmed-booking overlap stays with the existing
-- atomic confirmation check and the care:expert-capacity advisory lock.

-- btree_gist gives uuid/smallint equality inside GiST exclusion constraints.
do $$
begin
  if exists(select 1 from pg_namespace where nspname='extensions') then
    create extension if not exists btree_gist with schema extensions;
  else
    create extension if not exists btree_gist;
  end if;
end $$;

-- Pure arithmetic instant for an exception row: wall date + minute minus its stored
-- explicit Adelaide offset. IMMUTABLE on purpose (no time-zone database lookup, so the
-- result can never change underneath an index); #76 already validated every stored
-- offset against Adelaide's rules at write time.
create function public.care_technician_availability_offset_instant(p_date date, p_minute integer, p_offset text)
returns timestamptz
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_date is null or p_minute is null then null
    when p_offset = '+09:30' then timezone('UTC', p_date::timestamp + p_minute * interval '1 minute' - interval '570 minutes')
    when p_offset = '+10:30' then timezone('UTC', p_date::timestamp + p_minute * interval '1 minute' - interval '630 minutes')
  end;
$$;

-- Instant for a weekly wall time. Weekly rows carry no offset, so the wall time must
-- map to exactly one instant: a nonexistent (spring-forward) or ambiguous (fall-back)
-- wall time returns NULL and the window then fails closed instead of being shifted.
create function public.care_technician_availability_wall_instant(p_local timestamp)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  with candidate as (
    select timezone('UTC', p_local - o * interval '1 minute') as instant
    from unnest(array[570, 630]) as o
  ), valid as (
    select instant from candidate where timezone('Australia/Adelaide', instant) = p_local
  )
  select case when (select count(*) from valid) = 1 then (select instant from valid) end;
$$;

-- Preflight: fail with a readable message (and roll the whole migration back) instead of
-- an opaque constraint error if rows written under #76's weaker validation conflict.
do $$
declare
  weekly_overlaps integer;
  inverted integer;
  instant_overlaps integer;
begin
  select count(*) into weekly_overlaps
  from public.care_technician_availability_windows a
  join public.care_technician_availability_windows b
    on b.expert_id = a.expert_id and b.weekday = a.weekday and b.starts_minute > a.starts_minute
   and int4range(a.starts_minute::integer, a.ends_minute::integer) && int4range(b.starts_minute::integer, b.ends_minute::integer);
  select count(*) into inverted
  from public.care_technician_availability_exception_windows w
  where public.care_technician_availability_offset_instant(w.exception_date, w.ends_minute, w.ends_offset)
     <= public.care_technician_availability_offset_instant(w.exception_date, w.starts_minute, w.starts_offset);
  select count(*) into instant_overlaps
  from public.care_technician_availability_exception_windows a
  join public.care_technician_availability_exception_windows b
    on b.expert_id = a.expert_id and b.exception_date = a.exception_date and b.starts_minute > a.starts_minute
  where public.care_technician_availability_offset_instant(a.exception_date, a.ends_minute, a.ends_offset)
      > public.care_technician_availability_offset_instant(a.exception_date, a.starts_minute, a.starts_offset)
    and public.care_technician_availability_offset_instant(b.exception_date, b.ends_minute, b.ends_offset)
      > public.care_technician_availability_offset_instant(b.exception_date, b.starts_minute, b.starts_offset)
    and tstzrange(public.care_technician_availability_offset_instant(a.exception_date, a.starts_minute, a.starts_offset),
                  public.care_technician_availability_offset_instant(a.exception_date, a.ends_minute, a.ends_offset))
     && tstzrange(public.care_technician_availability_offset_instant(b.exception_date, b.starts_minute, b.starts_offset),
                  public.care_technician_availability_offset_instant(b.exception_date, b.ends_minute, b.ends_offset));
  if weekly_overlaps + inverted + instant_overlaps > 0 then
    raise exception 'AVAILABILITY_DELTA_PREFLIGHT_FAILED: % weekly overlaps, % inverted exception windows, % exception instant overlaps; correct the rows, then re-apply',
      weekly_overlaps, inverted, instant_overlaps;
  end if;
end $$;

-- Weekly windows: recurring wall-clock minutes, no DST in play, so a plain minute-range
-- exclusion is exact. Half-open [start,end): touching windows are allowed here (the RPC
-- keeps rejecting them, so this is never weaker than #76's own rule).
alter table public.care_technician_availability_windows
  add constraint care_technician_availability_windows_no_overlap
  exclude using gist (
    expert_id with =,
    weekday with =,
    int4range(starts_minute::integer, ends_minute::integer) with &&
  );

-- Exception windows carry explicit offsets, so overlap is judged on real instants.
-- Wall-minute overlap alone is wrong on a fall-back date in both directions (it rejects
-- the repeated hour that is really two disjoint periods, and it accepts windows whose
-- instants overlap). A window must also end after it starts in real time: #76's RPC
-- accepts, e.g., 02:30 +09:30 -> 02:45 +10:30 on a fall-back date, which ends 45 minutes
-- BEFORE it starts.
alter table public.care_technician_availability_exception_windows
  add constraint care_technician_availability_exception_windows_instant_order
  check (
    public.care_technician_availability_offset_instant(exception_date, ends_minute, ends_offset)
    > public.care_technician_availability_offset_instant(exception_date, starts_minute, starts_offset)
  );
alter table public.care_technician_availability_exception_windows
  add constraint care_technician_availability_exception_windows_no_overlap
  exclude using gist (
    expert_id with =,
    tstzrange(
      public.care_technician_availability_offset_instant(exception_date, starts_minute, starts_offset),
      public.care_technician_availability_offset_instant(exception_date, ends_minute, ends_offset)
    ) with &&
  );

-- Read-only enforcement seam. Not wired into any journey command by this migration.
--   AVAILABILITY_REQUIRED: the expert has never published a schedule (no revision row).
--   SLOT_UNAVAILABLE:      a schedule exists but [p_starts, p_ends] is not inside one window
--                          (no window, closed exception date, crosses local midnight, or the
--                          window boundary is nonexistent/ambiguous in Adelaide).
--   AVAILABLE:             one window on the Adelaide date of p_starts covers it entirely.
-- A dated exception replaces the weekly windows for its date (no windows = closed). Windows
-- are half-open, so ending exactly at a window's end is allowed. Plain SELECTs only: no
-- advisory lock, no row lock, no write, no read of care_journeys.
create function public.care_technician_availability_check(p_expert_id uuid, p_starts timestamptz, p_ends timestamptz)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  local_day date;
  covered boolean;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_expert_id is null or p_starts is null or p_ends is null
    or not isfinite(p_starts) or not isfinite(p_ends) or p_ends <= p_starts then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if not exists(select 1 from public.care_technician_availability where expert_id = p_expert_id) then
    return 'AVAILABILITY_REQUIRED';
  end if;
  local_day := (p_starts at time zone 'Australia/Adelaide')::date;
  if exists(select 1 from public.care_technician_availability_exception_days
            where expert_id = p_expert_id and exception_date = local_day) then
    select exists(
      select 1 from public.care_technician_availability_exception_windows w
      where w.expert_id = p_expert_id and w.exception_date = local_day
        and public.care_technician_availability_offset_instant(w.exception_date, w.starts_minute, w.starts_offset) <= p_starts
        and public.care_technician_availability_offset_instant(w.exception_date, w.ends_minute, w.ends_offset) >= p_ends
    ) into covered;
  else
    select exists(
      select 1 from public.care_technician_availability_windows w
      where w.expert_id = p_expert_id and w.weekday = extract(isodow from local_day)::integer
        and public.care_technician_availability_wall_instant(local_day::timestamp + w.starts_minute * interval '1 minute') <= p_starts
        and public.care_technician_availability_wall_instant(local_day::timestamp + w.ends_minute * interval '1 minute') >= p_ends
    ) into covered;
  end if;
  return case when covered then 'AVAILABLE' else 'SLOT_UNAVAILABLE' end;
end;
$$;

-- #76's care_technician_replace_availability checks the technician role before taking its
-- advisory locks and reads the expert link before the schedule lock, and never re-checks.
-- Same signature, same body, same grants; the only change is the two re-checks marked "Delta".
create or replace function public.care_technician_replace_availability(
  p_actor uuid,
  p_key uuid,
  p_expected_revision integer,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $replace$
declare
  prior public.care_technician_availability_commands;
  linked_expert uuid;
  current_revision integer := 0;
  new_revision integer;
  result jsonb;
  weekly jsonb;
  dated jsonb;
  item jsonb;
  window_item jsonb;
  last_day integer := null;
  last_end integer := null;
  last_date date := null;
  start_minute integer;
  end_minute integer;
  adelaide_today date;
  weekly_count integer := 0;
  exception_count integer := 0;
begin
  if current_user <> 'service_role' or p_actor is null
    or not exists(select 1 from public.user_roles where user_id = p_actor and role = 'technician') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_key is null or p_expected_revision is null or p_expected_revision < 0
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if octet_length(p_payload::text) > 393216 then
    raise exception using errcode = 'P0001', message = 'PAYLOAD_TOO_LARGE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('care:technician-availability:' || p_actor::text || ':' || p_key::text, 0));
  -- Delta: re-check the role after the idempotency lock (a concurrent request with the same
  -- key may have held it while the role was revoked). #76 only checked before the lock.
  if not exists(select 1 from public.user_roles where user_id = p_actor and role = 'technician') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  select * into prior from public.care_technician_availability_commands
  where actor_id = p_actor and idempotency_key = p_key;
  select a.expert_id into linked_expert
  from public.care_technician_accounts a
  join public.care_experts e on e.id = a.expert_id
  where a.user_id = p_actor and a.active and e.active;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if found and prior.actor_id is not null then
    if prior.expert_id <> linked_expert or prior.expected_revision <> p_expected_revision or prior.payload <> p_payload then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return prior.result || jsonb_build_object('replayed', true);
  end if;
  if p_payload - array['timezone', 'weekly_windows', 'exceptions'] <> '{}'::jsonb
    or not (p_payload ?& array['timezone', 'weekly_windows', 'exceptions'])
    or p_payload->>'timezone' is distinct from 'Australia/Adelaide'
    or jsonb_typeof(p_payload->'weekly_windows') <> 'array'
    or jsonb_typeof(p_payload->'exceptions') <> 'array'
    or jsonb_array_length(p_payload->'weekly_windows') > 28
    or jsonb_array_length(p_payload->'exceptions') > 366 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  adelaide_today := (clock_timestamp() at time zone 'Australia/Adelaide')::date;
  weekly := p_payload->'weekly_windows';
  for item in select value from jsonb_array_elements(weekly) loop
    if jsonb_typeof(item) <> 'object' or item - array['weekday', 'starts_at', 'ends_at'] <> '{}'::jsonb
      or not (item ?& array['weekday', 'starts_at', 'ends_at'])
      or jsonb_typeof(item->'weekday') <> 'number' or jsonb_typeof(item->'starts_at') <> 'string'
      or jsonb_typeof(item->'ends_at') <> 'string' or item->>'weekday' !~ '^[1-7]$' then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    start_minute := public.care_technician_availability_minute(item->>'starts_at');
    end_minute := public.care_technician_availability_minute(item->>'ends_at');
    if end_minute < start_minute + 15 or start_minute > 1424 or end_minute > 1439 then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    if last_day is not null and ((item->>'weekday')::integer < last_day
      or ((item->>'weekday')::integer = last_day and start_minute <= last_end)) then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    if last_day is distinct from (item->>'weekday')::integer then last_end := null; end if;
    last_day := (item->>'weekday')::integer;
    last_end := end_minute;
    weekly_count := weekly_count + 1;
  end loop;
  dated := p_payload->'exceptions';
  for item in select value from jsonb_array_elements(dated) loop
    if jsonb_typeof(item) <> 'object' or item - array['date', 'windows'] <> '{}'::jsonb
      or not (item ?& array['date', 'windows']) or jsonb_typeof(item->'date') <> 'string'
      or jsonb_typeof(item->'windows') <> 'array' or item->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
      or to_char((item->>'date')::date, 'YYYY-MM-DD') <> item->>'date'
      or (item->>'date')::date < adelaide_today
      or (item->>'date')::date > (adelaide_today + interval '18 months')::date
      or jsonb_array_length(item->'windows') > 8
      or (last_date is not null and (item->>'date')::date <= last_date) then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    last_end := null;
    for window_item in select value from jsonb_array_elements(item->'windows') loop
      if jsonb_typeof(window_item) <> 'object'
        or window_item - array['starts_at', 'starts_at_offset', 'ends_at', 'ends_at_offset'] <> '{}'::jsonb
        or not (window_item ?& array['starts_at', 'starts_at_offset', 'ends_at', 'ends_at_offset'])
        or jsonb_typeof(window_item->'starts_at') <> 'string' or jsonb_typeof(window_item->'ends_at') <> 'string'
        or window_item->>'starts_at_offset' not in ('+09:30', '+10:30')
        or window_item->>'ends_at_offset' not in ('+09:30', '+10:30') then
        raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
      end if;
      start_minute := public.care_technician_availability_minute(window_item->>'starts_at');
      end_minute := public.care_technician_availability_minute(window_item->>'ends_at');
      if end_minute < start_minute + 15 or start_minute > 1424 or end_minute > 1439
        or (last_end is not null and start_minute <= last_end)
        or not public.care_technician_availability_boundary_ok((item->>'date')::date, start_minute, window_item->>'starts_at_offset')
        or not public.care_technician_availability_boundary_ok((item->>'date')::date, end_minute, window_item->>'ends_at_offset') then
        raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
      end if;
      last_end := end_minute;
    end loop;
    last_date := (item->>'date')::date;
    exception_count := exception_count + 1;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('care:technician-availability-schedule:' || linked_expert::text, 0));
  select revision into current_revision from public.care_technician_availability where expert_id = linked_expert for update;
  if not found then current_revision := 0; end if;
  -- Delta: re-check authority AFTER the schedule advisory lock and row lock. Waiting on either
  -- can take arbitrarily long; role revocation or account/expert deactivation committed during
  -- the wait must stop the write (each statement sees a fresh READ COMMITTED snapshot).
  if not exists(select 1 from public.user_roles where user_id = p_actor and role = 'technician') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if not exists(
    select 1 from public.care_technician_accounts a
    join public.care_experts e on e.id = a.expert_id
    where a.user_id = p_actor and a.expert_id = linked_expert and a.active and e.active) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if current_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'REVISION_CONFLICT';
  end if;
  if current_revision = 0 then
    insert into public.care_technician_availability(expert_id, timezone, revision) values (linked_expert, 'Australia/Adelaide', 1);
    new_revision := 1;
  else
    update public.care_technician_availability
      set revision = revision + 1, updated_at = clock_timestamp()
      where expert_id = linked_expert
      returning revision into new_revision;
  end if;
  delete from public.care_technician_availability_exception_windows where expert_id = linked_expert;
  delete from public.care_technician_availability_exception_days where expert_id = linked_expert;
  delete from public.care_technician_availability_windows where expert_id = linked_expert;
  insert into public.care_technician_availability_windows(expert_id, weekday, starts_minute, ends_minute)
  select linked_expert, (value->>'weekday')::integer,
    public.care_technician_availability_minute(value->>'starts_at'),
    public.care_technician_availability_minute(value->>'ends_at')
  from jsonb_array_elements(weekly);
  insert into public.care_technician_availability_exception_days(expert_id, exception_date)
  select linked_expert, (value->>'date')::date from jsonb_array_elements(dated);
  insert into public.care_technician_availability_exception_windows(
    expert_id, exception_date, starts_minute, ends_minute, starts_offset, ends_offset)
  select linked_expert, (dated_item.value->>'date')::date,
    public.care_technician_availability_minute(window_row.value->>'starts_at'),
    public.care_technician_availability_minute(window_row.value->>'ends_at'),
    window_row.value->>'starts_at_offset', window_row.value->>'ends_at_offset'
  from jsonb_array_elements(dated) as dated_item
  cross join lateral jsonb_array_elements(dated_item.value->'windows') as window_row;
  result := jsonb_build_object('revision', new_revision, 'replayed', false);
  insert into public.audit_events(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_actor, 'care.technician_availability_replace', 'care_expert', linked_expert::text,
    jsonb_build_object('revision', new_revision, 'weekly_windows', weekly_count, 'exceptions', exception_count));
  insert into public.care_technician_availability_commands(
    actor_id, idempotency_key, expert_id, expected_revision, payload, result)
  values (p_actor, p_key, linked_expert, p_expected_revision, p_payload, result);
  return result;
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
end;
$replace$;

revoke all on function public.care_technician_replace_availability(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.care_technician_replace_availability(uuid, uuid, integer, jsonb)
  to service_role;

revoke all on function public.care_technician_availability_offset_instant(date, integer, text),
  public.care_technician_availability_wall_instant(timestamp),
  public.care_technician_availability_check(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.care_technician_availability_offset_instant(date, integer, text),
  public.care_technician_availability_wall_instant(timestamp),
  public.care_technician_availability_check(uuid, timestamptz, timestamptz)
  to service_role;

commit;
