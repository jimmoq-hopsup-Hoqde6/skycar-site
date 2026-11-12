begin;

create table public.care_technician_accounts (
  expert_id uuid primary key references public.care_experts(id),
  user_id uuid not null unique references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);
create table public.care_technician_invitations (
  journey_id uuid not null references public.care_journeys(id),
  expert_id uuid not null references public.care_experts(id),
  active boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (journey_id,expert_id)
);
create table public.care_technician_commands (
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  action text not null,
  journey_id uuid,
  payload jsonb not null,
  result jsonb not null,
  primary key (actor_id,idempotency_key)
);
create index care_technician_inbox_idx on public.care_technician_invitations(expert_id,journey_id) where active;
alter table public.care_technician_accounts enable row level security;
alter table public.care_technician_invitations enable row level security;
alter table public.care_technician_commands enable row level security;
revoke all on public.care_technician_accounts,public.care_technician_invitations,public.care_technician_commands from public,anon,authenticated;
grant select,insert,update on public.care_technician_accounts,public.care_technician_invitations,public.care_technician_commands to service_role;

create function public.care_technician_admin_command(p_actor uuid,p_key uuid,p_action text,p_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  prior public.care_technician_commands;
  expert public.care_experts;
  target_expert uuid;
  target_user uuid;
  customer uuid;
  vehicle uuid;
  service text;
  guest jsonb;
  journey public.care_journeys;
  result jsonb;
begin
  if current_user<>'service_role' or p_actor is null or not exists(select 1 from public.user_roles where user_id=p_actor and role='admin') then
    raise exception using errcode='P0001',message='FORBIDDEN';
  end if;
  if p_key is null or p_action is null or p_action not in ('bind_technician','invite_technician','revoke_technician_invitation') or
    p_payload is null or jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'expert_id') is distinct from 'string' then
    raise exception using errcode='P0001',message='VALIDATION_FAILED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('care:technician-command:'||p_actor::text||':'||p_key::text,0));
  select * into prior from public.care_technician_commands where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if prior.action<>p_action or prior.journey_id is distinct from p_id or prior.payload<>p_payload then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';
    end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;
  target_expert:=(p_payload->>'expert_id')::uuid;
  select * into expert from public.care_experts where id=target_expert for key share;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if p_action='bind_technician' then
    if p_id is not null or p_payload-array['expert_id','user_id']<>'{}'::jsonb or jsonb_typeof(p_payload->'user_id') is distinct from 'string' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED';
    end if;
    target_user:=(p_payload->>'user_id')::uuid;
    if not expert.active or not exists(select 1 from public.user_roles where user_id=target_user and role='technician') then
      raise exception using errcode='P0001',message='FORBIDDEN';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('care:technician-link',0));
    if exists(select 1 from public.care_technician_accounts where (expert_id=target_expert or user_id=target_user) and
      (expert_id<>target_expert or user_id<>target_user or not active)) then
      raise exception using errcode='P0001',message='LINK_CONFLICT';
    end if;
    insert into public.care_technician_accounts(expert_id,user_id) values(target_expert,target_user) on conflict(expert_id) do nothing;
  else
    if p_id is null or p_payload-array['expert_id']<>'{}'::jsonb then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    -- Shared order: vehicle, request, journey. Invitations never reserve capacity.
    select r.customer_id,r.vehicle_id,r.service into customer,vehicle,service from public.care_requests r where r.id=p_id;
    if found then
      perform 1 from public.vehicles where id=vehicle and owner_id=customer and
        (p_action='revoke_technician_invitation' or archived_at is null) for update;
      if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
      perform 1 from public.care_requests where id=p_id for update;
    else
      select payload into guest from public.care_guest_requests where id=p_id;
      if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
      service:=guest->>'service';
    end if;
    if p_action='invite_technician' then
      insert into public.care_journeys(id,account_request_id,guest_request_id,customer_details)
        values(p_id,case when customer is not null then p_id end,case when customer is null then p_id end,
          case when customer is null then jsonb_build_object('name',guest->>'name','phone',guest->>'phone','suburb',guest->>'suburb','postcode',guest->>'postcode') else '{}'::jsonb end)
        on conflict(id) do nothing;
    end if;
    select * into journey from public.care_journeys where id=p_id for update;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    if journey.state not in ('review','quotes_ready') or journey.expert_id is not null then
      raise exception using errcode='P0001',message='INVALID_TRANSITION';
    end if;
    if p_action='invite_technician' then
      if coalesce(journey.customer_details->>'postcode','') !~ '^[0-9]{4}$' then raise exception using errcode='P0001',message='DETAILS_REQUIRED'; end if;
      if not expert.active or not service=any(expert.services) or not (journey.customer_details->>'postcode')=any(expert.postcodes) or
        expert.insurance_valid_until<(clock_timestamp() at time zone 'Australia/Adelaide')::date or
        not exists(select 1 from public.care_technician_accounts a join public.user_roles r on r.user_id=a.user_id and r.role='technician'
          where a.expert_id=target_expert and a.active) then
        raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE';
      end if;
      insert into public.care_technician_invitations(journey_id,expert_id) values(p_id,target_expert)
        on conflict(journey_id,expert_id) do update set active=true,updated_at=clock_timestamp();
    else
      update public.care_technician_invitations set active=false,updated_at=clock_timestamp() where journey_id=p_id and expert_id=target_expert;
      if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    end if;
  end if;
  result:=jsonb_build_object('expert_id',target_expert,'replayed',false);
  insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
    values(p_actor,'care.'||p_action,'care_expert',target_expert::text,jsonb_build_object('journey_id',p_id));
  insert into public.care_technician_commands(actor_id,idempotency_key,action,journey_id,payload,result) values(p_actor,p_key,p_action,p_id,p_payload,result);
  return result;
