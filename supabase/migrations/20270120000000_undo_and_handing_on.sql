-- =============================================================================
-- My team, part 3 (design review 2026-11-07; decisions in
-- docs/design-decisions/2026-11-07-my-team-part-3.md).
--
--   * Undo after removing someone: a removal records the jobs the person led
--     and (for a co-host) the events they sent emails as, and the server notes
--     who was emailed. undo_team_removals() puts them back: only whoever
--     removed them, within 10 minutes, all or nothing, and only while the
--     remover still has the right, they haven't been invited again, and the
--     team has room.
--   * Handing on the Account Host role: an offer ends when its co-host leaves
--     or is removed; offers are answered one specific offer at a time, with
--     the Account Host's row locked; the 14 days end at midnight in the
--     account's time zone; each closed offer says why; the offer's token stays
--     on the server.
-- =============================================================================

-- 1. What a removal needs to be undone ----------------------------------------
create table public.team_removal_jobs (
  removal_id  uuid not null references public.team_removals (id) on delete cascade,
  station_id  uuid not null references public.stations (id) on delete cascade,
  primary key (removal_id, station_id)
);
create table public.team_removal_senders (
  removal_id  uuid not null references public.team_removals (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  primary key (removal_id, event_id)
);
-- Who was emailed about a removal (written by the server), so Undo can tell them.
create table public.team_removal_notices (
  removal_id  uuid not null references public.team_removals (id) on delete cascade,
  email       text not null,
  to_person   boolean not null default false,
  primary key (removal_id, email)
);
alter table public.team_removal_jobs enable row level security;
alter table public.team_removal_senders enable row level security;
alter table public.team_removal_notices enable row level security;
revoke all on public.team_removal_jobs, public.team_removal_senders, public.team_removal_notices from anon, authenticated;
grant all on public.team_removal_jobs, public.team_removal_senders, public.team_removal_notices to service_role;

-- 2. Record a removal before anything is cleaned up ---------------------------
-- These run BEFORE the delete, so the jobs (and the email sender) are still there
-- to note. Not when a whole event, account, or person is being deleted (the
-- delete then comes from a cascade, one trigger deeper).
drop trigger event_staff_record_removal on public.event_staff;
create or replace function public.event_staff_record_removal()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  org uuid;
  person profiles;
  rid uuid;
begin
  if pg_trigger_depth() > 1 then
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
$$;
create trigger event_staff_0_record_removal
  before delete on public.event_staff
  for each row execute function public.event_staff_record_removal();

drop trigger org_members_record_removal on public.organization_members;
create or replace function public.org_members_record_removal()
returns trigger
language plpgsql security definer set search_path = public
as $$
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
  if pg_trigger_depth() > 1 then
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
$$;
create trigger org_members_0_record_removal
  before delete on public.organization_members
  for each row execute function public.org_members_record_removal();

-- 3. Undo ------------------------------------------------------------------------
create function public.undo_team_removals(p_ids uuid[])
returns table (removal_id uuid, user_id uuid, full_name text, role text, event_id uuid, event_name text)
language plpgsql security definer set search_path = public
as $$
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
                  and ((r.role = 'co_host' and i.as_host) or (r.role <> 'co_host' and i.event_id = r.event_id and i.role::text = r.role))) then
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
    if r.role = 'co_host' then
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
$$;
revoke execute on function public.undo_team_removals(uuid[]) from public, anon;
grant execute on function public.undo_team_removals(uuid[]) to authenticated;

-- 4. Handing on the Account Host role ---------------------------------------------
alter table public.account_host_handoffs
  add column closed_reason text check (closed_reason in ('withdrawn', 'declined', 'replaced', 'left'));

-- The token stays on the server: the person it's for gets it from my_account_host_offer().
revoke select on public.account_host_handoffs from authenticated;
grant select (id, organization_id, to_user, offered_by, created_at, expires_at, accepted_at, cancelled_at, closed_reason)
  on public.account_host_handoffs to authenticated;

