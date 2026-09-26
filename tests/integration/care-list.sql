begin;
create function pg_temp.assert_ok(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', label; end if; end;
$$;
create function pg_temp.expect_error(query text, expected text) returns void language plpgsql as $$
declare seen boolean := false;
begin
  begin execute query;
  exception when others then
    if sqlerrm not like '%' || expected || '%' then raise; end if;
    seen := true;
  end;
  if not seen then raise exception 'Expected error: %', expected; end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.assert_ok(public.care_list_requests()->'items' = '[]'::jsonb, 'empty account');
select pg_temp.assert_ok(public.care_list_requests()->>'next_position' is null, 'empty account has no cursor');
select pg_temp.expect_error('select public.care_list_requests(0)', 'VALIDATION_FAILED');
select pg_temp.expect_error('select public.care_list_requests(51)', 'VALIDATION_FAILED');
select pg_temp.expect_error('select public.care_list_requests(null)', 'VALIDATION_FAILED');
select pg_temp.expect_error('select public.care_list_requests(1,null,now(),null)', 'VALIDATION_FAILED');
select pg_temp.expect_error('select public.care_list_requests(1,null,null,gen_random_uuid())', 'VALIDATION_FAILED');
select pg_temp.expect_error('select public.care_list_requests(1,null,''infinity'',gen_random_uuid())', 'VALIDATION_FAILED');
reset role;

insert into public.vehicles(id, owner_id, make, model, archived_at) values
  ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test','Archived',now()),
  ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test','Empty',null);
insert into public.care_requests(id, customer_id, vehicle_id, service, description, preferred_window,
  created_at, updated_at, next_update_at, escalation_minutes)
select ('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  case when n=6 then 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid end,
  case when n=6 then '22222222-2222-4222-8222-222222222222'::uuid
    when n=4 then '33333333-3333-4333-8333-333333333333'::uuid
    else '11111111-1111-4111-8111-111111111111'::uuid end,
  case when n=4 then 'cleaning' else 'repair' end, 'Synthetic request only', 'flexible',
  case when n in (2,3) then '2026-01-01T00:00:00.000002Z'::timestamptz
    when n=1 then '2026-01-01T00:00:00.000001Z'::timestamptz
    when n=4 then '2025-12-31T00:00:00Z'::timestamptz else '2026-01-02T00:00:00Z'::timestamptz end,
  now(), now() + interval '1 hour', 30
from generate_series(1,6) n;
update public.care_requests set next_update_at = now() - interval '1 hour'
  where id = '50000000-0000-4000-8000-000000000002';
update public.care_requests set customer_stage='no_match', next_action='choose_recovery',
  responsible_role='customer', next_update_at=null where id='50000000-0000-4000-8000-000000000005';

-- Reading must work without an intake policy and must never produce progress.
delete from public.care_response_policy;
set local role authenticated;
select public.care_list_requests() as all_rows \gset
select pg_temp.assert_ok(jsonb_array_length(:'all_rows'::jsonb->'items') = 5, 'only request and vehicle owner rows');
select pg_temp.assert_ok(not jsonb_path_exists(:'all_rows'::jsonb, '$.items[*].customer_id'), 'customer id omitted');
select pg_temp.assert_ok(not jsonb_path_exists(:'all_rows'::jsonb, '$.items[*].description'), 'private detail omitted');
select pg_temp.assert_ok(not jsonb_path_exists(:'all_rows'::jsonb, '$.items[*].events'), 'event history omitted');
select pg_temp.assert_ok(not jsonb_path_exists(:'all_rows'::jsonb, '$.items[*].escalation_minutes'), 'internal policy omitted');
select pg_temp.assert_ok(:'all_rows'::jsonb->'items'->0->>'customer_stage' = 'no_match'
  and :'all_rows'::jsonb->'items'->0->>'next_action' = 'choose_recovery'
  and :'all_rows'::jsonb->'items'->0->'next_update_at' = 'null'::jsonb
  and :'all_rows'::jsonb->'items'->0->'is_overdue' = 'false'::jsonb, 'no-match retains customer recovery');
select pg_temp.assert_ok(:'all_rows'::jsonb->'items'->2->'is_overdue' = 'true'::jsonb
  and :'all_rows'::jsonb->'items'->2->>'customer_stage' = 'request_received', 'overdue without invented worker transition');
select pg_temp.assert_ok(:'all_rows'::jsonb->'items'->3->'is_overdue' = 'false'::jsonb, 'future deadline is not overdue');
select pg_temp.assert_ok(:'all_rows'::jsonb->'items'->3->'money_state' = 'null'::jsonb
  and :'all_rows'::jsonb->'items'->3->'fulfilment_state' = 'null'::jsonb, 'no fake appointment or payment');
select pg_temp.assert_ok((:'all_rows'::jsonb->>'evaluated_at')::timestamptz >= now(), 'database evaluation time');
select pg_temp.assert_ok(jsonb_array_length(public.care_list_requests(50,'11111111-1111-4111-8111-111111111111')->'items') = 4, 'owned vehicle filter');
select pg_temp.assert_ok((public.care_list_requests(50,'33333333-3333-4333-8333-333333333333')->'items'->0->>'vehicle_archived')::boolean, 'archived own history retained');
select pg_temp.assert_ok(public.care_list_requests(50,'44444444-4444-4444-8444-444444444444')->'items' = '[]'::jsonb, 'owned empty vehicle');
select pg_temp.expect_error('select public.care_list_requests(20,''22222222-2222-4222-8222-222222222222'')', 'NOT_FOUND');
select pg_temp.expect_error('select public.care_list_requests(20,''99999999-9999-4999-8999-999999999999'')', 'NOT_FOUND');

select public.care_list_requests(2) as first_page \gset
select pg_temp.assert_ok(:'first_page'::jsonb->'items'->0->>'id' = '50000000-0000-4000-8000-000000000005'
  and :'first_page'::jsonb->'items'->1->>'id' = '50000000-0000-4000-8000-000000000003', 'stable newest order with UUID tie break');
select pg_temp.assert_ok(:'first_page'::jsonb->'next_position'->>'created_at' = '2026-01-01T00:00:00.000002Z', 'cursor preserves microseconds');
reset role;
-- Concurrent work may change a pending row and insert a newer request.
update public.care_requests set customer_stage='delayed', next_action='review_overdue_request',
  updated_at=now(), next_update_at=now()+interval '1 hour' where id='50000000-0000-4000-8000-000000000002';
insert into public.care_requests(id, customer_id, vehicle_id, service, description, preferred_window,
  created_at, next_update_at, escalation_minutes) values
  ('50000000-0000-4000-8000-000000000007','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111','repair','New synthetic request','flexible','2026-01-03T00:00:00Z',now()+interval '1 hour',30);
set local role authenticated;
select public.care_list_requests(2,null,
  (:'first_page'::jsonb->'next_position'->>'created_at')::timestamptz,
  (:'first_page'::jsonb->'next_position'->>'id')::uuid) as second_page \gset
select pg_temp.assert_ok(:'second_page'::jsonb->'items'->0->>'id' = '50000000-0000-4000-8000-000000000002'
  and :'second_page'::jsonb->'items'->1->>'id' = '50000000-0000-4000-8000-000000000001', 'no duplicates or skipped microsecond rows');
select pg_temp.assert_ok(:'second_page'::jsonb->'items'->0->>'customer_stage' = 'delayed'
  and :'second_page'::jsonb->'items'->0->'is_overdue' = 'false'::jsonb, 'current state without reordering');
select public.care_list_requests(2,null,
  (:'second_page'::jsonb->'next_position'->>'created_at')::timestamptz,
  (:'second_page'::jsonb->'next_position'->>'id')::uuid) as last_page \gset
select pg_temp.assert_ok(jsonb_array_length(:'last_page'::jsonb->'items') = 1
  and :'last_page'::jsonb->'items'->0->>'id' = '50000000-0000-4000-8000-000000000004'
  and :'last_page'::jsonb->>'next_position' is null, 'final page includes archived history and terminates');
select pg_temp.assert_ok(public.care_list_requests(1)->'items'->0->>'id' = '50000000-0000-4000-8000-000000000007', 'refresh includes new arrivals');
select pg_temp.assert_ok(public.care_list_requests(20,null,'1900-01-01T00:00:00Z',gen_random_uuid())->'items' = '[]'::jsonb, 'beyond final page is empty');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.assert_ok(jsonb_array_length(public.care_list_requests()->'items') = 1
  and public.care_list_requests()->'items'->0->>'id' = '50000000-0000-4000-8000-000000000006', 'second customer isolated');
select pg_temp.assert_ok(public.care_list_requests(20,null,
  (:'first_page'::jsonb->'next_position'->>'created_at')::timestamptz,
  (:'first_page'::jsonb->'next_position'->>'id')::uuid)->'items' = '[]'::jsonb, 'copied cursor grants no foreign access');
select pg_temp.expect_error('select public.care_list_requests(20,''11111111-1111-4111-8111-111111111111'')', 'NOT_FOUND');
set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select pg_temp.expect_error('select public.care_list_requests()', 'FORBIDDEN');
set local request.jwt.claim.sub = '';
select pg_temp.expect_error('select public.care_list_requests()', 'UNAUTHENTICATED');
set local role anon;
select pg_temp.expect_error('select public.care_list_requests()', 'permission denied');
reset role;
select pg_temp.assert_ok((select count(*) = 0 from public.care_request_events), 'reads append no events');
select pg_temp.assert_ok((select count(*) = 0 from public.care_notification_outbox), 'reads enqueue no notifications');
select pg_temp.assert_ok((select count(*) = 0 from public.care_request_commands), 'reads make no commands');
select pg_temp.assert_ok((select count(*) = 0 from public.audit_events where action like 'care.%'), 'reads create no Care audit mutations');

-- Corrupted/moved ownership must still not expose the request via definer RPC.
alter table public.vehicles disable trigger care_vehicle_owner_guard;
update public.vehicles set owner_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  where id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.assert_ok(jsonb_array_length(public.care_list_requests()->'items') = 5, 'ownership loss removes old owner access');
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.assert_ok(public.care_list_requests(20,'33333333-3333-4333-8333-333333333333')->'items' = '[]'::jsonb, 'new owner cannot inherit another customer request');
rollback;
