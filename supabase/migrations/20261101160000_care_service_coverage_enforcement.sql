begin;

-- Server-side service-area enforcement at request creation (care_submit_request and
-- care_submit_guest_request). Forward-only: nothing already applied is edited; the two
-- functions are replaced with CREATE OR REPLACE (same signatures, owners and grants).
--
-- Source of truth: src/server/care/coverage-areas.json (PR #82). The table below is a
-- GENERATED mirror of it, produced by scripts/coverage-data/build-coverage-migration.mjs through
-- the same buildCoverageIndex() the /api/v1/care/coverage resolver uses. tests/unit/coverage-
-- enforcement.test.mjs and the combined PostgreSQL test fail if the table and the JSON differ.
-- To change coverage, add a NEW migration (name contains care_service_coverage) holding the
-- regenerated seed block; never edit this one.

create table public.care_service_coverage (
  service text not null check (service in ('repair','cleaning')),
  postcode text not null check (postcode ~ '^[0-9]{4}$'),
  primary key (service, postcode)
);
create table public.care_service_coverage_meta (
  singleton boolean primary key default true check (singleton),
  area_id text not null check (length(area_id) between 1 and 100),
  version text not null check (length(version) between 1 and 100),
  updated_at timestamptz not null default clock_timestamp()
);
-- No browser or service role can read or write the list directly; only the definer function
-- below reads it. RLS is enabled with no policy as a second barrier.
alter table public.care_service_coverage enable row level security;
alter table public.care_service_coverage_meta enable row level security;
revoke all on public.care_service_coverage, public.care_service_coverage_meta from public, anon, authenticated, service_role;

-- Deploy-order compatibility switch (one row). While accept_legacy_create is true,
-- care_submit_request still CREATES from the legacy four-key payload (no postcode) so an app that
-- has not been redeployed yet, or a browser tab that still runs the old form, keeps working when
-- this migration ships first. Such a create carries no postcode and therefore cannot be
-- checked against the service area: it is a temporary, deliberate gap. Replaying an existing
-- key never depends on the switch. Close it in a NEW migration once the app that sends the
-- postcode is live (docs/contracts/service-coverage.md, "Deploy order"):
--   update public.care_service_coverage_compat set accept_legacy_create = false;
create table public.care_service_coverage_compat (
  singleton boolean primary key default true check (singleton),
  accept_legacy_create boolean not null default true
);
insert into public.care_service_coverage_compat(singleton, accept_legacy_create) values (true, true);
alter table public.care_service_coverage_compat enable row level security;
revoke all on public.care_service_coverage_compat from public, anon, authenticated, service_role;

-- BEGIN GENERATED COVERAGE SEED (scripts/coverage-data/build-coverage-migration.mjs)
delete from public.care_service_coverage;
insert into public.care_service_coverage(service, postcode)
  select 'cleaning', code from unnest(array[
    '5000','5006','5007','5008','5009','5010','5011','5012','5013','5014','5015','5016',
    '5017','5018','5019','5020','5021','5022','5023','5024','5025','5031','5032','5033',
    '5034','5035','5037','5038','5039','5040','5041','5042','5043','5044','5045','5046',
    '5047','5048','5049','5050','5051','5052','5061','5062','5063','5064','5065','5066',
    '5067','5068','5069','5070','5072','5073','5074','5075','5076','5081','5082','5083',
    '5084','5085','5086','5087','5088','5089','5090','5091','5092','5093','5094','5095',
    '5096','5097','5098','5106','5107','5108','5109','5110','5111','5112','5113','5114',
    '5115','5116','5117','5118','5120','5121','5125','5126','5127','5131','5132','5133',
    '5134','5136','5137','5138','5139','5140','5141','5142','5144','5150','5151','5152',
    '5153','5154','5155','5156','5157','5158','5159','5160','5161','5162','5163','5164',
    '5165','5166','5167','5168','5169','5170','5171','5172','5173','5174','5201','5231',
    '5232','5233','5234','5240','5241','5242','5243','5244','5245','5250','5251','5252',
    '5371','5501','5950'
  ]) as code;
insert into public.care_service_coverage(service, postcode)
  select 'repair', code from unnest(array[
    '5000','5006','5007','5008','5009','5010','5011','5012','5013','5014','5015','5016',
    '5017','5018','5019','5020','5021','5022','5023','5024','5025','5031','5032','5033',
    '5034','5035','5037','5038','5039','5040','5041','5042','5043','5044','5045','5046',
    '5047','5048','5049','5050','5051','5052','5061','5062','5063','5064','5065','5066',
    '5067','5068','5069','5070','5072','5073','5074','5075','5076','5081','5082','5083',
    '5084','5085','5086','5087','5088','5089','5090','5091','5092','5093','5094','5095',
    '5096','5097','5098','5106','5107','5108','5109','5110','5111','5112','5113','5114',
    '5115','5116','5117','5118','5120','5121','5125','5126','5127','5131','5132','5133',
    '5134','5136','5137','5138','5139','5140','5141','5142','5144','5150','5151','5152',
    '5153','5154','5155','5156','5157','5158','5159','5160','5161','5162','5163','5164',
    '5165','5166','5167','5168','5169','5170','5171','5172','5173','5174','5201','5231',
    '5232','5233','5234','5240','5241','5242','5243','5244','5245','5250','5251','5252',
    '5371','5501','5950'
  ]) as code;
insert into public.care_service_coverage_meta(singleton, area_id, version)
  values (true, 'adelaide-metro-and-hills', '2026-11-01')
  on conflict (singleton) do update set area_id = excluded.area_id, version = excluded.version, updated_at = clock_timestamp();
-- END GENERATED COVERAGE SEED

-- One decision, shared by both creation paths. Plain reads only (no locks), so it can run at
-- any point of the canonical lock order. Raises:
--   VALIDATION_FAILED     malformed postcode or unknown service
--   COVERAGE_UNAVAILABLE  the list is missing/empty for that service (fail closed: never read
--                         as "covered" and never as "out of area")
--   OUT_OF_AREA           a completed decision: the postcode is not serviced
create function public.care_assert_postcode_covered(p_service text, p_postcode text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_service is null or p_service not in ('repair','cleaning')
    or p_postcode is null or p_postcode !~ '^[0-9]{4}$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if not exists (select 1 from public.care_service_coverage_meta)
    or not exists (select 1 from public.care_service_coverage where service = p_service) then
    raise exception using errcode = 'P0001', message = 'COVERAGE_UNAVAILABLE';
  end if;
  if not exists (select 1 from public.care_service_coverage where service = p_service and postcode = p_postcode) then
    raise exception using errcode = 'P0001', message = 'OUT_OF_AREA';
  end if;
end;
$$;
revoke all on function public.care_assert_postcode_covered(text, text) from public, anon, authenticated;
-- care_submit_request is a definer function and needs no grant; the guest function runs as
-- service_role (invoker), which is the only role that may call the helper directly.
grant execute on function public.care_assert_postcode_covered(text, text) to service_role;

-- Authenticated creation. Same body, lock order and results as before
-- (advisory -> vehicle -> care_requests/commands/events), plus:
--   * the payload is the four legacy keys plus a 4-digit `postcode` (five keys). The legacy
--     four-key payload (no postcode) is still a valid SHAPE: it is how an old client replays, and
--     while care_service_coverage_compat.accept_legacy_create is true it may also create;
--   * after the idempotency replay lookup and BEFORE the vehicle lock, a request with a postcode
--     must be in the list for the service, so an out-of-area request locks and writes nothing;
--   * replay decides on the four request fields only when either side has no postcode: a retry of a
--     request created before this migration (or by an old client) returns the request already
--     created, whichever shape the retry uses, never a new one and never VALIDATION_FAILED. Two
--     different postcodes under one key still conflict.
create or replace function public.care_submit_request(p_key uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.care_require_customer();
  command public.care_request_commands;
  request public.care_requests;
  policy public.care_response_policy;
  vehicle uuid;
  normalized jsonb;
  stored_core jsonb;
  incoming_core jsonb;
  at_time timestamptz := clock_timestamp();
begin
  if p_key is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or
    not (p_payload ?& array['vehicle_id','service','description','preferred_window']) or
    p_payload - array['vehicle_id','service','description','preferred_window','postcode'] <> '{}'::jsonb or
    jsonb_typeof(p_payload->'vehicle_id') <> 'string' or
    jsonb_typeof(p_payload->'service') <> 'string' or
    jsonb_typeof(p_payload->'description') <> 'string' or
    jsonb_typeof(p_payload->'preferred_window') <> 'string' or
    (p_payload ? 'postcode' and jsonb_typeof(p_payload->'postcode') <> 'string') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  begin vehicle := (p_payload->>'vehicle_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end;
  if p_payload->>'service' not in ('repair','cleaning') or
    p_payload->>'preferred_window' not in ('one_to_two_business_days','seven_to_fourteen_days','flexible') or
    (p_payload ? 'postcode' and p_payload->>'postcode' !~ '^[0-9]{4}$') or
    length(btrim(p_payload->>'description')) not between 10 and 2000 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  normalized := p_payload || jsonb_build_object('vehicle_id', vehicle, 'description', btrim(p_payload->>'description'));
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':submit:' || p_key::text, 0));
  select * into command from public.care_request_commands
    where customer_id = actor and operation = 'submit' and idempotency_key = p_key;
  if found then
    -- Compare the postcode only when both the stored command and this call carry one: a
    -- command created without it (before this migration, or by an old client) replays against the
    -- four request fields, and a legacy-shaped retry of a command that has one does too.
    if command.payload ? 'postcode' and normalized ? 'postcode' then
      stored_core := command.payload; incoming_core := normalized;
    else
      stored_core := command.payload - 'postcode'; incoming_core := normalized - 'postcode';
    end if;
    if stored_core <> incoming_core then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('request', public.care_get_request(command.request_id), 'replayed', true);
  end if;
  -- Creation only: decide coverage before any row lock or write. A legacy four-key create has no
  -- postcode to check; it is allowed only while the compatibility switch is on.
  if normalized ? 'postcode' then
    perform public.care_assert_postcode_covered(normalized->>'service', normalized->>'postcode');
  elsif not coalesce((select accept_legacy_create from public.care_service_coverage_compat), false) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
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
revoke all on function public.care_submit_request(uuid, jsonb) from public, anon;
grant execute on function public.care_submit_request(uuid, jsonb) to authenticated;

-- Guest intake. Unchanged except one decision after the idempotency replay and before the rate
-- limits and the insert: an out-of-area postcode creates no row, so the route (which stores
-- photos only after this call returns a receipt) never reaches Storage for it. The function
-- keeps its existing mode (invoker, service_role only, search_path '').
create or replace function public.care_submit_guest_request(p_key uuid,p_payload jsonb,p_fingerprint text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare prior public.care_guest_requests; saved public.care_guest_requests; field text; text_value text;
begin
  if p_key is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or not (p_payload ?& array['name','email','phone','suburb','postcode','vehicle','service','description','preferred_window','consent'])
    or p_payload - array['name','email','phone','suburb','postcode','vehicle','service','description','preferred_window','consent'] <> '{}'::jsonb
  then raise exception 'VALIDATION_FAILED'; end if;
  foreach field in array array['name','email','phone','suburb','postcode','vehicle','service','description','preferred_window'] loop
    if jsonb_typeof(p_payload->field) <> 'string' then raise exception 'VALIDATION_FAILED'; end if;
    text_value := p_payload->>field;
    if text_value <> btrim(text_value) or length(text_value) = 0 then raise exception 'VALIDATION_FAILED'; end if;
  end loop;
  if length(p_payload->>'name') not between 2 and 100
    or length(p_payload->>'email') not between 3 and 254 or p_payload->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_payload->>'email' <> lower(p_payload->>'email')
    or length(p_payload->>'phone') not between 8 and 24 or p_payload->>'phone' !~ '^\+?[0-9 ()-]+$'
    or length(p_payload->>'suburb') not between 2 and 100 or p_payload->>'postcode' !~ '^[0-9]{4}$'
    or length(p_payload->>'vehicle') not between 3 and 160 or length(p_payload->>'description') not between 10 and 2000
    or p_payload->>'service' not in ('repair','cleaning')
    or p_payload->>'preferred_window' not in ('one_to_two_business_days','seven_to_fourteen_days','flexible')
    or p_payload->'consent' <> 'true'::jsonb
  then raise exception 'VALIDATION_FAILED'; end if;
  -- Bound duplicate submissions and spam across all application instances.
  -- This small staging queue serializes insert checks; no raw IP is stored.
  perform pg_advisory_xact_lock(hashtextextended('skycar:guest-intake',0));
  select * into prior from public.care_guest_requests where idempotency_key = p_key;
  if found then
    if prior.payload <> p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('id',prior.id,'stage',prior.stage,'created_at',prior.created_at);
  end if;
  -- Creation only: decide coverage before the rate-limit reads and the insert.
  perform public.care_assert_postcode_covered(p_payload->>'service', p_payload->>'postcode');
  if (select count(*) from public.care_guest_requests where fingerprint = p_fingerprint and created_at > clock_timestamp()-interval '1 hour') >= 5
    or (select count(*) from public.care_guest_requests where payload->>'email'=p_payload->>'email' and created_at > clock_timestamp()-interval '1 day') >= 3
    or (select count(*) from public.care_guest_requests where created_at > clock_timestamp()-interval '1 hour') >= 100
  then raise exception 'RATE_LIMITED'; end if;
  insert into public.care_guest_requests(idempotency_key,fingerprint,payload)
    values(p_key,p_fingerprint,p_payload) returning * into saved;
  return jsonb_build_object('id',saved.id,'stage',saved.stage,'created_at',saved.created_at);
end;
$$;
revoke all on function public.care_submit_guest_request(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.care_submit_guest_request(uuid,jsonb,text) to service_role;

commit;
