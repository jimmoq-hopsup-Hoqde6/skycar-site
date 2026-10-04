begin;

-- Connected Care is intentionally server-mediated. Browser roles receive no
-- table or function privileges; the application verifies the session/cookie,
-- then calls the command RPC with a trusted server credential. The RPC still
-- rechecks the supplied actor and source request before every replay or write.
create table public.care_experts (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (length(btrim(business_name)) between 2 and 120),
  description text not null check (length(btrim(description)) between 10 and 1000),
  services text[] not null check (
    cardinality(services) between 1 and 2 and
    services <@ array['cleaning','repair']::text[] and
    array_position(services,null) is null
  ),
  postcodes text[] not null check (cardinality(postcodes) between 1 and 100 and array_position(postcodes,null) is null),
  insurance_valid_until date not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.care_journeys (
  id uuid primary key,
  account_request_id uuid unique references public.care_requests(id),
  guest_request_id uuid unique references public.care_guest_requests(id),
  state text not null default 'review' check (state in (
    'review','quotes_ready','booking_requested','scheduled','in_progress',
    'completed','cancellation_requested','cancelled'
  )),
  customer_details jsonb not null default '{}'::jsonb check (jsonb_typeof(customer_details) = 'object'),
  selected_quote_id uuid,
  expert_id uuid references public.care_experts(id),
  starts_at timestamptz,
  ends_at timestamptz,
  completion_evidence jsonb check (completion_evidence is null or jsonb_typeof(completion_evidence) = 'array'),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(account_request_id,guest_request_id) = 1),
  check (id = coalesce(account_request_id,guest_request_id)),
  check ((starts_at is null) = (ends_at is null)),
  check (starts_at is null or ends_at > starts_at)
);

create table public.care_reviewed_quotes (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.care_journeys(id),
  expert_id uuid not null references public.care_experts(id),
  expert_name text not null,
  expert_description text not null,
  scope_summary text not null check (length(btrim(scope_summary)) between 10 and 2000),
  total_price_cents integer not null check (total_price_cents between 1 and 100000000),
  currency text not null default 'AUD' check (currency = 'AUD'),
  status text not null default 'issued' check (status in ('issued','selected','superseded','withdrawn')),
  expires_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at <= starts_at and starts_at < ends_at),
  check (ends_at - starts_at <= interval '7 days')
);
alter table public.care_reviewed_quotes add constraint care_reviewed_quotes_id_journey_unique unique (id,journey_id);
alter table public.care_journeys add constraint care_journeys_selected_quote_fk
  foreign key (selected_quote_id,id) references public.care_reviewed_quotes(id,journey_id);

create table public.care_journey_events (
  id bigint generated always as identity primary key,
  journey_id uuid not null references public.care_journeys(id),
  type text not null check (type in (
    'details_updated','quote_issued','booking_requested','booking_confirmed',
    'work_started','work_completed','cancellation_requested','booking_cancelled'
  )),
  occurred_at timestamptz not null default clock_timestamp()
);

create table public.care_journey_commands (
  actor_scope text not null,
  idempotency_key uuid not null,
  action text not null,
  journey_id uuid references public.care_journeys(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_scope,idempotency_key)
);

create index care_journeys_capacity_idx on public.care_journeys(expert_id,starts_at,ends_at)
  where state in ('scheduled','in_progress','cancellation_requested');
create index care_quotes_journey_status_idx on public.care_reviewed_quotes(journey_id,status,expires_at);
create unique index care_quotes_one_current_per_expert_idx on public.care_reviewed_quotes(journey_id,expert_id)
  where status = 'issued';
create index care_journey_events_journey_idx on public.care_journey_events(journey_id,id);
create index care_journey_commands_journey_idx on public.care_journey_commands(journey_id,created_at);

alter table public.care_experts enable row level security;
alter table public.care_journeys enable row level security;
alter table public.care_reviewed_quotes enable row level security;
alter table public.care_journey_events enable row level security;
alter table public.care_journey_commands enable row level security;

revoke all on public.care_experts,public.care_journeys,public.care_reviewed_quotes,
  public.care_journey_events,public.care_journey_commands from public,anon,authenticated;
grant select,insert,update on public.care_experts,public.care_journeys,public.care_reviewed_quotes,
  public.care_journey_events,public.care_journey_commands to service_role;
grant usage,select on sequence public.care_journey_events_id_seq to service_role;

