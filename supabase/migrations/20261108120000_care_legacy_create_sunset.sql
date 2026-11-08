begin;

-- Signed-in legacy creates (care_submit_request with no postcode) self-close at
-- 2026-11-22 00:00 Australia/Adelaide, which is 2026-11-21T13:30:00Z.
-- Owner: Backend & Security. This is the close for the deploy-window switch in
-- 20261101160000_care_service_coverage_enforcement.sql. That file is not modified.
--
-- Repository evidence when this was added does not show 20261101160000 applied:
-- it is absent from origin/main; docs/staging/V2_NINE_MIGRATION_INSTALL.md at
-- a1bd60c (2026-11-02) section 11 lists ten files applied on 1 Nov 2026 and does
-- not include it; section 12 lists it among eight files not yet installed, at the
-- older blob 9a48a212 (7f8071f). This branch's blob is 837ba184 (0eb3e74), also on
-- integration/week1-candidate ff2c941. No later commit in this clone records an
-- apply. Hosted staging and production were not queried, so live status is
-- uncertain and this change is forward-only.
--
-- Until the cap, a true accept_legacy_create still allows one compatibility path.
-- At the cap the path fails closed even if that boolean stays true. A privileged
-- session may close earlier (boolean false, or an earlier deadline). It cannot
-- move the deadline later: the check constraint rejects it, and the function
-- also caps at this instant if the constraint is ever dropped. Replay is unchanged.
-- Each committed legacy create increments care_legacy_create_audit in the same
-- transaction. API roles cannot read or write that counter.

do $sunset$
begin
  if (timestamptz '2026-11-22 00:00:00 Australia/Adelaide')
       is distinct from (timestamptz '2026-11-21 13:30:00+00') then
    raise exception using errcode = 'P0001', message = 'LEGACY_CREATE_DEADLINE_TIMEZONE_MISMATCH';
  end if;
end
$sunset$;

alter table public.care_service_coverage_compat
  add column legacy_create_deadline timestamptz;
update public.care_service_coverage_compat
   set legacy_create_deadline = timestamptz '2026-11-21 13:30:00+00'
 where legacy_create_deadline is null;
alter table public.care_service_coverage_compat
  alter column legacy_create_deadline set default timestamptz '2026-11-21 13:30:00+00',
  alter column legacy_create_deadline set not null,
  add constraint care_service_coverage_compat_deadline_cap
    check (legacy_create_deadline <= timestamptz '2026-11-21 13:30:00+00');
comment on column public.care_service_coverage_compat.legacy_create_deadline is
  'Backend & Security cap for signed-in legacy creates. 2026-11-22 00:00 Australia/Adelaide (2026-11-21T13:30:00Z). Earlier is allowed; later is not.';

-- Aggregate only: no customer, vehicle, key or payload. Customers cannot read it.
-- The owner can. RLS is on and not forced so the definer function (table owner)
-- can increment; REVOKE, not a policy, is what blocks anon, authenticated and
-- service_role (service_role may bypass RLS).
create table public.care_legacy_create_audit (
  singleton boolean primary key default true check (singleton),
  create_count bigint not null default 0 check (create_count >= 0),
  first_created_at timestamptz,
  last_created_at timestamptz,
  constraint care_legacy_create_audit_times check (
    (create_count = 0 and first_created_at is null and last_created_at is null)
    or (create_count > 0 and first_created_at is not null and last_created_at is not null
        and first_created_at <= last_created_at)
  )
);
comment on table public.care_legacy_create_audit is
  'Backend & Security count of committed signed-in legacy creates. Not customer-readable.';

insert into public.care_legacy_create_audit(singleton) values (true);

create function public.care_legacy_create_audit_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' then
    if new.singleton is distinct from old.singleton
      or new.create_count is distinct from old.create_count + 1
      or new.first_created_at is null
      or new.last_created_at is null
      or new.last_created_at < new.first_created_at
      or new.first_created_at is distinct from coalesce(old.first_created_at, new.first_created_at) then
      raise exception using errcode = 'P0001', message = 'LEGACY_CREATE_AUDIT_TAMPER';
    end if;
    return new;
  end if;
  raise exception using errcode = 'P0001', message = 'LEGACY_CREATE_AUDIT_TAMPER';