exception when invalid_text_representation then raise exception using errcode='P0001',message='VALIDATION_FAILED';
end; $$;

create function public.care_technician_read(p_actor uuid,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare expert public.care_experts; jobs jsonb; profile jsonb;
begin
  if current_user<>'service_role' or p_actor is null or not exists(select 1 from public.user_roles where user_id=p_actor and role='technician') then
    raise exception using errcode='P0001',message='FORBIDDEN';
  end if;
  select e.* into expert from public.care_experts e join public.care_technician_accounts a on a.expert_id=e.id
    where a.user_id=p_actor and a.active and e.active;
  if not found then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  profile:=jsonb_build_object('expert_id',expert.id,'business_name',expert.business_name,'description',expert.description,
    'services',expert.services,'postcodes',expert.postcodes,'insurance_valid_until',expert.insurance_valid_until);
  select coalesce(jsonb_agg(data order by created_at desc,id desc),'[]'::jsonb) into jobs from (
    select j.id,coalesce(r.created_at,g.created_at) as created_at,jsonb_build_object(
      'id',j.id,'kind',case when r.id is not null then 'account' else 'guest' end,
      'vehicle',case when r.id is not null then btrim(v.make||' '||v.model||' '||coalesce(v.year::text,'')) else g.payload->>'vehicle' end,
      'service',coalesce(r.service,g.payload->>'service'),'description',coalesce(r.description,g.payload->>'description'),
      'postcode',coalesce(j.customer_details->>'postcode',''),'state',j.state,
      'access',case when j.expert_id=expert.id then 'selected' else 'invited' end,'created_at',coalesce(r.created_at,g.created_at),
      'appointment',case when j.expert_id=expert.id and j.starts_at is not null then jsonb_build_object('starts_at',j.starts_at,'ends_at',j.ends_at) end,
      'contact',case when p_id is not null and j.expert_id=expert.id and j.state in ('scheduled','in_progress','completed') then
        (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(j.customer_details) where key in ('name','phone','address','suburb','postcode')) end
    ) as data
    from public.care_journeys j
    left join public.care_requests r on r.id=j.account_request_id
    left join public.vehicles v on v.id=r.vehicle_id and v.owner_id=r.customer_id
    left join public.care_guest_requests g on g.id=j.guest_request_id
    where (p_id is null or j.id=p_id) and (r.id is null or v.id is not null) and (
      (j.expert_id=expert.id and j.state in ('booking_requested','scheduled','in_progress','completed','cancellation_requested')) or
      (j.expert_id is null and j.state in ('review','quotes_ready') and (r.id is null or v.archived_at is null) and
        coalesce(r.service,g.payload->>'service')=any(expert.services) and (j.customer_details->>'postcode')=any(expert.postcodes) and
        expert.insurance_valid_until>=(clock_timestamp() at time zone 'Australia/Adelaide')::date and
        exists(select 1 from public.care_technician_invitations i where i.journey_id=j.id and i.expert_id=expert.id and i.active)))
    order by created_at desc,j.id desc limit 51
  ) allowed;
  if p_id is not null then
    if jsonb_array_length(jobs)<>1 then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    return jsonb_build_object('profile',profile,'job',jobs->0);
  end if;
  return jsonb_build_object('profile',profile,'jobs',(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) from jsonb_array_elements(jobs) with ordinality x(value,ord) where ord<=50),'has_more',jsonb_array_length(jobs)>50);
end; $$;

revoke all on function public.care_technician_admin_command(uuid,uuid,text,uuid,jsonb),public.care_technician_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.care_technician_admin_command(uuid,uuid,text,uuid,jsonb),public.care_technician_read(uuid,uuid) to service_role;
commit;
