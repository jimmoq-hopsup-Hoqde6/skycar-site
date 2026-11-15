insert into auth.users(id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
delete from public.user_roles where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
insert into public.user_roles values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','technician',now());
insert into public.vehicles(id, owner_id, make, model) values
  ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test','A'),
  ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Test','B');
-- Test-only timings, not a product promise or production seed.
insert into public.care_response_policy values (true, 60, 30);
