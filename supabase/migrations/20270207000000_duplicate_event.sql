-- =============================================================================
-- Duplicate event (owner decisions: docs/design-decisions/2026-11-20-duplicate-event.md).
--
-- duplicate_event(from, new first day, name, request id) makes a new draft from any event with jobs (volunteer
-- events, school fairs, band contests, festivals) in one transaction:
--   * Only the Account Host and Co-hosts of every event (is_org_admin on the source's account). A Co-host of one
--     event, a Volunteer Lead, a Coordinator, a stranger, or anyone signed out is refused.
--   * Always a draft with sign-up and registration closed, on the source's account, with a new slug.
--   * Comes over (named columns only): details (the name as typed, venue, hours, time zone, description,
--     settings), jobs (no lead_user_id), shifts (same spots, nobody signed up), things to bring, maps and
--     documents (rows here; the server copies the stored files), registration setup for contests and festivals
--     (and a festival's rooms, minutes per group, and walking time), a fair's zones, and Coordinators: account
--     members straight onto their jobs, everyone else as a held invitation.
--   * Never: volunteers, sign-ups, assignments, item sign-ups, check-ins, announcements, bands or groups,
--     invitations to bands, families, bookings, sponsors, passes, per-event Co-hosts and Volunteer Leads, where
--     replies go, who gets notified, or invitations nobody accepted.
--   * Dates: the event keeps its length; the hours, every shift, and every dated setting move by the same number
--     of days at the same local clock time (across daylight saving). Registration dates that would land in the
--     past (or on or after the first day) are left blank. The new first day can't be in the past.
--   * Dates typed into copied text (descriptions, instructions, shift notes, things to bring, information for
--     directors) are replaced with "[new date]" (copy_blank_dates); publishing waits until none is left.
--   * A retry with the same request id returns the copy that exists.
--   * Where a copy came from lives in event_copies (admin-only), never on events (anon reads every events column
--     of a published event).
--
-- Held invitations (invitations.held_for_publish): no token (nothing to accept or copy), can't be accepted,
-- don't hold a team spot, start their 30 days when sent (prepare_invitation_email, which then needs a free spot
-- and a plan with Coordinators like any new invitation), and are deleted with their job.
--
-- copy_band_contest_setup and copy_group_event_setup (today's "start from a previous contest" and festival copy)
-- now run the same copy body (copy_event_setup), so the column lists can't drift.
--
-- Safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Held invitations
-- ---------------------------------------------------------------------------
alter table public.invitations add column if not exists held_for_publish boolean not null default false;
-- The source event of a copied Coordinator's invitation. No foreign key on purpose: a second link from invitations to
-- events would make the app's invitations -> events embeds ambiguous. Only "came with a copy" (not null) is used.
alter table public.invitations add column if not exists copied_from_event_id uuid;
alter table public.invitations drop constraint if exists invitations_copied_from_event_id_fkey;
-- A Coordinator of more than one job on the source: one invitation, every job.
alter table public.invitations add column if not exists extra_station_ids uuid[] not null default '{}';
-- A held invitation has no token at all, so nobody (managers included) can see or use one.
alter table public.invitations alter column token drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invitations_held_has_no_token') then
    alter table public.invitations add constraint invitations_held_has_no_token check ((token is null) = held_for_publish);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invitations_held_is_coordinator') then
    alter table public.invitations add constraint invitations_held_is_coordinator
      check (not held_for_publish or (event_id is not null and role = 'section_lead' and accepted_at is null and sent_at is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invitations_extra_jobs_are_coordinator') then
    alter table public.invitations add constraint invitations_extra_jobs_are_coordinator
      check (cardinality(extra_station_ids) = 0 or (station_id is not null and role = 'section_lead'));
  end if;
end $$;
-- Managers read the new columns (only functions write them).
grant select (held_for_publish, copied_from_event_id, extra_station_ids) on public.invitations to authenticated;
grant select, insert, update, delete on public.invitations to service_role;
-- A held invitation is the hosts' to send or remove: a Volunteer Lead can't delete one (they still cancel the
-- Coordinator invitations they can see and send).
drop policy if exists "invitations: directors cancel lead invites" on public.invitations;
create policy "invitations: directors cancel lead invites" on public.invitations
  for delete to authenticated
  using (accepted_at is null and role = 'section_lead' and not held_for_publish and public.can_manage_volunteers(event_id));

-- Held invitations don't take a team spot until they're sent.
create or replace function public.team_limits_on_invitations()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  reason text;
begin
  if new.held_for_publish then
    return new;
  end if;
  reason := public.team_add_reason(new.organization_id, null, new.email::text,
                                   not new.as_host and new.role is distinct from 'co_host');
  if reason is not null then
    raise exception '%', reason using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.team_limits_on_invitations() from public, anon, authenticated;

create or replace function public.org_team(p_org uuid)
returns setof text
language sql stable security definer set search_path = public
as $$
  select distinct lower(t.email) from (
    select p.email::text as email
      from organization_members m join profiles p on p.id = m.user_id
     where m.organization_id = p_org
    union
    select p.email::text
      from event_staff s join events e on e.id = s.event_id join profiles p on p.id = s.user_id
     where e.organization_id = p_org
       and e.ends_on >= (now() at time zone e.timezone)::date
    union
    select i.email::text
      from invitations i left join events e on e.id = i.event_id
     where i.organization_id = p_org and i.accepted_at is null and i.expires_at > now()
       and not i.held_for_publish
       and (e.id is null or e.ends_on >= (now() at time zone e.timezone)::date)
  ) t
  where t.email not like '%@demo.fieldcommandevents.com';
$$;

create or replace function public.team_spots(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  tier plan_tiers := public.package_tier(p_org);
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Only the account''s hosts can see its team' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'used', (select count(*) from public.org_team(p_org)),
    'invited', (select count(distinct lower(i.email::text)) from invitations i left join events e on e.id = i.event_id
                 where i.organization_id = p_org and i.accepted_at is null and i.expires_at > now()
                   and not i.held_for_publish
                   and (e.id is null or e.ends_on >= (now() at time zone e.timezone)::date)
                   and lower(i.email::text) not in (select lower(p.email::text) from profiles p
                                                     where p.id in (select m.user_id from organization_members m where m.organization_id = p_org)
                                                        or p.id in (select s.user_id from event_staff s join events ev on ev.id = s.event_id
                                                                     where ev.organization_id = p_org
                                                                       and ev.ends_on >= (now() at time zone ev.timezone)::date))),
    'max', tier.max_team,
    'plan', tier.name,
    'event_staff', coalesce(tier.event_staff, true)
  );
end;
$$;

-- Accepting: never a held invitation (it has no token, and this says so if one is ever looked up); a Coordinator
-- of several jobs gets all of them.
create or replace function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  inv invitations;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select * into inv from invitations where token = p_token for update;
  if inv.id is null or p_token is null then
    raise exception 'This invitation link isn''t valid' using errcode = 'P0001';
  end if;
  if inv.held_for_publish then
    raise exception 'This invitation hasn''t been sent yet.' using errcode = 'P0001';
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
      select st.id, auth.uid(), inv.event_id
        from stations st
       where st.event_id = inv.event_id and (st.id = inv.station_id or st.id = any (inv.extra_station_ids))
      on conflict do nothing;
    end if;
  end if;
  update invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.event_id;
end;
$$;

-- Sending: a held invitation gets its token and its 30 days now, and needs a free team spot and a plan with
-- Coordinators, like a new invitation. Only the event's hosts send one.
create or replace function public.prepare_invitation_email(p_id uuid)
returns table (email text, role event_staff_role, as_host boolean, token uuid, expires_at timestamptz, event_name text,
               starts_on date, ends_on date, venue_name text, organization text, station_name text, inviter_name text)
language plpgsql security definer set search_path = public
as $$
declare
  inv invitations;
  reason text;
begin
  select * into inv from invitations i where i.id = p_id for update;
  if inv.id is null
     or not coalesce(case when inv.as_host or inv.role = 'co_host' then public.is_org_owner(inv.organization_id)
                          when inv.held_for_publish then public.is_event_admin(inv.event_id)
                          else public.is_event_admin(inv.event_id)
                               or (inv.role = 'section_lead' and public.can_manage_volunteers(inv.event_id)) end, false) then
    raise exception 'You don''t have permission to send that invitation' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then
    raise exception 'That invitation has already been accepted' using errcode = 'P0001';
  end if;
  -- An expired or held invitation holds no team spot. Sending it takes one, so it needs a free spot (and a plan
  -- that includes the role), just like a new invitation.
  if inv.expires_at < now() or inv.held_for_publish then
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

  if inv.held_for_publish then
    update invitations i
       set held_for_publish = false,
           token = gen_random_uuid(),
           email_token = gen_random_uuid(),
           sent_at = now(),
           expires_at = now() + interval '30 days'
     where i.id = inv.id;
  else
    update invitations i
       set email_token = gen_random_uuid(),
           sent_at = now(),
           expires_at = greatest(i.expires_at, now() + interval '30 days')
     where i.id = inv.id;
  end if;

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
$$;

-- A held invitation goes with its job (a Coordinator of several jobs keeps the others).
create or replace function public.stations_drop_held_invitations()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- The whole event is going: its invitations go with it.
  if not exists (select 1 from events where id = old.event_id) then
    return old;
  end if;
  update invitations
     set station_id = extra_station_ids[1], extra_station_ids = extra_station_ids[2:]
   where held_for_publish and station_id = old.id and cardinality(extra_station_ids) > 0;
  delete from invitations where held_for_publish and station_id = old.id;
  update invitations set extra_station_ids = array_remove(extra_station_ids, old.id)
   where event_id = old.event_id and old.id = any (extra_station_ids);
  return old;
end;
$$;
revoke execute on function public.stations_drop_held_invitations() from public, anon, authenticated;
drop trigger if exists stations_drop_held_invitations on public.stations;
create trigger stations_drop_held_invitations before delete on public.stations
  for each row execute function public.stations_drop_held_invitations();

-- ---------------------------------------------------------------------------
-- 2. Where a copy came from (admin-only; never a column on events), each copied step's "opened" state, and
--    removed held invitations waiting for Undo.
-- ---------------------------------------------------------------------------
create table if not exists public.event_copies (
  event_id           uuid primary key references public.events(id) on delete cascade,
  source_event_id    uuid references public.events(id) on delete set null,
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  created_by         uuid references public.profiles(id) on delete set null,
  request_id         uuid not null,
  days_moved         integer not null,
  -- What duplicate_event returned (so a retry returns the same), including the source's name and dates.
  summary            jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  first_published_at timestamptz
);
create unique index if not exists event_copies_request on public.event_copies (created_by, request_id);
create index if not exists event_copies_source on public.event_copies (source_event_id);
alter table public.event_copies enable row level security;
grant select on public.event_copies to authenticated;
grant select, insert, update, delete on public.event_copies to service_role;
drop policy if exists "event copies: event hosts read" on public.event_copies;
create policy "event copies: event hosts read" on public.event_copies
  for select to authenticated using (public.is_event_admin(event_id));

create table if not exists public.event_copy_steps (
  event_id     uuid not null references public.events(id) on delete cascade,
  step         text not null check (step in ('details', 'jobs', 'registration', 'volunteers', 'rooms')),
  opened_at    timestamptz,
  primary key (event_id, step)
);
-- Opening a copied step checks it off (built-pages decision): there's no separate "looks right" any more.
alter table public.event_copy_steps drop column if exists confirmed_at;
alter table public.event_copy_steps enable row level security;
grant select on public.event_copy_steps to authenticated;
grant select, insert, update, delete on public.event_copy_steps to service_role;
drop policy if exists "event copy steps: event hosts read" on public.event_copy_steps;
create policy "event copy steps: event hosts read" on public.event_copy_steps
  for select to authenticated using (public.is_event_admin(event_id));

create table if not exists public.copy_invitation_removals (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  removed_by uuid references public.profiles(id) on delete cascade,
  removed_at timestamptz not null default now(),
  invitation jsonb not null
);
alter table public.copy_invitation_removals enable row level security;
-- Only the functions below use it (no policies: nobody reads it directly).
grant select, insert, update, delete on public.copy_invitation_removals to service_role;

-- The first publish is remembered (Delete and start over is only for a copy that was never published).
create or replace function public.event_copies_note_publish()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    update event_copies set first_published_at = coalesce(first_published_at, now()) where event_id = new.id;
    delete from copy_invitation_removals where removed_at < now() - interval '10 minutes';
  end if;
  return null;
end;
$$;
revoke execute on function public.event_copies_note_publish() from public, anon, authenticated;
drop trigger if exists event_copies_note_publish on public.events;
create trigger event_copies_note_publish after update of status on public.events
  for each row execute function public.event_copies_note_publish();

-- ---------------------------------------------------------------------------
-- 2b. Old dates typed into copied text (owner decision, built-pages light check): everything comes over except
--     volunteers, personal details, and dates. A date written in copied text (a description, job instructions, a
--     shift note, a thing to bring, the information for directors, a room's note, a file's name) that isn't one of
--     the copy's own days is replaced with "[new date]" in the same transaction, so a retry or a dropped
--     connection never leaves last year's date unmarked. Publishing waits until no "[new date]" is left.
--
--     The same detection as src/lib/old-dates.ts (blankOldDates); keep the two in step (both are tested):
--       * "Nov 7", "November 7th", "Nov. 7, 2026", "Nov 7-8", each with an optional weekday before it
--         ("Saturday, Nov 7", "Sat Nov 7"); "11/7", "11/7/26", "11/7/2026" (with an optional weekday too).
--       * A date is kept when it's one of p_keep (the copy's days and registration dates): without a year, when
--         its month and day match one; with a weekday, only when the weekday matches that day too.
--       * Never a time ("7:45"), a year on its own, a number that can't be a date ("13/40"), or a fraction
--         ("1/2", "3/4", "1/8").
-- ---------------------------------------------------------------------------
create or replace function public.copy_blank_dates(p_text text, p_keep date[])
returns text
language plpgsql immutable set search_path = public
as $$
declare
  pat  constant text :=
    '\y(?:(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\.?,?\s+)?'
    || '(?:(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)'
    || '\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+(\d{4}))?'
    || '|(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?)\y';
  rest  text := p_text;
  outp  text := '';
  pos   int;
  whole text;
  m     text[];
  mon   int;
  dy    int;
  yr    int;
  hit   date;
  keep  boolean;
begin
  if p_text is null or p_text = '' then
    return p_text;
  end if;
  loop
    pos := regexp_instr(rest, pat, 1, 1, 0, 'i');
    exit when pos = 0;
    whole := regexp_substr(rest, pat, 1, 1, 'i');
    m := regexp_match(whole, '^' || pat || '$', 'i');
    yr := null;
    if m[2] is not null then
      mon := (strpos('janfebmaraprmayjunjulaugsepoctnovdec', lower(left(m[2], 3))) + 2) / 3;
      dy := m[3]::int;
      yr := m[4]::int;
    else
      mon := m[5]::int;
      dy := m[6]::int;
      if m[7] is not null then
        yr := case when length(m[7]) = 2 then 2000 + m[7]::int else m[7]::int end;
      end if;
    end if;
    if mon < 1 or mon > 12 or dy < 1 or dy > 31 then
      keep := true;                                    -- not a date ("13/40")
    elsif m[2] is null and yr is null and dy in (2, 3, 4, 8, 16) and mon < dy then
      keep := true;                                    -- a fraction ("1/2", "3/4")
    else
      select k into hit from unnest(p_keep) k
       where to_char(k, 'MM-DD') = lpad(mon::text, 2, '0') || '-' || lpad(dy::text, 2, '0')
         and (yr is null or extract(year from k)::int = yr)
       order by k limit 1;
      keep := hit is not null
              and (m[1] is null or lower(left(m[1], 3)) = lower(to_char(hit, 'Dy')));
    end if;
    outp := outp || left(rest, pos - 1) || case when keep then whole else '[new date]' end;
    rest := substr(rest, pos + length(whole));
  end loop;
  return outp || rest;
end;
$$;
revoke execute on function public.copy_blank_dates(text, date[]) from public, anon;
grant execute on function public.copy_blank_dates(text, date[]) to authenticated, service_role;

-- How many "[new date]" markers a text holds.
create or replace function public.copy_marker_count(p_text text)
returns integer
language sql immutable set search_path = public
as $$
  select coalesce((length(p_text) - length(replace(p_text, '[new date]', ''))) / length('[new date]'), 0);
$$;
revoke execute on function public.copy_marker_count(text) from public, anon;
grant execute on function public.copy_marker_count(text) to authenticated, service_role;

-- Every spot on a copy that still holds "[new date]": its step (the step bar's key), what it is, the job it's on,
-- and how many. Empty for an event that wasn't duplicated. Not for people to call (copy_new_date_spots checks who).
create or replace function public.copy_new_date_spots_any(p_event uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with ev as (
    select e.id, e.event_type::text as kind,
           case when e.event_type::text in ('band_contest', 'group_event') then 'volunteers' else 'jobs' end as jobs_step
      from events e join event_copies c on c.event_id = e.id where e.id = p_event
  ), spots as (
    select 'details' as step, 'The description' as what, null::uuid as station_id, null::text as job, 1 as ord,
           public.copy_marker_count(e.public_notes) as n
      from events e join ev on ev.id = e.id
    union all
    select 'details', 'A map or document''s name', null, f.label, 2, public.copy_marker_count(f.label)
      from event_files f join ev on ev.id = f.event_id
    union all
    select 'registration', 'The information for directors', null, null, 3, public.copy_marker_count(e.director_info)
      from events e join ev on ev.id = e.id
    union all
    select 'registration', 'The meal details', null, null, 4, public.copy_marker_count(e.meal_details)
      from events e join ev on ev.id = e.id
    union all
    select 'rooms', 'A room''s note', null, r.name, 5, public.copy_marker_count(r.note)
      from rooms r join ev on ev.id = r.event_id
    union all
    select ev.jobs_step, 'Instructions', st.id, st.name, 6 + st.sort_order * 10,
           public.copy_marker_count(st.instructions) + public.copy_marker_count(st.location)
      from stations st join ev on ev.id = st.event_id
    union all
    select ev.jobs_step, 'A shift', st.id, st.name, 7 + st.sort_order * 10,
           sum(public.copy_marker_count(sh.title) + public.copy_marker_count(sh.description))::int
      from shifts sh join stations st on st.id = sh.station_id join ev on ev.id = sh.event_id
     group by ev.jobs_step, st.id, st.name, st.sort_order
    union all
    select ev.jobs_step, 'A thing to bring', st.id, st.name, 8 + st.sort_order * 10,
           sum(public.copy_marker_count(i.name))::int
      from station_items i join stations st on st.id = i.station_id join ev on ev.id = i.event_id
     group by ev.jobs_step, st.id, st.name, st.sort_order
  )
  select coalesce(jsonb_agg(jsonb_build_object('step', step, 'what', what, 'station_id', station_id, 'job', job, 'count', n)
                            order by ord, job), '[]')
    from spots where n > 0;
$$;
revoke execute on function public.copy_new_date_spots_any(uuid) from public, anon, authenticated;

create or replace function public.copy_new_date_spots(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_event_admin(p_event) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return public.copy_new_date_spots_any(p_event);
end;
$$;
revoke execute on function public.copy_new_date_spots(uuid) from public, anon;
grant execute on function public.copy_new_date_spots(uuid) to authenticated;

-- Publishing a copy waits until every "[new date]" is filled in, whichever button (or the API) publishes it.
create or replace function public.events_copy_needs_new_dates()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  spots jsonb;
  words text;
begin
  if new.status = 'published' and old.status is distinct from 'published'
     and exists (select 1 from event_copies c where c.event_id = new.id) then
    spots := public.copy_new_date_spots_any(new.id);
    if jsonb_array_length(spots) > 0 then
      select string_agg(format('%s (%s %s)', s.label, s.n, case when s.n = 1 then 'spot' else 'spots' end), ', ' order by s.ord)
        into words
        from (select case x ->> 'step' when 'details' then 'Details' when 'rooms' then 'Rooms and schedule'
                                       when 'registration' then case when new.event_type::text = 'group_event' then 'Registration' else 'Band registration' end
                                       when 'volunteers' then case when new.event_type::text = 'group_event' then 'Volunteers' else 'Jobs and shifts' end
                                       else 'Jobs and shifts' end as label,
                     sum((x ->> 'count')::int) as n,
                     min(array_position(array['details', 'rooms', 'registration', 'jobs', 'volunteers'], x ->> 'step')) as ord
                from jsonb_array_elements(spots) x group by 1) s;
      raise exception 'Add the new date first. "[new date]" is still in %.', words using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.events_copy_needs_new_dates() from public, anon, authenticated;
drop trigger if exists events_copy_needs_new_dates on public.events;
create trigger events_copy_needs_new_dates before update of status on public.events
  for each row execute function public.events_copy_needs_new_dates();

-- A name for an invitation's address only when that person is already on this account's team (a member, or on
-- the team of one of its events); otherwise nothing, so typing any address never shows whose it is.
create or replace function public.team_member_name(p_org uuid, p_email text)
returns text
language sql stable security definer set search_path = public
as $$
  select nullif(p.full_name, '') from profiles p
   where lower(p.email::text) = lower(btrim(p_email))
     and (exists (select 1 from organization_members m where m.organization_id = p_org and m.user_id = p.id)
          or exists (select 1 from event_staff s join events e on e.id = s.event_id where e.organization_id = p_org and s.user_id = p.id))
   limit 1;
$$;
revoke execute on function public.team_member_name(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The copy body: one list of what comes over, used by duplicate_event and the two older copy functions.
--    Copies setup from one event into another of the same kind on the same account, moving dates by p_days.
--    Not for people to call (the callers check who may).
-- ---------------------------------------------------------------------------
create or replace function public.copy_event_setup(p_from uuid, p_to uuid, p_days integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  src      public.events;
  dst      public.events;
  today    date;
  deadline date;
  opens    date;
  st       public.stations;
  new_id   uuid;
  jobs_n   int := 0;
  shifts_n int := 0;
  items_n  int := 0;
  rooms_n  int := 0;
  zones_n  int := 0;
  n        int;
  map      jsonb := '{}';
  kind     text;
  keep     date[];
begin
  select * into src from events where id = p_from;
  select * into dst from events where id = p_to for update;
  kind := src.event_type::text;
  today := (now() at time zone dst.timezone)::date;
  -- The copy's own days: dates typed into copied text that aren't one of these become "[new date]".
  keep := array(select d::date from generate_series(dst.starts_on, dst.ends_on, interval '1 day') d);

  if kind in ('band_contest', 'group_event') then
    -- Registration dates move, or are left blank if that's in the past (or not before the first day).
    deadline := src.band_registration_deadline + p_days;
    if deadline is not null and (deadline < today or deadline >= dst.starts_on) then
      deadline := null;
    end if;
    deadline := coalesce(deadline, dst.band_registration_deadline);
    opens := src.band_registration_opens_on + p_days;
    if opens is not null and (opens < today or deadline is null or opens > deadline) then
      opens := null;
    end if;
    if opens is null and dst.band_registration_opens_on is not null and dst.band_registration_opens_on <= deadline then
      opens := dst.band_registration_opens_on;
    end if;
    keep := keep || array_remove(array[deadline, opens], null);

    update events set
      classifications             = src.classifications,
      director_info               = public.copy_blank_dates(src.director_info, keep),
      payment_link                = src.payment_link,
      chaperone_limit             = src.chaperone_limit,
      ready_minutes_before        = src.ready_minutes_before,
      finals_ready_minutes_before = src.finals_ready_minutes_before,
      equipment_spots             = src.equipment_spots,
      meals_offered               = src.meals_offered,
      meal_price_cents            = src.meal_price_cents,
      meal_details                = public.copy_blank_dates(src.meal_details, keep),
      meal_options                = src.meal_options,
      room_interval_minutes       = src.room_interval_minutes,
      room_passing_minutes        = src.room_passing_minutes,
      max_groups                  = src.max_groups,
      ask_chaperones              = src.ask_chaperones,
      ask_buses                   = src.ask_buses,
      ask_availability            = src.ask_availability,
      band_registration_deadline  = deadline,
      band_registration_opens_on  = opens
    where id = p_to;

    insert into event_director_contacts (event_id, name, phone, email)
    select p_to, name, phone, email from event_director_contacts where event_id = p_from
    on conflict (event_id) do nothing;
  end if;

  if kind = 'group_event' then
    insert into rooms (event_id, name, note, path_order, minutes)
    select p_to, name, public.copy_blank_dates(note, keep), path_order, minutes from rooms where event_id = p_from;
    get diagnostics rooms_n = row_count;
  end if;

  if kind = 'fair' then
    insert into fair_zones (event_id, name)
    select p_to, name from fair_zones where event_id = p_from order by created_at
    on conflict (event_id, name) do nothing;
    get diagnostics zones_n = row_count;
  end if;

  -- Jobs in their order, each with its shifts (same local clock time on the moved days, nobody signed up) and
  -- things to bring (nothing claimed). No lead: Coordinators are the caller's business.
  for st in select * from stations where event_id = p_from order by sort_order, created_at loop
    insert into stations (event_id, name, station_type, location, instructions, sort_order, checkpoint_kind,
                          checkpoint_order, due_minutes_before_warm_up, adults_only, zone, details_saved_at,
                          signup_kind, showing, min_adults)
    values (p_to, st.name, st.station_type, public.copy_blank_dates(st.location, keep), public.copy_blank_dates(st.instructions, keep),
            st.sort_order, st.checkpoint_kind,
            st.checkpoint_order, st.due_minutes_before_warm_up, st.adults_only, st.zone,
            case when st.details_saved_at is not null then now() end, st.signup_kind, st.showing, st.min_adults)
    returning id into new_id;
    jobs_n := jobs_n + 1;
    map := map || jsonb_build_object(st.id::text, new_id);
    insert into shifts (station_id, event_id, title, description, starts_at, ends_at, max_capacity, adults_only, min_age)
    select new_id, p_to, public.copy_blank_dates(title, keep), public.copy_blank_dates(description, keep),
           ((starts_at at time zone src.timezone) + make_interval(days => p_days)) at time zone dst.timezone,
           ((ends_at   at time zone src.timezone) + make_interval(days => p_days)) at time zone dst.timezone,
           max_capacity, adults_only, min_age
      from shifts where station_id = st.id;
    get diagnostics n = row_count;
    shifts_n := shifts_n + n;
    insert into station_items (station_id, event_id, name, needed, sort_order)
    select new_id, p_to, public.copy_blank_dates(name, keep), needed, sort_order from station_items where station_id = st.id;
    get diagnostics n = row_count;
    items_n := items_n + n;
  end loop;

  return jsonb_build_object(
    'jobs', jobs_n, 'shifts', shifts_n, 'items', items_n, 'rooms', rooms_n, 'zones', zones_n,
    'deadline', deadline, 'opens_on', opens,
    'deadline_was', src.band_registration_deadline, 'opens_on_was', src.band_registration_opens_on,
    'deadline_left_blank', src.band_registration_deadline is not null and deadline is null,
    'opens_on_left_blank', src.band_registration_opens_on is not null and opens is null,
    'station_map', map);
end;
$$;
revoke execute on function public.copy_event_setup(uuid, uuid, integer) from public, anon, authenticated;

-- Today's "start from a previous contest" and festival copy, on the shared body (same checks as before; no
-- Coordinators or files, as before).
create or replace function public.copy_band_contest_setup(p_from uuid, p_to uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  src public.events;
  dst public.events;
  r   jsonb;
begin
  select * into src from events where id = p_from;
  select * into dst from events where id = p_to for update;
  if src.id is null or dst.id is null
     or not public.is_event_admin(p_from) or not public.is_event_admin(p_to) then
    raise exception 'Only a host of both contests can copy one into the other.' using errcode = '42501';
  end if;
  if src.organization_id <> dst.organization_id then
    raise exception 'You can only start from a contest on the same account.' using errcode = 'P0001';
  end if;
  if src.event_type::text <> 'band_contest' or dst.event_type::text <> 'band_contest' then
    raise exception 'Both events need to be band contests.' using errcode = 'P0001';
  end if;
  if src.id = dst.id then
    raise exception 'Pick a different contest to start from.' using errcode = 'P0001';
  end if;
  if dst.status <> 'draft' or exists (select 1 from stations where event_id = p_to) or exists (select 1 from bands where event_id = p_to) then
    raise exception 'This contest is already set up, so it can''t start from another one.' using errcode = 'P0001';
  end if;
  r := public.copy_event_setup(p_from, p_to, dst.starts_on - src.starts_on);
  return jsonb_build_object('jobs', r -> 'jobs', 'deadline', r -> 'deadline');
end;
$$;
revoke execute on function public.copy_band_contest_setup(uuid, uuid) from public, anon;
grant execute on function public.copy_band_contest_setup(uuid, uuid) to authenticated;

create or replace function public.copy_group_event_setup(p_from uuid, p_to uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  src public.events;
  dst public.events;
  r   jsonb;
begin
  select * into src from events where id = p_from;
  select * into dst from events where id = p_to for update;
  if src.id is null or dst.id is null
     or not public.is_event_admin(p_from) or not public.is_event_admin(p_to) then
    raise exception 'Only a host of both festivals can copy one into the other.' using errcode = '42501';
  end if;
  if src.organization_id <> dst.organization_id then
    raise exception 'You can only start from a festival on the same account.' using errcode = 'P0001';
  end if;
  if src.event_type::text <> 'group_event' or dst.event_type::text <> 'group_event' then
    raise exception 'Both events need to be festivals.' using errcode = 'P0001';
  end if;
  if src.id = dst.id then
    raise exception 'Pick a different festival to start from.' using errcode = 'P0001';
  end if;
  if dst.status <> 'draft' or exists (select 1 from stations where event_id = p_to)
     or exists (select 1 from bands where event_id = p_to) or exists (select 1 from rooms where event_id = p_to) then
    raise exception 'This festival is already set up, so it can''t start from another one.' using errcode = 'P0001';
  end if;
  r := public.copy_event_setup(p_from, p_to, dst.starts_on - src.starts_on);
  return jsonb_build_object('rooms', r -> 'rooms', 'jobs', r -> 'jobs', 'deadline', r -> 'deadline');
end;
$$;
revoke execute on function public.copy_group_event_setup(uuid, uuid) from public, anon;
grant execute on function public.copy_group_event_setup(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. duplicate_event
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_event(p_from uuid, p_new_first_day date, p_name text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me       uuid := auth.uid();
  src      public.events;
  existing public.event_copies;
  nm       text := btrim(coalesce(p_name, ''));
  today    date;
  d        int;
  base     text;
  s        text;
  new_id   uuid;
  setup    jsonb;
  map      jsonb;
  r        record;
  f        public.event_files;
  inv_id   uuid;
  new_path text;
  vis      date;
  fid      uuid;
  added    jsonb := '[]';
  skipped  jsonb := '[]';
  held     jsonb;
  files    jsonb := '[]';
  pending  jsonb;
  steps    text[];
  summary  jsonb;
begin
  if me is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Something went wrong. Try again.' using errcode = 'P0001';
  end if;
  -- One copy per request: a double press or a retry after a dropped connection finds the first one.
  perform pg_advisory_xact_lock(hashtext('duplicate_event:' || me::text || ':' || p_request_id::text));
  select * into existing from event_copies c where c.created_by = me and c.request_id = p_request_id;
  if existing.event_id is not null then
    return jsonb_build_object('event_id', existing.event_id, 'existing', true, 'summary', existing.summary);
  end if;

  select * into src from events where id = p_from;
  if src.id is null or not public.is_org_admin(src.organization_id) then
    raise exception 'Only the Account Host and Co-hosts of every event can duplicate events.' using errcode = '42501';
  end if;
  if src.event_type::text not in ('volunteer', 'fair', 'band_contest', 'group_event') then
    raise exception 'Only events with jobs can be duplicated.' using errcode = 'P0001';
  end if;
  if nm = '' then
    raise exception 'Fill in the name of the new event.' using errcode = 'P0001';
  end if;
  if char_length(nm) > 120 then
    raise exception 'Keep the name under 120 characters.' using errcode = 'P0001';
  end if;
  today := (now() at time zone src.timezone)::date;
  if p_new_first_day is null then
    raise exception 'Pick the new first day.' using errcode = 'P0001';
  end if;
  if p_new_first_day < today then
    raise exception 'Pick today or a later date for the new first day.' using errcode = 'P0001';
  end if;
  d := p_new_first_day - src.starts_on;

  -- A new slug, like the app's slugify: the name, then four random letters or digits.
  base := left(btrim(regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g'), '-'), 48);
  base := btrim(base, '-');
  if char_length(base) < 1 then
    base := 'event';
  end if;
  loop
    s := base || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
    exit when not exists (select 1 from events e where e.slug = s);
  end loop;

  -- Details: named columns only, a draft with sign-up and registration closed.
  insert into events (organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end,
                      venue_name, venue_address, venue_place_id, venue_lat, venue_lng, public_notes, show_brand,
                      classifications, volunteer_signup_open, band_registration_open, created_by)
  values (src.organization_id, nm, s, 'draft', src.event_type, src.timezone, p_new_first_day, src.ends_on + d,
          ((src.window_start at time zone src.timezone) + make_interval(days => d)) at time zone src.timezone,
          ((src.window_end   at time zone src.timezone) + make_interval(days => d)) at time zone src.timezone,
          src.venue_name, src.venue_address, src.venue_place_id, src.venue_lat, src.venue_lng,
          public.copy_blank_dates(src.public_notes, array(select x::date from generate_series(p_new_first_day, src.ends_on + d, interval '1 day') x)),
          src.show_brand,
          src.classifications, false, false, me)
  returning id into new_id;

  setup := public.copy_event_setup(p_from, new_id, d);
  map := setup -> 'station_map';

  -- Coordinators: account members go straight onto their jobs; everyone else gets one held invitation (all their
  -- jobs). Invitations nobody accepted on the source don't come over. A Coordinator who can't be copied is
  -- skipped and named, never failing the copy.
  for r in
    select sl.user_id, p.email::text as email, coalesce(nullif(p.full_name, ''), p.email::text) as name,
           (map ->> sl.station_id::text)::uuid as new_station, st.name as job,
           exists (select 1 from organization_members m where m.organization_id = src.organization_id and m.user_id = sl.user_id) as member
      from station_leads sl
      join stations st on st.id = sl.station_id
      join profiles p on p.id = sl.user_id
     where sl.event_id = p_from
     order by st.sort_order, st.created_at, sl.created_at, sl.user_id
  loop
    continue when r.new_station is null;
    begin
      if r.member then
        insert into station_leads (station_id, user_id, event_id) values (r.new_station, r.user_id, new_id)
        on conflict do nothing;
        added := added || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'name', r.name, 'job', r.job));
      else
        select i.id into inv_id from invitations i
         where i.event_id = new_id and lower(i.email::text) = lower(r.email) and i.role = 'section_lead' and i.accepted_at is null;
        if inv_id is null then
          insert into invitations (event_id, email, role, station_id, invited_by, token, held_for_publish, copied_from_event_id)
          values (new_id, lower(r.email), 'section_lead', r.new_station, me, null, true, p_from);
        else
          update invitations set extra_station_ids = extra_station_ids || r.new_station
           where id = inv_id and station_id <> r.new_station and not (r.new_station = any (extra_station_ids));
        end if;
      end if;
    exception when others then
      skipped := skipped || jsonb_build_array(jsonb_build_object('name', r.name, 'email', r.email, 'job', r.job));
    end;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'invitation_id', i.id, 'email', i.email::text,
           -- A name only for someone already on this account's team; otherwise the address.
           'name', coalesce(public.team_member_name(src.organization_id, i.email::text), i.email::text),
           'jobs', (select jsonb_agg(st.name order by st.sort_order, st.created_at) from stations st
                     where st.id = i.station_id or st.id = any (i.extra_station_ids)))
           order by (select st.sort_order from stations st where st.id = i.station_id), i.email), '[]')
    into held
    from invitations i where i.event_id = new_id and i.held_for_publish;

  -- Only how many: the stored summary keeps no address from the source's invitations.
  select to_jsonb(count(*))
    into pending
    from invitations i
   where i.event_id = p_from and i.role = 'section_lead' and i.accepted_at is null;

  -- Maps and documents: new rows in the copy's folder; the server copies each stored file and removes the row of
  -- any that doesn't copy. A "show from" day moves too (left off if that's already here).
  for f in select * from event_files ef where ef.event_id = p_from order by ef.created_at loop
    new_path := new_id::text || '/' || gen_random_uuid()::text || '-'
                || coalesce(substring(f.path from '^[^/]+/[0-9a-f-]{36}-([A-Za-z0-9_.-]{1,80})$'),
                            left(nullif(regexp_replace(f.file_name, '[^A-Za-z0-9_.-]+', '-', 'g'), ''), 80), 'file');
    vis := f.visible_from + d;
    if vis is not null and vis <= today then
      vis := null;
    end if;
    insert into event_files (event_id, label, path, file_name, content_type, size_bytes, audiences, visible_from, created_by)
    values (new_id, public.copy_blank_dates(f.label, array(select x::date from generate_series(p_new_first_day, src.ends_on + d, interval '1 day') x)),
            new_path, f.file_name, f.content_type, f.size_bytes, f.audiences, vis, me)
    returning id into fid;
    files := files || jsonb_build_array(jsonb_build_object('id', fid, 'label', f.label, 'file_name', f.file_name,
                                                             'from', f.path, 'to', new_path));
  end loop;

  -- The copied steps, each "Copied: check it" until opened.
  steps := case src.event_type::text
             when 'band_contest' then array['details', 'registration'] || case when (setup ->> 'jobs')::int > 0 then array['volunteers'] else '{}'::text[] end
             when 'group_event' then array['details', 'rooms', 'registration'] || case when (setup ->> 'jobs')::int > 0 then array['volunteers'] else '{}'::text[] end
             else array['details', 'jobs'] end;
  insert into event_copy_steps (event_id, step) select new_id, x from unnest(steps) x on conflict do nothing;

  -- A new event has no "saved by" history: copying isn't a save.
  delete from event_saves where event_id = new_id;

  summary := jsonb_build_object(
    'kind', src.event_type::text,
    'source', jsonb_build_object('id', src.id, 'name', src.name, 'starts_on', src.starts_on, 'ends_on', src.ends_on,
                                 'status', src.status::text),
    'name', nm,
    'starts_on', p_new_first_day,
    'ends_on', src.ends_on + d,
    'days_moved', d,
    'jobs', (setup ->> 'jobs')::int,
    'shifts', (setup ->> 'shifts')::int,
    'items', (setup ->> 'items')::int,
    'rooms', (setup ->> 'rooms')::int,
    'zones', (setup ->> 'zones')::int,
    'registration', case when src.event_type::text in ('band_contest', 'group_event') then jsonb_build_object(
                       'deadline', setup -> 'deadline', 'deadline_was', setup -> 'deadline_was',
                       'deadline_left_blank', setup -> 'deadline_left_blank',
                       'opens_on', setup -> 'opens_on', 'opens_on_was', setup -> 'opens_on_was',
                       'opens_on_left_blank', setup -> 'opens_on_left_blank') end,
    'coordinators', jsonb_build_object('held', held, 'added', added, 'skipped', skipped),
    'not_copied_invitations', pending,
    'volunteers_on_source', (select count(*) from volunteers v where v.event_id = p_from),
    'bands_on_source', (select count(*) from bands b where b.event_id = p_from),
    'files', files,
    'steps', to_jsonb(steps));

  insert into event_copies (event_id, source_event_id, organization_id, created_by, request_id, days_moved, summary)
  values (new_id, p_from, src.organization_id, me, p_request_id, d, summary);

  return jsonb_build_object('event_id', new_id, 'existing', false, 'summary', summary);
end;
$$;
revoke execute on function public.duplicate_event(uuid, date, text, uuid) from public, anon;
grant execute on function public.duplicate_event(uuid, date, text, uuid) to authenticated;

-- The server removes the row of a map or document whose stored file didn't copy (it reports which).
create or replace function public.drop_uncopied_event_files(p_event uuid, p_ids uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if not exists (select 1 from event_copies c where c.event_id = p_event and c.created_by = auth.uid())
     or not public.is_event_admin(p_event) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  delete from event_files where event_id = p_event and id = any (p_ids);
  get diagnostics n = row_count;
  delete from event_saves where event_id = p_event and area = 'files'
     and saved_at = now();
  return n;
end;
$$;
revoke execute on function public.drop_uncopied_event_files(uuid, uuid[]) from public, anon;
grant execute on function public.drop_uncopied_event_files(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Coordinators on the copy: the status ladder, Send now's fallback, Remove and Undo, Fix the address
-- ---------------------------------------------------------------------------
-- Every invitation that came over with the copy, in job order: not emailed yet (held), sent, expired, or
-- accepted; for one not sent (or expired), whether it can be sent now and, if not, why (the plan or a full team).
create or replace function public.copy_coordinators(p_event uuid)
returns table (invitation_id uuid, name text, email text, station_id uuid, jobs text[], status text,
               sent_at timestamptz, expires_at timestamptz, accepted_at timestamptz, can_send boolean, why_not text)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_event_admin(p_event) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return query
    select i.id,
           -- A name once they accept, or when they're already on this account's team; otherwise the address
           -- (so changing the address to anyone's never shows whose it is).
           coalesce((select nullif(p.full_name, '') from profiles p where p.id = i.accepted_by),
                    public.team_member_name(i.organization_id, i.email::text),
                    i.email::text),
           i.email::text,
           i.station_id,
           coalesce((select array_agg(st.name order by st.sort_order, st.created_at) from stations st
                      where st.id = i.station_id or st.id = any (i.extra_station_ids)), '{}'),
           x.status,
           i.sent_at,
           case when i.held_for_publish then null else i.expires_at end,
           i.accepted_at,
           x.status in ('held', 'expired') and x.why is null,
           x.why
      from invitations i
      cross join lateral (
        select s.status,
               case when s.status in ('held', 'expired')
                    then public.team_add_reason(i.organization_id, null, i.email::text, true) end as why
          from (select case when i.accepted_at is not null then 'accepted'
                            when i.held_for_publish then 'held'
                            when i.expires_at < now() then 'expired'
                            else 'sent' end as status) s
      ) x
     where i.event_id = p_event and i.copied_from_event_id is not null
     order by (select st.sort_order from stations st where st.id = i.station_id) nulls last, i.email;
end;
$$;
revoke execute on function public.copy_coordinators(uuid) from public, anon;
grant execute on function public.copy_coordinators(uuid) to authenticated;

-- The email didn't go out (Send now, or at publish): back to where it was, so nobody holds a link that was never
-- delivered. One never emailed goes back to "Not emailed yet"; one that had expired (p_was_expired) goes back to
-- expired, never "Not emailed yet", since it was emailed once. Only straight after sending it.
drop function if exists public.copy_invitation_not_sent(uuid);
create or replace function public.copy_invitation_not_sent(p_id uuid, p_was_expired boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  inv invitations;
begin
  select * into inv from invitations where id = p_id for update;
  if inv.id is null or not public.is_event_admin(inv.event_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if inv.copied_from_event_id is null or inv.accepted_at is not null or inv.held_for_publish
     or inv.sent_at is null or inv.sent_at < now() - interval '10 minutes' then
    return;
  end if;
  if p_was_expired then
    update invitations set expires_at = now() - interval '1 second', token = gen_random_uuid() where id = p_id;
  else
    update invitations set held_for_publish = true, token = null, sent_at = null where id = p_id;
  end if;
end;
$$;
revoke execute on function public.copy_invitation_not_sent(uuid, boolean) from public, anon;
grant execute on function public.copy_invitation_not_sent(uuid, boolean) to authenticated;

-- Remove a copied Coordinator who hasn't been emailed (or whose invitation expired). Returns what Undo needs.
create or replace function public.remove_copy_invitation(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  inv invitations;
  rid uuid;
begin
  select * into inv from invitations where id = p_id for update;
  if inv.id is null or inv.copied_from_event_id is null or not public.is_event_admin(inv.event_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then
    raise exception 'They''ve accepted, so they''re on the team: remove them in Team setup.' using errcode = 'P0001';
  end if;
  if not inv.held_for_publish and inv.expires_at >= now() then
    raise exception 'This invitation was sent. Use Cancel invitation instead.' using errcode = 'P0001';
  end if;
  -- Kept only while Undo works (10 minutes): a removed person's address isn't kept longer than that.
  delete from copy_invitation_removals where removed_at < now() - interval '10 minutes';
  insert into copy_invitation_removals (event_id, removed_by, invitation)
  values (inv.event_id, auth.uid(), to_jsonb(inv))
  returning id into rid;
  delete from invitations where id = p_id;
  return rid;
end;
$$;
revoke execute on function public.remove_copy_invitation(uuid) from public, anon;
grant execute on function public.remove_copy_invitation(uuid) to authenticated;

create or replace function public.undo_remove_copy_invitation(p_removal uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  rem copy_invitation_removals;
  inv invitations;
begin
  select * into rem from copy_invitation_removals where id = p_removal for update;
  if rem.id is null then
    raise exception 'That can''t be undone anymore.' using errcode = 'P0001';
  end if;
  if rem.removed_by is distinct from auth.uid() or not public.is_event_admin(rem.event_id) then
    raise exception 'Only the person who removed them can undo it.' using errcode = '42501';
  end if;
  if rem.removed_at < now() - interval '10 minutes' then
    raise exception 'The 10 minutes to undo are up. Invite them again from Team setup.' using errcode = 'P0001';
  end if;
  inv := jsonb_populate_record(null::invitations, rem.invitation);
  if not exists (select 1 from stations where id = inv.station_id and event_id = rem.event_id) then
    raise exception 'That job was deleted, so they can''t be put back on it.' using errcode = 'P0001';
  end if;
  if exists (select 1 from invitations i where i.event_id = rem.event_id and lower(i.email::text) = lower(inv.email::text)
              and i.role = 'section_lead' and i.accepted_at is null) then
    raise exception '% has been invited again since.', inv.email using errcode = 'P0001';
  end if;
  insert into invitations (id, event_id, organization_id, email, role, station_id, extra_station_ids, token, invited_by,
                           created_at, expires_at, sent_at, held_for_publish, copied_from_event_id, as_host)
  values (inv.id, rem.event_id, inv.organization_id, inv.email, 'section_lead', inv.station_id,
          array(select x from unnest(inv.extra_station_ids) x where exists (select 1 from stations s where s.id = x and s.event_id = rem.event_id)),
          inv.token, inv.invited_by, inv.created_at, inv.expires_at, inv.sent_at, inv.held_for_publish, inv.copied_from_event_id, false);
  delete from copy_invitation_removals where id = p_removal;
  return inv.id;
end;
$$;
revoke execute on function public.undo_remove_copy_invitation(uuid) from public, anon;
grant execute on function public.undo_remove_copy_invitation(uuid) to authenticated;

-- "Fix the address" on a Coordinator who hasn't been emailed yet.
create or replace function public.fix_copy_invitation_email(p_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  inv invitations;
  addr text := lower(btrim(coalesce(p_email, '')));
begin
  select * into inv from invitations where id = p_id for update;
  if inv.id is null or inv.copied_from_event_id is null or not public.is_event_admin(inv.event_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if not inv.held_for_publish then
    raise exception 'Only an invitation that hasn''t been emailed can have its address changed.' using errcode = 'P0001';
  end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(addr) > 254 then
    raise exception 'Please enter a valid email address.' using errcode = 'P0001';
  end if;
  if exists (select 1 from invitations i where i.event_id = inv.event_id and i.id <> inv.id and lower(i.email::text) = addr
              and i.role = 'section_lead' and i.accepted_at is null) then
    raise exception '% already has an invitation for this event.', addr using errcode = 'P0001';
  end if;
  update invitations set email = addr where id = p_id;
end;
$$;
revoke execute on function public.fix_copy_invitation_email(uuid, text) from public, anon;
grant execute on function public.fix_copy_invitation_email(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The copied steps, the publish step's facts, and Delete and start over
-- ---------------------------------------------------------------------------
-- Opening a copied step checks it off ("Copied: check it" becomes "Opened").
drop function if exists public.mark_copy_step(uuid, text, boolean);
create or replace function public.mark_copy_step(p_event uuid, p_step text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_admin(p_event) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  update event_copy_steps set opened_at = coalesce(opened_at, now()) where event_id = p_event and step = p_step;
end;
$$;
revoke execute on function public.mark_copy_step(uuid, text) from public, anon;
grant execute on function public.mark_copy_step(uuid, text) to authenticated;

-- Whether this person may Delete and start over, or the reason they can't (null when they may).
create or replace function public.copy_discard_blocker(p_event uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  c   event_copies;
  ev  events;
  who text;
begin
  select * into c from event_copies where event_id = p_event;
  select * into ev from events where id = p_event;
  if c.event_id is null or ev.id is null then
    return 'This event wasn''t made by duplicating, so it can''t be deleted here.';
  end if;
  if c.created_by is distinct from auth.uid() or not public.is_org_admin(ev.organization_id) then
    return 'Only the person who duplicated it can delete it here. The Account Host can delete it in Event settings.';
  end if;
  if c.first_published_at is not null or ev.status <> 'draft' then
    return 'It has been published, so it can''t be deleted here. The Account Host can delete it in Event settings.';
  end if;
  if exists (select 1 from volunteers where event_id = p_event) then
    return 'People have signed up, so it can''t be deleted here. The Account Host can delete it in Event settings.';
  end if;
  if exists (select 1 from bands where event_id = p_event) then
    return 'It has registrations, so it can''t be deleted here. The Account Host can delete it in Event settings.';
  end if;
  select coalesce(nullif(p.full_name, ''), i.email::text) into who
    from invitations i left join profiles p on p.id = i.accepted_by
   where i.event_id = p_event and i.accepted_at is not null limit 1;
  if who is null then
    select coalesce(nullif(p.full_name, ''), p.email::text) into who
      from event_staff s join profiles p on p.id = s.user_id where s.event_id = p_event limit 1;
  end if;
  if who is not null then
    return format('%s has accepted an invitation, so this copy can''t be deleted here. The Account Host can delete it in Event settings.', who);
  end if;
  return null;
end;
$$;
revoke execute on function public.copy_discard_blocker(uuid) from public, anon;
grant execute on function public.copy_discard_blocker(uuid) to authenticated;

-- Delete and start over: the copy and everything on it. Sent invitations nobody accepted stop working with it.
-- Returns the stored files' paths, for the server to remove, and the name and first day to start over with.
create or replace function public.discard_event_copy(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c      event_copies;
  ev     events;
  why    text;
  paths  text[];
begin
  select * into c from event_copies where event_id = p_event;
  select * into ev from events where id = p_event for update;
  if ev.id is null or c.event_id is null or not public.is_event_admin(p_event) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  why := public.copy_discard_blocker(p_event);
  if why is not null then
    raise exception '%', why using errcode = case when why like 'Only the person%' then '42501' else 'P0001' end;
  end if;
  select coalesce(array_agg(path), '{}') into paths from event_files where event_id = p_event;
  perform set_config('app.cleaning_up', 'on', true);
  delete from events where id = p_event;
  perform set_config('app.cleaning_up', 'off', true);
  return jsonb_build_object('paths', to_jsonb(paths), 'source_event_id', c.source_event_id, 'name', ev.name,
                            'starts_on', ev.starts_on);
end;
$$;
revoke execute on function public.discard_event_copy(uuid) from public, anon;
grant execute on function public.discard_event_copy(uuid) to authenticated;

-- What the copy's Publish step needs: each copied step opened or not, every spot still holding "[new date]", who
-- can be emailed and who can't and why, and Delete and start over. Null for an event that wasn't duplicated.
create or replace function public.copy_publish_check(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  c     event_copies;
  ev    events;
  tier  plan_tiers;
  used  int;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  select * into c from event_copies where event_id = p_event;
  if c.event_id is null then
    return null;
  end if;
  select * into ev from events where id = p_event;
  tier := public.package_tier(ev.organization_id);
  used := (select count(*) from public.org_team(ev.organization_id));
  return jsonb_build_object(
    'source', c.summary -> 'source',
    'days_moved', c.days_moved,
    'created_at', c.created_at,
    'first_published_at', c.first_published_at,
    'steps', (select coalesce(jsonb_agg(jsonb_build_object('step', s.step, 'opened', s.opened_at is not null)
                order by array_position(array['details', 'rooms', 'registration', 'jobs', 'volunteers'], s.step)), '[]')
                from event_copy_steps s where s.event_id = p_event),
    -- Every spot still holding "[new date]" (publishing waits for them).
    'new_dates', public.copy_new_date_spots_any(p_event),
    'invitations', (select coalesce(jsonb_agg(to_jsonb(cc)), '[]') from public.copy_coordinators(p_event) cc),
    'team', jsonb_build_object('used', used, 'max', tier.max_team,
                               'free', case when tier.max_team is null then null else greatest(tier.max_team - used, 0) end,
                               'coordinators_included', coalesce(tier.event_staff, true)),
    'discard_blocker', public.copy_discard_blocker(p_event));
end;
$$;
revoke execute on function public.copy_publish_check(uuid) from public, anon;
grant execute on function public.copy_publish_check(uuid) to authenticated;
