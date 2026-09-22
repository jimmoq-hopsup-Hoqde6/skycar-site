begin;

create table public.care_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.care_requests(id),
  technician_id uuid not null references auth.users(id),
  scope_summary text not null check (length(btrim(scope_summary)) between 10 and 2000),
  total_price_cents integer not null check (total_price_cents > 0),
  currency text not null default 'AUD' check (currency = 'AUD'),
  adjustment_reason text check (adjustment_reason is null or length(btrim(adjustment_reason)) between 3 and 1000),
  status text not null default 'issued' check (status in ('issued','superseded','withdrawn','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (isfinite(expires_at) and expires_at > created_at)
);
create index care_offers_request_idx on public.care_offers(request_id, created_at desc);
create unique index care_offers_one_issued_idx on public.care_offers(request_id, technician_id) where status = 'issued';
create index care_offers_technician_idx on public.care_offers(technician_id, created_at desc);

create table public.care_offer_slots (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.care_offers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available' check (status in ('available','withdrawn','expired')),
  created_at timestamptz not null default now(),
  unique(offer_id, starts_at, ends_at),
  check (isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at)
);
create index care_offer_slots_offer_idx on public.care_offer_slots(offer_id, starts_at);

alter table public.care_offers enable row level security;
alter table public.care_offer_slots enable row level security;
revoke all on public.care_offers, public.care_offer_slots from public, anon, authenticated;
grant all on public.care_offers, public.care_offer_slots to service_role;

create function public.care_get_offers(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := public.care_require_customer();
  at_time timestamptz := statement_timestamp();
begin
  if not exists (
    select 1
    from public.care_requests r
    join public.vehicles v on v.id = r.vehicle_id
    where r.id = p_request_id and r.customer_id = actor and v.owner_id = actor
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  return coalesce((
    select jsonb_agg(
      (to_jsonb(o) - 'technician_id') || jsonb_build_object(
        'slots', coalesce((
          select jsonb_agg(to_jsonb(s) - 'offer_id' order by s.starts_at, s.id)
          from public.care_offer_slots s
          where s.offer_id = o.id and s.status = 'available' and s.starts_at > at_time
        ), '[]'::jsonb)
      )
      order by o.total_price_cents, o.created_at, o.id
    )
    from public.care_offers o
    where o.request_id = p_request_id and o.status = 'issued' and o.expires_at > at_time
      and exists (select 1 from public.care_offer_slots s
        where s.offer_id = o.id and s.status = 'available' and s.starts_at > at_time)
  ), '[]'::jsonb);
end;
$$;

create function public.care_publish_offer(
  p_request_id uuid,
  p_technician_id uuid,
  p_scope_summary text,
  p_total_price_cents integer,
  p_adjustment_reason text,
  p_expires_at timestamptz,
  p_slots jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_offer_id uuid;
  slot jsonb;
  start_time timestamptz;
  end_time timestamptz;
  at_time timestamptz;
  request public.care_requests;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_request_id is null or p_technician_id is null or
    length(btrim(coalesce(p_scope_summary, ''))) not between 10 and 2000 or
    p_total_price_cents is null or p_total_price_cents <= 0 or
    p_expires_at is null or not isfinite(p_expires_at) or
    p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  -- Check the container type before asking PostgreSQL for its array length.
  if jsonb_array_length(p_slots) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if p_adjustment_reason is not null and length(btrim(p_adjustment_reason)) not between 3 and 1000 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  -- Shared lock order: vehicle, request, then technician role. No offer may
  -- be published against an archived vehicle or an already-booked request.
  perform 1 from public.vehicles v join public.care_requests r on r.vehicle_id = v.id
    where r.id = p_request_id and v.owner_id = r.customer_id and v.archived_at is null
    for update of v;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  select * into request from public.care_requests where id = p_request_id for update;
  if request.customer_stage not in ('request_received','delayed') or
    request.quote_state <> 'in_review' or request.assignment_state <> 'none' or
    request.fulfilment_state is not null or request.money_state is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
  end if;
  perform 1 from public.user_roles where user_id = p_technician_id and role = 'technician' for key share;
  if not found then raise exception using errcode = 'P0001', message = 'FORBIDDEN'; end if;
  -- Recheck time after lock waits, not only when the command was received.
  at_time := clock_timestamp();
  if p_expires_at <= at_time then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;

  update public.care_offers
    set status = 'superseded', updated_at = at_time
    where request_id = p_request_id and technician_id = p_technician_id and status = 'issued';

  insert into public.care_offers(
    request_id, technician_id, scope_summary, total_price_cents, adjustment_reason, expires_at, created_at, updated_at
  ) values (
    p_request_id, p_technician_id, btrim(p_scope_summary), p_total_price_cents,
    case when p_adjustment_reason is null then null else btrim(p_adjustment_reason) end, p_expires_at, at_time, at_time
  ) returning id into new_offer_id;

  for slot in select value from jsonb_array_elements(p_slots)
  loop
    if jsonb_typeof(slot) <> 'object' or not (slot ?& array['starts_at','ends_at']) or
      slot - array['starts_at','ends_at'] <> '{}'::jsonb or
      jsonb_typeof(slot->'starts_at') is distinct from 'string' or
      jsonb_typeof(slot->'ends_at') is distinct from 'string' then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    -- Require absolute, timezone-qualified values; reject session-timezone
    -- dependent or relative strings so the same input has one meaning.
    if slot->>'starts_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' or
      slot->>'ends_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    begin
      start_time := (slot->>'starts_at')::timestamptz;
      end_time := (slot->>'ends_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end;
    -- A customer must decide before travel/work starts. Expiry is a decision
    -- deadline, NOT a requirement to finish the appointment before the quote expires.
    if start_time is null or end_time is null or not isfinite(start_time) or not isfinite(end_time) or
      start_time <= at_time or end_time <= start_time or p_expires_at > start_time then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    if exists (select 1 from public.care_offer_slots s where s.offer_id = new_offer_id
      and s.starts_at < end_time and s.ends_at > start_time) then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    insert into public.care_offer_slots(offer_id, starts_at, ends_at, created_at)
      values (new_offer_id, start_time, end_time, at_time);
  end loop;

  insert into public.audit_events(actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'care.offer_issued', 'care_request', p_request_id::text,
    jsonb_build_object('offer_id', new_offer_id, 'technician_id', p_technician_id, 'actor_type', 'service_role', 'slot_count', jsonb_array_length(p_slots), 'expires_at', p_expires_at));

  return new_offer_id;
end;
$$;

revoke all on function public.care_get_offers(uuid),
  public.care_publish_offer(uuid, uuid, text, integer, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.care_get_offers(uuid) to authenticated;
grant execute on function public.care_publish_offer(uuid, uuid, text, integer, text, timestamptz, jsonb) to service_role;

commit;
