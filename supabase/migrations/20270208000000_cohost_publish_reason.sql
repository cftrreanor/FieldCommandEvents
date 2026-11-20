-- =============================================================================
-- org_can_publish for a Co-host of one event
-- =============================================================================
-- Event settings' Publishing card asks org_can_publish whether an event could be published again after
-- unpublishing. A Co-host of one event (20270128000100_event_cohosts.sql) may publish and unpublish their event,
-- but this function only answered the account's hosts, so they were told "That event wasn't found. If you
-- unpublish it, you can't publish it again until that changes." Now it answers anyone who may run the event
-- (is_event_admin), and stays private to everyone else. Safe to run twice.

create or replace function public.org_can_publish(p_event uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  ev events;
begin
  select * into ev from events where id = p_event;
  if ev.id is null or not (public.is_org_admin(ev.organization_id) or public.is_event_admin(ev.id) or public.is_platform_admin()
                           or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    return 'That event wasn''t found.';
  end if;
  return public.org_publish_reason(ev.organization_id, ev.event_type::text, ev.id);
end;
$$;
revoke execute on function public.org_can_publish(uuid) from public, anon;
grant execute on function public.org_can_publish(uuid) to authenticated, service_role;
