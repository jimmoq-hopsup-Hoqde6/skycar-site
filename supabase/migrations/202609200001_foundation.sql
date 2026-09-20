begin;

create type public.app_role as enum ('customer','technician','fleet_member','fleet_admin','admin');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  make text not null,
  model text not null,
  variant text,
  year smallint check (year between 1886 and 2200),
  registration text,
  registration_state text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicles_owner_idx on public.vehicles(owner_id);

create table public.vehicle_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null,
  source text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index vehicle_history_vehicle_idx on public.vehicle_history(vehicle_id, occurred_at desc);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  bucket text not null default 'private-media',
  object_path text not null unique,
  purpose text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_history enable row level security;
alter table public.media_assets enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_own on public.profiles for select using (user_id = auth.uid());
create policy profiles_update_own on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy roles_select_own on public.user_roles for select using (user_id = auth.uid());

create policy vehicles_select_own on public.vehicles for select using (owner_id = auth.uid());
create policy vehicles_insert_own on public.vehicles for insert with check (owner_id = auth.uid());
create policy vehicles_update_own on public.vehicles for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy vehicles_delete_own on public.vehicles for delete using (owner_id = auth.uid());

create policy history_select_own on public.vehicle_history for select using (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = auth.uid())
);
create policy history_insert_own on public.vehicle_history for insert with check (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = auth.uid())
);

create policy media_select_own on public.media_assets for select using (owner_id = auth.uid());
create policy media_insert_own on public.media_assets for insert with check (
  owner_id = auth.uid() and (
    vehicle_id is null or exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = auth.uid())
  )
);
create policy media_delete_own on public.media_assets for delete using (owner_id = auth.uid());

insert into storage.buckets (id,name,public)
values ('private-media','private-media',false)
on conflict (id) do update set public=false;

create policy private_media_read_own on storage.objects for select to authenticated
using (bucket_id='private-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy private_media_insert_own on storage.objects for insert to authenticated
with check (bucket_id='private-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy private_media_delete_own on storage.objects for delete to authenticated
using (bucket_id='private-media' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.profiles(user_id) values (new.id);
  insert into public.user_roles(user_id,role) values (new.id,'customer');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

commit;
