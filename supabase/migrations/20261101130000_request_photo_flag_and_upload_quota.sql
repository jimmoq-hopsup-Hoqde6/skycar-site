begin;

-- Request photos live in private Storage (manifest + photo-N, written once by
-- the trusted server route). This migration adds three server-only pieces and
-- does not touch care_journey_command, its lock order or any existing table:
--   N2  care_request_photo_sets + care_record_request_photos: a write-once
--       marker (count + manifest hash) set only after Storage confirms the
--       manifest; care_list_requests projects photo_count / has_photos from it.
--   N6  care_photo_upload_quota + care_reserve_photo_upload_slot /
--       care_release_photo_upload_slot: an atomic fixed-window counter keyed by
--       the authenticated subject. The server reserves a slot BEFORE storing and
--       releases it on any failure or reject; only a call that creates the
--       photo marker keeps its slot, so rejected bodies, retries after a 503 and
--       identical replays of a recorded set never consume quota.
-- Browser roles get no table or function privilege on the new objects.

create table public.care_request_photo_sets (
  request_id uuid primary key references public.care_requests(id),
  photo_count smallint not null check (photo_count between 1 and 3),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp()
);

create table public.care_photo_upload_quota (
  subject text not null check (length(subject) between 1 and 80),
  window_start timestamptz not null,
  uploads integer not null check (uploads >= 0),
  primary key (subject, window_start)
);

alter table public.care_request_photo_sets enable row level security;
alter table public.care_photo_upload_quota enable row level security;
-- Default privileges may already grant service_role everything; reset to the minimum.
revoke all on public.care_request_photo_sets from public, anon, authenticated, service_role;
revoke all on public.care_photo_upload_quota from public, anon, authenticated, service_role;
-- The marker is write-once: no update or delete privilege exists for anyone.
grant select, insert on public.care_request_photo_sets to service_role;
grant select, insert, update, delete on public.care_photo_upload_quota to service_role;

