begin;

-- Intentionally unseeded: deployment must configure an approved response policy.
create table public.care_response_policy (
  singleton boolean primary key default true check (singleton),
  acknowledgement_minutes integer not null check (acknowledgement_minutes between 1 and 10080),
  escalation_minutes integer not null check (escalation_minutes between 1 and 10080)
);

create table public.care_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id),
  vehicle_id uuid not null references public.vehicles(id),
  service text not null check (service in ('repair','cleaning')),
  description text not null check (length(description) between 10 and 2000),
  preferred_window text not null check (preferred_window in ('one_to_two_business_days','seven_to_fourteen_days','flexible')),
  quote_state text not null default 'in_review' check (quote_state in ('draft','in_review','issued','accepted','declined','expired','superseded')),
  assignment_state text not null default 'none' check (assignment_state in ('none','offered','reserved','accepted','cancelled','expired')),
  -- No appointment or payment exists at receipt. Never imply one by a default.
  fulfilment_state text check (fulfilment_state in ('scheduled','ready','in_progress','paused','completed','validated','closed')),
  money_state text check (money_state is null), -- money module owns future records
  customer_stage text not null default 'request_received' check (customer_stage in ('request_received','delayed','no_match')),
  next_action text not null default 'review_request',
  responsible_role text not null default 'operations',
  next_update_at timestamptz,
  escalation_minutes integer not null check (escalation_minutes between 1 and 10080),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (customer_stage = 'request_received' and next_action = 'review_request' and responsible_role = 'operations' and next_update_at is not null) or
    (customer_stage = 'delayed' and next_action = 'review_overdue_request' and responsible_role = 'operations' and next_update_at is not null) or
    (customer_stage = 'no_match' and next_action = 'choose_recovery' and responsible_role = 'customer' and next_update_at is null)
  )
);
create index care_requests_customer_idx on public.care_requests(customer_id, created_at desc);
create index care_requests_due_idx on public.care_requests(next_update_at) where next_update_at is not null;

create table public.care_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.care_requests(id),
  sequence integer not null check (sequence > 0),
  type text not null check (type in ('request_received','response_overdue','no_match','request_reopened')),
  occurred_at timestamptz not null,
  unique(request_id, sequence)
);

create table public.care_request_commands (
  customer_id uuid not null references auth.users(id),
  operation text not null check (operation in ('submit','retry')),
  idempotency_key uuid not null,
  payload jsonb not null,
  request_id uuid not null references public.care_requests(id),
  primary key(customer_id, operation, idempotency_key)
);

create table public.care_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.care_request_events(id),
  request_id uuid not null references public.care_requests(id),
  recipient_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null,
  last_error text,
  delivered_at timestamptz,
  check ((status = 'delivered') = (delivered_at is not null))
);

alter table public.care_response_policy enable row level security;
alter table public.care_requests enable row level security;
alter table public.care_request_events enable row level security;
alter table public.care_request_commands enable row level security;
alter table public.care_notification_outbox enable row level security;
revoke all on public.care_response_policy, public.care_requests, public.care_request_events,
  public.care_request_commands, public.care_notification_outbox from public, anon, authenticated;
grant select on public.care_requests, public.care_request_events to authenticated;
grant all on public.care_response_policy, public.care_requests, public.care_request_events,
  public.care_request_commands, public.care_notification_outbox to service_role;

create policy care_read_own on public.care_requests for select to authenticated using (
  customer_id = auth.uid() and exists (
    select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = auth.uid()
  )
);
create policy care_events_read_own on public.care_request_events for select to authenticated using (
  exists (select 1 from public.care_requests r where r.id = request_id)
);

-- Preserve the shared ownership boundary. Archive is supported; hard deletion
-- of referenced vehicles is blocked by the FK, not cascading away Care evidence.
create function public.care_guard_vehicle_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id and exists (
    select 1 from public.care_requests r where r.vehicle_id = old.id
  ) then
    raise exception using errcode = 'P0001', message = 'VEHICLE_HAS_CARE_HISTORY';
  end if;
  return new;
