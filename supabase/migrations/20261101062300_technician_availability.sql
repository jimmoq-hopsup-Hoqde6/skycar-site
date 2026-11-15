begin;

-- Technician-published Adelaide hours. This is not a second booking ledger.
-- Writes take only care:technician-availability advisory locks and this
-- schedule's own rows. They do not lock care_journeys or care:expert-capacity,
-- so a schedule edit cannot wait on or reorder confirmed-booking locks.
-- care_journeys remains the only capacity ledger.

create table public.care_technician_availability (
  expert_id uuid primary key references public.care_experts(id),
  timezone text not null default 'Australia/Adelaide' check (timezone = 'Australia/Adelaide'),
  revision integer not null check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.care_technician_availability_windows (
  expert_id uuid not null references public.care_technician_availability(expert_id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  starts_minute smallint not null check (starts_minute between 0 and 1424),
  ends_minute smallint not null check (ends_minute between 15 and 1439 and ends_minute >= starts_minute + 15),
  primary key (expert_id, weekday, starts_minute)
);

create table public.care_technician_availability_exception_days (
  expert_id uuid not null references public.care_technician_availability(expert_id) on delete cascade,
  exception_date date not null,
  primary key (expert_id, exception_date)
);

create table public.care_technician_availability_exception_windows (
  expert_id uuid not null,
  exception_date date not null,
  starts_minute smallint not null check (starts_minute between 0 and 1424),
  ends_minute smallint not null check (ends_minute between 15 and 1439 and ends_minute >= starts_minute + 15),
  starts_offset text not null check (starts_offset in ('+09:30', '+10:30')),
  ends_offset text not null check (ends_offset in ('+09:30', '+10:30')),
  primary key (expert_id, exception_date, starts_minute),
  foreign key (expert_id, exception_date)
    references public.care_technician_availability_exception_days(expert_id, exception_date) on delete cascade
);

create table public.care_technician_availability_commands (
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  expert_id uuid not null references public.care_experts(id),
  expected_revision integer not null check (expected_revision >= 0),
  payload jsonb not null,
  result jsonb not null,
  primary key (actor_id, idempotency_key)
);

alter table public.care_technician_availability enable row level security;
alter table public.care_technician_availability_windows enable row level security;
alter table public.care_technician_availability_exception_days enable row level security;
alter table public.care_technician_availability_exception_windows enable row level security;
alter table public.care_technician_availability_commands enable row level security;

revoke all on public.care_technician_availability, public.care_technician_availability_windows,
  public.care_technician_availability_exception_days, public.care_technician_availability_exception_windows,
  public.care_technician_availability_commands from public, anon, authenticated;
grant select, insert, update, delete on public.care_technician_availability, public.care_technician_availability_windows,
  public.care_technician_availability_exception_days, public.care_technician_availability_exception_windows,
  public.care_technician_availability_commands to service_role;

create function public.care_technician_availability_boundary_ok(p_date date, p_minute integer, p_offset text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $boundary$
declare
  local_ts timestamp;
  shift interval;
  instant timestamptz;
  adelaide_local timestamp;
  adelaide_offset interval;
begin
  if p_date is null or p_minute is null or p_minute not between 0 and 1439 or p_offset not in ('+09:30', '+10:30') then
    return false;
  end if;
  local_ts := p_date::timestamp + make_interval(mins => p_minute);
  shift := case p_offset when '+10:30' then interval '10 hours 30 minutes' else interval '9 hours 30 minutes' end;
  instant := (local_ts - shift) at time zone 'UTC';
  adelaide_local := timezone('Australia/Adelaide', instant);
  adelaide_offset := adelaide_local - (instant at time zone 'UTC');
  return adelaide_local = local_ts and adelaide_offset = shift;
end;
$boundary$;

create function public.care_technician_availability_minute(p_value text)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $minute$
begin
  if p_value is null or p_value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  return substring(p_value, 1, 2)::integer * 60 + substring(p_value, 4, 2)::integer;
end;
$minute$;

create function public.care_technician_availability_read(p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $read$
declare
  linked_expert uuid;
begin
  if current_user <> 'service_role' or p_actor is null
    or not exists(select 1 from public.user_roles where user_id = p_actor and role = 'technician') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  select a.expert_id into linked_expert
  from public.care_technician_accounts a
  join public.care_experts e on e.id = a.expert_id
  where a.user_id = p_actor and a.active and e.active;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  return (
    select jsonb_build_object(
      'timezone', 'Australia/Adelaide',
      'revision', coalesce(s.revision, 0),
      'weekly_windows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'weekday', w.weekday,
          'starts_at', lpad((w.starts_minute / 60)::text, 2, '0') || ':' || lpad((w.starts_minute % 60)::text, 2, '0'),
          'ends_at', lpad((w.ends_minute / 60)::text, 2, '0') || ':' || lpad((w.ends_minute % 60)::text, 2, '0')
        ) order by w.weekday, w.starts_minute)
        from public.care_technician_availability_windows w where w.expert_id = linked_expert
      ), '[]'::jsonb),
      'exceptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'date', to_char(d.exception_date, 'YYYY-MM-DD'),
          'windows', coalesce((
            select jsonb_agg(jsonb_build_object(
              'starts_at', lpad((x.starts_minute / 60)::text, 2, '0') || ':' || lpad((x.starts_minute % 60)::text, 2, '0'),
              'starts_at_offset', x.starts_offset,
              'ends_at', lpad((x.ends_minute / 60)::text, 2, '0') || ':' || lpad((x.ends_minute % 60)::text, 2, '0'),
              'ends_at_offset', x.ends_offset
            ) order by x.starts_minute)
            from public.care_technician_availability_exception_windows x
            where x.expert_id = d.expert_id and x.exception_date = d.exception_date
          ), '[]'::jsonb)
        ) order by d.exception_date)
        from public.care_technician_availability_exception_days d where d.expert_id = linked_expert
      ), '[]'::jsonb),
      'evaluated_at', clock_timestamp()
    )
    from (select linked_expert as id) actor
    left join public.care_technician_availability s on s.expert_id = actor.id
  );
end;
$read$;

create function public.care_technician_replace_availability(
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

revoke all on function public.care_technician_availability_boundary_ok(date, integer, text),
  public.care_technician_availability_minute(text),
  public.care_technician_availability_read(uuid),
  public.care_technician_replace_availability(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.care_technician_availability_boundary_ok(date, integer, text),
  public.care_technician_availability_minute(text),
  public.care_technician_availability_read(uuid),
  public.care_technician_replace_availability(uuid, uuid, integer, jsonb)
  to service_role;

commit;