create or replace function public.care_record_request_photos(
  p_request_id uuid,
  p_count integer,
  p_manifest_sha256 text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  stored public.care_request_photo_sets;
  inserted boolean := false;
begin
  if p_request_id is null or p_count is null or p_count not between 1 and 3
    or p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if not exists (select 1 from public.care_requests where id = p_request_id) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  insert into public.care_request_photo_sets(request_id, photo_count, manifest_sha256)
  values (p_request_id, p_count, p_manifest_sha256)
  on conflict (request_id) do nothing
  returning * into stored;
  inserted := found;
  if not inserted then
    select * into stored from public.care_request_photo_sets where request_id = p_request_id;
    if stored.photo_count <> p_count or stored.manifest_sha256 <> p_manifest_sha256 then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;
  return jsonb_build_object('request_id', stored.request_id, 'photo_count', stored.photo_count, 'replayed', not inserted);
end;
$$;

create or replace function public.care_reserve_photo_upload_slot(
  p_subject text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  evaluated_at timestamptz := clock_timestamp();
  window_begin timestamptz;
  used integer;
begin
  if p_subject is null or length(p_subject) not between 1 and 80
    or p_limit is null or p_limit not between 1 and 1000
    or p_window_seconds is null or p_window_seconds not between 60 and 86400 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  window_begin := to_timestamp(floor(extract(epoch from evaluated_at) / p_window_seconds) * p_window_seconds);
  -- One atomic statement: concurrent callers serialise on the row, and the
  -- guarded update re-checks the limit against the committed value, so held
  -- plus kept slots can never exceed p_limit.
  insert into public.care_photo_upload_quota as q(subject, window_start, uploads)
  values (p_subject, window_begin, 1)
  on conflict (subject, window_start) do update set uploads = q.uploads + 1
  where q.uploads < p_limit
  returning q.uploads into used;
  if found then
    if used = 1 then
      delete from public.care_photo_upload_quota
      where subject = p_subject and window_start < window_begin - make_interval(secs => p_window_seconds);
    end if;
    return jsonb_build_object('allowed', true, 'limit', p_limit, 'used', used, 'remaining', p_limit - used,
      'window_seconds', p_window_seconds, 'window_start', window_begin, 'retry_after_seconds', 0);
  end if;
  select uploads into used from public.care_photo_upload_quota
  where subject = p_subject and window_start = window_begin;
  return jsonb_build_object('allowed', false, 'limit', p_limit, 'used', used, 'remaining', 0,
    'window_seconds', p_window_seconds, 'window_start', window_begin,
    'retry_after_seconds', greatest(1, ceil(extract(epoch from (window_begin + make_interval(secs => p_window_seconds) - evaluated_at)))::integer));
end;
$$;

-- Gives back one reserved slot of the window it was taken in. The count never
-- goes below zero; an unknown or already-empty window releases nothing.
create or replace function public.care_release_photo_upload_slot(
  p_subject text,
  p_window_start timestamptz
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  used integer;
begin
  if p_subject is null or length(p_subject) not between 1 and 80 or p_window_start is null or not isfinite(p_window_start) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  update public.care_photo_upload_quota as q set uploads = q.uploads - 1
  where q.subject = p_subject and q.window_start = p_window_start and q.uploads > 0
  returning q.uploads into used;
  if found then
    return jsonb_build_object('released', true, 'used', used);
  end if;
  return jsonb_build_object('released', false, 'used', null);
end;
$$;

revoke all on function public.care_record_request_photos(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.care_record_request_photos(uuid, integer, text) to service_role;
revoke all on function public.care_reserve_photo_upload_slot(text, integer, integer) from public, anon, authenticated;
grant execute on function public.care_reserve_photo_upload_slot(text, integer, integer) to service_role;
revoke all on function public.care_release_photo_upload_slot(text, timestamptz) from public, anon, authenticated;
grant execute on function public.care_release_photo_upload_slot(text, timestamptz) to service_role;

-- Same signature, grants and fields as 20261101062400 (journey_state and
-- completion_review_state kept) plus photo_count and has_photos. Read-only.
create or replace function public.care_list_requests(
  p_limit integer default 20,
  p_vehicle_id uuid default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.care_require_customer();
  evaluated_at timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 50 or
    (p_before_created_at is null) <> (p_before_id is null) or
    (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles where id = p_vehicle_id and owner_id = actor
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  return (
    with candidates as materialized (
      select r.*, v.archived_at as vehicle_archived_at, j.state as journey_state, j.completion_review_state,
        coalesce(ps.photo_count, 0)::integer as photo_count
      from public.care_requests r
      join public.vehicles v on v.id = r.vehicle_id
      left join public.care_journeys j on j.account_request_id = r.id
      left join public.care_request_photo_sets ps on ps.request_id = r.id
      where r.customer_id = actor and v.owner_id = actor
        and (p_vehicle_id is null or r.vehicle_id = p_vehicle_id)
        and (p_before_created_at is null or (r.created_at, r.id) < (p_before_created_at, p_before_id))
      order by r.created_at desc, r.id desc limit p_limit + 1
    ), page as materialized (
      select * from candidates order by created_at desc, id desc limit p_limit
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'vehicle_id', vehicle_id, 'vehicle_archived', vehicle_archived_at is not null,
        'service', service, 'quote_state', quote_state, 'assignment_state', assignment_state,
        'fulfilment_state', fulfilment_state, 'money_state', money_state,
        'customer_stage', customer_stage, 'next_action', next_action, 'responsible_role', responsible_role,
        'created_at', created_at, 'updated_at', updated_at, 'next_update_at', next_update_at,
        'is_overdue', coalesce(responsible_role = 'operations' and next_update_at <= evaluated_at, false),
        'journey_state', journey_state,
        'completion_review_state', completion_review_state,
        'photo_count', photo_count,
        'has_photos', photo_count > 0
      ) order by created_at desc, id desc) from page), '[]'::jsonb),
      'evaluated_at', evaluated_at,
      'next_position', case when (select count(*) from candidates) > p_limit then (
        select jsonb_build_object('id', id,
          'created_at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
        from page order by created_at, id limit 1
      ) else null end
    )
  );
end;
$$;

revoke all on function public.care_list_requests(integer, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.care_list_requests(integer, uuid, timestamptz, uuid) to authenticated;

commit;
