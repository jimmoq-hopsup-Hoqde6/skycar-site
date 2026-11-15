begin;

-- Baseline tables originally inherited broad Supabase default grants.
-- Preserve only the reads and profile edit used by the customer app.
-- Garage writes are mediated by the audited ownership-checking RPC.
revoke all on public.audit_events, public.profiles, public.user_roles,
  public.vehicles, public.vehicle_history from anon, authenticated;
grant select on public.profiles, public.user_roles, public.vehicles,
  public.vehicle_history to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

-- This is an Auth trigger, never a client-callable RPC.
revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
