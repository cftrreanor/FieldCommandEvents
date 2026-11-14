-- =============================================================================
-- Visitor registration (school visits): each adult is its own record, names in
-- two parts, the "Send to the front office" stop mark, check-ins that lock
-- after the event, a names-free download log, the visitor check-in report, and
-- names-free totals kept after the 30-day deletion.
-- Owner decisions: docs/design-decisions/2026-11-14-visitor-attendance.md.
--
-- Who sees what:
--   * Hosts and Co-hosts (is_event_admin) see every family while the data is
--     kept (30 days after the event), and are the only ones who get email
--     addresses (parent_registration_emails), the visitor list, the report,
--     and the download log, all through functions below.
--   * Volunteer Leads and the rest of the door team (can_check_in_parents) see
--     families only from the day before the event through its last day, in the
--     event's time zone (Section Leads still only on the event day), and never
--     email addresses.
--
-- Check-in rules:
--   * Check-ins open the day before (a practice run) and lock after the event's
--     last day. A check-in made before the first day is a practice one: it
--     doesn't count once the first day starts (parent_check_in_counts), and is
--     cleared by clear_practice_parent_check_ins.
--   * Only Hosts and Co-hosts set or clear the stop mark; no reason is stored.
--     Check-in refuses a marked adult. Marking someone already checked in
--     clears their check-in (they go to the front office instead).
--   * A parent can't rename or remove a marked adult, or cancel a registration
--     with one, from their link ("Please contact the school").
--
-- Safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Names: "Maria de la Cruz" -> first "Maria de la", last "Cruz", unsure.
-- Split at the last space; unsure only when the split could be wrong: three or
-- more words, one word, or a particle (van, de, la...) before the last word.
-- ---------------------------------------------------------------------------
create or replace function public.split_person_name(p_name text, out first_name text, out last_name text, out unsure boolean)
language plpgsql immutable set search_path = public
as $$
declare
  w text[];
  n int;
  particles constant text[] := array['van', 'von', 'de', 'del', 'della', 'der', 'den', 'di', 'da', 'das', 'dos', 'du',
                                     'la', 'le', 'ter', 'ten'];
  cleaned text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if cleaned = '' then
    first_name := ''; last_name := ''; unsure := true;
    return;
  end if;
  w := string_to_array(cleaned, ' ');
  n := array_length(w, 1);
  if n = 1 then
    first_name := w[1]; last_name := ''; unsure := true;
    return;
  end if;
  first_name := array_to_string(w[1:n - 1], ' ');
  last_name := w[n];
  unsure := n >= 3 or exists (select 1 from unnest(w[1:n - 1]) x where lower(x) = any (particles));
end;
$$;

-- One adult as the server sends it: a whole name typed in one box (a string,
-- or {"name": ...}), or {"first_name", "last_name"} typed in two boxes, with
-- "id" when it's an adult already on the registration. Returns
-- {id, first_name, last_name, typed_name, split, unsure}.
create or replace function public.parent_adult_entry(p jsonb)
returns jsonb
language plpgsql immutable set search_path = public
as $$
declare
  typed text;
  s     record;
  clean constant text := '\s+';
begin
  if jsonb_typeof(p) = 'object' and btrim(coalesce(p ->> 'first_name', '')) <> '' then
    return jsonb_build_object(
      'id', p -> 'id',
      'first_name', btrim(regexp_replace(p ->> 'first_name', clean, ' ', 'g')),
      'last_name', btrim(regexp_replace(coalesce(p ->> 'last_name', ''), clean, ' ', 'g')),
      'typed_name', null, 'split', false, 'unsure', false);
  end if;
  typed := case jsonb_typeof(p) when 'string' then p #>> '{}' when 'object' then p ->> 'name' end;
  typed := btrim(regexp_replace(coalesce(typed, ''), clean, ' ', 'g'));
  s := public.split_person_name(typed);
  return jsonb_build_object(
    'id', case when jsonb_typeof(p) = 'object' then p -> 'id' end,
    'first_name', s.first_name, 'last_name', s.last_name,
    'typed_name', typed, 'split', true, 'unsure', s.unsure);
end;
$$;

-- The registering adult: First and Last when given, else the one name box.
create or replace function public.parent_main_adult(p_name text, p_first text, p_last text)
returns jsonb
language plpgsql immutable set search_path = public
as $$
declare
  e jsonb;
begin
  e := public.parent_adult_entry(case
         when btrim(coalesce(p_first, '')) <> '' then jsonb_build_object('first_name', p_first, 'last_name', coalesce(p_last, ''))
         else to_jsonb(coalesce(p_name, '')) end);
  if length(e ->> 'first_name') not between 1 and 100 or length(e ->> 'last_name') > 100
     or length(btrim((e ->> 'first_name') || ' ' || (e ->> 'last_name'))) not between 2 and 200
     or (not (e ->> 'split')::boolean and e ->> 'last_name' = '') then
    raise exception 'Please enter your first and last name.' using errcode = 'P0001';
  end if;
  return e;
end;
$$;

-- Children as stored: trimmed name, teacher, grade.
create or replace function public.parent_children_clean(p jsonb)
returns jsonb
language sql immutable set search_path = public
as $$
  select jsonb_agg(jsonb_build_object('name', trim(k ->> 'name'), 'teacher', trim(k ->> 'teacher'), 'grade', trim(k ->> 'grade')))
    from jsonb_array_elements(p) k;
$$;

-- The form's limits (register, the parent's link, imports). Other adults may
-- be whole names or First/Last.
create or replace function public.parent_registration_check(p_children jsonb, p_other_adults jsonb)
returns void
language plpgsql immutable set search_path = public
as $$
declare
  kid   jsonb;
  adult jsonb;
  e     jsonb;
begin
  if jsonb_typeof(p_children) <> 'array' or jsonb_array_length(p_children) not between 1 and 8 then
    raise exception 'Add between 1 and 8 children.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_other_adults) <> 'array' or jsonb_array_length(p_other_adults) > 5 then
    raise exception 'Up to 5 other adults can come on one registration.' using errcode = 'P0001';
  end if;
  for adult in select * from jsonb_array_elements(p_other_adults) loop
    if jsonb_typeof(adult) not in ('string', 'object') then
      raise exception 'Please enter each adult''s first and last name.' using errcode = 'P0001';
    end if;
    e := public.parent_adult_entry(adult);
    if length(e ->> 'first_name') not between 1 and 60 or length(e ->> 'last_name') > 60
       or length(btrim((e ->> 'first_name') || ' ' || (e ->> 'last_name'))) not between 2 and 120
       or (not (e ->> 'split')::boolean and e ->> 'last_name' = '') then
      raise exception 'Please enter each adult''s first and last name.' using errcode = 'P0001';
    end if;
  end loop;
  for kid in select * from jsonb_array_elements(p_children) loop
    if length(trim(coalesce(kid ->> 'name', ''))) not between 1 and 120
       or length(trim(coalesce(kid ->> 'teacher', ''))) not between 1 and 80
       or length(trim(coalesce(kid ->> 'grade', ''))) not between 1 and 20 then
      raise exception 'Please fill in each child''s name, teacher and grade.' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The adults: one record each.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'parent_registrations_id_event_key') then
    alter table public.parent_registrations add constraint parent_registrations_id_event_key unique (id, event_id);
  end if;
end $$;

