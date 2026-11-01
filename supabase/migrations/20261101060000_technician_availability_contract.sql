begin;

-- Technician availability contract backend (issue #53). Forward-only: this file
-- only ADDS objects; no existing table, function, policy or migration is altered.
--
-- Boundaries
--   * care_journeys remains the ONLY confirmed-booking/capacity ledger. These
--     tables hold working-hour intentions; they never reserve capacity.
--   * No care_journey_command / care_technician_* RPC, quote, invitation or
--     booking-ledger row is modified. Wiring availability into quote submission,
--     selection or confirmation is a separate reviewed delta; the read-only
--     care_technician_availability_check() below is the integration seam.
--
-- Lock order of care_technician_availability_replace (the only writer)
--   0. plain reads only: user_roles (technician role)
--   1. care_experts + care_technician_accounts ... FOR SHARE  (same first step and
--      mode as care_technician_job_command; nothing takes these rows exclusively
--      inside a command path, so no wait cycle is possible)
--   2. advisory xact lock 'care:technician-availability:<actor>:<key>'  (new
--      namespace, never taken by any existing RPC)
--   3. care_technician_availability header row ... FOR UPDATE (new table)
--   4. rows of the new windows/exceptions/commands tables (new tables)
--   5. audit_events INSERT (append only, takes no row locks other RPCs wait on)
--   It NEVER locks vehicles, care_requests, care_journeys, care_reviewed_quotes,
--   care_journey_commands or the 'care:expert-capacity:<id>' advisory lock, so it
--   cannot join a cycle with the canonical actor/key -> vehicle -> request ->
--   journey -> expert-capacity order, nor with the journey-before-request order
--   some commands use. Read functions take no locks (MVCC snapshot reads).
--
-- Access model (same server-mediated posture as the rest of Care): browser roles
-- get NO write access and NO RPC access. authenticated may SELECT only its own
-- schedule rows through RLS; every write goes through the service_role-only RPC,
-- which receives the verified actor, rechecks role + expert link, and is
-- idempotent per (actor,key). Functions are SECURITY INVOKER with search_path ''
-- except care_technician_owns_expert (see its comment).

-- btree_gist gives uuid/smallint/date equality inside GiST exclusion constraints.
do $$
begin
  if exists(select 1 from pg_namespace where nspname='extensions') then
    create extension if not exists btree_gist with schema extensions;
  else
    create extension if not exists btree_gist;
  end if;
end $$;

create table public.care_technician_availability (
  expert_id uuid primary key references public.care_experts(id),
  timezone text not null default 'Australia/Adelaide' check (timezone = 'Australia/Adelaide'),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- A dated exception REPLACES the recurring windows for its date; zero windows
-- means a day off. Rows older than today are ignored by readers and dropped by
-- the next replace.
create table public.care_technician_availability_exceptions (
  expert_id uuid not null references public.care_technician_availability(expert_id),
  exception_date date not null,
  primary key (expert_id, exception_date)
);

-- Half-open [start,end) local wall-clock minutes; end may be 1440 (24:00, end only).
-- Weekly rows: weekday set, no offsets (expanded per date, DST-aware).
-- Exception rows: exception_date set, explicit Adelaide UTC offsets in minutes.
create table public.care_technician_availability_windows (
  id bigint generated always as identity primary key,
  expert_id uuid not null references public.care_technician_availability(expert_id),
  weekday smallint check (weekday between 1 and 7),
  exception_date date,
  start_minute smallint not null check (start_minute between 0 and 1425),
  end_minute smallint not null check (end_minute between 15 and 1440),
  start_offset_minutes smallint check (start_offset_minutes in (570,630)),
  end_offset_minutes smallint check (end_offset_minutes in (570,630)),
  check (end_minute - start_minute >= 15),
  check ((weekday is null) <> (exception_date is null)),
  check (
    (exception_date is null and start_offset_minutes is null and end_offset_minutes is null) or
    (exception_date is not null and start_offset_minutes is not null and end_offset_minutes is not null)
  ),
  foreign key (expert_id, exception_date)
    references public.care_technician_availability_exceptions(expert_id, exception_date),
  constraint care_availability_weekly_no_overlap exclude using gist (
    expert_id with =, weekday with =, int4range(start_minute::int, end_minute::int, '[)') with &&
  ) where (weekday is not null),
  constraint care_availability_exception_no_overlap exclude using gist (
    expert_id with =, exception_date with =, int4range(start_minute::int, end_minute::int, '[)') with &&
  ) where (exception_date is not null)
);

create table public.care_technician_availability_commands (
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, idempotency_key)
);

alter table public.care_technician_availability enable row level security;
alter table public.care_technician_availability_exceptions enable row level security;
alter table public.care_technician_availability_windows enable row level security;
alter table public.care_technician_availability_commands enable row level security;

revoke all on public.care_technician_availability,public.care_technician_availability_exceptions,
  public.care_technician_availability_windows,public.care_technician_availability_commands
  from public,anon,authenticated;
grant select,insert,update on public.care_technician_availability,
  public.care_technician_availability_commands to service_role;
grant select,insert,delete on public.care_technician_availability_exceptions,
  public.care_technician_availability_windows to service_role;
grant usage,select on sequence public.care_technician_availability_windows_id_seq to service_role;
-- Read-only access for the owning technician; there is deliberately no write grant
-- or write policy for any browser role, and the command ledger is never exposed.
grant select on public.care_technician_availability,public.care_technician_availability_exceptions,
  public.care_technician_availability_windows to authenticated;

-- SECURITY DEFINER is necessary here only because care_technician_accounts has no
-- browser privileges: the policy must test the caller's own link without granting
-- table access. It is stable, search_path-fixed, reads only caller-derived
-- auth.uid() rows, and returns a boolean about the caller alone.
create function public.care_technician_owns_expert(p_expert_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.care_technician_accounts a
    join public.user_roles r on r.user_id = a.user_id and r.role = 'technician'
    where a.expert_id = p_expert_id and a.user_id = auth.uid() and a.active);
$$;
revoke all on function public.care_technician_owns_expert(uuid) from public,anon,authenticated;
grant execute on function public.care_technician_owns_expert(uuid) to authenticated,service_role;

create policy care_availability_owner_select on public.care_technician_availability
  for select to authenticated using ((select public.care_technician_owns_expert(expert_id)));
create policy care_availability_exceptions_owner_select on public.care_technician_availability_exceptions
  for select to authenticated using ((select public.care_technician_owns_expert(expert_id)));
create policy care_availability_windows_owner_select on public.care_technician_availability_windows
  for select to authenticated using ((select public.care_technician_owns_expert(expert_id)));

-- Pure helpers (no table access, no locks).
create function public.care_availability_minutes(p_text text,p_allow_24 boolean) returns integer
language sql immutable set search_path = '' as $$
  select case
    when p_text ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then substr(p_text,1,2)::int*60+substr(p_text,4,2)::int
    when p_allow_24 and p_text = '24:00' then 1440
  end;
$$;

create function public.care_availability_offset_minutes(p_text text) returns integer
language sql immutable set search_path = '' as $$
  select case p_text when '+09:30' then 570 when '+10:30' then 630 end;
$$;

-- Absolute instant for an Adelaide wall time. With an explicit offset the offset
-- must be the one in force at that wall time. Without one the wall time must map
-- to exactly one instant: nonexistent (spring-forward) and ambiguous (fall-back)
-- wall times return NULL rather than being silently shifted.
create function public.care_availability_instant(p_local timestamp,p_offset integer) returns timestamptz
language sql stable set search_path = '' as $$
  with candidate as (
    select timezone('UTC', p_local - o * interval '1 minute') as instant
    from unnest(case when p_offset is null then array[570,630] else array[p_offset] end) o
  ), valid as (
    select instant from candidate where timezone('Australia/Adelaide', instant) = p_local
  )
  select case when (select count(*) from valid) = 1 then (select instant from valid) end;
$$;

revoke all on function public.care_availability_minutes(text,boolean),public.care_availability_offset_minutes(text),
  public.care_availability_instant(timestamp,integer) from public,anon,authenticated;
grant execute on function public.care_availability_minutes(text,boolean),public.care_availability_offset_minutes(text),
  public.care_availability_instant(timestamp,integer) to service_role;

create function public.care_technician_availability_read(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  expert public.care_experts; header public.care_technician_availability;
  today date := (clock_timestamp() at time zone 'Australia/Adelaide')::date;
  weekly jsonb; exceptions jsonb;
begin
  if current_user <> 'service_role' or p_actor is null or
    not exists(select 1 from public.user_roles where user_id=p_actor and role='technician') then
    raise exception using errcode='P0001',message='FORBIDDEN';
  end if;
  select e.* into expert from public.care_experts e join public.care_technician_accounts a on a.expert_id=e.id
    where a.user_id=p_actor and a.active and e.active;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  select * into header from public.care_technician_availability where expert_id=expert.id;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',w.weekday,
      'starts_at',to_char(make_interval(mins=>w.start_minute::int),'HH24:MI'),
      'ends_at',case when w.end_minute=1440 then '24:00' else to_char(make_interval(mins=>w.end_minute::int),'HH24:MI') end)
    order by w.weekday,w.start_minute),'[]'::jsonb) into weekly
    from public.care_technician_availability_windows w where w.expert_id=expert.id and w.weekday is not null;
  select coalesce(jsonb_agg(jsonb_build_object('date',x.exception_date,'windows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at',to_char(make_interval(mins=>w.start_minute::int),'HH24:MI'),
        'starts_at_offset',case w.start_offset_minutes when 570 then '+09:30' else '+10:30' end,
        'ends_at',case when w.end_minute=1440 then '24:00' else to_char(make_interval(mins=>w.end_minute::int),'HH24:MI') end,
        'ends_at_offset',case w.end_offset_minutes when 570 then '+09:30' else '+10:30' end) order by w.start_minute)
      from public.care_technician_availability_windows w
      where w.expert_id=x.expert_id and w.exception_date=x.exception_date),'[]'::jsonb))
    order by x.exception_date),'[]'::jsonb) into exceptions
    from public.care_technician_availability_exceptions x where x.expert_id=expert.id and x.exception_date>=today;
  return jsonb_build_object('timezone','Australia/Adelaide','revision',coalesce(header.revision,0),
    'weekly_windows',weekly,'exceptions',exceptions,'evaluated_at',clock_timestamp());
