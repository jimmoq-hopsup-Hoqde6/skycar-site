begin;

-- Gap-audit item 2 (15 Nov 2026, probe P1): a customer could move a journey to a postcode outside the
-- service area with care_journey_command('update_details'), and the postcode checked at submit was
-- never stored on the request. Forward-only. No earlier migration is edited, and neither
-- care_submit_request (20261108120000, sunset) nor care_journey_command is re-created here:
-- both are reached through triggers, so the sunset body and the journey lock order stay byte-for-byte.
--
-- 1. care_requests.service_postcode (nullable) + service_postcode_source:
--      submit          written when care_submit_request stores its submit command with a postcode
--                      (that postcode passed care_assert_postcode_covered in the same transaction)
--      update_details  written when the customer changes the journey postcode (checked below)
--      backfill        copied from existing rows by this migration; coverage was NOT re-checked
--      unknown         no postcode anywhere (signed-in legacy creates); service_postcode is null
--    Legacy four-key creates (allowed until the 20261108120000 cap) store unknown. This file does not
--    read or change care_service_coverage_compat or care_legacy_create_audit and opens nothing.
-- 2. care_journeys BEFORE UPDATE OF customer_details: when the postcode changes to a value, it must
--    pass care_assert_postcode_covered for the journey's service (request or guest payload), with the
--    same P0001 codes as submit: OUT_OF_AREA (HTTP 422) or COVERAGE_UNAVAILABLE (HTTP 503, fail
--    closed). The raise aborts the whole command: no journey change, no quote withdrawal, no event,
--    no command row, so the same key may be retried with a corrected postcode.
-- 3. care_journeys AFTER UPDATE OF customer_details (account journeys): copy the accepted postcode to
--    the request. Lock order: the only writer that changes the postcode is care_journey_command
--    update_details, which already holds the care_requests row FOR UPDATE (tier 3) before it locks the
--    journey (tier 4), so this adds no new lock edge. The check itself is plain reads (no locks).

do $preflight$
begin
  if to_regprocedure('public.care_assert_postcode_covered(text,text)') is null
     or to_regprocedure('public.care_legacy_create_open(timestamptz)') is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_POSTCODE_PREFLIGHT_FAILED',
      detail = 'apply 20261101160000 and 20261108120000 first';
  end if;
end
$preflight$;

alter table public.care_requests
  add column service_postcode text,
  add column service_postcode_source text not null default 'unknown',
  add constraint care_requests_service_postcode_format check (service_postcode ~ '^[0-9]{4}$'),
  add constraint care_requests_service_postcode_source check (
    service_postcode_source in ('submit', 'update_details', 'backfill', 'unknown')
    and ((service_postcode_source = 'unknown') = (service_postcode is null)));
comment on column public.care_requests.service_postcode is
  'Service postcode (4 digits). Null only when service_postcode_source is unknown (signed-in legacy create with no postcode).';
comment on column public.care_requests.service_postcode_source is
  'submit | update_details (both coverage-checked when written) | backfill (copied by 20261115100000, not re-checked) | unknown.';

-- Backfill: the journey's saved postcode is the latest customer-stated location; otherwise the submit
-- command's postcode. Only well-formed values are copied; anything else stays unknown.
update public.care_requests as r
   set service_postcode = src.postcode, service_postcode_source = 'backfill'
  from (
    select r2.id,
      coalesce(
        (select j.customer_details->>'postcode' from public.care_journeys j
          where j.account_request_id = r2.id and j.customer_details->>'postcode' ~ '^[0-9]{4}$'),
        (select c.payload->>'postcode' from public.care_request_commands c
          where c.request_id = r2.id and c.operation = 'submit' and c.payload->>'postcode' ~ '^[0-9]{4}$'
          order by c.idempotency_key limit 1)) as postcode
    from public.care_requests r2
  ) as src
 where src.id = r.id and src.postcode is not null;

do $report$
declare backfilled bigint; unknown bigint;
begin
  select count(*) filter (where service_postcode_source = 'backfill'),
         count(*) filter (where service_postcode_source = 'unknown')
    into backfilled, unknown from public.care_requests;
  raise notice 'care_requests service_postcode backfill: % backfilled, % unknown', backfilled, unknown;
end
$report$;

-- 1. Persist the submit postcode. Fires inside care_submit_request (definer) after it inserted the
-- request and before it returns; the request row was created by this transaction, so no wait.
create function public.care_request_record_submit_postcode()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.operation = 'submit' and new.payload->>'postcode' ~ '^[0-9]{4}$' then
    update public.care_requests
       set service_postcode = new.payload->>'postcode', service_postcode_source = 'submit'
     where id = new.request_id and service_postcode_source = 'unknown';
  end if;
  return null;
end;
$$;
create trigger care_request_record_submit_postcode
  after insert on public.care_request_commands
  for each row execute function public.care_request_record_submit_postcode();

-- 2. Re-check coverage when the journey postcode changes.
create function public.care_journey_recheck_postcode()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  service text;
begin
  if new.customer_details->>'postcode' is null
     or new.customer_details->>'postcode' is not distinct from old.customer_details->>'postcode' then
    return new;
  end if;
  if new.account_request_id is not null then
    select r.service into service from public.care_requests r where r.id = new.account_request_id;
  elsif new.guest_request_id is not null then
    select g.payload->>'service' into service from public.care_guest_requests g where g.id = new.guest_request_id;
  end if;
  -- Unknown service or malformed postcode -> VALIDATION_FAILED; list missing -> COVERAGE_UNAVAILABLE;
  -- not serviced -> OUT_OF_AREA. Same helper and codes as care_submit_request / guest submit.
  perform public.care_assert_postcode_covered(service, new.customer_details->>'postcode');
  return new;
end;
$$;
create trigger care_journey_recheck_postcode
  before update of customer_details on public.care_journeys
  for each row execute function public.care_journey_recheck_postcode();

-- 3. Keep the request's postcode in step with an accepted account-journey change.
create function public.care_journey_sync_request_postcode()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.account_request_id is not null and new.customer_details->>'postcode' ~ '^[0-9]{4}$'
     and new.customer_details->>'postcode' is distinct from old.customer_details->>'postcode' then
    update public.care_requests
       set service_postcode = new.customer_details->>'postcode', service_postcode_source = 'update_details'
     where id = new.account_request_id;
  end if;
  return null;
end;
$$;
create trigger care_journey_sync_request_postcode
  after update of customer_details on public.care_journeys
  for each row execute function public.care_journey_sync_request_postcode();

revoke all on function public.care_request_record_submit_postcode() from public, anon, authenticated, service_role;
revoke all on function public.care_journey_recheck_postcode() from public, anon, authenticated, service_role;
revoke all on function public.care_journey_sync_request_postcode() from public, anon, authenticated, service_role;

commit;
