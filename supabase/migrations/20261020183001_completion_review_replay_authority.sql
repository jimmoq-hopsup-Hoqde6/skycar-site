begin;

-- #66 follow-up: current source and role authority must precede every replay.
-- CLI-created file ordered after the existing future-dated draft migration.
-- Preserve customer-only actor policy: a customer also holding admin/technician
-- privileges is not authorised for completion confirmation or private issues.
-- Align lock acquisition with care_journey_command to avoid cross-RPC inversion.
create or replace function public.care_customer_completion_review_command(
  p_actor uuid,p_guest_key uuid,p_key uuid,p_action text,p_id uuid,p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  scope_value text; source_customer uuid; source_vehicle uuid; guest_payload jsonb;
  journey public.care_journeys; prior public.care_journey_commands;
  is_customer boolean:=false; has_privileged_role boolean:=false; details text; at_time timestamptz:=clock_timestamp(); result jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
  if p_key is null or p_id is null or p_action is null or p_action not in ('confirm_completion','report_completion_issue') or
    p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
  if p_actor is not null then
    select exists(select 1 from public.user_roles where user_id=p_actor and role='customer'),
      exists(select 1 from public.user_roles where user_id=p_actor and role in ('admin','technician'))
      into is_customer,has_privileged_role;
  end if;

  select r.customer_id,r.vehicle_id into source_customer,source_vehicle
  from public.care_requests r join public.vehicles v on v.id=r.vehicle_id and v.owner_id=r.customer_id
  where r.id=p_id;
  if found then
    if p_actor is null or p_actor<>source_customer or not is_customer or has_privileged_role or p_guest_key is not null then
      raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    scope_value:='user:'||p_actor::text;

  else
    if p_actor is not null or p_guest_key is null then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    select payload into guest_payload from public.care_guest_requests where id=p_id and idempotency_key=p_guest_key;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    scope_value:='guest:'||p_id::text;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(scope_value||':'||p_key::text,0));
  -- Shared order with care_journey_command: actor/key -> vehicle -> request -> journey.
  if source_customer is not null then
    perform 1 from public.vehicles where id=source_vehicle and owner_id=source_customer
      and archived_at is null for update;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
    perform 1 from public.care_requests where id=p_id and customer_id=source_customer
      and vehicle_id=source_vehicle for update;
    if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  end if;


  -- The advisory/row locks may have waited behind an authority change.
  if p_actor is not null and (
    not exists(select 1 from public.user_roles where user_id=p_actor and role='customer') or
    exists(select 1 from public.user_roles where user_id=p_actor and role in ('admin','technician'))
  ) then raise exception using errcode='P0001',message='NOT_FOUND'; end if;

  select * into prior from public.care_journey_commands where actor_scope=scope_value and idempotency_key=p_key;
  if found then
    if prior.action<>p_action or prior.journey_id is distinct from p_id or prior.payload<>p_payload then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;


  select * into journey from public.care_journeys where id=p_id for update;
  if not found or (source_customer is not null and journey.account_request_id is null) or
    (source_customer is null and journey.guest_request_id is null) then
    raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if journey.state<>'completed' or journey.completion_review_state is distinct from 'awaiting_review' or
    journey.completion_evidence is null or jsonb_typeof(journey.completion_evidence)<>'array' or
    jsonb_array_length(journey.completion_evidence) not between 1 and 3 then
    raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;

  if p_action='confirm_completion' then
    if p_payload<>'{}'::jsonb then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    update public.care_journeys set completion_review_state='confirmed',completion_issue_details=null,
      revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    insert into public.care_journey_events(journey_id,type,occurred_at)
      values(p_id,'completion_confirmed',at_time);
  else
    if not (p_payload ? 'details') or p_payload-array['details']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'details') is distinct from 'string' then
      raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    details:=btrim(p_payload->>'details');
    if length(details) not between 10 and 2000 then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    update public.care_journeys set completion_review_state='issue_reported',completion_issue_details=details,
      revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
    insert into public.care_journey_events(journey_id,type,occurred_at)
      values(p_id,'completion_issue_reported',at_time);
  end if;

  result:=jsonb_build_object('id',p_id,'state','completed','revision',journey.revision,
    'review_state',journey.completion_review_state,'replayed',false);
  insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
    values(p_actor,'care.'||p_action,'care_journey',p_id::text,
      jsonb_build_object('actor_scope',scope_value,'review_state',journey.completion_review_state));
  insert into public.care_journey_commands(actor_scope,idempotency_key,action,journey_id,payload,result)
    values(scope_value,p_key,p_action,p_id,p_payload,result);
  return result;
end; $$;


commit;