end;
$$;
create trigger care_vehicle_owner_guard before update of owner_id on public.vehicles
for each row execute function public.care_guard_vehicle_owner();

-- Helpers are not exposed as callable authenticated RPCs.
create function public.care_require_customer() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED'; end if;
  if not exists (select 1 from public.user_roles where user_id = actor and role = 'customer') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  return actor;
end;
$$;

create function public.care_request_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (to_jsonb(r) - 'customer_id' - 'escalation_minutes') || jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'request_id' order by e.sequence)
      from public.care_request_events e where e.request_id = r.id), '[]'::jsonb)
  ) from public.care_requests r where r.id = p_id;
$$;

create function public.care_append_event(p_request public.care_requests, p_type text, p_at timestamptz, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare event_id uuid;
begin
  -- Caller holds request lock (or just inserted the request).
  insert into public.care_request_events(request_id, sequence, type, occurred_at)
  select p_request.id, coalesce(max(sequence), 0) + 1, p_type, p_at
  from public.care_request_events where request_id = p_request.id returning id into event_id;
  insert into public.care_notification_outbox(event_id, request_id, recipient_id, available_at)
  values (event_id, p_request.id, p_request.customer_id, p_at);
  insert into public.audit_events(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_actor, 'care.' || p_type, 'care_request', p_request.id::text,
    jsonb_build_object('event_id', event_id, 'next_update_at', p_request.next_update_at));
end;
$$;

create function public.care_get_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.care_require_customer();
begin
  if not exists (select 1 from public.care_requests r join public.vehicles v on v.id = r.vehicle_id
    where r.id = p_id and r.customer_id = actor and v.owner_id = actor) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  return public.care_request_snapshot(p_id);
end;
$$;

create function public.care_submit_request(p_key uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.care_require_customer();
  command public.care_request_commands;
  request public.care_requests;
  policy public.care_response_policy;
  vehicle uuid;
  normalized jsonb;
  at_time timestamptz := clock_timestamp();
begin
  if p_key is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or
    not (p_payload ?& array['vehicle_id','service','description','preferred_window']) or
    p_payload - array['vehicle_id','service','description','preferred_window'] <> '{}'::jsonb or
    jsonb_typeof(p_payload->'vehicle_id') <> 'string' or
    jsonb_typeof(p_payload->'service') <> 'string' or
    jsonb_typeof(p_payload->'description') <> 'string' or
    jsonb_typeof(p_payload->'preferred_window') <> 'string' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  begin vehicle := (p_payload->>'vehicle_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end;
  if p_payload->>'service' not in ('repair','cleaning') or
    p_payload->>'preferred_window' not in ('one_to_two_business_days','seven_to_fourteen_days','flexible') or
    length(btrim(p_payload->>'description')) not between 10 and 2000 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  normalized := p_payload || jsonb_build_object('vehicle_id', vehicle, 'description', btrim(p_payload->>'description'));
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':submit:' || p_key::text, 0));
  select * into command from public.care_request_commands
    where customer_id = actor and operation = 'submit' and idempotency_key = p_key;
  if found then
    if command.payload <> normalized then raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('request', public.care_get_request(command.request_id), 'replayed', true);
  end if;
  -- Serializes against archiving/ownership edits and prevents check/use races.
  perform 1 from public.vehicles where id = vehicle and owner_id = actor and archived_at is null for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  select * into policy from public.care_response_policy where singleton;
  if not found then raise exception using errcode = 'P0001', message = 'POLICY_UNAVAILABLE'; end if;
  at_time := clock_timestamp(); -- deadline starts after lock waits, not before
  insert into public.care_requests(customer_id, vehicle_id, service, description, preferred_window,
    next_update_at, escalation_minutes, created_at, updated_at)
  values(actor, vehicle, normalized->>'service', normalized->>'description', normalized->>'preferred_window',
    at_time + make_interval(mins => policy.acknowledgement_minutes), policy.escalation_minutes, at_time, at_time)
  returning * into request;
  insert into public.care_request_commands values(actor, 'submit', p_key, normalized, request.id);
  perform public.care_append_event(request, 'request_received', at_time, actor);
  return jsonb_build_object('request', public.care_request_snapshot(request.id), 'replayed', false);
end;
$$;

create function public.care_retry_request(p_id uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.care_require_customer();
  command public.care_request_commands;
  request public.care_requests;
  policy public.care_response_policy;
  at_time timestamptz := clock_timestamp();
  payload jsonb := jsonb_build_object('request_id', p_id);
begin
  if p_id is null or p_key is null then raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':retry:' || p_key::text, 0));
  select * into command from public.care_request_commands
    where customer_id = actor and operation = 'retry' and idempotency_key = p_key;
  if found then
    if command.payload <> payload then raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('request', public.care_get_request(command.request_id), 'replayed', true);
  end if;
  -- Lock order matches submission: vehicle before request.
  perform 1 from public.vehicles v join public.care_requests r on r.vehicle_id = v.id
    where r.id = p_id and r.customer_id = actor and v.owner_id = actor and v.archived_at is null for update of v;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  select * into request from public.care_requests where id = p_id for update;
  if request.customer_stage <> 'no_match' or request.quote_state <> 'in_review' or request.assignment_state <> 'none'
    or request.fulfilment_state is not null or request.money_state is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
  end if;
  select * into policy from public.care_response_policy where singleton;
  if not found then raise exception using errcode = 'P0001', message = 'POLICY_UNAVAILABLE'; end if;
  at_time := clock_timestamp();
  update public.care_requests set customer_stage = 'request_received', next_action = 'review_request',
    responsible_role = 'operations', updated_at = at_time,
    next_update_at = at_time + make_interval(mins => policy.acknowledgement_minutes),
    escalation_minutes = policy.escalation_minutes where id = p_id returning * into request;
  insert into public.care_request_commands values(actor, 'retry', p_key, payload, p_id);
  perform public.care_append_event(request, 'request_reopened', at_time, actor);
  return jsonb_build_object('request', public.care_request_snapshot(p_id), 'replayed', false);
