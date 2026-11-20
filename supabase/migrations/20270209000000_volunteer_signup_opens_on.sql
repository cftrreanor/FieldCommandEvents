-- =============================================================================
-- Volunteer sign-up that opens on a set day (volunteer events and fairs; owner decision 2, 2026-11-20).
--   1. events.volunteer_signup_opens_on: optional. With sign-up switched on (volunteer_signup_open), it stays
--      shut until that day in the event's time zone, then opens by itself: worked out when read, no background
--      job. Empty means it's open as soon as the switch is on. Like band_registration_opens_on.
--   2. volunteer_signup_is_open(ev): the one rule every sign-up checks (published, switched on, and the day
--      has come). volunteer_signup_opens_later(ev) is the waiting state the pages show.
--   3. sign_up_volunteer (and sign_up_group, which books through it), register_volunteer, and
--      swap_shift_with_pass use it, from their latest versions. Before the day they say when it opens.
--   4. Saving the day counts toward the volunteer step's "Saved by".
--   5. duplicate_event / copy_event_setup move the day by the same number of days, or leave it blank if that
--      would be in the past (or after the copy's last day, or for a fair on or after its first day, when online
--      sign-up closes), like registration's opening day. A copy that keeps a day has sign-up switched on.
--   6. One rule: a day is set only while sign-up is switched on. Switching it off (closing, unpublishing,
--      publishing with sign-up later) clears the day, so no hidden day is left to open it by itself.
--   7. reschedule_event moves a day still to come with the event's dates, or clears it (keeping sign-up closed)
--      when it no longer fits.
-- Safe to run twice.
-- =============================================================================

-- 1. The opening day ----------------------------------------------------------------------------
alter table public.events add column if not exists volunteer_signup_opens_on date;

-- 6. A day only while switched on (rows from before this rule, then a trigger for every write). A day that's set
--    or changed is from today to the event's last day, or for a fair to the day before it (online sign-up closes
--    on fair day): the same limits as the date box.
create or replace function public.events_signup_day_needs_switch()
returns trigger
language plpgsql set search_path = public
as $$
declare
  last_day date;
begin
  if not coalesce(new.volunteer_signup_open, false) then
    new.volunteer_signup_opens_on := null;
  end if;
  if new.volunteer_signup_opens_on is not null
     and (tg_op = 'INSERT' or new.volunteer_signup_opens_on is distinct from old.volunteer_signup_opens_on) then
    last_day := case when new.event_type::text = 'fair' then new.starts_on - 1 else new.ends_on end;
    if new.volunteer_signup_opens_on < (now() at time zone new.timezone)::date or new.volunteer_signup_opens_on > last_day then
      raise exception '%', case when new.event_type::text = 'fair'
                                then 'Pick a day from today to the day before the fair (' || to_char(last_day, 'Mon FMDD') || ').'
                                else 'Pick a day from today to the event''s last day (' || to_char(last_day, 'Mon FMDD') || ').' end
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.events_signup_day_needs_switch() from public, anon, authenticated;
drop trigger if exists events_signup_day_needs_switch on public.events;
create trigger events_signup_day_needs_switch
  before insert or update of volunteer_signup_open, volunteer_signup_opens_on on public.events
  for each row execute function public.events_signup_day_needs_switch();
update public.events set volunteer_signup_opens_on = null
 where volunteer_signup_opens_on is not null and not volunteer_signup_open;

-- 2. The rule ------------------------------------------------------------------------------------
create or replace function public.volunteer_signup_is_open(ev public.events)
returns boolean
language sql stable set search_path = public
as $$
  select ev.id is not null
     and ev.status = 'published'
     and ev.volunteer_signup_open
     and (ev.volunteer_signup_opens_on is null
          or (now() at time zone ev.timezone)::date >= ev.volunteer_signup_opens_on);
$$;
grant execute on function public.volunteer_signup_is_open(public.events) to anon, authenticated, service_role;

-- Switched on, with its day still to come (the "Sign-up opens Mon, Jan 4" state).
create or replace function public.volunteer_signup_opens_later(ev public.events)
returns boolean
language sql stable set search_path = public
as $$
  select ev.id is not null
     and ev.status = 'published'
     and ev.volunteer_signup_open
     and ev.volunteer_signup_opens_on is not null
     and (now() at time zone ev.timezone)::date < ev.volunteer_signup_opens_on;
