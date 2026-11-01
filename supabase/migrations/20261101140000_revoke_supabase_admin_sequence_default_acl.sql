begin;

-- Close the supabase_admin default privileges on public sequences.
--
-- 20261101133000_revoke_public_sequence_grants.sql only changed the default privileges of the
-- role that ran it (usually postgres). On a hosted Supabase project supabase_admin keeps its own
-- default ACL for schema public, so any sequence supabase_admin creates later would still be
-- born with USAGE, SELECT and UPDATE for anon and authenticated. No supabase_admin-owned
-- sequence exists today, so nothing is exposed now; this removes the path.
--
-- RUN THIS MIGRATION AS supabase_admin (or as a member of it). ALTER DEFAULT PRIVILEGES FOR ROLE
-- needs membership of the named role; the migration fails loudly (it never skips quietly) when
-- the running role lacks that. Where supabase_admin does not exist (local and CI databases) the
-- role step is skipped with a notice, and the post-condition still runs for the current role.
--
-- The migration is idempotent and forward-only; it grants nothing and revokes only from
-- anon, authenticated and PUBLIC. service_role is deliberately untouched.
--
-- Verification for the hosted project (read only; run in the SQL editor or psql). Expect zero
-- rows from the first query and zero from the second. docs/SUPABASE_ADMIN_SEQUENCE_DEFAULT_ACL.md
-- repeats these queries with notes:
--
--   select pg_get_userbyid(d.defaclrole) as creator,
--          coalesce(n.nspname, '(all schemas)') as schema_name,
--          case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
--          a.privilege_type
--   from pg_default_acl d
--   left join pg_namespace n on n.oid = d.defaclnamespace
--   cross join lateral aclexplode(d.defaclacl) a
--   where d.defaclobjtype = 'S'
--     and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
--   order by 1, 2, 3, 4;
--
--   select c.relname, pg_get_userbyid(c.relowner) as owner,
--          case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
--          a.privilege_type
--   from pg_class c
--   cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
--   where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace
--     and not exists (select 1 from pg_depend e where e.objid = c.oid and e.deptype = 'e')
--     and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
--   order by 1, 3, 4;

-- 1. Revoke supabase_admin's default sequence privileges in schema public.
do $$
declare
  grantees text;
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise notice 'role supabase_admin does not exist; skipping its default privileges (expected on local and CI databases)';
    return;
  end if;

  -- anon and authenticated may be absent on a bare database; PUBLIC always exists.
  select coalesce(string_agg(quote_ident(rolname), ', ' order by rolname) || ', ', '')
    into grantees
  from pg_roles
  where rolname in ('anon', 'authenticated');

  begin
    execute format(
      'alter default privileges for role supabase_admin in schema public revoke all on sequences from %spublic',
      grantees
    );
  exception when insufficient_privilege then
    raise exception
      'cannot change the default privileges of role supabase_admin as %: run this migration as supabase_admin or as a member of it (original error: %)',
      current_user, sqlerrm
      using errcode = 'insufficient_privilege',
            hint = 'Connect as supabase_admin (or grant supabase_admin to the migration role), then re-run. The migration is idempotent.';
  end;
end $$;

-- 2. Post-condition: fail the whole migration unless nothing grants a browser role or PUBLIC
--    anything on public sequences, now or by default.
do $$
declare
  leak text;
begin
  -- Default ACLs for sequences in schema public owned by supabase_admin or the running role.
  select string_agg(distinct format('default ACL of %s grants %s to %s', pg_get_userbyid(d.defaclrole), a.privilege_type,
           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), '; ')
    into leak
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'S'
    and (d.defaclrole = (select oid from pg_roles where rolname = 'supabase_admin')
         or d.defaclrole = (select oid from pg_roles where rolname = current_user))
    and (a.grantee = 0
         or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')));
  if leak is not null then
    raise exception 'pg_default_acl still grants browser roles or PUBLIC privileges on new public sequences: %', leak;
  end if;

  -- Existing, non-extension sequences in public.
  select string_agg(distinct format('%s grants %s to %s', c.relname, a.privilege_type,
           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), '; ')
    into leak
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
  where c.relkind = 'S'
    and c.relnamespace = 'public'::regnamespace
    and not exists (select 1 from pg_depend e where e.objid = c.oid and e.deptype = 'e')
    and (a.grantee = 0
         or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')));
  if leak is not null then
    raise exception 'public sequences still grant privileges to browser roles or PUBLIC: %', leak;
  end if;

  -- A schema-less default ACL for supabase_admin cannot be removed by IN SCHEMA, so report it.
  if exists (
    select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 0 and d.defaclobjtype = 'S'
      and d.defaclrole = (select oid from pg_roles where rolname = 'supabase_admin')
      and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
  ) then
    raise warning 'supabase_admin has a global (not schema-specific) default ACL on sequences granting browser roles or PUBLIC; IN SCHEMA public cannot revoke it';
  end if;
end $$;

commit;
