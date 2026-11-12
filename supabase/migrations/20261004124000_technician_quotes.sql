begin;

alter table public.care_reviewed_quotes add column submitted_by_technician uuid references auth.users(id);
alter table public.care_journey_events drop constraint care_journey_events_type_check;
alter table public.care_journey_events add constraint care_journey_events_type_check check(type in (
  'details_updated','quote_issued','quote_withdrawn','booking_requested','booking_confirmed',
  'work_started','work_completed','cancellation_requested','booking_cancelled'
));

-- Customer selection rechecks the live authority of technician-origin proposals.
-- Existing operations-authored quotes retain their established contract.
create function public.care_technician_quote_selection_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.submitted_by_technician is not null and not exists(
    select 1 from public.care_technician_invitations i
    join public.care_technician_accounts a on a.expert_id=i.expert_id and a.active
    join public.user_roles r on r.user_id=a.user_id and r.role='technician'
    where i.journey_id=new.journey_id and i.expert_id=new.expert_id and i.active and a.user_id=new.submitted_by_technician
  ) then raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
  return new;
end; $$;
create trigger care_technician_quote_selection_guard before update of status on public.care_reviewed_quotes
for each row when(new.status='selected' and old.status is distinct from new.status)
execute function public.care_technician_quote_selection_guard();

create function public.care_technician_invitation_withdraw() returns trigger
language plpgsql security invoker set search_path='' as $$
declare changed integer; next_state text; at_time timestamptz:=clock_timestamp();
begin
  -- Command paths already hold vehicle/request/journey before changing invitations.
  update public.care_reviewed_quotes set status='withdrawn' where journey_id=new.journey_id and expert_id=new.expert_id
    and submitted_by_technician is not null and status='issued';
  get diagnostics changed=row_count;
  if changed>0 then
    next_state:=case when exists(select 1 from public.care_reviewed_quotes where journey_id=new.journey_id and status='issued') then 'quotes_ready' else 'review' end;
    update public.care_journeys set state=next_state,revision=revision+1,updated_at=at_time
      where id=new.journey_id and state in ('review','quotes_ready') and expert_id is null;
    update public.care_requests set quote_state=case when next_state='quotes_ready' then 'issued' else 'declined' end,updated_at=at_time
      where id=new.journey_id;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(new.journey_id,'quote_withdrawn',at_time);
  end if;
  return new;
end; $$;
create trigger care_technician_invitation_withdraw after update of active on public.care_technician_invitations
for each row when(old.active and not new.active) execute function public.care_technician_invitation_withdraw();

