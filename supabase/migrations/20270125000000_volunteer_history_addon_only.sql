-- Volunteer history (adults' name, email, and shift counts for 2 years) is kept only for accounts
-- whose package includes volunteer tracking (owner, 2026-11-10). Everyone else's volunteers are fully
-- gone 10 days after the event, as the website says. An account that adds volunteer tracking later
-- starts its history from then.
create or replace function public.purge_volunteers()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n int;
  ev record;
begin
  for ev in
    select distinct e.organization_id
      from volunteers v
      join events e on e.id = v.event_id
      join organizations o on o.id = e.organization_id
      join plan_tiers t on t.code = o.package
     where (now() at time zone e.timezone)::date > e.ends_on + 10
       and t.volunteer_history
  loop
    insert into volunteer_history (organization_id, email, event_id, event_name, event_on, full_name, signed_up, checked_in)
    select ev.organization_id, c.email, c.event_id, c.event_name, c.event_on, c.full_name, c.signed_up, c.checked_in
      from public.volunteer_event_counts(ev.organization_id, 'infinity') c
      join events e on e.id = c.event_id
     where (now() at time zone e.timezone)::date > e.ends_on + 10
       and c.signed_up > 0
       and not exists (select 1 from volunteer_history_removed r
                        where r.organization_id = ev.organization_id and r.email = c.email and r.removed_at >= c.event_on)
    on conflict (organization_id, email, event_id) do nothing;
  end loop;

  with gone as (
    delete from volunteers v using events e
     where e.id = v.event_id and (now() at time zone e.timezone)::date > e.ends_on + 10
    returning 1
  )
  select count(*)::int into n from gone;

  delete from volunteer_history h
   where not exists (select 1 from volunteer_history recent
                      where recent.organization_id = h.organization_id and recent.email = h.email
                        and recent.event_on >= current_date - interval '2 years');
  return n;
end;
$$;
revoke execute on function public.purge_volunteers() from public, anon, authenticated;
grant execute on function public.purge_volunteers() to service_role;
