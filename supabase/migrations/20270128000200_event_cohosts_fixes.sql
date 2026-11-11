-- =============================================================================
-- Co-hosts of one event: fixes from the light check on the build (2026-11-11).
--
--   * Past band directors (directors from the account's other contests, with their emails) are for the account's
--     hosts only. A co-host of one event could list them.
--   * Volunteer history: a co-host of one event sees it like a Volunteer Lead (owner: co-host replaces Volunteer
--     Lead, so making someone co-host never takes it away), until 10 days after their event.
--   * A co-host of one event can stop co-hosting until their access ends (10 days after the event), not only until
--     the event ends.
--   * Who the Account Host is: anyone who runs one of the account's events can ask (their name and email were
--     already on the event's Co-hosts tab).
--   * Taking a co-host of every event off one event clears only that event's earlier removal record.
-- =============================================================================

create or replace function public.past_band_directors(p_event uuid)
returns table (
  email         text,
  full_name     text,
  bands         text[],
  last_event    text,
  last_event_on date,
  registered    boolean,
  invited_at    timestamptz
)
language sql stable security definer set search_path = public
as $$
  with ev as (
    -- The account's other contests: its hosts only (not a co-host of one event).
    select e.organization_id from events e
     where e.id = p_event and public.is_event_admin(p_event) and public.is_org_admin(e.organization_id)
  ),
  past as (
    select b.director_user_id, b.band_name, b.school_name, e.name as event_name, e.starts_on
      from bands b
      join events e on e.id = b.event_id
     where e.organization_id = (select organization_id from ev)
       and e.id <> p_event
       and b.details_removed_at is null
  )
  select p.email::text,
         p.full_name,
         array_agg(distinct past.band_name || ' (' || past.school_name || ')'),
         (array_agg(past.event_name order by past.starts_on desc))[1],
         max(past.starts_on),
         exists (select 1 from bands b2 where b2.event_id = p_event and b2.director_user_id = p.id),
         (select i.sent_at from band_invitations i where i.event_id = p_event and i.email = p.email)
    from past
    join profiles p on p.id = past.director_user_id
   where p.email::text not like '%@demo.fieldcommandevents.com'
   group by p.id, p.email, p.full_name
   order by max(past.starts_on) desc, p.full_name;
$$;

do $$
declare
  src text;
begin
  select pg_get_functiondef('public.other_published_conference(uuid)'::regprocedure) into src;
  src := replace(src, 'public.is_event_admin(', 'public.is_org_admin(public.event_org(ev)) and public.is_event_admin(');
  if src not like '%public.is_org_admin(public.event_org(ev)) and public.is_event_admin(%' then
    raise exception 'other_published_conference changed shape; update this migration';
  end if;
  execute src;
end $$;

create or replace function public.can_see_volunteer_history(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from event_staff s join events e on e.id = s.event_id
                  where e.organization_id = p_org and s.user_id = auth.uid() and s.role in ('volunteer_director', 'co_host')
                    and (now() at time zone e.timezone)::date <= e.ends_on + 10);
$$;

drop policy "staff: leave" on public.event_staff;
create policy "staff: leave" on public.event_staff
  for delete to authenticated
  using (user_id = auth.uid()
         and exists (select 1 from events e where e.id = event_id
                      and e.ends_on + case when role = 'co_host' then 10 else 0 end >= (now() at time zone e.timezone)::date));

create or replace function public.account_host(p_org uuid)
returns table (user_id uuid, name text, email text)
language sql stable security definer set search_path = public
as $$
  select m.user_id, coalesce(nullif(trim(p.full_name), ''), p.email::text), p.email::text
    from organization_members m join profiles p on p.id = m.user_id
   where m.organization_id = p_org and m.role = 'owner'
     and (public.is_org_admin(p_org)
          or exists (select 1 from events e where e.organization_id = p_org and public.is_event_admin(e.id)))
   order by m.created_at
   limit 1;
$$;

do $$
declare
  src text;
begin
  select pg_get_functiondef('public.remove_cohost_from_event(uuid, uuid)'::regprocedure) into src;
  src := replace(src,
    'delete from team_removals where organization_id = org and user_id = p_user and role = ''co_host'';',
    'delete from team_removals where organization_id = org and user_id = p_user and role = ''co_host'' and (event_id is null or event_id = p_event);');
  if src not like '%and (event_id is null or event_id = p_event);%' then
    raise exception 'remove_cohost_from_event changed shape; update this migration';
  end if;
  execute src;
end $$;
