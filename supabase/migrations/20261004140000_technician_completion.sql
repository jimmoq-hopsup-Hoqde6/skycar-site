begin;
create or replace function public.care_technician_work_command(p_actor uuid,p_key uuid,p_action text,p_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 expert public.care_experts; journey public.care_journeys; prior public.care_technician_commands;
 source_customer uuid; source_vehicle uuid; source_service text; at_time timestamptz; result jsonb; evidence_item jsonb; expected_slot integer:=1;
begin
 if current_user<>'service_role' or p_actor is null or not exists(select 1 from public.user_roles where user_id=p_actor and role='technician') then
  raise exception using errcode='P0001',message='FORBIDDEN'; end if;
 select e.* into expert from public.care_experts e join public.care_technician_accounts a on a.expert_id=e.id
  where a.user_id=p_actor and a.active and e.active for share of e,a;
 if not found then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
 if p_key is null or p_id is null or p_action is null or p_action not in ('start','complete') or p_payload is null or jsonb_typeof(p_payload)<>'object' or (p_action='start' and p_payload<>'{}'::jsonb) then
  raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('care:technician-command:'||p_actor::text||':'||p_key::text,0));
 select customer_id,vehicle_id,service into source_customer,source_vehicle,source_service from public.care_requests where id=p_id;
 if found then
  perform 1 from public.vehicles where id=source_vehicle and owner_id=source_customer and archived_at is null for update;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  perform 1 from public.care_requests where id=p_id for update;
 else
  select payload->>'service' into source_service from public.care_guest_requests where id=p_id;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 end if;
 select * into journey from public.care_journeys where id=p_id for update;
 if not found or journey.expert_id is distinct from expert.id or not exists(
  select 1 from public.care_reviewed_quotes where id=journey.selected_quote_id and journey_id=p_id and expert_id=expert.id and status='selected'
 ) then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 select * into prior from public.care_technician_commands where actor_id=p_actor and idempotency_key=p_key;
 if found then
  if prior.action<>p_action or prior.journey_id is distinct from p_id or prior.payload<>p_payload then
   raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 at_time:=clock_timestamp();
 if p_action='start' then
 if journey.state<>'scheduled' or journey.starts_at is null or journey.ends_at is null or journey.starts_at>at_time then
  raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
 if not source_service=any(expert.services) or not coalesce((journey.customer_details->>'postcode')=any(expert.postcodes),false) or
  expert.insurance_valid_until<(at_time at time zone 'Australia/Adelaide')::date or
  expert.insurance_valid_until<(journey.ends_at at time zone 'Australia/Adelaide')::date then
  raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
  update public.care_journeys set state='in_progress',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
  update public.care_requests set fulfilment_state='in_progress',updated_at=at_time where id=p_id;
  insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'work_started',at_time);
 else
  if journey.state<>'in_progress' then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
  if not (p_payload ? 'evidence') or p_payload-array['evidence']<>'{}'::jsonb or jsonb_typeof(p_payload->'evidence') is distinct from 'array' then
   raise exception using errcode='P0001',message='EVIDENCE_REQUIRED'; end if;
  if jsonb_array_length(p_payload->'evidence') not between 1 and 3 then raise exception using errcode='P0001',message='EVIDENCE_REQUIRED'; end if;
  for evidence_item in select value from jsonb_array_elements(p_payload->'evidence') loop
   if jsonb_typeof(evidence_item) is distinct from 'object' or not (evidence_item ?& array['slot','mime_type','size_bytes','sha256']) or
    evidence_item-array['slot','mime_type','size_bytes','sha256']<>'{}'::jsonb or
    jsonb_typeof(evidence_item->'slot') is distinct from 'number' or jsonb_typeof(evidence_item->'mime_type') is distinct from 'string' or
    jsonb_typeof(evidence_item->'size_bytes') is distinct from 'number' or jsonb_typeof(evidence_item->'sha256') is distinct from 'string' or
    evidence_item->>'slot' !~ '^[0-9]+$' or evidence_item->>'size_bytes' !~ '^[0-9]+$' then
     raise exception using errcode='P0001',message='EVIDENCE_REQUIRED'; end if;
   if (evidence_item->>'slot')::numeric<>expected_slot or evidence_item->>'mime_type' not in ('image/jpeg','image/png','image/webp') or
    (evidence_item->>'size_bytes')::numeric not between 128 and 900000 or evidence_item->>'sha256' !~ '^[0-9a-f]{64}$' then
     raise exception using errcode='P0001',message='EVIDENCE_REQUIRED'; end if;
   expected_slot:=expected_slot+1;
  end loop;
  update public.care_journeys set state='completed',completion_evidence=p_payload->'evidence',revision=revision+1,updated_at=at_time where id=p_id returning * into journey;
  update public.care_requests set fulfilment_state='completed',updated_at=at_time where id=p_id;
  if source_vehicle is not null then
   insert into public.vehicle_history(vehicle_id,event_type,occurred_at,source,payload)
    values(source_vehicle,'care_service_completed',at_time,'skycar_care',jsonb_build_object('journey_id',p_id,'expert_id',journey.expert_id,'quote_id',journey.selected_quote_id));
  end if;
  insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'work_completed',at_time);
 end if;
 result:=jsonb_build_object('id',p_id,'action',p_action,'state',journey.state,'quote_id',null,'replayed',false);
 insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_actor,'care.technician_'||p_action,'care_journey',p_id::text,jsonb_build_object('expert_id',expert.id));
 insert into public.care_technician_commands(actor_id,idempotency_key,action,journey_id,payload,result)
  values(p_actor,p_key,p_action,p_id,p_payload,result);
 return result;
end; $$;
revoke all on function public.care_technician_work_command(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.care_technician_work_command(uuid,uuid,text,uuid,jsonb) to service_role;

-- Historical selected-job reads can survive archival; new completion uploads cannot.
create function public.care_technician_completion_upload_access(p_actor uuid,p_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb;
begin
 if current_user<>'service_role' then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
 snapshot:=public.care_technician_read(p_actor,p_id);
 if snapshot->'job'->>'access' is distinct from 'selected' then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 if snapshot->'job'->>'state' is distinct from 'in_progress' then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
 if exists(select 1 from public.care_requests r join public.vehicles v on v.id=r.vehicle_id where r.id=p_id and (v.owner_id is distinct from r.customer_id or v.archived_at is not null)) then
  raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 return true;
end; $$;
revoke all on function public.care_technician_completion_upload_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.care_technician_completion_upload_access(uuid,uuid) to service_role;
commit;