end;
$guard$;

create trigger care_legacy_create_audit_guard
  before update or delete on public.care_legacy_create_audit
  for each row execute function public.care_legacy_create_audit_guard();
create trigger care_legacy_create_audit_no_truncate
  before truncate on public.care_legacy_create_audit
  for each statement execute function public.care_legacy_create_audit_guard();

alter table public.care_legacy_create_audit enable row level security;
revoke all on public.care_legacy_create_audit from public, anon, authenticated, service_role;
revoke all on function public.care_legacy_create_audit_guard() from public, anon, authenticated, service_role;

-- One decision for the compatibility path. False when the row is missing, the
-- switch is not true, the deadline is null, or p_at is at/after the earlier of
-- the stored deadline and the hard cap. p_at is the caller's clock so a test
-- can pin the boundary; care_submit_request passes clock_timestamp().
create function public.care_legacy_create_open(p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $open$
declare
  cap constant timestamptz := timestamptz '2026-11-21 13:30:00+00';
  enabled boolean;
  deadline timestamptz;
begin
  if p_at is null then
    return false;
  end if;
  select accept_legacy_create, legacy_create_deadline
    into enabled, deadline
  from public.care_service_coverage_compat
  where singleton;
  if not found or enabled is distinct from true or deadline is null then
    return false;
  end if;
  return p_at < least(deadline, cap);
end;
$open$;
comment on function public.care_legacy_create_open(timestamptz) is
  'Backend & Security. True only strictly before the legacy-create cap and only while the compat switch is true.';
revoke all on function public.care_legacy_create_open(timestamptz) from public, anon, authenticated, service_role;

-- Same signature, owner and grants as 20261101160000. Replay is still decided
-- before any coverage or legacy gate. A legacy create is gated before the
-- vehicle lock and again immediately before the audit increment, so a lock wait
-- that crosses the cap rolls the insert back. The increment is in this
-- transaction: a rollback keeps the previous count, a replay does not increment.
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
  legacy_at timestamptz;
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
  if normalized ? 'postcode' then
    perform public.care_assert_postcode_covered(normalized->>'service', normalized->>'postcode');
  elsif not public.care_legacy_create_open(clock_timestamp()) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  perform 1 from public.vehicles where id = vehicle and owner_id = actor and archived_at is null for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  select * into policy from public.care_response_policy where singleton;
  if not found then raise exception using errcode = 'P0001', message = 'POLICY_UNAVAILABLE'; end if;
  at_time := clock_timestamp();
  insert into public.care_requests(customer_id, vehicle_id, service, description, preferred_window,
    next_update_at, escalation_minutes, created_at, updated_at)
  values(actor, vehicle, normalized->>'service', normalized->>'description', normalized->>'preferred_window',
    at_time + make_interval(mins => policy.acknowledgement_minutes), policy.escalation_minutes, at_time, at_time)
  returning * into request;
  insert into public.care_request_commands values(actor, 'submit', p_key, normalized, request.id);
  perform public.care_append_event(request, 'request_received', at_time, actor);
  if not (normalized ? 'postcode') then
    legacy_at := clock_timestamp();
    if not public.care_legacy_create_open(legacy_at) then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
    update public.care_legacy_create_audit
      set create_count = create_count + 1,
          first_created_at = coalesce(first_created_at, legacy_at),
          last_created_at = legacy_at
      where singleton;
    if not found then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
    end if;
  end if;
  return jsonb_build_object('request', public.care_request_snapshot(request.id), 'replayed', false);
end;
$$;
revoke all on function public.care_submit_request(uuid, jsonb) from public, anon;
grant execute on function public.care_submit_request(uuid, jsonb) to authenticated;

commit;