create table if not exists public.parent_registration_adults (
  id                 uuid primary key default gen_random_uuid(),
  registration_id    uuid not null,
  event_id           uuid not null references public.events (id) on delete cascade,
  -- 0 is the adult who registered (the email and phone are theirs); 1-5 the others, in the order given.
  position           smallint not null check (position between 0 and 5),
  first_name         text not null check (length(first_name) between 1 and 100),
  last_name          text not null default '' check (length(last_name) <= 100),
  full_name          text generated always as (btrim(first_name || ' ' || last_name)) stored,
  -- The name as typed in one box, when the app split it (older registrations, a full-name import column).
  typed_name         text,
  name_split_by_app  boolean not null default false,
  -- The app's split could be wrong ("Maria de la Cruz"): a Host fixes or confirms it.
  name_needs_check   boolean not null default false,
  name_confirmed_at  timestamptz,
  checked_in_at      timestamptz,
  checked_in_by      uuid references public.profiles (id) on delete set null,
  -- The volunteer's name when they checked this adult in (kept if their account goes).
  checked_in_by_name text,
  -- "Send to the front office": the door shows a note instead of Check in. No reason is stored.
  sent_to_office_at  timestamptz,
  sent_to_office_by  uuid references public.profiles (id) on delete set null,
  added_at           timestamptz not null default now(),
  name_changed_at    timestamptz,
  foreign key (registration_id, event_id) references public.parent_registrations (id, event_id) on delete cascade
);
create index if not exists parent_registration_adults_event_idx on public.parent_registration_adults (event_id);
create index if not exists parent_registration_adults_registration_idx on public.parent_registration_adults (registration_id, position);

alter table public.parent_registration_adults enable row level security;
revoke all on public.parent_registration_adults from anon, authenticated;
grant select on public.parent_registration_adults to authenticated;
grant select, insert, update, delete on public.parent_registration_adults to service_role;

-- The registration keeps parent_name (the registering adult's whole name) and adult_count in step, for emails,
-- the calendar invite, and counts.
create or replace function public.parent_adults_sync()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  rid  uuid := case when tg_op = 'DELETE' then old.registration_id else new.registration_id end;
  nm   text;
  n    int;
begin
  select full_name into nm from parent_registration_adults where registration_id = rid and position = 0 order by added_at limit 1;
  select count(*)::int into n from parent_registration_adults where registration_id = rid;
  update parent_registrations
     set parent_name = case when length(coalesce(nm, '')) between 2 and 200 then nm else parent_name end,
         adult_count = greatest(1, least(6, n))
   where id = rid
     and (parent_name is distinct from case when length(coalesce(nm, '')) between 2 and 200 then nm else parent_name end
          or adult_count is distinct from greatest(1, least(6, n)));
  return null;
end;
$$;
revoke all on function public.parent_adults_sync() from public, anon, authenticated;
drop trigger if exists parent_registration_adults_sync on public.parent_registration_adults;
create trigger parent_registration_adults_sync
  after insert or delete or update of first_name, last_name, position on public.parent_registration_adults
  for each row execute function public.parent_adults_sync();

-- "Saved by": adults count as Parent Registration edits; check-ins at the door don't.
drop trigger if exists parent_registration_adults_note_save on public.parent_registration_adults;
create trigger parent_registration_adults_note_save after insert or update or delete on public.parent_registration_adults
  for each row execute function public.note_event_save('parents', 'checked_in_at,checked_in_by,checked_in_by_name');

-- Adds one adult (an entry from parent_adult_entry) to a registration.
create or replace function public.parent_adult_add(p_reg uuid, p_event uuid, e jsonb, p_position int)
returns uuid
language sql security definer set search_path = public
as $$
  insert into parent_registration_adults (registration_id, event_id, position, first_name, last_name, typed_name,
                                          name_split_by_app, name_needs_check)
  values (p_reg, p_event, p_position, e ->> 'first_name', coalesce(e ->> 'last_name', ''),
          case when (e ->> 'split')::boolean then e ->> 'typed_name' end,
          (e ->> 'split')::boolean, (e ->> 'unsure')::boolean)
  returning id;
$$;

-- Whether an entry names this adult (as typed, or as the app or a Host split it). Case doesn't matter.
create or replace function public.parent_adult_matches(e jsonb, a public.parent_registration_adults)
returns boolean
language sql immutable set search_path = public
as $$
  select case when (e ->> 'split')::boolean
              then lower(e ->> 'typed_name') in (lower(a.full_name), lower(coalesce(a.typed_name, '')))
              else lower(e ->> 'first_name') = lower(a.first_name) and lower(coalesce(e ->> 'last_name', '')) = lower(a.last_name) end;
$$;

-- ---------------------------------------------------------------------------
-- Older registrations: each adult becomes a record (split at the last space,
-- marked to check when the split could be wrong), with their check-ins.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'parent_registrations' and column_name = 'other_adults') then
    execute $sql$
      insert into public.parent_registration_adults (registration_id, event_id, position, first_name, last_name, typed_name,
                                                     name_split_by_app, name_needs_check, checked_in_at, checked_in_by,
                                                     checked_in_by_name, added_at)
      select r.id, r.event_id, 0, s.first_name, s.last_name, btrim(r.parent_name), true, s.unsure,
             r.checked_in_at, r.checked_in_by, (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = r.checked_in_by),
             r.created_at
        from public.parent_registrations r
        cross join lateral public.split_person_name(r.parent_name) s
       where s.first_name <> ''
         and not exists (select 1 from public.parent_registration_adults a where a.registration_id = r.id)
    $sql$;
    execute $sql$
      insert into public.parent_registration_adults (registration_id, event_id, position, first_name, last_name, typed_name,
                                                     name_split_by_app, name_needs_check, checked_in_at, checked_in_by,
                                                     checked_in_by_name, added_at)
      select r.id, r.event_id, o.n, s.first_name, s.last_name, btrim(o.a ->> 'name'), true, s.unsure,
             (o.a ->> 'checked_in_at')::timestamptz, p.id, nullif(btrim(p.full_name), ''), r.created_at
        from public.parent_registrations r
        cross join lateral jsonb_array_elements(r.other_adults) with ordinality o(a, n)
        cross join lateral public.split_person_name(o.a ->> 'name') s
        left join public.profiles p on p.id = (o.a ->> 'checked_in_by')::uuid
       where s.first_name <> '' and o.n <= 5
         and not exists (select 1 from public.parent_registration_adults a where a.registration_id = r.id and a.position > 0)
    $sql$;
  end if;
end $$;

-- The adults' records now hold who's coming and their check-ins.
alter table public.parent_registrations drop column if exists other_adults;
alter table public.parent_registrations drop column if exists checked_in_at;
alter table public.parent_registrations drop column if exists checked_in_by;

-- ---------------------------------------------------------------------------
-- Who sees families.
-- ---------------------------------------------------------------------------
-- The door's window: the day before the event through its last day, in the event's time zone.
create or replace function public.parent_door_window(ev uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from events where id = ev
                    and (now() at time zone timezone)::date between starts_on - 1 and ends_on);
$$;