create or replace function public.offer_account_host(p_org uuid, p_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  t uuid;
  tz text;
begin
  -- Locked, so a hand-on that's being accepted right now can't race a new offer.
  perform 1 from organization_members where organization_id = p_org and role = 'owner' for update;
  if not public.is_org_owner(p_org) then
    raise exception 'Only the Account Host can offer this role. If you already passed it on, refresh My team.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from organization_members where organization_id = p_org and user_id = p_user and role = 'admin') then
    raise exception 'You can offer the Account Host role only to a co-host. Invite them as a co-host first.' using errcode = 'P0001';
  end if;
  update account_host_handoffs set cancelled_at = now(), closed_reason = 'replaced'
   where organization_id = p_org and accepted_at is null and cancelled_at is null;
  -- Open through the end of the 14th day, in the account's time zone.
  select coalesce(nullif(default_timezone, ''), 'America/Chicago') into tz from organizations where id = p_org;
  insert into account_host_handoffs (organization_id, to_user, offered_by, expires_at)
  values (p_org, p_user, auth.uid(), (((now() at time zone tz)::date + 15)::timestamp at time zone tz))
  -- The offer's id, not its token: the token goes only into the email, from the server.
  returning id into t;
  return t;
exception when unique_violation then
  raise exception 'Another offer was just sent. Refresh My team to see it.' using errcode = 'P0001';
end;
$$;

-- Withdraw (the Account Host) or decline (the co-host) one offer. Returns which it was;
-- p_as ('withdrawn' or 'declined') refuses it if the caller isn't the one who can do that.
create function public.close_account_host_offer(p_token uuid, p_as text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  h account_host_handoffs;
  why text;
begin
  select * into h from account_host_handoffs where token = p_token for update;
  if h.id is null or h.accepted_at is not null or h.cancelled_at is not null or h.expires_at < now() then
    raise exception 'That offer isn''t open anymore. Refresh My team to see the latest.' using errcode = 'P0001';
  end if;
  if h.to_user = auth.uid() then
    why := 'declined';
  elsif public.is_org_owner(h.organization_id) then
    why := 'withdrawn';
  else
    raise exception 'Only the Account Host or the person it''s for can close this offer.' using errcode = '42501';
  end if;
  if p_as is not null and p_as <> why then
    raise exception 'That offer has changed. Refresh My team to see the latest.' using errcode = 'P0001';
  end if;
  update account_host_handoffs set cancelled_at = now(), closed_reason = why where id = h.id;
  return why;
end;
$$;
revoke execute on function public.close_account_host_offer(uuid, text) from public, anon;
grant execute on function public.close_account_host_offer(uuid, text) to authenticated;

-- The old one, by account, closed whatever was open: offers are closed by token now.
drop function public.cancel_account_host_offer(uuid);

create or replace function public.accept_account_host(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  h account_host_handoffs;
  owner_id uuid;
begin
  select * into h from account_host_handoffs where token = p_token for update;
  if h.id is null or h.to_user <> auth.uid() then
    raise exception 'This link isn''t for your account. Sign in as the person it was sent to.' using errcode = 'P0001';
  end if;
  -- Already accepted (a second tap, another tab): nothing to do, and null says so.
  if h.accepted_at is not null then
    return null;
  end if;
  if h.cancelled_at is not null or h.expires_at < now() then
    raise exception 'This offer is no longer open. Ask the Account Host to offer it again.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from organization_members where organization_id = h.organization_id and user_id = auth.uid() and role = 'admin') then
    raise exception 'You''re no longer a co-host on this account, so you can''t become its Account Host.' using errcode = 'P0001';
  end if;
  -- Still made by the current Account Host (the role may have changed hands since).
  select m.user_id into owner_id from organization_members m where m.organization_id = h.organization_id and m.role = 'owner' for update;
  if owner_id is distinct from h.offered_by then
    update account_host_handoffs set cancelled_at = now(), closed_reason = 'replaced' where id = h.id;
    raise exception 'This offer is no longer open: the Account Host has changed. Ask them to offer it again.' using errcode = 'P0001';
  end if;
  update organization_members set role = 'admin' where organization_id = h.organization_id and role = 'owner';
  update organization_members set role = 'owner' where organization_id = h.organization_id and user_id = auth.uid();
  update account_host_handoffs set accepted_at = now() where id = h.id;
  return h.organization_id;
end;
$$;

-- What an offer link shows. For the person it's for: everything, including why it closed
-- and who is the Account Host now. For anyone else signed in: only that it isn't theirs.
drop function public.get_account_host_offer(uuid);
create function public.get_account_host_offer(p_token uuid)
returns table (
  organization_id  uuid,
  organization     text,
  offered_by       text,
  open             boolean,
  accepted         boolean,
  for_you          boolean,
  expires_at       timestamptz,
  closed_reason    text,
  current_host     text,
  host_now         boolean,
  timezone         text
)
language sql stable security definer set search_path = public
as $$
  select case when h.to_user = auth.uid() then o.id end,
         case when h.to_user = auth.uid() then o.name end,
         case when h.to_user = auth.uid() then coalesce(nullif(p.full_name, ''), p.email::text) end,
         h.accepted_at is null and h.cancelled_at is null and h.expires_at > now(),
         h.accepted_at is not null,
         h.to_user = auth.uid(),
         case when h.to_user = auth.uid() then h.expires_at end,
         case when h.to_user <> auth.uid() then null
              when h.closed_reason is not null then h.closed_reason
              when h.accepted_at is null and h.cancelled_at is null and h.expires_at <= now() then 'expired' end,
         case when h.to_user = auth.uid() then
           (select coalesce(nullif(cp.full_name, ''), cp.email::text)
              from organization_members m join profiles cp on cp.id = m.user_id
             where m.organization_id = o.id and m.role = 'owner') end,
         case when h.to_user = auth.uid() then
           exists (select 1 from organization_members m where m.organization_id = o.id and m.user_id = auth.uid() and m.role = 'owner') end,
         case when h.to_user = auth.uid() then o.default_timezone end
    from account_host_handoffs h
    join organizations o on o.id = h.organization_id
    left join profiles p on p.id = h.offered_by
   where h.token = p_token;
$$;
revoke execute on function public.get_account_host_offer(uuid) from public, anon;
grant execute on function public.get_account_host_offer(uuid) to authenticated;

-- The open offer to you, with its token (for Accept and Decline on My team).
create function public.my_account_host_offer(p_org uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select token from account_host_handoffs
   where organization_id = p_org and to_user = auth.uid()
     and accepted_at is null and cancelled_at is null and expires_at > now();
$$;
revoke execute on function public.my_account_host_offer(uuid) from public, anon;
grant execute on function public.my_account_host_offer(uuid) to authenticated;
