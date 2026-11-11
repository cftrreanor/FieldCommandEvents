-- =============================================================================
-- Co-hosts of one event (owner, 2026-11-11; docs/design-decisions/2026-11-11-event-cohosts.md).
--
--   * A co-host of one event is an event_staff row with role 'co_host'. They can do everything a host can on
--     that event (is_event_admin), until 10 days after it ends, like Volunteer Leads. Account-wide things
--     (is_org_admin: the account's members, other events, volunteer history, the plan's settings) stay closed.
--   * Only the Account Host adds, invites, changes, or removes co-hosts of either kind. A co-host can leave.
--   * Only the Account Host deletes events (co-hosts of every event could before).
--   * "From your team": add_team_member adds someone already on the team straight to an event's team. People
--     without the account's view (co-hosts of one event, Volunteer Leads) only pick people already on this event.
--   * Co-host of one event replaces Volunteer Lead on the same event.
--   * A co-host of every event can be taken off one event (they stay a co-host of each other open event, and
--     aren't added to new ones), changed to one event, or changed back to every event. Undo puts things back.
--   * Team spots: a co-host of one event uses one like a co-host (allowed on every plan), until their event is
--     over, like Volunteer Leads.
-- =============================================================================

-- 1. Access ------------------------------------------------------------------------
create or replace function public.is_event_admin(ev uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from events e
    join organization_members m on m.organization_id = e.organization_id
    where e.id = ev and m.user_id = auth.uid()
  ) or exists (
    select 1 from event_staff s join events e on e.id = s.event_id
     where s.event_id = ev and s.user_id = auth.uid() and s.role = 'co_host'
       and (now() at time zone e.timezone)::date <= e.ends_on + 10
  );
$$;

-- The event's own account, read as it is now (an update can't move an event to another account).
create function public.event_org(ev uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select organization_id from events where id = ev $$;
revoke execute on function public.event_org(uuid) from public, anon;
grant execute on function public.event_org(uuid) to authenticated;

drop policy "events: hosts update" on public.events;
create policy "events: hosts update" on public.events
  for update to authenticated
  using (public.is_event_admin(id))
  with check (public.is_org_admin(organization_id)
              or (public.is_event_admin(id) and organization_id = public.event_org(id)));

drop policy "events: hosts delete" on public.events;
create policy "events: account host deletes" on public.events
  for delete to authenticated using (public.is_org_owner(organization_id));

-- The plan (what the event can use) for anyone who runs one of the account's events.
do $$
declare
  src text;
begin
  select pg_get_functiondef('public.account_plan(uuid)'::regprocedure) into src;
  src := replace(src, 'public.is_org_admin(p_org) or public.is_platform_admin()',
                 'public.is_org_admin(p_org) or public.is_platform_admin()'
                 || ' or exists (select 1 from events ev where ev.organization_id = p_org and public.is_event_admin(ev.id))');
  if src not like '%ev.organization_id = p_org and public.is_event_admin%' then
    raise exception 'account_plan changed shape; update this migration';
  end if;
  execute src;
end $$;

-- 2. Who can add and remove co-hosts ----------------------------------------------------
drop policy "staff: hosts remove" on public.event_staff;
create policy "staff: hosts remove" on public.event_staff
  for delete to authenticated
  using ((role <> 'co_host' and public.is_event_admin(event_id))
         or (role = 'co_host' and public.is_org_owner(public.event_org(event_id))));

drop policy "invitations: hosts invite" on public.invitations;
create policy "invitations: hosts invite" on public.invitations
  for insert to authenticated
  with check (invited_by = auth.uid()
              and ((not as_host and role <> 'co_host' and public.is_event_admin(event_id))
                   or ((as_host or role = 'co_host') and public.is_org_owner(organization_id))));
drop policy "invitations: hosts cancel" on public.invitations;
create policy "invitations: hosts cancel" on public.invitations
  for delete to authenticated
  using (accepted_at is null
         and ((not as_host and role <> 'co_host' and public.is_event_admin(event_id))
              or ((as_host or role = 'co_host') and public.is_org_owner(organization_id))));

do $$
declare
  src text;
begin
  select pg_get_functiondef('public.prepare_invitation_email(uuid)'::regprocedure) into src;
  src := replace(src, 'case when inv.as_host then public.is_org_owner(inv.organization_id)',
                 'case when inv.as_host or inv.role = ''co_host'' then public.is_org_owner(inv.organization_id)');
  src := replace(src, 'public.team_add_reason(inv.organization_id, null, inv.email::text, not inv.as_host)',
                 'public.team_add_reason(inv.organization_id, null, inv.email::text, not inv.as_host and inv.role <> ''co_host'')');
  if src not like '%inv.as_host or inv.role = ''co_host''%' or src not like '%inv.role <> ''co_host'')%' then
    raise exception 'prepare_invitation_email changed shape; update this migration';
  end if;
  execute src;
end $$;

-- 3. Team spots: a co-host of one event counts like a co-host (every plan has co-hosts). ---------------
create or replace function public.team_limits_on_members()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  reason text;
begin
  if tg_table_name = 'organization_members' then
    if new.role::text = 'owner' then
      return new;
    end if;
    reason := public.team_add_reason(new.organization_id, new.user_id, null, false);
  else
    reason := public.team_add_reason((select organization_id from events where id = new.event_id), new.user_id, null,
                                     new.role <> 'co_host');
  end if;
  if reason is not null then
    raise exception '%', reason using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.team_limits_on_invitations()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  reason text := public.team_add_reason(new.organization_id, null, new.email::text,
                                        not new.as_host and new.role is distinct from 'co_host');
begin
  if reason is not null then
    raise exception '%', reason using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 4. One role per event: co-host replaces Volunteer Lead; nobody is both a co-host of every event and of one. --
create function public.event_staff_one_host_role()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'co_host' and current_setting('app.team_change', true) is distinct from 'on' then
    if exists (select 1 from events e join organization_members m on m.organization_id = e.organization_id
                where e.id = new.event_id and m.user_id = new.user_id) then
      raise exception 'They''re already a co-host of every event' using errcode = 'P0001';
    end if;
  elsif new.role = 'volunteer_director'
        and exists (select 1 from event_staff s where s.event_id = new.event_id and s.user_id = new.user_id and s.role = 'co_host') then
    raise exception 'They''re already a co-host of this event, which includes running volunteers' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.event_staff_one_host_role() from public, anon, authenticated;
create trigger event_staff_1_one_host_role
  before insert on public.event_staff
  for each row execute function public.event_staff_one_host_role();

create function public.event_staff_cohost_replaces_lead()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Inside a trigger, so it isn't recorded as a removal.
  delete from event_staff where event_id = new.event_id and user_id = new.user_id and role = 'volunteer_director';
  return null;
end;
$$;
revoke execute on function public.event_staff_cohost_replaces_lead() from public, anon, authenticated;
create trigger event_staff_cohost_replaces_lead
  after insert on public.event_staff
  for each row when (new.role = 'co_host')
  execute function public.event_staff_cohost_replaces_lead();

-- A co-host of one event who becomes a co-host of every event: the event rows go.
create function public.org_members_absorb_event_cohosts()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'admin' then
    delete from event_staff s using events e
     where e.id = s.event_id and e.organization_id = new.organization_id and s.user_id = new.user_id and s.role = 'co_host';
  end if;
  return null;
end;
$$;
revoke execute on function public.org_members_absorb_event_cohosts() from public, anon, authenticated;
create trigger org_members_absorb_event_cohosts
  after insert on public.organization_members
  for each row execute function public.org_members_absorb_event_cohosts();

-- 5. Removal records: a co-host of one event is removed from that event. --------------------------
alter table public.team_removals drop constraint if exists team_removals_check;
alter table public.team_removals add constraint team_removals_event_unless_cohost check (role = 'co_host' or event_id is not null);
-- A co-host of every event taken off one event: Undo makes them a co-host of every event again.
alter table public.team_removals add column was_every boolean not null default false;

drop policy "team removals: hosts see removed co-hosts" on public.team_removals;
create policy "team removals: hosts see removed co-hosts" on public.team_removals
  for select to authenticated
  using (role = 'co_host' and (public.is_org_admin(organization_id) or (event_id is not null and public.is_event_admin(event_id))));

alter table public.account_host_handoffs drop constraint if exists account_host_handoffs_closed_reason_check;
alter table public.account_host_handoffs add constraint account_host_handoffs_closed_reason_check
  check (closed_reason in ('withdrawn', 'declined', 'replaced', 'left', 'changed'));

-- Changes made by the functions below aren't removals (they record their own).
do $$
declare
  f text;
  src text;
begin
  foreach f in array array['public.event_staff_record_removal()', 'public.org_members_record_removal()'] loop
    select pg_get_functiondef(f::regprocedure) into src;
    src := replace(src, 'if pg_trigger_depth() > 1 then',
                   'if pg_trigger_depth() > 1 or current_setting(''app.team_change'', true) = ''on'' then');
    if src not like '%app.team_change%' then
      raise exception '% changed shape; update this migration', f;
    end if;
    execute src;
  end loop;
end $$;

-- Undo: a co-host of one event goes back on that event; one taken off one event becomes a co-host of every
-- event again.
do $$
declare
  src text;
begin
  select pg_get_functiondef('public.undo_team_removals(uuid[])'::regprocedure) into src;
  src := replace(src,
    '((r.role = ''co_host'' and i.as_host) or (r.role <> ''co_host'' and i.event_id = r.event_id and i.role::text = r.role))',
    '((r.role = ''co_host'' and (r.event_id is null or r.was_every) and i.as_host) or ((r.role <> ''co_host'' or (r.event_id is not null and not r.was_every)) and i.event_id = r.event_id and i.role::text = r.role))');
  src := replace(src,
    'if r.role = ''co_host'' then
      insert into organization_members (organization_id, user_id, role) values (r.organization_id, r.user_id, ''admin'')
      on conflict do nothing;',
    'if r.role = ''co_host'' and (r.event_id is null or r.was_every) then
      insert into organization_members (organization_id, user_id, role) values (r.organization_id, r.user_id, ''admin'')
      on conflict do nothing;');
  if src not like '%r.was_every) then%' or src not like '%r.was_every) and i.as_host)%' then
    raise exception 'undo_team_removals changed shape; update this migration';
  end if;
  execute src;
end $$;

-- 6. Adding someone already on the team, right away ------------------------------------
-- p_role: 'co_host' (this event), 'co_host_every' (the whole account), 'volunteer_director', 'section_lead'.
create function public.add_team_member(p_event uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  org uuid := public.event_org(p_event);
begin
  if org is null or p_role not in ('co_host', 'co_host_every', 'volunteer_director', 'section_lead') then
    raise exception 'That can''t be added' using errcode = 'P0001';
  end if;
  if not coalesce(case when p_role in ('co_host', 'co_host_every') then public.is_org_owner(org)
                       when p_role = 'volunteer_director' then public.is_event_admin(p_event)
                       else public.can_manage_volunteers(p_event) end, false) then
    raise exception 'You don''t have permission to add them' using errcode = '42501';
  end if;
  -- Already on the team: for people with the account's view, anyone on the account; for others, this event's team.
  if not (exists (select 1 from event_staff s where s.event_id = p_event and s.user_id = p_user)
          or (public.is_org_admin(org)
              and (exists (select 1 from organization_members m where m.organization_id = org and m.user_id = p_user)
                   or exists (select 1 from event_staff s join events e on e.id = s.event_id
                               where e.organization_id = org and s.user_id = p_user)))) then
    raise exception 'They aren''t on your team yet. Invite them by email instead.' using errcode = 'P0001';
  end if;
  if exists (select 1 from organization_members m where m.organization_id = org and m.user_id = p_user and m.role = 'owner') then
    raise exception 'That''s the Account Host' using errcode = 'P0001';
  end if;
  if p_role = 'co_host_every' then
    if exists (select 1 from organization_members m where m.organization_id = org and m.user_id = p_user) then
      raise exception 'They''re already a co-host of every event' using errcode = 'P0001';
    end if;
    insert into organization_members (organization_id, user_id, role) values (org, p_user, 'admin');
  else
    if exists (select 1 from event_staff s where s.event_id = p_event and s.user_id = p_user and s.role::text = p_role) then
      raise exception 'They already have that role on this event' using errcode = 'P0001';
    end if;
    insert into event_staff (event_id, user_id, role) values (p_event, p_user, p_role::public.event_staff_role);
  end if;
end;
$$;
revoke execute on function public.add_team_member(uuid, uuid, text) from public, anon;
grant execute on function public.add_team_member(uuid, uuid, text) to authenticated;

-- The people "From your team" offers on an event, with what they do now. People with the account's view see the
-- account's team (each person's roles, including past events); others see only this event's team.
create function public.team_options(p_event uuid)
returns table (user_id uuid, full_name text, email text, kind text, event_id uuid, event_name text, event_over boolean, holds_spot boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  org uuid := public.event_org(p_event);
  wide boolean := public.is_org_admin(org);
begin
  if org is null or not (public.can_manage_volunteers(p_event)) then
    raise exception 'Only the event''s hosts and Volunteer Leads can see that' using errcode = '42501';
  end if;
  return query
    with people as (
      select m.user_id, m.role::text as kind, null::uuid as event_id
        from organization_members m where wide and m.organization_id = org
      union all
      select s.user_id, s.role::text, s.event_id
        from event_staff s join events e on e.id = s.event_id
       where e.organization_id = org and (wide or s.event_id = p_event)
    )
    select p.user_id, coalesce(pr.full_name, ''), pr.email::text, p.kind, p.event_id, e.name,
           e.id is not null and e.ends_on < (now() at time zone e.timezone)::date,
           lower(pr.email::text) in (select public.org_team(org))
      from people p join profiles pr on pr.id = p.user_id
      left join events e on e.id = p.event_id
     where pr.email::text not like '%@demo.fieldcommandevents.com'
     order by lower(coalesce(nullif(pr.full_name, ''), pr.email::text)), e.starts_on nulls first;
end;
$$;
revoke execute on function public.team_options(uuid) from public, anon;
grant execute on function public.team_options(uuid) to authenticated;

-- The event's hosts, for the Co-hosts tab: the Account Host, co-hosts of every event, and this event's co-hosts.
-- Phone numbers only for people with the account's view; a co-host of one event sees names and emails.
create function public.event_hosts(p_event uuid)
returns table (user_id uuid, full_name text, email text, phone text, kind text)
language plpgsql stable security definer set search_path = public
as $$
declare
  org uuid := public.event_org(p_event);
  wide boolean := public.is_org_admin(org);
begin
  if org is null or not public.is_event_admin(p_event) then
    raise exception 'Only the event''s hosts can see that' using errcode = '42501';
  end if;
  return query
    select p.id, coalesce(p.full_name, ''), p.email::text, case when wide or p.id = auth.uid() then p.phone end,
           case when m.role = 'owner' then 'owner' else 'every' end
      from organization_members m join profiles p on p.id = m.user_id
     where m.organization_id = org
    union all
    select p.id, coalesce(p.full_name, ''), p.email::text, case when wide or p.id = auth.uid() then p.phone end, 'event'
      from event_staff s join profiles p on p.id = s.user_id
     where s.event_id = p_event and s.role = 'co_host';
end;
$$;
revoke execute on function public.event_hosts(uuid) from public, anon;
grant execute on function public.event_hosts(uuid) to authenticated;

-- 7. Taking a co-host of every event off one event, and changing a co-host's reach --------------------------
-- Off one event: they stay a co-host of each of the account's other events that are open (not more than 10 days
-- over), one by one, and aren't added to new events. Recorded so Undo (10 minutes) puts them back on every event.
create function public.remove_cohost_from_event(p_event uuid, p_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  org uuid := public.event_org(p_event);
  person profiles;
  rid uuid;
begin
  if org is null or not public.is_org_owner(org) then
    raise exception 'Only the Account Host can remove co-hosts' using errcode = '42501';
  end if;
  select * into person from profiles where id = p_user;
  if not exists (select 1 from organization_members m where m.organization_id = org and m.user_id = p_user and m.role = 'admin') then
    raise exception 'They aren''t a co-host of every event' using errcode = 'P0001';
  end if;
  perform set_config('app.team_change', 'on', true);
  insert into event_staff (event_id, user_id, role)
  select e.id, p_user, 'co_host' from events e
   where e.organization_id = org and e.id <> p_event
     and (now() at time zone e.timezone)::date <= e.ends_on + 10
  on conflict do nothing;
  -- After the rows above (the trigger checks they aren't a co-host of every event).
  update account_host_handoffs set cancelled_at = now(), closed_reason = 'changed'
   where organization_id = org and to_user = p_user and accepted_at is null and cancelled_at is null;
  delete from team_removals where organization_id = org and user_id = p_user and role = 'co_host';
  insert into team_removals (organization_id, event_id, role, user_id, email, full_name, removed_by, was_every)
  values (org, p_event, 'co_host', p_user, person.email, person.full_name, auth.uid(), true)
  returning id into rid;
  insert into team_removal_jobs (removal_id, station_id)
  select rid, sl.station_id from station_leads sl
   where sl.event_id = p_event and sl.user_id = p_user
     and not exists (select 1 from event_staff s where s.event_id = p_event and s.user_id = p_user)
  on conflict do nothing;
  insert into team_removal_senders (removal_id, event_id)
  select rid, s.event_id from event_email_settings s where s.event_id = p_event and s.sender_id = p_user
  on conflict do nothing;
  delete from organization_members where organization_id = org and user_id = p_user;
  perform set_config('app.team_change', 'off', true);
  return rid;
end;
$$;
revoke execute on function public.remove_cohost_from_event(uuid, uuid) from public, anon;
grant execute on function public.remove_cohost_from_event(uuid, uuid) to authenticated;

-- Change… : 'every' makes them a co-host of every event; 'only' makes a co-host of every event a co-host of just
-- p_event (they lose the account's other events).
create function public.change_cohost(p_org uuid, p_user uuid, p_to text, p_event uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_owner(p_org) then
    raise exception 'Only the Account Host can change co-hosts' using errcode = '42501';
  end if;
  if p_to = 'every' then
    if not exists (select 1 from event_staff s join events e on e.id = s.event_id
                    where e.organization_id = p_org and s.user_id = p_user and s.role = 'co_host') then
      raise exception 'They aren''t a co-host of any of your events' using errcode = 'P0001';
    end if;
    perform set_config('app.team_change', 'on', true);
    insert into organization_members (organization_id, user_id, role) values (p_org, p_user, 'admin')
    on conflict do nothing;
    perform set_config('app.team_change', 'off', true);
  elsif p_to = 'only' then
    if p_event is null or public.event_org(p_event) is distinct from p_org then
      raise exception 'Pick one of your events' using errcode = 'P0001';
    end if;
    if not exists (select 1 from organization_members m where m.organization_id = p_org and m.user_id = p_user and m.role = 'admin') then
      raise exception 'They aren''t a co-host of every event' using errcode = 'P0001';
    end if;
    perform set_config('app.team_change', 'on', true);
    -- The event's row first, so jobs they lead on it stay theirs when they leave the account.
    insert into event_staff (event_id, user_id, role) values (p_event, p_user, 'co_host') on conflict do nothing;
    update account_host_handoffs set cancelled_at = now(), closed_reason = 'changed'
     where organization_id = p_org and to_user = p_user and accepted_at is null and cancelled_at is null;
    delete from organization_members where organization_id = p_org and user_id = p_user;
    perform set_config('app.team_change', 'off', true);
  else
    raise exception 'Choose every event or one event' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.change_cohost(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.change_cohost(uuid, uuid, text, uuid) to authenticated;

-- 8. Accepting an invitation to co-host one event: a co-host of every event already is one. ----------------
do $$
declare
  src text;
begin
  select pg_get_functiondef('public.accept_invitation(uuid)'::regprocedure) into src;
  src := replace(src,
    '  else
    insert into event_staff (event_id, user_id, role)
    values (inv.event_id, auth.uid(), inv.role)
    on conflict do nothing;',
    '  elsif inv.role = ''co_host''
        and exists (select 1 from organization_members m where m.organization_id = inv.organization_id and m.user_id = auth.uid()) then
    null;
  else
    insert into event_staff (event_id, user_id, role)
    values (inv.event_id, auth.uid(), inv.role)
    on conflict do nothing;');
  if src not like '%elsif inv.role = ''co_host''%' then
    raise exception 'accept_invitation changed shape; update this migration';
  end if;
  execute src;
end $$;
