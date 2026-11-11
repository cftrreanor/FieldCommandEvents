-- =============================================================================
-- Changed functions are written out in full (not patched by find-and-replace), and every step is safe to run again:
-- the first version stopped on databases that store an earlier function's text a little differently.
--
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
create or replace function public.event_org(ev uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select organization_id from events where id = ev $$;
revoke execute on function public.event_org(uuid) from public, anon;
grant execute on function public.event_org(uuid) to authenticated;

drop policy if exists "events: hosts update" on public.events;
drop policy if exists "events: hosts update" on public.events;
create policy "events: hosts update" on public.events
  for update to authenticated
  using (public.is_event_admin(id))
  with check (public.is_org_admin(organization_id)
              or (public.is_event_admin(id) and organization_id = public.event_org(id)));

drop policy if exists "events: hosts delete" on public.events;
drop policy if exists "events: account host deletes" on public.events;
create policy "events: account host deletes" on public.events
  for delete to authenticated using (public.is_org_owner(organization_id));

-- The plan (what the event can use) for anyone who runs one of the account's events.
CREATE OR REPLACE FUNCTION public.account_plan(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o organizations;
  tier plan_tiers := public.org_tier(p_org);
  own plan_tiers := public.package_tier(p_org);
begin
  select * into o from organizations where id = p_org;
  if o.id is null or not (public.is_org_admin(p_org) or public.is_platform_admin() or exists (select 1 from events ev where ev.organization_id = p_org and public.is_event_admin(ev.id)) or public.can_see_volunteer_history(p_org)
                          or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Only the account''s hosts can see its plan.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'package', o.package,
    'package_name', (select name from plan_tiers where code = o.package),
    -- What it publishes under now: Free while a paid package's plan isn't active.
    'active', tier.code,
    'active_name', tier.name,
    'rate', o.rate,
    'event_types', to_jsonb(tier.event_types),
    -- What it can make drafts of: its own package's types (plus any with a pass).
    'own_event_types', to_jsonb(own.event_types),
    'one_at_a_time', to_jsonb(tier.one_at_a_time),
    'weekly_hours', tier.weekly_hours,
    -- The team and volunteer history follow the package itself.
    'max_team', own.max_team,
    'event_staff', own.event_staff,
    'volunteer_history', own.volunteer_history,
    -- Whether the Volunteer tracking page shows (also after a downgrade, with history).
    'volunteer_tracking', public.volunteer_tracking_open(p_org),
    'team', (select count(*) from public.org_team(p_org)),
    'published', coalesce((select jsonb_object_agg(t, n) from (
                   select event_type::text t, count(*) n from events
                    where organization_id = p_org and status = 'published' and ends_on >= (now() at time zone timezone)::date group by event_type) x), '{}'::jsonb),
    'passes_unused', coalesce((select jsonb_object_agg(t, n) from (
                   select event_type::text t, count(*) n from event_passes
                    where organization_id = p_org and event_id is null and expires_at > now() group by event_type) x), '{}'::jsonb),
    'pass_total_cents', o.pass_total_cents
  );
end;
$function$;

-- 2. Who can add and remove co-hosts ----------------------------------------------------
drop policy if exists "staff: hosts remove" on public.event_staff;
drop policy if exists "staff: hosts remove" on public.event_staff;
create policy "staff: hosts remove" on public.event_staff
  for delete to authenticated
  using ((role <> 'co_host' and public.is_event_admin(event_id))
         or (role = 'co_host' and public.is_org_owner(public.event_org(event_id))));

drop policy if exists "invitations: hosts invite" on public.invitations;
drop policy if exists "invitations: hosts invite" on public.invitations;
create policy "invitations: hosts invite" on public.invitations
  for insert to authenticated
  with check (invited_by = auth.uid()
              and ((not as_host and role <> 'co_host' and public.is_event_admin(event_id))
                   or ((as_host or role = 'co_host') and public.is_org_owner(organization_id))));
drop policy if exists "invitations: hosts cancel" on public.invitations;
drop policy if exists "invitations: hosts cancel" on public.invitations;
create policy "invitations: hosts cancel" on public.invitations
  for delete to authenticated
  using (accepted_at is null
         and ((not as_host and role <> 'co_host' and public.is_event_admin(event_id))
              or ((as_host or role = 'co_host') and public.is_org_owner(organization_id))));

CREATE OR REPLACE FUNCTION public.prepare_invitation_email(p_id uuid)
 RETURNS TABLE(email text, role event_staff_role, as_host boolean, token uuid, expires_at timestamp with time zone, event_name text, starts_on date, ends_on date, venue_name text, organization text, station_name text, inviter_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv invitations;
  reason text;
begin
  select * into inv from invitations i where i.id = p_id for update;
  if inv.id is null
     or not coalesce(case when inv.as_host or inv.role = 'co_host' then public.is_org_owner(inv.organization_id)
                          else public.is_event_admin(inv.event_id)
                               or (inv.role = 'section_lead' and public.can_manage_volunteers(inv.event_id)) end, false) then
    raise exception 'You don''t have permission to send that invitation' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then
    raise exception 'That invitation has already been accepted' using errcode = 'P0001';
  end if;
  -- An expired invitation stopped holding a team spot. Sending it again takes one back, so it
  -- needs a free spot (and a plan that includes the role), just like a new invitation.
  if inv.expires_at < now() then
    reason := public.team_add_reason(inv.organization_id, null, inv.email::text, not inv.as_host and inv.role <> 'co_host');
    if reason is not null then
      raise exception '%', reason using errcode = '42501';
    end if;
  end if;
  if inv.sent_at > now() - interval '5 minutes' then
    raise exception 'That invitation was just sent. Please wait a few minutes before sending it again.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('invitation_sends:' || inv.organization_id::text));
  if (select count(*) from invitation_sends s
       where s.organization_id = inv.organization_id and s.sent_at > now() - interval '1 hour') >= 40 then
    raise exception 'That''s a lot of invitations in a short time. Please try again in an hour, or email us for help.'
      using errcode = 'P0001';
  end if;
  insert into invitation_sends (organization_id) values (inv.organization_id);

  update invitations i
     set email_token = gen_random_uuid(),
         sent_at = now(),
         expires_at = greatest(i.expires_at, now() + interval '30 days')
   where i.id = inv.id;

  return query
    select i.email::text, i.role, i.as_host, i.token, i.expires_at, e.name, e.starts_on, e.ends_on, e.venue_name,
           o.name, s.name, nullif(p.full_name, '')
      from invitations i
      join organizations o on o.id = i.organization_id
      left join events e on e.id = i.event_id
      left join stations s on s.id = i.station_id
      left join profiles p on p.id = auth.uid()
     where i.id = inv.id;
end;
$function$;

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
create or replace function public.event_staff_one_host_role()
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
drop trigger if exists event_staff_1_one_host_role on public.event_staff;
create trigger event_staff_1_one_host_role
  before insert on public.event_staff
  for each row execute function public.event_staff_one_host_role();

create or replace function public.event_staff_cohost_replaces_lead()
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
drop trigger if exists event_staff_cohost_replaces_lead on public.event_staff;
create trigger event_staff_cohost_replaces_lead
  after insert on public.event_staff
  for each row when (new.role = 'co_host')
  execute function public.event_staff_cohost_replaces_lead();

-- A co-host of one event who becomes a co-host of every event: the event rows go.
create or replace function public.org_members_absorb_event_cohosts()
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
drop trigger if exists org_members_absorb_event_cohosts on public.organization_members;
create trigger org_members_absorb_event_cohosts
  after insert on public.organization_members
  for each row execute function public.org_members_absorb_event_cohosts();

-- 5. Removal records: a co-host of one event is removed from that event. --------------------------
alter table public.team_removals drop constraint if exists team_removals_check;
alter table public.team_removals drop constraint if exists team_removals_event_unless_cohost;
alter table public.team_removals add constraint team_removals_event_unless_cohost check (role = 'co_host' or event_id is not null);
-- A co-host of every event taken off one event: Undo makes them a co-host of every event again.
alter table public.team_removals add column if not exists was_every boolean not null default false;

drop policy if exists "team removals: hosts see removed co-hosts" on public.team_removals;
drop policy if exists "team removals: hosts see removed co-hosts" on public.team_removals;
create policy "team removals: hosts see removed co-hosts" on public.team_removals
  for select to authenticated
  using (role = 'co_host' and (public.is_org_admin(organization_id) or (event_id is not null and public.is_event_admin(event_id))));

alter table public.account_host_handoffs drop constraint if exists account_host_handoffs_closed_reason_check;
alter table public.account_host_handoffs add constraint account_host_handoffs_closed_reason_check
  check (closed_reason in ('withdrawn', 'declined', 'replaced', 'left', 'changed'));

-- Changes made by the functions below aren't removals (they record their own).
CREATE OR REPLACE FUNCTION public.event_staff_record_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org uuid;
  person profiles;
  rid uuid;
begin
  if pg_trigger_depth() > 1 or current_setting('app.team_change', true) = 'on' then
    return old;
  end if;
  select organization_id into org from events where id = old.event_id;
  select * into person from profiles where id = old.user_id;
  if org is null or person.id is null then
    return old;
  end if;
  delete from team_removals where event_id = old.event_id and user_id = old.user_id and role = old.role::text;
  insert into team_removals (organization_id, event_id, role, user_id, email, full_name, removed_by)
  values (org, old.event_id, old.role::text, old.user_id, person.email, person.full_name, auth.uid())
  returning id into rid;
  -- Their jobs go with their last role on the event (event_staff_cleanup removes them).
  if not exists (select 1 from event_staff where event_id = old.event_id and user_id = old.user_id and role <> old.role) then
    insert into team_removal_jobs (removal_id, station_id)
    select rid, station_id from station_leads where event_id = old.event_id and user_id = old.user_id
    on conflict do nothing;
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.org_members_record_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  person profiles;
  rid uuid;
begin
  if old.role <> 'admin' then
    return old;
  end if;
  -- An open offer of the Account Host role ends with their place on the team.
  update account_host_handoffs set cancelled_at = now(), closed_reason = 'left'
   where organization_id = old.organization_id and to_user = old.user_id and accepted_at is null and cancelled_at is null;
  if pg_trigger_depth() > 1 or current_setting('app.team_change', true) = 'on' then
    return old;
  end if;
  select * into person from profiles where id = old.user_id;
  if person.id is null then
    return old;
  end if;
  delete from team_removals where organization_id = old.organization_id and user_id = old.user_id and role = 'co_host';
  insert into team_removals (organization_id, role, user_id, email, full_name, removed_by)
  values (old.organization_id, 'co_host', old.user_id, person.email, person.full_name, auth.uid())
  returning id into rid;
  -- The jobs org_members_clear_leads takes away, and the events forget_email_sender stops them sending as.
  insert into team_removal_jobs (removal_id, station_id)
  select rid, sl.station_id
    from station_leads sl join events e on e.id = sl.event_id
   where e.organization_id = old.organization_id and sl.user_id = old.user_id
     and not exists (select 1 from event_staff s where s.event_id = sl.event_id and s.user_id = old.user_id)
  on conflict do nothing;
  insert into team_removal_senders (removal_id, event_id)
  select rid, s.event_id
    from event_email_settings s join events e on e.id = s.event_id
   where e.organization_id = old.organization_id and s.sender_id = old.user_id
  on conflict do nothing;
  return old;
end;
$function$;

-- Undo: a co-host of one event goes back on that event; one taken off one event becomes a co-host of every
-- event again.
CREATE OR REPLACE FUNCTION public.undo_team_removals(p_ids uuid[])
 RETURNS TABLE(removal_id uuid, user_id uuid, full_name text, role text, event_id uuid, event_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  r team_removals;
  n int;
  who uuid;
  reason text;
  jobs uuid[];
  senders uuid[];
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  -- Locked, so a second Undo (another tab, a double tap) finds nothing.
  perform 1 from team_removals t where t.id = any (p_ids) for update;
  select count(*) into n from team_removals t where t.id = any (p_ids);
  if n = 0 or n <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'That can''t be undone anymore. They may be back already: refresh My team to see.' using errcode = 'P0001';
  end if;

  -- One Undo puts back one person (its emails name them).
  if (select count(distinct t.user_id) from team_removals t where t.id = any (p_ids)) > 1 then
    raise exception 'Undo one person at a time.' using errcode = 'P0001';
  end if;

  -- Every rule, for every removal, before anything changes (all or nothing).
  for r in select * from team_removals t where t.id = any (p_ids) loop
    if r.removed_by is distinct from auth.uid() or r.removed_by = r.user_id then
      raise exception 'Only the person who removed them can undo it.' using errcode = '42501';
    end if;
    if r.removed_at < now() - interval '10 minutes' then
      raise exception 'The 10 minutes to undo are up. To bring % back, use Invite again under Removed or left recently.', r.full_name
        using errcode = 'P0001';
    end if;
    if not coalesce(case r.role when 'co_host' then public.is_org_owner(r.organization_id)
                                when 'section_lead' then public.can_manage_volunteers(r.event_id)
                                else public.is_event_admin(r.event_id) end, false) then
      raise exception 'You can''t undo that anymore: your own role has changed.' using errcode = '42501';
    end if;
    if not exists (select 1 from profiles p where p.id = r.user_id) then
      raise exception '% can''t be put back: their account was deleted.', r.full_name using errcode = 'P0001';
    end if;
    if exists (select 1 from invitations i
                where i.organization_id = r.organization_id and lower(i.email::text) = lower(r.email)
                  and i.accepted_at is null and i.expires_at > now()
                  and ((r.role = 'co_host' and (r.event_id is null or r.was_every) and i.as_host) or ((r.role <> 'co_host' or (r.event_id is not null and not r.was_every)) and i.event_id = r.event_id and i.role::text = r.role))) then
      raise exception '% has been invited again. Cancel that invitation to undo, or let them accept it.', r.full_name using errcode = 'P0001';
    end if;
  end loop;

  -- The team-spot limit, once per person (holding another role means no new spot).
  for who in select distinct t.user_id from team_removals t where t.id = any (p_ids) loop
    select public.team_add_reason(t.organization_id, who, null, bool_or(t.role <> 'co_host')) into reason
      from team_removals t where t.id = any (p_ids) and t.user_id = who group by t.organization_id;
    if reason is not null then
      raise exception '%', case when reason like 'Your team is full%'
        then 'Your team filled up after you removed them, so Undo can''t put them back. Cancel an invitation to free a spot first.'
        else reason end using errcode = 'P0001';
    end if;
  end loop;

  -- Put them back. Adding them clears the removal (and what it noted), so the jobs and
  -- senders are read first.
  for r in select * from team_removals t where t.id = any (p_ids) order by (t.role = 'co_host') desc loop
    select coalesce(array_agg(j.station_id), '{}') into jobs from team_removal_jobs j where j.removal_id = r.id;
    select coalesce(array_agg(s.event_id), '{}') into senders from team_removal_senders s where s.removal_id = r.id;
    if r.role = 'co_host' and (r.event_id is null or r.was_every) then
      insert into organization_members (organization_id, user_id, role) values (r.organization_id, r.user_id, 'admin')
      on conflict do nothing;
      update event_email_settings s set sender_id = r.user_id where s.event_id = any (senders) and s.sender_id is null;
    else
      insert into event_staff (event_id, user_id, role) values (r.event_id, r.user_id, r.role::public.event_staff_role)
      on conflict do nothing;
    end if;
    insert into station_leads (station_id, user_id, event_id)
    select st.id, r.user_id, st.event_id from stations st where st.id = any (jobs)
    on conflict do nothing;
    removal_id := r.id;
    user_id := r.user_id;
    full_name := coalesce(nullif(r.full_name, ''), r.email);
    role := r.role;
    event_id := r.event_id;
    event_name := (select e.name from events e where e.id = r.event_id);
    return next;
  end loop;
end;
$function$;

-- 6. Adding someone already on the team, right away ------------------------------------
-- p_role: 'co_host' (this event), 'co_host_every' (the whole account), 'volunteer_director', 'section_lead'.
create or replace function public.add_team_member(p_event uuid, p_user uuid, p_role text)
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
create or replace function public.team_options(p_event uuid)
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
create or replace function public.event_hosts(p_event uuid)
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
create or replace function public.remove_cohost_from_event(p_event uuid, p_user uuid)
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
create or replace function public.change_cohost(p_org uuid, p_user uuid, p_to text, p_event uuid default null)
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
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv invitations;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select * into inv from invitations where token = p_token for update;
  if inv.id is null then
    raise exception 'This invitation link isn''t valid' using errcode = 'P0001';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then
      return inv.event_id;
    end if;
    raise exception 'This invitation has already been used' using errcode = 'P0001';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = 'P0001';
  end if;
  if inv.email <> public.current_email() then
    raise exception 'This invitation was sent to %. Sign in with that email to accept it.', inv.email
      using errcode = 'P0001';
  end if;

  -- Still open while they join, so the spot it holds is theirs (the team-limit check sees them on the team).
  if inv.as_host then
    insert into organization_members (organization_id, user_id, role)
    values (inv.organization_id, auth.uid(), 'admin')
    on conflict do nothing;
  elsif inv.role = 'co_host'
        and exists (select 1 from organization_members m where m.organization_id = inv.organization_id and m.user_id = auth.uid()) then
    null;
  else
    insert into event_staff (event_id, user_id, role)
    values (inv.event_id, auth.uid(), inv.role)
    on conflict do nothing;
    if inv.station_id is not null then
      insert into station_leads (station_id, user_id, event_id)
      values (inv.station_id, auth.uid(), inv.event_id)
      on conflict do nothing;
    end if;
  end if;
  update invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.event_id;
end;
$function$;