create function public.care_journey_command(
  p_action text,
  p_id uuid,
  p_actor uuid,
  p_guest_key uuid,
  p_key uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  is_admin boolean := false;
  is_customer boolean := false;
  is_guest boolean := false;
  scope_value text;
  source_kind text;
  source_service text;
  source_customer uuid;
  source_vehicle uuid;
  guest_payload jsonb;
  journey public.care_journeys;
  prior public.care_journey_commands;
  quote_row public.care_reviewed_quotes;
  expert public.care_experts;
  target_expert_id uuid;
  target_quote_id uuid;
  result jsonb;
  at_time timestamptz := clock_timestamp();
  expires_time timestamptz;
  start_time timestamptz;
  end_time timestamptz;
  insurance_date date;
  business_name text;
  description text;
  scope_summary text;
  address_text text;
  details jsonb;
  services text[];
  postcodes text[];
  item text;
  evidence_item jsonb;
  evidence_slot integer;
  expected_slot integer := 1;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_action is null or p_key is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;

  if p_actor is not null then
    select exists(select 1 from public.user_roles where user_id=p_actor and role='admin'),
      exists(select 1 from public.user_roles where user_id=p_actor and role='customer')
      into is_admin,is_customer;
  end if;

  if p_action = 'create_expert' then
    if p_id is not null or p_guest_key is not null or not is_admin then
      raise exception using errcode = 'P0001', message = 'FORBIDDEN';
    end if;
    scope_value := 'user:' || p_actor::text;
    perform pg_advisory_xact_lock(hashtextextended(scope_value || ':' || p_key::text,0));
    select * into prior from public.care_journey_commands where actor_scope=scope_value and idempotency_key=p_key;
    if found then
      if prior.action <> p_action or prior.journey_id is not null or prior.payload <> p_payload then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
      end if;
      return prior.result || jsonb_build_object('replayed',true);
    end if;
    if not (p_payload ?& array['business_name','description','services','postcodes','insurance_valid_until']) or
      p_payload - array['business_name','description','services','postcodes','insurance_valid_until'] <> '{}'::jsonb or
      jsonb_typeof(p_payload->'business_name') <> 'string' or jsonb_typeof(p_payload->'description') <> 'string' or
      jsonb_typeof(p_payload->'services') <> 'array' or jsonb_typeof(p_payload->'postcodes') <> 'array' or
      jsonb_typeof(p_payload->'insurance_valid_until') <> 'string' then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    business_name := btrim(p_payload->>'business_name');
    description := btrim(p_payload->>'description');
    if length(business_name) not between 2 and 120 or length(description) not between 10 and 1000 or
      jsonb_array_length(p_payload->'services') not between 1 and 2 or
      jsonb_array_length(p_payload->'postcodes') not between 1 and 100 or
      p_payload->>'insurance_valid_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    services := array[]::text[];
    for item in select jsonb_array_elements_text(p_payload->'services') loop
      if item is null or item not in ('repair','cleaning') then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
      services := array_append(services,item);
    end loop;
    select array_agg(distinct value order by value) into services from unnest(services) value;
    if cardinality(services) <> jsonb_array_length(p_payload->'services') then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    postcodes := array[]::text[];
    for item in select jsonb_array_elements_text(p_payload->'postcodes') loop
      if item is null or item !~ '^[0-9]{4}$' then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
      postcodes := array_append(postcodes,item);
    end loop;
    select array_agg(distinct value order by value) into postcodes from unnest(postcodes) value;
    if cardinality(postcodes) <> jsonb_array_length(p_payload->'postcodes') then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    begin insurance_date := (p_payload->>'insurance_valid_until')::date;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end;
    if insurance_date < (clock_timestamp() at time zone 'Australia/Adelaide')::date then
      raise exception using errcode='P0001',message='VALIDATION_FAILED';
    end if;
    insert into public.care_experts(business_name,description,services,postcodes,insurance_valid_until)
      values(business_name,description,services,postcodes,insurance_date) returning id into target_expert_id;
    result := jsonb_build_object('expert_id',target_expert_id,'replayed',false);
    insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
      values(p_actor,'care.expert_created','care_expert',target_expert_id::text,'{}'::jsonb);
    insert into public.care_journey_commands(actor_scope,idempotency_key,action,journey_id,payload,result)
      values(scope_value,p_key,p_action,null,p_payload,result);
    return result;
  end if;

  if p_action not in ('update_details','publish_quote','select_quote','confirm','start','complete','request_cancel','cancel') or p_id is null then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;

  select r.customer_id,r.vehicle_id,r.service into source_customer,source_vehicle,source_service
    from public.care_requests r join public.vehicles v on v.id=r.vehicle_id and v.owner_id=r.customer_id where r.id=p_id;
  if found then
    source_kind := 'account';
    if not is_admin and (p_actor is null or p_actor <> source_customer or not is_customer or p_guest_key is not null) then
      raise exception using errcode='P0001',message='NOT_FOUND';
    end if;
    scope_value := 'user:' || p_actor::text;
  else
    select g.payload into guest_payload from public.care_guest_requests g
      where g.id=p_id and (is_admin or g.idempotency_key=p_guest_key);
    if found then
      source_kind := 'guest'; source_service := guest_payload->>'service'; is_guest := not is_admin and p_actor is null;
      if not is_admin and not is_guest then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
      scope_value := case when is_admin then 'user:' || p_actor::text else 'guest:' || p_id::text end;
    else
      raise exception using errcode='P0001',message='NOT_FOUND';
    end if;
  end if;

  if p_action in ('publish_quote','confirm','start','complete','cancel') and not is_admin then
    raise exception using errcode='P0001',message='FORBIDDEN';
  end if;
  if p_action in ('update_details','select_quote','request_cancel') and is_admin then
    raise exception using errcode='P0001',message='FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(scope_value || ':' || p_key::text,0));
  select * into prior from public.care_journey_commands where actor_scope=scope_value and idempotency_key=p_key;
  if found then
    if prior.action <> p_action or prior.journey_id is distinct from p_id or prior.payload <> p_payload then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';
    end if;
    return prior.result || jsonb_build_object('replayed',true);
  end if;

  -- Match the established Garage/Care lock order before any booking decision.
  if source_kind='account' and p_action in ('publish_quote','select_quote','confirm') then
    perform 1 from public.vehicles v join public.care_requests r on r.vehicle_id=v.id
      where r.id=p_id and r.customer_id=v.owner_id and v.archived_at is null for update of v;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    perform 1 from public.care_requests where id=p_id for update;
  end if;

  insert into public.care_journeys(id,account_request_id,guest_request_id,customer_details)
    values(p_id,case when source_kind='account' then p_id end,case when source_kind='guest' then p_id end,
      case when source_kind='guest' then jsonb_build_object('name',guest_payload->>'name','phone',guest_payload->>'phone','suburb',guest_payload->>'suburb','postcode',guest_payload->>'postcode') else '{}'::jsonb end)
    on conflict (id) do nothing;
  select * into journey from public.care_journeys where id=p_id for update;
  if (source_kind='account' and journey.account_request_id is null) or (source_kind='guest' and journey.guest_request_id is null) then
    raise exception using errcode='P0001',message='NOT_FOUND';
  end if;

  at_time := clock_timestamp();
  if p_action='update_details' then
    if journey.state not in ('review','quotes_ready') or
      not (p_payload ?& array['name','phone','suburb','postcode']) or p_payload-array['name','phone','suburb','postcode']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'name')<>'string' or jsonb_typeof(p_payload->'phone')<>'string' or
      jsonb_typeof(p_payload->'suburb')<>'string' or jsonb_typeof(p_payload->'postcode')<>'string' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED';
    end if;
    details := jsonb_build_object('name',btrim(p_payload->>'name'),'phone',btrim(p_payload->>'phone'),
      'suburb',btrim(p_payload->>'suburb'),'postcode',btrim(p_payload->>'postcode'));
    if length(details->>'name') not between 2 and 100 or length(details->>'phone') not between 8 and 24 or
      details->>'phone' !~ '^\+?[0-9 ()-]+$' or length(details->>'suburb') not between 2 and 100 or
      details->>'postcode' !~ '^[0-9]{4}$' then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    if journey.customer_details->>'postcode' is distinct from details->>'postcode' then
      update public.care_reviewed_quotes set status='withdrawn' where journey_id=p_id and status='issued';
      journey.state := 'review';
    end if;
    update public.care_journeys set customer_details=details,state=journey.state,revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'details_updated',at_time);

  elsif p_action='publish_quote' then
    if journey.state not in ('review','quotes_ready') or
      not (p_payload ?& array['expert_id','scope_summary','total_price_cents','expires_at','starts_at','ends_at']) or
      p_payload-array['expert_id','scope_summary','total_price_cents','expires_at','starts_at','ends_at']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'expert_id')<>'string' or jsonb_typeof(p_payload->'scope_summary')<>'string' or
      jsonb_typeof(p_payload->'total_price_cents')<>'number' or jsonb_typeof(p_payload->'expires_at')<>'string' or
      jsonb_typeof(p_payload->'starts_at')<>'string' or jsonb_typeof(p_payload->'ends_at')<>'string' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED';
    end if;
    begin
      target_expert_id := (p_payload->>'expert_id')::uuid; expires_time := (p_payload->>'expires_at')::timestamptz;
      start_time := (p_payload->>'starts_at')::timestamptz; end_time := (p_payload->>'ends_at')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='P0001',message='VALIDATION_FAILED'; end;
    scope_summary := btrim(p_payload->>'scope_summary');
    if (p_payload->>'total_price_cents') !~ '^[0-9]+$' or length(scope_summary) not between 10 and 2000 or
      (p_payload->>'total_price_cents')::numeric not between 1 and 100000000 or
      p_payload->>'expires_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' or
      p_payload->>'starts_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' or
      p_payload->>'ends_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' or
      not isfinite(expires_time) or not isfinite(start_time) or not isfinite(end_time) or
      expires_time<=at_time or expires_time>start_time or start_time<=at_time or end_time<=start_time or end_time-start_time>interval '7 days' or
      coalesce(journey.customer_details->>'postcode','') !~ '^[0-9]{4}$' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED';
    end if;
    select * into expert from public.care_experts where id=target_expert_id for key share;
    if not found or not expert.active or not source_service=any(expert.services) or
      not (journey.customer_details->>'postcode')=any(expert.postcodes) or
      expert.insurance_valid_until < (end_time at time zone 'Australia/Adelaide')::date then
      raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
    update public.care_reviewed_quotes set status='superseded' where journey_id=p_id and expert_id=target_expert_id and status='issued';
    insert into public.care_reviewed_quotes(journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,expires_at,starts_at,ends_at)
      values(p_id,target_expert_id,expert.business_name,expert.description,scope_summary,(p_payload->>'total_price_cents')::integer,expires_time,start_time,end_time)
      returning id into target_quote_id;
    update public.care_journeys set state='quotes_ready',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    if source_kind='account' then update public.care_requests set quote_state='issued',updated_at=at_time where id=p_id; end if;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'quote_issued',at_time);

  elsif p_action='select_quote' then
    if journey.state<>'quotes_ready' or not (p_payload ?& array['quote_id','address']) or p_payload-array['quote_id','address']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'quote_id')<>'string' or jsonb_typeof(p_payload->'address')<>'string' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    begin target_quote_id := (p_payload->>'quote_id')::uuid; exception when invalid_text_representation then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end;
    address_text := btrim(p_payload->>'address');
    if length(address_text) not between 5 and 250 then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    select * into quote_row from public.care_reviewed_quotes where id=target_quote_id and journey_id=p_id for update;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    if quote_row.status<>'issued' or quote_row.expires_at<=at_time or quote_row.starts_at<=at_time then
      raise exception using errcode='P0001',message='QUOTE_EXPIRED'; end if;
    select * into expert from public.care_experts where id=quote_row.expert_id for key share;
    if not found or not expert.active or not source_service=any(expert.services) or
      not (journey.customer_details->>'postcode')=any(expert.postcodes) or
      expert.insurance_valid_until<(quote_row.ends_at at time zone 'Australia/Adelaide')::date then
      raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
    update public.care_reviewed_quotes set status=case when id=target_quote_id then 'selected' else 'withdrawn' end
      where journey_id=p_id and status='issued';
    update public.care_journeys set state='booking_requested',customer_details=customer_details||jsonb_build_object('address',address_text),
      selected_quote_id=target_quote_id,expert_id=quote_row.expert_id,starts_at=quote_row.starts_at,ends_at=quote_row.ends_at,
      revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    if source_kind='account' then update public.care_requests set quote_state='accepted',assignment_state='reserved',updated_at=at_time where id=p_id; end if;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'booking_requested',at_time);

  elsif p_action='confirm' then
    if journey.state<>'booking_requested' or p_payload<>'{"availability_confirmed":true}'::jsonb then
      raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
    perform pg_advisory_xact_lock(hashtextextended('care:expert-capacity:'||journey.expert_id::text,0));
    select * into expert from public.care_experts where id=journey.expert_id for key share;
    if not found or not expert.active or expert.insurance_valid_until<(journey.ends_at at time zone 'Australia/Adelaide')::date or
      not source_service=any(expert.services) or not (journey.customer_details->>'postcode')=any(expert.postcodes) then
      raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
    if exists(select 1 from public.care_journeys j where j.id<>p_id and j.expert_id=journey.expert_id and
      j.state in ('scheduled','in_progress','cancellation_requested') and
      tstzrange(j.starts_at,j.ends_at,'[)') && tstzrange(journey.starts_at,journey.ends_at,'[)')) then
      raise exception using errcode='P0001',message='SLOT_UNAVAILABLE'; end if;
    if journey.starts_at<=at_time then raise exception using errcode='P0001',message='SLOT_UNAVAILABLE'; end if;
    update public.care_journeys set state='scheduled',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    if source_kind='account' then update public.care_requests set assignment_state='accepted',fulfilment_state='scheduled',updated_at=at_time where id=p_id; end if;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'booking_confirmed',at_time);

  elsif p_action='start' then
    if journey.state<>'scheduled' or p_payload<>'{}'::jsonb then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
    if journey.starts_at>at_time then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
    update public.care_journeys set state='in_progress',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    if source_kind='account' then update public.care_requests set fulfilment_state='in_progress',updated_at=at_time where id=p_id; end if;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'work_started',at_time);

  elsif p_action='complete' then
    if journey.state<>'in_progress' or not (p_payload ? 'evidence') or p_payload-array['evidence']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'evidence')<>'array' or jsonb_array_length(p_payload->'evidence') not between 1 and 3 then
      raise exception using errcode='P0001',message='EVIDENCE_REQUIRED'; end if;
    for evidence_item in select value from jsonb_array_elements(p_payload->'evidence') loop
      if jsonb_typeof(evidence_item)<>'object' or not (evidence_item ?& array['slot','mime_type','size_bytes','sha256']) or
        evidence_item-array['slot','mime_type','size_bytes','sha256']<>'{}'::jsonb or jsonb_typeof(evidence_item->'slot')<>'number' or
        jsonb_typeof(evidence_item->'mime_type')<>'string' or jsonb_typeof(evidence_item->'size_bytes')<>'number' or
        jsonb_typeof(evidence_item->'sha256')<>'string' or (evidence_item->>'slot')!~'^[0-9]+$' or
        (evidence_item->>'size_bytes')!~'^[0-9]+$' then raise exception using errcode='P0001',message='EVIDENCE_REQUIRED'; end if;
      evidence_slot := (evidence_item->>'slot')::integer;
      if evidence_slot<>expected_slot or evidence_item->>'mime_type' not in ('image/jpeg','image/png','image/webp') or
        (evidence_item->>'size_bytes')::integer not between 128 and 900000 or evidence_item->>'sha256' !~ '^[0-9a-f]{64}$' then
        raise exception using errcode='P0001',message='EVIDENCE_REQUIRED'; end if;
      expected_slot := expected_slot+1;
    end loop;
    update public.care_journeys set state='completed',completion_evidence=p_payload->'evidence',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    if source_kind='account' then
      update public.care_requests set fulfilment_state='completed',updated_at=at_time where id=p_id;
      insert into public.vehicle_history(vehicle_id,event_type,occurred_at,source,payload)
        values(source_vehicle,'care_service_completed',at_time,'skycar_care',jsonb_build_object('journey_id',p_id,'expert_id',journey.expert_id,'quote_id',journey.selected_quote_id));
    end if;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'work_completed',at_time);

  elsif p_action='request_cancel' then
    if journey.state not in ('review','quotes_ready','booking_requested','scheduled') or p_payload<>'{}'::jsonb then
      raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
    update public.care_journeys set state='cancellation_requested',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'cancellation_requested',at_time);

  elsif p_action='cancel' then
    if journey.state in ('completed','cancelled','in_progress') or p_payload<>'{}'::jsonb then
      raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
    update public.care_reviewed_quotes set status='withdrawn' where journey_id=p_id and status='issued';
    update public.care_journeys set state='cancelled',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    if source_kind='account' then update public.care_requests set quote_state='declined',assignment_state='cancelled',fulfilment_state=null,updated_at=at_time where id=p_id; end if;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'booking_cancelled',at_time);
  end if;

  result := jsonb_build_object('id',p_id,'state',journey.state,'revision',journey.revision,'replayed',false);
  insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
    values(p_actor,'care.journey_'||p_action,'care_journey',p_id::text,jsonb_build_object('state',journey.state,'actor_scope',scope_value));
  insert into public.care_journey_commands(actor_scope,idempotency_key,action,journey_id,payload,result)
    values(scope_value,p_key,p_action,p_id,p_payload,result);
  return result;
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using errcode='P0001',message='VALIDATION_FAILED';
end;
$$;

revoke all on function public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb) to service_role;

commit;