-- Hosts and Co-hosts while the data is kept; the door team in the door's window.
create or replace function public.parent_families_visible(ev uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.parent_data_kept(ev)
     and (public.is_event_admin(ev) or (public.can_check_in_parents(ev) and public.parent_door_window(ev)));
$$;

drop policy if exists "parent registrations: team reads" on public.parent_registrations;
create policy "parent registrations: team reads" on public.parent_registrations
  for select to authenticated using (public.parent_families_visible(event_id));
-- Email addresses never go to browsers: Hosts and Co-hosts get them from parent_registration_emails().
revoke select (email) on public.parent_registrations from authenticated;

drop policy if exists "parent adults: team reads" on public.parent_registration_adults;
create policy "parent adults: team reads" on public.parent_registration_adults
  for select to authenticated using (public.parent_families_visible(event_id));

create or replace function public.parent_registration_emails(p_event uuid)
returns table (registration_id uuid, email text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.is_event_admin(p_event) and public.parent_data_kept(p_event)) then
    raise exception 'Only the event''s Hosts and Co-hosts can see families'' email addresses.' using errcode = '42501';
  end if;
  return query select r.id, r.email::text from parent_registrations r where r.event_id = p_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in.
-- ---------------------------------------------------------------------------
-- A check-in counts unless it was a practice one (before the first day) and the first day has started.
create or replace function public.parent_check_in_counts(p_at timestamptz, p_tz text, p_starts date)
returns boolean
language sql stable set search_path = public
as $$
  select p_at is not null
     and ((p_at at time zone p_tz)::date >= p_starts or (now() at time zone p_tz)::date < p_starts);
$$;

-- Clears practice check-ins once the first day has started: for one event (anyone who sees its families; the door
-- and Parent Registration call it as they open), or for every event (the daily job).
create or replace function public.clear_practice_parent_check_ins(p_event uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if not public.parent_families_visible(p_event) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  with cleared as (
    update parent_registration_adults a
       set checked_in_at = null, checked_in_by = null, checked_in_by_name = null
      from events e
     where e.id = a.event_id and a.event_id = p_event and a.checked_in_at is not null
       and not public.parent_check_in_counts(a.checked_in_at, e.timezone, e.starts_on)
    returning 1
  )
  select count(*)::int into n from cleared;
  return n;
end;
$$;

create or replace function public.clear_all_practice_parent_check_ins()
returns integer
language sql security definer set search_path = public
as $$
  with cleared as (
    update parent_registration_adults a
       set checked_in_at = null, checked_in_by = null, checked_in_by_name = null
      from events e
     where e.id = a.event_id and a.checked_in_at is not null
       and not public.parent_check_in_counts(a.checked_in_at, e.timezone, e.starts_on)
    returning 1
  )
  select count(*)::int from cleared;
$$;

-- The door: check one adult in after looking at their photo ID, or undo it.
create or replace function public.set_parent_adult_checked_in(p_adult uuid, p_in boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a     parent_registration_adults;
  ev    events;
  today date;
begin
  select * into a from parent_registration_adults where id = p_adult for update;
  if not found or not public.can_check_in_parents(a.event_id) or not public.parent_families_visible(a.event_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  select * into ev from events where id = a.event_id;
  today := (now() at time zone ev.timezone)::date;
  if today > ev.ends_on then
    raise exception 'Check-in closed at the end of the event.' using errcode = 'P0001';
  end if;
  if today < ev.starts_on - 1 then
    raise exception 'Check-in opens the day before the event.' using errcode = 'P0001';
  end if;
  if p_in and a.sent_to_office_at is not null then
    raise exception 'Please ask % to go to the front office.', a.first_name using errcode = 'P0001';
  end if;
  if p_in and public.parent_check_in_counts(a.checked_in_at, ev.timezone, ev.starts_on) then
    return;  -- already checked in
  end if;
  update parent_registration_adults
     set checked_in_at = case when p_in then now() end,
         checked_in_by = case when p_in then auth.uid() end,
         checked_in_by_name = case when p_in then (select nullif(btrim(full_name), '') from profiles where id = auth.uid()) end
   where id = p_adult;
end;
$$;

-- The stop mark ("Send to the front office"). Hosts and Co-hosts only, until check-in locks. Marking someone already
-- checked in clears their check-in.
create or replace function public.set_parent_adult_front_office(p_adult uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a  parent_registration_adults;
  ev events;
begin
  select * into a from parent_registration_adults where id = p_adult for update;
  if not found or not public.is_event_admin(a.event_id) or not public.parent_data_kept(a.event_id) then
    raise exception 'Only the event''s Hosts and Co-hosts can do that.' using errcode = '42501';
  end if;
  select * into ev from events where id = a.event_id;
  if (now() at time zone ev.timezone)::date > ev.ends_on then
    raise exception 'Check-in closed at the end of the event, so this can''t be changed.' using errcode = 'P0001';
  end if;
  if p_on then
    update parent_registration_adults
       set sent_to_office_at = coalesce(sent_to_office_at, now()),
           sent_to_office_by = coalesce(sent_to_office_by, auth.uid()),
           checked_in_at = null, checked_in_by = null, checked_in_by_name = null
     where id = p_adult;
  else
    update parent_registration_adults set sent_to_office_at = null, sent_to_office_by = null where id = p_adult;
  end if;
end;
$$;

-- Hosts and Co-hosts fix a name the app split ("Save name"), or confirm it ("It's right": the same name).
create or replace function public.set_parent_adult_name(p_adult uuid, p_first text, p_last text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a     parent_registration_adults;
  first text := btrim(regexp_replace(coalesce(p_first, ''), '\s+', ' ', 'g'));
  last  text := btrim(regexp_replace(coalesce(p_last, ''), '\s+', ' ', 'g'));
begin
  select * into a from parent_registration_adults where id = p_adult for update;
  if not found or not public.is_event_admin(a.event_id) or not public.parent_data_kept(a.event_id) then
    raise exception 'Only the event''s Hosts and Co-hosts can do that.' using errcode = '42501';
  end if;
  if length(first) not between 1 and 100 or length(last) not between 1 and 100 then
    raise exception 'Please enter a first and last name.' using errcode = 'P0001';
  end if;
  update parent_registration_adults
     set first_name = first, last_name = last,
         name_needs_check = false, name_confirmed_at = now(),
         name_changed_at = case when first is distinct from a.first_name or last is distinct from a.last_name then now() else name_changed_at end
   where id = p_adult;
end;
$$;

drop function if exists public.set_parent_checked_in(uuid, boolean, integer);
drop function if exists public.set_parent_checked_in(uuid, boolean);

-- ---------------------------------------------------------------------------
-- Registering, the parent's own link, cancelling, importing.
-- ---------------------------------------------------------------------------
drop function if exists public.register_parents(uuid, text, text, text, jsonb, jsonb);
create or replace function public.register_parents(p_event uuid, p_name text, p_email text, p_phone text, p_children jsonb,
                                                   p_other_adults jsonb default '[]', p_first text default null, p_last text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  ev     events;
  main   jsonb;
  reg_id uuid;
  token  uuid;
  a      jsonb;
  i      bigint;
begin
  select * into ev from events where id = p_event;
  if not found or not public.parent_registration_open(ev) then
    raise exception 'Registration for this event is closed.' using errcode = 'P0001';
  end if;
  p_other_adults := coalesce(p_other_adults, '[]');
  perform public.parent_registration_check(p_children, p_other_adults);
  main := public.parent_main_adult(p_name, p_first, p_last);

  insert into parent_registrations (event_id, parent_name, email, phone, children, adult_count)
  values (p_event, btrim((main ->> 'first_name') || ' ' || (main ->> 'last_name')), lower(trim(p_email)),
          nullif(trim(coalesce(p_phone, '')), ''), public.parent_children_clean(p_children), 1 + jsonb_array_length(p_other_adults))
  on conflict (event_id, email) do nothing
  returning id, access_token into reg_id, token;
  if token is null then
    return null;
  end if;
  perform public.parent_adult_add(reg_id, p_event, main, 0);
  for a, i in select value, ordinality from jsonb_array_elements(p_other_adults) with ordinality loop
    perform public.parent_adult_add(reg_id, p_event, public.parent_adult_entry(a), i::int);
  end loop;
  return token;
end;
$$;

drop function if exists public.import_parent_registration(uuid, text, text, text, jsonb, jsonb);
create or replace function public.import_parent_registration(p_event uuid, p_name text, p_email text, p_phone text, p_children jsonb,
                                                             p_other_adults jsonb default '[]', p_first text default null, p_last text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  main   jsonb;
  reg_id uuid;
  token  uuid;
  a      jsonb;
  i      bigint;
begin
  if not public.is_event_admin(p_event)
     or not exists (select 1 from events where id = p_event and event_type = 'school_visit') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  p_other_adults := coalesce(p_other_adults, '[]');
  perform public.parent_registration_check(p_children, p_other_adults);
  begin
    main := public.parent_main_adult(p_name, p_first, p_last);
  exception when sqlstate 'P0001' then
    raise exception 'Parent''s name is missing.' using errcode = 'P0001';
  end;
  if coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email isn''t valid.' using errcode = 'P0001';
  end if;

  insert into parent_registrations (event_id, parent_name, email, phone, children, adult_count)
  values (p_event, btrim((main ->> 'first_name') || ' ' || (main ->> 'last_name')), lower(trim(p_email)),
          nullif(trim(coalesce(p_phone, '')), ''), public.parent_children_clean(p_children), 1 + jsonb_array_length(p_other_adults))
  on conflict (event_id, email) do nothing
  returning id, access_token into reg_id, token;
  if token is null then
    return null;
  end if;
  perform public.parent_adult_add(reg_id, p_event, main, 0);
  for a, i in select value, ordinality from jsonb_array_elements(p_other_adults) with ordinality loop
    perform public.parent_adult_add(reg_id, p_event, public.parent_adult_entry(a), i::int);
  end loop;
  return token;
end;
$$;

-- From the parent's own link. Adults keep their records (and check-ins, stop marks, Host fixes): matched by id when
-- the form sends one, else by name. A marked adult can't be renamed or removed here.
drop function if exists public.update_parent_registration(uuid, text, text, jsonb, jsonb);
create or replace function public.update_parent_registration(p_token uuid, p_name text, p_phone text, p_children jsonb,
                                                             p_other_adults jsonb default '[]', p_first text default null, p_last text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  reg  parent_registrations;
  ev   events;
  main jsonb;
  cur  parent_registration_adults;
  m    parent_registration_adults;
  e    jsonb;
  raw  jsonb;
  i    bigint;
  keep uuid[] := '{}';
  new_id uuid;
begin
  select * into reg from parent_registrations where access_token = p_token for update;
  if not found then
    raise exception 'This link isn''t valid.' using errcode = 'P0001';
  end if;
  select * into ev from events where id = reg.event_id;
  if not public.parent_registration_open(ev) then
    raise exception 'Registration for this event is closed, so it can''t be changed online. Contact the school.' using errcode = 'P0001';
  end if;
  p_other_adults := coalesce(p_other_adults, '[]');
  perform public.parent_registration_check(p_children, p_other_adults);
  main := public.parent_main_adult(p_name, p_first, p_last);

  -- The adult who registered.
  select * into cur from parent_registration_adults where registration_id = reg.id and position = 0 order by added_at limit 1;
  if cur.id is null then
    keep := keep || public.parent_adult_add(reg.id, reg.event_id, main, 0);
  else
    if not public.parent_adult_matches(main, cur) then
      if cur.sent_to_office_at is not null then
        raise exception 'Please contact the school to change %''s name.', cur.full_name using errcode = 'P0001';
      end if;
      update parent_registration_adults
         set first_name = main ->> 'first_name', last_name = main ->> 'last_name',
             typed_name = case when (main ->> 'split')::boolean then main ->> 'typed_name' end,
             name_split_by_app = (main ->> 'split')::boolean, name_needs_check = (main ->> 'unsure')::boolean,
             name_confirmed_at = null, name_changed_at = now()
       where id = cur.id;
    end if;
    keep := keep || cur.id;
  end if;

  -- Everyone else, in the order given.
  for raw, i in select value, ordinality from jsonb_array_elements(p_other_adults) with ordinality loop
    e := public.parent_adult_entry(raw);
    m := null;
    if jsonb_typeof(e -> 'id') = 'string' and (e ->> 'id') ~* '^[0-9a-f-]{36}$' then
      select * into m from parent_registration_adults
       where id = (e ->> 'id')::uuid and registration_id = reg.id and position > 0 and id <> all (keep);
    end if;
    if m.id is null then
      select * into m from parent_registration_adults a
       where a.registration_id = reg.id and a.position > 0 and a.id <> all (keep) and public.parent_adult_matches(e, a)
       order by a.position limit 1;
    end if;
    if m.id is null then
      new_id := public.parent_adult_add(reg.id, reg.event_id, e, i::int);
      keep := keep || new_id;
    else
      if not public.parent_adult_matches(e, m) then
        if m.sent_to_office_at is not null then
          raise exception 'Please contact the school to change %''s name.', m.full_name using errcode = 'P0001';
        end if;
        update parent_registration_adults
           set first_name = e ->> 'first_name', last_name = e ->> 'last_name',
               typed_name = case when (e ->> 'split')::boolean then e ->> 'typed_name' end,
               name_split_by_app = (e ->> 'split')::boolean, name_needs_check = (e ->> 'unsure')::boolean,
               name_confirmed_at = null, name_changed_at = now()
         where id = m.id;
      end if;
      if m.position <> i then
        update parent_registration_adults set position = i::int where id = m.id;
      end if;
      keep := keep || m.id;
    end if;
  end loop;

  -- Adults left off the list.
  select * into m from parent_registration_adults
   where registration_id = reg.id and id <> all (keep) and sent_to_office_at is not null limit 1;
  if m.id is not null then
    raise exception 'Please contact the school to remove % from this registration.', m.full_name using errcode = 'P0001';
  end if;
  delete from parent_registration_adults where registration_id = reg.id and id <> all (keep);

  update parent_registrations
     set phone = nullif(trim(coalesce(p_phone, '')), ''),
         children = public.parent_children_clean(p_children),
         calendar_sequence = calendar_sequence + 1
   where id = reg.id;
  return reg.event_id;
end;
$$;

-- The parent's own link: cancel. Returns the event's id, or null if the link is unknown.
drop function if exists public.cancel_parent_registration(uuid);
create or replace function public.cancel_parent_registration(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  reg parent_registrations;
begin
  select * into reg from parent_registrations where access_token = p_token for update;
  if not found then
    return null;
  end if;
  if exists (select 1 from parent_registration_adults where registration_id = reg.id and sent_to_office_at is not null) then
    raise exception 'Please contact the school to cancel this registration.' using errcode = 'P0001';
  end if;
  delete from parent_registrations where id = reg.id;
  return reg.event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Downloads and the report: Hosts and Co-hosts only, built here (never from rows in the browser).
-- ---------------------------------------------------------------------------
-- What was downloaded or printed, by whom and when, and how many rows. No family names.
create table if not exists public.parent_list_downloads (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  kind        text not null check (kind in ('visitor_list', 'class_list', 'report_download', 'report_print')),
  by_user     uuid references public.profiles (id) on delete set null,
  by_name     text,
  row_count   integer not null default 0 check (row_count >= 0),
  at          timestamptz not null default now()
);
create index if not exists parent_list_downloads_event_idx on public.parent_list_downloads (event_id, kind, at desc);
alter table public.parent_list_downloads enable row level security;
revoke all on public.parent_list_downloads from anon, authenticated;
grant select on public.parent_list_downloads to authenticated;
grant select, insert, update, delete on public.parent_list_downloads to service_role;
drop policy if exists "parent downloads: hosts read" on public.parent_list_downloads;
create policy "parent downloads: hosts read" on public.parent_list_downloads
  for select to authenticated using (public.is_event_admin(event_id));

create or replace function public.record_parent_download(p_event uuid, p_kind text, p_rows integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_admin(p_event) then
    raise exception 'Only the event''s Hosts and Co-hosts can do that.' using errcode = '42501';
  end if;
  if p_kind in ('visitor_list', 'class_list') and not public.parent_data_kept(p_event) then
    raise exception 'Families'' details have been deleted.' using errcode = 'P0001';
  end if;
  insert into parent_list_downloads (event_id, kind, by_user, by_name, row_count)
  values (p_event, p_kind, auth.uid(), (select nullif(btrim(full_name), '') from profiles where id = auth.uid()),
          greatest(coalesce(p_rows, 0), 0));
end;
$$;

-- The visitor list for the school's visitor system: one row per adult per child. Email and phone only on the
-- registering adult's rows. is_new / name_changed: since the last visitor list download (false before the first).
create or replace function public.parent_visitor_list(p_event uuid)
returns table (adult_id uuid, registration_id uuid, adult_position integer, first_name text, last_name text,
               phone text, email text, registered_by text, child_name text, grade text, teacher text,
               name_needs_check boolean, is_new boolean, name_changed boolean)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  since timestamptz;
begin
  if not (public.is_event_admin(p_event) and public.parent_data_kept(p_event)) then
    raise exception 'Only the event''s Hosts and Co-hosts can download the visitor list.' using errcode = '42501';
  end if;
  select max(d.at) into since from parent_list_downloads d where d.event_id = p_event and d.kind = 'visitor_list';
  return query
  select a.id, a.registration_id, a.position::int, a.first_name, a.last_name,
         case when a.position = 0 then r.phone end, case when a.position = 0 then r.email::text end,
         r.parent_name, k ->> 'name', k ->> 'grade', k ->> 'teacher',
         a.name_needs_check,
         since is not null and a.added_at > since,
         since is not null and a.added_at <= since and coalesce(a.name_changed_at, '-infinity') > since
    from parent_registration_adults a
    join parent_registrations r on r.id = a.registration_id
    cross join lateral jsonb_array_elements(r.children) k
   where a.event_id = p_event
   order by lower(a.last_name), lower(a.first_name), a.registration_id, a.position, k ->> 'name';
end;
$$;

-- For Parent Registration's top card: the last visitor list download, and what's new or corrected since.
create or replace function public.parent_visitor_list_status(p_event uuid)
returns table (last_at timestamptz, last_by_name text, last_rows integer, adults integer, new_adults integer,
               changed_adults integer, names_to_check integer)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  d parent_list_downloads;
begin
  if not (public.is_event_admin(p_event) and public.parent_data_kept(p_event)) then
    raise exception 'Only the event''s Hosts and Co-hosts can see this.' using errcode = '42501';
  end if;
  select * into d from parent_list_downloads x where x.event_id = p_event and x.kind = 'visitor_list' order by x.at desc limit 1;
  return query
  select d.at, coalesce(nullif(btrim(p.full_name), ''), d.by_name), d.row_count,
         count(a.id)::int,
         count(a.id) filter (where a.added_at > coalesce(d.at, '-infinity'))::int,
         count(a.id) filter (where d.at is not null and a.added_at <= d.at and coalesce(a.name_changed_at, '-infinity') > d.at)::int,
         count(a.id) filter (where a.name_needs_check)::int
    from (select 1) one
    left join parent_registration_adults a on a.event_id = p_event
    left join profiles p on p.id = d.by_user
   group by d.at, p.full_name, d.by_name, d.row_count;
end;
$$;

-- The visitor check-in report: one row per adult. status: not_yet, front_office, or checked_in (practice check-ins
-- don't count once the event starts).
create or replace function public.parent_check_in_report(p_event uuid)
returns table (adult_id uuid, registration_id uuid, adult_position integer, first_name text, last_name text,
               full_name text, typed_name text, name_needs_check boolean, registered_by text, children jsonb,
               status text, checked_in_at timestamptz, checked_in_by_name text, sent_to_office_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.is_event_admin(p_event) and public.parent_data_kept(p_event)) then
    raise exception 'Only the event''s Hosts and Co-hosts can see the visitor check-in report.' using errcode = '42501';
  end if;
  return query
  select a.id, a.registration_id, a.position::int, a.first_name, a.last_name, a.full_name,
         case when a.name_needs_check then a.typed_name end, a.name_needs_check, r.parent_name, r.children,
         case when a.sent_to_office_at is not null then 'front_office'
              when public.parent_check_in_counts(a.checked_in_at, e.timezone, e.starts_on) then 'checked_in'
              else 'not_yet' end,
         case when a.sent_to_office_at is null and public.parent_check_in_counts(a.checked_in_at, e.timezone, e.starts_on)
              then a.checked_in_at end,
         case when a.sent_to_office_at is null and public.parent_check_in_counts(a.checked_in_at, e.timezone, e.starts_on)
              then a.checked_in_by_name end,
         a.sent_to_office_at
    from parent_registration_adults a
    join parent_registrations r on r.id = a.registration_id
    join events e on e.id = a.event_id
   where a.event_id = p_event
   order by lower(a.last_name), lower(a.first_name), a.registration_id, a.position;
end;
$$;

-- Names-free totals kept when families' details are deleted, so the report can say what happened.
create table if not exists public.parent_event_totals (
  event_id       uuid primary key references public.events (id) on delete cascade,
  families       integer not null default 0,
  adults         integer not null default 0,
  children       integer not null default 0,
  checked_in     integer not null default 0,
  sent_to_office integer not null default 0,
  deleted_at     timestamptz not null default now()
);
alter table public.parent_event_totals enable row level security;
revoke all on public.parent_event_totals from anon, authenticated;
grant select on public.parent_event_totals to authenticated;
grant select, insert, update, delete on public.parent_event_totals to service_role;
drop policy if exists "parent totals: hosts read" on public.parent_event_totals;
create policy "parent totals: hosts read" on public.parent_event_totals
  for select to authenticated using (public.is_event_admin(event_id));

-- The report's numbers and state, live, final, or deleted (from the totals). Hosts and Co-hosts.
-- deleted: families' details are gone (families is null when they went before totals were kept).
-- saved_*: the last time someone printed or downloaded the report.
create or replace function public.parent_check_in_summary(p_event uuid)
returns table (families integer, adults integer, children integer, checked_in integer, sent_to_office integer,
               not_checked_in integer, today date, is_event_day boolean, is_final boolean, kept boolean, deleted boolean,
               delete_on date, deleted_at timestamptz, saved_at timestamptz, saved_by_name text, saved_kind text)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  ev    events;
  t     parent_event_totals;
  d     parent_list_downloads;
  day   date;
  keep  boolean;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'Only the event''s Hosts and Co-hosts can see the visitor check-in report.' using errcode = '42501';
  end if;
  select * into ev from events where id = p_event;
  day := (now() at time zone ev.timezone)::date;
  keep := public.parent_data_kept(p_event);
  select * into t from parent_event_totals x where x.event_id = p_event;
  select * into d from parent_list_downloads x
   where x.event_id = p_event and x.kind in ('report_download', 'report_print') order by x.at desc limit 1;
  if keep then
    return query
    select (select count(*)::int from parent_registrations r where r.event_id = p_event),
           count(a.id)::int,
           (select coalesce(sum(jsonb_array_length(r.children)), 0)::int from parent_registrations r where r.event_id = p_event),
           count(a.id) filter (where a.sent_to_office_at is null
                                 and public.parent_check_in_counts(a.checked_in_at, ev.timezone, ev.starts_on))::int,
           count(a.id) filter (where a.sent_to_office_at is not null)::int,
           count(a.id) filter (where a.sent_to_office_at is null
                                 and not public.parent_check_in_counts(a.checked_in_at, ev.timezone, ev.starts_on))::int,
           day, day between ev.starts_on and ev.ends_on, day > ev.ends_on, true, false,
           ev.ends_on + 31, null::timestamptz,
           d.at, coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = d.by_user), d.by_name), d.kind
      from (select 1) one
      left join parent_registration_adults a on a.event_id = p_event;
  else
    return query
    select t.families, t.adults, t.children, t.checked_in, t.sent_to_office,
           case when t.event_id is not null then t.adults - t.checked_in - t.sent_to_office end,
           day, false, true, false, true, ev.ends_on + 31, t.deleted_at,
           d.at, coalesce((select nullif(btrim(p.full_name), '') from profiles p where p.id = d.by_user), d.by_name), d.kind;
  end if;
end;
$$;

-- Erase registrations 30 days after their event ended (event's time zone), first saving names-free totals.
-- Returns how many registrations were erased.
create or replace function public.purge_parent_registrations()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  insert into parent_event_totals (event_id, families, adults, children, checked_in, sent_to_office, deleted_at)
  select e.id,
         (select count(*) from parent_registrations r where r.event_id = e.id),
         (select count(*) from parent_registration_adults a where a.event_id = e.id),
         (select coalesce(sum(jsonb_array_length(r.children)), 0) from parent_registrations r where r.event_id = e.id),
         (select count(*) from parent_registration_adults a where a.event_id = e.id and a.sent_to_office_at is null
             and public.parent_check_in_counts(a.checked_in_at, e.timezone, e.starts_on)),
         (select count(*) from parent_registration_adults a where a.event_id = e.id and a.sent_to_office_at is not null),
         now()
    from events e
   where e.event_type::text = 'school_visit'
     and (now() at time zone e.timezone)::date > e.ends_on + 30
     -- Events whose details went before totals were kept get none (rather than a misleading zero).
     and ((now() at time zone e.timezone)::date <= e.ends_on + 45
          or exists (select 1 from parent_registrations r where r.event_id = e.id))
  on conflict (event_id) do nothing;

  with gone as (
    delete from parent_registrations r using events e
     where e.id = r.event_id and (now() at time zone e.timezone)::date > e.ends_on + 30
    returning 1
  )
  select count(*)::int into n from gone;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The report emails (the daily job, after the clean-up): "already sent" markers.
--   morning_after:   the day after the event, to the Account Host and Co-hosts of every event
--   cohost_access:   about day 7, to Co-hosts of just this event (their access ends day 10)
--   before_deletion: a week before deletion, to the Account Host and Co-hosts of every event, always
-- ---------------------------------------------------------------------------
create table if not exists public.parent_report_emails (
  event_id uuid not null references public.events (id) on delete cascade,
  kind     text not null check (kind in ('morning_after', 'cohost_access', 'before_deletion')),
  sent_at  timestamptz not null default now(),
  primary key (event_id, kind)
);
alter table public.parent_report_emails enable row level security;
revoke all on public.parent_report_emails from anon, authenticated;
grant select, insert, update, delete on public.parent_report_emails to service_role;

-- Which report emails are due today (only events someone registered for, not yet sent, details still kept).
-- saved: someone printed or downloaded the report (the last email is gentler then).
create or replace function public.parent_report_emails_due()
returns table (event_id uuid, kind text, families integer, saved boolean, access_ends_on date, delete_on date)
language sql stable security definer set search_path = public
as $$
  with ev as (
    select e.*, (now() at time zone e.timezone)::date as today,
           (select count(*)::int from parent_registrations r where r.event_id = e.id) as families,
           exists (select 1 from parent_list_downloads d where d.event_id = e.id
                    and d.kind in ('report_download', 'report_print')) as saved
      from events e
     where e.event_type::text = 'school_visit' and e.status = 'published'
  ), due as (
    select ev.id, 'morning_after'::text as kind, ev.families, ev.saved, ev.ends_on from ev
     where ev.today between ev.ends_on + 1 and ev.ends_on + 30
    union all
    select ev.id, 'cohost_access', ev.families, ev.saved, ev.ends_on from ev
     where ev.today between ev.ends_on + 7 and ev.ends_on + 10
       and exists (select 1 from event_staff s where s.event_id = ev.id and s.role::text = 'co_host')
    union all
    select ev.id, 'before_deletion', ev.families, ev.saved, ev.ends_on from ev
     where ev.today between ev.ends_on + 23 and ev.ends_on + 30
  )
  select due.id, due.kind, due.families, due.saved, due.ends_on + 10, due.ends_on + 31
    from due
   where due.families > 0
     and not exists (select 1 from parent_report_emails m where m.event_id = due.id and m.kind = due.kind);
$$;

-- ---------------------------------------------------------------------------
-- Demo mode: 400 made-up families on a school visit (family 1 is Cleave Treanor, at the owner's request), now as
-- adult records. A few type their whole name with a two-word last name, so "names to check" can be tried.
-- ---------------------------------------------------------------------------
create or replace function public.demo_seed(p_owner uuid, p_event uuid, p_director uuid)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  ev        public.events;
  kind      text;
  base      timestamptz;
  st_names  text[];
  zones     text[] := array[null, null, null];
  st_id     uuid;
  sh_ids    uuid[] := '{}';
  sh_id     uuid;
  vol_id    uuid;
  guardian  uuid;
  i         int;
  people    text[] := array['Maria Lopez', 'James Carter', 'Priya Patel', 'Tom Nguyen', 'Angela Brooks', 'David Kim',
                            'Rachel Green', 'Marcus Johnson', 'Linda Alvarez', 'Chris Walker', 'Sofia Rossi', 'Ben Taylor'];
  schools   text[] := array['Cedar Ridge High School', 'Lakeview High School', 'Summit High School',
                            'Riverside High School', 'Oak Hollow High School', 'Westfield High School'];
  groups    text[] := array['Cedar Ridge Varsity Choir', 'Lakeview Chamber Singers', 'Summit Treble Choir',
                            'Riverside Orchestra', 'Oak Hollow Jazz Choir'];
  bandnames text[] := array['Cedar Ridge Marching Band', 'Lakeview Regiment', 'Summit Spirit of Gold',
                            'Riverside Pride', 'Oak Hollow Thunder', 'Westfield Blue Brigade'];
  slug      text;
  -- Made-up families for school visits (first names, family names, children, and a teacher per class).
  adult_names    text[] := array['Maria', 'James', 'Priya', 'Tom', 'Angela', 'David', 'Rachel', 'Marcus', 'Linda', 'Chris',
                                 'Sofia', 'Ben', 'Keisha', 'Omar', 'Hannah', 'Luis', 'Grace', 'Andre', 'Mei', 'Jason',
                                 'Fatima', 'Ryan', 'Nicole', 'Hector', 'Erin', 'Samuel', 'Tanya', 'Kevin', 'Leah', 'Diego',
                                 'Amara', 'Paul', 'Jenna', 'Victor', 'Monica', 'Aaron', 'Yesenia', 'Derek', 'Laura', 'Imran'];
  last_names     text[] := array['Lopez', 'Carter', 'Patel', 'Nguyen', 'Brooks', 'Kim', 'Green', 'Johnson', 'Alvarez', 'Walker',
                                 'Rossi', 'Taylor', 'Okafor', 'Haddad', 'Schmidt', 'Ramirez', 'Chen', 'Dubois', 'Washington', 'Murphy',
                                 'Singh', 'Castillo', 'Bennett', 'Yamamoto', 'Morales', 'Fischer', 'Adeyemi', 'Sullivan', 'Park', 'Reyes',
                                 'Hughes', 'Novak', 'Ortiz', 'Lindqvist', 'Mensah', 'Coleman', 'Vargas', 'Ibrahim', 'Foster', 'Tran',
                                 'Delgado', 'Whitaker', 'Romero', 'Kowalski', 'Bishop', 'Navarro', 'Holt', 'Abernathy', 'Quinn', 'Salazar'];
  -- Two-word family names, typed in one box (split by the app and marked to check).
  compound_names text[] := array['Van Dyke', 'García López', 'De la Cruz', 'Da Silva', 'Von Berg', 'Del Toro', 'Le Blanc', 'Ter Horst'];
  kid_names      text[] := array['Ava', 'Liam', 'Mia', 'Noah', 'Zoe', 'Eli', 'Chloe', 'Mateo', 'Lily', 'Owen',
                                 'Aria', 'Lucas', 'Nora', 'Jayden', 'Ella', 'Leo', 'Maya', 'Caleb', 'Ruby', 'Isaac',
                                 'Layla', 'Ezra', 'Hazel', 'Miles', 'Ivy', 'Jonah', 'Stella', 'Kai', 'Naomi', 'Gabe',
                                 'Aisha', 'Theo', 'Luna', 'Adrian', 'Willow', 'Felix', 'Camila', 'Rowan', 'Esme', 'Malik'];
  teachers       text[] := array['Smith', 'Garcia', 'Lee', 'Brown', 'Martinez', 'Wilson', 'Anderson',
                                 'Thomas', 'Moore', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis'];
  teacher_grades text[] := array['Pre-K', 'K', 'K', '1st', '1st', '2nd', '2nd',
                                 '3rd', '3rd', '4th', '4th', '5th', '5th', '5th'];
  fam            text;
  first          text;
  kids           jsonb;
  k              int;
  t              int;
  new_id    uuid;
begin
  if not exists (select 1 from demo_events where owner_id = p_owner and event_id = p_event) then
    raise exception 'Demo mode is not on for this event' using errcode = 'P0001';
  end if;
  if exists (select 1 from demo_samples where owner_id = p_owner and event_id = p_event) then
    return;
  end if;
  select * into ev from events where id = p_event;
  kind := ev.event_type::text;
  base := ev.window_start;

  -- A teacher's conference (or someone's meetings) has no volunteers: it gets sample bookings instead.
  if kind in ('conference', 'meeting') then
    perform public.demo_seed_conference(p_owner, p_event);
    return;
  end if;

  -- Stations and shifts.
  st_names := case kind
    when 'fair' then array['Ticket Booth', 'Face Painting', 'Bake Sale']
    when 'band_contest' then array['Parking', 'Concessions', 'Hospitality']
    when 'group_event' then array['Welcome Table', 'Room Monitors', 'Concessions']
    when 'school_visit' then array['Front Door Check-in', 'Hallway Guides', 'Cafeteria Helpers']
    else array['Parking', 'Concessions', 'Setup & Cleanup'] end;
  if kind = 'fair' then
    zones := array['Game Zone', 'Activity Stations', 'Marketplace'];
  end if;
  for i in 1..3 loop
    insert into stations (event_id, name, location, instructions, sort_order, zone)
    values (p_event, st_names[i], 'Sample location ' || i, 'Sample instructions: check in at the volunteer desk first.',
            100 + i, zones[i])
    returning id into st_id;
    insert into demo_samples values (p_owner, p_event, 'station', st_id);
    insert into shifts (station_id, event_id, title, starts_at, ends_at, max_capacity)
    values (st_id, p_event, 'Morning', base, base + interval '2 hours', 4)
    returning id into sh_id;
    sh_ids := sh_ids || sh_id;
    insert into shifts (station_id, event_id, title, starts_at, ends_at, max_capacity)
    values (st_id, p_event, 'Afternoon', base + interval '2 hours', base + interval '4 hours', 4)
    returning id into sh_id;
    sh_ids := sh_ids || sh_id;
  end loop;

  -- Volunteers: one per shift slot, round-robin, plus two students with a parent.
  for i in 1..array_length(people, 1) loop
    insert into volunteers (event_id, full_name, email, phone)
    values (p_event, people[i],
            'sample-' || replace(lower(people[i]), ' ', '.') || '@demo.fieldcommandevents.com',
            '+1512555' || lpad((100 + i)::text, 4, '0'))
    returning id into vol_id;
    insert into demo_samples values (p_owner, p_event, 'volunteer', vol_id);
    sh_id := sh_ids[1 + (i - 1) % array_length(sh_ids, 1)];
    insert into volunteer_assignments (shift_id, volunteer_id) values (sh_id, vol_id);
    update shifts set registered_count = registered_count + 1 where id = sh_id;
    if i = 1 then guardian := vol_id; end if;
  end loop;
  foreach slug in array array['Emma L.', 'Noah L.'] loop
    insert into volunteers (event_id, full_name, email, phone, minor, contact_id)
    values (p_event, slug, null, '+15125550101', true, guardian)
    returning id into vol_id;
    insert into demo_samples values (p_owner, p_event, 'volunteer', vol_id);
    insert into volunteer_assignments (shift_id, volunteer_id) values (sh_ids[1], vol_id);
    update shifts set registered_count = registered_count + 1,
                      max_capacity = greatest(max_capacity, registered_count + 1)
     where id = sh_ids[1];
  end loop;

  -- Bands (band contests) or groups (group events).
  if kind in ('band_contest', 'group_event') and p_director is not null and cardinality(ev.classifications) > 0 then
    for i in 1..(case when kind = 'band_contest' then 6 else 5 end) loop
      insert into bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                         contact_email, head_director_name, head_director_email, head_director_phone,
                         student_count, chaperone_count, bus_count, box_truck_count)
      values (p_event, p_director, schools[i],
              case when kind = 'band_contest' then bandnames[i] else groups[i] end,
              ev.classifications[1 + (i - 1) % cardinality(ev.classifications)],
              (100 * i) || ' School Way',
              'sample-director' || i || '@demo.fieldcommandevents.com', people[i],
              'sample-director' || i || '@demo.fieldcommandevents.com', '+1512555' || lpad((200 + i)::text, 4, '0'),
              30 + 15 * i, least(2 + i % 3, ev.chaperone_limit),
              case when kind = 'band_contest' then 2 else 1 end, case when kind = 'band_contest' then 1 else 0 end)
      returning id into new_id;
      insert into demo_samples values (p_owner, p_event, 'band', new_id);
    end loop;
  end if;

  -- Rooms (group events without any yet).
  if kind = 'group_event' and not exists (select 1 from rooms where event_id = p_event) then
    for i in 1..3 loop
      insert into rooms (event_id, name, note, path_order, minutes)
      values (p_event, (array['Performance Hall', 'Clinic Room', 'Sight-Reading'])[i],
              (array['Main stage', 'Room 112', 'Library'])[i], i, (array[20, 20, 15])[i])
      returning id into new_id;
      insert into demo_samples values (p_owner, p_event, 'room', new_id);
    end loop;
  end if;

  -- Parent registrations (school visitor events): 400 made-up families, so lists, search, counts, and check-in
  -- can be tried at a real school's size. Names are mixed from the lists below; every email is a demo address.
  if kind = 'school_visit' then
    for i in 1..400 loop
      -- Family 1 is the owner's own name, to demo checking a driver's license against the list (owner's request).
      fam := case when i = 1 then 'Treanor'
                  when i % 50 = 7 then compound_names[1 + (i / 50) % array_length(compound_names, 1)]
                  else last_names[1 + (i * 7) % array_length(last_names, 1)] end;
      first := case when i = 1 then 'Cleave' else adult_names[1 + (i * 13 + i / 50) % array_length(adult_names, 1)] end;
      kids := '[]'::jsonb;
      -- 6 in 10 families have one child here, 3 in 10 have two, 1 in 10 has three.
      for k in 1..(case when i % 10 < 6 then 1 when i % 10 < 9 then 2 else 3 end) loop
        t := 1 + (i * 5 + k * 3) % array_length(teachers, 1);
        kids := kids || jsonb_build_array(jsonb_build_object(
          'name', kid_names[1 + (i * 11 + k * 17) % array_length(kid_names, 1)] || ' ' || fam,
          'teacher', teachers[t],
          'grade', teacher_grades[t]));
      end loop;
      insert into parent_registrations (event_id, parent_name, email, phone, children, adult_count)
      values (p_event, first || ' ' || fam,
              'sample-parent' || i || '@demo.fieldcommandevents.com',
              '+1512555' || lpad(i::text, 4, '0'),
              kids,
              case when i % 20 = 0 then 3 when i % 5 = 0 then 2 else 1 end)
      returning id into new_id;
      insert into demo_samples values (p_owner, p_event, 'parent', new_id);
      -- The registering adult: First and Last, except the two-word family names, typed in one box.
      perform public.parent_adult_add(new_id, p_event,
                case when i % 50 = 7 then public.parent_adult_entry(to_jsonb(first || ' ' || fam))
                     else public.parent_adult_entry(jsonb_build_object('first_name', first, 'last_name', fam)) end, 0);
      -- About 1 in 5 brings another adult (a grandparent, say); 1 in 20 brings two (each with a different first name).
      if i % 5 = 0 then
        perform public.parent_adult_add(new_id, p_event, public.parent_adult_entry(jsonb_build_object(
                  'first_name', adult_names[1 + (i * 3 + 9) % array_length(adult_names, 1)], 'last_name', fam)), 1);
      end if;
      if i % 20 = 0 then
        perform public.parent_adult_add(new_id, p_event, public.parent_adult_entry(jsonb_build_object(
                  'first_name', adult_names[1 + (i * 19 + 10) % array_length(adult_names, 1)], 'last_name', fam)), 2);
      end if;
    end loop;
  end if;

  -- Booths (school fairs).
  if kind = 'fair' then
    for i in 1..8 loop
      insert into fair_booths (event_id, title, host_name, zone, location, description,
                               contact_name, contact_email, contact_phone, show_publicly, arrived_at)
      values (p_event,
              (array['Dunk Tank', 'Ring Toss', 'Face Painting', 'Hair Tinsel', 'Bake Sale', '3D-Printed Treasures',
                     'Student Art Show', 'Robotics Demo'])[i],
              (array['Brightwater Wireless', 'Rotary Club', 'City Church youth', 'Varsity Cheer', 'PTO', 'Maker Mom Co.',
                     null, 'Robotics Club'])[i],
              (array['Game Zone', 'Game Zone', 'Activity Stations', 'Activity Stations', 'Marketplace', 'Marketplace',
                     'Showcase', 'Showcase'])[i],
              'Sample spot ' || i,
              (array[null, null, null, null, 'Cookies, brownies and cupcakes', 'Keychains, fidgets and toys',
                     'Artwork from every grade', 'Watch the robots compete'])[i],
              people[i], 'sample-partner' || i || '@demo.fieldcommandevents.com',
              '+1512555' || lpad((400 + i)::text, 4, '0'), true,
              case when i <= 2 then now() end)
      returning id into new_id;
      insert into demo_samples values (p_owner, p_event, 'booth', new_id);
    end loop;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Function access.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.split_person_name(text), public.parent_adult_entry(jsonb), public.parent_main_adult(text, text, text),
  public.parent_children_clean(jsonb), public.parent_registration_check(jsonb, jsonb),
  public.parent_adult_add(uuid, uuid, jsonb, integer),
  public.parent_adult_matches(jsonb, public.parent_registration_adults),
  public.parent_door_window(uuid), public.parent_families_visible(uuid), public.parent_registration_emails(uuid),
  public.parent_check_in_counts(timestamptz, text, date), public.clear_practice_parent_check_ins(uuid),
  public.set_parent_adult_checked_in(uuid, boolean), public.set_parent_adult_front_office(uuid, boolean),
  public.set_parent_adult_name(uuid, text, text),
  public.register_parents(uuid, text, text, text, jsonb, jsonb, text, text),
  public.import_parent_registration(uuid, text, text, text, jsonb, jsonb, text, text),
  public.update_parent_registration(uuid, text, text, jsonb, jsonb, text, text),
  public.cancel_parent_registration(uuid),
  public.record_parent_download(uuid, text, integer), public.parent_visitor_list(uuid), public.parent_visitor_list_status(uuid),
  public.parent_check_in_report(uuid), public.parent_check_in_summary(uuid),
  public.clear_all_practice_parent_check_ins(), public.purge_parent_registrations(), public.parent_report_emails_due()
  from public, anon, authenticated;

grant execute on function
  public.parent_door_window(uuid), public.parent_families_visible(uuid), public.parent_registration_emails(uuid),
  public.parent_check_in_counts(timestamptz, text, date), public.clear_practice_parent_check_ins(uuid),
  public.set_parent_adult_checked_in(uuid, boolean), public.set_parent_adult_front_office(uuid, boolean),
  public.set_parent_adult_name(uuid, text, text),
  public.import_parent_registration(uuid, text, text, text, jsonb, jsonb, text, text),
  public.record_parent_download(uuid, text, integer), public.parent_visitor_list(uuid), public.parent_visitor_list_status(uuid),
  public.parent_check_in_report(uuid), public.parent_check_in_summary(uuid)
  to authenticated;

grant execute on function
  public.split_person_name(text), public.clear_all_practice_parent_check_ins(),
  public.register_parents(uuid, text, text, text, jsonb, jsonb, text, text),
  public.update_parent_registration(uuid, text, text, jsonb, jsonb, text, text),
  public.cancel_parent_registration(uuid), public.purge_parent_registrations(), public.parent_report_emails_due()
  to service_role;
