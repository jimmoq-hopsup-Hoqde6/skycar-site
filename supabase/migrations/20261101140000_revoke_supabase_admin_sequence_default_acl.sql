begin;

-- Sequence default-privilege follow-up to 20261101133000. MIGRATION-SAFE BY DESIGN.
--
-- 20261101133000 only changed the default privileges of the role that ran it. On a hosted Supabase
-- project supabase_admin keeps its own default ACL for schema public (and possibly a global one),
-- so a sequence supabase_admin creates later can still be born with USAGE, SELECT and UPDATE for
-- anon and authenticated. That can NOT be fixed from a migration: hosted customers cannot act as
-- supabase_admin, and the Supabase CLI runs migrations as postgres, which is not a member of it.
-- An earlier draft of this file ran ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin and failed
-- every runner that is not a member, which would have stopped every later migration. This file
-- never touches supabase_admin and never raises because of anyone else's defaults.
--
-- What it does, all within the running role's own control (cannot fail on hosted):
--   1. Revoke every privilege from PUBLIC, anon and authenticated on every non-extension sequence in
--      public that the running role can act as (the same loop as 20261101133000, so a replay on a
--      database rebuilt by a different role is also covered). service_role is untouched.
--   2. Revoke the running role's own default sequence privileges in schema public from PUBLIC, anon
--      and authenticated.
--   3. REPORT (WARNING, SQLSTATE 01000, message prefix SKYCAR-SEQ-ACL) every remaining sequence ACL or
--      default ACL that grants anon, authenticated or PUBLIC anything: any creator role, schema public
--      and global defaults, any sequence owner. Reporting never raises.
--
-- The supabase_admin part is a separate, manual step: scripts/ops/supabase-admin-sequence-default-acl.sql
-- (run only as supabase_admin) and the read-only go/no-go gate scripts/ops/sequence-default-acl-gate.sql.
-- See docs/SUPABASE_ADMIN_SEQUENCE_DEFAULT_ACL.md. Idempotent; safe to re-run in any state.

-- 1. Existing public sequences the running role can act as.
do $$
declare
  seq record;
begin
  for seq in
    select c.relname, c.relowner
    from pg_class c
    where c.relkind = 'S'
      and c.relnamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by c.relname
  loop
    if not pg_has_role(current_user, seq.relowner, 'USAGE') then
      raise notice 'SKYCAR-SEQ-ACL: skipping sequence public.% (owned by a role this migration cannot act as)', seq.relname;
      continue;
    end if;
    execute format('revoke all on sequence public.%I from public, anon, authenticated', seq.relname);
  end loop;
end $$;

-- 2. The running role's own defaults for sequences created later in public.
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;

-- 3. Report only. Never raises.
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
  if n = 0 then
    raise notice 'SKYCAR-SEQ-ACL: clean, no default ACL or public sequence grants anon, authenticated or PUBLIC anything';
  else
    raise warning 'SKYCAR-SEQ-ACL: % finding(s) remain that this migration cannot or must not change; run scripts/ops/sequence-default-acl-gate.sql and see docs/SUPABASE_ADMIN_SEQUENCE_DEFAULT_ACL.md', n;
  end if;
end $$;

commit;
