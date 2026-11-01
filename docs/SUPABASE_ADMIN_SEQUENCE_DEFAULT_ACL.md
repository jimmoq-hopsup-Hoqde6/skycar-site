# supabase_admin default privileges on public sequences

Migration: `supabase/migrations/20261101140000_revoke_supabase_admin_sequence_default_acl.sql`
(follows `20261101133000_revoke_public_sequence_grants.sql`, which only covered the role that ran it).

## Why

On a hosted Supabase project `supabase_admin` has its own default ACL for schema `public`.
A sequence it creates later would be born with `USAGE`, `SELECT` and `UPDATE` for `anon` and
`authenticated`. The migration revokes `ALL` on sequences from `anon`, `authenticated` and `PUBLIC`
in that default ACL and then asserts the result.

## How to run

- Run as `supabase_admin` or a member of it. `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`
  needs that membership. Without it the migration aborts with SQLSTATE 42501 and the message
  "run this migration as supabase_admin or as a member of it". It never skips silently.
- Where `supabase_admin` does not exist (local, CI) the role step prints a notice and is skipped;
  the post-condition still checks the current role's defaults and every existing public sequence.
- Idempotent. It grants nothing; `service_role` is untouched.
- Do not apply to a hosted project without the project owner's approval.

## Post-condition (inside the migration)

The migration raises an exception if either holds:

1. A `pg_default_acl` row (schema `public`, object type `S`) owned by `supabase_admin` or the
   running role grants anything to `anon`, `authenticated` or `PUBLIC`.
2. An existing non-extension sequence in `public` has any privilege for `anon`, `authenticated`
   or `PUBLIC` (read with `aclexplode`).

It also raises a WARNING (not an error) when `supabase_admin` has a *global* default ACL (not
schema-specific) on sequences that grants those roles; `IN SCHEMA public` cannot remove it.

## Verification SQL (read only, hosted project)

Default ACLs: expect **no rows**.

```sql
select pg_get_userbyid(d.defaclrole) as creator,
       coalesce(n.nspname, '(all schemas)') as schema_name,
       case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
where d.defaclobjtype = 'S'
  and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
order by 1, 2, 3, 4;
```

Existing public sequences: expect **no rows**.

```sql
select c.relname, pg_get_userbyid(c.relowner) as owner,
       case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type
from pg_class c
cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend e where e.objid = c.oid and e.deptype = 'e')
  and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
order by 1, 3, 4;
```

Before the migration the first query is expected to list `supabase_admin | public | anon/authenticated |
SELECT, UPDATE, USAGE` on the staging project. Rows for other creators (for example `postgres`) should
already be gone after `20261101133000`. Any row left is a finding, not something to clean up by hand.