$$;
grant execute on function public.volunteer_signup_opens_later(public.events) to anon, authenticated, service_role;

-- "Mon, Jan 4", as the pages write it.
create or replace function public.volunteer_signup_day(d date)
returns text
language sql immutable set search_path = public
as $$
  select to_char(d, 'Dy, Mon FMDD');
$$;

-- Why a sign-up can't go through: the day it opens, or closed.
create or replace function public.volunteer_signup_not_open(ev public.events)
returns void
language plpgsql stable set search_path = public
as $$
begin
  if public.volunteer_signup_opens_later(ev) then
    raise exception 'Volunteer sign-up opens %. Please come back then.', public.volunteer_signup_day(ev.volunteer_signup_opens_on)
      using errcode = 'P0001';
  end if;
  raise exception 'Volunteer signup is not open for this event' using errcode = 'P0001';
end;
$$;
revoke execute on function public.volunteer_signup_not_open(public.events) from public, anon, authenticated;

-- 3. Every sign-up checks it ----------------------------------------------------------------------------
-- The older call (kept for older callers).
create or replace function public.register_volunteer(
  p_event_id    uuid,
  p_full_name   text,
  p_email       text,
  p_phone       text,
  p_shift_ids   uuid[],
  p_minor       boolean default false,
  p_companions  jsonb default '[]'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  ev        public.events;
  vol_id    uuid;
  vol_phone text;
begin
  select * into ev from events where id = p_event_id;
  if ev.id is null or not public.volunteer_signup_is_open(ev) then
    perform public.volunteer_signup_not_open(ev);
  end if;
  if coalesce(cardinality(p_shift_ids), 0) = 0 then
    raise exception 'Pick at least one shift' using errcode = 'P0001';
  end if;

  insert into volunteers (event_id, full_name, email, phone, minor)
  values (p_event_id,
          case when p_minor then public.minor_name(p_full_name) else trim(p_full_name) end,
          lower(trim(p_email)), trim(p_phone), coalesce(p_minor, false))
  -- An existing volunteer's name and phone are kept: the public form can't
  -- prove who is typing, so it mustn't overwrite someone else's details.
  on conflict (event_id, email)
    do update set email = volunteers.email
  returning id, phone into vol_id, vol_phone;

  perform public.book_group(
    p_event_id,
    array[vol_id] || public.signup_companions(p_event_id, vol_id, vol_phone, p_companions, false),
    p_shift_ids, false, false);
  return vol_id;
end;
$$;
revoke execute on function public.register_volunteer(uuid, text, text, text, uuid[], boolean, jsonb) from public, anon, authenticated;
grant execute on function public.register_volunteer(uuid, text, text, text, uuid[], boolean, jsonb) to service_role;

-- The sign-up page's call: shifts and things to bring (sign_up_group books through it too).
create or replace function public.sign_up_volunteer(
  p_event_id    uuid,
  p_full_name   text,
  p_email       text,
  p_phone       text,
  p_shift_ids   uuid[],
  p_minor       boolean default false,
  p_companions  jsonb default '[]',
  p_items       jsonb default '[]',
  p_age         int default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  ev        public.events;
  vol_id    uuid;
  vol_phone text;
  pick      jsonb;
  it        public.station_items;
  v_note    text;
begin
  select * into ev from events where id = p_event_id;
  if ev.id is null or not public.volunteer_signup_is_open(ev) then
    perform public.volunteer_signup_not_open(ev);
  end if;
  if coalesce(cardinality(p_shift_ids), 0) = 0 and coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'Pick at least one shift or item' using errcode = 'P0001';
  end if;
  -- People bring as many things as they like; this only stops a script sending thousands.
  if coalesce(jsonb_array_length(p_items), 0) > 200 then
    raise exception 'Too many items in one sign-up' using errcode = 'P0001';
  end if;
  if coalesce(p_minor, false) and p_age is not null and p_age not between 5 and 17 then
    raise exception 'Please enter an age from 5 to 17 for anyone under 18.' using errcode = 'P0001';
  end if;

  insert into volunteers (event_id, full_name, email, phone, minor, age)
  values (p_event_id,
          case when p_minor then public.minor_name(p_full_name) else trim(p_full_name) end,
          lower(trim(p_email)), trim(p_phone), coalesce(p_minor, false),
          case when p_minor then p_age end)
  -- An existing volunteer's name and phone are kept: the public form can't
  -- prove who is typing, so it mustn't overwrite someone else's details.
  on conflict (event_id, email)
    do update set age = case when volunteers.minor then coalesce(volunteers.age, excluded.age) end
  returning id, phone into vol_id, vol_phone;

  if coalesce(cardinality(p_shift_ids), 0) > 0 then
    perform public.book_group(
      p_event_id,
      array[vol_id] || public.signup_companions(p_event_id, vol_id, vol_phone, p_companions, false),
      p_shift_ids, false, false);
  end if;

  for pick in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    select i.* into it from station_items i
      where i.id = (pick->>'item')::uuid and i.event_id = p_event_id
      for update;
    if it.id is null then
      raise exception 'One of the selected items does not exist' using errcode = 'P0001';
    end if;
    v_note := nullif(left(trim(coalesce(pick->>'note', '')), 200), '');
    if exists (select 1 from item_signups s where s.item_id = it.id and s.volunteer_id = vol_id) then
      update item_signups set note = coalesce(v_note, note) where item_id = it.id and volunteer_id = vol_id;
    elsif it.claimed_count >= it.needed then
      raise exception 'Sorry, "%" is already covered. Please pick something else.', it.name using errcode = 'P0002';
    else
      insert into item_signups (item_id, event_id, volunteer_id, note) values (it.id, p_event_id, vol_id, v_note);
    end if;
  end loop;
  return vol_id;
end;
$$;
revoke execute on function public.sign_up_volunteer(uuid, text, text, text, uuid[], boolean, jsonb, jsonb, int) from public, anon, authenticated;
grant execute on function public.sign_up_volunteer(uuid, text, text, text, uuid[], boolean, jsonb, jsonb, int) to service_role;

-- Switching shifts with your own link.
create or replace function public.swap_shift_with_pass(
  p_assignment_id uuid, p_new_shift_id uuid, p_volunteer_tokens uuid[], p_assignment_tokens uuid[]
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  a       record;
  ev      public.events;
  sh      public.shifts;
  why     text;
begin
  select va.id, va.shift_id, va.volunteer_id, v.full_name, v.minor, v.age, s.event_id into a
    from volunteer_assignments va
    join volunteers v on v.id = va.volunteer_id
    join shifts s on s.id = va.shift_id
   where va.id = p_assignment_id
     and (v.access_token = any (coalesce(p_volunteer_tokens, '{}'))
          or va.manage_token = any (coalesce(p_assignment_tokens, '{}')));
  if a.id is null then
    return false;
  end if;
  if a.shift_id = p_new_shift_id then
    return true;
  end if;
  select * into ev from events where id = a.event_id;
  if not public.volunteer_signup_is_open(ev) then
    if public.volunteer_signup_opens_later(ev) then
      raise exception 'Volunteer sign-up opens %, so shifts can''t be switched until then.', public.volunteer_signup_day(ev.volunteer_signup_opens_on)
        using errcode = 'P0001';
    end if;
    raise exception 'Volunteer signup is closed, so shifts can''t be switched. Contact the organizers.' using errcode = 'P0001';
  end if;

  -- Lock both shifts in a fixed order, like book_group.
  perform 1 from shifts where id in (a.shift_id, p_new_shift_id) order by id for update;
  select * into sh from shifts where id = p_new_shift_id and event_id = a.event_id;
  if sh.id is null then
    raise exception 'That shift isn''t part of this event.' using errcode = 'P0001';
  end if;
  if exists (select 1 from volunteer_assignments where shift_id = sh.id and volunteer_id = a.volunteer_id) then
    raise exception 'You''re already signed up for "%".', sh.title using errcode = 'P0001';
  end if;
  if sh.registered_count >= sh.max_capacity then
    raise exception 'Sorry, "%" just filled up. Please pick another shift.', sh.title using errcode = 'P0002';
  end if;
  why := public.shift_ineligible(sh.id, a.minor, a.age);
  if why is not null then
    raise exception '"%" is %.', sh.title, lower(why) using errcode = 'P0005';
  end if;
  if a.minor and sh.max_capacity - sh.registered_count <= public.adults_still_needed(sh.id) then
    raise exception 'The spots left in "%" are for adults (18+).', sh.title using errcode = 'P0005';
  end if;
  if exists (
    select 1 from volunteer_assignments x
    join shifts s2 on s2.id = x.shift_id
    where x.volunteer_id = a.volunteer_id and x.id <> a.id
      and tstzrange(s2.starts_at, s2.ends_at) && tstzrange(sh.starts_at, sh.ends_at)
  ) then
    raise exception '"%" overlaps with another shift you signed up for.', sh.title using errcode = 'P0003';
  end if;

  update volunteer_assignments set shift_id = sh.id, checked_in_at = null, checked_in_by = null where id = a.id;
  update shifts set registered_count = registered_count - 1 where id = a.shift_id;
  update shifts set registered_count = registered_count + 1 where id = sh.id;
  insert into volunteer_changes (event_id, volunteer_id, full_name, from_shift_id, to_shift_id)
  values (a.event_id, a.volunteer_id, a.full_name, a.shift_id, sh.id);
  return true;
end;
$$;
revoke execute on function public.swap_shift_with_pass(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.swap_shift_with_pass(uuid, uuid, uuid[], uuid[]) to service_role;

-- 4. "Saved by": the opening day counts toward the volunteer step ------------------------------------------
create or replace function public.note_event_settings_save()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  part text;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_event_save(new.id, 'details');
    return null;
  end if;
  for part in
    select distinct case
             when n.key = 'status' then 'publish'
             when n.key in ('volunteer_signup_open', 'volunteer_signup_opens_on') then 'volunteers'
             when n.key in ('band_registration_open', 'band_registration_deadline', 'director_info',
                            'chaperone_limit', 'classifications') then 'bands'
             when n.key in ('performance_order_published', 'finals_published', 'finalists_revealed',
                            'ready_minutes_before', 'finals_ready_minutes_before', 'room_schedule_start',
                            'room_interval_minutes', 'room_passing_minutes') then 'schedule'
             when n.key in ('parent_registration_open', 'parent_registration_closes_at',
                            'parent_walk_ins_allowed') then 'parents'
             else 'details'
           end
      from jsonb_each(to_jsonb(new)) n
     where n.key not in ('id', 'organization_id', 'created_at', 'created_by', 'schedule_updated_at')
       and n.value is distinct from (to_jsonb(old) -> n.key)
  loop
    perform public.record_event_save(new.id, part);
  end loop;
  return null;
end;
$$;
revoke all on function public.note_event_settings_save() from public, anon, authenticated;

-- 5. Duplicating moves the opening day -----------------------------------------------------------------
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
  signup   date;
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

    -- Each copied text within its limit (copy_fit: a marker never pushes it over).
    update events set
      classifications             = src.classifications,
      director_info               = public.copy_fit(src.director_info, keep, 3000),
      payment_link                = src.payment_link,
      chaperone_limit             = src.chaperone_limit,
      ready_minutes_before        = src.ready_minutes_before,
      finals_ready_minutes_before = src.finals_ready_minutes_before,
      equipment_spots             = src.equipment_spots,
      meals_offered               = src.meals_offered,
      meal_price_cents            = src.meal_price_cents,
      meal_details                = public.copy_fit(src.meal_details, keep, 1000),
      meal_options                = array(select public.copy_fit(o, keep, 30) from unnest(src.meal_options) with ordinality u(o, ord) order by u.ord),
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
    select p_to, public.copy_fit(name, keep, 150), phone, email from event_director_contacts where event_id = p_from
    on conflict (event_id) do nothing;
  end if;

  if kind = 'group_event' then
    insert into rooms (event_id, name, note, path_order, minutes)
    select p_to, public.copy_fit(name, keep, 80), public.copy_fit(note, keep, 200), path_order, minutes from rooms where event_id = p_from;
    get diagnostics rooms_n = row_count;
  end if;

  if kind = 'fair' then
    insert into fair_zones (event_id, name)
    select p_to, public.copy_fit(name, keep, 60) from fair_zones where event_id = p_from order by created_at
    on conflict (event_id, name) do nothing;
    get diagnostics zones_n = row_count;
  end if;

  -- Volunteer sign-up's opening day moves by the same days, or is left blank if that's in the past, after the
  -- copy's last day, or for a fair on or after its first day (online sign-up closes on fair day). Then sign-up
  -- opens when it's published, as the organizer chooses. A day kept switches sign-up on (a day is set only while
  -- it's on), so the copy's Publish button says the day.
  signup := src.volunteer_signup_opens_on + p_days;
  if signup is not null and (signup < today or signup > dst.ends_on or (kind = 'fair' and signup >= dst.starts_on)) then
    signup := null;
  end if;
  signup := coalesce(signup, dst.volunteer_signup_opens_on);
  update events set volunteer_signup_open = volunteer_signup_open or signup is not null, volunteer_signup_opens_on = signup
   where id = p_to;
  keep := keep || array_remove(array[signup], null);

  -- Jobs in their order, each with its shifts (same local clock time on the moved days, nobody signed up) and
  -- things to bring (nothing claimed). No lead: Coordinators are the caller's business.
  for st in select * from stations where event_id = p_from order by sort_order, created_at loop
    insert into stations (event_id, name, station_type, location, instructions, sort_order, checkpoint_kind,
                          checkpoint_order, due_minutes_before_warm_up, adults_only, zone, details_saved_at,
                          signup_kind, showing, min_adults)
    -- A job's Location comes over too (jobs made before the job redesign can have one): the job form shows the
    -- box whenever it holds "[new date]", so every marker sits in a box the organizer can reach.
    values (p_to, public.copy_fit(st.name, keep, 80), st.station_type, public.copy_fit(st.location, keep, 200),
            public.copy_fit(st.instructions, keep, 2000),
            st.sort_order, st.checkpoint_kind,
            st.checkpoint_order, st.due_minutes_before_warm_up, st.adults_only, public.copy_fit(st.zone, keep, 60),
            case when st.details_saved_at is not null then now() end, st.signup_kind, st.showing, st.min_adults)
    returning id into new_id;
    jobs_n := jobs_n + 1;
    map := map || jsonb_build_object(st.id::text, new_id);
    insert into shifts (station_id, event_id, title, description, starts_at, ends_at, max_capacity, adults_only, min_age)
    select new_id, p_to, public.copy_fit(title, keep, 120), public.copy_fit(description, keep, 2000),
           ((starts_at at time zone src.timezone) + make_interval(days => p_days)) at time zone dst.timezone,
           ((ends_at   at time zone src.timezone) + make_interval(days => p_days)) at time zone dst.timezone,
           max_capacity, adults_only, min_age
      from shifts where station_id = st.id;
    get diagnostics n = row_count;
    shifts_n := shifts_n + n;
    insert into station_items (station_id, event_id, name, needed, sort_order)
    select new_id, p_to, public.copy_fit(name, keep, 100), needed, sort_order from station_items where station_id = st.id;
    get diagnostics n = row_count;
    items_n := items_n + n;
  end loop;

  return jsonb_build_object(
    'jobs', jobs_n, 'shifts', shifts_n, 'items', items_n, 'rooms', rooms_n, 'zones', zones_n,
    'deadline', deadline, 'opens_on', opens,
    'deadline_was', src.band_registration_deadline, 'opens_on_was', src.band_registration_opens_on,
    'deadline_left_blank', src.band_registration_deadline is not null and deadline is null,
    'opens_on_left_blank', src.band_registration_opens_on is not null and opens is null,
    'signup_opens_on', signup, 'signup_opens_on_was', src.volunteer_signup_opens_on,
    'signup_opens_on_left_blank', src.volunteer_signup_opens_on is not null and signup is null,
    'station_map', map,
    -- The one keep-list (the copy's days, registration dates, and sign-up's opening day), for the rest of the copied text.
    'keep', to_jsonb(keep));
end;
$$;
revoke execute on function public.copy_event_setup(uuid, uuid, integer) from public, anon, authenticated;

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
  keep     date[];
  unmarked jsonb;
  file_ids jsonb := '[]';
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
    -- The stored summary keeps counts and ids only: the files to copy again come from their rows.
    return jsonb_build_object('event_id', existing.event_id, 'existing', true, 'summary', existing.summary,
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id', ef.id, 'label', ef.label, 'file_name', ef.file_name,
                                                             'from', sf.path, 'to', ef.path)), '[]')
                  from jsonb_array_elements(existing.summary -> 'files') x
                  join event_files ef on ef.id = (x ->> 'id')::uuid
                  join event_files sf on sf.id = (x ->> 'source_id')::uuid),
      'coordinators', (select coalesce(jsonb_agg(jsonb_build_object('invitation_id', i.id)), '[]')
                         from invitations i where i.event_id = existing.event_id and i.held_for_publish));
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
    raise exception 'Pick today or a later date (% or after).', to_char(today, 'Mon FMDD, YYYY') using errcode = 'P0001';
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
          null, src.show_brand,
          src.classifications, false, false, me)
  returning id into new_id;

  setup := public.copy_event_setup(p_from, new_id, d);
  map := setup -> 'station_map';
  -- One keep-list for all copied text: the copy's days and its registration dates.
  keep := array(select x::date from jsonb_array_elements_text(setup -> 'keep') x);
  update events set public_notes = public.copy_fit(src.public_notes, keep, 4000) where id = new_id;

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
    values (new_id, public.copy_fit(f.label, keep, 120), new_path, f.file_name, f.content_type, f.size_bytes, f.audiences, vis, me)
    returning id into fid;
    files := files || jsonb_build_array(jsonb_build_object('id', fid, 'label', f.label, 'file_name', f.file_name,
                                                             'from', f.path, 'to', new_path));
    file_ids := file_ids || jsonb_build_array(jsonb_build_object('id', fid, 'source_id', f.id));
  end loop;

  -- The copied steps, each "Copied: check it" until opened.
  steps := case src.event_type::text
             when 'band_contest' then array['details', 'registration'] || case when (setup ->> 'jobs')::int > 0 then array['volunteers'] else '{}'::text[] end
             when 'group_event' then array['details', 'rooms', 'registration'] || case when (setup ->> 'jobs')::int > 0 then array['volunteers'] else '{}'::text[] end
             else array['details', 'jobs'] end;
  insert into event_copy_steps (event_id, step) select new_id, x from unnest(steps) x on conflict do nothing;

  -- A new event has no "saved by" history: copying isn't a save.
  delete from event_saves where event_id = new_id;

  -- Old dates too long to mark (copy_fit): each field, by row and fingerprint, listed as a place until it changes.
  select coalesce(jsonb_agg(u), '[]') into unmarked from (
    select jsonb_build_object('t', 'events', 'c', x.c, 'h', x.h) as u
      from events e, lateral (values ('public_notes', public.copy_unmarked_hash(e.public_notes, keep)),
                                     ('director_info', public.copy_unmarked_hash(e.director_info, keep)),
                                     ('meal_details', public.copy_unmarked_hash(e.meal_details, keep))) x(c, h)
     where e.id = new_id and x.h is not null
    union all
    select jsonb_build_object('t', 'meal_options', 'h', public.copy_unmarked_hash(o, keep))
      from events e, unnest(e.meal_options) o where e.id = new_id and public.copy_unmarked_hash(o, keep) is not null
    union all
    select jsonb_build_object('t', 'event_director_contacts', 'h', public.copy_unmarked_hash(dc.name, keep))
      from event_director_contacts dc where dc.event_id = new_id and public.copy_unmarked_hash(dc.name, keep) is not null
    union all
    select jsonb_build_object('t', 'rooms', 'c', x.c, 'id', rm.id, 'h', x.h)
      from rooms rm, lateral (values ('name', public.copy_unmarked_hash(rm.name, keep)), ('note', public.copy_unmarked_hash(rm.note, keep))) x(c, h)
     where rm.event_id = new_id and x.h is not null
    union all
    select jsonb_build_object('t', 'fair_zones', 'id', z.id, 'h', public.copy_unmarked_hash(z.name, keep))
      from fair_zones z where z.event_id = new_id and public.copy_unmarked_hash(z.name, keep) is not null
    union all
    select jsonb_build_object('t', 'stations', 'c', x.c, 'id', st.id, 'h', x.h)
      from stations st, lateral (values ('name', public.copy_unmarked_hash(st.name, keep)),
                                        ('location', public.copy_unmarked_hash(st.location, keep)),
                                        ('instructions', public.copy_unmarked_hash(st.instructions, keep))) x(c, h)
     where st.event_id = new_id and x.h is not null
    union all
    select jsonb_build_object('t', 'shifts', 'id', sh.id, 'h', x.h)
      from shifts sh, lateral (values (public.copy_unmarked_hash(sh.title, keep)), (public.copy_unmarked_hash(sh.description, keep))) x(h)
     where sh.event_id = new_id and x.h is not null
    union all
    select jsonb_build_object('t', 'station_items', 'id', i.id, 'h', public.copy_unmarked_hash(i.name, keep))
      from station_items i where i.event_id = new_id and public.copy_unmarked_hash(i.name, keep) is not null
    union all
    select jsonb_build_object('t', 'event_files', 'id', ef.id, 'h', public.copy_unmarked_hash(ef.label, keep))
      from event_files ef where ef.event_id = new_id and public.copy_unmarked_hash(ef.label, keep) is not null
  ) all_unmarked;

  -- What's kept: counts and ids only (no names, addresses, or file names), so a retry returns the same counts.
  -- The full lists (who's held, which files to copy) come back with this answer only.
  summary := jsonb_build_object(
    'kind', src.event_type::text,
    'source', jsonb_build_object('id', src.id, 'starts_on', src.starts_on, 'ends_on', src.ends_on, 'status', src.status::text),
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
    -- Volunteer sign-up's opening day, when the source had one: moved, or left blank.
    'signup', case when src.volunteer_signup_opens_on is not null then jsonb_build_object(
                 'opens_on', setup -> 'signup_opens_on', 'opens_on_was', setup -> 'signup_opens_on_was',
                 'opens_on_left_blank', setup -> 'signup_opens_on_left_blank') end,
    'coordinators', jsonb_build_object('held', jsonb_array_length(held), 'added', jsonb_array_length(added),
                                       'skipped', jsonb_array_length(skipped)),
    'not_copied_invitations', pending,
    'volunteers_on_source', (select count(*) from volunteers v where v.event_id = p_from),
    'bands_on_source', (select count(*) from bands b where b.event_id = p_from),
    'files', file_ids,
    'steps', to_jsonb(steps));

  insert into event_copies (event_id, source_event_id, organization_id, created_by, request_id, days_moved, summary, unmarked)
  values (new_id, p_from, src.organization_id, me, p_request_id, d, summary, unmarked);

  return jsonb_build_object('event_id', new_id, 'existing', false, 'summary', summary, 'files', files,
                            'coordinators', jsonb_build_object('held', held, 'skipped', skipped));
end;
$$;
revoke execute on function public.duplicate_event(uuid, date, text, uuid) from public, anon;
grant execute on function public.duplicate_event(uuid, date, text, uuid) to authenticated;

-- 7. Moving the event's dates moves the opening day ---------------------------------------------------------
-- Latest version: 20261004030000_team_invitations_and_editing.sql. Runs as the caller, so normal permissions apply.
create or replace function public.reschedule_event(
  p_event_id      uuid,
  p_starts_on     date,
  p_ends_on       date,
  p_window_start  timestamptz,
  p_window_end    timestamptz,
  p_timezone      text
)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  old_ev    public.events;
  day_shift int;
  moved     date;
begin
  select * into old_ev from events where id = p_event_id;
  if old_ev.starts_on is null then
    raise exception 'Event not found' using errcode = 'P0001';
  end if;
  day_shift := p_starts_on - old_ev.starts_on;

  update events
     set starts_on = p_starts_on, ends_on = p_ends_on,
         window_start = p_window_start, window_end = p_window_end, timezone = p_timezone
   where id = p_event_id;
  if not found then
    raise exception 'You don''t have permission to change this event' using errcode = '42501';
  end if;

  if day_shift <> 0 or old_ev.timezone <> p_timezone then
    update shifts
       set starts_at = ((starts_at at time zone old_ev.timezone) + make_interval(days => day_shift)) at time zone p_timezone,
           ends_at   = ((ends_at   at time zone old_ev.timezone) + make_interval(days => day_shift)) at time zone p_timezone
     where event_id = p_event_id;
  end if;

  -- Volunteer sign-up's opening day, while it's still to come, moves by the same days. One that no longer fits
  -- (today or past, after the last day, or for a fair on or after its first day) is cleared, and sign-up stays
  -- closed until it's opened: it never opens sooner than planned. A day that has come already is left alone.
  if old_ev.volunteer_signup_open and old_ev.volunteer_signup_opens_on > (now() at time zone old_ev.timezone)::date then
    moved := old_ev.volunteer_signup_opens_on + day_shift;
    if moved <= (now() at time zone p_timezone)::date or moved > p_ends_on
       or (old_ev.event_type::text = 'fair' and moved >= p_starts_on) then
      update events set volunteer_signup_open = false, volunteer_signup_opens_on = null where id = p_event_id;
    elsif moved <> old_ev.volunteer_signup_opens_on then
      update events set volunteer_signup_opens_on = moved where id = p_event_id;
    end if;
  end if;
end;
$$;
revoke execute on function public.reschedule_event(uuid, date, date, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.reschedule_event(uuid, date, date, timestamptz, timestamptz, text) to authenticated;
