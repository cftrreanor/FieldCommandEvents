-- =============================================================================
-- New packages and retiring packages (issue #345, owner 2026-11-10).
--
--   * admin_create_package: a new package, named by the admin and copied from an existing one (event types,
--     one-at-a-time types, weekly hours, team spots, Volunteer Leads and Coordinators, volunteer tracking).
--     Prices start "Not set". No account is moved onto it.
--   * admin_set_package_retired: a retired package stays on the accounts already on it, but can't be given to
--     another account, an invitation, or a pilot request's plan. It can be brought back.
--   * Free Teacher, Free, and Event Command can't be retired: new accounts and teachers start on them.
--
-- Every change is checked here, logged in admin_log, and only platform admins can make it.
-- =============================================================================

alter table public.plan_tiers add column retired_at timestamptz;

-- A short code from the name ("Booster Command" -> "booster_command"), made unique with a number if needed.
create function public.package_code_for(p_name text)
returns text
language plpgsql stable set search_path = public
as $$
declare
  base text := trim(both '_' from regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g'));
  candidate text;
  n int := 1;
begin
  if base = '' then base := 'package'; end if;
  base := left(base, 40);
  candidate := base;
  while exists (select 1 from plan_tiers where code = candidate) loop
    n := n + 1;
    candidate := base || '_' || n;
  end loop;
  return candidate;
end;
$$;
revoke execute on function public.package_code_for(text) from public, anon, authenticated;

create function public.admin_create_package(p_name text, p_from text, p_note text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  clean text := trim(coalesce(p_name, ''));
  source plan_tiers;
  new_code text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only Field Command Events admins can change packages' using errcode = '42501';
  end if;
  if length(clean) < 2 or length(clean) > 60 then
    raise exception 'Give the package a name of 2 to 60 characters' using errcode = 'P0001';
  end if;
  if exists (select 1 from plan_tiers where lower(name) = lower(clean)) then
    raise exception 'Another package or pass already has that name' using errcode = 'P0001';
  end if;
  select * into source from plan_tiers where code = p_from and kind = 'package';
  if source.code is null then
    raise exception 'Pick a package to start from' using errcode = 'P0001';
  end if;
  new_code := public.package_code_for(clean);
  insert into plan_tiers (code, kind, name, event_types, one_at_a_time, weekly_hours, max_team, event_staff,
                          volunteer_history, teacher_rate, sort)
  values (new_code, 'package', clean, source.event_types, source.one_at_a_time, source.weekly_hours, source.max_team,
          source.event_staff, source.volunteer_history, source.teacher_rate,
          coalesce((select max(sort) from plan_tiers where kind = 'package'), 0) + 10);
  insert into admin_log (admin_id, action, details)
  values (auth.uid(), 'package_created', jsonb_build_object(
    'code', new_code, 'name', clean, 'from', p_from, 'note', nullif(trim(coalesce(p_note, '')), '')));
  return new_code;
end;
$$;
revoke execute on function public.admin_create_package(text, text, text) from public, anon;
grant execute on function public.admin_create_package(text, text, text) to authenticated;

create function public.admin_set_package_retired(p_code text, p_retired boolean, p_note text default null)
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
  update plan_tiers set retired_at = case when p_retired then now() end where code = p_code;
  insert into admin_log (admin_id, action, details)
  values (auth.uid(), case when p_retired then 'package_retired' else 'package_restored' end, jsonb_build_object(
    'code', p_code, 'name', before.name, 'note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;
revoke execute on function public.admin_set_package_retired(text, boolean, text) from public, anon;
grant execute on function public.admin_set_package_retired(text, boolean, text) to authenticated;

-- A retired package is never newly given: not to an account, an invitation, or a pilot request's plan.
-- Rows already on it keep it (only a change *to* it is refused). An invitation sent before the package was
-- retired still starts its host on it: accepting it sets app.invitation_package for that one step.
create function public.retired_package_check()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  col text := tg_argv[0];
  new_pkg text := to_jsonb(new) ->> col;
  old_pkg text := case when tg_op = 'UPDATE' then to_jsonb(old) ->> col end;
begin
  if tg_table_name = 'organizations' and current_setting('app.invitation_package', true) = 'on' then
    return new;
  end if;
  if new_pkg is not null and new_pkg is distinct from old_pkg
     and exists (select 1 from plan_tiers where code = new_pkg and retired_at is not null) then
    raise exception '% is retired. Pick another package.', (select name from plan_tiers where code = new_pkg)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.retired_package_check() from public, anon, authenticated;

create trigger organizations_retired_package before insert or update of package on public.organizations
  for each row execute function public.retired_package_check('package');
create trigger host_invitations_retired_package before insert or update of package on public.host_invitations
  for each row execute function public.retired_package_check('package');
create trigger pilot_requests_retired_package before insert or update of planned_package on public.pilot_requests
  for each row execute function public.retired_package_check('planned_package');

-- Accepting an invitation: its package was promised when it was sent, so a later retirement doesn't block it.
create or replace function public.apply_invitation_plan(p_org uuid, inv public.host_invitations)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if inv.plan_status is not null then
    perform public.apply_plan(p_org, inv.plan_status, inv.free_until, 'Set from host invitation', inv.invited_by);
  end if;
  if inv.package is not null then
    perform set_config('app.invitation_package', 'on', true);
    perform public.apply_package(p_org, inv.package, (select rate from organizations where id = p_org),
                                 'Set from host invitation', 'admin', inv.invited_by);
    perform set_config('app.invitation_package', 'off', true);
  end if;
  update pilot_requests r
     set organization = left(coalesce(nullif(trim(o.school), ''), o.name), 200)
    from organizations o
   where o.id = p_org and r.id = inv.pilot_request_id and r.organization = r.name;
end;
$$;
revoke execute on function public.apply_invitation_plan(uuid, public.host_invitations) from public, anon, authenticated;
