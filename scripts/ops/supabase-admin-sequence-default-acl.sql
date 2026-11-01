-- OPS SCRIPT, NOT A MIGRATION. Run ONLY as supabase_admin (or a member of it); never from the migration chain.
--
-- Closes supabase_admin's default privileges on public sequences for anon, authenticated and PUBLIC,
-- both IN SCHEMA public and the global (all schemas) entry, then verifies and FAILS HARD.
-- Hosted customers normally cannot connect as supabase_admin; this is the script to hand to the
-- party that can. Read docs/SUPABASE_ADMIN_SEQUENCE_DEFAULT_ACL.md first. Do not run against staging or
-- production without the project owner's approval. Run the read-only gate before and after:
--   scripts/ops/sequence-default-acl-gate.sql
--
-- psql "$SUPABASE_ADMIN_URL" -X -v ON_ERROR_STOP=1 -f scripts/ops/supabase-admin-sequence-default-acl.sql
--
-- Everything is one transaction: any failure (not allowed, or verification still finding a grant) leaves
-- the database exactly as it was. Idempotent. service_role privileges are not changed.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise notice 'SKYCAR-SEQ-ACL: role supabase_admin does not exist; nothing to revoke (verification still runs)';
    return;
  end if;
  if not (pg_has_role(current_user, 'supabase_admin', 'MEMBER') or (select rolsuper from pg_roles where rolname = current_user)) then
    raise exception 'SKYCAR-SEQ-ACL: % cannot change the default privileges of supabase_admin; run this script as supabase_admin or a member of it', current_user
      using errcode = 'insufficient_privilege';
  end if;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, public;
  alter default privileges for role supabase_admin revoke all on sequences from anon, authenticated, public;
end $$;

-- Verification: same findings as the gate (any creator role, schema public and global, existing sequences).
do $$
declare
  f record;
  n integer := 0;
begin
  for f in
-- findings:begin
select kind, detail from (
  select 'default_acl' as kind,
         format('creator=%s scope=%s grantee=%s privilege=%s',
                pg_get_userbyid(d.defaclrole),
                case when d.defaclnamespace = 0 then 'GLOBAL(all schemas)' else d.defaclnamespace::regnamespace::text end,
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type) as detail
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclobjtype = 'S'
    and (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
    and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
  union all
  select 'sequence' as kind,
         format('sequence=public.%s owner=%s grantee=%s privilege=%s',
                c.relname,
                pg_get_userbyid(c.relowner),
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type) as detail
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
  where c.relkind = 'S'
    and c.relnamespace = 'public'::regnamespace
    and not exists (select 1 from pg_depend e where e.objid = c.oid and e.deptype = 'e')
    and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
) findings
order by kind, detail
-- findings:end
  loop
    n := n + 1;
    raise warning 'SKYCAR-SEQ-ACL: % %', f.kind, f.detail;
  end loop;
  if n > 0 then
    raise exception 'SKYCAR-SEQ-ACL: NO-GO (% finding(s)); transaction rolled back, nothing changed', n;
  end if;
  raise notice 'SKYCAR-SEQ-ACL: verified, no default ACL or public sequence grants anon, authenticated or PUBLIC anything';
end $$;

commit;
