-- =============================================================================
-- The public pricing page (design brief and owner decisions 2026-11-22,
-- docs/design-decisions/2026-11-22-pricing-page.md).
--
--   * plan_tiers gets the website fields: "Show on website" (packages and passes; new ones start hidden, retired
--     packages never show), a "Best for" line, and at most one "Recommended" package.
--   * site_settings (one row) holds the site-level switch: the pricing page stays hidden until an admin turns it on.
--     On the first run only, every unretired paid package and every pass starts shown (upgrade suggestions keep
--     naming them); the page stays hidden until the owner checks them and switches it on.
--   * pricing_page(): the only public read of packages. Null unless the page is live (admins get it anyway, for the
--     preview). Only shown packages and passes and their public fields: never monthly prices, retired or hidden
--     rows, or anything about accounts.
--   * Only platform admins read plan_tiers directly; visitors and signed-in people get pricing_page(), the app reads
--     it with the server key, and the trigger functions that look packages up run as their owner.
--   * Admin switches, each checked here and logged in admin_log: admin_set_package_website, admin_set_pass_shown,
--     admin_set_pricing_page; admin_update_package now also changes weekly hours (with an admin_package_impact case).
--   * Retiring a package hides it and takes off Recommended. A new package (admin_create_package) starts hidden.
--   * Upgrade suggestions in the app (upgrade_for, the full-team message, the pass offer) name only packages and
--     passes on the website, and never say "Upgrade to ." when none fits.
--   * pricing_requests: "Ask about [package]" and "Get a [kind] pass" from the pricing page. Written only through
--     submit_pricing_request() (checked and rate-limited); read and marked handled only by platform admins. A
--     request from someone on the account who isn't its Account Host is marked (account_role).
--   * account_host_asks: "Ask your Account Host" emails each Account Host at most once a day per person and package
--     (record_account_host_ask), only while the page is live.
--   * A price of 0 shows as "Ask us"; a lapsed plan's message names what Free publishes now.
--
-- Safe to run twice.
-- =============================================================================

-- 1. Website fields on packages and passes ---------------------------------------------------------------------
alter table public.plan_tiers
  add column if not exists show_on_website boolean not null default false,
  add column if not exists best_for text,
  add column if not exists recommended boolean not null default false;

do $$ begin
  alter table public.plan_tiers add constraint plan_tiers_best_for_check
    check (best_for is null or (char_length(best_for) between 2 and 120 and best_for !~ '[\r\n]'));
exception when duplicate_object then null;
end $$;
do $$ begin
  -- Only an unretired paid package can be a card or be recommended (the admin functions say why first).
  alter table public.plan_tiers add constraint plan_tiers_website_check
    check ((kind = 'pass' or not show_on_website or (retired_at is null and code not in ('free', 'free_teacher')))
           and (not recommended or (kind = 'package' and show_on_website)));
exception when duplicate_object then null;
end $$;
create unique index if not exists plan_tiers_one_recommended on public.plan_tiers ((true)) where recommended;

-- 2. The site-level switch ------------------------------------------------------------------------------------
create table if not exists public.site_settings (
  id                 boolean primary key default true check (id),
  pricing_page_live  boolean not null default false,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null
);
-- The first time this runs (only then: the settings row doesn't exist yet), show every unretired paid package
-- and every pass, so in-app upgrade suggestions keep naming packages as before. The page itself stays hidden,
-- so nothing becomes public; the owner adjusts the switches before going live. A re-run finds the row and
-- leaves the owner's choices alone.
with created as (
  insert into public.site_settings (id) values (true) on conflict (id) do nothing returning id
)
update public.plan_tiers set show_on_website = true
 where exists (select 1 from created)
   and (kind = 'pass'
        or (kind = 'package' and retired_at is null and code not in ('free', 'free_teacher') and cardinality(event_types) > 0));
alter table public.site_settings enable row level security;
revoke all on public.site_settings from public, anon, authenticated;
grant select, insert, update on public.site_settings to service_role;

-- Packages that show as a card on the pricing page.
create or replace function public.pricing_card_count()
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from plan_tiers
   where kind = 'package' and show_on_website and retired_at is null
     and code not in ('free', 'free_teacher') and cardinality(event_types) > 0;
$$;
revoke execute on function public.pricing_card_count() from public, anon, authenticated;

-- 3. The public read ------------------------------------------------------------------------------------------
create or replace function public.pricing_page()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  live boolean := coalesce((select pricing_page_live from site_settings where id), false);
begin
  -- Fail closed: nothing until the page is switched on, except an admin's preview.
  if not live and not public.is_platform_admin() then
    return null;
  end if;
  return jsonb_build_object(
    'live', live,
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'kind', t.kind,
               'event_types', to_jsonb(t.event_types), 'one_at_a_time', to_jsonb(t.one_at_a_time),
               'weekly_hours', t.weekly_hours, 'max_team', t.max_team, 'event_staff', t.event_staff,
               'volunteer_history', t.volunteer_history,
               -- A price of 0 isn't a real price for a paid package or a pass: it shows as "Ask us".
               'price_year_cents', nullif(t.price_year_cents, 0),
               'teacher_rate', t.teacher_rate,
               'teacher_year_cents', case when t.teacher_rate then nullif(t.teacher_year_cents, 0) end,
               'best_for', t.best_for, 'recommended', t.recommended, 'sort', t.sort)
             order by t.sort, t.code)
        from plan_tiers t
       where t.kind = 'package' and t.show_on_website and t.retired_at is null
         and t.code not in ('free', 'free_teacher') and cardinality(t.event_types) > 0), '[]'::jsonb),
    'passes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'kind', t.kind, 'event_type', t.event_types[1],
               'price_cents', nullif(t.price_cents, 0), 'sort', t.sort)
             order by t.sort, t.code)
        from plan_tiers t
       where t.kind = 'pass' and t.show_on_website), '[]'::jsonb),
    -- Free and Free Teacher: one line each on the page, never cards, never a price.
    'free', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'kind', t.kind,
               'event_types', to_jsonb(t.event_types), 'one_at_a_time', to_jsonb(t.one_at_a_time),
               'weekly_hours', t.weekly_hours, 'max_team', t.max_team, 'event_staff', t.event_staff,
               'volunteer_history', t.volunteer_history, 'sort', t.sort)
             order by t.sort, t.code)
        from plan_tiers t
       where t.code in ('free', 'free_teacher') and t.retired_at is null), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.pricing_page() from public;
