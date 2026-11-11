-- =============================================================================
-- Choir, orchestra, and group festivals: the update (owner decisions 2026-11-11,
-- docs/design-decisions/2026-11-11-group-festivals.md).
--
--   1. Two-day schedules: a first group's start for each day; each group is on a
--      day; times, breaks, and push-backs count within a day.
--   2. Saving rooms and the schedule checks the version the page loaded, so two
--      co-hosts can't overwrite each other; each save records who and what.
--   3. A room the team has marked groups in can't be removed (its marks stay).
--   4. The schedule moves with the festival's dates.
--   5. On the day: "in the room now", "didn't come", and a hand-off ("done, next
--      group is in") in one step.
--   6. A private link for each room's door: marks groups in that room only, no
--      sign-in, and the organizer can turn it off.
--   7. Families' live view, from the team's marks, without who marked them.
--   8. Registration: optional classifications, fewer required answers, when a
--      group can come (day, earliest start, latest finish), a group limit, and
--      what to ask; publishing a festival needs a room and a deadline.
--   9. Copy last year's festival (not its team, groups, or times).
--  10. A director reads their group's marks only once the event is published.
-- Safe to run again.
-- =============================================================================

-- 1. Days ----------------------------------------------------------------------------------------
create table if not exists public.room_schedule_days (
  event_id   uuid not null references public.events (id) on delete cascade,
  day        date not null,
  starts_at  timestamptz not null,
  primary key (event_id, day)
);
alter table public.room_schedule_days enable row level security;
revoke all on public.room_schedule_days from anon, authenticated;
grant all on public.room_schedule_days to service_role;
grant select on public.room_schedule_days to authenticated;
drop policy if exists "schedule days: team read" on public.room_schedule_days;
create policy "schedule days: team read" on public.room_schedule_days
  for select to authenticated using (public.is_event_staff(event_id));

-- Which day a group is on (null: the festival's first day).
alter table public.group_order add column if not exists day date;

-- 2. Versions, and who saved what --------------------------------------------------------------------
alter table public.events
  add column if not exists room_schedule_version  bigint not null default 0,
  add column if not exists room_schedule_saved_by uuid references public.profiles (id) on delete set null,
  add column if not exists room_schedule_saved_at timestamptz;

create table if not exists public.room_schedule_changes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  version     bigint not null,
  saved_by    uuid references public.profiles (id) on delete set null,
  saver_name  text,
  saved_at    timestamptz not null default now(),
  -- What changed, in the organizer's words ("Moved Riverside Orchestra to Saturday"); written by the page.
  summary     text check (summary is null or length(summary) <= 500)
);
create index if not exists room_schedule_changes_event on public.room_schedule_changes (event_id, version desc);
alter table public.room_schedule_changes enable row level security;
revoke all on public.room_schedule_changes from anon, authenticated;
grant all on public.room_schedule_changes to service_role;
grant select on public.room_schedule_changes to authenticated;
drop policy if exists "schedule changes: hosts read" on public.room_schedule_changes;
create policy "schedule changes: hosts read" on public.room_schedule_changes
  for select to authenticated using (public.is_event_admin(event_id));

-- Checks the version the page loaded (null skips the check) and moves it on. Locks the event row, so two saves
-- at once take turns.
create or replace function public.next_room_schedule_version(p_event uuid, p_expected bigint, p_summary text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  cur bigint;
begin
  select room_schedule_version into cur from events where id = p_event for update;
  if p_expected is not null and cur <> p_expected then
    raise exception 'Someone else changed the schedule. Load the latest version, then make your change again.'
      using errcode = 'FC409';
  end if;
  update events
     set room_schedule_version = cur + 1, room_schedule_saved_by = auth.uid(), room_schedule_saved_at = now()
   where id = p_event;
  insert into room_schedule_changes (event_id, version, saved_by, saver_name, summary)
  values (p_event, cur + 1, auth.uid(), public.my_display_name(), nullif(btrim(coalesce(p_summary, '')), ''));
  return cur + 1;
end;
$$;
revoke execute on function public.next_room_schedule_version(uuid, bigint, text) from public, anon, authenticated;

-- 3. Marks stay: removing a room the team has used is refused (not cascaded away).
alter table public.group_checkins drop constraint if exists group_checkins_room_id_fkey;
alter table public.group_checkins
  add constraint group_checkins_room_id_fkey foreign key (room_id) references public.rooms (id);

-- Times for every group, a day at a time. (The same arithmetic as roomTimes() in src/lib/rooms.ts.)
create or replace function public.rebuild_room_slots(p_event uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  ev       events;
  ch       record;
  rm       record;
  base     timestamptz;
  day_start timestamptz;
  cur_day  date;
  idx      integer;
  breaks   integer;
  offset_m integer;
begin
  select * into ev from events where id = p_event;
  delete from room_slots where event_id = p_event;
  cur_day := null;
  for ch in
    select g.*, coalesce(g.day, ev.starts_on) as on_day
      from group_order g where g.event_id = p_event
     order by coalesce(g.day, ev.starts_on), g.position
  loop
    if cur_day is distinct from ch.on_day then
      -- A new day: its own first start; numbering and breaks start again.
      cur_day := ch.on_day;
      idx := 0;
      breaks := 0;
      select d.starts_at into day_start from room_schedule_days d where d.event_id = p_event and d.day = cur_day;
      if day_start is null and cur_day = ev.starts_on then
        day_start := ev.room_schedule_start;
      end if;
    end if;
    breaks := breaks + ch.extra_minutes_before;
    if day_start is not null then
      base := day_start + make_interval(mins => idx * ev.room_interval_minutes + breaks);
      offset_m := 0;
      for rm in select * from rooms where event_id = p_event and path_order is not null order by path_order loop
        -- A skipped room keeps its place in time, so rooms never double-book.
        if not (rm.id = any (ch.skipped_room_ids)) then
          insert into room_slots (room_id, band_id, event_id, starts_at, ends_at)
          values (rm.id, ch.band_id, p_event,
                  base + make_interval(mins => offset_m),
                  base + make_interval(mins => offset_m + rm.minutes));
        end if;
        offset_m := offset_m + rm.minutes + ev.room_passing_minutes;
      end loop;
    end if;
    idx := idx + 1;
  end loop;
  update events set schedule_updated_at = now() where id = p_event and performance_order_published;
end;
$$;
revoke execute on function public.rebuild_room_slots(uuid) from public, anon, authenticated;

-- Rooms: the whole list, checked against the version the page loaded. Returns the new version.
drop function if exists public.save_rooms(uuid, jsonb);
drop function if exists public.save_rooms(uuid, jsonb, bigint, text);
create function public.save_rooms(p_event uuid, p_rooms jsonb, p_expected_version bigint default null, p_summary text default null)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  r      jsonb;
  keep   uuid[] := '{}';
  rid    uuid;
  stop   integer := 0;
  used   text;
  ver    bigint;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'Only the event''s host can change rooms.' using errcode = '42501';
  end if;
  if (select event_type::text from events where id = p_event) <> 'group_event' then
    raise exception 'Rooms are for group events.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rooms) <> 'array' or jsonb_array_length(p_rooms) > 30 then
    raise exception 'Up to 30 rooms.' using errcode = 'P0001';
  end if;
  ver := public.next_room_schedule_version(p_event, p_expected_version, p_summary);
  for r in select * from jsonb_array_elements(p_rooms) loop
    if length(trim(coalesce(r ->> 'name', ''))) not between 1 and 80 then
      raise exception 'Every room needs a name.' using errcode = 'P0001';
    end if;
    if coalesce((r ->> 'on_path')::boolean, false) then
      stop := stop + 1;
    end if;
    rid := nullif(r ->> 'id', '')::uuid;
    if rid is not null and exists (select 1 from rooms where id = rid and event_id = p_event) then
      update rooms
         set name = trim(r ->> 'name'),
             note = nullif(trim(coalesce(r ->> 'note', '')), ''),
             path_order = case when coalesce((r ->> 'on_path')::boolean, false) then stop end,
             minutes = coalesce((r ->> 'minutes')::integer, 20)
       where id = rid;
    else
      insert into rooms (event_id, name, note, path_order, minutes)
      values (p_event, trim(r ->> 'name'), nullif(trim(coalesce(r ->> 'note', '')), ''),
              case when coalesce((r ->> 'on_path')::boolean, false) then stop end,
              coalesce((r ->> 'minutes')::integer, 20))
      returning id into rid;
    end if;
    keep := keep || rid;
  end loop;
  select r2.name into used from rooms r2
   where r2.event_id = p_event and not (r2.id = any (keep))
     and exists (select 1 from group_checkins c where c.room_id = r2.id)
   limit 1;
  if used is not null then
    raise exception 'The team has marked groups in %, so it can''t be removed. Skip it for the groups still to come instead.', used
      using errcode = 'P0001';
  end if;
  delete from rooms where event_id = p_event and not (id = any (keep));
  perform public.rebuild_room_slots(p_event);
  return ver;
end;
$$;

-- The schedule: spacing, each day's first start, and the groups in order (each on a day).
-- p_order: [{band_id, day?, skipped_room_ids: [...], extra_minutes_before}, …]
-- p_days:  [{day, starts_at}, …] (null keeps the days as they are). Returns the new version.
drop function if exists public.save_room_schedule(uuid, timestamptz, integer, integer, jsonb);
drop function if exists public.save_room_schedule(uuid, timestamptz, integer, integer, jsonb, jsonb, bigint, text);
create function public.save_room_schedule(p_event uuid, p_start timestamptz, p_interval integer, p_passing integer, p_order jsonb,
                                          p_days jsonb default null, p_expected_version bigint default null, p_summary text default null)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  ev   events;
  o    jsonb;
  d    jsonb;
  pos  integer := 0;
  gday date;
  ver  bigint;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'Only the event''s host can change the schedule.' using errcode = '42501';
  end if;
  select * into ev from events where id = p_event;
  if ev.event_type::text <> 'group_event' then
    raise exception 'Room schedules are for group events.' using errcode = 'P0001';
  end if;
  ver := public.next_room_schedule_version(p_event, p_expected_version, p_summary);
  update events
     set room_schedule_start = p_start, room_interval_minutes = p_interval, room_passing_minutes = p_passing
   where id = p_event;
  if p_days is not null then
    delete from room_schedule_days where event_id = p_event;
    for d in select * from jsonb_array_elements(p_days) loop
      gday := (d ->> 'day')::date;
      if gday < ev.starts_on or gday > coalesce(ev.ends_on, ev.starts_on) then
        raise exception 'That day isn''t one of the festival''s days.' using errcode = 'P0001';
      end if;
      insert into room_schedule_days (event_id, day, starts_at) values (p_event, gday, (d ->> 'starts_at')::timestamptz);
    end loop;
  end if;
  delete from group_order where event_id = p_event;
  for o in select * from jsonb_array_elements(coalesce(p_order, '[]')) loop
    if not exists (select 1 from bands where id = (o ->> 'band_id')::uuid and event_id = p_event) then
      raise exception 'That group isn''t registered for this event.' using errcode = 'P0001';
    end if;
    gday := nullif(o ->> 'day', '')::date;
    if gday is not null and (gday < ev.starts_on or gday > coalesce(ev.ends_on, ev.starts_on)) then
      raise exception 'That day isn''t one of the festival''s days.' using errcode = 'P0001';
    end if;
    pos := pos + 1;
    insert into group_order (band_id, event_id, position, day, skipped_room_ids, extra_minutes_before)
    values ((o ->> 'band_id')::uuid, p_event, pos, gday,
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(o -> 'skipped_room_ids') x), '{}'),
            coalesce((o ->> 'extra_minutes_before')::integer, 0));
  end loop;
  perform public.rebuild_room_slots(p_event);
  return ver;
end;
$$;
revoke execute on function public.save_rooms(uuid, jsonb, bigint, text),
                         public.save_room_schedule(uuid, timestamptz, integer, integer, jsonb, jsonb, bigint, text)
  from public, anon;
grant execute on function public.save_rooms(uuid, jsonb, bigint, text),
                        public.save_room_schedule(uuid, timestamptz, integer, integer, jsonb, jsonb, bigint, text)
  to authenticated;

-- 4. The schedule moves with the festival's dates ----------------------------------------------------
-- Same wall-clock times, moved by the same number of days in the festival's time zone.
create or replace function public.group_schedule_follows_dates()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  shift_d int := new.starts_on - old.starts_on;
begin
  if new.event_type::text <> 'group_event' or shift_d = 0 then
    return new;
  end if;
  update events
     set room_schedule_start = ((room_schedule_start at time zone new.timezone) + make_interval(days => shift_d)) at time zone new.timezone
   where id = new.id and room_schedule_start is not null;
  -- Two steps, so a later day never lands on an earlier one's key mid-update.
  update room_schedule_days set day = day + 100000 where event_id = new.id;
  update room_schedule_days
     set day = day - 100000 + shift_d,
         starts_at = ((starts_at at time zone new.timezone) + make_interval(days => shift_d)) at time zone new.timezone
   where event_id = new.id;
  update group_order set day = day + shift_d where event_id = new.id and day is not null;
  perform public.rebuild_room_slots(new.id);
  return new;
end;
$$;
revoke execute on function public.group_schedule_follows_dates() from public, anon, authenticated;
drop trigger if exists group_schedule_follows_dates on public.events;
create trigger group_schedule_follows_dates
  after update of starts_on on public.events
  for each row when (old.starts_on is distinct from new.starts_on)
  execute function public.group_schedule_follows_dates();

-- 5. Marks on the day ----------------------------------------------------------------------------------
-- kind: 'done' (room null = arrived; a room = done there), 'in' (in a room now), 'no_show' (room null).
alter table public.group_checkins add column if not exists kind text not null default 'done';
alter table public.group_checkins drop constraint if exists group_checkins_kind_check;
alter table public.group_checkins add constraint group_checkins_kind_check
  check ((kind = 'done') or (kind = 'in' and room_id is not null) or (kind = 'no_show' and room_id is null));
alter table public.group_checkins drop constraint if exists group_checkins_band_id_room_id_key;
alter table public.group_checkins drop constraint if exists group_checkins_band_room_kind_key;
alter table public.group_checkins add constraint group_checkins_band_room_kind_key unique nulls not distinct (band_id, room_id, kind);

-- One mark (or taking it back), once the caller's right to mark has been checked.
create or replace function public.apply_group_mark(p_event uuid, p_band uuid, p_room uuid, p_kind text, p_on boolean, p_actor text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_kind not in ('in', 'done', 'no_show') or (p_kind = 'in' and p_room is null) or (p_kind = 'no_show' and p_room is not null) then
    raise exception 'That isn''t a mark.' using errcode = 'P0001';
  end if;
  if p_room is not null and not exists (select 1 from rooms where id = p_room and event_id = p_event and path_order is not null) then
    raise exception 'That room isn''t on this event''s path.' using errcode = 'P0001';
  end if;
  if not p_on then
    delete from group_checkins where band_id = p_band and room_id is not distinct from p_room and kind = p_kind;
    return;
  end if;
  insert into group_checkins (event_id, band_id, room_id, kind, created_by, actor_name)
  values (p_event, p_band, p_room, p_kind, auth.uid(), p_actor)
  on conflict do nothing;
  if p_kind <> 'no_show' then
    -- Being in a room (or done there) means the group arrived, and it did come.
    insert into group_checkins (event_id, band_id, room_id, kind, created_by, actor_name)
    values (p_event, p_band, null, 'done', auth.uid(), p_actor)
    on conflict do nothing;
    delete from group_checkins where band_id = p_band and kind = 'no_show';
  end if;
  if p_kind = 'done' and p_room is not null then
    delete from group_checkins where band_id = p_band and room_id = p_room and kind = 'in';
  end if;
end;
$$;
revoke execute on function public.apply_group_mark(uuid, uuid, uuid, text, boolean, text) from public, anon, authenticated;

-- The team (hosts, co-hosts, leads) marks any group.
create or replace function public.group_mark(p_band uuid, p_room uuid, p_kind text, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  ev   uuid;
  kind text;
begin
  select b.event_id, e.event_type::text into ev, kind from bands b join events e on e.id = b.event_id where b.id = p_band;
  if ev is null then
    raise exception 'That group isn''t registered for this event.' using errcode = 'P0001';
  end if;
  if not public.is_event_staff(ev) then
    raise exception 'Only the event''s team can check groups in.' using errcode = '42501';
  end if;
  if kind is distinct from 'group_event' then
    raise exception 'Group check-in is for group events.' using errcode = 'P0001';
  end if;
  perform public.apply_group_mark(ev, p_band, p_room, p_kind, p_on, public.my_display_name());
end;
$$;

-- The earlier call ("arrived", and "done" per room) keeps working.
create or replace function public.group_checkin(p_band uuid, p_room uuid, p_done boolean)
returns void
language sql security invoker set search_path = public
as $$
  select public.group_mark(p_band, p_room, 'done', p_done);
$$;

-- "Done, the next group is in": both marks or neither.
create or replace function public.group_room_handoff(p_room uuid, p_done_band uuid, p_next_band uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_done_band is not null then
    perform public.group_mark(p_done_band, p_room, 'done', true);
  end if;
  if p_next_band is not null then
    perform public.group_mark(p_next_band, p_room, 'in', true);
  end if;
end;
$$;
revoke execute on function public.group_mark(uuid, uuid, text, boolean), public.group_room_handoff(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.group_mark(uuid, uuid, text, boolean), public.group_room_handoff(uuid, uuid, uuid)
  to authenticated;

-- 10. A director reads their own group's marks once the event is published.
drop policy if exists "group checkins: director reads own" on public.group_checkins;
create policy "group checkins: director reads own" on public.group_checkins
  for select to authenticated
  using (exists (select 1 from bands b join events e on e.id = b.event_id
                  where b.id = band_id and b.director_user_id = auth.uid() and e.status = 'published'));

-- 6. A link for each room's door -------------------------------------------------------------------------
create table if not exists public.room_door_links (
  room_id     uuid primary key references public.rooms (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  token       text not null unique check (length(token) >= 40),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  turned_off_at timestamptz
);
alter table public.room_door_links enable row level security;
revoke all on public.room_door_links from anon, authenticated;
grant all on public.room_door_links to service_role;
grant select on public.room_door_links to authenticated;
drop policy if exists "door links: hosts read" on public.room_door_links;
create policy "door links: hosts read" on public.room_door_links
  for select to authenticated using (public.is_event_admin(event_id));

-- A new link for a room (the old one stops working). Hosts only.
create or replace function public.room_door_link_new(p_room uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  ev  uuid;
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select event_id into ev from rooms where id = p_room and path_order is not null;
  if ev is null or not public.is_event_admin(ev) then
    raise exception 'Only the event''s host can make a door link.' using errcode = '42501';
  end if;
  insert into room_door_links (room_id, event_id, token, created_by)
  values (p_room, ev, tok, auth.uid())
  on conflict (room_id) do update set token = excluded.token, created_at = now(), created_by = auth.uid(), turned_off_at = null;
  return tok;
end;
$$;

create or replace function public.room_door_link_off(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_admin((select event_id from rooms where id = p_room)) then
    raise exception 'Only the event''s host can turn off a door link.' using errcode = '42501';
  end if;
  update room_door_links set turned_off_at = now() where room_id = p_room;
end;
$$;
revoke execute on function public.room_door_link_new(uuid), public.room_door_link_off(uuid) from public, anon;
grant execute on function public.room_door_link_new(uuid), public.room_door_link_off(uuid) to authenticated;

-- The room a working link opens, while the festival is published and its schedule posted (else nothing).
create or replace function public.door_room(p_token text)
returns table (room_id uuid, event_id uuid, room_name text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.event_id, r.name
    from room_door_links l
    join rooms r on r.id = l.room_id and r.path_order is not null
    join events e on e.id = r.event_id
   where l.token = p_token and l.turned_off_at is null
     and e.status = 'published' and e.performance_order_published and e.event_type::text = 'group_event';
$$;
revoke execute on function public.door_room(text) from public, anon, authenticated;

-- What the door sees: the room, and every group with a time there, with its marks. No one's personal details.
create or replace function public.room_door(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d record;
begin
  select * into d from public.door_room(p_token);
  if d.room_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'room', (select jsonb_build_object('id', r.id, 'name', r.name, 'note', r.note) from rooms r where r.id = d.room_id),
    'event', (select jsonb_build_object('name', e.name, 'timezone', e.timezone, 'slug', e.slug) from events e where e.id = d.event_id),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'band_id', b.id, 'band_name', b.band_name, 'school_name', b.school_name,
               'starts_at', s.starts_at, 'ends_at', s.ends_at,
               'arrived', exists (select 1 from group_checkins c where c.band_id = b.id and c.room_id is null and c.kind = 'done'),
               'no_show', exists (select 1 from group_checkins c where c.band_id = b.id and c.kind = 'no_show'),
               'in_at', (select c.created_at from group_checkins c where c.band_id = b.id and c.room_id = d.room_id and c.kind = 'in'),
               'done_at', (select c.created_at from group_checkins c where c.band_id = b.id and c.room_id = d.room_id and c.kind = 'done'))
             order by s.starts_at)
        from room_slots s join bands b on b.id = s.band_id
       where s.room_id = d.room_id), '[]'::jsonb));
end;
$$;

-- Marks from the door: only groups with a time in that room, only "in" and "done" there.
create or replace function public.room_door_mark(p_token text, p_band uuid, p_kind text, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  d record;
begin
  select * into d from public.door_room(p_token);
  if d.room_id is null then
    raise exception 'This door link isn''t working. Ask the organizer for a new one.' using errcode = '42501';
  end if;
  if p_kind not in ('in', 'done') then
    raise exception 'That isn''t a mark.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from room_slots s where s.room_id = d.room_id and s.band_id = p_band) then
    raise exception 'That group doesn''t have a time in this room.' using errcode = 'P0001';
  end if;
  perform public.apply_group_mark(d.event_id, p_band, d.room_id, p_kind, p_on, 'At the door of ' || d.room_name);
end;
$$;

create or replace function public.room_door_handoff(p_token text, p_done_band uuid, p_next_band uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_done_band is not null then
    perform public.room_door_mark(p_token, p_done_band, 'done', true);
  end if;
  if p_next_band is not null then
    perform public.room_door_mark(p_token, p_next_band, 'in', true);
  end if;
end;
$$;
revoke execute on function public.room_door(text), public.room_door_mark(text, uuid, text, boolean),
                         public.room_door_handoff(text, uuid, uuid) from public;
grant execute on function public.room_door(text), public.room_door_mark(text, uuid, text, boolean),
                        public.room_door_handoff(text, uuid, uuid) to anon, authenticated;

-- 7. Families' live view: the team's marks, never who made them ----------------------------------------
create or replace function public.public_room_live(p_slug text)
returns table (band_id uuid, room_id uuid, kind text, marked_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select c.band_id, c.room_id, c.kind, c.created_at
    from events e
    join group_checkins c on c.event_id = e.id
   where e.slug = p_slug and e.status = 'published' and e.performance_order_published
     and e.event_type::text = 'group_event';
$$;
revoke execute on function public.public_room_live(text) from public;
grant execute on function public.public_room_live(text) to anon, authenticated;

-- The posted schedule now names each group's id too, so the live view can match marks to it.
drop function if exists public.public_room_schedule(text);
create function public.public_room_schedule(p_slug text)
returns table (
  room_id      uuid,
  room_name    text,
  room_note    text,
  path_order   integer,
  starts_at    timestamptz,
  ends_at      timestamptz,
  school_name  text,
  band_name    text,
  classification text,
  band_id      uuid
)
language sql stable security definer set search_path = public
as $$
  select r.id, r.name, r.note, r.path_order, s.starts_at, s.ends_at, b.school_name, b.band_name, b.classification, b.id
    from events e
    join room_slots s on s.event_id = e.id
    join rooms r on r.id = s.room_id
    join bands b on b.id = s.band_id
   where e.slug = p_slug and e.status = 'published' and e.performance_order_published
   order by s.starts_at, r.path_order;
$$;
grant execute on function public.public_room_schedule(text) to anon, authenticated;

-- 8. Registration --------------------------------------------------------------------------------------
alter table public.events
  add column if not exists max_groups integer check (max_groups is null or max_groups between 1 and 2000);
-- What to ask each group. Festivals set up before this update asked for chaperones and buses: they keep asking.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'events' and column_name = 'ask_chaperones') then
    alter table public.events
      add column ask_chaperones   boolean not null default false,
      add column ask_buses        boolean not null default false,
      add column ask_availability boolean not null default true;
    update public.events set ask_chaperones = true, ask_buses = true where event_type::text = 'group_event';
  end if;
end $$;

-- When a group can come. Only the host's team and the group's director read bands.
alter table public.bands
  add column if not exists available_day  date,
  add column if not exists earliest_start time,
  add column if not exists latest_finish  time;
grant insert (available_day, earliest_start, latest_finish), update (available_day, earliest_start, latest_finish)
  on public.bands to authenticated;
alter table public.bands drop constraint if exists bands_start_before_finish;
alter table public.bands add constraint bands_start_before_finish
  check (earliest_start is null or latest_finish is null or earliest_start < latest_finish);

-- A festival asks less: these are required for band contests only (checked below).
alter table public.bands
  alter column classification     drop not null,
  alter column school_address     drop not null,
  alter column head_director_name drop not null,
  alter column head_director_phone drop not null,
  alter column chaperone_count    drop not null;

create or replace function public.bands_validate()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ev public.events;
  taken int;
begin
  -- Locked (not shared) on a new registration, so two directors can't both take a festival's last spot.
  if tg_op = 'INSERT' then
    select * into ev from public.events where id = new.event_id for update;
  else
    select * into ev from public.events where id = new.event_id for share;
  end if;
  if coalesce(new.chaperone_count, 0) > ev.chaperone_limit then
    raise exception 'This event allows at most % chaperones per band', ev.chaperone_limit
      using errcode = 'check_violation';
  end if;
  if ev.event_type::text = 'group_event' then
    -- Classifications are optional for a festival; when it has some, a group picks one of them.
    if cardinality(coalesce(ev.classifications, '{}')) > 0 or new.classification is not null then
      if new.classification is null or not (new.classification = any (coalesce(ev.classifications, '{}'))) then
        raise exception 'Pick one of this festival''s classifications.' using errcode = 'check_violation';
      end if;
    end if;
    if new.available_day is not null and (new.available_day < ev.starts_on or new.available_day > coalesce(ev.ends_on, ev.starts_on)) then
      raise exception 'Pick one of the festival''s days.' using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' and ev.max_groups is not null then
      select count(*) into taken from bands where event_id = ev.id and scratched_at is null;
      if taken >= ev.max_groups then
        raise exception 'This festival is full: % groups have registered.', ev.max_groups using errcode = 'P0001';
      end if;
    end if;
  else
    if new.classification is null or not (new.classification = any (ev.classifications)) then
      raise exception 'Classification % is not offered at this event', new.classification
        using errcode = 'check_violation';
    end if;
    if new.school_address is null or new.head_director_name is null or new.head_director_phone is null or new.chaperone_count is null then
      raise exception 'Fill in the school address, the head director, their phone, and chaperones.' using errcode = 'check_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.bands_validate() from public, anon, authenticated;
drop trigger if exists bands_validate on public.bands;
create trigger bands_validate
  before insert or update of event_id, chaperone_count, classification, available_day, school_address,
                             head_director_name, head_director_phone on public.bands
  for each row execute function public.bands_validate();

-- Whether a festival has a spot left (for the registration page).
create or replace function public.group_event_full(ev uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select e.max_groups is not null
                          and (select count(*) from bands b where b.event_id = e.id and b.scratched_at is null) >= e.max_groups
                     from events e where e.id = ev and e.status = 'published'), false);
$$;
grant execute on function public.group_event_full(uuid) to anon, authenticated;

-- Publishing a festival needs a room on the path and a registration deadline before its first day.
-- (Band contests: as before.)
create or replace function public.events_registration_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  in_use text;
  over record;
  kind text;
begin
  if current_setting('role', true) not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.classifications is distinct from new.classifications
     and coalesce(current_setting('app.renaming_classification', true), '') <> 'on' then
    select b.classification into in_use
      from bands b
     where b.event_id = new.id and b.scratched_at is null
       and b.classification = any (coalesce(old.classifications, '{}'))
       and not (b.classification = any (coalesce(new.classifications, '{}')))
     limit 1;
    if in_use is not null then
      raise exception 'Bands are registered in %. Move them to another classification first.', in_use using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.chaperone_limit is distinct from old.chaperone_limit then
    select coalesce(nullif(b.band_name, ''), b.school_name) as name, b.chaperone_count into over
      from bands b
     where b.event_id = new.id and b.scratched_at is null and b.chaperone_count > new.chaperone_limit
     order by b.chaperone_count desc
     limit 1;
    if found then
      raise exception '% registered % chaperones. Set the limit to at least %.', over.name, over.chaperone_count, over.chaperone_count
        using errcode = 'P0001';
    end if;
  end if;

  -- A festival's group limit stays at or above the groups already registered.
  if tg_op = 'UPDATE' and new.max_groups is not null and new.max_groups is distinct from old.max_groups
     and (select count(*) from bands b where b.event_id = new.id and b.scratched_at is null) > new.max_groups then
    raise exception '% groups have registered. Set the limit to at least that.',
      (select count(*) from bands b where b.event_id = new.id and b.scratched_at is null) using errcode = 'P0001';
  end if;

  kind := new.event_type::text;
  if tg_op <> 'UPDATE' or kind not in ('band_contest', 'group_event') then
    return new;
  end if;

  if new.status = 'published' then
    if new.band_registration_deadline is null
       and (old.status is distinct from 'published' or old.band_registration_deadline is not null
            or old.event_type is distinct from new.event_type) then
      raise exception 'Publishing needs a registration deadline.' using errcode = 'P0001';
    end if;
    if kind = 'band_contest' and cardinality(coalesce(new.classifications, '{}')) = 0
       and (old.status is distinct from 'published' or cardinality(coalesce(old.classifications, '{}')) > 0
            or old.event_type is distinct from new.event_type) then
      raise exception 'Publishing needs at least one classification.' using errcode = 'P0001';
    end if;
    if kind = 'group_event' and old.status is distinct from 'published'
       and not exists (select 1 from rooms r where r.event_id = new.id and r.path_order is not null) then
      raise exception 'Publishing needs at least one room.' using errcode = 'P0001';
    end if;
  end if;

  if new.band_registration_deadline is not null and new.starts_on is not null
     and new.band_registration_deadline >= new.starts_on
     and (new.band_registration_deadline is distinct from old.band_registration_deadline
          or new.starts_on is distinct from old.starts_on or old.event_type is distinct from new.event_type) then
    raise exception 'The registration deadline needs to be before % (%).',
      case kind when 'group_event' then 'the festival' else 'contest day' end, to_char(new.starts_on, 'Mon FMDD')
      using errcode = 'P0001';
  end if;

  if new.band_registration_open and new.band_registration_deadline is null
     and not old.band_registration_open then
    raise exception 'Pick a registration deadline to open registration.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke execute on function public.events_registration_rules() from public, anon, authenticated;
drop trigger if exists events_registration_rules on public.events;
create trigger events_registration_rules
  before insert or update of status, event_type, classifications, band_registration_deadline, band_registration_open, starts_on,
                             chaperone_limit, max_groups
  on public.events
  for each row execute function public.events_registration_rules();

-- 9. Copy last year's festival -----------------------------------------------------------------------------
-- Into a new, empty draft festival on the same account: rooms (with their notes, order, and minutes), the
-- spacing, registration settings and questions, information for directors, the payment link, and volunteer jobs
-- with their shifts moved by the same number of days. Not copied: the team, groups, their times, marks, or
-- anyone who signed up.
create or replace function public.copy_group_event_setup(p_from uuid, p_to uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  src     public.events;
  dst     public.events;
  shift_d int;
  today   date;
  deadline date;
  st      public.stations;
  new_id  uuid;
  jobs    int := 0;
  rooms_n int := 0;
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

  shift_d := dst.starts_on - src.starts_on;
  today := (now() at time zone dst.timezone)::date;
  deadline := src.band_registration_deadline + shift_d;
  if deadline is not null and (deadline < today or deadline >= dst.starts_on) then
    deadline := null;
  end if;

  update events set
    classifications            = src.classifications,
    director_info              = src.director_info,
    payment_link               = src.payment_link,
    chaperone_limit            = src.chaperone_limit,
    room_interval_minutes      = src.room_interval_minutes,
    room_passing_minutes       = src.room_passing_minutes,
    max_groups                 = src.max_groups,
    ask_chaperones             = src.ask_chaperones,
    ask_buses                  = src.ask_buses,
    ask_availability           = src.ask_availability,
    band_registration_deadline = coalesce(deadline, dst.band_registration_deadline)
  where id = p_to;

  insert into rooms (event_id, name, note, path_order, minutes)
  select p_to, name, note, path_order, minutes from rooms where event_id = p_from;
  get diagnostics rooms_n = row_count;

  insert into event_director_contacts (event_id, name, phone, email)
  select p_to, name, phone, email from event_director_contacts where event_id = p_from
  on conflict (event_id) do nothing;

  perform set_config('timezone', dst.timezone, true);
  for st in select * from stations where event_id = p_from order by sort_order, created_at loop
    insert into stations (event_id, name, station_type, location, instructions, sort_order, adults_only, zone,
                          details_saved_at, signup_kind, showing, min_adults)
    values (p_to, st.name, st.station_type, st.location, st.instructions, st.sort_order, st.adults_only, st.zone,
            case when st.details_saved_at is not null then now() end, st.signup_kind, st.showing, st.min_adults)
    returning id into new_id;
    jobs := jobs + 1;
    insert into shifts (station_id, event_id, title, description, starts_at, ends_at, max_capacity, adults_only, min_age)
    select new_id, p_to, title, description, starts_at + make_interval(days => shift_d), ends_at + make_interval(days => shift_d),
           max_capacity, adults_only, min_age
      from shifts where station_id = st.id;
    insert into station_items (station_id, event_id, name, needed, sort_order)
    select new_id, p_to, name, needed, sort_order from station_items where station_id = st.id;
  end loop;

  return jsonb_build_object('rooms', rooms_n, 'jobs', jobs, 'deadline', deadline);
end;
$$;
revoke execute on function public.copy_group_event_setup(uuid, uuid) from public, anon;
grant execute on function public.copy_group_event_setup(uuid, uuid) to authenticated;