end;
$$;

create function public.care_escalate_overdue(p_batch_size integer default 100) returns integer
language plpgsql security definer set search_path = '' as $$
declare request public.care_requests; at_time timestamptz := clock_timestamp(); processed integer := 0; event_type text;
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  for request in select * from public.care_requests
    where next_update_at <= at_time and customer_stage in ('request_received','delayed')
      and quote_state = 'in_review' and assignment_state = 'none'
      and fulfilment_state is null and money_state is null
    order by next_update_at, id limit p_batch_size for update skip locked
  loop
    event_type := case when request.customer_stage = 'request_received' then 'response_overdue' else 'no_match' end;
    update public.care_requests set
      customer_stage = case when event_type = 'response_overdue' then 'delayed' else 'no_match' end,
      next_action = case when event_type = 'response_overdue' then 'review_overdue_request' else 'choose_recovery' end,
      responsible_role = case when event_type = 'response_overdue' then 'operations' else 'customer' end,
      next_update_at = case when event_type = 'response_overdue' then at_time + make_interval(mins => escalation_minutes) else null end,
      updated_at = at_time where id = request.id returning * into request;
    perform public.care_append_event(request, event_type, at_time, null);
    processed := processed + 1;
  end loop;
  return processed;
end;
$$;

revoke all on function public.care_guard_vehicle_owner(), public.care_require_customer(),
  public.care_request_snapshot(uuid), public.care_append_event(public.care_requests, text, timestamptz, uuid),
  public.care_get_request(uuid), public.care_submit_request(uuid, jsonb), public.care_retry_request(uuid, uuid),
  public.care_escalate_overdue(integer) from public, anon, authenticated;
grant execute on function public.care_get_request(uuid), public.care_submit_request(uuid, jsonb),
  public.care_retry_request(uuid, uuid) to authenticated;
grant execute on function public.care_escalate_overdue(integer) to service_role;

commit;
