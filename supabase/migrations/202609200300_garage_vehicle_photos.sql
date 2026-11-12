begin;

alter table public.media_assets
  add column idempotency_key uuid,
  add column content_sha256 text,
  add column processing_state text not null default 'stored'
    check (processing_state in ('uploading','stored','processing','ready','failed'));

alter table public.media_assets
  add constraint media_assets_sha256_format check (
    content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'
  );

create unique index media_assets_owner_idempotency_idx
  on public.media_assets(owner_id, idempotency_key)
  where idempotency_key is not null;

-- Media state is server-owned. Authenticated clients can read only safe
-- metadata columns and cannot call the service-role write functions below.
revoke all on public.media_assets from public, anon, authenticated;
grant select (id, vehicle_id, purpose, mime_type, size_bytes, created_at, processing_state)
  on public.media_assets to authenticated;

-- Originals enter Storage only through the validated HTTP boundary. The
-- foundation owner-path policies protected cross-account access but still let
-- a browser bypass image validation and create untracked objects.
drop policy if exists private_media_insert_own on storage.objects;
drop policy if exists private_media_delete_own on storage.objects;
revoke insert, update, delete on storage.objects from authenticated;

create function public.garage_reserve_vehicle_photo(
  p_actor uuid,
  p_vehicle_id uuid,
  p_asset_id uuid,
  p_object_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_key uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  vehicle public.vehicles%rowtype;
  prior public.media_assets%rowtype;
  asset public.media_assets%rowtype;
  extension text;
  expected_path text;
begin
  if p_actor is null or p_vehicle_id is null or p_asset_id is null or p_key is null
     or p_mime_type not in ('image/jpeg','image/png','image/webp')
     or p_size_bytes not between 128 and 10000000
     or p_content_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'VALIDATION_FAILED'; end if;

  extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
  expected_path := p_actor::text || '/vehicles/' || p_vehicle_id::text || '/' || p_asset_id::text || '/original.' || extension;
  if p_object_path is distinct from expected_path then raise exception 'VALIDATION_FAILED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':vehicle-photo:' || p_key::text, 0));
  select * into prior from public.media_assets
    where owner_id = p_actor and idempotency_key = p_key for update;
  if found then
    if prior.vehicle_id is distinct from p_vehicle_id
       or prior.id is distinct from p_asset_id
       or prior.object_path is distinct from p_object_path
       or prior.mime_type is distinct from p_mime_type
       or prior.size_bytes is distinct from p_size_bytes
       or prior.content_sha256 is distinct from p_content_sha256
    then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if prior.processing_state = 'failed' then
      update public.media_assets set processing_state = 'uploading' where id = prior.id returning * into prior;
    end if;
    return to_jsonb(prior) || jsonb_build_object('replayed',prior.processing_state = 'stored');
  end if;

  select * into vehicle from public.vehicles
    where id = p_vehicle_id and owner_id = p_actor for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if vehicle.archived_at is not null then raise exception 'VEHICLE_ARCHIVED'; end if;

  insert into public.media_assets(
    id,owner_id,vehicle_id,bucket,object_path,purpose,mime_type,size_bytes,
    idempotency_key,content_sha256,processing_state
  ) values (
    p_asset_id,p_actor,p_vehicle_id,'private-media',p_object_path,'vehicle_original',
    p_mime_type,p_size_bytes,p_key,p_content_sha256,'uploading'
  ) returning * into asset;
  return to_jsonb(asset) || jsonb_build_object('replayed',false);
end;
$$;

create function public.garage_finalize_vehicle_photo(
  p_actor uuid,
  p_key uuid,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  asset public.media_assets%rowtype;
begin
  if p_actor is null or p_key is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':vehicle-photo:' || p_key::text, 0));
  select * into asset from public.media_assets
    where owner_id = p_actor and idempotency_key = p_key for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if asset.processing_state = 'stored' then
    return (to_jsonb(asset) - array['owner_id','bucket','object_path','content_sha256','idempotency_key'])
      || jsonb_build_object('original_status','stored','display_status','unavailable','replayed',true);
  end if;
  if asset.processing_state <> 'uploading' then raise exception 'UPLOAD_FAILED'; end if;
  if not exists (
    select 1 from storage.objects where bucket_id = asset.bucket and name = asset.object_path
  ) then raise exception 'PHOTO_NOT_UPLOADED'; end if;

  update public.media_assets set processing_state = 'stored'
    where id = asset.id returning * into asset;
  insert into public.vehicle_history(vehicle_id,event_type,occurred_at,source,payload)
  values (asset.vehicle_id,'vehicle_photo_added',asset.created_at,'garage',
    jsonb_build_object('asset_id',asset.id,'purpose','vehicle_original'));
  insert into public.audit_events(actor_user_id,action,resource_type,resource_id,request_id,metadata)
  values (p_actor,'vehicle_photo_added','vehicle',asset.vehicle_id::text,p_request_id::text,
    jsonb_build_object('asset_id',asset.id,'mime_type',asset.mime_type,'size_bytes',asset.size_bytes));

  return (to_jsonb(asset) - array['owner_id','bucket','object_path','content_sha256','idempotency_key'])
    || jsonb_build_object('original_status','stored','display_status','unavailable','replayed',false);
end;
$$;

create function public.garage_fail_vehicle_photo(p_actor uuid, p_key uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_actor is null or p_key is null then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':vehicle-photo:' || p_key::text, 0));
  update public.media_assets set processing_state = 'failed'
    where owner_id = p_actor and idempotency_key = p_key and processing_state = 'uploading';
end;
$$;

revoke all on function public.garage_reserve_vehicle_photo(uuid,uuid,uuid,text,text,bigint,text,uuid) from public, anon, authenticated;
revoke all on function public.garage_finalize_vehicle_photo(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.garage_fail_vehicle_photo(uuid,uuid) from public, anon, authenticated;
grant execute on function public.garage_reserve_vehicle_photo(uuid,uuid,uuid,text,text,bigint,text,uuid) to service_role;
grant execute on function public.garage_finalize_vehicle_photo(uuid,uuid,uuid) to service_role;
grant execute on function public.garage_fail_vehicle_photo(uuid,uuid) to service_role;

commit;
