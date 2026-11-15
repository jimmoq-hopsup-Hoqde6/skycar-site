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
select public.care_submit_request('10000000-0000-4000-8000-000000000001',
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}') as receipt \gset
select (:'receipt'::jsonb->'request'->>'id') as request_id \gset
select pg_temp.assert_ok((:'receipt'::jsonb->>'replayed')::boolean = false, 'new submission');
select pg_temp.assert_ok(:'receipt'::jsonb->'request'->>'customer_stage' = 'request_received', 'immediate receipt');
select pg_temp.assert_ok(:'receipt'::jsonb->'request'->>'assignment_state' = 'none', 'no fake technician');
select pg_temp.assert_ok(:'receipt'::jsonb->'request'->>'fulfilment_state' is null, 'no fake appointment');
select pg_temp.assert_ok(:'receipt'::jsonb->'request'->>'money_state' is null, 'no fake payment');
select pg_temp.assert_ok(jsonb_array_length(:'receipt'::jsonb->'request'->'events') = 1, 'one receipt event');
select pg_temp.assert_ok((:'receipt'::jsonb->'request'->>'next_update_at')::timestamptz > now(), 'configured deadline');
select pg_temp.assert_ok((public.care_submit_request('10000000-0000-4000-8000-000000000001',
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"repair","description":"  Scratch on rear bumper  ","preferred_window":"flexible"}')->>'replayed')::boolean, 'normalized retry');
select pg_temp.expect_error($q$select public.care_submit_request('10000000-0000-4000-8000-000000000001',
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"cleaning","description":"Scratch on rear bumper","preferred_window":"flexible"}')$q$, 'IDEMPOTENCY_CONFLICT');
select pg_temp.expect_error($q$select public.care_submit_request(gen_random_uuid(),
  '{"vehicle_id":"22222222-2222-4222-8222-222222222222","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}')$q$, 'NOT_FOUND');
select pg_temp.expect_error($q$select public.care_submit_request(gen_random_uuid(),
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible","owner_id":"fake"}')$q$, 'VALIDATION_FAILED');
select pg_temp.expect_error($q$select public.care_submit_request(gen_random_uuid(),
  '{"vehicle_id":null,"service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}')$q$, 'VALIDATION_FAILED');
select pg_temp.expect_error($q$select public.care_submit_request(gen_random_uuid(),
  '{"vehicle_id":"not-uuid","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}')$q$, 'VALIDATION_FAILED');
select pg_temp.expect_error(format('select public.care_retry_request(%L, gen_random_uuid())', :'request_id'), 'INVALID_TRANSITION');
select pg_temp.expect_error('update public.care_requests set customer_stage = ''no_match''', 'permission denied');
select pg_temp.expect_error('insert into public.care_requests(customer_id) values(gen_random_uuid())', 'permission denied');
select pg_temp.expect_error('insert into public.care_request_events(request_id,sequence,type,occurred_at) values(gen_random_uuid(),1,''request_received'',now())', 'permission denied');
select pg_temp.expect_error('delete from public.care_request_events', 'permission denied');
select pg_temp.expect_error('select * from public.care_request_commands', 'permission denied');
select pg_temp.expect_error('select * from public.care_notification_outbox', 'permission denied');
select pg_temp.expect_error('select public.care_escalate_overdue(100)', 'permission denied');
select pg_temp.expect_error(format('select public.care_request_snapshot(%L)', :'request_id'), 'permission denied');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.assert_ok((select count(*) = 0 from public.care_requests), 'cross-user RLS');
select pg_temp.assert_ok((select count(*) = 0 from public.care_request_events), 'cross-user events RLS');
select pg_temp.expect_error(format('select public.care_get_request(%L)', :'request_id'), 'NOT_FOUND');
select pg_temp.expect_error(format('select public.care_retry_request(%L,gen_random_uuid())', :'request_id'), 'NOT_FOUND');
set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select pg_temp.expect_error(format('select public.care_get_request(%L)', :'request_id'), 'FORBIDDEN');
set local request.jwt.claim.sub = '';
select pg_temp.expect_error(format('select public.care_get_request(%L)', :'request_id'), 'UNAUTHENTICATED');
set local role anon;
select pg_temp.expect_error(format('select public.care_get_request(%L)', :'request_id'), 'permission denied');
reset role;

select pg_temp.assert_ok((select count(*) = 1 from public.care_notification_outbox), 'deduplicated pending notification');
select pg_temp.assert_ok((select count(*) = 1 from public.audit_events where action = 'care.request_received'), 'audited receipt');
select pg_temp.assert_ok(public.care_escalate_overdue(100) = 0, 'not yet due');
select pg_temp.expect_error('select public.care_escalate_overdue(101)', 'VALIDATION_FAILED');
update public.care_requests set next_update_at = now() - interval '1 second' where id = :'request_id';
set local role service_role;
select pg_temp.assert_ok(public.care_escalate_overdue(1) = 1, 'worker escalates overdue');
select pg_temp.assert_ok(public.care_escalate_overdue(1) = 0, 'duplicate worker does not re-escalate');
reset role;
select pg_temp.assert_ok((select customer_stage = 'delayed' and responsible_role = 'operations' and next_update_at > now() from public.care_requests where id = :'request_id'), 'visible delay and follow-up deadline');
update public.care_requests set next_update_at = now() - interval '1 second' where id = :'request_id';
select pg_temp.assert_ok(public.care_escalate_overdue(100) = 1, 'second deadline no-match');
select pg_temp.assert_ok(public.care_escalate_overdue(100) = 0, 'terminal no-match is not repeated');
select pg_temp.assert_ok((select customer_stage = 'no_match' and next_action = 'choose_recovery' and next_update_at is null from public.care_requests where id = :'request_id'), 'customer recovery action');
select pg_temp.assert_ok((select count(*) = 3 from public.care_request_events), 'exact three transition events');
select pg_temp.assert_ok((select count(*) = 3 from public.care_notification_outbox where status = 'pending' and attempts = 0), 'notifications not falsely delivered');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.care_retry_request(:'request_id','10000000-0000-4000-8000-000000000002') as recovered \gset
select pg_temp.assert_ok(:'recovered'::jsonb->'request'->>'customer_stage' = 'request_received', 'explicit recovery');
select pg_temp.assert_ok((public.care_retry_request(:'request_id','10000000-0000-4000-8000-000000000002')->>'replayed')::boolean, 'retry is idempotent');
select pg_temp.expect_error('select public.care_retry_request(gen_random_uuid(),''10000000-0000-4000-8000-000000000002'')', 'IDEMPOTENCY_CONFLICT');
update public.vehicles set archived_at = now() where id = '11111111-1111-4111-8111-111111111111';
select pg_temp.assert_ok(public.care_get_request(:'request_id')->>'id' = :'request_id', 'history readable after archive');
select pg_temp.assert_ok((public.care_submit_request('10000000-0000-4000-8000-000000000001',
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}')->>'replayed')::boolean, 'archived exact retry remains safe');
select pg_temp.expect_error($q$select public.care_submit_request(gen_random_uuid(),
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}')$q$, 'NOT_FOUND');
reset role;
select pg_temp.expect_error('update public.vehicles set owner_id = ''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'' where id = ''11111111-1111-4111-8111-111111111111''', 'VEHICLE_HAS_CARE_HISTORY');
select pg_temp.expect_error('delete from public.vehicles where id = ''11111111-1111-4111-8111-111111111111''', 'foreign key constraint');

-- Missing policy must fail atomically, without partial request/event/outbox.
delete from public.care_response_policy;
update public.vehicles set archived_at = null;
set local role authenticated;
select pg_temp.expect_error($q$select public.care_submit_request(gen_random_uuid(),
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"repair","description":"Scratch on rear bumper","preferred_window":"flexible"}')$q$, 'POLICY_UNAVAILABLE');
reset role;
select pg_temp.assert_ok((select count(*) = 1 from public.care_requests), 'failed policy leaves no request');
select pg_temp.assert_ok((select count(*) = 4 from public.care_request_events), 'retry only appends once');

-- Fail an outbox write deliberately to prove all preceding effects roll back.
insert into public.care_response_policy values(true,60,30);
create function pg_temp.fail_outbox() returns trigger language plpgsql as $$ begin raise exception 'TEST_OUTBOX_FAILURE'; end; $$;
create trigger fail_outbox before insert on public.care_notification_outbox for each row execute function pg_temp.fail_outbox();
set local role authenticated;
select pg_temp.expect_error($q$select public.care_submit_request(gen_random_uuid(),
  '{"vehicle_id":"11111111-1111-4111-8111-111111111111","service":"cleaning","description":"Interior cleaning request","preferred_window":"flexible"}')$q$, 'TEST_OUTBOX_FAILURE');
reset role;
select pg_temp.assert_ok((select count(*) = 1 from public.care_requests), 'outbox failure rolls back request');
select pg_temp.assert_ok((select count(*) = 4 from public.care_request_events), 'outbox failure rolls back event');
select pg_temp.assert_ok((select count(*) = 2 from public.care_request_commands), 'outbox failure rolls back idempotency command');
update public.care_requests set next_update_at = now() - interval '1 second' where id = :'request_id';
select pg_temp.expect_error('select public.care_escalate_overdue(100)', 'TEST_OUTBOX_FAILURE');
select pg_temp.assert_ok((select customer_stage = 'request_received' from public.care_requests where id = :'request_id'), 'outbox failure rolls back escalation');
select pg_temp.assert_ok((select count(*) = 4 from public.care_request_events), 'outbox failure rolls back escalation event');
drop trigger fail_outbox on public.care_notification_outbox;

-- A future quote/assignment workflow must not be overwritten by a stale worker.
update public.care_requests set quote_state = 'issued' where id = :'request_id';
select pg_temp.assert_ok(public.care_escalate_overdue(100) = 0, 'worker skips progressed quote');
update public.care_requests set quote_state = 'in_review', assignment_state = 'offered' where id = :'request_id';
select pg_temp.assert_ok(public.care_escalate_overdue(100) = 0, 'worker skips progressed assignment');
rollback;
