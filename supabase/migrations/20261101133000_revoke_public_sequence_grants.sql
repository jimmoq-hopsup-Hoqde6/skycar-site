begin;

-- Sequence hardening. Tables in public are locked down per migration (and by
-- 202609300001_staging_access_hardening.sql), but sequences kept the Supabase default
-- privileges: anon, authenticated and service_role each hold USAGE, SELECT and UPDATE on
-- audit_events_id_seq and care_journey_events_id_seq (setval/nextval reachable by any code
-- path that runs with a browser role's privileges). Browser roles never need sequence
-- privileges here: identity columns advance implicitly on INSERT and need no sequence ACL.
--
-- 1. Revoke every privilege on every existing sequence in public from PUBLIC, anon and
--    authenticated. The loop covers the current set and any sequence added by an earlier-sorting
--    migration. Extension-owned sequences are skipped; sequences the migration role does not
--    own are skipped with a notice (a REVOKE there would fail or silently do nothing).
-- 2. service_role keeps USAGE and SELECT (its existing explicit grant on
--    care_journey_events_id_seq is now stated for every sequence); it does not need UPDATE,
--    which is left alone rather than revoked so this migration changes nothing for it.
do $$
declare
  seq record;
begin
  for seq in
    select c.oid, c.relname, c.relowner
    from pg_class c
    where c.relkind = 'S'
      and c.relnamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by c.relname
  loop
    if not pg_has_role(current_user, seq.relowner, 'USAGE') then
      raise notice 'skipping sequence public.% (owned by a role this migration cannot act as)', seq.relname;
      continue;
    end if;
    execute format('revoke all on sequence public.%I from public, anon, authenticated', seq.relname);
    execute format('grant usage, select on sequence public.%I to service_role', seq.relname);
  end loop;
end $$;

-- 3. Future sequences created by the role running this migration (usually postgres) no longer
--    get default privileges for anon/authenticated. This only affects objects created later
--    by that same role: ALTER DEFAULT PRIVILEGES is per creating role, so a sequence created
--    by another owner (for example supabase_admin on a hosted project) is NOT covered and
--    needs its own explicit REVOKE. A future migration that adds a serial/bigserial column
--    which a browser role must insert through must grant that sequence explicitly; identity
--    columns need nothing.
alter default privileges in schema public revoke all on sequences from anon, authenticated;

commit;