create function public.care_technician_job_command(p_actor uuid,p_key uuid,p_action text,p_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  expert public.care_experts; prior public.care_technician_commands; journey public.care_journeys;
  source_customer uuid; source_vehicle uuid; source_service text; at_time timestamptz;
  expires_time timestamptz; start_time timestamptz; end_time timestamptz; scope_summary text; quote_id uuid; result jsonb;
begin
  if current_user<>'service_role' or p_actor is null or not exists(select 1 from public.user_roles where user_id=p_actor and role='technician') then
    raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  select e.* into expert from public.care_experts e join public.care_technician_accounts a on a.expert_id=e.id
    where a.user_id=p_actor and a.active and e.active for share of e,a;
  if not found then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_key is null or p_id is null or p_action is null or p_action not in ('quote','decline') or p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('care:technician-command:'||p_actor::text||':'||p_key::text,0));
  select r.customer_id,r.vehicle_id,r.service into source_customer,source_vehicle,source_service
    from public.care_requests r where r.id=p_id;
  if found then
    perform 1 from public.vehicles where id=source_vehicle and owner_id=source_customer and archived_at is null for update;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    perform 1 from public.care_requests where id=p_id for update;
  else
    select payload->>'service' into source_service from public.care_guest_requests where id=p_id;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  end if;
  -- Replay after own decline is valid; role/link/source still have to be current.
  select * into prior from public.care_technician_commands where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if prior.action<>p_action or prior.journey_id is distinct from p_id or prior.payload<>p_payload then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;
  select * into journey from public.care_journeys where id=p_id for update;
  if not found or not exists(select 1 from public.care_technician_invitations where journey_id=p_id and expert_id=expert.id and active) then
    raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if journey.state not in ('review','quotes_ready') or journey.expert_id is not null then
    raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
  if not source_service=any(expert.services) or not (journey.customer_details->>'postcode')=any(expert.postcodes) or
    expert.insurance_valid_until<(clock_timestamp() at time zone 'Australia/Adelaide')::date then
    raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
  at_time:=clock_timestamp();
  if p_action='decline' then
    if p_payload<>'{}'::jsonb then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    update public.care_technician_invitations set active=false,updated_at=at_time where journey_id=p_id and expert_id=expert.id;
    select * into journey from public.care_journeys where id=p_id;
  else
    if not (p_payload ?& array['scope_summary','total_price_cents','expires_at','starts_at','ends_at']) or
      p_payload-array['scope_summary','total_price_cents','expires_at','starts_at','ends_at']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'scope_summary') is distinct from 'string' or jsonb_typeof(p_payload->'total_price_cents') is distinct from 'number' or
      jsonb_typeof(p_payload->'expires_at') is distinct from 'string' or jsonb_typeof(p_payload->'starts_at') is distinct from 'string' or
      jsonb_typeof(p_payload->'ends_at') is distinct from 'string' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    expires_time:=(p_payload->>'expires_at')::timestamptz; start_time:=(p_payload->>'starts_at')::timestamptz; end_time:=(p_payload->>'ends_at')::timestamptz;
    scope_summary:=btrim(p_payload->>'scope_summary');
    if (p_payload->>'total_price_cents') !~ '^[0-9]+$' or length(scope_summary) not between 10 and 2000 or
      (p_payload->>'total_price_cents')::numeric not between 1 and 100000000 or
      p_payload->>'expires_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' or
      p_payload->>'starts_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' or
      p_payload->>'ends_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' or
      not isfinite(expires_time) or not isfinite(start_time) or not isfinite(end_time) or
      expires_time<=at_time or expires_time>start_time or start_time<=at_time or end_time<=start_time or end_time-start_time>interval '7 days' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    if expert.insurance_valid_until<(end_time at time zone 'Australia/Adelaide')::date then
      raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
    update public.care_reviewed_quotes set status='superseded' where journey_id=p_id and expert_id=expert.id and status='issued';
    insert into public.care_reviewed_quotes(journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,expires_at,starts_at,ends_at,submitted_by_technician)
      values(p_id,expert.id,expert.business_name,expert.description,scope_summary,(p_payload->>'total_price_cents')::integer,expires_time,start_time,end_time,p_actor) returning id into quote_id;
    update public.care_journeys set state='quotes_ready',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    update public.care_requests set quote_state='issued',updated_at=at_time where id=p_id;
    insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'quote_issued',at_time);
  end if;
  result:=jsonb_build_object('id',p_id,'action',p_action,'state',journey.state,'quote_id',quote_id,'replayed',false);
  insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
    values(p_actor,'care.technician_'||p_action,'care_journey',p_id::text,jsonb_build_object('expert_id',expert.id,'quote_id',quote_id));
  insert into public.care_technician_commands(actor_id,idempotency_key,action,journey_id,payload,result) values(p_actor,p_key,p_action,p_id,p_payload,result);
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception using errcode='P0001',message='VALIDATION_FAILED';
end; $$;

revoke all on function public.care_technician_quote_selection_guard(),public.care_technician_invitation_withdraw(),public.care_technician_job_command(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.care_technician_quote_selection_guard(),public.care_technician_invitation_withdraw(),public.care_technician_job_command(uuid,uuid,text,uuid,jsonb) to service_role;
commit;
