-- READ-ONLY go/no-go gate for sequence privileges on public. Changes nothing (read only transaction).
--
-- Run against the hosted project before and after scripts/ops/supabase-admin-sequence-default-acl.sql:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/ops/sequence-default-acl-gate.sql
-- Exit status 0 and a final GO row = go. Any finding lists as a row and as a WARNING, and the script
-- then fails with message "SKYCAR-SEQ-ACL: NO-GO" (SQLSTATE P0001) = no-go.
--
-- A finding is any of:
--   default_acl  a pg_default_acl row for sequences, ANY creator role, scoped to schema public or GLOBAL
--                (all schemas), that grants anon, authenticated or PUBLIC any privilege (USAGE, SELECT or
--                UPDATE; a global entry is a failure, not a warning, because IN SCHEMA cannot remove it).
--   sequence     a non-extension sequence in public, any owner, whose ACL grants anon, authenticated or
--                PUBLIC any privilege.

begin read only;

-- findings:begin
select kind, detail from (
  select 'default_acl' as kind,
         format('creator=%s scope=%s grantee=%s privilege=%s',
                quote_ident(pg_get_userbyid(d.defaclrole)),
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
;

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
                quote_ident(pg_get_userbyid(d.defaclrole)),
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
    raise exception 'SKYCAR-SEQ-ACL: NO-GO (% finding(s))', n;
  end if;
end $$;

select 'GO' as sequence_default_acl_gate;

rollback;
