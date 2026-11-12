begin;

-- Stable keyset order; changing status/deadline must not move a row between pages.
create index care_requests_customer_page_idx
  on public.care_requests(customer_id, created_at desc, id desc);

create function public.care_list_requests(
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
      select r.*, v.archived_at as vehicle_archived_at
      from public.care_requests r join public.vehicles v on v.id = r.vehicle_id
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
        'is_overdue', coalesce(responsible_role = 'operations' and next_update_at <= evaluated_at, false)
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