grant execute on function public.pricing_page() to anon, authenticated, service_role;

-- 4. Packages are read only through pricing_page(), the server, and admins ------------------------------------
-- The packages table holds monthly prices, hidden and retired packages, and the website switches, so visitors and
-- signed-in people don't read it directly: the public page reads pricing_page(), the app reads it with the server
-- key (loadTiers), the database's own functions read it as their owner, and only platform admins read it as
-- themselves. The three trigger functions that look packages up while a signed-in person writes an account or an
-- invitation run as their owner first, so they keep working once the table is closed.
alter function public.teacher_accounts_start_free() security definer set search_path = public;
alter function public.package_changes_go_through_admin() security definer set search_path = public;
alter function public.host_invitations_package_check() security definer set search_path = public;
drop policy if exists "plan tiers: everyone reads" on public.plan_tiers;
drop policy if exists "plan tiers: signed-in people read" on public.plan_tiers;
drop policy if exists "plan tiers: admins read" on public.plan_tiers;
create policy "plan tiers: admins read" on public.plan_tiers for select to authenticated using (public.is_platform_admin());
revoke all on public.plan_tiers from public, anon, authenticated;
grant select on public.plan_tiers to authenticated, service_role;

-- 5. Admin switches -------------------------------------------------------------------------------------------
-- A package's website settings, saved together. Recommended moves here from any other package; hiding a package
-- takes Recommended off it. Retired and free packages never show as a card.
create or replace function public.admin_set_package_website(
  p_code text, p_show boolean, p_best_for text, p_recommended boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  before plan_tiers;
  clean text := nullif(btrim(regexp_replace(coalesce(p_best_for, ''), '\s+', ' ', 'g')), '');
  show boolean := coalesce(p_show, false);
  rec boolean := coalesce(p_recommended, false) and coalesce(p_show, false);
  moved_from text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can change packages' using errcode = '42501';
  end if;
  select * into before from plan_tiers where code = p_code and kind = 'package' for update;
  if before.code is null then
    raise exception 'That package doesn''t exist' using errcode = 'P0001';
  end if;
  if clean is not null and char_length(clean) not between 2 and 120 then
    raise exception 'Keep "Best for" to 2 to 120 characters' using errcode = 'P0001';
  end if;
  if show and before.code in ('free', 'free_teacher') then
    raise exception '% shows as a line on the pricing page, not a card', before.name using errcode = 'P0001';
  end if;
  if show and before.retired_at is not null then
    raise exception '% is retired, so it can''t show on the website', before.name using errcode = 'P0001';
  end if;
  if show and cardinality(before.event_types) = 0 then
    raise exception 'Add at least one kind of event to % before showing it', before.name using errcode = 'P0001';
  end if;
  if before.show_on_website and not show
     and coalesce((select pricing_page_live from site_settings where id), false)
     and public.pricing_card_count() <= 1 then
    raise exception '% is the last package on the live pricing page. Show another package first, or switch the page off',
      before.name using errcode = 'P0001';
  end if;

  if rec then
    select name into moved_from from plan_tiers where recommended and code <> p_code for update;
    update plan_tiers set recommended = false where recommended and code <> p_code;
  end if;
  update plan_tiers set show_on_website = show, best_for = clean, recommended = rec where code = p_code;

  if (before.show_on_website, before.best_for, before.recommended) is distinct from (show, clean, rec) then
    insert into admin_log (admin_id, action, details)
    values (auth.uid(), 'package_website_changed', jsonb_build_object(
      'code', p_code, 'name', before.name,
      'from', jsonb_build_object('show', before.show_on_website, 'best_for', before.best_for, 'recommended', before.recommended),
      'to', jsonb_build_object('show', show, 'best_for', clean, 'recommended', rec),
      'recommended_moved_from', moved_from,
      'note', nullif(btrim(coalesce(p_note, '')), '')));
  end if;
end;
$$;
revoke execute on function public.admin_set_package_website(text, boolean, text, boolean, text) from public, anon;
grant execute on function public.admin_set_package_website(text, boolean, text, boolean, text) to authenticated;

create or replace function public.admin_set_pass_shown(p_code text, p_show boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  before plan_tiers;
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can change passes' using errcode = '42501';
  end if;
  select * into before from plan_tiers where code = p_code and kind = 'pass' for update;
  if before.code is null then
    raise exception 'That pass doesn''t exist' using errcode = 'P0001';
  end if;
  if before.show_on_website = coalesce(p_show, false) then
    return;
  end if;
  update plan_tiers set show_on_website = coalesce(p_show, false) where code = p_code;
  insert into admin_log (admin_id, action, details)
  values (auth.uid(), case when p_show then 'pass_shown' else 'pass_hidden' end, jsonb_build_object(
    'code', p_code, 'event_type', before.event_types[1], 'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;
revoke execute on function public.admin_set_pass_shown(text, boolean, text) from public, anon;
grant execute on function public.admin_set_pass_shown(text, boolean, text) to authenticated;

create or replace function public.admin_set_pricing_page(p_live boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  was boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can change the pricing page' using errcode = '42501';
  end if;
  insert into site_settings (id) values (true) on conflict (id) do nothing;
  select pricing_page_live into was from site_settings where id for update;
  if was = coalesce(p_live, false) then
    return;
  end if;
  if p_live and public.pricing_card_count() = 0 then
    raise exception 'Show at least one package on the website before switching the pricing page on' using errcode = 'P0001';
  end if;
  update site_settings set pricing_page_live = coalesce(p_live, false), updated_at = now(), updated_by = auth.uid() where id;
  insert into admin_log (admin_id, action, details)
  values (auth.uid(), case when p_live then 'pricing_page_live' else 'pricing_page_hidden' end, jsonb_build_object(
    'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;
revoke execute on function public.admin_set_pricing_page(boolean, text) from public, anon;
grant execute on function public.admin_set_pricing_page(boolean, text) to authenticated;

-- What a change would affect, before saving it (from 20270114000000_package_admin.sql), now with weekly hours:
-- turning them off lists the accounts with a published conference or meeting on weekly hours that hasn't ended.
-- (Those stay live; only publishing another needs them.)
create or replace function public.admin_package_impact(p_code text, p_row text, p_setting text, p_max_team integer default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  affected jsonb := '[]';
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can see this' using errcode = '42501';
  end if;
  if p_row = 'max_team' then
    if p_max_team is not null then
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'detail', n || ' on the team') order by o.name), '[]')
        into affected
        from (select o.id, o.name, (select count(*) from public.org_team(o.id)) as n
                from organizations o where o.package = p_code) o
       where o.n > p_max_team;
    end if;
  elsif p_row = 'event_staff' then
    if p_setting = 'no' then
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'detail', x.n || ' Volunteer Lead' || case when x.n = 1 then '' else 's' end || ' or Coordinators') order by o.name), '[]')
        into affected
        from organizations o
        join lateral (select count(distinct s.user_id) as n from event_staff s join events e on e.id = s.event_id
                       where e.organization_id = o.id and e.ends_on >= current_date) x on x.n > 0
       where o.package = p_code;
    end if;
  elsif p_row = 'weekly_hours' then
    if p_setting = 'no' then
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'detail', x.names) order by o.name), '[]')
        into affected
        from organizations o
        join lateral (select string_agg(e.name, ', ' order by e.starts_on) as names, count(*) as n
                        from events e join conference_settings s on s.event_id = e.id
                       where e.organization_id = o.id and e.status = 'published' and s.schedule = 'weekly'
                         and e.ends_on >= (now() at time zone e.timezone)::date) x on x.n > 0
       where o.package = p_code;
    end if;
  elsif p_row = 'volunteer_history' then
    null; -- Nobody loses history they built up (volunteer_tracking_open keeps it showing).
  elsif p_setting in ('no', 'one') then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'detail', x.names) order by o.name), '[]')
      into affected
      from organizations o
      join lateral (select string_agg(e.name, ', ' order by e.starts_on) as names, count(*) as n
                      from events e
                     where e.organization_id = o.id and e.status = 'published' and e.event_type::text = p_row) x on x.n > 0
     where o.package = p_code;
  end if;
  return jsonb_build_object(
    'accounts', (select count(*) from organizations where package = p_code),
    'affected', affected
  );
