-- =============================================================================
-- Demo mode: sample sponsors (owner, 2026-11-12).
--
--   * When a platform admin demos a band contest, festival (group_event), or school fair on an account with
--     the Sponsors add-on on, the event gets made-up sponsors (levels, logos, websites, one "Presented by"),
--     so the sponsor pages and the public page's thank-you section can be shown.
--   * The server makes the logo files (src/lib/demo-sponsors.ts) and then calls demo_seed_sponsors, which
--     adds the rows and lists them in demo_samples. It adds nothing when the event already has sponsors, the
--     add-on is off, or the event is another kind. If the event already has levels, the samples go into them.
--   * demo_leave takes the sample sponsors and levels back off (sponsors added during the demo that sit in a
--     sample level move to the event's first other level, or to no level). Their logo files are left for the
--     daily job's orphan sweep (sponsor_logo_orphans).
--   * Server-only, like the rest of demo mode.
--
-- Safe to run twice.
-- =============================================================================

alter table public.demo_samples drop constraint if exists demo_samples_kind_check;
alter table public.demo_samples add constraint demo_samples_kind_check
  check (kind in ('station', 'volunteer', 'band', 'room', 'parent', 'booth', 'booking', 'conference', 'sponsor', 'sponsor_level'));

-- p_levels: ["Gold", "Silver", ...] (best first, at most 4). p_sponsors: [{name, level (index into p_levels),
-- website, logo_path, logo_width, logo_height, presented_by}] in display order. True when the samples were added.
create or replace function public.demo_seed_sponsors(p_owner uuid, p_event uuid, p_levels jsonb, p_sponsors jsonb)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  ev record;
  level_ids uuid[] := '{}';
  existing uuid[];
  lvl uuid;
  s jsonb;
  i int;
  new_id uuid;
  pos int := 0;
begin
  if not exists (select 1 from demo_events where owner_id = p_owner and event_id = p_event) then
    raise exception 'Demo mode is not on for this event' using errcode = 'P0001';
  end if;
  select id, organization_id, event_type into ev from events where id = p_event;
  if ev.id is null or ev.event_type::text not in ('band_contest', 'group_event', 'fair') or not public.org_sponsors_on(ev.organization_id) then
    return false;
  end if;
  -- Once per demo, and never next to the event's own sponsors.
  if exists (select 1 from demo_samples where owner_id = p_owner and event_id = p_event and kind in ('sponsor', 'sponsor_level'))
     or exists (select 1 from sponsors where event_id = p_event and removed_at is null) then
    return false;
  end if;
  -- Serialize with a second switch at the same moment.
  perform 1 from events where id = p_event for update;
  if exists (select 1 from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'sponsor') then
    return false;
  end if;

  select coalesce(array_agg(id order by position, name), '{}') into existing from sponsor_levels where event_id = p_event;
  if cardinality(existing) > 0 then
    -- The event's own levels: sample level i goes into its i-th level (or its last).
    for i in 0 .. greatest(jsonb_array_length(coalesce(p_levels, '[]')) - 1, 0) loop
      level_ids := level_ids || existing[least(i + 1, cardinality(existing))];
    end loop;
  else
    for i in 0 .. least(jsonb_array_length(coalesce(p_levels, '[]')), 4) - 1 loop
      insert into sponsor_levels (event_id, name, position)
      values (p_event, left(btrim(p_levels ->> i), 40), i + 1)
      returning id into lvl;
      insert into demo_samples (owner_id, event_id, kind, row_id) values (p_owner, p_event, 'sponsor_level', lvl);
      level_ids := level_ids || lvl;
    end loop;
  end if;

  for s in select value from jsonb_array_elements(coalesce(p_sponsors, '[]')) loop
    pos := pos + 1;
    lvl := case when cardinality(level_ids) = 0 or s ->> 'level' is null then null
                else level_ids[least((s ->> 'level')::int + 1, cardinality(level_ids))] end;
    insert into sponsors (event_id, level_id, name, logo_path, logo_width, logo_height, website, position, show_public, presented_by)
    values (p_event, lvl, left(btrim(s ->> 'name'), 100), s ->> 'logo_path',
            case when s ->> 'logo_path' is null then null else (s ->> 'logo_width')::int end,
            case when s ->> 'logo_path' is null then null else (s ->> 'logo_height')::int end,
            s ->> 'website', pos, true,
            coalesce((s ->> 'presented_by')::boolean, false)
              and not exists (select 1 from sponsors where event_id = p_event and presented_by and removed_at is null))
    returning id into new_id;
    insert into demo_samples (owner_id, event_id, kind, row_id) values (p_owner, p_event, 'sponsor', new_id);
  end loop;
  return true;
end;
$$;
revoke execute on function public.demo_seed_sponsors(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.demo_seed_sponsors(uuid, uuid, jsonb, jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.demo_leave(p_owner uuid, p_event uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org uuid;
begin
  select organization_id into org from events where id = p_event;
  -- Sample jobs go whole, sign-ups and all (see signups_block_delete).
  perform set_config('app.cleaning_up', 'on', true);

  -- Sample data (stations take their shifts and sign-ups with them).
  delete from volunteers where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'volunteer');
  delete from stations where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'station');
  delete from bands where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'band');
  delete from rooms where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'room');
  delete from parent_registrations where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'parent');
  delete from fair_booths where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'booth');
  delete from conference_bookings where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'booking');
  delete from conference_settings where event_id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'conference');
  -- Sample sponsors, then their levels (anything added during the demo in a sample level moves out first).
  delete from sponsors where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'sponsor');
  update sponsors s
     set level_id = (select l.id from sponsor_levels l
                      where l.event_id = p_event
                        and l.id not in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'sponsor_level')
                      order by l.position, l.name limit 1),
         updated_at = now()
   where s.event_id = p_event
     and s.level_id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'sponsor_level');
  delete from sponsor_levels where id in (select row_id from demo_samples where owner_id = p_owner and event_id = p_event and kind = 'sponsor_level');
  delete from demo_samples where owner_id = p_owner and event_id = p_event;

  -- Free the demo volunteer's shift spots.
  update shifts s set registered_count = greatest(0, s.registered_count - n.cnt)
    from (
      select va.shift_id, count(*) as cnt
        from volunteer_assignments va
        join volunteers v on v.id = va.volunteer_id
        join profiles p on p.email = v.email
        join demo_accounts d on d.user_id = p.id and d.owner_id = p_owner
       where v.event_id = p_event
       group by va.shift_id
    ) n
   where s.id = n.shift_id;
  delete from volunteers v using profiles p, demo_accounts d
   where v.event_id = p_event and p.email = v.email and d.user_id = p.id and d.owner_id = p_owner;

  delete from bands b using demo_accounts d
   where b.event_id = p_event and b.director_user_id = d.user_id and d.owner_id = p_owner;
  delete from station_leads l using demo_accounts d
   where l.event_id = p_event and l.user_id = d.user_id and d.owner_id = p_owner;
  delete from event_staff s using demo_accounts d
   where s.event_id = p_event and s.user_id = d.user_id and d.owner_id = p_owner;
  -- The demo host leaves the organization unless it's demoing another of its events.
  delete from organization_members m using demo_accounts d
   where m.organization_id = org and m.user_id = d.user_id and d.owner_id = p_owner
     and not exists (
       select 1 from demo_events de join events e on e.id = de.event_id
        where de.owner_id = p_owner and de.event_id <> p_event and e.organization_id = org
     );

  -- Demo people don't linger on the Team page's "Removed" tab.
  delete from team_removals t using demo_accounts d
   where t.organization_id = org and t.user_id = d.user_id and d.owner_id = p_owner;

  delete from demo_events where owner_id = p_owner and event_id = p_event;
end;
$function$;
revoke execute on function public.demo_leave(uuid, uuid) from public, anon, authenticated;
grant execute on function public.demo_leave(uuid, uuid) to service_role;
