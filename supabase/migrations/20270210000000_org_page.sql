-- =============================================================================
-- The organization page and "More ways to help" (owner, 2026-11-20 and 2026-11-21;
-- docs/design-decisions/2026-11-20-organization-page.md). The database half: no screens.
--
--   1. Account settings: organizations.org_page_on (off until turned on), org_page_on_since, and
--      org_page_contact_email. The page's heading is the account's own name (organizations.name, which the
--      Account Host can already change and which every email already carries): no second name to drift. While
--      the page is on, the name can't be empty or a team member's full name (a trigger, so a direct update
--      can't get round it either).
--   2. The page's address: organizations.slug, set fresh from the confirmed name at the first turn-on (the
--      name, then four random letters or digits, like the app's slugify) and then kept, even across off and on.
--      The old slug was never shown anywhere public (only the platform admin's account list reads it), so it
--      can be rewritten; org_page_slug_set_at says it's been done.
--   3. set_org_page(): turn on or off, name, contact email, and which events show, in one step. Only
--      is_org_admin (the Account Host and Co-hosts of every event). Teacher, suspended, and closed accounts are
--      refused.
--   4. events.on_org_page: false by default. A new event starts on only when the page is on, it's a volunteer
--      event or a fair, and whoever creates it is is_org_admin (this covers duplicate_event too). Anyone else's
--      new event starts off with org_page_needs_review, so the Account Host sees "1 new event to review". The
--      switch changes only through set_event_on_org_page() or set_org_page() (a guard trigger), and is never
--      on for any other kind (a check; changing an event's kind takes it off).
--   5. org_help_items: "Help anytime" (title, note, optional https link, end date). Account Host and Co-hosts
--      of every event only; no public access. An item leaves the page after its end date ("Take off the page now"
--      sets the end date to yesterday, which only an update may do; there's no separate Done).
--   6. org_page_listing(): the one public read, for the page (by its address) and for the block on a sign-up
--      page (by event, leaving that event out, and leaving out shifts this device holds or that overlap them).
--      Only what's listed: no names, emails, or phones beyond the page's contact email. Capped at 12 months
--      and 100 events.
--   7. signup_closed_contact(): who the "sign-up closed" note points to: the page contact while the page is
--      on, otherwise a reply-to the organizer typed, never the creator's sign-in email.
--   8. pass_contact(): the details a device's own earlier sign-up carries over (server only). Only the booker,
--      never people they added, and only from the same account's events; phone left out once the event is past its
--      10-day keep.
--   9. event_org_page_status() for an event's hosts, org_page_summary() for the account's.
--  10. help_link_signups: a daily count of sign-ups by where they came from (more_ways, org_page, direct, and the
--      confirm step's own more_ways_confirm and org_page_confirm), per account. An estimate: the source comes from
--      the link, which anyone can edit. No names, no cookie, no IP address, nothing stored on the person. Server only.
--  11. org_page_logo(): the logo's storage path while the page is on, for the logo's address (server only).
--
-- Safe to run twice.
-- =============================================================================

-- 1. Account settings -----------------------------------------------------------------------------------
alter table public.organizations add column if not exists org_page_on boolean not null default false;
alter table public.organizations add column if not exists org_page_on_since timestamptz;
alter table public.organizations add column if not exists org_page_contact_email text;
alter table public.organizations add column if not exists org_page_slug_set_at timestamptz;
alter table public.organizations drop constraint if exists organizations_org_page_contact_email_check;
alter table public.organizations add constraint organizations_org_page_contact_email_check check (
  org_page_contact_email is null
  or (char_length(org_page_contact_email) <= 254 and org_page_contact_email ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$'));
alter table public.organizations drop constraint if exists organizations_org_page_needs_contact;
alter table public.organizations add constraint organizations_org_page_needs_contact check (
  not org_page_on or org_page_contact_email is not null);
-- Hosts update only (name, default_timezone) on organizations (core schema): these change only through set_org_page.

-- The account may have a page at all: not a teacher account, not suspended, not closed.
create or replace function public.org_page_blocked(o public.organizations)
returns text
language sql stable set search_path = public
as $$
  select case
           when o.id is null then 'missing'
           when o.account_kind = 'teacher' then 'teacher'
           when o.closed_at is not null then 'account_closed'
           when o.suspended_at is not null then 'suspended'
         end;
$$;
revoke execute on function public.org_page_blocked(public.organizations) from public, anon, authenticated;

-- The same, by account (for the policies below).
create or replace function public.org_page_allowed(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.org_page_blocked(o) is null from organizations o where o.id = p_org $$;
revoke execute on function public.org_page_allowed(uuid) from public, anon;
grant execute on function public.org_page_allowed(uuid) to authenticated, service_role;

-- The page shows: switched on, and the account may have one.
create or replace function public.org_page_live(o public.organizations)
returns boolean
language sql stable set search_path = public
as $$ select o.id is not null and o.org_page_on and public.org_page_blocked(o) is null; $$;
revoke execute on function public.org_page_live(public.organizations) from public, anon, authenticated;

-- Comparing names: lower case, letters and digits only ("Dana Whitfield" = "dana  whitfield.").
create or replace function public.org_page_name_key(p text)
returns text
language sql immutable
as $$ select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '', 'g') $$;

-- What's wrong with this name as the page's heading, or null. A team member's full name (the account's hosts,
-- or anyone on one of its events' teams) would put a person's name at the top of a public page.
create or replace function public.org_page_name_problem(p_org uuid, p_name text)
returns text
language sql stable security definer set search_path = public
as $$
  select case
           when btrim(coalesce(p_name, '')) = '' then 'Add your group''s name to turn on your page.'
           when char_length(btrim(p_name)) > 120 then 'Keep your group''s name under 120 characters.'
           when exists (
             select 1 from profiles p
              where public.org_page_name_key(p.full_name) <> ''
                and public.org_page_name_key(p.full_name) = public.org_page_name_key(p_name)
                and (p.id in (select m.user_id from organization_members m where m.organization_id = p_org)
                     or p.id in (select s.user_id from event_staff s join events e on e.id = s.event_id
                                  where e.organization_id = p_org)))
             then 'This looks like a person''s name. Enter your group''s name, like Cedar Ridge Boosters.'
         end;
$$;
revoke execute on function public.org_page_name_problem(uuid, text) from public, anon, authenticated;

-- While the page is on, its name stays a group's name, however it's changed. Security definer, so a host's own
-- rename reaches the name check (which they can't call directly) and gets its refusal in words.
create or replace function public.organizations_org_page_name()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  problem text;
begin
  if new.org_page_on and (tg_op = 'INSERT' or not old.org_page_on or new.name is distinct from old.name) then
    problem := public.org_page_name_problem(new.id, new.name);
    if problem is not null then
      raise exception '%', problem using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.organizations_org_page_name() from public, anon, authenticated;
drop trigger if exists organizations_org_page_name on public.organizations;
create trigger organizations_org_page_name
  before insert or update of name, org_page_on on public.organizations
  for each row execute function public.organizations_org_page_name();

-- 4. Events on the page ------------------------------------------------------------------------------------
alter table public.events add column if not exists on_org_page boolean not null default false;
alter table public.events add column if not exists org_page_needs_review boolean not null default false;
alter table public.events drop constraint if exists events_on_org_page_kind;
alter table public.events add constraint events_on_org_page_kind check (
  not (on_org_page or org_page_needs_review) or event_type in ('volunteer'::public.event_type, 'fair'::public.event_type));
-- The page's read: an account's published events by last day.
create index if not exists events_org_status_ends_idx on public.events (organization_id, status, ends_on);

-- A new event starts on the page only when the page is on, it's a volunteer event or a fair, and whoever creates
-- it is the Account Host or a Co-host of every event. Anyone else's starts off, waiting for review. Whatever the
-- insert says is replaced.
create or replace function public.events_org_page_on_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  o public.organizations;
  allowed boolean := new.event_type::text in ('volunteer', 'fair');
begin
  select * into o from organizations where id = new.organization_id;
  new.on_org_page := allowed and public.org_page_live(o) and public.is_org_admin(new.organization_id);
  new.org_page_needs_review := allowed and public.org_page_live(o) and not new.on_org_page;
  return new;
end;
$$;
revoke execute on function public.events_org_page_on_insert() from public, anon, authenticated;
drop trigger if exists events_org_page_on_insert on public.events;
create trigger events_org_page_on_insert
  before insert on public.events
  for each row execute function public.events_org_page_on_insert();

-- The switch changes only through set_event_on_org_page / set_org_page (which check is_org_admin and say so with
-- app.org_page_switch), or from the server. Changing an event to another kind takes it off.
create or replace function public.events_org_page_guard()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if (new.on_org_page is distinct from old.on_org_page or new.org_page_needs_review is distinct from old.org_page_needs_review)
     and coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and not (coalesce(current_setting('app.org_page_switch', true), '') = 'on' and public.is_org_admin(old.organization_id)) then
    raise exception 'Only the Account Host and Co-hosts of every event can choose what shows on the organization page.'
      using errcode = '42501';
  end if;
  -- Another kind is refused by events_on_org_page_kind; moving an event to another kind takes it off instead.
  if new.event_type is distinct from old.event_type and new.event_type::text not in ('volunteer', 'fair') then
    new.on_org_page := false;
    new.org_page_needs_review := false;
  end if;
  return new;
end;
$$;
revoke execute on function public.events_org_page_guard() from public, anon, authenticated;
drop trigger if exists events_org_page_guard on public.events;
create trigger events_org_page_guard
  before update of on_org_page, org_page_needs_review, event_type on public.events
  for each row execute function public.events_org_page_guard();

-- 5. Help anytime ------------------------------------------------------------------------------------------
create table if not exists public.org_help_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null constraint org_help_items_title_length check (char_length(btrim(title)) between 1 and 80),
  note             text constraint org_help_items_note_length check (note is null or char_length(note) <= 200),
  link             text,
  ends_on          date not null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists org_help_items_org_idx on public.org_help_items (organization_id, ends_on);
-- An https address whose host has a dot and no "@" anywhere before the first "/", "?", or "#" (no "user@host"
-- tricks). Re-added each run, so a database with the older check gets this one.
alter table public.org_help_items drop constraint if exists org_help_items_link_safe;
alter table public.org_help_items add constraint org_help_items_link_safe check (
  link is null or (char_length(link) <= 500 and link ~ '^https://[^[:space:]/?#@]+\.[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'));

alter table public.org_help_items enable row level security;
revoke all on public.org_help_items from anon, authenticated;
grant select, insert, update, delete on public.org_help_items to authenticated;
grant select, insert, update, delete on public.org_help_items to service_role;

drop policy if exists "org help items: account hosts read" on public.org_help_items;
create policy "org help items: account hosts read" on public.org_help_items
  for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists "org help items: account hosts add" on public.org_help_items;
create policy "org help items: account hosts add" on public.org_help_items
  for insert to authenticated with check (
    public.is_org_admin(organization_id)
    and coalesce(public.org_page_allowed(organization_id), false));
drop policy if exists "org help items: account hosts edit" on public.org_help_items;
create policy "org help items: account hosts edit" on public.org_help_items
  for update to authenticated using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id)
              and coalesce(public.org_page_allowed(organization_id), false));
drop policy if exists "org help items: account hosts remove" on public.org_help_items;
create policy "org help items: account hosts remove" on public.org_help_items
  for delete to authenticated using (public.is_org_admin(organization_id));

-- Tidy text, a new end date from today to a year out (in the account's time zone), who added it, and when it
-- changed. The account can't change. An update may also set yesterday: "Take off the page now" (it leaves the page
-- at once and stays listed for the organizer as ended, so it can be shown again).
create or replace function public.org_help_items_check()
returns trigger
language plpgsql set search_path = public
as $$
declare
  today date;
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'A way to help can''t move to another account.' using errcode = 'P0001';
  end if;
  new.title := btrim(new.title);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.link := nullif(btrim(coalesce(new.link, '')), '');
  if tg_op = 'INSERT' or new.ends_on is distinct from old.ends_on then
    select (now() at time zone coalesce(o.default_timezone, 'America/Chicago'))::date into today
      from organizations o where o.id = new.organization_id;
    if (new.ends_on < today and not (tg_op = 'UPDATE' and new.ends_on = today - 1)) or new.ends_on > today + 366 then
      raise exception 'Pick an end date from today to a year from now.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.org_help_items_check() from public, anon, authenticated;
drop trigger if exists org_help_items_check on public.org_help_items;
create trigger org_help_items_check
  before insert or update on public.org_help_items
  for each row execute function public.org_help_items_check();

-- 6. What the page lists ------------------------------------------------------------------------------------
-- Every one of an account's events the page could list, with why it isn't listed (reason is null when it is).
-- Rows: p_only for one event (any status), otherwise published events switched on and not long over. p_except
-- leaves one event out (the sign-up page the block is on); p_skip leaves out shifts this device already holds,
-- and any shift that overlaps one of them. Counts and the soonest shift are worked out from the shifts left.
-- Mirrors the sign-up rules: volunteer_signup_is_open / volunteer_signup_opens_later, ended shifts gone, hidden
-- jobs gone, fairs closed online on fair day. A shift already under way is never offered (the soonest shift and
-- the open spots count only shifts still to start); happening_now says one is under way, so the page can say so in
-- words instead of a sign-up button. Internal: the public reads it only through org_page_listing.
-- (Dropped first: its columns grew happening_now, which "create or replace" can't do.)
drop function if exists public.org_page_rows(uuid, uuid, uuid, uuid[]);
create or replace function public.org_page_rows(p_org uuid, p_only uuid default null, p_except uuid default null,
                                                p_skip uuid[] default '{}')
returns table (
  event_id         uuid,
  slug             text,
  name             text,
  kind             text,
  starts_on        date,
  ends_on          date,
  timezone         text,
  venue_name       text,
  open_spots       int,
  items_needed     int,
  opens_on         date,
  shift_id         uuid,
  shift_starts_at  timestamptz,
  shift_ends_at    timestamptz,
  shift_job        text,
  on_org_page      boolean,
  needs_review     boolean,
  reason           text,
  happening_now    boolean
)
language sql stable security definer set search_path = public
as $$
  with o as (select x as org from organizations x where x.id = p_org),
  skip as (select s.id, s.starts_at, s.ends_at from shifts s where s.id = any (coalesce(p_skip, '{}'::uuid[]))),
  ev as (
    select e, (now() at time zone e.timezone)::date as today
      from events e
     where e.organization_id = p_org
       and (p_except is null or e.id <> p_except)
       and (case when p_only is not null then e.id = p_only
                 else e.status = 'published' and e.on_org_page and e.ends_on >= current_date - 1 end)
  ),
  sh as (
    select s.event_id, s.id, s.starts_at, s.ends_at, st.name as job, greatest(s.max_capacity - s.registered_count, 0) as room,
           s.starts_at <= now() as started
      from shifts s
      join stations st on st.id = s.station_id
     where s.event_id in (select (ev.e).id from ev)
       and st.showing
       and s.ends_at > now()
       and not exists (select 1 from skip k where k.id = s.id or (s.starts_at < k.ends_at and s.ends_at > k.starts_at))
  ),
  counts as (
    select (ev.e).id as event_id,
           coalesce((select sum(sh.room) from sh where sh.event_id = (ev.e).id and not sh.started), 0)::int as spots,
           exists (select 1 from sh where sh.event_id = (ev.e).id and sh.started) as now_on,
           exists (select 1 from sh where sh.event_id = (ev.e).id and sh.started and sh.room > 0) as now_open,
           coalesce((select sum(greatest(i.needed - i.claimed_count, 0))
                       from station_items i join stations st on st.id = i.station_id
                      where i.event_id = (ev.e).id and st.showing), 0)::int as items
      from ev
  )
  select (ev.e).id, (ev.e).slug::text, (ev.e).name, (ev.e).event_type::text, (ev.e).starts_on, (ev.e).ends_on,
         (ev.e).timezone, (ev.e).venue_name, c.spots, c.items,
         case when public.volunteer_signup_opens_later(ev.e) then (ev.e).volunteer_signup_opens_on end,
         first.id, first.starts_at, first.ends_at, first.job,
         (ev.e).on_org_page, (ev.e).org_page_needs_review,
         case
           when public.org_page_blocked(o.org) is not null then public.org_page_blocked(o.org)
           when (ev.e).event_type::text not in ('volunteer', 'fair') then 'kind'
           when not (o.org).org_page_on then 'page_off'
           when not (ev.e).on_org_page then 'switched_off'
           when (ev.e).status <> 'published' then 'draft'
           when ev.today > (ev.e).ends_on then 'over'
           when (ev.e).event_type::text = 'fair' and ev.today >= (ev.e).starts_on then 'fair_day'
           when (ev.e).starts_on > (ev.today + interval '12 months')::date then 'later'
           when public.volunteer_signup_opens_later(ev.e) then null
           when not public.volunteer_signup_is_open(ev.e) then 'signup_closed'
           when c.spots = 0 and c.items = 0 and not c.now_open then 'full'
         end,
         c.now_on
    from ev
    cross join o
    join counts c on c.event_id = (ev.e).id
    left join lateral (
      select sh.id, sh.starts_at, sh.ends_at, sh.job from sh
       where sh.event_id = (ev.e).id and sh.room > 0 and not sh.started
       order by sh.starts_at, sh.ends_at, sh.id
       limit 1
    ) first on true;
$$;
revoke execute on function public.org_page_rows(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;

-- Help anytime items still showing (through their end date, in the account's time zone).
create or replace function public.org_page_help(p_org uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'title', h.title, 'note', h.note, 'link', h.link, 'ends_on', h.ends_on)
                            order by h.ends_on, h.created_at, h.id), '[]'::jsonb)
    from org_help_items h
    join organizations o on o.id = h.organization_id
   where h.organization_id = p_org
     and h.ends_on >= (now() at time zone o.default_timezone)::date;
$$;
revoke execute on function public.org_page_help(uuid) from public, anon, authenticated;

-- The public read. By the page's address (p_slug), or by event (p_event: the block on that event's sign-up page,
-- which leaves the event itself out). p_skip_shifts: shifts this device already holds (the block leaves them out,
-- with any shift that overlaps them). Null when the page is off, the account can't have one, or nothing matches.
-- Returns only:
--   { "page_on": true,
--     "org": { "name", "slug", "logo_path", "brand_color", "contact_email" },
--     "events": [ { "slug", "name", "kind", "starts_on", "ends_on", "timezone", "venue_name", "open_spots",
--                   "items_needed", "opens_on", "happening_now",
--                   "soonest_shift": { "id", "starts_at", "ends_at", "job" } | null (never one already under way) } ],
--     "help": [ { "id", "title", "note", "link", "ends_on" } ] }
create or replace function public.org_page_listing(p_slug text default null, p_event uuid default null,
                                                   p_skip_shifts uuid[] default '{}', p_limit int default 100)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  o public.organizations;
begin
  if p_slug is not null then
    select * into o from organizations where slug = lower(btrim(p_slug)) and org_page_slug_set_at is not null;
  elsif p_event is not null then
    select org.* into o from organizations org join events e on e.organization_id = org.id where e.id = p_event;
  end if;
  if o.id is null or not public.org_page_live(o) then
    return null;
  end if;
  return jsonb_build_object(
    'page_on', true,
    'org', jsonb_build_object('name', o.name, 'slug', o.slug::text, 'logo_path', o.logo_path, 'brand_color', o.brand_color,
                              'contact_email', o.org_page_contact_email),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'slug', r.slug, 'name', r.name, 'kind', r.kind, 'starts_on', r.starts_on, 'ends_on', r.ends_on,
                 'timezone', r.timezone, 'venue_name', r.venue_name, 'open_spots', r.open_spots,
                 'items_needed', r.items_needed, 'opens_on', r.opens_on, 'happening_now', r.happening_now,
                 'soonest_shift', case when r.shift_id is null then null else jsonb_build_object(
                   'id', r.shift_id, 'starts_at', r.shift_starts_at, 'ends_at', r.shift_ends_at, 'job', r.shift_job) end)
                 order by r.starts_on, r.shift_starts_at nulls last, r.name, r.event_id), '[]'::jsonb)
                 from (select * from public.org_page_rows(o.id, null, p_event, coalesce(p_skip_shifts, '{}'::uuid[])) x
                        where x.reason is null
                        order by x.starts_on, x.shift_starts_at nulls last, x.name, x.event_id
                        limit greatest(0, least(coalesce(p_limit, 100), 100))) r),
    'help', public.org_page_help(o.id));
end;
$$;
revoke execute on function public.org_page_listing(text, uuid, uuid[], int) from public;
grant execute on function public.org_page_listing(text, uuid, uuid[], int) to anon, authenticated, service_role;

-- 7. Who the "sign-up closed" note points to ------------------------------------------------------------------
-- The page's contact email while the page is on; otherwise a reply-to the organizer typed (with replies on);
-- otherwise nothing. Never the creator's sign-in email (the fallback emails use). Server only.
create or replace function public.signup_closed_contact(p_event uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
           (select o.org_page_contact_email from events e join organizations o on o.id = e.organization_id
             where e.id = p_event and public.org_page_live(o)),
           (select nullif(btrim(s.reply_to), '') from event_email_settings s where s.event_id = p_event and s.replies));
$$;
revoke execute on function public.signup_closed_contact(uuid) from public, anon, authenticated;
grant execute on function public.signup_closed_contact(uuid) to service_role;

-- 8. Carrying details over --------------------------------------------------------------------------------
-- The most recent booker this device's pass proves: a volunteer access token (the emailed link, so they own the
-- inbox), or a shift or item manage token from a sign-up that created that volunteer (same moment), so typing
-- someone else's email on a form never hands back their details. Never someone the booker added (contact_id),
-- never a walk-up. Only from the same account as p_event (the event being signed up for): on a shared device, one
-- group's sign-up never fills in another group's form. Phone is null once the event is past its 10-day keep.
-- Server only. (The two-argument version from before is dropped.)
drop function if exists public.pass_contact(uuid[], uuid[]);
create or replace function public.pass_contact(p_volunteer_tokens uuid[], p_assignment_tokens uuid[], p_event uuid)
returns table (full_name text, email text, phone text, minor boolean, event_id uuid, event_slug text)
language sql stable security definer set search_path = public
as $$
  with proven as (
    select v.id from volunteers v where v.access_token = any (coalesce(p_volunteer_tokens, '{}'::uuid[]))
    union
    select v.id from volunteer_assignments va join volunteers v on v.id = va.volunteer_id
     where va.manage_token = any (coalesce(p_assignment_tokens, '{}'::uuid[])) and va.created_at = v.created_at
    union
    select v.id from item_signups i join volunteers v on v.id = i.volunteer_id
     where i.manage_token = any (coalesce(p_assignment_tokens, '{}'::uuid[])) and i.created_at = v.created_at
  )
  select v.full_name, v.email::text,
         case when (now() at time zone e.timezone)::date > e.ends_on + 10 then null else nullif(v.phone, '') end,
         v.minor, e.id, e.slug::text
    from proven p
    join volunteers v on v.id = p.id
    join events e on e.id = v.event_id
   where v.contact_id is null and not v.walk_up and v.email is not null
     and e.organization_id = (select x.organization_id from events x where x.id = p_event)
   order by v.created_at desc, v.id
   limit 1;
$$;
revoke execute on function public.pass_contact(uuid[], uuid[], uuid) from public, anon, authenticated;
grant execute on function public.pass_contact(uuid[], uuid[], uuid) to service_role;

-- 9. Status for organizers ---------------------------------------------------------------------------------
-- One event, for its hosts (a Co-host of one event sees the switch read-only, with who to ask).
-- { "page_on", "page_slug" (null until the page's first turn-on), "on_org_page", "needs_review", "can_change",
--   "listed", "reason" (null when listed; else teacher, account_closed, suspended, kind, page_off, switched_off,
--   draft, over, fair_day, later, signup_closed, full), "account_host": { "name", "email" } | null }
create or replace function public.event_org_page_status(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  e public.events;
  o public.organizations;
  r record;
begin
  select * into e from events where id = p_event;
  if e.id is null or not public.is_event_admin(p_event) then
    raise exception 'Only the event''s hosts can see this.' using errcode = '42501';
  end if;
  select * into o from organizations where id = e.organization_id;
  select * into r from public.org_page_rows(o.id, e.id, null, '{}') limit 1;
  return jsonb_build_object(
    'page_on', public.org_page_live(o),
    'page_slug', case when o.org_page_slug_set_at is not null then o.slug::text end,
    'on_org_page', e.on_org_page,
    'needs_review', e.org_page_needs_review,
    'can_change', public.is_org_admin(o.id) and public.org_page_blocked(o) is null
                  and e.event_type::text in ('volunteer', 'fair'),
    'listed', r.reason is null,
    'reason', r.reason,
    'account_host', (select jsonb_build_object('name', nullif(btrim(p.full_name), ''), 'email', p.email::text)
                       from organization_members m join profiles p on p.id = m.user_id
                      where m.organization_id = o.id
                      order by (m.role = 'owner') desc, m.created_at, m.user_id
                      limit 1));
end;
$$;
revoke execute on function public.event_org_page_status(uuid) from public, anon;
grant execute on function public.event_org_page_status(uuid) to authenticated;

-- The account's page, for its Account Host and Co-hosts of every event.
-- { "page_on", "page_on_since", "blocked" (null, or teacher, account_closed, suspended), "name", "slug" (null until
--   the first turn-on), "contact_email", "events_shown" (listed right now), "events_on" (switched on, not over),
--   "new_to_review", "help_active", "help_ending_soonest": { "id", "title", "ends_on" } | null }
create or replace function public.org_page_summary(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  o public.organizations;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Only the Account Host and Co-hosts of every event can see this.' using errcode = '42501';
  end if;
  select * into o from organizations where id = p_org;
  return jsonb_build_object(
    'page_on', public.org_page_live(o),
    'page_on_since', o.org_page_on_since,
    'blocked', public.org_page_blocked(o),
    'name', o.name,
    'slug', case when o.org_page_slug_set_at is not null then o.slug::text end,
    'contact_email', o.org_page_contact_email,
    'events_shown', (select count(*) from public.org_page_rows(p_org) r where r.reason is null),
    'events_on', (select count(*) from events e
                   where e.organization_id = p_org and e.on_org_page
                     and (now() at time zone e.timezone)::date <= e.ends_on),
    'new_to_review', (select count(*) from events e
                       where e.organization_id = p_org and e.org_page_needs_review
                         and (now() at time zone e.timezone)::date <= e.ends_on),
    'help_active', (select jsonb_array_length(public.org_page_help(p_org))),
    'help_ending_soonest', (select h from jsonb_array_elements(public.org_page_help(p_org)) h limit 1) - 'note' - 'link');
end;
$$;
revoke execute on function public.org_page_summary(uuid) from public, anon;
grant execute on function public.org_page_summary(uuid) to authenticated;

-- 3. Changing the page -------------------------------------------------------------------------------------
-- Turn on or off, the name, the contact email, and (when p_event_ids isn't null) exactly which events show, in
-- one step. Null leaves a setting as it is; an empty contact email clears it (only while off). Turning on needs
-- a group's name and a contact email; the first turn-on sets the page's address from the name, kept after that.
-- Choosing events marks every new event as reviewed. Returns org_page_summary.
create or replace function public.set_org_page(p_org uuid, p_on boolean, p_name text default null,
                                               p_contact_email text default null, p_event_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o       public.organizations;
  nm      text;
  contact text;
  base    text;
  s       text;
  bad     uuid;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Only the Account Host and Co-hosts of every event can change the organization page.' using errcode = '42501';
  end if;
  select * into o from organizations where id = p_org for update;
  if public.org_page_blocked(o) = 'teacher' then
    raise exception 'Teacher accounts don''t have an organization page.' using errcode = 'P0001';
  elsif public.org_page_blocked(o) is not null then
    raise exception 'This account is suspended or closed, so its organization page can''t be changed.' using errcode = 'P0001';
  end if;

  nm := coalesce(btrim(p_name), o.name);
  if btrim(nm) = '' then
    raise exception 'Add your group''s name.' using errcode = 'P0001';
  end if;
  contact := case when p_contact_email is null then o.org_page_contact_email
                  else nullif(lower(btrim(p_contact_email)), '') end;
  if contact is not null and (char_length(contact) > 254 or contact !~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$') then
    raise exception 'Check the contact email. It should look like name@example.com.' using errcode = 'P0001';
  end if;
  if coalesce(p_on, o.org_page_on) then
    if public.org_page_name_problem(p_org, nm) is not null then
      raise exception '%', public.org_page_name_problem(p_org, nm) using errcode = 'P0001';
    end if;
    if contact is null then
      raise exception 'Add a contact email to turn on your page.' using errcode = 'P0001';
    end if;
  end if;

  -- The address, set once from the confirmed name at the first turn-on (like the app's slugify).
  s := o.slug::text;
  if coalesce(p_on, false) and o.org_page_slug_set_at is null then
    base := btrim(left(btrim(regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g'), '-'), 48), '-');
    if base = '' then
      base := 'group';
    end if;
    loop
      s := base || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
      exit when not exists (select 1 from organizations x where x.slug = s and x.id <> p_org);
    end loop;
  end if;

  update organizations
     set name = nm,
         org_page_contact_email = contact,
         org_page_on = coalesce(p_on, org_page_on),
         org_page_on_since = case when not coalesce(p_on, org_page_on) then null
                                  when org_page_on then org_page_on_since else now() end,
         slug = s,
         org_page_slug_set_at = case when coalesce(p_on, false) then coalesce(org_page_slug_set_at, now())
                                     else org_page_slug_set_at end
   where id = p_org;

  if p_event_ids is not null then
    select x into bad from unnest(p_event_ids) x
     where not exists (select 1 from events e where e.id = x and e.organization_id = p_org
                          and e.event_type::text in ('volunteer', 'fair'))
     limit 1;
    if bad is not null then
      raise exception 'Only this account''s volunteer events and fairs can show on its page.' using errcode = 'P0001';
    end if;
    perform set_config('app.org_page_switch', 'on', true);
    update events e
       set on_org_page = (e.id = any (p_event_ids)), org_page_needs_review = false
     where e.organization_id = p_org
       and e.event_type::text in ('volunteer', 'fair')
       and (e.on_org_page is distinct from (e.id = any (p_event_ids)) or e.org_page_needs_review);
    perform set_config('app.org_page_switch', 'off', true);
  end if;
  return public.org_page_summary(p_org);
end;
$$;
revoke execute on function public.set_org_page(uuid, boolean, text, text, uuid[]) from public, anon;
grant execute on function public.set_org_page(uuid, boolean, text, text, uuid[]) to authenticated;

-- One event's switch (Publish step, Event settings, the page's own list). Account Host and Co-hosts of every
-- event only; volunteer events and fairs only. Marks it reviewed. Returns event_org_page_status, so a screen can
-- show the true state whatever happened.
create or replace function public.set_event_on_org_page(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  e public.events;
  o public.organizations;
begin
  select * into e from events where id = p_event for update;
  if e.id is null or not public.is_org_admin(e.organization_id) then
    raise exception 'Only the Account Host and Co-hosts of every event can choose what shows on the organization page.'
      using errcode = '42501';
  end if;
  select * into o from organizations where id = e.organization_id;
  if public.org_page_blocked(o) is not null then
    raise exception 'This account can''t have an organization page.' using errcode = 'P0001';
  end if;
  if coalesce(p_on, false) and e.event_type::text not in ('volunteer', 'fair') then
    raise exception 'Only volunteer events and fairs can show on the organization page.' using errcode = 'P0001';
  end if;
  perform set_config('app.org_page_switch', 'on', true);
  update events set on_org_page = coalesce(p_on, false), org_page_needs_review = false where id = p_event;
  perform set_config('app.org_page_switch', 'off', true);
  return public.event_org_page_status(p_event);
end;
$$;
revoke execute on function public.set_event_on_org_page(uuid, boolean) from public, anon;
grant execute on function public.set_event_on_org_page(uuid, boolean) to authenticated;

-- 10. Counting ----------------------------------------------------------------------------------------------
-- Sign-ups per day, account, and where they came from. Only counts: no names, no cookie, no IP address, nothing
-- stored on the person. An estimate, and shown as one: the source comes from the link (?via=), which anyone can
-- edit. Read by the platform admin's pages through the server.
create table if not exists public.help_link_signups (
  day              date not null,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  source           text not null,
  signups          integer not null default 0 check (signups >= 0),
  primary key (day, organization_id, source)
);
create index if not exists help_link_signups_org_idx on public.help_link_signups (organization_id, day);
-- The confirm step (a shift tapped from "More ways to help" or the organization page) counts on its own, so the
-- plain sign-up form's numbers stay apart. Re-added each run.
alter table public.help_link_signups drop constraint if exists help_link_signups_source;
alter table public.help_link_signups add constraint help_link_signups_source
  check (source in ('more_ways', 'org_page', 'direct', 'more_ways_confirm', 'org_page_confirm'));
alter table public.help_link_signups enable row level security;
revoke all on public.help_link_signups from anon, authenticated;
grant select, insert, update, delete on public.help_link_signups to service_role;

-- One more sign-up that booked something new, on the event's own day (its time zone). Server only.
create or replace function public.bump_help_link_signup(p_event uuid, p_source text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e public.events;
begin
  if p_source is null or p_source not in ('more_ways', 'org_page', 'direct', 'more_ways_confirm', 'org_page_confirm') then
    raise exception 'Unknown source.' using errcode = 'P0001';
  end if;
  select * into e from events where id = p_event;
  if e.id is null then
    return;
  end if;
  insert into help_link_signups (day, organization_id, source, signups)
  values ((now() at time zone e.timezone)::date, e.organization_id, p_source, 1)
  on conflict (day, organization_id, source) do update set signups = help_link_signups.signups + 1;
end;
$$;
revoke execute on function public.bump_help_link_signup(uuid, text) from public, anon, authenticated;
grant execute on function public.bump_help_link_signup(uuid, text) to service_role;

-- 11. The logo's address -------------------------------------------------------------------------------------
-- The account's logo path while its page is on (null otherwise): the logo's address reads this one value instead of
-- the whole listing. Server only.
create or replace function public.org_page_logo(p_slug text)
returns text
language sql stable security definer set search_path = public
as $$
  select o.logo_path from organizations o
   where o.slug = lower(btrim(p_slug)) and o.org_page_slug_set_at is not null and public.org_page_live(o);
$$;
revoke execute on function public.org_page_logo(text) from public, anon, authenticated;
grant execute on function public.org_page_logo(text) to service_role;
