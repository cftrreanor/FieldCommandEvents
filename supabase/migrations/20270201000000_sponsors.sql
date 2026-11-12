-- =============================================================================
-- Sponsors add-on (owner, 2026-11-12; docs/design-decisions/2026-11-12-sponsors.md).
--
--   * An add-on a platform admin switches on per account (organizations.sponsors_on), only through
--     admin_set_sponsors (checks is_platform_admin, writes admin_log). sponsors_enabled(org) tells the app.
--   * Organizers of band contests, festivals (group_event), and school fairs thank their own sponsors: up to 4
--     named, ordered levels per event, and sponsors with a logo, website, level, place, "Show on the public
--     page", one "Presented by" per event, Remove with Undo (removed_at), and copied_from for reuse.
--   * Writes only through the functions below: each checks is_event_admin(event), that the add-on is on, and
--     the event's kind. Organizers read through RLS (is_event_admin), whether or not the add-on is on (with
--     it off they're told their sponsors are kept). The public reads only through public_sponsors(slug):
--     published, add-on on, shown, not removed (an event's hosts may preview a draft).
--   * Logos live in the private sponsor-logos bucket, served by our own route only when public_sponsors would
--     show them. Uploads land in uploads/<event>/..., are checked and resized on our server, and are stored as
--     <org>/<event>/<version>/master.(png|jpg) plus a copy per tile size (t0, t1, t2) beside it.
--   * Copying last year's contest or festival copies no sponsors (copy_band_contest_setup and
--     copy_group_event_setup never touch these tables); the Sponsors page offers reuse_sponsors instead.
--   * Cleanup (daily job): removed sponsors are deleted after a day; files no sponsor points to (removed,
--     replaced, deleted events, closed accounts, abandoned uploads) are listed by sponsor_logo_orphans; sponsors
--     whose logo file is missing are set to show by name (clear_missing_sponsor_logos).
--
-- Safe to run twice.
-- =============================================================================

-- 1. The switch ---------------------------------------------------------------------------------------------
alter table public.organizations add column if not exists sponsors_on boolean not null default false;
alter table public.organizations add column if not exists sponsors_on_since timestamptz;
alter table public.organizations add column if not exists sponsors_on_by uuid references public.profiles (id) on delete set null;
-- Hosts update only (name, default_timezone) on organizations (core schema), so these stay admin-only.

-- Whether an account has the add-on (inside other functions; no grant to people).
create or replace function public.org_sponsors_on(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select sponsors_on from organizations where id = p_org), false) $$;
revoke execute on function public.org_sponsors_on(uuid) from public, anon, authenticated;
grant execute on function public.org_sponsors_on(uuid) to service_role;