end; $$;

create function public.care_technician_availability_replace(p_actor uuid,p_key uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  expert public.care_experts; header public.care_technician_availability;
  prior public.care_technician_availability_commands;
  today date := (clock_timestamp() at time zone 'Australia/Adelaide')::date;
  at_time timestamptz; result jsonb;
  weekly jsonb; exceptions jsonb; item jsonb; win jsonb; windows jsonb;
  wd integer; prev_wd integer := 0; d date; prev_date date;
  s integer; e integer; so integer; eo integer; prev_start integer; prev_end integer;
  si timestamptz; ei timestamptz;
begin
  if current_user <> 'service_role' or p_actor is null or
    not exists(select 1 from public.user_roles where user_id=p_actor and role='technician') then
    raise exception using errcode='P0001',message='FORBIDDEN';
  end if;
  select ex.* into expert from public.care_experts ex join public.care_technician_accounts a on a.expert_id=ex.id
    where a.user_id=p_actor and a.active and ex.active for share of ex,a;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if p_key is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='BODY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('care:technician-availability:'||p_actor::text||':'||p_key::text,0));
  select * into prior from public.care_technician_availability_commands where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if prior.action <> 'replace' or prior.payload <> p_payload then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return prior.result || jsonb_build_object('replayed',true);
  end if;

  if not (p_payload ?& array['expected_revision','timezone','weekly_windows','exceptions']) or
    p_payload - array['expected_revision','timezone','weekly_windows','exceptions'] <> '{}'::jsonb or
    jsonb_typeof(p_payload->'expected_revision') is distinct from 'number' or
    jsonb_typeof(p_payload->'timezone') is distinct from 'string' or
    jsonb_typeof(p_payload->'weekly_windows') is distinct from 'array' or
    jsonb_typeof(p_payload->'exceptions') is distinct from 'array' or
    (p_payload->>'expected_revision') !~ '^[0-9]{1,9}$' then
    raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='BODY';
  end if;
  if p_payload->>'timezone' <> 'Australia/Adelaide' then
    raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='TIMEZONE'; end if;
  weekly := p_payload->'weekly_windows'; exceptions := p_payload->'exceptions';
  if jsonb_array_length(weekly) > 28 or jsonb_array_length(exceptions) > 366 then
    raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='TOO_MANY'; end if;

  -- Recurring windows: canonical order, [start,end) minutes, >=15 min, no overlap/adjacency per weekday.
  for win in select value from jsonb_array_elements(weekly) loop
    if jsonb_typeof(win) <> 'object' or not (win ?& array['weekday','starts_at','ends_at']) or
      win - array['weekday','starts_at','ends_at'] <> '{}'::jsonb or
      jsonb_typeof(win->'weekday') is distinct from 'number' or jsonb_typeof(win->'starts_at') is distinct from 'string' or
      jsonb_typeof(win->'ends_at') is distinct from 'string' or (win->>'weekday') !~ '^[1-7]$' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_SHAPE'; end if;
    wd := (win->>'weekday')::int;
    s := public.care_availability_minutes(win->>'starts_at',false);
    e := public.care_availability_minutes(win->>'ends_at',true);
    if s is null or e is null or e - s < 15 then
      raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_RANGE'; end if;
    if wd < prev_wd then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_ORDER'; end if;
    if wd = prev_wd then
      if s < prev_start then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_ORDER'; end if;
      if s < prev_end then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_OVERLAP'; end if;
      if s = prev_end then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_ADJACENT'; end if;
    end if;
    prev_wd := wd; prev_start := s; prev_end := e;
  end loop;

  -- Dated exceptions: real dates today..+18 months, unique and sorted, explicit matching offsets.
  for item in select value from jsonb_array_elements(exceptions) loop
    if jsonb_typeof(item) <> 'object' or not (item ?& array['date','windows']) or
      item - array['date','windows'] <> '{}'::jsonb or jsonb_typeof(item->'date') is distinct from 'string' or
      jsonb_typeof(item->'windows') is distinct from 'array' or (item->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='EXCEPTION_SHAPE'; end if;
    d := (item->>'date')::date;
    if to_char(d,'YYYY-MM-DD') <> item->>'date' or d < today or d > (today + interval '18 months')::date then
      raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='DATE_OUT_OF_RANGE'; end if;
    if prev_date is not null then
      if d = prev_date then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='DUPLICATE_DATE'; end if;
      if d < prev_date then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='EXCEPTION_ORDER'; end if;
    end if;
    prev_date := d; windows := item->'windows'; prev_start := null; prev_end := null;
    if jsonb_array_length(windows) > 8 then
      raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='TOO_MANY'; end if;
    for win in select value from jsonb_array_elements(windows) loop
      if jsonb_typeof(win) <> 'object' or not (win ?& array['starts_at','starts_at_offset','ends_at','ends_at_offset']) or
        win - array['starts_at','starts_at_offset','ends_at','ends_at_offset'] <> '{}'::jsonb or
        jsonb_typeof(win->'starts_at') is distinct from 'string' or jsonb_typeof(win->'starts_at_offset') is distinct from 'string' or
        jsonb_typeof(win->'ends_at') is distinct from 'string' or jsonb_typeof(win->'ends_at_offset') is distinct from 'string' then
        raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_SHAPE'; end if;
      s := public.care_availability_minutes(win->>'starts_at',false);
      e := public.care_availability_minutes(win->>'ends_at',true);
      so := public.care_availability_offset_minutes(win->>'starts_at_offset');
      eo := public.care_availability_offset_minutes(win->>'ends_at_offset');
      if s is null or e is null or so is null or eo is null or e - s < 15 then
        raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_RANGE'; end if;
      si := public.care_availability_instant(d::timestamp + s * interval '1 minute', so);
      ei := public.care_availability_instant(d::timestamp + e * interval '1 minute', eo);
      if si is null or ei is null then
        raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='OFFSET_MISMATCH'; end if;
      if ei - si < interval '15 minutes' then
        raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_RANGE'; end if;
      if prev_end is not null then
        if s < prev_start then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_ORDER'; end if;
        if s < prev_end then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_OVERLAP'; end if;
        if s = prev_end then raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='WINDOW_ADJACENT'; end if;
      end if;
      prev_start := s; prev_end := e;
    end loop;
  end loop;

  at_time := clock_timestamp();
  insert into public.care_technician_availability(expert_id) values(expert.id) on conflict(expert_id) do nothing;
  select * into header from public.care_technician_availability where expert_id=expert.id for update;
  if header.revision <> (p_payload->>'expected_revision')::int then
    raise exception using errcode='P0001',message='REVISION_CONFLICT'; end if;
  delete from public.care_technician_availability_windows where expert_id=expert.id;
  delete from public.care_technician_availability_exceptions where expert_id=expert.id;
  insert into public.care_technician_availability_exceptions(expert_id,exception_date)
    select expert.id,(x->>'date')::date from jsonb_array_elements(exceptions) x;
  insert into public.care_technician_availability_windows(expert_id,weekday,start_minute,end_minute)
    select expert.id,(w->>'weekday')::smallint,public.care_availability_minutes(w->>'starts_at',false),
      public.care_availability_minutes(w->>'ends_at',true) from jsonb_array_elements(weekly) w;
  insert into public.care_technician_availability_windows(expert_id,exception_date,start_minute,end_minute,start_offset_minutes,end_offset_minutes)
    select expert.id,(x->>'date')::date,public.care_availability_minutes(w->>'starts_at',false),
      public.care_availability_minutes(w->>'ends_at',true),public.care_availability_offset_minutes(w->>'starts_at_offset'),
      public.care_availability_offset_minutes(w->>'ends_at_offset')
    from jsonb_array_elements(exceptions) x cross join lateral jsonb_array_elements(x->'windows') w;
  update public.care_technician_availability set revision=revision+1,updated_at=at_time
    where expert_id=expert.id returning * into header;
  result := jsonb_build_object('revision',header.revision,'replayed',false);
  insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
    values(p_actor,'care.technician_availability_replace','care_expert',expert.id::text,
      jsonb_build_object('revision',header.revision,'weekly_windows',jsonb_array_length(weekly),'exceptions',jsonb_array_length(exceptions)));
  insert into public.care_technician_availability_commands(actor_id,idempotency_key,action,payload,result)
    values(p_actor,p_key,'replace',p_payload,result);
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception using errcode='P0001',message='VALIDATION_FAILED',detail='INVALID_VALUE';
end; $$;

-- Integration seam for quote/selection/confirmation (not wired in by this migration).
-- Read-only and lock-free. Returns AVAILABLE, AVAILABILITY_REQUIRED (nothing
-- published) or SLOT_UNAVAILABLE (outside windows, day off, or a window boundary
-- that is nonexistent/ambiguous in Adelaide). It never reads care_journeys: overlap
-- with confirmed work stays the job of the existing atomic confirmation check.
create function public.care_technician_availability_check(p_expert_id uuid,p_starts timestamptz,p_ends timestamptz)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare
  today date := (clock_timestamp() at time zone 'Australia/Adelaide')::date;
  d date; covered boolean;
begin
  if current_user <> 'service_role' then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_expert_id is null or p_starts is null or p_ends is null or not isfinite(p_starts) or not isfinite(p_ends) or p_ends <= p_starts then
    raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
  if not exists(select 1 from public.care_technician_availability_windows w
    where w.expert_id=p_expert_id and (w.weekday is not null or w.exception_date>=today)) then
    return 'AVAILABILITY_REQUIRED'; end if;
  d := (p_starts at time zone 'Australia/Adelaide')::date;
  if exists(select 1 from public.care_technician_availability_exceptions x where x.expert_id=p_expert_id and x.exception_date=d) then
    select exists(select 1 from public.care_technician_availability_windows w
      where w.expert_id=p_expert_id and w.exception_date=d and
        public.care_availability_instant(d::timestamp + w.start_minute * interval '1 minute',w.start_offset_minutes) <= p_starts and
        public.care_availability_instant(d::timestamp + w.end_minute * interval '1 minute',w.end_offset_minutes) >= p_ends) into covered;
  else
    select exists(select 1 from public.care_technician_availability_windows w
      where w.expert_id=p_expert_id and w.weekday=extract(isodow from d)::int and
        public.care_availability_instant(d::timestamp + w.start_minute * interval '1 minute',null) <= p_starts and
        public.care_availability_instant(d::timestamp + w.end_minute * interval '1 minute',null) >= p_ends) into covered;
  end if;
  return case when covered then 'AVAILABLE' else 'SLOT_UNAVAILABLE' end;
end; $$;

revoke all on function public.care_technician_availability_read(uuid),
  public.care_technician_availability_replace(uuid,uuid,jsonb),
  public.care_technician_availability_check(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.care_technician_availability_read(uuid),
  public.care_technician_availability_replace(uuid,uuid,jsonb),
  public.care_technician_availability_check(uuid,timestamptz,timestamptz) to service_role;

commit;
