begin;

alter table public.vehicles add column revision integer not null default 1 check (revision > 0);

create table public.garage_mutations (
  actor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  command text not null,
  vehicle_id uuid,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);
alter table public.garage_mutations enable row level security;
revoke all on public.garage_mutations from public, anon, authenticated;

-- Clients cannot bypass revision, idempotency and audit rules via PostgREST.
revoke insert, update, delete on public.vehicles from public, anon, authenticated;
grant select on public.vehicles to authenticated;
-- A client must not forge the system-created history shown by the Garage UI.
revoke insert, update, delete on public.vehicle_history from public, anon, authenticated;
grant select on public.vehicle_history to authenticated;

create function public.garage_mutate_vehicle(
  p_command text, p_vehicle_id uuid, p_payload jsonb, p_key uuid, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  prior public.garage_mutations%rowtype;
  vehicle public.vehicles%rowtype;
  allowed text[];
  expected integer;
  result jsonb;
  changed text[];
  event_name text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_command is null or p_command not in ('create', 'update', 'archive')
     or p_key is null or p_request_id is null or p_payload is null
     or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 8192
     or (p_command = 'create' and p_vehicle_id is not null)
     or (p_command <> 'create' and p_vehicle_id is null)
  then raise exception 'VALIDATION_FAILED'; end if;

  allowed := case when p_command = 'archive' then array['expected_revision']
    when p_command = 'update' then array['make','model','variant','year','registration','registration_state','expected_revision']
    else array['make','model','variant','year','registration','registration_state'] end;
  if exists (select 1 from jsonb_object_keys(p_payload) k where not (k = any(allowed)))
  then raise exception 'VALIDATION_FAILED'; end if;

  if p_command <> 'create' then
    if jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
       or (p_payload->>'expected_revision') !~ '^[0-9]{1,10}$'
    then raise exception 'VALIDATION_FAILED'; end if;
    if (p_payload->>'expected_revision')::numeric not between 1 and 2147483646
    then raise exception 'VALIDATION_FAILED'; end if;
    expected := (p_payload->>'expected_revision')::integer;
  end if;
  if p_command <> 'archive' then
    if jsonb_typeof(p_payload->'make') is distinct from 'string'
       or jsonb_typeof(p_payload->'model') is distinct from 'string'
       or length(btrim(p_payload->>'make')) not between 1 and 80
       or length(btrim(p_payload->>'model')) not between 1 and 80
       or (p_payload->>'make') ~ '[[:cntrl:]]' or (p_payload->>'model') ~ '[[:cntrl:]]'
    then raise exception 'VALIDATION_FAILED'; end if;
    if p_payload->>'variant' is not null and (
       jsonb_typeof(p_payload->'variant') <> 'string'
       or length(btrim(p_payload->>'variant')) not between 1 and 120
       or (p_payload->>'variant') ~ '[[:cntrl:]]')
    then raise exception 'VALIDATION_FAILED'; end if;
    if p_payload->>'year' is not null then
      if jsonb_typeof(p_payload->'year') <> 'number' or (p_payload->>'year') !~ '^[0-9]{4}$'
      then raise exception 'VALIDATION_FAILED'; end if;
      if (p_payload->>'year')::integer not between 1886 and 2200
      then raise exception 'VALIDATION_FAILED'; end if;
    end if;
    if p_payload->>'registration' is not null and (
       jsonb_typeof(p_payload->'registration') <> 'string'
       or btrim(p_payload->>'registration') !~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,15}$')
    then raise exception 'VALIDATION_FAILED'; end if;
    if p_payload->>'registration_state' is not null and (
       jsonb_typeof(p_payload->'registration_state') <> 'string'
       or (p_payload->>'registration_state') not in ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA'))
    then raise exception 'VALIDATION_FAILED'; end if;
  end if;

  -- Same actor/key serialises even when two first attempts arrive together.
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_key::text, 0));
  select * into prior from public.garage_mutations where actor_id = actor and idempotency_key = p_key;
  if found then
    if prior.command <> p_command or prior.vehicle_id is distinct from p_vehicle_id or prior.payload <> p_payload
    then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.result;
  end if;

  if p_command = 'create' then
    insert into public.vehicles(owner_id,make,model,variant,year,registration,registration_state)
    values (actor,btrim(p_payload->>'make'),btrim(p_payload->>'model'),btrim(p_payload->>'variant'),
      (p_payload->>'year')::smallint,upper(btrim(p_payload->>'registration')),p_payload->>'registration_state')
    returning * into vehicle;
    changed := array['make','model','variant','year','registration','registration_state'];
    event_name := 'vehicle_added';
  else
    select * into vehicle from public.vehicles where id = p_vehicle_id and owner_id = actor for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if vehicle.archived_at is not null then raise exception 'VEHICLE_ARCHIVED'; end if;
    if vehicle.revision <> expected then raise exception 'REVISION_CONFLICT'; end if;
    if p_command = 'archive' then
      update public.vehicles set archived_at = clock_timestamp(), updated_at = clock_timestamp(), revision = revision + 1
      where id = vehicle.id returning * into vehicle;
      changed := array['archived_at'];
      event_name := 'vehicle_archived';
    else
      select coalesce(array_agg(k), array[]::text[]) into changed
      from unnest(array['make','model','variant','year','registration','registration_state']) k
      where (to_jsonb(vehicle)->k) is distinct from (p_payload->k);
      update public.vehicles set make = btrim(p_payload->>'make'), model = btrim(p_payload->>'model'),
        variant = btrim(p_payload->>'variant'), year = (p_payload->>'year')::smallint,
        registration = upper(btrim(p_payload->>'registration')), registration_state = p_payload->>'registration_state',
        updated_at = clock_timestamp(), revision = revision + 1
      where id = vehicle.id returning * into vehicle;
      event_name := 'vehicle_updated';
    end if;
  end if;

  result := to_jsonb(vehicle) - 'owner_id';
  insert into public.vehicle_history(vehicle_id,event_type,occurred_at,source,payload)
  values (vehicle.id,event_name,vehicle.updated_at,'garage',jsonb_build_object('revision',vehicle.revision,'changed_fields',changed));
  insert into public.audit_events(actor_user_id,action,resource_type,resource_id,request_id,metadata)
  values (actor,event_name,'vehicle',vehicle.id::text,p_request_id::text,jsonb_build_object('revision',vehicle.revision,'changed_fields',changed));
  insert into public.garage_mutations(actor_id,idempotency_key,command,vehicle_id,payload,result)
  values (actor,p_key,p_command,p_vehicle_id,p_payload,result);
  return result;
end;
$$;
revoke all on function public.garage_mutate_vehicle(text,uuid,jsonb,uuid,uuid) from public, anon;
grant execute on function public.garage_mutate_vehicle(text,uuid,jsonb,uuid,uuid) to authenticated;

commit;