-- For the app: is the add-on on for this account? Its hosts, anyone who runs one of its events, and platform
-- admins get the answer; anyone else gets false.
create or replace function public.sponsors_enabled(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.org_sponsors_on(p_org) and (
    public.is_org_admin(p_org) or public.is_platform_admin()
    or exists (select 1 from events ev where ev.organization_id = p_org and public.is_event_admin(ev.id))
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
  )
$$;
revoke execute on function public.sponsors_enabled(uuid) from public, anon;
grant execute on function public.sponsors_enabled(uuid) to authenticated, service_role;

-- Turn the add-on on or off for an account. Turning it off keeps every sponsor; nothing shows publicly.
create or replace function public.admin_set_sponsors(p_org uuid, p_on boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  was boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can turn Sponsors on or off.' using errcode = '42501';
  end if;
  select sponsors_on into was from organizations where id = p_org for update;
  if not found then
    raise exception 'That account doesn''t exist.' using errcode = 'P0002';
  end if;
  if was = p_on then
    return;
  end if;
  update organizations
     set sponsors_on = p_on,
         sponsors_on_since = case when p_on then now() else null end,
         sponsors_on_by = case when p_on then auth.uid() else null end
   where id = p_org;
  insert into admin_log (admin_id, action, organization_id, details)
  values (auth.uid(), case when p_on then 'sponsors_turned_on' else 'sponsors_turned_off' end, p_org,
          jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;
revoke execute on function public.admin_set_sponsors(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_sponsors(uuid, boolean, text) to authenticated;

-- 2. Levels and sponsors -----------------------------------------------------------------------------------
create table if not exists public.sponsor_levels (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  name        text not null constraint sponsor_levels_name_length check (char_length(btrim(name)) between 1 and 40),
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists sponsor_levels_event_idx on public.sponsor_levels (event_id, position);

create table if not exists public.sponsors (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  -- Null only while the event has no levels (everyone shows at the same size).
  level_id      uuid references public.sponsor_levels (id) on delete restrict,
  name          text not null constraint sponsors_name_length check (char_length(btrim(name)) between 1 and 100),
  -- The master file; each tile size sits beside it (t0, t1, t2) with the same extension.
  logo_path     text constraint sponsors_logo_path_shape check (
                  logo_path is null or logo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/master\.(png|jpg)$'),
  -- The uploaded image's real size (after turning it upright), for the warnings and the tiles' shape.
  logo_width    integer constraint sponsors_logo_width check (logo_width is null or logo_width between 1 and 100000),
  logo_height   integer constraint sponsors_logo_height check (logo_height is null or logo_height between 1 and 100000),
  website       text constraint sponsors_website_safe check (
                  website is null or (website ~ '^https://[^[:space:]/?#@]+\.[^[:space:]]*$' and char_length(website) <= 300)),
  position      integer not null default 0,
  show_public   boolean not null default true,
  presented_by  boolean not null default false,
  removed_at    timestamptz,
  copied_from   uuid references public.sponsors (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sponsors_logo_size_with_path check ((logo_path is null) = (logo_width is null) and (logo_path is null) = (logo_height is null))
);
create index if not exists sponsors_event_idx on public.sponsors (event_id, level_id, position);
create index if not exists sponsors_removed_idx on public.sponsors (removed_at) where removed_at is not null;
create index if not exists sponsors_copied_from_idx on public.sponsors (copied_from) where copied_from is not null;
-- One Presented by per event (removed sponsors don't count; Undo gives it back only if it's still free).
create unique index if not exists sponsors_one_presented_by on public.sponsors (event_id) where presented_by and removed_at is null;

alter table public.sponsor_levels enable row level security;
alter table public.sponsors enable row level security;
revoke all on public.sponsor_levels from anon, authenticated;
revoke all on public.sponsors from anon, authenticated;
grant select on public.sponsor_levels to authenticated;
grant select on public.sponsors to authenticated;
grant select, insert, update, delete on public.sponsor_levels to service_role;
grant select, insert, update, delete on public.sponsors to service_role;

drop policy if exists "sponsor levels: event hosts read" on public.sponsor_levels;
create policy "sponsor levels: event hosts read" on public.sponsor_levels
  for select to authenticated using (public.is_event_admin(event_id));
drop policy if exists "sponsors: event hosts read" on public.sponsors;
create policy "sponsors: event hosts read" on public.sponsors
  for select to authenticated using (public.is_event_admin(event_id));

-- 3. Helpers ----------------------------------------------------------------------------------------------
-- Comparing names for duplicates: lower case, letters and digits only ("Cedar Music Co." = "cedar music co").
create or replace function public.sponsor_name_key(p_name text)
returns text
language sql immutable
as $$ select regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '', 'g') $$;

-- The event, locked for this change, if the person may change its sponsors. Every write starts here.
create or replace function public.sponsor_event_for_change(p_event uuid)
returns public.events
language plpgsql security definer set search_path = public
as $$
declare
  e public.events;
begin
  select * into e from events where id = p_event for update;
  if e.id is null or not public.is_event_admin(p_event) then
    raise exception 'Only the event''s hosts can change its sponsors.' using errcode = '42501';
  end if;
  if e.event_type::text not in ('band_contest', 'group_event', 'fair') then
    raise exception 'Sponsors are for band contests, festivals, and school fairs.' using errcode = 'P0001';
  end if;
  if not public.org_sponsors_on(e.organization_id) then
    raise exception 'Sponsors are off for this account, so they can''t be changed.' using errcode = 'P0001';
  end if;
  return e;
end;
$$;
revoke execute on function public.sponsor_event_for_change(uuid) from public, anon, authenticated;

-- Number a level's sponsors (not removed) 1, 2, 3 … in their order.
create or replace function public.renumber_sponsors(p_event uuid, p_level uuid)
returns void
language sql security definer set search_path = public
as $$
  update sponsors s set position = o.n
    from (select id, row_number() over (order by position, created_at, id) as n
            from sponsors where event_id = p_event and level_id is not distinct from p_level and removed_at is null) o
   where s.id = o.id and s.position <> o.n;
$$;
revoke execute on function public.renumber_sponsors(uuid, uuid) from public, anon, authenticated;

create or replace function public.renumber_sponsor_levels(p_event uuid)
returns void
language sql security definer set search_path = public
as $$
  update sponsor_levels l set position = o.n
    from (select id, row_number() over (order by position, created_at, id) as n from sponsor_levels where event_id = p_event) o
   where l.id = o.id and l.position <> o.n;
$$;
revoke execute on function public.renumber_sponsor_levels(uuid) from public, anon, authenticated;

-- A new level at the end (at most 4). The first level takes every sponsor that had none.
create or replace function public.add_sponsor_level_internal(p_event uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  n int;
  new_id uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Name the level.' using errcode = 'P0001';
  end if;
  if exists (select 1 from sponsor_levels where event_id = p_event and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'There''s already a level called %.', btrim(p_name) using errcode = 'P0001';
  end if;
  select count(*) into n from sponsor_levels where event_id = p_event;
  if n >= 4 then
    raise exception '4 levels is the most. Remove one to add another.' using errcode = 'P0001';
  end if;
  insert into sponsor_levels (event_id, name, position) values (p_event, btrim(p_name), n + 1) returning id into new_id;
  if n = 0 then
    update sponsors set level_id = new_id where event_id = p_event and level_id is null;
  end if;
  return new_id;
end;
$$;
revoke execute on function public.add_sponsor_level_internal(uuid, text) from public, anon, authenticated;

-- "contest", "festival", or "fair", for messages people read.
create or replace function public.sponsor_kind_word(p_type text)
returns text
language sql immutable
as $$ select case p_type when 'band_contest' then 'contest' when 'group_event' then 'festival' when 'fair' then 'fair' else 'event' end $$;

-- 4. Sponsors ---------------------------------------------------------------------------------------------
-- Add (p_sponsor null) or edit a sponsor. p_level is one of the event's levels; with p_new_level_name a new
-- level is made at the end and used (the first level also takes everyone who had none). With levels, a
-- sponsor needs one; without, it has none. The logo: a new p_logo_path (from prepare/process upload) replaces
-- it, p_clear_logo removes it, otherwise it stays. Presented by replaces whoever had it.
create or replace function public.save_sponsor(
  p_event uuid,
  p_sponsor uuid,
  p_name text,
  p_level uuid default null,
  p_new_level_name text default null,
  p_website text default null,
  p_logo_path text default null,
  p_logo_width integer default null,
  p_logo_height integer default null,
  p_clear_logo boolean default false,
  p_show boolean default true,
  p_presented_by boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  e public.events;
  cur public.sponsors;
  lvl uuid := p_level;
  has_levels boolean;
  new_id uuid;
begin
  e := public.sponsor_event_for_change(p_event);
  if p_sponsor is not null then
    select * into cur from sponsors where id = p_sponsor and event_id = p_event and removed_at is null for update;
    if cur.id is null then
      raise exception 'That sponsor was removed or isn''t on this event.' using errcode = 'P0002';
    end if;
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Enter the sponsor''s name.' using errcode = 'P0001';
  end if;
  if p_logo_path is not null and p_logo_path not like e.organization_id::text || '/' || e.id::text || '/%' then
    raise exception 'That logo belongs to another event.' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_new_level_name, '')), '') is not null then
    lvl := public.add_sponsor_level_internal(p_event, p_new_level_name);
  end if;
  has_levels := exists (select 1 from sponsor_levels where event_id = p_event);
  if has_levels and lvl is null then
    raise exception 'Pick a level.' using errcode = 'P0001';
  end if;
  if lvl is not null and not exists (select 1 from sponsor_levels where id = lvl and event_id = p_event) then
    raise exception 'That level isn''t on this event.' using errcode = 'P0001';
  end if;
  if not has_levels then
    lvl := null;
  end if;
  -- Hidden sponsors can't become "Presented by" (the one who has it may be hidden; the row says so).
  if p_presented_by and not p_show and not coalesce(cur.presented_by, false) then
    raise exception 'A hidden sponsor can''t present the %. Show them on the public page first.', public.sponsor_kind_word(e.event_type::text) using errcode = 'P0001';
  end if;
  if p_presented_by then
    update sponsors set presented_by = false, updated_at = now()
     where event_id = p_event and presented_by and id is distinct from p_sponsor;
  end if;

  if p_sponsor is null then
    insert into sponsors (event_id, level_id, name, logo_path, logo_width, logo_height, website, position, show_public, presented_by, created_by)
    values (p_event, lvl, btrim(p_name), p_logo_path,
            case when p_logo_path is null then null else p_logo_width end,
            case when p_logo_path is null then null else p_logo_height end,
            nullif(btrim(coalesce(p_website, '')), ''),
            coalesce((select max(position) from sponsors where event_id = p_event and level_id is not distinct from lvl and removed_at is null), 0) + 1,
            coalesce(p_show, true), coalesce(p_presented_by, false), auth.uid())
    returning id into new_id;
    return new_id;
  end if;

  update sponsors set
    name = btrim(p_name),
    level_id = lvl,
    -- A new level: the bottom of it.
    position = case when cur.level_id is not distinct from lvl then position
                    else coalesce((select max(position) from sponsors where event_id = p_event and level_id is not distinct from lvl and removed_at is null), 0) + 1 end,
    logo_path   = case when p_logo_path is not null then p_logo_path when p_clear_logo then null else logo_path end,
    logo_width  = case when p_logo_path is not null then p_logo_width when p_clear_logo then null else logo_width end,
    logo_height = case when p_logo_path is not null then p_logo_height when p_clear_logo then null else logo_height end,
    website = nullif(btrim(coalesce(p_website, '')), ''),
    show_public = coalesce(p_show, true),
    presented_by = coalesce(p_presented_by, false),
    updated_at = now()
  where id = p_sponsor;
  if cur.level_id is distinct from lvl then
    perform public.renumber_sponsors(p_event, cur.level_id);
  end if;
  return p_sponsor;
end;
$$;
revoke execute on function public.save_sponsor(uuid, uuid, text, uuid, text, text, text, integer, integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_sponsor(uuid, uuid, text, uuid, text, text, text, integer, integer, boolean, boolean, boolean) to authenticated;

-- The sponsor's event, locked, if the person may change it.
create or replace function public.sponsor_for_change(p_sponsor uuid)
returns public.sponsors
language plpgsql security definer set search_path = public
as $$
declare
  ev uuid;
  s public.sponsors;
begin
  select event_id into ev from sponsors where id = p_sponsor;
  if ev is null then
    raise exception 'Only the event''s hosts can change its sponsors.' using errcode = '42501';
  end if;
  perform public.sponsor_event_for_change(ev);
  select * into s from sponsors where id = p_sponsor for update;
  return s;
end;
$$;
revoke execute on function public.sponsor_for_change(uuid) from public, anon, authenticated;

-- Remove (Undo with restore_sponsor until the daily job deletes it a day later).
create or replace function public.remove_sponsor(p_sponsor uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s public.sponsors := public.sponsor_for_change(p_sponsor);
begin
  if s.removed_at is not null then
    return;
  end if;
  update sponsors set removed_at = now(), updated_at = now() where id = p_sponsor;
  perform public.renumber_sponsors(s.event_id, s.level_id);
end;
$$;
revoke execute on function public.remove_sponsor(uuid) from public, anon;
grant execute on function public.remove_sponsor(uuid) to authenticated;

-- Undo a Remove: back in its place. Presented by comes back only if nobody has it now. Returns whether it did.
create or replace function public.restore_sponsor(p_sponsor uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.sponsors;
  keeps boolean;
begin
  -- The daily job deleted it (a day after Remove): say so, not "only hosts".
  if not exists (select 1 from sponsors where id = p_sponsor) then
    raise exception 'That sponsor was removed for good.' using errcode = 'P0002';
  end if;
  s := public.sponsor_for_change(p_sponsor);
  if s.removed_at is null then
    return jsonb_build_object('presented_by', s.presented_by);
  end if;
  keeps := s.presented_by and not exists (
    select 1 from sponsors where event_id = s.event_id and presented_by and removed_at is null and id <> s.id);
  -- Before it was removed, it sat just above the sponsor now at its place.
  update sponsors set position = position + 1
   where event_id = s.event_id and level_id is not distinct from s.level_id and removed_at is null and position >= s.position;
  update sponsors set removed_at = null, presented_by = keeps, updated_at = now() where id = p_sponsor;
  perform public.renumber_sponsors(s.event_id, s.level_id);
  return jsonb_build_object('presented_by', keeps);
end;
$$;
revoke execute on function public.restore_sponsor(uuid) from public, anon;
grant execute on function public.restore_sponsor(uuid) to authenticated;

-- Show on the public page, or not. A hidden Presented by keeps the title but doesn't show (the row says so).
create or replace function public.set_sponsor_shown(p_sponsor uuid, p_show boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s public.sponsors := public.sponsor_for_change(p_sponsor);
begin
  if s.removed_at is not null then
    raise exception 'That sponsor was removed.' using errcode = 'P0002';
  end if;
  update sponsors set show_public = coalesce(p_show, true), updated_at = now() where id = p_sponsor;
end;
$$;
revoke execute on function public.set_sponsor_shown(uuid, boolean) from public, anon;
grant execute on function public.set_sponsor_shown(uuid, boolean) to authenticated;

-- Presented by: one showing sponsor, or nobody (null).
create or replace function public.set_presented_by(p_event uuid, p_sponsor uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e public.events := public.sponsor_event_for_change(p_event);
  s public.sponsors;
begin
  if p_sponsor is not null then
    select * into s from sponsors where id = p_sponsor and event_id = e.id and removed_at is null;
    if s.id is null then
      raise exception 'That sponsor was removed or isn''t on this event.' using errcode = 'P0002';
    end if;
    if not s.show_public then
      raise exception 'A hidden sponsor can''t present the %. Show them on the public page first.', public.sponsor_kind_word(e.event_type::text) using errcode = 'P0001';
    end if;
  end if;
  update sponsors set presented_by = false, updated_at = now() where event_id = e.id and presented_by and id is distinct from p_sponsor;
  if p_sponsor is not null then
    update sponsors set presented_by = true, updated_at = now() where id = p_sponsor;
  end if;
end;
$$;
revoke execute on function public.set_presented_by(uuid, uuid) from public, anon;
grant execute on function public.set_presented_by(uuid, uuid) to authenticated;

-- Move a sponsor up or down one place. From the top of a level, up goes to the bottom of the level above;
-- from the bottom, down goes to the top of the level below (owner's choice). Returns where it ended up:
-- { moved, crossed, level_id, level_name, place (1-based), count }.
create or replace function public.move_sponsor(p_sponsor uuid, p_dir text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.sponsors := public.sponsor_for_change(p_sponsor);
  ids uuid[];
  i int;
  n int;
  other uuid;
  cur_pos int;
  target uuid;
  crossed boolean := false;
  moved boolean := true;
begin
  if p_dir not in ('up', 'down') then
    raise exception 'Move up or down.' using errcode = 'P0001';
  end if;
  if s.removed_at is not null then
    raise exception 'That sponsor was removed.' using errcode = 'P0002';
  end if;
  perform public.renumber_sponsors(s.event_id, s.level_id);
  select array_agg(id order by position) into ids
    from sponsors where event_id = s.event_id and level_id is not distinct from s.level_id and removed_at is null;
  n := coalesce(array_length(ids, 1), 0);
  i := array_position(ids, s.id);

  if p_dir = 'up' and i > 1 then
    other := ids[i - 1];
    update sponsors set position = i where id = other;
    update sponsors set position = i - 1, updated_at = now() where id = s.id;
  elsif p_dir = 'down' and i < n then
    other := ids[i + 1];
    update sponsors set position = i where id = other;
    update sponsors set position = i + 1, updated_at = now() where id = s.id;
  elsif s.level_id is not null then
    select position into cur_pos from sponsor_levels where id = s.level_id;
    if p_dir = 'up' then
      select id into target from sponsor_levels where event_id = s.event_id and position < cur_pos order by position desc limit 1;
    else
      select id into target from sponsor_levels where event_id = s.event_id and position > cur_pos order by position limit 1;
    end if;
    if target is null then
      moved := false;
    else
      crossed := true;
      if p_dir = 'up' then
        update sponsors set level_id = target, updated_at = now(),
               position = coalesce((select max(position) from sponsors where event_id = s.event_id and level_id = target and removed_at is null), 0) + 1
         where id = s.id;
      else
        update sponsors set position = position + 1 where event_id = s.event_id and level_id = target and removed_at is null;
        update sponsors set level_id = target, position = 1, updated_at = now() where id = s.id;
      end if;
      perform public.renumber_sponsors(s.event_id, s.level_id);
      perform public.renumber_sponsors(s.event_id, target);
    end if;
  else
    moved := false;
  end if;

  select * into s from sponsors where id = p_sponsor;
  return jsonb_build_object(
    'moved', moved,
    'crossed', crossed,
    'level_id', s.level_id,
    'level_name', (select name from sponsor_levels where id = s.level_id),
    'place', s.position,
    'count', (select count(*) from sponsors where event_id = s.event_id and level_id is not distinct from s.level_id and removed_at is null));
end;
$$;
revoke execute on function public.move_sponsor(uuid, text) from public, anon;
grant execute on function public.move_sponsor(uuid, text) to authenticated;

-- 5. Levels ----------------------------------------------------------------------------------------------
-- Add (p_level null) or rename a level. Returns its id.
create or replace function public.save_sponsor_level(p_event uuid, p_level uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  e public.events := public.sponsor_event_for_change(p_event);
begin
  if p_level is null then
    return public.add_sponsor_level_internal(e.id, p_name);
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Name the level.' using errcode = 'P0001';
  end if;
  if exists (select 1 from sponsor_levels where event_id = e.id and id <> p_level and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'There''s already a level called %.', btrim(p_name) using errcode = 'P0001';
  end if;
  update sponsor_levels set name = btrim(p_name) where id = p_level and event_id = e.id;
  if not found then
    raise exception 'That level isn''t on this event.' using errcode = 'P0002';
  end if;
  return p_level;
end;
$$;
revoke execute on function public.save_sponsor_level(uuid, uuid, text) from public, anon;
grant execute on function public.save_sponsor_level(uuid, uuid, text) to authenticated;

-- Move a level up or down one place (higher levels get bigger logos and come first).
create or replace function public.move_sponsor_level(p_level uuid, p_dir text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  ev uuid;
  cur_pos int;
  other uuid;
  other_pos int;
begin
  select event_id into ev from sponsor_levels where id = p_level;
  if ev is null then
    raise exception 'Only the event''s hosts can change its sponsors.' using errcode = '42501';
  end if;
  perform public.sponsor_event_for_change(ev);
  if p_dir not in ('up', 'down') then
    raise exception 'Move up or down.' using errcode = 'P0001';
  end if;
  perform public.renumber_sponsor_levels(ev);
  select position into cur_pos from sponsor_levels where id = p_level;
  if p_dir = 'up' then
    select id, position into other, other_pos from sponsor_levels where event_id = ev and position < cur_pos order by position desc limit 1;
  else
    select id, position into other, other_pos from sponsor_levels where event_id = ev and position > cur_pos order by position limit 1;
  end if;
  if other is null then
    return;
  end if;
  update sponsor_levels set position = cur_pos where id = other;
  update sponsor_levels set position = other_pos where id = p_level;
end;
$$;
revoke execute on function public.move_sponsor_level(uuid, text) from public, anon;
grant execute on function public.move_sponsor_level(uuid, text) to authenticated;

-- Remove a level, moving its sponsors (hidden and just-removed ones too) to p_to in one step, at the bottom
-- of it. Removing the only level leaves everyone without one (p_to null). Returns how many moved.
create or replace function public.remove_sponsor_level(p_level uuid, p_to uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  ev uuid;
  others int;
  start_at int;
  n int := 0;
begin
  select event_id into ev from sponsor_levels where id = p_level;
  if ev is null then
    raise exception 'Only the event''s hosts can change its sponsors.' using errcode = '42501';
  end if;
  perform public.sponsor_event_for_change(ev);
  select count(*) into others from sponsor_levels where event_id = ev and id <> p_level;
  if others = 0 then
    if p_to is not null then
      raise exception 'That level isn''t on this event.' using errcode = 'P0001';
    end if;
  else
    if p_to is null and exists (select 1 from sponsors where event_id = ev and level_id = p_level) then
      raise exception 'Pick a level for its sponsors first.' using errcode = 'P0001';
    end if;
    if p_to is not null and (p_to = p_level or not exists (select 1 from sponsor_levels where id = p_to and event_id = ev)) then
      raise exception 'Pick another level on this event.' using errcode = 'P0001';
    end if;
  end if;
  select coalesce(max(position), 0) into start_at from sponsors where event_id = ev and level_id is not distinct from p_to and removed_at is null;
  update sponsors s set level_id = p_to, position = start_at + o.n
    from (select id, row_number() over (order by position, created_at, id) as n from sponsors where event_id = ev and level_id = p_level) o
   where s.id = o.id and s.event_id = ev;
  get diagnostics n = row_count;
  delete from sponsor_levels where id = p_level and event_id = ev;
  perform public.renumber_sponsor_levels(ev);
  perform public.renumber_sponsors(ev, p_to);
  return n;
end;
$$;
revoke execute on function public.remove_sponsor_level(uuid, uuid) from public, anon;
grant execute on function public.remove_sponsor_level(uuid, uuid) to authenticated;

-- 6. Reuse: "Add sponsors from other events" and year two's "Bring back sponsors from …" ---------------------
-- Events of the same account the person hosts that have sponsors, newest first (not this one). same_kind marks
-- year two's candidates (the most recent earlier event of the same kind).
create or replace function public.sponsor_reuse_sources(p_event uuid)
returns table (event_id uuid, name text, event_type text, starts_on date, sponsors integer, levels integer, same_kind boolean)
language sql stable security definer set search_path = public
as $$
  select e.id, e.name, e.event_type::text, e.starts_on,
         (select count(*)::int from sponsors s where s.event_id = e.id and s.removed_at is null),
         (select count(*)::int from sponsor_levels l where l.event_id = e.id),
         e.event_type = (select event_type from events where id = p_event)
    from events e
   where e.id <> p_event
     and e.organization_id = (select organization_id from events where id = p_event)
     and public.is_event_admin(p_event)
     and public.is_event_admin(e.id)
     and exists (select 1 from sponsors s where s.event_id = e.id and s.removed_at is null)
   order by e.starts_on desc, e.name
$$;
revoke execute on function public.sponsor_reuse_sources(uuid) from public, anon;
grant execute on function public.sponsor_reuse_sources(uuid) to authenticated;

-- Copy sponsors from another of the account's events the person hosts into this one. p_sponsors: which ones
-- (null: all). p_with_levels: also bring every level of the source (year two), in its order, where there's room.
-- p_levels: { "<source level name>": "<this event's level id>" } for levels that don't match by name ("" for
-- sponsors with no level there); a source level with no match and no choice becomes a new level if there's room
-- (4 at most), or stops with "Pick a level for …". Every level used must be this event's. Skips sponsors already
-- here (copied from the same one, or the same name). "Presented by" isn't copied. p_show: whether they show on
-- the public page (null: hidden on a published event, so the organizer can check first; showing on a draft).
-- Rows are added without their logo: the server copies each logo's files from → to, then attaches it with
-- attach_reused_sponsor_logo, so no row ever points at a file that isn't there. Returns
-- { added, skipped, logos: [{ id, from, to }] }.
drop function if exists public.reuse_sponsors(uuid, uuid, uuid[], jsonb, boolean);
create or replace function public.reuse_sponsors(p_event uuid, p_from uuid, p_sponsors uuid[] default null,
                                                 p_levels jsonb default '{}'::jsonb, p_with_levels boolean default false,
                                                 p_show boolean default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  e public.events := public.sponsor_event_for_change(p_event);
  src record;
  l record;
  target uuid;
  new_id uuid;
  new_path text;
  added int := 0;
  skipped int := 0;
  logos jsonb := '[]'::jsonb;
  map jsonb := '{}'::jsonb;
  had_levels boolean;
  shows boolean := coalesce(p_show, e.status <> 'published');
begin
  if p_from is null or p_from = p_event or not public.is_event_admin(p_from)
     or (select organization_id from events where id = p_from) is distinct from e.organization_id then
    raise exception 'You can only add sponsors from your account''s events that you host.' using errcode = '42501';
  end if;
  had_levels := exists (select 1 from sponsor_levels where event_id = p_event);

  if p_with_levels then
    for l in select name from sponsor_levels where event_id = p_from order by position loop
      if not exists (select 1 from sponsor_levels where event_id = p_event and lower(btrim(name)) = lower(btrim(l.name)))
         and (select count(*) from sponsor_levels where event_id = p_event) < 4 then
        perform public.add_sponsor_level_internal(p_event, l.name);
      end if;
    end loop;
  end if;

  for src in
    select s.*, sl.name as level_name
      from sponsors s left join sponsor_levels sl on sl.id = s.level_id
     where s.event_id = p_from and s.removed_at is null and (p_sponsors is null or s.id = any (p_sponsors))
     order by sl.position nulls last, s.position
  loop
    if exists (select 1 from sponsors d where d.event_id = p_event and d.removed_at is null
                and (d.copied_from = src.id or d.id = src.copied_from or public.sponsor_name_key(d.name) = public.sponsor_name_key(src.name))) then
      skipped := skipped + 1;
      continue;
    end if;

    target := null;
    if exists (select 1 from sponsor_levels where event_id = p_event) or src.level_name is not null then
      if src.level_name is null then
        -- From an event without levels into one with them: the chosen level, or the last one.
        target := nullif(p_levels ->> '', '')::uuid;
        if target is null then
          select id into target from sponsor_levels where event_id = p_event order by position desc limit 1;
        end if;
      elsif map ? src.level_name then
        target := (map ->> src.level_name)::uuid;
      else
        target := nullif(p_levels ->> src.level_name, '')::uuid;
        if target is null then
          select id into target from sponsor_levels where event_id = p_event and lower(btrim(name)) = lower(btrim(src.level_name));
        end if;
        if target is null then
          if (select count(*) from sponsor_levels where event_id = p_event) >= 4 then
            raise exception 'Pick a level for % sponsors.', src.level_name using errcode = 'P0001';
          end if;
          target := public.add_sponsor_level_internal(p_event, src.level_name);
        end if;
        map := map || jsonb_build_object(src.level_name, target);
      end if;
      -- Whichever way it was chosen, the level must be this event's.
      if target is null or not exists (select 1 from sponsor_levels where id = target and event_id = p_event) then
        raise exception 'That level isn''t on this event.' using errcode = 'P0001';
      end if;
    end if;

    new_id := gen_random_uuid();
    new_path := case when src.logo_path is null then null
                     else e.organization_id::text || '/' || e.id::text || '/' || gen_random_uuid()::text || '/' || split_part(src.logo_path, '/', 4) end;
    insert into sponsors (id, event_id, level_id, name, website, position, show_public, presented_by, copied_from, created_by)
    values (new_id, p_event, target, src.name, src.website,
            coalesce((select max(position) from sponsors where event_id = p_event and level_id is not distinct from target and removed_at is null), 0) + 1,
            shows, false, src.id, auth.uid());
    added := added + 1;
    if new_path is not null then
      logos := logos || jsonb_build_array(jsonb_build_object('id', new_id, 'from', src.logo_path, 'to', new_path));
    end if;
  end loop;

  -- An event without levels that just got its first: everyone already here goes into it (as when adding one).
  if not had_levels and exists (select 1 from sponsor_levels where event_id = p_event) then
    update sponsors set level_id = (select id from sponsor_levels where event_id = p_event order by position limit 1)
     where event_id = p_event and level_id is null;
  end if;
  return jsonb_build_object('added', added, 'skipped', skipped, 'logos', logos);
end;
$$;
revoke execute on function public.reuse_sponsors(uuid, uuid, uuid[], jsonb, boolean, boolean) from public, anon;
grant execute on function public.reuse_sponsors(uuid, uuid, uuid[], jsonb, boolean, boolean) to authenticated;

-- A reused sponsor's logo, once the server has copied its files to p_path (in this event's folder). Its size
-- comes from the sponsor it was copied from.
drop function if exists public.clear_sponsor_logo(uuid);
create or replace function public.attach_reused_sponsor_logo(p_sponsor uuid, p_path text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s public.sponsors := public.sponsor_for_change(p_sponsor);
  e public.events;
  src public.sponsors;
begin
  select * into e from events where id = s.event_id;
  select * into src from sponsors where id = s.copied_from;
  if src.id is null or src.logo_path is null then
    raise exception 'That sponsor wasn''t copied with a logo.' using errcode = 'P0001';
  end if;
  if p_path is null or p_path not like e.organization_id::text || '/' || e.id::text || '/%'
     or split_part(p_path, '/', 4) <> split_part(src.logo_path, '/', 4) then
    raise exception 'That logo belongs to another event.' using errcode = 'P0001';
  end if;
  update sponsors set logo_path = p_path, logo_width = src.logo_width, logo_height = src.logo_height, updated_at = now() where id = s.id;
end;
$$;
revoke execute on function public.attach_reused_sponsor_logo(uuid, text) from public, anon;
grant execute on function public.attach_reused_sponsor_logo(uuid, text) to authenticated;

-- 7. The public read ---------------------------------------------------------------------------------------
-- What the main public event page shows: published, the add-on on, shown, not removed. An event's hosts also
-- see a draft's (Preview). level_rank is 0 for the highest level (null without levels). logo_version is the
-- logo's folder name, for its address (/e/<slug>/sponsor-logo/<id>/<version>/<size>).
create or replace function public.public_sponsors(p_slug text)
returns table (id uuid, name text, level_name text, level_rank integer, place integer, website text,
               logo_version text, logo_width integer, logo_height integer, presented_by boolean)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name, l.name,
         l.position - 1,
         s.position, s.website,
         split_part(s.logo_path, '/', 3), s.logo_width, s.logo_height, s.presented_by
    from events e
    join sponsors s on s.event_id = e.id
    left join sponsor_levels l on l.id = s.level_id
   where e.slug = p_slug
     and e.event_type::text in ('band_contest', 'group_event', 'fair')
     and public.org_sponsors_on(e.organization_id)
     and (e.status = 'published' or public.is_event_admin(e.id))
     and s.show_public
     and s.removed_at is null
   order by l.position nulls last, s.position, s.created_at
$$;
revoke execute on function public.public_sponsors(text) from public;
grant execute on function public.public_sponsors(text) to anon, authenticated, service_role;

-- One public logo's file, for its route: only while public_sponsors would show that sponsor with that logo version
-- (one cheap lookup by sponsor, version, and page, instead of the whole list). published: whether shared caches may
-- keep it (a draft's preview is only for its hosts).
create or replace function public.public_sponsor_logo(p_slug text, p_sponsor uuid, p_version text)
returns table (logo_path text, published boolean)
language sql stable security definer set search_path = public
as $$
  select s.logo_path, e.status = 'published'
    from sponsors s
    join events e on e.id = s.event_id
   where s.id = p_sponsor
     and e.slug = p_slug
     and s.logo_path is not null
     and split_part(s.logo_path, '/', 3) = p_version
     and e.event_type::text in ('band_contest', 'group_event', 'fair')
     and public.org_sponsors_on(e.organization_id)
     and (e.status = 'published' or public.is_event_admin(e.id))
     and s.show_public
     and s.removed_at is null
$$;
revoke execute on function public.public_sponsor_logo(text, uuid, text) from public;
grant execute on function public.public_sponsor_logo(text, uuid, text) to anon, authenticated, service_role;

-- 8. Logos ------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', false, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- 9. Cleanup (daily job) -------------------------------------------------------------------------------------
-- Removed sponsors a day after Remove (Undo is long over). Their files are then orphans (below).
create or replace function public.purge_removed_sponsors()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  delete from sponsors where removed_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.purge_removed_sponsors() from public, anon, authenticated;
grant execute on function public.purge_removed_sponsors() to service_role;

-- Files in sponsor-logos that nothing points to, a day old or more: uploads never used, logos replaced, and
-- the files of removed sponsors, deleted events, and closed accounts (whose rows are gone). The server removes
-- them through the storage API.
create or replace function public.sponsor_logo_orphans(p_limit integer default 1000)
returns setof text
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
    select o.name
      from storage.objects o
     where o.bucket_id = 'sponsor-logos'
       and o.created_at < now() - interval '1 day'
       and (o.name like 'uploads/%'
            or not exists (
              select 1 from public.sponsors s
               where s.logo_path is not null
                 and split_part(s.logo_path, '/', 1) = split_part(o.name, '/', 1)
                 and split_part(s.logo_path, '/', 2) = split_part(o.name, '/', 2)
                 and split_part(s.logo_path, '/', 3) = split_part(o.name, '/', 3)))
     order by o.created_at
     limit greatest(coalesce(p_limit, 1000), 1);
end;
$$;
revoke execute on function public.sponsor_logo_orphans(integer) from public, anon, authenticated;
grant execute on function public.sponsor_logo_orphans(integer) to service_role;

-- Sponsors whose logo file is missing (a copy or upload that never finished, or a file removed by hand), an hour
-- after their last change: they show by name instead of a broken image. Returns how many.
create or replace function public.clear_missing_sponsor_logos()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  update sponsors s set logo_path = null, logo_width = null, logo_height = null, updated_at = now()
   where s.logo_path is not null
     and s.updated_at < now() - interval '1 hour'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'sponsor-logos' and o.name = s.logo_path);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.clear_missing_sponsor_logos() from public, anon, authenticated;
grant execute on function public.clear_missing_sponsor_logos() to service_role;
