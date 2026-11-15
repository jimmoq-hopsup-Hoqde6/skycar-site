begin;

-- Guest intake is a private operations queue. No Auth user or Garage vehicle
-- is created, and browser roles cannot read or write contact details directly.
create table public.care_guest_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  stage text not null default 'request_received' check (stage = 'request_received'),
  created_at timestamptz not null default clock_timestamp()
);
create index care_guest_requests_fingerprint_created_idx on public.care_guest_requests(fingerprint,created_at);
create index care_guest_requests_email_created_idx on public.care_guest_requests((payload->>'email'),created_at);
create index care_guest_requests_created_idx on public.care_guest_requests(created_at);
alter table public.care_guest_requests enable row level security;
revoke all on public.care_guest_requests from public,anon,authenticated;
grant select,insert on public.care_guest_requests to service_role;

create function public.care_submit_guest_request(p_key uuid,p_payload jsonb,p_fingerprint text)
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
  if (select count(*) from public.care_guest_requests where fingerprint = p_fingerprint and created_at > clock_timestamp()-interval '1 hour') >= 5
    or (select count(*) from public.care_guest_requests where payload->>'email'=p_payload->>'email' and created_at > clock_timestamp()-interval '1 day') >= 3
    or (select count(*) from public.care_guest_requests where created_at > clock_timestamp()-interval '1 hour') >= 100
  then raise exception 'RATE_LIMITED'; end if;
  insert into public.care_guest_requests(idempotency_key,fingerprint,payload)
    values(p_key,p_fingerprint,p_payload) returning * into saved;
  return jsonb_build_object('id',saved.id,'stage',saved.stage,'created_at',saved.created_at);
end;
$$;
revoke all on function public.care_submit_guest_request(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.care_submit_guest_request(uuid,jsonb,text) to service_role;
commit;