end;
$$;
revoke execute on function public.admin_package_impact(text, text, text, integer) from public, anon;
grant execute on function public.admin_package_impact(text, text, text, integer) to authenticated;

-- Change what a package includes, now with weekly hours. p_weekly_hours null keeps it as it is, so a caller that
-- doesn't send it yet still works. Removing every kind of event from the last card on a live page is refused.
drop function if exists public.admin_update_package(text, text[], text[], integer, boolean, boolean, text);
create or replace function public.admin_update_package(
  p_code text,
  p_event_types text[],
  p_one_at_a_time text[],
  p_max_team integer,
  p_event_staff boolean,
  p_volunteer_history boolean,
  p_note text default null,
  p_weekly_hours boolean default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  before plan_tiers;
  known text[] := (select array_agg(t::text) from unnest(enum_range(null::public.event_type)) t);
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can change packages' using errcode = '42501';
  end if;
  select * into before from plan_tiers where code = p_code and kind = 'package' for update;
  if before.code is null then
    raise exception 'That package doesn''t exist' using errcode = 'P0001';
  end if;
  if not (coalesce(p_event_types, '{}') <@ known) or not (coalesce(p_one_at_a_time, '{}') <@ coalesce(p_event_types, '{}')) then
    raise exception 'Those event types don''t add up' using errcode = 'P0001';
  end if;
  if p_max_team is not null and (p_max_team < 1 or p_max_team > 10000) then
    raise exception 'Team spots must be at least 1, or unlimited' using errcode = 'P0001';
  end if;
  -- A package with no kinds of event isn't a card, so emptying the last card would leave a live page empty.
  if cardinality(coalesce(p_event_types, '{}')) = 0 and cardinality(before.event_types) > 0 and before.show_on_website
     and before.retired_at is null and before.code not in ('free', 'free_teacher')
     and coalesce((select pricing_page_live from site_settings where id), false)
     and public.pricing_card_count() <= 1 then
    raise exception '% is the last package on the live pricing page, so it needs at least one kind of event. Show another package first, or switch the page off',
      before.name using errcode = 'P0001';
  end if;

  update plan_tiers
     set event_types = (select coalesce(array_agg(t order by array_position(known, t)), '{}') from unnest(p_event_types) t),
         one_at_a_time = (select coalesce(array_agg(t order by array_position(known, t)), '{}') from unnest(p_one_at_a_time) t),
         weekly_hours = coalesce(p_weekly_hours, before.weekly_hours),
         max_team = p_max_team,
         event_staff = p_event_staff,
         volunteer_history = p_volunteer_history
   where code = p_code;

  -- Accounts gaining volunteer tracking keep what they build, as after an upgrade.
  if p_volunteer_history and not before.volunteer_history then
    perform set_config('app.package_change', 'on', true);
    update organizations set had_volunteer_tracking = true where package = p_code and not had_volunteer_tracking;
    perform set_config('app.package_change', 'off', true);
  end if;

  insert into admin_log (admin_id, action, details)
  values (auth.uid(), 'package_edited', jsonb_build_object(
    'code', p_code,
    'from', jsonb_build_object('event_types', before.event_types, 'one_at_a_time', before.one_at_a_time, 'weekly_hours', before.weekly_hours,
                               'max_team', before.max_team, 'event_staff', before.event_staff, 'volunteer_history', before.volunteer_history),
    'to', (select jsonb_build_object('event_types', event_types, 'one_at_a_time', one_at_a_time, 'weekly_hours', weekly_hours,
                                     'max_team', max_team, 'event_staff', event_staff, 'volunteer_history', volunteer_history)
             from plan_tiers where code = p_code),
    'note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;
revoke execute on function public.admin_update_package(text, text[], text[], integer, boolean, boolean, text, boolean) from public, anon;
grant execute on function public.admin_update_package(text, text[], text[], integer, boolean, boolean, text, boolean) to authenticated;

-- Retiring a package (from 20270127000000_package_create_retire.sql) also takes it off the website and takes off
-- Recommended. Bringing it back leaves it hidden until an admin shows it again. The last card on a live pricing
-- page can't be retired (the page would be empty).
create or replace function public.admin_set_package_retired(p_code text, p_retired boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  before plan_tiers;
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can change packages' using errcode = '42501';
  end if;
  select * into before from plan_tiers where code = p_code and kind = 'package' for update;
  if before.code is null then
    raise exception 'That package doesn''t exist' using errcode = 'P0001';
  end if;
  if p_retired and p_code in ('free_teacher', 'free', 'event') then
    raise exception '% can''t be retired: new accounts and teachers start on it', before.name using errcode = 'P0001';
  end if;
  if (before.retired_at is not null) = p_retired then
    return;
  end if;
  if p_retired and before.show_on_website and cardinality(before.event_types) > 0
     and coalesce((select pricing_page_live from site_settings where id), false)
     and public.pricing_card_count() <= 1 then
    raise exception '% is the last package on the live pricing page. Show another package first, or switch the page off',
      before.name using errcode = 'P0001';
  end if;
  update plan_tiers
     set retired_at = case when p_retired then now() end,
         show_on_website = case when p_retired then false else show_on_website end,
         recommended = case when p_retired then false else recommended end
   where code = p_code;
  insert into admin_log (admin_id, action, details)
  values (auth.uid(), case when p_retired then 'package_retired' else 'package_restored' end, jsonb_build_object(
    'code', p_code, 'name', before.name, 'was_on_website', before.show_on_website,
    'note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;
revoke execute on function public.admin_set_package_retired(text, boolean, text) from public, anon;
grant execute on function public.admin_set_package_retired(text, boolean, text) to authenticated;
-- admin_create_package lists the columns it copies, so a new package starts hidden, with no "Best for" and not
-- recommended (the column defaults). Unchanged here; security_test.sql checks it.

-- 6. Upgrade suggestions name only packages and passes on the website -----------------------------------------
-- The smallest shown, unretired paid package that does what's asked (from 20261223000000_packages.sql), or null.
create or replace function public.upgrade_for(p_type text, p_feature text default null)
returns text
language sql stable security definer set search_path = public
as $$
  select name from plan_tiers
   where kind = 'package' and show_on_website and retired_at is null and code not in ('free', 'free_teacher')
     and (p_type is null or (p_type = any (event_types) and not p_type = any (one_at_a_time)))
     and (p_feature is null
          or (p_feature = 'weekly_hours' and weekly_hours)
          or (p_feature = 'event_staff' and event_staff)
          or (p_feature = 'volunteer_history' and volunteer_history))
   order by sort, code limit 1;
$$;
revoke execute on function public.upgrade_for(text, text) from public, anon, authenticated;

-- A list of kinds of event in words, in the order given, with an Oxford comma: "volunteer events and meetings",
-- "band contests, school fairs, and meetings".
create or replace function public.event_types_words(p_types text[])
returns text
language sql immutable set search_path = public
as $$
  select case
    when n = 0 then 'nothing'
    when n = 1 then w[1]
    when n = 2 then w[1] || ' and ' || w[2]
    else array_to_string(w[1:n - 1], ', ') || ', and ' || w[n]
  end
  from (select coalesce(array_agg(public.event_type_words(t, true) order by o), '{}') as w, count(*)::int as n
          from unnest(coalesce(p_types, '{}')) with ordinality as x(t, o)) x;
$$;

-- Why this event can't be published (from 20270104000000_drafts_any_type.sql). The pass offer names a pass only
-- when one is on the website, and each message has a way forward when no package fits. A lapsed plan names what
-- Free publishes now (from the Free package, not a fixed list) and offers a pass when one is shown.
create or replace function public.org_publish_reason(p_org uuid, p_type text, p_event uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  tier plan_tiers := public.org_tier(p_org);
  chosen text;
  other text;
  pass_price integer;
  up text;
begin
  if tier.code is null then
    return 'That account wasn''t found.';
  end if;
  chosen := (select package from organizations where id = p_org);
  if not p_type = any (tier.event_types) then
    if public.org_pass_for(p_org, p_type, p_event) is not null then
      return null;
    end if;
    pass_price := (select price_cents from plan_tiers
                    where kind = 'pass' and show_on_website and p_type = any (event_types) order by sort, code limit 1);
    if chosen <> tier.code then
      return format('Your %s plan isn''t active right now, so you can publish %s only. %s',
                    (select name from plan_tiers where code = chosen), public.event_types_words(tier.event_types),
                    case when pass_price is not null
                         then format('Add a %s pass, or write to us to renew it.', public.event_type_words(p_type))
                         else 'Write to us to renew it.' end);
    end if;
    up := public.upgrade_for(p_type);
    if pass_price is not null then
      return format('Your %s plan doesn''t include %s. Add a %s pass or %s.',
                    tier.name, public.event_type_words(p_type, true), public.event_type_words(p_type),
                    coalesce('upgrade to ' || up, 'write to us about a plan that includes them'));
    end if;
    return format('Your %s plan doesn''t include %s. %s', tier.name, public.event_type_words(p_type, true),
                  coalesce('Upgrade to ' || up || '.', 'Write to us about a plan that includes them.'));
  end if;
  if p_type in ('conference', 'meeting') and not tier.weekly_hours
     and exists (select 1 from conference_settings where event_id = p_event and schedule = 'weekly') then
    up := public.upgrade_for(p_type, 'weekly_hours');
    return format('Your %s plan doesn''t include weekly hours. %s', tier.name,
                  coalesce('Upgrade to ' || up || ' for them.', 'Write to us about a plan that includes them.'));
  end if;
  if p_type = any (tier.one_at_a_time) then
    select name into other from events
     where organization_id = p_org and event_type::text = p_type and status = 'published' and id is distinct from p_event
       and ends_on >= (now() at time zone timezone)::date
     order by starts_on limit 1;
    if other is not null then
      up := public.upgrade_for(p_type);
      return format('Your %s plan publishes one %s at a time, and %s is published. You can publish this one after %s ends%s.',
                    tier.name, public.event_type_words(p_type), other, other, coalesce(', or upgrade to ' || up, ''));
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.org_publish_reason(uuid, text, uuid) from public, anon, authenticated;

-- Why this person can't join the team (from 20270116000000_team_full_for_leads.sql): "a bigger team" names only a
-- shown, unretired paid package.
create or replace function public.team_add_reason(p_org uuid, p_user uuid, p_email text, p_staff boolean)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  tier plan_tiers := public.package_tier(p_org);
  addr text := lower(coalesce(p_email, (select email::text from profiles where id = p_user), ''));
  bigger text;
  staff_plan text;
begin
  if tier.code is null or addr like '%@demo.fieldcommandevents.com' then
    return null;
  end if;
  if p_staff and not tier.event_staff then
    staff_plan := public.upgrade_for(null, 'event_staff');
    return format('Your %s plan doesn''t include Volunteer Leads or Coordinators. %s', tier.name,
                  coalesce(staff_plan || ' includes them. See your plan on the Account page.', 'Write to us about a plan that does.'));
  end if;
  -- Already holding a spot (on the team, or invited): adding them again doesn't take another.
  if addr <> '' and addr in (select public.org_team(p_org)) then
    return null;
  end if;
  if tier.max_team is not null and (select count(*) from public.org_team(p_org)) >= tier.max_team then
    select name into bigger from plan_tiers
     where kind = 'package' and show_on_website and retired_at is null and code not in ('free', 'free_teacher')
       and (max_team is null or max_team > tier.max_team)
     order by sort, code limit 1;
    return format('Your team is full: your %s plan includes %s team spots, and an invitation takes one as soon as it''s sent. Remove someone or cancel an invitation to free a spot%s',
                  tier.name, tier.max_team,
                  coalesce(', or move to ' || bigger || ' for more spots.', ', or write to us about a bigger team.'));
  end if;
  return null;
end;
$$;

-- Volunteer tracking for a package without it (from 20261223000000_packages.sql): never "Upgrade to  to see it."
create or replace function public.volunteer_report(p_org uuid)
returns table (email text, full_name text, events int, signed_up int, checked_in int, last_event_name text, last_event_on date)
language plpgsql stable security definer set search_path = public
as $$
declare
  tier plan_tiers := public.package_tier(p_org);
begin
  if not public.can_see_volunteer_history(p_org) then
    raise exception 'Only the account''s hosts and Volunteer Leads can see volunteer history.' using errcode = '42501';
  end if;
  if not public.volunteer_tracking_open(p_org) then
    raise exception 'Your % plan doesn''t include volunteer tracking. %', tier.name,
      coalesce('Upgrade to ' || public.upgrade_for(null, 'volunteer_history') || ' to see it.', 'Write to us about a plan that includes it.')
      using errcode = '42501';
  end if;
  return query select * from public.volunteer_history_export(p_org);
end;
$$;

-- 7. Requests from the pricing page ---------------------------------------------------------------------------
-- Its own table, not pilot_requests: those are pipeline leads (phone required, invited / set up / active, a
-- pilot plan), while these are questions about a package or pass from anyone, signed in or not, that an admin
-- answers and marks handled.
create table if not exists public.pricing_requests (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 200),
  email            text not null check (char_length(email) between 3 and 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  organization     text not null check (char_length(organization) between 2 and 200),
  -- The kinds of event picked on the page (event types, or 'other').
  event_types      text[] not null default '{}' check (cardinality(event_types) <= 10),
  -- The package or pass asked about; null for a general question.
  plan_code        text references public.plan_tiers (code) on update cascade on delete set null,
  -- "I'm a classroom teacher": a person checks it before the teacher rate is applied.
  teacher_rate     boolean not null default false,
  -- Paying by invoice or purchase order.
  pay_by_invoice   boolean not null default false,
  message          text check (char_length(message) <= 2000),
  -- Who sent it, when signed in, and their account (only one they're on).
  user_id          uuid references auth.users (id) on delete set null,
  organization_id  uuid references public.organizations (id) on delete set null,
  created_at       timestamptz not null default now(),
  handled_at       timestamptz,
  handled_by       uuid references auth.users (id) on delete set null
);
-- Their role on that account when they sent it: 'owner' is the Account Host; anyone else ('admin', a Co-host) is
-- shown as "Not the Account Host", since only the Account Host chooses a package.
alter table public.pricing_requests add column if not exists account_role text;
do $$ begin
  alter table public.pricing_requests add constraint pricing_requests_account_role_check
    check (account_role is null or (account_role in ('owner', 'admin') and organization_id is not null));
exception when duplicate_object then null;
end $$;
create index if not exists pricing_requests_created_at_idx on public.pricing_requests (created_at desc);
create index if not exists pricing_requests_email_idx on public.pricing_requests (lower(email), created_at desc);

alter table public.pricing_requests enable row level security;
revoke all on public.pricing_requests from public, anon, authenticated;
grant select on public.pricing_requests to authenticated;
grant select, insert, update, delete on public.pricing_requests to service_role;
drop policy if exists "Platform admins read pricing requests" on public.pricing_requests;
create policy "Platform admins read pricing requests" on public.pricing_requests
  for select to authenticated using (public.is_platform_admin());

-- Send a request. The only way in for visitors and signed-in people (the server action checks the bot traps and
-- the form first). Returns {"id", "status", "alert"}:
--   'saved'      saved; the server action emails it to the admins.
--   'duplicate'  the same email asked about the same package or pass (or both about nothing) in the last hour: a
--                double tap or the back button. Nothing new is saved or emailed. A package and then a pass both go in.
--   'limit'      3 requests from this email in the last hour already: nothing saved; the person is asked to wait or
--                email us. One address can't flood the list.
--   'quiet'      saved, but more than 30 came in from everyone in the last hour: no email for this one, so a script
--                can't flood the admins' inboxes, and real requests are never lost. "alert" is true for the first one
--                past the limit, so the server action sends the admins one warning instead.
-- An account is attached only when the signed-in person is on it, with their role there (account_role).
create or replace function public.submit_pricing_request(
  p_name text,
  p_email text,
  p_organization text,
  p_event_types text[],
  p_plan_code text,
  p_teacher_rate boolean,
  p_pay_by_invoice boolean,
  p_message text,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_org text := btrim(coalesce(p_organization, ''));
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  known text[] := (select array_agg(t::text) from unnest(enum_range(null::public.event_type)) t) || '{other}'::text[];
  v_types text[];
  plan plan_tiers;
  existing uuid;
  v_role text;
  hour_count int;
  new_id uuid;
begin
  if not coalesce((select pricing_page_live from site_settings where id), false) and not public.is_platform_admin() then
    raise exception 'The pricing page isn''t open yet' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 200 then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Please enter a valid email address, like name@example.org.' using errcode = 'P0001';
  end if;
  if char_length(v_org) not between 2 and 200 then
    raise exception 'Please enter your school or group.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(v_message, '')) > 2000 then
    raise exception 'Please keep your message under 2,000 characters.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_types from unnest(coalesce(p_event_types, '{}')) t;
  if not v_types <@ known then
    raise exception 'Pick kinds of event from the list.' using errcode = 'P0001';
  end if;
  if p_plan_code is not null then
    -- Only what the page shows: a shown pass, or a shown, unretired paid package with kinds of event.
    select * into plan from plan_tiers
     where code = p_plan_code and show_on_website
       and (kind = 'pass' or (retired_at is null and code not in ('free', 'free_teacher') and cardinality(event_types) > 0));
    if plan.code is null then
      raise exception 'That package isn''t offered. Pick another, or ask without one.' using errcode = 'P0001';
    end if;
  end if;
  if auth.uid() is not null and p_organization_id is not null then
    select m.role::text into v_role from organization_members m
     where m.organization_id = p_organization_id and m.user_id = auth.uid();
  end if;

  -- One at a time, so two requests at once can't both slip under the limits.
  perform pg_advisory_xact_lock(hashtext('pricing_requests'));
  select id into existing from pricing_requests
   where lower(email) = v_email and plan_code is not distinct from plan.code and created_at > now() - interval '1 hour'
   order by created_at desc limit 1;
  if existing is not null then
    return jsonb_build_object('id', existing, 'status', 'duplicate', 'alert', false);
  end if;
  if (select count(*) from pricing_requests where lower(email) = v_email and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('id', null, 'status', 'limit', 'alert', false);
  end if;
  hour_count := (select count(*) from pricing_requests where created_at > now() - interval '1 hour');

  insert into pricing_requests (name, email, organization, event_types, plan_code, teacher_rate, pay_by_invoice, message,
                                user_id, organization_id, account_role)
  values (v_name, v_email, v_org, v_types, plan.code,
          -- The teacher rate is for packages; a pass has one price.
          coalesce(p_teacher_rate, false) and coalesce(plan.kind, 'package') = 'package', coalesce(p_pay_by_invoice, false), v_message,
          auth.uid(),
          case when v_role is not null then p_organization_id end,
          v_role)
  returning id into new_id;
  return jsonb_build_object('id', new_id,
                            'status', case when hour_count >= 30 then 'quiet' else 'saved' end,
                            'alert', hour_count = 30);
end;
$$;
revoke execute on function public.submit_pricing_request(text, text, text, text[], text, boolean, boolean, text, uuid) from public;
grant execute on function public.submit_pricing_request(text, text, text, text[], text, boolean, boolean, text, uuid)
  to anon, authenticated, service_role;

-- Mark a request handled (or not). Admins only; logged.
create or replace function public.admin_set_pricing_request_handled(p_id uuid, p_handled boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r pricing_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can change pricing requests' using errcode = '42501';
  end if;
  select * into r from pricing_requests where id = p_id for update;
  if r.id is null then
    raise exception 'That request doesn''t exist' using errcode = 'P0001';
  end if;
  if (r.handled_at is not null) = coalesce(p_handled, false) then
    return;
  end if;
  update pricing_requests
     set handled_at = case when p_handled then now() end,
         handled_by = case when p_handled then auth.uid() end
   where id = p_id;
  insert into admin_log (admin_id, action, organization_id, details)
  values (auth.uid(), case when p_handled then 'pricing_request_handled' else 'pricing_request_reopened' end, r.organization_id,
          jsonb_build_object('request', p_id, 'email', r.email, 'plan_code', r.plan_code));
end;
$$;
revoke execute on function public.admin_set_pricing_request_handled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_pricing_request_handled(uuid, boolean) to authenticated;

-- Kept a year, like pilot requests that never became an account (the daily retention job, src/lib/retention.ts).
create or replace function public.purge_pricing_requests()
returns integer
language sql security definer set search_path = public
as $$
  with gone as (
    delete from pricing_requests where created_at < now() - interval '1 year' returning 1
  )
  select count(*)::int from gone;
$$;
revoke execute on function public.purge_pricing_requests() from public, anon, authenticated;
grant execute on function public.purge_pricing_requests() to service_role;

-- 8. "Ask your Account Host" -----------------------------------------------------------------------------------
-- A team member who isn't the Account Host asks them to choose a package; the app emails the Account Host. Each
-- person can ask about each package (or about packages in general) once a day, so the button can't be used to
-- flood someone's inbox. One row per ask; rows older than a week are cleared as new ones come in.
create table if not exists public.account_host_asks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- The package or pass asked about; '' for packages in general.
  plan_code  text not null default '',
  -- The day, in Chicago (like the pilot's dates).
  asked_on   date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, plan_code, asked_on)
);
alter table public.account_host_asks enable row level security;
revoke all on public.account_host_asks from public, anon, authenticated;
grant select, insert, delete on public.account_host_asks to service_role;

-- Record an ask before the email goes out. Returns 'ok' (send it) or 'already' (asked about this today: don't send
-- again). Only signed-in people on a team, only while the page is live (admins can try it in the preview), and
-- only about a package or pass the page shows.
create or replace function public.record_account_host_ask(p_plan_code text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text := coalesce(nullif(btrim(coalesce(p_plan_code, '')), ''), '');
  today date := (now() at time zone 'America/Chicago')::date;
  added int;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again, then try once more.' using errcode = '42501';
  end if;
  if not coalesce((select pricing_page_live from site_settings where id), false) and not public.is_platform_admin() then
    raise exception 'The pricing page isn''t open yet' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'Only someone on an account''s team can ask its Account Host.' using errcode = '42501';
  end if;
  if v_code <> '' and not exists (
       select 1 from plan_tiers
        where code = v_code and show_on_website
          and (kind = 'pass' or (retired_at is null and code not in ('free', 'free_teacher') and cardinality(event_types) > 0))) then
    raise exception 'That package isn''t offered. Pick another, or ask about packages in general.' using errcode = 'P0001';
  end if;
  delete from account_host_asks where asked_on < today - 7;
  insert into account_host_asks (user_id, plan_code, asked_on) values (auth.uid(), v_code, today)
  on conflict do nothing;
  get diagnostics added = row_count;
  return case when added = 1 then 'ok' else 'already' end;
end;
$$;
revoke execute on function public.record_account_host_ask(text) from public, anon;
grant execute on function public.record_account_host_ask(text) to authenticated;

-- If the email couldn't be sent, take the ask back so they can try again today.
create or replace function public.forget_account_host_ask(p_plan_code text)
returns void
language sql security definer set search_path = public
as $$
  delete from account_host_asks
   where user_id = auth.uid() and plan_code = coalesce(nullif(btrim(coalesce(p_plan_code, '')), ''), '')
     and asked_on = (now() at time zone 'America/Chicago')::date;
$$;
revoke execute on function public.forget_account_host_ask(text) from public, anon;
grant execute on function public.forget_account_host_ask(text) to authenticated;
