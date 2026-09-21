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
  check (expires_at > created_at)
);
create index care_offers_request_idx on public.care_offers(request_id, created_at desc);
create index care_offers_technician_idx on public.care_offers(technician_id, created_at desc);

create table public.care_offer_slots (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.care_offers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available' check (status in ('available','withdrawn','expired')),
  created_at timestamptz not null default now(),
  unique(offer_id, starts_at, ends_at),
  check (ends_at > starts_at)
);
create index care_offer_slots_offer_idx on public.care_offer_slots(offer_id, starts_at);

alter table public.care_offers enable row level security;
alter table public.care_offer_slots enable row level security;
revoke all on public.care_offers, public.care_offer_slots from public, anon, authenticated;
grant all on public.care_offers, public.care_offer_slots to service_role;

create function public.care_get_offers(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := public.care_require_customer();
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
          where s.offer_id = o.id and s.status = 'available' and s.ends_at > clock_timestamp()
        ), '[]'::jsonb)
      )
      order by o.total_price_cents, o.created_at, o.id
    )
    from public.care_offers o
    where o.request_id = p_request_id and o.status = 'issued' and o.expires_at > clock_timestamp()
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
  offer_id uuid;
  slot jsonb;
  start_time timestamptz;
  end_time timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_request_id is null or p_technician_id is null or
    length(btrim(coalesce(p_scope_summary, ''))) not between 10 and 2000 or
    p_total_price_cents is null or p_total_price_cents <= 0 or
    p_expires_at is null or p_expires_at <= clock_timestamp() or
    p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 or
    jsonb_array_length(p_slots) > 20 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if p_adjustment_reason is not null and length(btrim(p_adjustment_reason)) not between 3 and 1000 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_technician_id and role = 'technician') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  perform 1 from public.care_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;

  update public.care_offers
    set status = 'superseded', updated_at = clock_timestamp()
    where request_id = p_request_id and technician_id = p_technician_id and status = 'issued';

  insert into public.care_offers(
    request_id, technician_id, scope_summary, total_price_cents, adjustment_reason, expires_at
  ) values (
    p_request_id, p_technician_id, btrim(p_scope_summary), p_total_price_cents,
    case when p_adjustment_reason is null then null else btrim(p_adjustment_reason) end, p_expires_at
  ) returning id into offer_id;

  for slot in select value from jsonb_array_elements(p_slots)
  loop
    if jsonb_typeof(slot) <> 'object' or not (slot ?& array['starts_at','ends_at']) or
      slot - array['starts_at','ends_at'] <> '{}'::jsonb then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    begin
      start_time := (slot->>'starts_at')::timestamptz;
      end_time := (slot->>'ends_at')::timestamptz;
    exception when others then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end;
    if start_time <= clock_timestamp() or end_time <= start_time or start_time >= p_expires_at then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    insert into public.care_offer_slots(offer_id, starts_at, ends_at)
      values (offer_id, start_time, end_time);
  end loop;

  insert into public.audit_events(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_technician_id, 'care.offer_issued', 'care_request', p_request_id::text,
    jsonb_build_object('offer_id', offer_id, 'slot_count', jsonb_array_length(p_slots), 'expires_at', p_expires_at));

  return offer_id;
end;
$$;

revoke all on function public.care_get_offers(uuid),
  public.care_publish_offer(uuid, uuid, text, integer, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.care_get_offers(uuid) to authenticated;
grant execute on function public.care_publish_offer(uuid, uuid, text, integer, text, timestamptz, jsonb) to service_role;

commit;
