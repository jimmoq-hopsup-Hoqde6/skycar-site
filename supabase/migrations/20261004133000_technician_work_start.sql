begin;
create function public.care_technician_work_command(p_actor uuid,p_key uuid,p_action text,p_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 expert public.care_experts; journey public.care_journeys; prior public.care_technician_commands;
 source_customer uuid; source_vehicle uuid; source_service text; at_time timestamptz; result jsonb;
begin
 if current_user<>'service_role' or p_actor is null or not exists(select 1 from public.user_roles where user_id=p_actor and role='technician') then
  raise exception using errcode='P0001',message='FORBIDDEN'; end if;
 select e.* into expert from public.care_experts e join public.care_technician_accounts a on a.expert_id=e.id
  where a.user_id=p_actor and a.active and e.active for share of e,a;
 if not found then raise exception using errcode='P0001',message='FORBIDDEN'; end if;
 if p_key is null or p_id is null or p_action is distinct from 'start' or p_payload is distinct from '{}'::jsonb then
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
 if journey.state<>'scheduled' or journey.starts_at is null or journey.ends_at is null or journey.starts_at>at_time then
  raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
 if not source_service=any(expert.services) or not coalesce((journey.customer_details->>'postcode')=any(expert.postcodes),false) or
  expert.insurance_valid_until<(at_time at time zone 'Australia/Adelaide')::date or
  expert.insurance_valid_until<(journey.ends_at at time zone 'Australia/Adelaide')::date then
  raise exception using errcode='P0001',message='EXPERT_UNAVAILABLE'; end if;
 update public.care_journeys set state='in_progress',revision=revision+1,updated_at=at_time where id=p_id;
 update public.care_requests set fulfilment_state='in_progress',updated_at=at_time where id=p_id;
 insert into public.care_journey_events(journey_id,type,occurred_at) values(p_id,'work_started',at_time);
 result:=jsonb_build_object('id',p_id,'action',p_action,'state','in_progress','quote_id',null,'replayed',false);
 insert into public.audit_events(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_actor,'care.technician_start','care_journey',p_id::text,jsonb_build_object('expert_id',expert.id));
 insert into public.care_technician_commands(actor_id,idempotency_key,action,journey_id,payload,result)
  values(p_actor,p_key,p_action,p_id,p_payload,result);
 return result;
end; $$;
revoke all on function public.care_technician_work_command(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.care_technician_work_command(uuid,uuid,text,uuid,jsonb) to service_role;
commit;
