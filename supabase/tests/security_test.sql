-- Behavioural tests for the core schema: capacity locking, time-gated contact
-- details and role permissions. Run with: npm run test:db
-- Every check raises an exception on failure, so the script stops at the first
-- broken rule.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'host@example.com',     '{"full_name":"Hana Host"}'),
  ('00000000-0000-0000-0000-000000000002', 'director@example.com', '{"full_name":"Dee Director"}'),
  ('00000000-0000-0000-0000-000000000003', 'lead@example.com',     '{"full_name":"Lee Lead","phone":"+15125550103"}'),
  ('00000000-0000-0000-0000-000000000004', 'vol1@example.com',     '{"full_name":"Val One"}'),
  ('00000000-0000-0000-0000-000000000005', 'band@example.com',     '{"full_name":"Bo Band"}'),
  ('00000000-0000-0000-0000-000000000006', 'stranger@example.com', '{"full_name":"Sam Stranger"}'),
  ('00000000-0000-0000-0000-000000000007', 'newlead@example.com',  '{"full_name":"Nia Newlead"}');

do $$ begin
  assert (select count(*) from public.profiles) = 7, 'profiles are created from auth.users';
end $$;

-- Hosts are invited by FieldCommand: without an invitation, nobody can create an organization.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not public.has_host_invitation(), 'no invitation for a stranger';
  begin
    perform public.create_organization('Stranger Boosters', 'stranger-boosters');
    raise exception 'FAIL: created an organization without an invitation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_invite_host('stranger@example.com');
    raise exception 'FAIL: a non-admin invited a host';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.host_invitations) = 0, 'invitations are hidden from non-admins';
end $$;
reset role;
insert into public.host_invitations (email) values ('host@example.com');

-- Organization without a plan, created through the RPC as the (invited) host.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
select public.has_host_invitation() as invited \gset
\if :invited
\else
  \echo 'FAIL: the invited host has no invitation'
  select 1/0;
\endif
select id from public.create_organization('Pflugerville Band Boosters', 'pf-boosters') \gset org_
do $$ begin
  assert not public.has_host_invitation(), 'an invitation is used up by creating the organization';
  begin
    perform public.create_organization('Second Boosters', 'second-boosters');
    raise exception 'FAIL: one invitation created two organizations';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A new account starts on the pilot; take it to "No plan" to check publishing needs one.
reset role;
update public.organizations set subscription_status = 'none', free_until = null;
set role authenticated;
do $$ declare new_event_id uuid; begin
  -- Drafts are free, and the host can read the new row back (the app uses
  -- INSERT ... RETURNING, which also has to pass the SELECT policies).
  insert into public.events (organization_id, name, slug, starts_on, ends_on, window_start, window_end, venue_address)
  values ((select id from public.organizations limit 1), 'X', 'xx', current_date, current_date, now(), now() + interval '1 hour', 'addr')
  returning id into new_event_id;
  assert new_event_id is not null, 'host reads back the event they created';
  -- ...but publishing needs a plan, whether on insert or by update.
  begin
    insert into public.events (organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address)
    values ((select id from public.organizations limit 1), 'Y', 'yy', 'published', current_date, current_date, now(), now() + interval '1 hour', 'addr');
    raise exception 'FAIL: published an event without an active plan';
  exception when insufficient_privilege then null; -- RLS rejection
  end;
  begin
    update public.events set status = 'published' where slug = 'xx';
    raise exception 'FAIL: published a draft without an active plan';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set email = 'hijack@example.com' where id = auth.uid();
    raise exception 'FAIL: user changed their own login email in profiles';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set full_name = 'Hana Host', phone = '+15125550101' where id = auth.uid();
  begin
    update public.organizations set subscription_status = 'active';
    raise exception 'FAIL: host changed their own billing status';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

delete from public.events where slug = 'xx';
update public.organizations set subscription_status = 'comped';

-- Two events: one 10 days out (contacts locked) and one today (unlocked).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end,
                           venue_address, volunteer_signup_open, band_registration_open)
values
  ('10000000-0000-0000-0000-00000000000a', :'org_id', 'Future Classic', 'future', 'published',
   current_date + 10, current_date + 10, now() + interval '10 days', now() + interval '10 days 15 hours',
   '1 Stadium Rd', true, true),
  ('10000000-0000-0000-0000-00000000000b', :'org_id', 'Today Invitational', 'today', 'published',
   (now() at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date,
   now() - interval '1 hour', now() + interval '10 hours', '2 Stadium Rd', true, true),
  ('10000000-0000-0000-0000-00000000000c', :'org_id', 'Secret Draft', 'draft', 'draft',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 5 hours',
   '3 Stadium Rd', false, false);

-- People join a team by accepting an invitation; set the team up directly here.
reset role;
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'volunteer_director'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'section_lead'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000003', 'section_lead');
set role authenticated;
-- A host can't add someone to the team without their say-so (their profile, email
-- and phone would then be readable by the host).
do $$ begin
  begin
    insert into public.event_staff (event_id, user_id, role)
    values ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000006', 'section_lead');
    raise exception 'FAIL: a host added a stranger to the team directly';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000006') = 0,
         'a host can''t read a stranger''s profile';
end $$;

insert into public.stations (id, event_id, name, station_type) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Parking', 'passive'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Warm-Up A', 'active_checkpoint');

insert into public.station_leads (station_id, user_id, event_id) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000b');

insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Morning Parking',
   now() + interval '10 days', now() + interval '10 days 3 hours', 1),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Overlapping Parking',
   now() + interval '10 days 1 hour', now() + interval '10 days 4 hours', 5),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000b', 'Warm-Up Crew',
   now(), now() + interval '3 hours', 5);

do $$ begin
  assert (select event_id from public.shifts where id = '30000000-0000-0000-0000-000000000003')
         = '10000000-0000-0000-0000-00000000000b', 'shift.event_id is derived from its station';
  begin
    update public.shifts set registered_count = 0;
    raise exception 'FAIL: user wrote registered_count';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Volunteer signup: capacity, overlap, all-or-nothing
-- ---------------------------------------------------------------------------
set role service_role;
select public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Val One', 'Vol1@Example.com', '+15125550104',
       array['30000000-0000-0000-0000-000000000001']::uuid[]);
select public.register_volunteer('10000000-0000-0000-0000-00000000000b', 'Val One', 'vol1@example.com', '+15125550104',
       array['30000000-0000-0000-0000-000000000003']::uuid[]);

do $$ begin
  begin
    perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Late Larry', 'larry@example.com', '+15125550199',
            array['30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001']::uuid[]);
    raise exception 'FAIL: overbooked a full shift';
  exception when sqlstate 'P0002' then null;
  end;
  assert (select registered_count from public.shifts where id = '30000000-0000-0000-0000-000000000002') = 0,
         'failed signup must not book any of the requested shifts';
  assert not exists (select 1 from public.volunteers where email = 'larry@example.com'),
         'failed signup must not leave a volunteer record behind';

  begin
    perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Val One', 'vol1@example.com', '+15125550104',
            array['30000000-0000-0000-0000-000000000002']::uuid[]);
    raise exception 'FAIL: allowed overlapping shifts';
  exception when sqlstate 'P0003' then null;
  end;

  begin
    perform public.register_volunteer('10000000-0000-0000-0000-00000000000c', 'Val One', 'vol1@example.com', '+15125550104',
            array[]::uuid[]);
    raise exception 'FAIL: signed up for an unpublished event';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
reset role;

do $$ begin
  assert (select registered_count from public.shifts where id = '30000000-0000-0000-0000-000000000001') = 1,
         'registered_count incremented';
end $$;

-- The browser (anon) cannot call signup directly.
set role anon;
do $$ begin
  begin
    perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'X', 'x@example.com', '1',
            array['30000000-0000-0000-0000-000000000002']::uuid[]);
    raise exception 'FAIL: anon called register_volunteer';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Time-gated contact details for Section Leads (PRD §6.2)
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ declare r record; begin
  select * into r from public.station_roster('20000000-0000-0000-0000-00000000000a');
  assert r.volunteer_name = 'Val One', 'lead sees names before event day';
  assert r.email is null and r.phone is null and r.contact_locked, 'lead must NOT see contacts before event day';

  select * into r from public.station_roster('20000000-0000-0000-0000-00000000000b');
  assert r.phone = '+15125550104' and not r.contact_locked, 'lead sees contacts on event day';

  assert (select count(*) from public.volunteers) = 0, 'lead has no direct access to the volunteers table';
end $$;

-- Volunteer Director always sees contacts.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ declare r record; begin
  select * into r from public.station_roster('20000000-0000-0000-0000-00000000000a');
  assert r.phone is not null, 'director sees contacts before event day';
  assert (select count(*) from public.volunteers) = 1, 'director sees their event''s volunteers only';
end $$;

-- A stranger is refused.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.station_roster('20000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: stranger read a roster';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.volunteers) = 0, 'stranger sees no volunteers';
  assert (select count(*) from public.my_agenda()) = 0, 'stranger has no agenda';
end $$;

-- ---------------------------------------------------------------------------
-- Volunteer dashboard
-- ---------------------------------------------------------------------------
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","email":"vol1@example.com"}';
do $$ declare n int; begin
  select count(*) into n from public.my_agenda();
  assert n = 2, format('volunteer sees one agenda across events (got %s)', n);
  assert (select lead_phone from public.my_agenda() limit 1) = '+15125550103', 'volunteer sees their lead''s phone';
  assert (select count(*) from public.volunteers) = 2, 'volunteer reads only their own records';
end $$;

-- Volunteer cancels their own shift; the slot is released.
select public.cancel_assignment(va.id)
  from public.volunteer_assignments va where va.shift_id = '30000000-0000-0000-0000-000000000001';
reset role;
do $$ begin
  assert (select registered_count from public.shifts where id = '30000000-0000-0000-0000-000000000001') = 0,
         'cancel releases the slot';
end $$;

-- ---------------------------------------------------------------------------
-- Bands
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  begin
    insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                              contact_email, head_director_name, head_director_email, head_director_phone,
                              student_count, chaperone_count)
    values ('10000000-0000-0000-0000-00000000000a', auth.uid(), 'Central HS', 'Mighty Marching', '5A', 'addr',
            'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 120, 26);
    raise exception 'FAIL: allowed 26 chaperones';
  exception when check_violation then null;
  end;
end $$;

insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count, bus_count)
values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-000000000005', 'Central HS', 'Mighty Marching', '5A', 'addr',
        'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 120, 25, 3);

do $$ begin
  begin
    update public.bands set buses_at = now();
    raise exception 'FAIL: director changed their contest-day status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000001', 'scratched');
    raise exception 'FAIL: director scratched their own band';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Host drafts the performance order privately.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.performance_slots (band_id, event_id, performance_order)
values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 1);

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.performance_slots) = 0, 'order hidden until published';
end $$;

-- Checkpoint lead (of an active checkpoint) moves the band along.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000001', 'here', '20000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: a band was tapped in at a regular (non-check-in) station';
  exception when raise_exception then null;
  end;
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set performance_order_published = true where id = '10000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- Announcements and the public view
-- ---------------------------------------------------------------------------
insert into public.announcements (event_id, sender_id, audiences, priority, body) values
  ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{public}', 'emergency', 'Lightning — take shelter'),
  ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{volunteers}', 'routine', 'Lunch is ready');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  begin
    insert into public.announcements (event_id, sender_id, audiences, body)
    values ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{public}', 'Hi everyone');
    raise exception 'FAIL: volunteer director sent a global broadcast';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role anon;
set request.jwt.claims = '';
do $$ begin
  assert (select count(*) from public.events) = 2, 'public sees published events only';
  assert (select count(*) from public.announcements) = 1, 'public sees public announcements only';
  assert (select count(*) from public.performance_slots) = 1, 'public sees the published order';
  assert (select count(*) from public.bands) = 0, 'public sees no band registration details';
  begin
    perform 1 from public.volunteers;
    raise exception 'FAIL: the public read the volunteers table';
  exception when insufficient_privilege then null; -- no access at all
  end;
end $$;
reset role;


-- ---------------------------------------------------------------------------
-- Team invitations
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.invitations (event_id, email, role, station_id, invited_by)
values ('10000000-0000-0000-0000-00000000000a', 'NewLead@example.com', 'section_lead',
        '20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001');
select token from public.invitations where email = 'newlead@example.com' \gset inv_

do $$ begin
  begin
    insert into public.invitations (event_id, email, role, station_id, invited_by)
    values ('10000000-0000-0000-0000-00000000000a', 'x@example.com', 'section_lead',
            '20000000-0000-0000-0000-00000000000b', auth.uid());
    raise exception 'FAIL: invited a lead to another event''s station';
  exception when check_violation then null;
  end;
  begin
    insert into public.station_leads (station_id, user_id, event_id)
    values ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: made a non-team member a station lead';
  exception when check_violation then null;
  end;
end $$;

-- A Volunteer Director can invite leads but not other directors.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  insert into public.invitations (event_id, email, role, invited_by)
  values ('10000000-0000-0000-0000-00000000000a', 'lead2@example.com', 'section_lead', auth.uid());
  begin
    insert into public.invitations (event_id, email, role, invited_by)
    values ('10000000-0000-0000-0000-00000000000a', 'boss@example.com', 'volunteer_director', auth.uid());
    raise exception 'FAIL: director invited another director';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Strangers can't list invitations, but anyone with the link can read it.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.invitations) = 0, 'stranger cannot list invitations';
end $$;
reset role;
set role anon;
set request.jwt.claims = '';
select set_config('test.token', :'inv_token', false) \g /dev/null
do $$ declare r record; begin
  select * into r from public.get_invitation(current_setting('test.token')::uuid);
  assert r.station_name = 'Parking' and r.event_name = 'Future Classic', 'invite page shows the details';
end $$;
reset role;

-- The wrong person can't accept it; the right one can, and becomes the lead.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.accept_invitation(current_setting('test.token')::uuid);
    raise exception 'FAIL: accepted someone else''s invitation';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
select public.accept_invitation(current_setting('test.token')::uuid) \g /dev/null
do $$ begin
  assert exists (select 1 from public.event_staff where user_id = auth.uid() and role = 'section_lead'),
         'accepting adds the person to the team';
  assert exists (select 1 from public.station_leads where station_id = '20000000-0000-0000-0000-00000000000a' and user_id = auth.uid()),
         'accepting makes them a lead of the invited station';
  assert (select count(*) from public.station_leads where station_id = '20000000-0000-0000-0000-00000000000a') = 2,
         'a station can have more than one lead';
  assert (select lead_user_id from public.stations where id = '20000000-0000-0000-0000-00000000000a') = '00000000-0000-0000-0000-000000000003',
         'the first lead stays the volunteers'' contact';
  assert public.leads_station('20000000-0000-0000-0000-00000000000a'), 'a second lead gets lead access';
end $$;

-- The host sees the new lead's name; removing them clears their station.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-000000000007') = 'Nia Newlead',
         'host can see their team''s names';
  delete from public.event_staff where user_id = '00000000-0000-0000-0000-000000000007';
  assert not exists (select 1 from public.station_leads where user_id = '00000000-0000-0000-0000-000000000007'),
         'removing a lead from the team takes them off their stations';
  -- Removing the first lead hands the volunteers' contact to the next one.
  delete from public.station_leads where station_id = '20000000-0000-0000-0000-00000000000a'
     and user_id = '00000000-0000-0000-0000-000000000003';
  assert (select lead_user_id from public.stations where id = '20000000-0000-0000-0000-00000000000a') is null,
         'with no leads left, the station has no contact';
  insert into public.station_leads (station_id, user_id, event_id)
  values ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a');
  assert (select lead_user_id from public.stations where id = '20000000-0000-0000-0000-00000000000a') = '00000000-0000-0000-0000-000000000003',
         'adding a lead back makes them the contact';
end $$;

-- ---------------------------------------------------------------------------
-- Rescheduling moves shifts with the event
-- ---------------------------------------------------------------------------
do $$ declare before_start timestamptz; after_start timestamptz; begin
  select starts_at into before_start from public.shifts where id = '30000000-0000-0000-0000-000000000002';
  perform public.reschedule_event('10000000-0000-0000-0000-00000000000a',
    current_date + 12, current_date + 12, now() + interval '12 days', now() + interval '12 days 15 hours',
    'America/Chicago');
  select starts_at into after_start from public.shifts where id = '30000000-0000-0000-0000-000000000002';
  assert after_start - before_start between interval '47 hours' and interval '49 hours',
         format('shift moved two days with the event (%s -> %s)', before_start, after_start);
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.reschedule_event('10000000-0000-0000-0000-00000000000a',
      current_date, current_date, now(), now() + interval '1 hour', 'America/Chicago');
    raise exception 'FAIL: section lead rescheduled the event';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;


-- ---------------------------------------------------------------------------
-- Public links: event slugs are unique across organizations
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    insert into public.organizations (name, slug, subscription_status) values ('Other Boosters', 'other-boosters', 'comped');
    insert into public.events (organization_id, name, slug, starts_on, ends_on, window_start, window_end, venue_address)
    values ((select id from public.organizations where slug = 'other-boosters'), 'Copy', 'future',
            current_date, current_date, now(), now() + interval '1 hour', 'addr');
    raise exception 'FAIL: two events share a public link';
  exception when unique_violation then null;
  end;
end $$;


-- ---------------------------------------------------------------------------
-- Volunteer passes (no login): a device sees only what it booked
-- ---------------------------------------------------------------------------
set role service_role;
-- Val signs up for another shift at today's event, from "Val's phone".
insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity)
values ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000b', 'Late Crew',
        now() + interval '5 hours', now() + interval '8 hours', 5);
select public.register_volunteer('10000000-0000-0000-0000-00000000000b', 'Val One', 'vol1@example.com', '+15125550104',
       array['30000000-0000-0000-0000-000000000004']::uuid[]) \g /dev/null

do $$ declare
  device_token uuid;      -- what Val's phone keeps after booking "Late Crew"
  email_token uuid;       -- what's in Val's confirmation email
  other_assignment uuid;  -- Val's earlier "Warm-Up Crew" signup
begin
  select va.manage_token into device_token from public.volunteer_assignments va
   where va.shift_id = '30000000-0000-0000-0000-000000000004';
  select v.access_token into email_token from public.volunteers v
   where v.email = 'vol1@example.com' and v.event_id = '10000000-0000-0000-0000-00000000000b';
  select va.id into other_assignment from public.volunteer_assignments va
   where va.shift_id = '30000000-0000-0000-0000-000000000003';

  assert (select count(*) from public.pass_agenda('{}', array[device_token])) = 1,
         'a device pass shows only the shift that device booked';
  assert (select count(*) from public.pass_agenda(array[email_token], '{}')) = 2,
         'the emailed link shows all of that volunteer''s shifts at the event';
  assert (select count(*) from public.pass_agenda(array[gen_random_uuid()], array[gen_random_uuid()])) = 0,
         'made-up tokens show nothing';

  assert not public.cancel_with_pass(other_assignment, '{}', array[device_token]),
         'a device pass cannot cancel a shift it did not book';
  assert exists (select 1 from public.volunteer_assignments where id = other_assignment), 'shift still booked';
  assert public.cancel_with_pass(
           (select id from public.volunteer_assignments where manage_token = device_token), '{}', array[device_token]),
         'a device pass cancels the shift it booked';
  assert (select registered_count from public.shifts where id = '30000000-0000-0000-0000-000000000004') = 0,
         'cancelling with a pass frees the spot';

  assert (select calendar_sequence from public.calendar_entries(array[other_assignment], true)) = 1,
         'calendar updates bump the sequence';
end $$;

-- Someone typing Val's email on the public form can't change her phone number.
select public.register_volunteer('10000000-0000-0000-0000-00000000000b', 'Imposter', 'vol1@example.com', '+19995550000',
       array['30000000-0000-0000-0000-000000000004']::uuid[]) \g /dev/null
do $$ begin
  assert (select phone from public.volunteers where email = 'vol1@example.com'
           and event_id = '10000000-0000-0000-0000-00000000000b') = '+15125550104',
         'public signup does not overwrite an existing volunteer''s details';
end $$;
reset role;

-- Browsers can't read the tokens or call the pass functions.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform access_token from public.volunteers limit 1;
    raise exception 'FAIL: a signed-in user read volunteer access tokens';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.pass_agenda(array[gen_random_uuid()], '{}');
    raise exception 'FAIL: a browser called pass_agenda';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.volunteers) >= 1, 'host still reads volunteer names and contacts';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","email":"vol1@example.com"}';
do $$ begin
  assert (select count(*) from public.my_agenda()) >= 1, 'signed-in volunteers still see their agenda';
end $$;
reset role;


-- ---------------------------------------------------------------------------
-- Bands: registration window, running order, public schedule
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ declare n int; begin
  update public.bands set student_count = 118 where id = '40000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'director edits their band while registration is open';
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set band_registration_open = false where id = '10000000-0000-0000-0000-00000000000a';

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ declare n int; begin
  update public.bands set student_count = 5 where id = '40000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'director cannot edit after registration closes';
  begin
    perform public.save_performance_order('10000000-0000-0000-0000-00000000000a',
      '[{"band_id":"40000000-0000-0000-0000-000000000001"}]'::jsonb);
    raise exception 'FAIL: a band director set the performance order';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Host saves the order with times.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
-- A host can't register a band in someone else's name (it would show that
-- person's email in past_band_directors()).
do $$ begin
  begin
    insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                              contact_email, head_director_name, head_director_email, head_director_phone,
                              student_count, chaperone_count)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'X HS', 'X', '6A', 'addr',
            'x@example.com', 'X', 'x@example.com', '+15125550199', 1, 1);
    raise exception 'FAIL: a host registered a band for another user';
  exception when insufficient_privilege then null;
  end;
end $$;
-- A second band from the same director (set up directly).
reset role;
insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-000000000005', 'North HS', 'Northern Lights', '6A', 'addr',
        'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 200, 20);
set role authenticated;
select public.save_performance_order('10000000-0000-0000-0000-00000000000a', jsonb_build_array(
  jsonb_build_object('band_id', '40000000-0000-0000-0000-000000000002', 'perform_at', now() + interval '10 days 2 hours',
                     'warm_up_minutes', 45),
  jsonb_build_object('band_id', '40000000-0000-0000-0000-000000000001', 'perform_at', now() + interval '10 days 3 hours')
)) \g /dev/null
do $$ begin
  assert (select performance_order from public.performance_slots where band_id = '40000000-0000-0000-0000-000000000001') = 2,
         'order follows the list';
  assert (select warm_up_minutes from public.performance_slots where band_id = '40000000-0000-0000-0000-000000000002') = 45,
         'warm-up length is saved';
  begin
    perform public.save_performance_order('10000000-0000-0000-0000-00000000000a',
      '[{"band_id":"40000000-0000-0000-0000-000000000001","warm_up_minutes":20}]'::jsonb);
    raise exception 'FAIL: saved a warm-up length that is not in 15-minute steps';
  exception when check_violation then null;
  end;
  update public.events set ready_minutes_before = 10 where id = '10000000-0000-0000-0000-00000000000a';
  assert (select ready_minutes_before from public.events where id = '10000000-0000-0000-0000-00000000000a') = 10,
         'host sets the ready position';
  begin
    update public.events set ready_minutes_before = 90 where id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: saved a ready position over 60 minutes';
  exception when check_violation then null;
  end;
  begin
    perform public.save_performance_order('10000000-0000-0000-0000-00000000000b',
      '[{"band_id":"40000000-0000-0000-0000-000000000001"}]'::jsonb);
    raise exception 'FAIL: scheduled a band at an event it did not register for';
  exception when check_violation then null;
  end;
end $$;
reset role;

set role anon;
set request.jwt.claims = '';
do $$ declare r record; begin
  select * into r from public.public_schedule('future') limit 1;
  assert r.band_name = 'Northern Lights' and r.performance_order = 1, 'public sees the published running order';
  assert (select count(*) from public.public_schedule('draft')) = 0, 'unpublished events show no schedule';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Breaks and finals
-- ---------------------------------------------------------------------------
-- A band at another event, to try sneaking into these finals.
insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000b',
        '00000000-0000-0000-0000-000000000005', 'South HS', 'Southern Sound', '6A', 'addr',
        'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 100, 10);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  perform public.save_schedule('10000000-0000-0000-0000-00000000000a', 5, '[]', '[]', '[]');
  raise exception 'FAIL: a band director saved the schedule';
exception when insufficient_privilege then null;
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set finals_published = false where id = '10000000-0000-0000-0000-00000000000a';
select public.save_schedule('10000000-0000-0000-0000-00000000000a', 7,
  jsonb_build_array(
    jsonb_build_object('band_id', '40000000-0000-0000-0000-000000000002', 'perform_at', now() + interval '10 days 2 hours'),
    jsonb_build_object('band_id', '40000000-0000-0000-0000-000000000001', 'perform_at', now() + interval '10 days 3 hours')),
  jsonb_build_array(jsonb_build_object('starts_at', now() + interval '10 days 4 hours', 'minutes', 45, 'label', 'Lunch')),
  jsonb_build_array(
    jsonb_build_object('band_id', '40000000-0000-0000-0000-000000000002', 'perform_at', now() + interval '10 days 8 hours',
                       'warm_up_minutes', 30),
    jsonb_build_object('band_id', null, 'perform_at', now() + interval '10 days 9 hours'),
    jsonb_build_object('perform_at', now() + interval '10 days 10 hours'))
) \g /dev/null
do $$ begin
  assert (select ready_minutes_before from public.events where id = '10000000-0000-0000-0000-00000000000a') = 7,
         'schedule save sets the ready position';
  assert (select count(*) from public.performance_slots where event_id = '10000000-0000-0000-0000-00000000000a') = 2,
         'schedule save keeps the running order';
  assert (select count(*) from public.schedule_breaks where event_id = '10000000-0000-0000-0000-00000000000a') = 1,
         'host adds a break';
  assert (select count(*) from public.finals_slots where event_id = '10000000-0000-0000-0000-00000000000a' and band_id is null) = 2,
         'finals can hold placeholders';
  begin
    perform public.save_schedule('10000000-0000-0000-0000-00000000000a', 5, '[]', '[]',
      '[{"band_id":"40000000-0000-0000-0000-000000000002"},{"band_id":"40000000-0000-0000-0000-000000000002"}]');
    raise exception 'FAIL: the same band took two finals slots';
  exception when unique_violation then null;
  end;
  begin
    perform public.save_schedule('10000000-0000-0000-0000-00000000000a', 5, '[]', '[]',
      '[{"band_id":"40000000-0000-0000-0000-000000000003"}]');
    raise exception 'FAIL: a band from another event made the finals';
  exception when check_violation then null;
  end;
  begin
    perform public.save_schedule('10000000-0000-0000-0000-00000000000a', 5, '[]',
      '[{"starts_at":"2030-01-01T12:00:00Z","minutes":1,"label":"Too short"}]', '[]');
    raise exception 'FAIL: saved a 1-minute break';
  exception when check_violation then null;
  end;
  assert (select count(*) from public.finals_slots where event_id = '10000000-0000-0000-0000-00000000000a') = 3,
         'a rejected save changes nothing';
end $$;
reset role;

-- Spectators: breaks show with the published order; finals only once published.
set role anon;
set request.jwt.claims = '';
do $$ begin
  assert (select count(*) from public.public_breaks('future')) = 1, 'public sees breaks once the order is published';
  assert (select count(*) from public.public_finals('future')) = 0, 'unpublished finals are hidden';
  assert (select count(*) from public.finals_slots) = 0, 'unpublished finals slots are hidden';
  begin
    perform public.save_schedule('10000000-0000-0000-0000-00000000000a', 5, '[]', '[]', '[]');
    raise exception 'FAIL: anon saved a schedule';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set finals_published = true where id = '10000000-0000-0000-0000-00000000000a';
reset role;

-- Stage 1/2: the finals schedule is public, but saved finalists stay private.
set role anon;
set request.jwt.claims = '';
do $$ declare r record; begin
  assert (select count(*) from public.public_finals('future')) = 3, 'published finals show every slot';
  select * into r from public.public_finals('future') where slot_number = 1;
  assert r.band_name is null and r.perform_at is not null, 'finalist names stay hidden until revealed';
  assert (select count(*) from public.finals_slots) = 0, 'raw finals rows stay hidden until revealed';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.finals_slots where band_id = '40000000-0000-0000-0000-000000000002') = 0,
         'a director cannot see their band made the finals before the reveal';
end $$;

-- Stage 3: reveal.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set finalists_revealed = true where id = '10000000-0000-0000-0000-00000000000a';
do $$ begin
  update public.events set finals_published = false where id = '10000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: unpublished finals while finalists were revealed';
exception when check_violation then null;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.finals_slots where band_id = '40000000-0000-0000-0000-000000000002') = 1,
         'a finalist director sees their finals slot once revealed';
end $$;
reset role;

set role anon;
set request.jwt.claims = '';
do $$ declare r record; begin
  select * into r from public.public_finals('future') where slot_number = 1;
  assert r.band_name = 'Northern Lights', 'finalist names show once revealed';
  select * into r from public.public_finals('future') where slot_number = 2;
  assert r.band_name is null and r.perform_at is not null, 'placeholders show their time without a band';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Registration deadline and the directors' host contact
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set band_registration_open = true, band_registration_deadline = current_date - 2
 where id = '10000000-0000-0000-0000-00000000000a';
insert into public.event_director_contacts (event_id, name, phone, email)
values ('10000000-0000-0000-0000-00000000000a', 'Hana Host', '+15125550101', 'host@example.com');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ declare n int; begin
  assert not public.band_registration_is_open('10000000-0000-0000-0000-00000000000a'), 'a past deadline closes registration';
  update public.bands set student_count = 7 where id = '40000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'director cannot edit after the deadline';
  begin
    insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                              contact_email, head_director_name, head_director_email, head_director_phone,
                              student_count, chaperone_count)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000005', 'Late HS', 'Late Band', '6A',
            'addr', 'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 10, 1);
    raise exception 'FAIL: registered after the deadline';
  exception when insufficient_privilege then null;
  end;
  assert (select name from public.event_director_contacts
           where event_id = '10000000-0000-0000-0000-00000000000a') = 'Hana Host',
         'a director with a band at the event sees the host contact';
  begin
    insert into public.event_director_contacts (event_id, name) values ('10000000-0000-0000-0000-00000000000b', 'Me');
    raise exception 'FAIL: a director set the host contact';
  exception when insufficient_privilege then null;
  end;
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set band_registration_deadline = current_date + 2 where id = '10000000-0000-0000-0000-00000000000a';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ declare n int; begin
  update public.bands set student_count = 7 where id = '40000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'director can edit before the deadline';
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.event_director_contacts) = 0, 'strangers cannot see host contacts';
end $$;
reset role;

set role anon;
do $$ begin
  perform 1 from public.event_director_contacts;
  raise exception 'FAIL: anon read host contacts';
exception when insufficient_privilege then null;
end $$;
reset role;

-- The host's phone reaches directors only the day before and on contest day.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.event_director_contacts (event_id, name, phone, email)
values ('10000000-0000-0000-0000-00000000000b', 'Hana Host', '+15125550101', 'host@example.com');
do $$ begin
  assert public.director_contact_phone('10000000-0000-0000-0000-00000000000a') = '+15125550101',
         'the host always sees their own contact phone';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert public.director_contact_phone('10000000-0000-0000-0000-00000000000a') is null,
         'directors do not get the phone ten days out';
  assert (select has_phone from public.event_director_contacts where event_id = '10000000-0000-0000-0000-00000000000a'),
         'directors can tell a phone number exists';
  assert public.director_contact_phone('10000000-0000-0000-0000-00000000000b') = '+15125550101',
         'directors get the phone on contest day';
  begin
    perform phone from public.event_director_contacts;
    raise exception 'FAIL: a director read the phone column directly';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert public.director_contact_phone('10000000-0000-0000-0000-00000000000b') is null, 'strangers never get the phone';
end $$;
reset role;

-- Finals have their own ready position.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
select public.save_schedule('10000000-0000-0000-0000-00000000000a', 6, 10,
  (select coalesce(jsonb_agg(jsonb_build_object('band_id', band_id, 'perform_at', perform_at) order by performance_order), '[]')
     from public.performance_slots where event_id = '10000000-0000-0000-0000-00000000000a'),
  '[]', '[]') \g /dev/null
do $$ begin
  assert (select ready_minutes_before = 6 and finals_ready_minutes_before = 10 from public.events
           where id = '10000000-0000-0000-0000-00000000000a'), 'preliminaries and finals ready positions save separately';
  begin
    perform public.save_schedule('10000000-0000-0000-0000-00000000000a', 5, 90, '[]', '[]', '[]');
    raise exception 'FAIL: saved a finals ready position over 60 minutes';
  exception when check_violation then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  perform public.save_schedule('10000000-0000-0000-0000-00000000000a', 5, 5, '[]', '[]', '[]');
  raise exception 'FAIL: a band director saved the schedule';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Saving or publishing bumps the schedule version that open pages poll.
create temp table v as select public.schedule_version('future') as before;
grant select on v to authenticated, anon;
select pg_sleep(0.01);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
-- (a new transaction, so now() moves on)
select public.save_schedule('10000000-0000-0000-0000-00000000000a', 6, 10,
  (select coalesce(jsonb_agg(jsonb_build_object('band_id', band_id, 'perform_at', perform_at) order by performance_order), '[]')
     from public.performance_slots where event_id = '10000000-0000-0000-0000-00000000000a'),
  '[]', '[]') \g /dev/null
reset role;
set role anon;
do $$ begin
  assert public.schedule_version('future') > (select before from v), 'saving the schedule bumps its version';
  assert public.schedule_version('draft') is null, 'unpublished events have no public version';
end $$;
reset role;
drop table v;

-- ---------------------------------------------------------------------------
-- Several Volunteer Leads; several Section Leads per station
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000008', 'second@example.com', '{"full_name":"Val Second"}');
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000008', 'volunteer_director');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","email":"second@example.com"}';
do $$ begin
  assert public.can_manage_volunteers('10000000-0000-0000-0000-00000000000a'), 'a second Volunteer Lead can manage volunteers';
  insert into public.station_leads (station_id, user_id, event_id)
  values ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-00000000000a');
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.station_leads where station_id = '20000000-0000-0000-0000-00000000000a') = 2,
         'leads see their station''s other leads';
  begin
    insert into public.station_leads (station_id, user_id, event_id)
    values ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: a Section Lead added a lead';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.stations set lead_user_id = null where id = '20000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: set the derived lead column directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from public.station_leads where user_id = '00000000-0000-0000-0000-000000000008';
delete from public.event_staff where user_id = '00000000-0000-0000-0000-000000000008';

-- ---------------------------------------------------------------------------
-- Co-hosts
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000009', 'cohost@example.com', '{"full_name":"Cory Cohost"}');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  insert into public.invitations (event_id, email, as_host, invited_by)
  values ('10000000-0000-0000-0000-00000000000a', 'cohost@example.com', true, auth.uid());
  raise exception 'FAIL: a Volunteer Lead invited a co-host';
exception when insufficient_privilege then null;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.invitations (event_id, email, as_host, invited_by)
values ('10000000-0000-0000-0000-00000000000a', 'cohost@example.com', true, '00000000-0000-0000-0000-000000000001');
select set_config('test.host_token', (select token::text from public.invitations where email = 'cohost@example.com'), false) \g /dev/null
reset role;
set role anon;
do $$ declare r record; begin
  select * into r from public.get_invitation(current_setting('test.host_token')::uuid);
  assert r.as_host and r.role is null, 'the invite page knows it is a co-host invitation';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","email":"cohost@example.com"}';
select public.accept_invitation(current_setting('test.host_token')::uuid) \g /dev/null
do $$ begin
  assert public.is_event_admin('10000000-0000-0000-0000-00000000000a'), 'a co-host can run the organization''s events';
  assert not exists (select 1 from public.event_staff where user_id = auth.uid()), 'a co-host is not event staff';
  begin
    delete from public.organization_members where role = 'owner';
    if found then raise exception 'FAIL: a co-host removed the owner'; end if;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  delete from public.organization_members where user_id = '00000000-0000-0000-0000-000000000009';
  if found then raise exception 'FAIL: a Volunteer Lead removed a co-host'; end if;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-000000000009') = 'Cory Cohost',
         'the host sees their co-host''s name';
  delete from public.organization_members where user_id = '00000000-0000-0000-0000-000000000009';
  assert found, 'the host can remove a co-host';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- What leads see: bands without contact details, the published schedule,
-- and (for Section Leads) volunteer announcements only.
-- ---------------------------------------------------------------------------
update public.events set finalists_revealed = false where id = '10000000-0000-0000-0000-00000000000a';
delete from public.finals_slots where event_id = '10000000-0000-0000-0000-00000000000a';
insert into public.finals_slots (event_id, slot_number, band_id)
values ('10000000-0000-0000-0000-00000000000a', 1, '40000000-0000-0000-0000-000000000001');
insert into public.announcements (event_id, sender_id, audiences, body) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '{band_directors}', 'Directors: unload at Lot C');
set role authenticated;

-- Section Lead
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ declare r record; begin
  assert (select count(*) from public.bands) = 0, 'a Section Lead can''t read band registrations';
  select * into r from public.event_bands('10000000-0000-0000-0000-00000000000a')
   where id = '40000000-0000-0000-0000-000000000001';
  assert r.band_name = 'Mighty Marching', 'a Section Lead sees band names';
  assert r.student_count is null, 'a Section Lead doesn''t get headcounts';
  assert r.bus_count = 3, 'a Section Lead sees vehicles (for parking)';
  assert r.special_needs is null, 'accessibility needs stay with hosts';
  assert (select count(*) from public.performance_slots where event_id = '10000000-0000-0000-0000-00000000000a') > 0,
         'a Section Lead sees the published performance order';
  assert (select count(*) from public.finals_slots) = 0, 'a Section Lead can''t see finalists before the reveal';
  assert exists (select 1 from public.announcements where body = 'Lunch is ready'), 'a Section Lead reads volunteer announcements';
  assert not exists (select 1 from public.announcements where body = 'Directors: unload at Lot C'),
         'a Section Lead doesn''t read band-director announcements';
  begin
    insert into public.announcements (event_id, sender_id, audiences, body)
    values ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{volunteers}', 'Hi team');
    raise exception 'FAIL: a Section Lead sent an announcement';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Volunteer Lead
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ declare r record; begin
  assert (select count(*) from public.bands) = 0, 'a Volunteer Lead can''t read band contact details';
  select * into r from public.event_bands('10000000-0000-0000-0000-00000000000a')
   where id = '40000000-0000-0000-0000-000000000001';
  assert r.student_count is not null and r.bus_count = 3, 'a Volunteer Lead sees headcounts and vehicles';
  update public.bands set band_name = 'Hacked' where event_id = '10000000-0000-0000-0000-00000000000a';
  if found then raise exception 'FAIL: a Volunteer Lead edited a band'; end if;
  assert (select count(*) from public.finals_slots) = 0, 'a Volunteer Lead can''t see finalists before the reveal';
  assert exists (select 1 from public.announcements where body = 'Directors: unload at Lot C'),
         'a Volunteer Lead reads every announcement';
  insert into public.announcements (event_id, sender_id, audiences, body)
  values ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{volunteers}', 'Shirts at the gate');
end $$;

-- Someone outside the event
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.event_bands('10000000-0000-0000-0000-00000000000a')) = 0,
         'outsiders get nothing from event_bands';
end $$;

-- Host still sees everything, including finals before the reveal.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select count(*) from public.bands where event_id = '10000000-0000-0000-0000-00000000000a') > 0, 'the host reads band registrations';
  assert (select count(*) from public.finals_slots where event_id = '10000000-0000-0000-0000-00000000000a') > 0,
         'the host sees finals before the reveal';
end $$;
reset role;

-- After the reveal, leads see the finals like everyone else.
update public.events set finalists_revealed = true where id = '10000000-0000-0000-0000-00000000000a';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.finals_slots) > 0, 'a Section Lead sees finals once revealed';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Contest day: ordered check-in stations, parking spots, one-tap stops, undo, notes
-- ---------------------------------------------------------------------------
-- Event A's path: 1 Parking (lead@), 2 Check-in table (no lead), 3 Warm-up, 4 Gate (newlead@).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  update public.stations set checkpoint_kind = 'parking', checkpoint_order = 1, due_minutes_before_warm_up = 60
   where id = '20000000-0000-0000-0000-00000000000a';
  assert found, 'the host sets up a parking check-in station with a deadline';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  update public.stations set due_minutes_before_warm_up = 5 where id = '20000000-0000-0000-0000-00000000000a';
  if found then raise exception 'FAIL: a Section Lead changed their station''s deadline'; end if;
end $$;
reset role;
insert into public.stations (id, event_id, name, station_type, checkpoint_kind, checkpoint_order) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'Check-in table', 'active_checkpoint', 'stop', 2),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'Warm-up', 'active_checkpoint', 'warm_up', 3),
  ('20000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-00000000000a', 'Gate', 'active_checkpoint', 'gate', 4);
do $$ begin
  begin
    insert into public.stations (event_id, name, checkpoint_kind) values ('10000000-0000-0000-0000-00000000000a', 'Bad', 'stop');
    raise exception 'FAIL: a check-in station without an order';
  exception when check_violation then null;
  end;
end $$;
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000007', 'section_lead')
on conflict do nothing;
insert into public.station_leads (station_id, user_id, event_id) values
  ('20000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-00000000000a');
update public.bands set special_needs = 'Ramp for the pit' where id = '40000000-0000-0000-0000-000000000001';
insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-000000000005', 'West HS', 'West Winds', '5A', 'addr',
        'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 50, 5);
set role authenticated;

-- The parking lead (lead@)
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$
declare park constant uuid := '20000000-0000-0000-0000-00000000000a';
begin
  perform public.band_action('40000000-0000-0000-0000-000000000002', 'buses_here', park);
  perform public.band_action('40000000-0000-0000-0000-000000000002', 'equipment_here', park);
  perform public.band_action('40000000-0000-0000-0000-000000000002', 'equipment_here', park); -- a double tap changes nothing
  assert (select equipment_spot from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000002') = 1, 'first equipment in gets spot 1';
  assert (select count(*) from public.band_activity where band_id = '40000000-0000-0000-0000-000000000002') = 2,
         'each tap is logged once';
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'equipment_here', park);
  assert (select equipment_spot from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000001') = 2, 'spots follow arrival order, not performance order';
  -- Away keeps the spot; left for the day frees it for the next band.
  perform public.band_action('40000000-0000-0000-0000-000000000002', 'away', park);
  assert (select equipment_spot from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000002') = 1, 'a band away for lunch keeps its spot';
  perform public.band_action('40000000-0000-0000-0000-000000000002', 'back', park);
  perform public.band_action('40000000-0000-0000-0000-000000000002', 'left', park);
  perform public.band_action('40000000-0000-0000-0000-000000000009', 'equipment_here', park);
  assert (select equipment_spot from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000009') = 1, 'a freed spot goes to the next band';
  begin
    perform public.undo_band_action('40000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: undo gave a spot back to two bands';
  exception when raise_exception then null;
  end;
  perform public.undo_band_action('40000000-0000-0000-0000-000000000009');
  assert (select equipment_spot from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000009') is null, 'undo takes the spot back';
  -- Only at their own stations, and only that station's taps
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000009', 'here', '20000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL: a parking lead tapped a band in at the check-in table';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000009', 'here', park);
    raise exception 'FAIL: a plain Here tap at parking';
  exception when raise_exception then null;
  end;
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000009', 'scratched');
    raise exception 'FAIL: a Section Lead scratched a band';
  exception when insufficient_privilege then null;
  end;
  -- Notes
  insert into public.band_notes (band_id, body) values ('40000000-0000-0000-0000-000000000002', 'Lunch off campus, back 1:00');
  assert (select event_id from public.band_notes where body like 'Lunch%') = '10000000-0000-0000-0000-00000000000a',
         'a note takes its band''s event';
  assert (select author_name from public.band_notes where body like 'Lunch%') = 'Lee Lead', 'a note shows who wrote it';
  assert (select actor_name from public.band_activity order by id desc limit 1) = 'Lee Lead', 'a tap shows who made it';
  assert (select special_needs from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000001') is null, 'accessibility needs stay with hosts';
end $$;

-- The gate lead (newlead@): Here and Performed, per round
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
do $$
declare gate constant uuid := '20000000-0000-0000-0000-0000000000c3';
begin
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000009', 'here', gate);
    raise exception 'FAIL: a gate tap without a round';
  exception when raise_exception then null;
  end;
  perform public.band_action('40000000-0000-0000-0000-000000000009', 'here', gate, 'prelims');
  perform public.band_action('40000000-0000-0000-0000-000000000009', 'here', gate, 'prelims'); -- double tap
  perform public.band_action('40000000-0000-0000-0000-000000000009', 'performed', gate, 'prelims');
  perform public.band_action('40000000-0000-0000-0000-000000000009', 'here', gate, 'finals');
  assert (select count(*) from public.band_stops where band_id = '40000000-0000-0000-0000-000000000009') = 3,
         'prelims and finals stops are kept apart, once each';
  perform public.undo_band_action('40000000-0000-0000-0000-000000000009');
  assert not exists (select 1 from public.band_stops where band_id = '40000000-0000-0000-0000-000000000009' and round = 'finals'),
         'undo removes the latest stop';
end $$;

-- The Volunteer Lead can tap anywhere and scratch; a lead can't undo their taps.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  perform public.band_action('40000000-0000-0000-0000-000000000009', 'here', '20000000-0000-0000-0000-0000000000c1');
  perform public.band_action('40000000-0000-0000-0000-000000000009', 'scratched');
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000009', 'performed', '20000000-0000-0000-0000-0000000000c2', 'prelims');
    raise exception 'FAIL: Performed tapped at warm-up';
  exception when raise_exception then null;
  end;
  insert into public.band_notes (band_id, body) values ('40000000-0000-0000-0000-000000000009', 'Director called: running late');
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.undo_band_action('40000000-0000-0000-0000-000000000009');
    raise exception 'FAIL: a Section Lead undid someone else''s tap';
  exception when insufficient_privilege then null;
  end;
  delete from public.band_notes where body like 'Director called%';
  if found then raise exception 'FAIL: a Section Lead deleted someone else''s note'; end if;
  delete from public.band_notes where body like 'Lunch%';
  assert found, 'a lead deletes their own note';
  assert (select count(*) from public.band_stops where band_id = '40000000-0000-0000-0000-000000000009') = 3,
         'the whole team sees where bands have been';
end $$;

-- Directors and outsiders see none of it.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.band_notes) = 0, 'directors don''t see the team''s notes';
  assert (select count(*) from public.band_activity) = 0, 'directors don''t see the activity log';
  assert (select count(*) from public.band_stops) = 0, 'directors don''t see the stops log';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000001', 'buses_here', '20000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: an outsider tapped a band in';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.band_notes (band_id, body) values ('40000000-0000-0000-0000-000000000001', 'hi');
    raise exception 'FAIL: an outsider left a note';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The host sees accessibility needs.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select special_needs from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000001') = 'Ramp for the pit', 'the host sees accessibility needs';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Running behind: push the rest of the schedule back
-- ---------------------------------------------------------------------------
delete from public.schedule_breaks where event_id = '10000000-0000-0000-0000-00000000000a';
delete from public.performance_slots where event_id = '10000000-0000-0000-0000-00000000000a';
delete from public.finals_slots where event_id = '10000000-0000-0000-0000-00000000000a';
insert into public.performance_slots (band_id, event_id, performance_order, warm_up_at, perform_at) values
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 1, '2030-01-01 09:00+00', '2030-01-01 10:00+00'),
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 2, '2030-01-01 09:15+00', '2030-01-01 10:15+00'),
  ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-00000000000a', 3, '2030-01-01 09:30+00', '2030-01-01 10:30+00');
insert into public.schedule_breaks (event_id, starts_at, minutes, label) values
  ('10000000-0000-0000-0000-00000000000a', '2030-01-01 09:55+00', 5, 'Before band 1'),
  ('10000000-0000-0000-0000-00000000000a', '2030-01-01 10:10+00', 5, 'Between 1 and 2'),
  ('10000000-0000-0000-0000-00000000000a', '2030-01-01 18:30+00', 30, 'Before finals');
insert into public.finals_slots (event_id, slot_number, band_id, warm_up_at, perform_at) values
  ('10000000-0000-0000-0000-00000000000a', 1, '40000000-0000-0000-0000-000000000002', '2030-01-01 18:00+00', '2030-01-01 19:00+00');
set role authenticated;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  begin
    perform public.push_schedule_back('10000000-0000-0000-0000-00000000000a', 2, 10, false);
    raise exception 'FAIL: a Volunteer Lead moved the schedule';
  exception when insufficient_privilege then null;
  end;
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ declare moved int; begin
  begin
    perform public.push_schedule_back('10000000-0000-0000-0000-00000000000a', 2, 0, false);
    raise exception 'FAIL: pushed back by 0 minutes';
  exception when raise_exception then null;
  end;
  select count(*) into moved from public.push_schedule_back('10000000-0000-0000-0000-00000000000a', 2, 10, false);
  assert moved = 2, format('bands #2 and #3 move (got %s)', moved);
  assert (select perform_at from public.performance_slots where performance_order = 1
           and event_id = '10000000-0000-0000-0000-00000000000a') = '2030-01-01 10:00+00', 'band #1 stays put';
  assert (select warm_up_at = '2030-01-01 09:25+00' and perform_at = '2030-01-01 10:25+00' from public.performance_slots
           where performance_order = 2 and event_id = '10000000-0000-0000-0000-00000000000a'), 'band #2 moves 10 minutes later';
  assert (select starts_at from public.schedule_breaks where label = 'Before band 1') = '2030-01-01 09:55+00',
         'a break before the first moved band stays put';
  assert (select starts_at from public.schedule_breaks where label = 'Between 1 and 2') = '2030-01-01 10:20+00',
         'a break after the band before moves';
  assert (select starts_at from public.schedule_breaks where label = 'Before finals') = '2030-01-01 18:30+00',
         'finals breaks stay put unless finals move';
  assert (select perform_at from public.finals_slots where event_id = '10000000-0000-0000-0000-00000000000a') = '2030-01-01 19:00+00',
         'finals stay put unless asked';
  select count(*) into moved from public.push_schedule_back('10000000-0000-0000-0000-00000000000a', 3, 5, true);
  assert moved = 2, format('band #3 and the finalist move (got %s)', moved);
  assert (select perform_at from public.finals_slots where event_id = '10000000-0000-0000-0000-00000000000a') = '2030-01-01 19:05+00',
         'finals move when asked';
  assert (select starts_at from public.schedule_breaks where label = 'Before finals') = '2030-01-01 18:35+00',
         'finals breaks move with the finals';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Live status for directors and the public
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert exists (select 1 from public.my_band_progress('40000000-0000-0000-0000-000000000009')
                  where checkpoint_kind = 'gate' and round = 'prelims' and performed),
         'a director sees their band performed';
  assert (select count(distinct station_id) from public.my_band_progress('40000000-0000-0000-0000-000000000009')) = 4,
         'a director sees every stop on the path';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.my_band_progress('40000000-0000-0000-0000-000000000009')) = 0,
         'nobody else sees a band''s progress';
end $$;
reset role;
set role anon;
set request.jwt.claims = '';
do $$ declare r record; begin
  begin
    perform public.my_band_progress('40000000-0000-0000-0000-000000000009');
    raise exception 'FAIL: the public read a band''s progress';
  exception when insufficient_privilege then null;
  end;
  select * into r from public.public_progress('future') where round = 'prelims' and number = 3;
  assert r.performed and r.scratched, 'the public sees performed and withdrawn';
  select * into r from public.public_progress('future') where round = 'prelims' and number = 2;
  assert not r.performed and not r.at_gate, 'bands not yet at the gate show as such';
  assert (select count(*) from public.public_progress('draft')) = 0, 'nothing for unpublished events';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Tap a done step again to take it back
-- ---------------------------------------------------------------------------
update public.bands set buses_at = null, equipment_at = null, equipment_spot = null, away_at = null, left_at = null, scratched_at = null
 where event_id = '10000000-0000-0000-0000-00000000000a';
delete from public.band_stops where event_id = '10000000-0000-0000-0000-00000000000a';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$
declare park constant uuid := '20000000-0000-0000-0000-00000000000a';
begin
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'buses_here', park);
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_buses', park);
  assert (select buses_at from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000001') is null, 'tapping Buses again takes it back';
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'equipment_here', park);
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_equipment', park);
  assert (select equipment_spot is null and equipment_at is null from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000001'), 'taking equipment back frees the spot';
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'equipment_here', park);
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'left', park);
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_left', park);
  assert (select left_at is null and equipment_spot = 1 from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000001'), 'taking "left" back returns the band to its spot';
  -- Spot 1 taken while they were gone: they get the next free one.
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'left', park);
  perform public.band_action('40000000-0000-0000-0000-000000000002', 'equipment_here', park);
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_left', park);
  assert (select equipment_spot from public.event_bands('10000000-0000-0000-0000-00000000000a')
           where id = '40000000-0000-0000-0000-000000000001') = 2, 'a band coming back gets a free spot if theirs was taken';
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_here', '20000000-0000-0000-0000-0000000000c3', 'prelims');
    raise exception 'FAIL: a parking lead took back a gate tap';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
do $$
declare gate constant uuid := '20000000-0000-0000-0000-0000000000c3';
begin
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'here', gate, 'prelims');
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'performed', gate, 'prelims');
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_performed', gate, 'prelims');
  assert (select count(*) from public.band_stops where band_id = '40000000-0000-0000-0000-000000000001') = 1,
         'taking Performed back leaves Here';
  perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_here', gate, 'prelims');
  assert not exists (select 1 from public.band_stops where band_id = '40000000-0000-0000-0000-000000000001'),
         'taking Here back removes the stop';
  begin
    perform public.band_action('40000000-0000-0000-0000-000000000001', 'clear_buses', gate);
    raise exception 'FAIL: a parking take-back at the gate';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Pilot requests: only platform admins can read them; no one writes from a browser
-- ---------------------------------------------------------------------------
insert into public.pilot_requests (name, email, organization, bands, volunteers)
values ('Pat Pilot', 'pat@example.com', 'Lakeside Band Boosters', 20, 150);
set role anon;
set request.jwt.claims = '{}';
do $$ begin
  begin
    insert into public.pilot_requests (name, email, organization) values ('Spam Bot', 'bot@example.com', 'Spam');
    raise exception 'FAIL: a visitor wrote a pilot request straight to the table';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.pilot_requests;
    raise exception 'FAIL: a visitor read pilot requests';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;
-- The host of an organization is not FieldCommand staff.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert not public.is_platform_admin(), 'a host is not a platform admin';
  assert (select count(*) from public.pilot_requests) = 0, 'a host can''t read pilot requests';
  update public.pilot_requests set status = 'invited';
  begin
    insert into public.platform_admins (user_id) values (auth.uid());
    raise exception 'FAIL: a user made themselves a platform admin';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.platform_admins;
    raise exception 'FAIL: a user read the platform admin list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select status from public.pilot_requests where email = 'pat@example.com') = 'new', 'a host can''t change a pilot request';
end $$;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert public.is_platform_admin(), 'an admin is a platform admin';
  assert (select count(*) from public.pilot_requests) = 1, 'a platform admin reads pilot requests';
  update public.pilot_requests set status = 'contacted' where email = 'pat@example.com';
  assert (select status from public.pilot_requests where email = 'pat@example.com') = 'contacted', 'a platform admin marks a request contacted';
  begin
    update public.pilot_requests set email = 'changed@example.com';
    raise exception 'FAIL: a platform admin rewrote what someone submitted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.pilot_requests;
    raise exception 'FAIL: deleted pilot requests from a browser';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from public.platform_admins;

-- ---------------------------------------------------------------------------
-- Invitation emails: the secret one-tap key never reaches a browser
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.invitations (event_id, email, role, invited_by)
values ('10000000-0000-0000-0000-00000000000a', 'mailme@example.com', 'section_lead', '00000000-0000-0000-0000-000000000001');
insert into public.invitations (event_id, email, as_host, invited_by)
values ('10000000-0000-0000-0000-00000000000a', 'hostmail@example.com', true, '00000000-0000-0000-0000-000000000001');
do $$ begin
  begin
    perform email_token from public.invitations;
    raise exception 'FAIL: a host read the secret email key';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('test.key_before', (select email_token::text from public.invitations where email = 'mailme@example.com'), false) \g /dev/null
update public.invitations set expires_at = now() - interval '1 day' where email = 'mailme@example.com';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare r record;
begin
  select * into r from public.prepare_invitation_email((select id from public.invitations where email = 'mailme@example.com'));
  assert r.email = 'mailme@example.com' and r.role = 'section_lead' and r.inviter_name = 'Hana Host', 'the email gets the invitation details';
  assert r.expires_at > now() + interval '29 days', 'resending an expired invitation gives it another 30 days';
end $$;
-- (Sending again within 5 minutes is refused: tested at the end. Clear it for the next check.)
reset role;
update public.invitations set sent_at = null where email = 'mailme@example.com';
set role authenticated;
-- A Volunteer Lead can send Section Lead invitations, not co-host ones.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  perform public.prepare_invitation_email((select id from public.invitations where email = 'mailme@example.com'));
  begin
    perform public.prepare_invitation_email((select id from public.invitations where email = 'hostmail@example.com'));
    raise exception 'FAIL: a Volunteer Lead sent a co-host invitation';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.prepare_invitation_email((select id from public.invitations where email = 'mailme@example.com'));
    raise exception 'FAIL: a stranger sent an invitation';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select email_token::text from public.invitations where email = 'mailme@example.com') <> current_setting('test.key_before'),
         'sending makes a new secret key, so older emails stop working';
  assert (select sent_at is not null from public.invitations where email = 'mailme@example.com'), 'sending is recorded';
end $$;
delete from public.invitations where email in ('mailme@example.com', 'hostmail@example.com');

-- ---------------------------------------------------------------------------
-- Removed team members are listed (to the right people) and cleared on return
-- ---------------------------------------------------------------------------
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'section_lead');
insert into public.organization_members (organization_id, user_id, role)
select organization_id, '00000000-0000-0000-0000-000000000004', 'admin' from public.events where id = '10000000-0000-0000-0000-00000000000a';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
delete from public.event_staff where event_id = '10000000-0000-0000-0000-00000000000a'
   and user_id = '00000000-0000-0000-0000-000000000004' and role = 'section_lead';
delete from public.organization_members where user_id = '00000000-0000-0000-0000-000000000004';
do $$ begin
  assert (select count(*) from public.team_removals where user_id = '00000000-0000-0000-0000-000000000004') = 2,
         'the host sees the removed Section Lead and co-host';
  assert (select removed_by from public.team_removals where role = 'section_lead' and user_id = '00000000-0000-0000-0000-000000000004')
         = '00000000-0000-0000-0000-000000000001', 'who removed them is recorded';
  begin
    insert into public.team_removals (organization_id, role, user_id, email)
    select organization_id, 'co_host', auth.uid(), 'x@example.com' from public.events limit 1;
    raise exception 'FAIL: wrote a removal record directly';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select array_agg(role) from public.team_removals where user_id = '00000000-0000-0000-0000-000000000004') = array['section_lead'],
         'a Volunteer Lead sees removed leads, not removed co-hosts';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.team_removals) = 0, 'a Section Lead sees no removals';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.team_removals) = 0, 'a stranger sees no removals';
end $$;
reset role;
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'section_lead');
do $$ begin
  assert not exists (select 1 from public.team_removals where role = 'section_lead' and user_id = '00000000-0000-0000-0000-000000000004'),
         'joining again clears the removal';
end $$;
-- Deleting an event doesn't trip over its team being removed.
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000004', 'section_lead');
delete from public.events where id = '10000000-0000-0000-0000-00000000000c';
do $$ begin
  assert not exists (select 1 from public.team_removals where event_id = '10000000-0000-0000-0000-00000000000c'),
         'deleting an event leaves no removal records';
end $$;

-- ---------------------------------------------------------------------------
-- Walk-up volunteers: the desk adds them (checked in), even to a full shift
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$
declare a uuid; before int;
begin
  select registered_count into before from public.shifts where id = '30000000-0000-0000-0000-000000000002';
  a := public.add_walk_up('30000000-0000-0000-0000-000000000002', 'Wally Walkup', '+15125550190');
  assert (select checked_in_at is not null from public.volunteer_assignments
           where volunteer_id = a and shift_id = '30000000-0000-0000-0000-000000000002'), 'a walk-up is checked in right away';
  assert (select registered_count from public.shifts where id = '30000000-0000-0000-0000-000000000002') = before + 1, 'a walk-up takes a spot';
  assert (select walk_up and email is null from public.volunteers where phone = '+15125550190'), 'a walk-up needs no email';
  begin
    perform public.add_walk_up('30000000-0000-0000-0000-000000000002', 'Wally Walkup', '+15125550190');
    raise exception 'FAIL: the same walk-up added to a shift twice';
  exception when raise_exception then null;
  end;
end $$;
-- A full shift asks first, then grows by one.
reset role;
update public.shifts set max_capacity = registered_count where id = '30000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$
declare cap int;
begin
  select max_capacity into cap from public.shifts where id = '30000000-0000-0000-0000-000000000002';
  begin
    perform public.add_walk_up('30000000-0000-0000-0000-000000000002', 'Fiona Full', '+15125550191');
    raise exception 'FAIL: a walk-up went into a full shift without asking';
  exception when sqlstate 'P0004' then null;
  end;
  perform public.add_walk_up('30000000-0000-0000-0000-000000000002', 'Fiona Full', '+15125550191', true);
  assert (select max_capacity from public.shifts where id = '30000000-0000-0000-0000-000000000002') = cap + 1,
         'adding anyway makes room for one more';
end $$;
-- Section Leads and strangers can't add walk-ups.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.add_walk_up('30000000-0000-0000-0000-000000000002', 'Sly Lead', '+15125550192');
    raise exception 'FAIL: a Section Lead added a walk-up';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.add_walk_up('30000000-0000-0000-0000-000000000002', 'Sam Stranger', '+15125550193');
    raise exception 'FAIL: a stranger added a walk-up';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.add_walk_up('30000000-0000-0000-0000-000000000002', 'Anon', '+15125550194');
    raise exception 'FAIL: a visitor added a walk-up';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Signing up with others, minors, and name-only walk-ups
-- ---------------------------------------------------------------------------
insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
  ('3a000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Family Parking',
   now() + interval '11 days', now() + interval '11 days 2 hours', 3),
  ('3a000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Tiny Parking',
   now() + interval '12 days', now() + interval '12 days 2 hours', 1);
set role service_role;
select public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Pat Pair', 'pat.pair@example.com', '+15125550170',
       array['3a000000-0000-0000-0000-000000000001']::uuid[], false,
       '[{"name": "Sam Pair"}, {"name": "Kid Pairson Junior", "minor": true}]'::jsonb) \g /dev/null
do $$
declare primary_id uuid;
begin
  select id into primary_id from public.volunteers where email = 'pat.pair@example.com';
  assert (select registered_count from public.shifts where id = '3a000000-0000-0000-0000-000000000001') = 3,
         'everyone in a signup takes a spot';
  assert (select count(*) from public.volunteers where contact_id = primary_id and phone = '+15125550170' and email is null) = 2,
         'the people added share the signer''s phone and have no email';
  assert exists (select 1 from public.volunteers where contact_id = primary_id and minor and full_name = 'Kid Pairson J.'),
         'a minor is stored as first name + last initial';
  begin
    perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Duo One', 'duo@example.com', '+15125550171',
            array['3a000000-0000-0000-0000-000000000002']::uuid[], false, '[{"name": "Duo Two"}]'::jsonb);
    raise exception 'FAIL: a group of 2 got the last 1 spot';
  exception when sqlstate 'P0002' then null;
  end;
  assert (select registered_count from public.shifts where id = '3a000000-0000-0000-0000-000000000002') = 0
     and not exists (select 1 from public.volunteers where email = 'duo@example.com'), 'a group that doesn''t fit books no one';
  begin
    perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Big Group', 'big@example.com', '+15125550172',
            array['3a000000-0000-0000-0000-000000000002']::uuid[], false,
            '[{"name":"A"},{"name":"B"},{"name":"C"},{"name":"D"},{"name":"E"}]'::jsonb);
    raise exception 'FAIL: added more than 4 people';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Teen Volunteer', 'guardian@example.com', '+15125550173',
          array['3a000000-0000-0000-0000-000000000002']::uuid[], true, '[]'::jsonb);
  assert (select full_name from public.volunteers where email = 'guardian@example.com') = 'Teen V.',
         'a minor signing up for themselves keeps only their last initial';
end $$;
reset role;
do $$ begin
  begin
    update public.volunteers set minor = true where email = 'pat.pair@example.com';
    raise exception 'FAIL: stored a minor''s full last name';
  exception when check_violation then null;
  end;
end $$;
-- The desk adds a walk-up by name only, with a minor alongside.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$
declare walk uuid;
begin
  walk := public.add_walk_up('3a000000-0000-0000-0000-000000000001', 'Nora Noname', null, true, false,
          '[{"name": "Nolan Noname", "minor": true}]'::jsonb);
  assert (select phone is null and walk_up from public.volunteers where id = walk), 'a walk-up needs only a name';
  assert (select count(*) from public.volunteer_assignments va join public.volunteers v on v.id = va.volunteer_id
           where va.shift_id = '3a000000-0000-0000-0000-000000000001' and (v.id = walk or v.contact_id = walk)
             and va.checked_in_at is not null) = 2, 'a walk-up and the person with them are both checked in';
  assert (select max_capacity from public.shifts where id = '3a000000-0000-0000-0000-000000000001') = 5,
         'adding a group to a full shift makes room for all of them';
  assert (select bool_or(minor and signed_up_by = 'Pat Pair') from public.station_roster('20000000-0000-0000-0000-00000000000a')),
         'the roster says who''s a minor and who signed them up';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Adults-only stations: no minors, by signup or at the desk
-- ---------------------------------------------------------------------------
update public.stations set adults_only = true where id = '20000000-0000-0000-0000-00000000000a';
insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
  ('30000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-00000000000a', 'Grown-up Parking',
   now() + interval '13 days', now() + interval '13 days 2 hours', 5);
set role service_role;
do $$ begin
  begin
    perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Mom Adult', 'mom.adult@example.com', '+15125550180',
            array['30000000-0000-0000-0000-0000000000a3']::uuid[], false, '[{"name": "Kiddo Adult", "minor": true}]'::jsonb);
    raise exception 'FAIL: a minor signed up for an adults-only station';
  exception when sqlstate 'P0005' then null;
  end;
  assert not exists (select 1 from public.volunteers where email = 'mom.adult@example.com'), 'nothing is booked when a minor is turned away';
  perform public.register_volunteer('10000000-0000-0000-0000-00000000000a', 'Mom Adult', 'mom.adult@example.com', '+15125550180',
          array['30000000-0000-0000-0000-0000000000a3']::uuid[], false, '[{"name": "Dad Adult"}]'::jsonb);
  assert (select registered_count from public.shifts where id = '30000000-0000-0000-0000-0000000000a3') = 2, 'adults can sign up';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  begin
    perform public.add_walk_up('30000000-0000-0000-0000-0000000000a3', 'Teen Walker', null, false, true);
    raise exception 'FAIL: the desk added a minor to an adults-only station';
  exception when sqlstate 'P0005' then null;
  end;
end $$;
reset role;
update public.stations set adults_only = false where id = '20000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- Maps & documents: only hosts see and change the file list
-- ---------------------------------------------------------------------------
do $$ begin
  assert (select not public from storage.buckets where id = 'event-files'), 'the files bucket is private';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences, created_by)
values ('10000000-0000-0000-0000-00000000000a', 'Stadium map', '10000000-0000-0000-0000-00000000000a/map.pdf', 'map.pdf',
        'application/pdf', 12345, array['public', 'directors'], '00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.event_files) = 1, 'a host sees their files';
  update public.event_files set label = 'Stadium & parking map';
  begin
    insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences, created_by)
    values ('10000000-0000-0000-0000-00000000000a', 'Bad', '10000000-0000-0000-0000-00000000000b/x.pdf', 'x.pdf',
            'application/pdf', 1, array['public'], auth.uid());
    raise exception 'FAIL: a file path outside its event''s folder';
  exception when check_violation then null;
  end;
  begin
    insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences, created_by)
    values ('10000000-0000-0000-0000-00000000000a', 'Bad', '10000000-0000-0000-0000-00000000000a/x.exe', 'x.exe',
            'application/x-msdownload', 1, array['public'], auth.uid());
    raise exception 'FAIL: stored a file type that isn''t a PDF or image';
  exception when check_violation then null;
  end;
end $$;
-- A Volunteer Lead, a Section Lead and a stranger can't read or change the list directly.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select count(*) from public.event_files) = 0, 'a Volunteer Lead doesn''t read the file list directly';
  update public.event_files set label = 'hijacked';
  delete from public.event_files;
  begin
    insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences, created_by)
    values ('10000000-0000-0000-0000-00000000000a', 'Mine', '10000000-0000-0000-0000-00000000000a/m.pdf', 'm.pdf',
            'application/pdf', 1, array['public'], auth.uid());
    raise exception 'FAIL: a Volunteer Lead added a file';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.event_files) = 0, 'a stranger can''t read the file list';
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.event_files;
    raise exception 'FAIL: a visitor read the file list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select label from public.event_files) = 'Stadium & parking map', 'only the host''s change stuck';
end $$;

-- ---------------------------------------------------------------------------
-- Maps & documents: who uploaded a file, and when (replacing counts as uploading)
-- ---------------------------------------------------------------------------
alter table public.event_files disable trigger event_files_stamp_upload;
update public.event_files set uploaded_at = now() - interval '1 day', uploaded_by = null;
alter table public.event_files enable trigger event_files_stamp_upload;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  update public.event_files set label = 'Renamed map';
  assert (select uploaded_by is null and uploaded_at < now() - interval '1 hour' from public.event_files),
         'renaming a file doesn''t change who uploaded it';
  update public.event_files set path = '10000000-0000-0000-0000-00000000000a/new-map.pdf';
  assert (select uploaded_by = auth.uid() and uploaded_at > now() - interval '1 minute' from public.event_files),
         'replacing a file records who uploaded it, and when';
  begin
    insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences, created_by, uploaded_by)
    values ('10000000-0000-0000-0000-00000000000a', 'Packet', '10000000-0000-0000-0000-00000000000a/p.pdf', 'p.pdf',
            'application/pdf', 1, array['directors'], auth.uid(), '00000000-0000-0000-0000-000000000006');
    raise exception 'FAIL: set someone else as the uploader';
  exception when insufficient_privilege then null;
  end;
  insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences, created_by)
  values ('10000000-0000-0000-0000-00000000000a', 'Packet', '10000000-0000-0000-0000-00000000000a/p.pdf', 'p.pdf',
          'application/pdf', 1, array['directors'], auth.uid());
  assert (select uploaded_by from public.event_files where label = 'Packet') = auth.uid(), 'a new file records its uploader';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Demo mode: demo people, added and removed only by the server
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-0000-0000-000000000001', 'host-1@demo.fieldcommandevents.com',     '{"full_name":"Demo Host"}'),
  ('d0000000-0000-0000-0000-000000000002', 'lead-1@demo.fieldcommandevents.com',     '{"full_name":"Demo Section Lead"}'),
  ('d0000000-0000-0000-0000-000000000003', 'director-1@demo.fieldcommandevents.com', '{"full_name":"Demo Director"}'),
  ('d0000000-0000-0000-0000-000000000004', 'vol-1@demo.fieldcommandevents.com',      '{"full_name":"Demo Volunteer"}');
insert into public.demo_accounts (user_id, owner_id, persona) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'host'),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'section_lead'),
  ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'director'),
  ('d0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'volunteer');

-- Browsers (even a demo account) can't see or change any of it.
set role authenticated;
set request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","email":"host-1@demo.fieldcommandevents.com"}';
do $$ begin
  begin
    perform 1 from public.demo_accounts;
    raise exception 'FAIL: a browser read the demo accounts';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.demo_events (owner_id, event_id) values (auth.uid(), '10000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: a browser turned on demo mode';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.demo_join('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', auth.uid());
    raise exception 'FAIL: a browser added a demo person to an event';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.demo_leave('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: a browser removed demo people';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.demo_events;
    raise exception 'FAIL: a visitor read the demo events';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role service_role;
do $$ begin
  begin
    perform public.demo_join('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
                             'd0000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: added a demo person to an event without demo mode on';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
insert into public.demo_events (owner_id, event_id)
values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a');
do $$
declare
  owner constant uuid := '00000000-0000-0000-0000-000000000001';
  ev    constant uuid := '10000000-0000-0000-0000-00000000000a';
  org   uuid := (select organization_id from public.events where id = ev);
  band  uuid;
  spots int := (select sum(registered_count) from public.shifts where event_id = ev);
begin
  begin
    perform public.demo_join('00000000-0000-0000-0000-000000000002', ev, 'd0000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: used someone else''s demo account';
  exception when sqlstate 'P0001' then null;
  end;

  perform public.demo_join(owner, ev, 'd0000000-0000-0000-0000-000000000001');
  assert exists (select 1 from public.organization_members
                  where organization_id = org and user_id = 'd0000000-0000-0000-0000-000000000001' and role = 'admin'),
         'the demo host co-hosts';

  perform public.demo_join(owner, ev, 'd0000000-0000-0000-0000-000000000002');
  assert exists (select 1 from public.event_staff
                  where event_id = ev and user_id = 'd0000000-0000-0000-0000-000000000002' and role = 'section_lead'),
         'the demo Section Lead is on the team';
  assert (select count(*) from public.station_leads where user_id = 'd0000000-0000-0000-0000-000000000002') between 1 and 2,
         'the demo Section Lead leads a station or two';

  band := public.demo_join(owner, ev, 'd0000000-0000-0000-0000-000000000003');
  assert band is not null and (select school_name from public.bands where id = band) = 'Demo High School',
         'the demo director has a band';
  assert public.demo_join(owner, ev, 'd0000000-0000-0000-0000-000000000003') = band, 'switching again keeps the same band';

  perform public.demo_join(owner, ev, 'd0000000-0000-0000-0000-000000000004');
  perform public.demo_join(owner, ev, 'd0000000-0000-0000-0000-000000000004');
  assert (select count(*) from public.volunteer_assignments va join public.volunteers v on v.id = va.volunteer_id
           where v.email = 'vol-1@demo.fieldcommandevents.com') = 1, 'the demo volunteer has one shift';
  assert (select sum(registered_count) from public.shifts where event_id = ev) = spots + 1, 'their spot is counted';

  perform public.demo_leave(owner, ev);
  assert (select sum(registered_count) from public.shifts where event_id = ev) = spots, 'their spot is freed';
  assert not exists (select 1 from public.volunteers where email = 'vol-1@demo.fieldcommandevents.com'), 'the demo volunteer is gone';
  assert not exists (select 1 from public.bands where id = band), 'the demo band is gone';
  assert not exists (select 1 from public.station_leads where user_id = 'd0000000-0000-0000-0000-000000000002'), 'the demo lead''s stations are freed';
  assert not exists (select 1 from public.event_staff where user_id::text like 'd0000000%'), 'the demo team is gone';
  assert not exists (select 1 from public.organization_members where user_id::text like 'd0000000%'), 'the demo host is gone';
  assert not exists (select 1 from public.team_removals where user_id::text like 'd0000000%'), 'demo people aren''t listed as removed';
  assert not exists (select 1 from public.demo_events where event_id = ev), 'demo mode is off for the event';
  assert exists (select 1 from public.organization_members where organization_id = org and user_id = owner), 'the real host stays';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Band invitations: hosts invite directors from their earlier events
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'past@example.com', '{"full_name":"Pat Past"}');
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address,
                           band_registration_deadline)
values ('10000000-0000-0000-0000-00000000000f',
        (select organization_id from public.events where id = '10000000-0000-0000-0000-00000000000a'),
        'Next Classic', 'next-classic', 'draft', current_date + 40, current_date + 40,
        now() + interval '40 days', now() + interval '40 days 10 hours', '1 Stadium Rd', current_date + 20);
insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000e1', 'West HS', 'Westwind', '5A',
        'addr', 'past@example.com', 'Pat Past', 'past@example.com', '+15125550120', 80, 8);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare r record;
begin
  select * into r from public.past_band_directors('10000000-0000-0000-0000-00000000000f') where email = 'past@example.com';
  assert found, 'a host sees directors from their earlier events';
  assert r.bands = array['Westwind (West HS)'] and r.last_event = 'Today Invitational' and not r.registered
         and r.invited_at is null, 'with their bands, last event and invitation status';
  begin
    insert into public.band_invitations (event_id, email) values ('10000000-0000-0000-0000-00000000000f', 'past@example.com');
    raise exception 'FAIL: a browser created a band invitation';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.band_invitations (event_id, email, invited_by)
values ('10000000-0000-0000-0000-00000000000f', 'past@example.com', '00000000-0000-0000-0000-000000000001');
set role authenticated;
do $$ begin
  assert (select invited_at is not null from public.past_band_directors('10000000-0000-0000-0000-00000000000f')
           where email = 'past@example.com'), 'the list shows who was invited';
  assert (select count(*) from public.band_invitations) = 1, 'a host sees their event''s invitations';
  -- 20270109000000: when one waits for opening day, why one failed, and where it moved.
  perform scheduled_for, failed_reason, replaced_by, failed_at from public.band_invitations;
  begin
    perform token from public.band_invitations;
    raise exception 'FAIL: a browser read an invitation''s sign-in token';
  exception when insufficient_privilege then null;
  end;
end $$;
-- A Volunteer Lead, the director and a stranger see neither the list nor the invitations.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select count(*) from public.past_band_directors('10000000-0000-0000-0000-00000000000f')) = 0
         and (select count(*) from public.past_band_directors('10000000-0000-0000-0000-00000000000a')) = 0,
         'a Volunteer Lead doesn''t see past directors';
  assert (select count(*) from public.band_invitations) = 0, 'a Volunteer Lead doesn''t see invitations';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","email":"past@example.com"}';
do $$ begin
  assert (select count(*) from public.past_band_directors('10000000-0000-0000-0000-00000000000f')) = 0, 'a director doesn''t see the list';
  assert (select count(*) from public.band_invitations) = 0, 'a director doesn''t read invitations';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.past_band_directors('10000000-0000-0000-0000-00000000000f')) = 0, 'a stranger sees nothing';
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.past_band_directors('10000000-0000-0000-0000-00000000000f');
    raise exception 'FAIL: a visitor listed past directors';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.band_invitations;
    raise exception 'FAIL: a visitor read band invitations';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Admin dashboard: plans, free-until dates and the admin log
-- ---------------------------------------------------------------------------
select organization_id as plan_org from public.events where id = '10000000-0000-0000-0000-00000000000a' \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    update public.organizations set free_until = current_date + 365;
    raise exception 'FAIL: a host extended their own free period';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_set_plan((select organization_id from public.events where id = '10000000-0000-0000-0000-00000000000a'),
                                  'active', null, null);
    raise exception 'FAIL: a host changed their own plan';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.admin_log) = 0, 'a host can''t read the admin log';
end $$;
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare
  org uuid := (select organization_id from public.events where id = '10000000-0000-0000-0000-00000000000a');
  -- Already past in the organization's own time zone, which org_has_active_plan() uses:
  -- on US evenings the server's UTC date is a day ahead, so "UTC yesterday" can still be today there.
  ended date := current_date - 2;
begin
  begin
    perform public.admin_set_plan(org, 'comped', null, null);
    raise exception 'FAIL: a pilot without its last free day';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.admin_set_plan(org, 'comped', ended, 'Pilot ended');
  assert not public.org_has_active_plan(org), 'a pilot past its last day isn''t active';
  assert (select details->'to'->>'free_until' from public.admin_log where organization_id = org) = ended::text
         and (select details->>'note' from public.admin_log where organization_id = org) = 'Pilot ended'
         and (select admin_id from public.admin_log where organization_id = org) = auth.uid(),
         'the change is logged with who made it';
end $$;
reset role;

-- After a pilot ends: published events stay editable, new ones can't be published.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  update public.events set director_info = 'Gates open at 7.' where id = '10000000-0000-0000-0000-00000000000a';
  assert (select director_info from public.events where id = '10000000-0000-0000-0000-00000000000a') = 'Gates open at 7.',
         'a host still edits a published event after their pilot ends';
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-00000000000f';
    raise exception 'FAIL: published a new event after the pilot ended';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.admin_set_plan(:'plan_org', 'comped', current_date, null);
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-00000000000f';
  assert (select status from public.events where id = '10000000-0000-0000-0000-00000000000f') = 'published',
         'a pilot is active through its last day';
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.admin_log;
    raise exception 'FAIL: a visitor read the admin log';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from public.platform_admins;
update public.organizations set subscription_status = 'comped', free_until = null;

-- ---------------------------------------------------------------------------
-- Event types: volunteer events have no bands
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare
  org uuid := (select organization_id from public.events where id = '10000000-0000-0000-0000-00000000000a');
  vol uuid;
  plain uuid;
begin
  assert (select event_type from public.events where id = '10000000-0000-0000-0000-00000000000a') = 'band_contest',
         'existing events are band contests';

  insert into public.events (organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address)
  values (org, 'Fall Fundraiser', 'fall-fundraiser', 'volunteer', current_date + 20, current_date + 20,
          now() + interval '20 days', now() + interval '20 days 6 hours', '1 Main St')
  returning id into vol;
  insert into public.stations (event_id, name) values (vol, 'Concessions');
  begin
    insert into public.stations (event_id, name, checkpoint_kind, checkpoint_order) values (vol, 'Bus parking', 'parking', 1);
    raise exception 'FAIL: a band check-in station on a volunteer event';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                              contact_email, head_director_name, head_director_email, head_director_phone,
                              student_count, chaperone_count)
    values (vol, auth.uid(), 'Central HS', 'Mighty Marching', '5A', 'addr', 'band@example.com', 'Bo Band',
            'band@example.com', '+15125550105', 10, 1);
    raise exception 'FAIL: a band on a volunteer event';
  exception when sqlstate 'P0001' then null;
  end;
  update public.events set band_registration_open = true where id = vol;
  assert not public.band_registration_is_open(vol), 'band registration never opens on a volunteer event';

  -- A band contest with bands can't become a volunteer event.
  begin
    update public.events set event_type = 'volunteer' where id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: switched a contest with bands to a volunteer event';
  exception when sqlstate 'P0001' then null;
  end;

  -- One without bands can; its check-in stations become plain stations.
  insert into public.events (organization_id, name, slug, starts_on, ends_on, window_start, window_end, venue_address)
  values (org, 'Maybe Contest', 'maybe-contest', current_date + 30, current_date + 30,
          now() + interval '30 days', now() + interval '30 days 6 hours', '1 Main St')
  returning id into plain;
  insert into public.stations (event_id, name, checkpoint_kind, checkpoint_order) values (plain, 'Gate', 'gate', 1);
  update public.events set event_type = 'volunteer', band_registration_open = true where id = plain;
  assert (select event_type from public.events where id = plain) = 'volunteer', 'switched to a volunteer event';
  assert (select checkpoint_kind is null from public.stations where event_id = plain), 'its check-in station became a plain station';
  assert not (select band_registration_open from public.events where id = plain), 'and band registration closed';
  update public.events set event_type = 'band_contest' where id = plain;
  assert (select event_type from public.events where id = plain) = 'band_contest', 'and back to a band contest';
  delete from public.events where id in (vol, plain);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- School visitor events: parent registration, the door, 30-day erasing
-- ---------------------------------------------------------------------------
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000c1',
        (select organization_id from public.events where id = '10000000-0000-0000-0000-00000000000a'),
        'Open House', 'open-house', 'published', 'school_visit', current_date + 3, current_date + 3,
        now() + interval '3 days', now() + interval '3 days 3 hours', '1 School Rd');
-- Registration starts closed, even once the event is published: nobody can register until the host opens it.
set role service_role;
do $$ begin
  assert not (select parent_registration_open from public.events where id = '10000000-0000-0000-0000-0000000000c1'),
         'parent registration starts closed';
  begin
    perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Early Parent', 'early@example.com', null,
            '[{"name":"Early Kid","teacher":"Smith","grade":"3rd"}]');
    raise exception 'registered before the host opened registration';
  exception when raise_exception then
    if sqlerrm not like '%closed%' then raise; end if;
  end;
end $$;
reset role;
update public.events set parent_registration_open = true where id = '10000000-0000-0000-0000-0000000000c1';
insert into public.event_staff (event_id, user_id, role)
values ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000003', 'section_lead');
set role service_role;
do $$
declare t1 uuid; t2 uuid;
begin
  t1 := public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Rita Parent', 'Rita@example.com', '+15125550170',
          '[{"name":"Ava Lopez","teacher":"Smith","grade":"3rd"},{"name":"Leo Lopez","teacher":"Jones","grade":"K"}]');
  -- Registering again with the same email changes nothing (someone who only
  -- knows a parent's email can't replace their children); the server emails
  -- that parent their own link instead.
  t2 := public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Someone Else', 'rita@example.com', null,
          '[{"name":"Other Kid","teacher":"X","grade":"3rd"}]');
  assert t2 is null and (select parent_name = 'Rita Parent' and jsonb_array_length(children) = 2
                           from public.parent_registrations where email = 'rita@example.com'),
         'registering again with a known email changes nothing';
  assert (select adult_count from public.parent_registrations where email = 'rita@example.com') = 1,
         'one adult when not given';
  -- The parent edits from their own link: same link, calendar invite version bumped.
  assert public.update_parent_registration(t1, 'Rita Parent', null,
           '[{"name":"Ava Lopez","teacher":"Smith","grade":"3rd"}]', '[" Marco Lopez ", "Rosa Diaz"]')
         = '10000000-0000-0000-0000-0000000000c1', 'a parent edits with their link';
  assert (select jsonb_array_length(children) = 1 and calendar_sequence = 1 and phone is null
            from public.parent_registrations where access_token = t1),
         'editing replaces the children and bumps the calendar invite version';
  assert (select adult_count = 3
                 and other_adults = '[{"name": "Marco Lopez", "checked_in_at": null, "checked_in_by": null},
                                      {"name": "Rosa Diaz", "checked_in_at": null, "checked_in_by": null}]'::jsonb
            from public.parent_registrations where email = 'rita@example.com'),
         'other adults are named, and counted with the parent';
  begin
    perform public.update_parent_registration(gen_random_uuid(), 'Rita Parent', null, '[{"name":"A B","teacher":"X","grade":"1st"}]');
    raise exception 'FAIL: edited a registration without its link';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Big Group', 'big@example.com', null,
              '[{"name":"Mia","teacher":"Lee","grade":"2nd"}]', '["A One","B Two","C Three","D Four","E Five","F Six"]');
    raise exception 'FAIL: registered 6 other adults';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Blank Adult', 'blank@example.com', null,
              '[{"name":"Mia","teacher":"Lee","grade":"2nd"}]', '[" "]');
    raise exception 'FAIL: registered an adult with no name';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'No Kids', 'nokids@example.com', null, '[]');
    raise exception 'FAIL: registered with no children';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Half Filled', 'half@example.com', null,
              '[{"name":"Mia","teacher":"","grade":"2nd"}]');
    raise exception 'FAIL: registered a child without a teacher';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.register_parents('10000000-0000-0000-0000-00000000000a', 'Wrong Event', 'wrong@example.com', null,
              '[{"name":"Mia","teacher":"Lee","grade":"2nd"}]');
    raise exception 'FAIL: parent registration on a band contest';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Sam Second', 'sam@example.com', null,
            '[{"name":"Noah Kim","teacher":"Lee","grade":"5th"}]');
  assert public.cancel_parent_registration((select access_token from public.parent_registrations where email = 'sam@example.com'))
         = '10000000-0000-0000-0000-0000000000c1', 'a parent cancels with their link';
end $$;
reset role;
set role authenticated;
-- Children's details: a Section Lead sees nothing before event day; a Volunteer Lead does.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert not public.can_check_in_parents('10000000-0000-0000-0000-0000000000c1'), 'a Section Lead can''t work the door before event day';
  assert (select count(*) from public.parent_registrations) = 0, 'a Section Lead sees no children''s details before event day';
  begin
    perform public.set_parent_checked_in((select id from public.parent_registrations limit 1), true);
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.event_staff (event_id, user_id, role)
values ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000007', 'volunteer_director');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
do $$ begin
  assert (select count(*) from public.parent_registrations) = 1, 'a Volunteer Lead sees registrations before event day';
end $$;
-- On event day the Section Lead works the door: sees registrations (never the links) and checks parents in.
reset role;
delete from public.event_staff where event_id = '10000000-0000-0000-0000-0000000000c1' and user_id = '00000000-0000-0000-0000-000000000007';
update public.events set starts_on = (now() at time zone timezone)::date, ends_on = (now() at time zone timezone)::date
 where id = '10000000-0000-0000-0000-0000000000c1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert public.can_check_in_parents('10000000-0000-0000-0000-0000000000c1'), 'a Section Lead works the door on event day';
  assert (select count(*) from public.parent_registrations) = 1, 'the team sees registrations';
  assert (select adult_count = 3 and jsonb_array_length(other_adults) = 2 from public.parent_registrations),
         'the team sees the other adults coming';
  begin
    perform access_token from public.parent_registrations;
    raise exception 'FAIL: a browser read a parent''s private link';
  exception when insufficient_privilege then null;
  end;
  perform public.set_parent_checked_in((select id from public.parent_registrations), true);
  assert (select checked_in_at is not null and checked_in_by = auth.uid() from public.parent_registrations), 'checked in, and by whom';
  -- Each adult is checked in on their own.
  assert (select other_adults -> 0 ->> 'checked_in_at' is null from public.parent_registrations),
         'checking in the parent leaves the other adults waiting';
  perform public.set_parent_checked_in((select id from public.parent_registrations), true, 2);
  assert (select other_adults -> 1 ->> 'checked_in_at' is not null
             and other_adults -> 1 ->> 'checked_in_by' = auth.uid()::text
             and other_adults -> 0 ->> 'checked_in_at' is null from public.parent_registrations),
         'a grandparent checks in separately';
  perform public.set_parent_checked_in((select id from public.parent_registrations), false, 2);
  assert (select other_adults -> 1 ->> 'checked_in_at' is null from public.parent_registrations), 'one adult''s check-in can be undone';
  perform public.set_parent_checked_in((select id from public.parent_registrations), true, 1);
  begin
    perform public.set_parent_checked_in((select id from public.parent_registrations), true, 3);
    raise exception 'FAIL: checked in an adult who isn''t on the registration';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update public.parent_registrations set parent_name = 'Changed';
    raise exception 'FAIL: a browser edited a registration';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.update_parent_registration(gen_random_uuid(), 'X Y', null, '[]');
    raise exception 'FAIL: a browser called update_parent_registration';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.parent_registrations) = 0, 'a stranger sees no registrations';
  begin
    perform public.set_parent_checked_in((select id from public.parent_registrations limit 1), false);
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.events set starts_on = current_date + 3, ends_on = current_date + 3
 where id = '10000000-0000-0000-0000-0000000000c1';
-- Editing a registration keeps anyone already checked in as checked in.
do $$ begin
  perform public.update_parent_registration((select access_token from public.parent_registrations where email = 'rita@example.com'),
          'Rita Parent', null, '[{"name":"Ava Lopez","teacher":"Smith","grade":"3rd"}]', '["marco lopez", "New Uncle"]');
  assert (select other_adults -> 0 ->> 'checked_in_at' is not null and other_adults -> 1 ->> 'checked_in_at' is null
            from public.parent_registrations where email = 'rita@example.com'),
         'editing keeps check-ins of adults still on the list';
end $$;
-- Registration closes on its own at the time the host picked.
do $$ begin
  update public.events set parent_registration_closes_at = now() - interval '1 minute' where id = '10000000-0000-0000-0000-0000000000c1';
  begin
    perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Too Late', 'late@example.com', null,
              '[{"name":"Mia","teacher":"Lee","grade":"2nd"}]');
    raise exception 'FAIL: registered after registration closed';
  exception when sqlstate 'P0001' then null;
  end;
  update public.events set parent_registration_closes_at = now() + interval '1 day' where id = '10000000-0000-0000-0000-0000000000c1';
  perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'On Time', 'ontime@example.com', null,
            '[{"name":"Mia","teacher":"Lee","grade":"2nd"}]');
  delete from public.parent_registrations where email = 'ontime@example.com';
  update public.events set parent_registration_closes_at = null where id = '10000000-0000-0000-0000-0000000000c1';
end $$;
do $$ begin
  assert (select checked_in_at is not null from public.parent_registrations where email = 'rita@example.com'),
         'a stranger couldn''t undo a check-in';
end $$;
set role anon;
do $$ begin
  begin
    perform 1 from public.parent_registrations;
    raise exception 'FAIL: a visitor read parent registrations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_parents('10000000-0000-0000-0000-0000000000c1', 'Direct', 'direct@example.com', null,
              '[{"name":"X","teacher":"Y","grade":"1st"}]');
    raise exception 'FAIL: a browser registered without going through the server';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- No bands on a school visitor event, and it keeps its type once parents register.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    update public.events set event_type = 'volunteer' where id = '10000000-0000-0000-0000-0000000000c1';
    raise exception 'FAIL: switched a school visitor event with registrations';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.stations (event_id, name, checkpoint_kind, checkpoint_order)
    values ('10000000-0000-0000-0000-0000000000c1', 'Gate', 'gate', 1);
    raise exception 'FAIL: a band check-in station on a school visitor event';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
reset role;

-- 30 days after the event: hidden, then erased.
update public.events set starts_on = (now() at time zone timezone)::date - 31, ends_on = (now() at time zone timezone)::date - 31,
       window_start = now() - interval '31 days', window_end = now() - interval '31 days' + interval '3 hours'
 where id = '10000000-0000-0000-0000-0000000000c1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select count(*) from public.parent_registrations) = 0, 'registrations are hidden 30 days after the event';
end $$;
reset role;
set role service_role;
do $$ begin
  assert public.purge_parent_registrations() = 1, 'and erased by the clean-up';
  assert not exists (select 1 from public.parent_registrations), 'nothing left';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000c1';

-- ---------------------------------------------------------------------------
-- Group events: groups register like bands; rooms and each group's times
-- ---------------------------------------------------------------------------
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end,
                           venue_address, band_registration_open)
values ('10000000-0000-0000-0000-0000000000d1',
        (select organization_id from public.events where id = '10000000-0000-0000-0000-00000000000a'),
        'Spring Choir Festival', 'spring-choir', 'published', 'group_event', current_date + 5, current_date + 5,
        now() + interval '5 days', now() + interval '5 days 8 hours', '1 School Rd', true);
set role authenticated;
-- A director registers a choir (registration is open on a choir festival).
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('40000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', auth.uid(), 'Central HS',
        'Varsity Treble', '5A', 'addr', 'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 40, 4);
-- A second group (set up directly; groups register under their own director).
reset role;
insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('40000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000002',
        'West HS', 'Chamber Singers', '5A', 'addr', 'w@example.com', 'Dee Director', 'director@example.com', '+15125550106', 24, 2);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare
  ev    uuid := '10000000-0000-0000-0000-0000000000d1';
  t0    timestamptz := date_trunc('hour', now()) + interval '5 days';
  warm  uuid; stage uuid; sight uuid;
begin
  perform public.save_rooms(ev, '[
    {"name":"Warm-up","note":"Choir room, Room 112","on_path":true,"minutes":20},
    {"name":"Main Stage","note":"Auditorium","on_path":true,"minutes":15},
    {"name":"Sight-reading","note":"Black box","on_path":true,"minutes":20},
    {"name":"Hospitality","on_path":false}]');
  select id into warm from public.rooms where event_id = ev and name = 'Warm-up';
  select id into stage from public.rooms where event_id = ev and name = 'Main Stage';
  select id into sight from public.rooms where event_id = ev and name = 'Sight-reading';
  assert (select path_order from public.rooms where id = sight) = 3
     and (select path_order from public.rooms where event_id = ev and name = 'Hospitality') is null,
         'rooms on the path are numbered in order; others are just listed';

  perform public.save_room_schedule(ev, t0, 20, 5, jsonb_build_array(
    jsonb_build_object('band_id', '40000000-0000-0000-0000-0000000000d1'),
    jsonb_build_object('band_id', '40000000-0000-0000-0000-0000000000d2', 'skipped_room_ids', jsonb_build_array(sight),
                       'extra_minutes_before', 10)));
  assert (select count(*) from public.room_slots where event_id = ev) = 5, 'three stops for one choir, two for the one skipping a room';
  assert (select starts_at from public.room_slots where room_id = stage and band_id = '40000000-0000-0000-0000-0000000000d1')
         = t0 + interval '25 minutes', 'the next room starts after the last one plus passing time';
  assert (select starts_at from public.room_slots where room_id = warm and band_id = '40000000-0000-0000-0000-0000000000d2')
         = t0 + interval '30 minutes', 'the next choir starts one interval later, plus its break';
  assert not exists (select 1 from public.room_slots where room_id = sight and band_id = '40000000-0000-0000-0000-0000000000d2'),
         'a skipped room has no time';

  -- Renaming or retiming a room updates everyone's times.
  perform public.save_rooms(ev, jsonb_build_array(
    jsonb_build_object('id', warm, 'name', 'Warm-up', 'on_path', true, 'minutes', 30),
    jsonb_build_object('id', stage, 'name', 'Main Stage', 'on_path', true, 'minutes', 15),
    jsonb_build_object('id', sight, 'name', 'Sight-reading', 'on_path', true, 'minutes', 20)));
  assert (select starts_at from public.room_slots where room_id = stage and band_id = '40000000-0000-0000-0000-0000000000d1')
         = t0 + interval '35 minutes', 'room changes rebuild the times';
  assert not exists (select 1 from public.rooms where event_id = ev and name = 'Hospitality'), 'a room left out is removed';

  begin
    update public.events set event_type = 'volunteer' where id = ev;
    raise exception 'FAIL: switched a choir festival with choirs registered';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.stations (event_id, name, checkpoint_kind, checkpoint_order) values (ev, 'Gate', 'gate', 1);
    raise exception 'FAIL: a band check-in station on a choir festival';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- The team sees the working schedule before it's posted.
reset role;
insert into public.event_staff (event_id, user_id, role)
values ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000003', 'section_lead');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.room_slots) = 5, 'the team sees every choir''s times before they''re posted';
  assert (select count(*) from public.group_order) = 0, 'but not the host''s working order';
end $$;
-- Not posted yet: directors and the public see no times.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.room_slots) = 0, 'a director sees no times before the schedule is posted';
  assert (select count(*) from public.group_order) = 0, 'and never the host''s working order';
  begin
    perform public.save_rooms('10000000-0000-0000-0000-0000000000d1', '[]');
    raise exception 'FAIL: a director changed the rooms';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_room_schedule('10000000-0000-0000-0000-0000000000d1', now(), 20, 5, '[]');
    raise exception 'FAIL: a director changed the schedule';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  assert (select count(*) from public.public_room_schedule('spring-choir')) = 0, 'nothing public before it''s posted';
  assert (select count(*) from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1') = 3, 'room names are public';
  begin
    perform 1 from public.room_slots;
    raise exception 'FAIL: the public read room_slots directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.events set performance_order_published = true where id = '10000000-0000-0000-0000-0000000000d1';
set role anon;
do $$ begin
  assert (select count(*) from public.public_room_schedule('spring-choir')) = 5, 'the posted schedule is public';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.room_slots) = 3, 'once posted, a director sees only their own choir''s times';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.room_slots) = 0, 'a stranger reads no times directly';
end $$;
-- On the day: the team taps groups in ("Arrived", then "Done" per room).
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$
declare
  stage uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Main Stage');
begin
  perform public.group_checkin('40000000-0000-0000-0000-0000000000d1', null, true);
  perform public.group_checkin('40000000-0000-0000-0000-0000000000d1', null, true);
  assert (select count(*) from public.group_checkins) = 1, 'a Section Lead marks a group arrived (twice is still once)';
  perform public.group_checkin('40000000-0000-0000-0000-0000000000d2', stage, true);
  assert (select count(*) from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d2') = 2,
         'a room done also marks the group arrived';
  assert (select actor_name from public.group_checkins where room_id = stage) is not null, 'taps say who';
  perform public.group_checkin('40000000-0000-0000-0000-0000000000d2', stage, false);
  assert not exists (select 1 from public.group_checkins where room_id = stage), 'a tap can be taken back';
  perform public.group_checkin('40000000-0000-0000-0000-0000000000d2', stage, true);
  begin
    perform public.group_checkin('40000000-0000-0000-0000-0000000000d1',
      (select id from public.rooms where event_id <> '10000000-0000-0000-0000-0000000000d1' limit 1), true);
    raise exception 'FAIL: checked a group into another event''s room';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.group_checkin('40000000-0000-0000-0000-000000000001', null, true);
    raise exception 'FAIL: group check-in on a band contest';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.group_checkins (event_id, band_id) values ('10000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d1');
    raise exception 'FAIL: wrote group_checkins directly';
  exception when insufficient_privilege then null;
  end;
end $$;
-- A director sees their own group's taps, can't tap; a stranger sees and taps nothing.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.group_checkins) = 1, 'a director sees only their own group''s taps';
  begin
    perform public.group_checkin('40000000-0000-0000-0000-0000000000d1', null, false);
    raise exception 'FAIL: a director took back a check-in';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select count(*) from public.group_checkins) = 2, 'the other director sees their group''s arrival and room';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.group_checkins) = 0, 'a stranger reads no taps';
  begin
    perform public.group_checkin('40000000-0000-0000-0000-0000000000d1', null, true);
    raise exception 'FAIL: a stranger checked a group in';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.group_checkins;
    raise exception 'FAIL: the public read group_checkins';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Festival update (2026-11-11): versions, marks that stay, two days, dates, door links, the live view,
-- registration, publishing, copying, and directors' marks.
reset role;
update public.events set ends_on = starts_on + 1 where id = '10000000-0000-0000-0000-0000000000d1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare
  ev    uuid := '10000000-0000-0000-0000-0000000000d1';
  warm  uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Warm-up');
  stage uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Main Stage');
  sight uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Sight-reading');
  v0    bigint := (select room_schedule_version from public.events where id = '10000000-0000-0000-0000-0000000000d1');
  v1    bigint;
  d1    date := (select starts_on from public.events where id = '10000000-0000-0000-0000-0000000000d1');
  t1    timestamptz;
  t2    timestamptz := date_trunc('hour', now()) + interval '6 days 2 hours';
  ok    boolean := false;
  rooms jsonb;
begin
  rooms := jsonb_build_array(
    jsonb_build_object('id', warm, 'name', 'Warm-up', 'on_path', true, 'minutes', 30),
    jsonb_build_object('id', stage, 'name', 'Main Stage', 'on_path', true, 'minutes', 15),
    jsonb_build_object('id', sight, 'name', 'Sight-reading', 'on_path', true, 'minutes', 20));
  v1 := public.save_rooms(ev, rooms, v0, 'Warm-up 30 minutes');
  assert v1 = v0 + 1, 'a save moves the version on';
  assert (select summary from public.room_schedule_changes where event_id = ev and version = v1) = 'Warm-up 30 minutes'
     and (select saver_name from public.room_schedule_changes where event_id = ev and version = v1) is not null,
         'and records who saved what';
  begin
    perform public.save_rooms(ev, rooms, v0);
  exception when sqlstate 'FC409' then ok := true;
  end;
  assert ok, 'a save from a page that loaded an older version is refused (two co-hosts at once)';
  ok := false;
  begin
    perform public.save_room_schedule(ev, now(), 20, 5, '[]', null, v0);
  exception when sqlstate 'FC409' then ok := true;
  end;
  assert ok, 'the schedule checks the version too';

  -- The team marked a group done in Main Stage, so it can't be removed.
  ok := false;
  begin
    perform public.save_rooms(ev, jsonb_build_array(
      jsonb_build_object('id', warm, 'name', 'Warm-up', 'on_path', true, 'minutes', 30),
      jsonb_build_object('id', sight, 'name', 'Sight-reading', 'on_path', true, 'minutes', 20)));
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok and exists (select 1 from public.rooms where id = stage), 'a room with the team''s marks can''t be removed';

  -- Two days: each day has its own first start; the second day counts from its own start.
  t1 := (select starts_at from public.room_slots where room_id = warm and band_id = '40000000-0000-0000-0000-0000000000d1');
  perform public.save_room_schedule(ev, t1, 20, 5, jsonb_build_array(
      jsonb_build_object('band_id', '40000000-0000-0000-0000-0000000000d1'),
      jsonb_build_object('band_id', '40000000-0000-0000-0000-0000000000d2', 'day', d1 + 1, 'extra_minutes_before', 10)),
    jsonb_build_array(jsonb_build_object('day', d1 + 1, 'starts_at', t2)));
  assert (select starts_at from public.room_slots where room_id = warm and band_id = '40000000-0000-0000-0000-0000000000d2')
         = t2 + interval '10 minutes', 'the first group on day two starts at day two''s start (plus its break)';
  assert (select starts_at from public.room_slots where room_id = warm and band_id = '40000000-0000-0000-0000-0000000000d1') = t1,
         'day one keeps its own start';
  ok := false;
  begin
    perform public.save_room_schedule(ev, t1, 20, 5, jsonb_build_array(
      jsonb_build_object('band_id', '40000000-0000-0000-0000-0000000000d1', 'day', d1 + 5)));
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a group can only be on one of the festival''s days';
end $$;

-- The schedule moves with the festival's dates.
reset role;
do $$
declare
  ev uuid := '10000000-0000-0000-0000-0000000000d1';
  before_1 timestamptz := (select min(starts_at) from public.room_slots where band_id = '40000000-0000-0000-0000-0000000000d1');
  before_2 timestamptz := (select min(starts_at) from public.room_slots where band_id = '40000000-0000-0000-0000-0000000000d2');
begin
  update public.events set starts_on = starts_on + 7, ends_on = ends_on + 7 where id = ev;
  assert (select min(starts_at) from public.room_slots where band_id = '40000000-0000-0000-0000-0000000000d1')
         = ((before_1 at time zone 'America/Chicago') + interval '7 days') at time zone 'America/Chicago'
         or (select timezone from public.events where id = ev) <> 'America/Chicago',
         'moving the festival a week moves day one''s times with it';
  assert (select min(starts_at) from public.room_slots where band_id = '40000000-0000-0000-0000-0000000000d2') - before_2
         between interval '6 days 23 hours' and interval '7 days 1 hour', 'and day two''s';
  assert (select day from public.group_order where band_id = '40000000-0000-0000-0000-0000000000d2')
         = (select starts_on + 1 from public.events where id = ev), 'groups stay on their day';
  update public.events set starts_on = starts_on - 7, ends_on = ends_on - 7 where id = ev;
end $$;

-- In the app: shortening the dates is refused while a group is on a day that would drop off, naming it; moving both
-- dates together moves everyone; a new time zone keeps every group's clock times; each move is a new version.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare
  ev  uuid := '10000000-0000-0000-0000-0000000000d1';
  ok  boolean := false;
  msg text;
  v0  bigint := (select room_schedule_version from public.events where id = '10000000-0000-0000-0000-0000000000d1');
  local_1 timestamp := (select min(starts_at) at time zone 'America/Chicago' from public.room_slots
                         where band_id = '40000000-0000-0000-0000-0000000000d1');
  d2_day  date := (select day from public.group_order where band_id = '40000000-0000-0000-0000-0000000000d2');
begin
  assert (select timezone from public.events where id = ev) = 'America/Chicago', 'the test festival is on Central Time';
  begin
    update public.events set ends_on = starts_on where id = ev;
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Move Chamber Singers to another day first%', 'shortening the dates is refused, naming the group on the dropped day';
  assert (select ends_on from public.events where id = ev) = d2_day, 'and the dates stay as they were';
  ok := false;
  begin
    update public.events set starts_on = starts_on + 1 where id = ev;
  exception when sqlstate 'P0001' then ok := sqlerrm like 'Move Chamber Singers%';
  end;
  assert ok, 'moving only the first day later pushes day two off the end: refused too';
  update public.events set starts_on = starts_on + 1, ends_on = ends_on + 1 where id = ev;
  assert (select day from public.group_order where band_id = '40000000-0000-0000-0000-0000000000d2') = d2_day + 1,
         'moving both dates together moves the groups with them';
  assert (select room_schedule_version from public.events where id = ev) = v0 + 1
     and (select summary from public.room_schedule_changes where event_id = ev and version = v0 + 1) = 'The festival''s dates moved',
         'a date move is a new version, logged';
  update public.events set starts_on = starts_on - 1, ends_on = ends_on - 1 where id = ev;
  update public.events set timezone = 'America/Denver' where id = ev;
  assert (select min(starts_at) at time zone 'America/Denver' from public.room_slots where band_id = '40000000-0000-0000-0000-0000000000d1') = local_1,
         'a new time zone keeps each group''s clock times';
  assert (select summary from public.room_schedule_changes where event_id = ev
           and version = (select room_schedule_version from public.events where id = ev)) = 'The festival''s time zone changed',
         'and is a new version too';
  update public.events set timezone = 'America/Chicago' where id = ev;
  assert (select min(starts_at) at time zone 'America/Chicago' from public.room_slots where band_id = '40000000-0000-0000-0000-0000000000d1') = local_1,
         'and back again';
end $$;

-- Rooms and spacing save in one step, and the database checks the ranges.
do $$
declare
  ev uuid := '10000000-0000-0000-0000-0000000000d1';
  v0 bigint := (select room_schedule_version from public.events where id = '10000000-0000-0000-0000-0000000000d1');
  ok boolean := false;
begin
  assert public.save_rooms(ev, null, v0, 'A new group every 25 minutes', 25, 10) = v0 + 1, 'spacing saves as one version step';
  assert (select room_interval_minutes = 25 and room_passing_minutes = 10 from public.events where id = ev), 'with both numbers';
  begin
    perform public.save_rooms(ev, null, null, null, 2, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a new group every 2 minutes is refused';
  ok := false;
  begin
    perform public.save_rooms(ev, null, null, null, null, 90);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, '90 minutes of walking is refused';
  ok := false;
  begin
    perform public.save_rooms(ev, jsonb_build_array(jsonb_build_object('name', 'Long room', 'on_path', true, 'minutes', 0)));
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a room on the path takes 1 to 240 minutes';
  ok := false;
  begin
    perform public.save_room_schedule(ev, now(), 20, 61, '[]');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'the schedule checks the walking time too';
  perform public.save_rooms(ev, null, null, 'Back to every 20 minutes', 20, 5);
end $$;
reset role;

-- On the day: in a room now, didn't come, and the hand-off.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$
declare
  stage uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Main Stage');
  warm  uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Warm-up');
begin
  perform public.group_mark('40000000-0000-0000-0000-0000000000d2', null, 'no_show', true);
  assert exists (select 1 from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d2' and kind = 'no_show'),
         'the team marks a group that didn''t come';
  perform public.group_mark('40000000-0000-0000-0000-0000000000d2', warm, 'in', true);
  assert not exists (select 1 from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d2' and kind = 'no_show'),
         'marking it in a room clears "didn''t come"';
  perform public.group_room_handoff(warm, '40000000-0000-0000-0000-0000000000d2', '40000000-0000-0000-0000-0000000000d1');
  assert exists (select 1 from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d2' and room_id = warm and kind = 'done')
     and exists (select 1 from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d1' and room_id = warm and kind = 'in'),
         '"done, next group is in" marks both';
  -- Done keeps the mark that it went in (20270131000000), so Undo puts it back with its first time.
  assert exists (select 1 from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d2' and room_id = warm and kind = 'in'),
         'done in a room keeps when it went in';
  perform public.group_mark('40000000-0000-0000-0000-0000000000d2', warm, 'done', false);
  assert exists (select 1 from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d2' and room_id = warm and kind = 'in')
     and not exists (select 1 from public.group_checkins where band_id = '40000000-0000-0000-0000-0000000000d2' and room_id = warm and kind = 'done'),
         'undoing done leaves the group in the room';
  perform public.group_mark('40000000-0000-0000-0000-0000000000d2', warm, 'done', true);
  begin
    perform public.group_mark('40000000-0000-0000-0000-0000000000d1', warm, 'no_show', true);
    raise exception 'FAIL: "didn''t come" for one room';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.room_door_link_new(stage);
    raise exception 'FAIL: a lead made a door link';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  begin
    perform public.group_mark('40000000-0000-0000-0000-0000000000d1', null, 'done', true);
    raise exception 'FAIL: a director marked their own group';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A door link: one room, no sign-in, until it's turned off.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
select set_config('test.door', public.room_door_link_new(
  (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Sight-reading')), false);
reset role;
set role anon;
do $$
declare
  tok   text := current_setting('test.door');
  door  jsonb := public.room_door(current_setting('test.door'));
  sight uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Sight-reading');
  stage uuid := (select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Main Stage');
begin
  assert door -> 'room' ->> 'name' = 'Sight-reading', 'a door link opens its room without signing in';
  assert jsonb_array_length(door -> 'groups') = 2, 'with every group that has a time there';
  assert not (door::text ilike '%example.com%') and not (door::text ilike '%Bo Band%') and not (door::text ilike '%actor%'),
         'and no one''s email, name, or who marked what';
  assert public.room_door('not-a-real-token-not-a-real-token-not-a-real') is null, 'a wrong link opens nothing';
  perform public.room_door_handoff(tok, null, '40000000-0000-0000-0000-0000000000d1');
  assert exists (select 1 from public.public_room_live('spring-choir') where band_id = '40000000-0000-0000-0000-0000000000d1'
                  and room_id = sight and kind = 'in'), 'the door marks a group in its room';
  begin
    perform public.room_door_mark(tok, '40000000-0000-0000-0000-0000000000d1', 'no_show', true);
    raise exception 'FAIL: the door marked "didn''t come"';
  exception when sqlstate 'P0001' then null;
  end;
  -- Its own room only: the stage id is never accepted, the room comes from the link.
  assert not exists (select 1 from public.public_room_live('spring-choir') where room_id = stage and kind = 'in'),
         'a door link can''t mark another room';
end $$;
-- Families' live view has only "in a room" and "done there", never arrived or didn't come.
do $$ begin
  assert not exists (select 1 from public.public_room_live('spring-choir') where room_id is null or kind not in ('in', 'done')),
         'the live view shows only in and done marks in rooms';
end $$;
-- A withdrawn group leaves the door, the posted schedule, and the live view, and the door can't mark it.
reset role;
update public.bands set scratched_at = now() where id = '40000000-0000-0000-0000-0000000000d1';
set role anon;
do $$
declare
  tok text := current_setting('test.door');
  ok  boolean := false;
begin
  assert not (public.room_door(tok)::text like '%40000000-0000-0000-0000-0000000000d1%'), 'a withdrawn group isn''t on the door''s list';
  assert not exists (select 1 from public.public_room_schedule('spring-choir') where band_id = '40000000-0000-0000-0000-0000000000d1'),
         'or the posted schedule';
  assert not exists (select 1 from public.public_room_live('spring-choir') where band_id = '40000000-0000-0000-0000-0000000000d1'),
         'or the live view';
  begin
    perform public.room_door_mark(tok, '40000000-0000-0000-0000-0000000000d1', 'done', true);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'the door can''t mark a withdrawn group';
end $$;
reset role;
update public.bands set scratched_at = null where id = '40000000-0000-0000-0000-0000000000d1';
-- A door link stops working at the end of the day after the festival's last day.
do $$
declare
  ev    uuid := '10000000-0000-0000-0000-0000000000d1';
  s0    date := (select starts_on from public.events where id = '10000000-0000-0000-0000-0000000000d1');
  today date := (now() at time zone (select timezone from public.events where id = '10000000-0000-0000-0000-0000000000d1'))::date;
begin
  update public.events set starts_on = today - 2, ends_on = today - 1 where id = ev;
  assert public.room_door(current_setting('test.door')) is not null, 'a door link works the day after the festival';
  update public.events set starts_on = today - 3, ends_on = today - 2 where id = ev;
  assert public.room_door(current_setting('test.door')) is null, 'and not the day after that';
  update public.events set starts_on = s0, ends_on = s0 + 1 where id = ev;
  assert public.room_door(current_setting('test.door')) is not null, 'back on its dates, it works again';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  perform public.room_door_link_off((select id from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d1' and name = 'Sight-reading'));
end $$;
reset role;
set role anon;
do $$ begin
  assert public.room_door(current_setting('test.door')) is null, 'a turned-off link opens nothing';
  begin
    perform public.room_door_mark(current_setting('test.door'), '40000000-0000-0000-0000-0000000000d1', 'done', true);
    raise exception 'FAIL: a turned-off door link marked a group';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.room_door_links;
    raise exception 'FAIL: the public read door links';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.public_room_live('spring-choir')) > 0, 'families see the team''s marks once posted';
end $$;
reset role;
update public.events set performance_order_published = false where id = '10000000-0000-0000-0000-0000000000d1';
set role anon;
do $$ begin
  assert (select count(*) from public.public_room_live('spring-choir')) = 0, 'and nothing before the schedule is posted';
end $$;
reset role;
-- A director reads their group's marks only while the festival is published.
update public.events set status = 'draft' where id = '10000000-0000-0000-0000-0000000000d1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.group_checkins) = 0, 'a director reads no marks on an unpublished festival';
end $$;
reset role;
update public.events set status = 'published', performance_order_published = true where id = '10000000-0000-0000-0000-0000000000d1';

-- Registration: no classifications, fewer answers, when a group can come, and a group limit.
update public.events set classifications = '{}', max_groups = 3 where id = '10000000-0000-0000-0000-0000000000d1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  insert into public.bands (id, event_id, director_user_id, school_name, band_name, contact_email, head_director_email,
                            student_count, available_day, earliest_start)
  values ('40000000-0000-0000-0000-0000000000d3', '10000000-0000-0000-0000-0000000000d1', auth.uid(), 'East MS', 'Treble Choir',
          'stranger@example.com', 'stranger@example.com', 30,
          (select starts_on from public.events where id = '10000000-0000-0000-0000-0000000000d1'), '09:00');
  assert exists (select 1 from public.bands where id = '40000000-0000-0000-0000-0000000000d3'),
         'a festival with no classifications takes a group with only the short form';
  assert public.group_event_full('10000000-0000-0000-0000-0000000000d1'), 'three of three: the festival is full';
  begin
    insert into public.bands (event_id, director_user_id, school_name, band_name, contact_email, head_director_email, student_count)
    values ('10000000-0000-0000-0000-0000000000d1', auth.uid(), 'North MS', 'Choir', 's@example.com', 's@example.com', 20);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a full festival takes no more groups';
  ok := false;
  begin
    update public.bands set available_day = current_date + 60 where id = '40000000-0000-0000-0000-0000000000d3';
  exception when check_violation then ok := true;
  end;
  assert ok, 'a group can only pick one of the festival''s days';
  ok := false;
  begin
    update public.bands set earliest_start = '11:00', latest_finish = '10:00' where id = '40000000-0000-0000-0000-0000000000d3';
  exception when check_violation then ok := true;
  end;
  assert ok, 'the earliest start comes before the latest finish';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    update public.events set max_groups = 2 where id = '10000000-0000-0000-0000-0000000000d1';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'the group limit can''t drop below the groups already registered';
end $$;
reset role;
do $$
declare ok boolean := false;
begin
  begin
    insert into public.bands (event_id, director_user_id, school_name, band_name, classification, contact_email, head_director_email,
                              student_count)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'X HS', 'Band',
            (select classifications[1] from public.events where id = '10000000-0000-0000-0000-00000000000a'),
            's@example.com', 's@example.com', 20);
  exception when check_violation then ok := true;
  end;
  assert ok, 'a band contest still needs the school address, head director, phone, and chaperones';
end $$;

-- Publishing a festival needs a room; copying last year's festival brings its rooms, not its groups or team.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end,
                           band_registration_deadline, venue_address)
values ('10000000-0000-0000-0000-0000000000d4',
        (select organization_id from public.events where id = '10000000-0000-0000-0000-0000000000d1'),
        'Spring Choir Festival 2', 'spring-choir-2', 'draft', 'group_event', current_date + 40, current_date + 40,
        now() + interval '40 days', now() + interval '40 days 8 hours', current_date + 30, '1 School Rd');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false; res jsonb;
begin
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000d4';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a festival with no rooms can''t be published';
  res := public.copy_group_event_setup('10000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d4');
  assert (res ->> 'rooms')::int = 3, 'copying brings the rooms';
  assert (select count(*) from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d4' and path_order is not null) = 3,
         'in their order';
  assert not exists (select 1 from public.bands where event_id = '10000000-0000-0000-0000-0000000000d4')
     and not exists (select 1 from public.event_staff where event_id = '10000000-0000-0000-0000-0000000000d4')
     and not exists (select 1 from public.group_order where event_id = '10000000-0000-0000-0000-0000000000d4'),
         'but not its groups, team, or order';
  ok := false;
  begin
    perform public.copy_group_event_setup('10000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d4');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a festival that''s set up can''t be copied into';
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000d4';
  assert (select status from public.events where id = '10000000-0000-0000-0000-0000000000d4') = 'published',
         'with rooms and a deadline, it publishes';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.copy_group_event_setup('10000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d4');
    raise exception 'FAIL: a lead copied a festival';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.room_schedule_changes) = 0, 'a lead doesn''t read the change log';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d4';
-- Schedule emails (20270130000000): a send list from each group's own addresses, hosts only, once posted.
update public.events set status = 'published', performance_order_published = false where id = '10000000-0000-0000-0000-0000000000d1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare
  ok boolean := false;
  b  uuid;
begin
  begin
    perform public.queue_room_schedule_emails('10000000-0000-0000-0000-0000000000d1', 'posted',
      array['40000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d2']::uuid[]);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'nobody is emailed their times before the schedule is posted';
end $$;
-- Posting flips the posted flag and queues every director's email in one step.
do $$
declare
  ev  uuid := '10000000-0000-0000-0000-0000000000d1';
  ok  boolean := false;
  res jsonb;
begin
  begin
    perform public.post_room_schedule(ev, -1);
  exception when sqlstate 'FC409' then ok := true;
  end;
  assert ok and not (select performance_order_published from public.events where id = ev),
         'posting from a page that loaded an older version is refused, and nothing is posted';
  res := public.post_room_schedule(ev, (select room_schedule_version from public.events where id = ev));
  assert (res ->> 'posted')::boolean and (select performance_order_published from public.events where id = ev),
         'a host posts the schedule';
  assert (select count(*) from public.room_schedule_emails where batch = (res ->> 'batch')::uuid and kind = 'posted') > 0,
         'and every director''s email is on the send list in the same step';
  assert not (public.post_room_schedule(ev, null) ->> 'posted')::boolean, 'posting twice queues nothing more';
  assert public.retry_room_schedule_emails(ev, null) = 0, 'nothing to send again yet, across every list';
end $$;
reset role;
update public.events set performance_order_published = false where id = '10000000-0000-0000-0000-0000000000d1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.post_room_schedule('10000000-0000-0000-0000-0000000000d1', null);
    raise exception 'FAIL: a lead posted the schedule';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
reset role;
set role anon;
do $$ begin
  begin
    perform public.post_room_schedule('10000000-0000-0000-0000-0000000000d1', null);
    raise exception 'FAIL: the public posted the schedule';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
reset role;
update public.events set performance_order_published = true where id = '10000000-0000-0000-0000-0000000000d1';
set role authenticated;
do $$
declare
  b uuid;
begin
  b := public.queue_room_schedule_emails('10000000-0000-0000-0000-0000000000d1', 'changed',
    array['40000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d2', '40000000-0000-0000-0000-0000000000a1']::uuid[],
    '{"40000000-0000-0000-0000-0000000000d2": "Main Stage 9:10 AM (was 9:00 AM)"}');
  assert b is not null, 'a host queues the emails';
  assert (select count(*) from public.room_schedule_emails where batch = b) = 3,
         'each group''s head director and contact, once each, and only groups at this festival';
  assert (select greet_name from public.room_schedule_emails where batch = b and to_email = 'director@example.com') = 'Dee',
         'greeting the head director by first name';
  assert (select greet_name from public.room_schedule_emails where batch = b and to_email = 'w@example.com') is null,
         'and nobody by a name that isn''t theirs';
  assert (select what_changed from public.room_schedule_emails where batch = b and to_email = 'w@example.com') = 'Main Stage 9:10 AM (was 9:00 AM)',
         'with what changed for that group';
  assert public.retry_room_schedule_emails('10000000-0000-0000-0000-0000000000d1', b) = 0, 'nothing to send again yet';
  begin
    insert into public.room_schedule_emails (event_id, batch, kind, band_id, to_email)
    values ('10000000-0000-0000-0000-0000000000d1', b, 'posted', '40000000-0000-0000-0000-0000000000d1', 'anyone@example.com');
    raise exception 'FAIL: a host wrote the send list directly';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.room_schedule_emails) = 0, 'a lead doesn''t read the send list';
  begin
    perform public.queue_room_schedule_emails('10000000-0000-0000-0000-0000000000d1', 'posted', array['40000000-0000-0000-0000-0000000000d1']::uuid[]);
    raise exception 'FAIL: a lead emailed directors';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select count(*) from public.room_schedule_emails) = 0, 'a director doesn''t read the send list';
  begin
    perform public.retry_room_schedule_emails('10000000-0000-0000-0000-0000000000d1', gen_random_uuid());
    raise exception 'FAIL: a director re-sent schedule emails';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.room_schedule_emails;
    raise exception 'FAIL: the public read the send list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d1';

-- A FieldCommand admin invites a new host; they can then set up one organization.
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  perform public.admin_invite_host(' NewLead@Example.com ');
  assert (select count(*) from public.host_invitations where email = 'newlead@example.com' and used_at is null) = 1,
         'an admin invites a host (email tidied)';
  assert exists (select 1 from public.admin_log where action = 'invite_host'), 'the invitation is logged';
  begin
    perform public.admin_invite_host('not-an-email');
    raise exception 'FAIL: invited a host with a bad email';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
do $$ begin
  assert public.has_host_invitation(), 'the invited person sees their invitation';
  perform public.create_organization('Newlead Boosters', 'newlead-boosters');
  assert not public.has_host_invitation(), 'and it''s used up';
end $$;
reset role;
do $$ begin
  assert (select used_at is not null and organization_id = (select id from public.organizations where slug = 'newlead-boosters')
            from public.host_invitations where email = 'newlead@example.com'),
         'the invitation records the organization it created';
end $$;
delete from public.organizations where slug = 'newlead-boosters';

-- Volunteer records are deleted 10 days after the event (companions too); shift totals stay.
reset role;
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address)
values
  ('10000000-0000-0000-0000-0000000000e1', :'org_id', 'Long Ago Fair', 'long-ago', 'published',
   current_date - 12, current_date - 12, now() - interval '12 days', now() - interval '12 days' + interval '5 hours', '1 Old Rd'),
  ('10000000-0000-0000-0000-0000000000e2', :'org_id', 'Last Week Fair', 'last-week', 'published',
   current_date - 9, current_date - 9, now() - interval '9 days', now() - interval '9 days' + interval '5 hours', '2 Old Rd');
insert into public.stations (id, event_id, name, station_type)
values ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'Tickets', 'passive');
insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity, registered_count)
values ('30000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'Morning',
        now() - interval '12 days', now() - interval '12 days' + interval '2 hours', 5, 2);
insert into public.volunteers (id, event_id, full_name, email, phone)
values ('50000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'Old Volunteer', 'old@example.com', '+15125550101'),
       ('50000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-0000000000e2', 'Recent Volunteer', 'recent@example.com', '+15125550103');
insert into public.volunteers (id, event_id, full_name, email, phone, contact_id)
values ('50000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e1', 'Kid V.', 'old+kid@example.com', '+15125550101',
        '50000000-0000-0000-0000-0000000000e1');
insert into public.volunteer_assignments (shift_id, volunteer_id)
values ('30000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e1'),
       ('30000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e2');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform public.purge_volunteers();
    raise exception 'FAIL: a browser ran the volunteer clean-up';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role service_role;
do $$ begin
  assert public.purge_volunteers() = 2, 'an event over 10 days ago loses its volunteer and their under-18 helper';
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.volunteers where event_id = '10000000-0000-0000-0000-0000000000e1'), 'no names, emails or phones left';
  assert not exists (select 1 from public.volunteer_assignments where shift_id = '30000000-0000-0000-0000-0000000000e1'), 'nor their sign-ups';
  assert (select registered_count from public.shifts where id = '30000000-0000-0000-0000-0000000000e1') = 2, 'the shift total stays';
  assert exists (select 1 from public.volunteers where id = '50000000-0000-0000-0000-0000000000e3'), 'an event 9 days ago keeps its volunteers';
  assert exists (select 1 from public.volunteers where event_id = '10000000-0000-0000-0000-00000000000a'), 'upcoming events keep theirs';
end $$;
delete from public.events where id in ('10000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e2');

-- Admin CRM: the pilot pipeline moves itself along; notes, the email log and
-- sign-ins are for FieldCommand admins only.
reset role;
delete from public.platform_admins;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
insert into public.pilot_requests (id, name, email, organization)
values ('60000000-0000-0000-0000-0000000000c1', 'Pia Pipeline', 'pia@example.com', 'Pipeline HS');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'pia@example.com', '{"full_name":"Pia Pipeline"}');
insert into auth.audit_log_entries (payload, created_at) values
  ('{"actor_id":"00000000-0000-0000-0000-0000000000c1","action":"login"}', now() - interval '1 hour'),
  ('{"actor_id":"00000000-0000-0000-0000-0000000000c1","action":"token_refreshed"}', now()),
  ('{"actor_id":"00000000-0000-0000-0000-000000000001","action":"login"}', now());
insert into public.email_log (to_email, subject, status, created_at) values
  ('pia@example.com', 'Old note to a host', 'sent', now() - interval '20 days'),
  ('volunteer-only@example.com', 'Old volunteer email', 'sent', now() - interval '20 days'),
  ('volunteer-only@example.com', 'Recent volunteer email', 'sent', now() - interval '2 days'),
  ('pia@example.com', 'Ancient', 'failed', now() - interval '200 days');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select count(*) from public.email_log) = 0, 'a host can''t read the email log';
  assert (select count(*) from public.admin_notes) = 0, 'or admin notes';
  begin
    insert into public.admin_notes (organization_id, body, author_id)
    values ((select id from public.organizations limit 1), 'sneaky', auth.uid());
    raise exception 'FAIL: a host wrote an admin note';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.admin_sign_ins();
    raise exception 'FAIL: a host listed everyone''s sign-ins';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.admin_auth_history('00000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL: a host read someone''s sign-in history';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.purge_admin_records();
    raise exception 'FAIL: a browser ran the admin clean-up';
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
do $$ begin
  begin
    perform 1 from public.admin_notes;
    raise exception 'FAIL: anon read admin notes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.email_log;
    raise exception 'FAIL: anon read the email log';
  exception when insufficient_privilege then null;
  end;
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.email_log) = 4, 'an admin reads the email log';
  assert (select count(*) from public.admin_auth_history('00000000-0000-0000-0000-0000000000c1')) = 1,
         'an admin sees one person''s sign-ins, without session refreshes';
  assert exists (select 1 from public.admin_sign_ins() where user_id = '00000000-0000-0000-0000-0000000000c1'),
         'and everyone''s account dates';
  insert into public.admin_notes (pilot_request_id, body, follow_up_on)
  values ('60000000-0000-0000-0000-0000000000c1', 'Call after spring break', current_date + 7);
  assert (select author_id from public.admin_notes where body = 'Call after spring break') = auth.uid(), 'notes are signed by their admin';
  begin
    insert into public.admin_notes (pilot_request_id, body, author_id)
    values ('60000000-0000-0000-0000-0000000000c1', 'Pretending', '00000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: an admin wrote a note in someone else''s name';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.admin_notes (body) values ('About nobody');
    raise exception 'FAIL: a note about nothing';
  exception when check_violation then null;
  end;
  update public.admin_notes set done_at = now(), done_by = auth.uid() where body = 'Call after spring break';
  assert (select done_at is not null from public.admin_notes where body = 'Call after spring break'), 'an admin marks a follow-up done';
  begin
    update public.admin_notes set author_id = '00000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: changed who wrote a note';
  exception when insufficient_privilege then null;
  end;

  update public.pilot_requests set status = 'contacted' where id = '60000000-0000-0000-0000-0000000000c1';
  perform public.admin_invite_host('pia@example.com', '60000000-0000-0000-0000-0000000000c1');
  assert (select status from public.pilot_requests where id = '60000000-0000-0000-0000-0000000000c1') = 'invited',
         'inviting the host moves the request to "invited"';
  begin
    update public.pilot_requests set status = 'accepted' where id = '60000000-0000-0000-0000-0000000000c1';
    raise exception 'FAIL: an unknown stage';
  exception when check_violation then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","email":"pia@example.com"}';
do $$ begin
  perform public.create_organization('Pipeline Boosters', 'pipeline-boosters');
end $$;
reset role;
do $$ begin
  assert (select status = 'set_up' and organization_id = (select id from public.organizations where slug = 'pipeline-boosters')
            from public.pilot_requests where id = '60000000-0000-0000-0000-0000000000c1'),
         'setting up the organization moves the request to "set up" and links it';
  assert (select subscription_status = 'comped' and free_until = date '2027-01-01'
            from public.organizations where slug = 'pipeline-boosters'),
         'an invited host''s new account starts on the free pilot, through the pilot''s end';
end $$;
insert into public.events (id, organization_id, name, slug, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000c1', (select id from public.organizations where slug = 'pipeline-boosters'),
        'Pipeline Contest', 'pipeline-contest', current_date + 30, current_date + 30, now() + interval '30 days',
        now() + interval '30 days 5 hours', '1 Pipe Rd');
update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c1';
do $$ begin
  assert (select status from public.pilot_requests where id = '60000000-0000-0000-0000-0000000000c1') = 'active',
         'publishing their first event makes the pilot "active"';
end $$;
set role service_role;
do $$ begin
  assert public.purge_admin_records() = 2, 'old emails to people without an account, and anything past 180 days, are removed';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.email_log where subject = 'Old note to a host'), 'a host''s 20-day-old email stays';
  assert exists (select 1 from public.email_log where subject = 'Recent volunteer email'), 'a recent volunteer email stays';
end $$;
delete from public.organizations where slug = 'pipeline-boosters';
delete from public.pilot_requests where id = '60000000-0000-0000-0000-0000000000c1';
delete from public.email_log;
delete from public.platform_admins;

-- Admin email templates: FieldCommand admins only.
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  insert into public.email_templates (name, subject, body) values ('Welcome', 'Welcome, {{first_name}}', 'Hi {{first_name}}!');
  assert (select created_by from public.email_templates where name = 'Welcome') = auth.uid(), 'templates are signed by their admin';
  update public.email_templates set body = 'Hello {{first_name}}!', updated_at = now() where name = 'Welcome';
  assert (select body from public.email_templates where name = 'Welcome') = 'Hello {{first_name}}!', 'an admin edits a template';
  begin
    insert into public.email_templates (name, subject, body, created_by) values ('Fake', 'x', 'y', '00000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a template in someone else''s name';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select count(*) from public.email_templates) = 0, 'a host can''t read email templates';
  begin
    insert into public.email_templates (name, subject, body, created_by) values ('Mine', 'x', 'y', auth.uid());
    raise exception 'FAIL: a host saved an email template';
  exception when insufficient_privilege then null;
  end;
  update public.email_templates set body = 'hacked';
  delete from public.email_templates;
end $$;
set role anon;
do $$ begin
  begin
    perform 1 from public.email_templates;
    raise exception 'FAIL: anon read email templates';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select body from public.email_templates where name = 'Welcome') = 'Hello {{first_name}}!', 'a host can''t change or delete templates';
end $$;
delete from public.email_templates;
delete from public.platform_admins;

-- The database's messages use the company name, and the rules behind them are unchanged.
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare msg text;
begin
  begin
    perform public.create_organization('Name Check Boosters', 'name-check-boosters');
    raise exception 'FAIL: created an organization without an invitation';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
  end;
  assert msg like '%Field Command Events%', 'the invitation message says Field Command Events';
  begin
    perform * from public.admin_sign_ins();
    raise exception 'FAIL: a non-admin listed sign-ins';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Company banners: admins write them; signed-in people read live ones;
-- visitors only live public ones; people close their own (not urgent ones).
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  insert into public.site_banners (title, audience, host_filter) values ('Hosts: new feature', 'hosts', 'pilot');
  insert into public.site_banners (title, audience) values ('Pilot spots filling up', 'public');
  insert into public.site_banners (title, audience, tone) values ('Outage tonight', 'hosts', 'urgent');
  insert into public.site_banners (title, audience, starts_at) values ('Next month', 'hosts', now() + interval '30 days');
  -- Aimed at free teacher accounts, or at everyone but them.
  insert into public.site_banners (title, audience, host_filter, starts_at) values ('Teachers only', 'hosts', 'teacher', now() + interval '30 days');
  insert into public.site_banners (title, audience, host_filter, starts_at) values ('Schools only', 'hosts', 'schools', now() + interval '30 days');
  begin
    insert into public.site_banners (title, audience, host_filter) values ('Bad filter', 'hosts', 'everyone');
    raise exception 'FAIL: a banner with an unknown host filter';
  exception when check_violation then null;
  end;
  assert (select created_by from public.site_banners where title = 'Outage tonight') = auth.uid(), 'banners are signed by their admin';
  begin
    insert into public.site_banners (title, audience, created_by) values ('Fake', 'public', '00000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a banner in someone else''s name';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.site_banners (title, audience, link_url) values ('Bad link', 'public', 'javascript:alert(1)');
    raise exception 'FAIL: a banner with a javascript: link';
  exception when check_violation then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select count(*) from public.site_banners) = 3, 'a signed-in person reads the live banners, not scheduled ones';
  begin
    insert into public.site_banners (title, audience, created_by) values ('Mine', 'public', auth.uid());
    raise exception 'FAIL: a host posted a company banner';
  exception when insufficient_privilege then null;
  end;
  update public.site_banners set title = 'hacked';
  delete from public.site_banners;
  insert into public.site_banner_dismissals (banner_id) select id from public.site_banners where title = 'Hosts: new feature';
  assert (select count(*) from public.site_banner_dismissals) = 1, 'a host closes a banner for themselves';
  begin
    insert into public.site_banner_dismissals (banner_id) select id from public.site_banners where title = 'Outage tonight';
    raise exception 'FAIL: closed an urgent banner';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.site_banner_dismissals (banner_id, user_id)
    select id, '00000000-0000-0000-0000-000000000002' from public.site_banners where title = 'Pilot spots filling up';
    raise exception 'FAIL: closed a banner for someone else';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select count(*) from public.site_banner_dismissals) = 0, 'people only see their own dismissals';
end $$;
set role anon;
do $$ begin
  assert (select count(*) from public.site_banners) = 1, 'visitors only see live public banners';
  assert (select title from public.site_banners) = 'Pilot spots filling up', 'the public one';
  begin
    insert into public.site_banner_dismissals (banner_id) select id from public.site_banners;
    raise exception 'FAIL: anon wrote a dismissal';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.site_banners where title = 'hacked') = 0 and (select count(*) from public.site_banners) = 6,
         'a host can''t change or delete banners';
end $$;
delete from public.site_banners;
delete from public.platform_admins;

-- Event banners: hosts and Volunteer Leads post; they can end them early
-- (Volunteer Leads only their own kind); nothing else about a sent one changes.
reset role;
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'volunteer_director'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'section_lead')
on conflict do nothing;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  insert into public.announcements (event_id, sender_id, audiences, priority, body, ends_at)
  values ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{public,band_directors}', 'schedule', 'Band switch: Lakeview now at 2:15', now() + interval '2 hours');
  update public.announcements set ends_at = now() where body = 'Band switch: Lakeview now at 2:15';
  assert (select ends_at <= now() from public.announcements where body = 'Band switch: Lakeview now at 2:15'), 'a host ends a banner early';
  begin
    update public.announcements set body = 'changed' where body = 'Band switch: Lakeview now at 2:15';
    raise exception 'FAIL: changed what a sent banner says';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  insert into public.announcements (event_id, sender_id, audiences, priority, body)
  values ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{volunteers,section_leads}', 'routine', 'Lunch is in the cafeteria');
  update public.announcements set ends_at = now() where body = 'Lunch is in the cafeteria';
  assert (select ends_at is not null from public.announcements where body = 'Lunch is in the cafeteria'), 'a Volunteer Lead ends their banner';
  update public.announcements set ends_at = now() + interval '1 day' where body = 'Band switch: Lakeview now at 2:15';
  begin
    insert into public.announcements (event_id, sender_id, audiences, priority, body)
    values ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{public}', 'routine', 'To everyone');
    raise exception 'FAIL: a Volunteer Lead posted to the public';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    insert into public.announcements (event_id, sender_id, audiences, priority, body)
    values ('10000000-0000-0000-0000-00000000000a', auth.uid(), '{volunteers}', 'routine', 'From a Section Lead');
    raise exception 'FAIL: a Section Lead posted a banner';
  exception when insufficient_privilege then null;
  end;
  update public.announcements set ends_at = now();
end $$;
reset role;
do $$ begin
  assert (select ends_at <= now() from public.announcements where body = 'Band switch: Lakeview now at 2:15'),
         'a Volunteer Lead can''t change the end of a host''s public banner';
  assert (select count(*) from public.announcements where body = 'Lunch is in the cafeteria' and ends_at is not null) = 1,
         'a Section Lead can''t end banners (the Volunteer Lead had already ended this one)';
end $$;
set role anon;
do $$ begin
  assert (select count(*) from public.announcements where body = 'Band switch: Lakeview now at 2:15') = 1, 'visitors read public banners';
  assert (select count(*) from public.announcements where body = 'Lunch is in the cafeteria') = 0, 'but not the team''s';
end $$;
reset role;
delete from public.announcements where event_id = '10000000-0000-0000-0000-00000000000a' and body in ('Band switch: Lakeview now at 2:15', 'Lunch is in the cafeteria');

-- School fairs: booths belong to fairs only; the host and Volunteer Leads
-- manage them; the event team checks partners in; the public list has no
-- contact details and only listed booths of published fairs.
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000f1', :'org_id', 'Cardinal Renaissance Fair', 'ren-fair', 'draft', 'fair',
        current_date + 10, current_date + 10, now() + interval '10 days', now() + interval '10 days 3 hours', '1 Cardinal Way');
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', 'section_lead');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  insert into public.fair_booths (event_id, title, host_name, zone, contact_email)
  values ('10000000-0000-0000-0000-0000000000f1', 'Dunk Tank', 'Brightwater Wireless', 'Activity Stations', 'events@brightwater.example');
  insert into public.fair_booths (event_id, title, zone, show_publicly)
  values ('10000000-0000-0000-0000-0000000000f1', 'Supply closet', 'Back of house', false);
  begin
    insert into public.fair_booths (event_id, title) values ('10000000-0000-0000-0000-00000000000a', 'Not a fair');
    raise exception 'FAIL: a booth on a band contest';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update public.fair_booths set arrived_at = now() where title = 'Dunk Tank';
    raise exception 'FAIL: set arrival directly instead of through check-in';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.fair_booths where event_id = '10000000-0000-0000-0000-0000000000f1') = 2, 'a Station Coordinator sees the booths';
  perform public.fair_booth_checkin((select id from public.fair_booths where title = 'Dunk Tank'), true);
  assert (select arrived_at is not null and arrived_by = auth.uid() from public.fair_booths where title = 'Dunk Tank'), 'and checks a partner in';
  begin
    insert into public.fair_booths (event_id, title) values ('10000000-0000-0000-0000-0000000000f1', 'Sneaky booth');
    raise exception 'FAIL: a Station Coordinator added a booth';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.fair_booths) = 0, 'strangers can''t read booths (or partner contacts)';
  begin
    perform public.fair_booth_checkin((select id from public.fair_booths limit 1), false);
    raise exception 'FAIL: a stranger checked a partner in';
  exception when sqlstate 'P0001' or insufficient_privilege then null;
  end;
end $$;
set role anon;
do $$ begin
  assert (select count(*) from public.public_fair_booths('ren-fair')) = 0, 'a draft fair lists nothing';
  begin
    perform 1 from public.fair_booths;
    raise exception 'FAIL: anon read the booths table';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000f1';
set role anon;
do $$ begin
  assert (select count(*) from public.public_fair_booths('ren-fair')) = 1, 'the public sees listed booths only';
  assert (select host_name from public.public_fair_booths('ren-fair')) = 'Brightwater Wireless', 'with who hosts them';
end $$;
reset role;
do $$ begin
  begin
    update public.events set event_type = 'volunteer' where id = '10000000-0000-0000-0000-0000000000f1';
    raise exception 'FAIL: a fair with booths changed type';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
-- Fair zones: the host (and Volunteer Leads) create, rename and delete them,
-- carrying booths along; Station Coordinators only read; strangers see none.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  insert into public.fair_zones (event_id, name) values
    ('10000000-0000-0000-0000-0000000000f1', 'Activity Stations'),
    ('10000000-0000-0000-0000-0000000000f1', 'Game Zone');
  begin
    insert into public.fair_zones (event_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Not a fair');
    raise exception 'FAIL: a zone on a band contest';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.rename_fair_zone('10000000-0000-0000-0000-0000000000f1', 'Activity Stations', 'Activities');
  assert (select zone from public.fair_booths where title = 'Dunk Tank') = 'Activities', 'renaming a zone moves its booths';
  assert exists (select 1 from public.fair_zones where event_id = '10000000-0000-0000-0000-0000000000f1' and name = 'Activities'), 'and renames the zone';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.fair_zones where event_id = '10000000-0000-0000-0000-0000000000f1') = 2, 'a Station Coordinator sees the zones';
  begin
    insert into public.fair_zones (event_id, name) values ('10000000-0000-0000-0000-0000000000f1', 'Sneaky zone');
    raise exception 'FAIL: a Station Coordinator added a zone';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rename_fair_zone('10000000-0000-0000-0000-0000000000f1', 'Game Zone', 'Mine');
    raise exception 'FAIL: a Station Coordinator renamed a zone';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_fair_zone('10000000-0000-0000-0000-0000000000f1', 'Activities');
    raise exception 'FAIL: a Station Coordinator deleted a zone';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.fair_zones) = 0, 'strangers can''t read zones';
  begin
    perform public.delete_fair_zone('10000000-0000-0000-0000-0000000000f1', 'Activities');
    raise exception 'FAIL: a stranger deleted a zone';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  perform public.delete_fair_zone('10000000-0000-0000-0000-0000000000f1', 'Activities');
  assert (select zone is null from public.fair_booths where title = 'Dunk Tank'), 'deleting a zone leaves its booths with no zone';
  assert not exists (select 1 from public.fair_zones where name = 'Activities'), 'and removes the zone';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000f1';

-- ---------------------------------------------------------------------------
-- Demo sample data: filled in by the server only, and taken back off with the
-- demo people
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform public.demo_seed('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', null);
    raise exception 'FAIL: a browser filled an event with sample data';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.demo_samples;
    raise exception 'FAIL: a browser read the sample-data list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address, event_type)
select ('10000000-0000-0000-0000-0000000000d' || n)::uuid, e.organization_id, 'Demo ' || t, 'demo-sample-' || n, 'draft',
       current_date + 20, current_date + 20, now() + interval '20 days', now() + interval '20 days 6 hours', '1 Main St',
       t::public.event_type
  from public.events e,
       (values (1, 'band_contest'), (2, 'group_event'), (3, 'school_visit'), (4, 'fair'), (5, 'volunteer')) v(n, t)
 where e.id = '10000000-0000-0000-0000-00000000000a';

set role service_role;
do $$
declare
  owner constant uuid := '00000000-0000-0000-0000-000000000001';
  director constant uuid := 'd0000000-0000-0000-0000-000000000003';
  ev uuid;
  n int;
begin
  begin
    perform public.demo_seed(owner, '10000000-0000-0000-0000-0000000000d1', director);
    raise exception 'FAIL: sample data without demo mode on';
  exception when sqlstate 'P0001' then null;
  end;

  for n in 1..5 loop
    ev := ('10000000-0000-0000-0000-0000000000d' || n)::uuid;
    insert into public.demo_events (owner_id, event_id) values (owner, ev);
    perform public.demo_seed(owner, ev, director);
    perform public.demo_seed(owner, ev, director);  -- a second switch adds nothing
    assert (select count(*) from public.stations where event_id = ev) = 3, 'three sample stations';
    assert (select count(*) from public.volunteers where event_id = ev) = 14, 'a dozen volunteers plus two students';
    assert (select count(*) from public.volunteers where event_id = ev and minor and contact_id is not null) = 2,
           'the students are signed up by a parent';
    assert (select sum(registered_count) from public.shifts where event_id = ev)
         = (select count(*) from public.volunteer_assignments va join public.shifts s on s.id = va.shift_id where s.event_id = ev),
           'every sign-up is counted';
  end loop;

  assert (select count(*) from public.bands where event_id = '10000000-0000-0000-0000-0000000000d1') = 6, 'a band contest gets bands';
  assert (select count(*) from public.bands where event_id = '10000000-0000-0000-0000-0000000000d2') = 5, 'a group event gets groups';
  assert (select count(*) from public.rooms where event_id = '10000000-0000-0000-0000-0000000000d2') = 3, 'and rooms';
  assert (select count(*) from public.parent_registrations where event_id = '10000000-0000-0000-0000-0000000000d3') = 8,
         'a school visit gets parents';
  assert (select count(*) from public.fair_booths where event_id = '10000000-0000-0000-0000-0000000000d4') = 8, 'a fair gets booths';
  assert (select count(*) from public.fair_booths where event_id = '10000000-0000-0000-0000-0000000000d4' and host_name = 'Brightwater Wireless') = 1,
         'sample booths name made-up businesses only';
  assert not exists (select 1 from public.bands where event_id = '10000000-0000-0000-0000-0000000000d5'), 'a volunteer event gets no bands';
  assert not exists (
    select email from public.volunteers where email is not null and email not like '%@demo.fieldcommandevents.com'
       and event_id::text like '10000000-0000-0000-0000-0000000000d%'
    union all
    select email from public.parent_registrations where email not like '%@demo.fieldcommandevents.com'
       and event_id = '10000000-0000-0000-0000-0000000000d3'
  ), 'sample people are never emailed';

  -- The demo volunteer signs up for a sample job's shift, and leaving still clears it all.
  perform public.demo_join(owner, '10000000-0000-0000-0000-0000000000d5', 'd0000000-0000-0000-0000-000000000004');
  assert exists (select 1 from public.volunteers where email = 'vol-1@demo.fieldcommandevents.com'
                    and event_id = '10000000-0000-0000-0000-0000000000d5'), 'the demo volunteer joins a sample job';
  for n in 1..5 loop
    ev := ('10000000-0000-0000-0000-0000000000d' || n)::uuid;
    perform public.demo_leave(owner, ev);
    assert not exists (select 1 from public.stations where event_id = ev), 'sample stations are gone';
    assert not exists (select 1 from public.volunteers where event_id = ev), 'sample volunteers are gone';
    assert not exists (select 1 from public.bands where event_id = ev), 'sample bands are gone';
    assert not exists (select 1 from public.rooms where event_id = ev), 'sample rooms are gone';
    assert not exists (select 1 from public.parent_registrations where event_id = ev), 'sample parents are gone';
    assert not exists (select 1 from public.fair_booths where event_id = ev), 'sample booths are gone';
    assert not exists (select 1 from public.demo_samples where event_id = ev), 'nothing left on the list';
  end loop;
  assert not exists (select 1 from public.volunteers where email = 'vol-1@demo.fieldcommandevents.com'), 'the demo volunteer is gone too';
end $$;
reset role;
delete from public.events where id::text like '10000000-0000-0000-0000-0000000000d%';

-- Demo sample data for a conference: sample families booked into most of its
-- times (setting up sample times if it has none), never emailed, and gone
-- again with the demo people.
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
select '10000000-0000-0000-0000-0000000000d6', e.organization_id, 'Demo Conferences', 'demo-sample-6', 'draft', 'conference', 'America/Chicago',
       current_date + 20, current_date + 20,
       ((current_date + 20) + time '15:00') at time zone 'America/Chicago',
       ((current_date + 20) + time '17:00') at time zone 'America/Chicago', ''
  from public.events e where e.id = '10000000-0000-0000-0000-00000000000a';
insert into public.demo_events (owner_id, event_id) values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000d6');
set role service_role;
do $$
declare
  owner constant uuid := '00000000-0000-0000-0000-000000000001';
  ev    constant uuid := '10000000-0000-0000-0000-0000000000d6';
begin
  perform public.demo_seed(owner, ev, null);
  perform public.demo_seed(owner, ev, null);  -- a second switch adds nothing
  assert (select times_saved_at is not null from public.conference_settings where event_id = ev), 'sample meeting times are set up';
  assert (select count(*) from public.conference_bookings where event_id = ev) = 6,
         'two of every three 15-minute times are booked (6 of 8)';
  assert not exists (select 1 from public.stations where event_id = ev), 'a conference gets no stations';
  assert not exists (select 1 from public.volunteers where event_id = ev), 'or volunteers';
  assert not exists (select 1 from public.conference_bookings b, jsonb_array_elements(b.parents) p
                      where b.event_id = ev and p ->> 'email' not like '%@demo.fieldcommandevents.com'),
         'sample families are never emailed';
  assert (select count(*) from public.conference_open_times('demo-sample-6')) = 0, 'a draft still lists no times';
  perform public.demo_leave(owner, ev);
  assert not exists (select 1 from public.conference_bookings where event_id = ev), 'sample bookings are gone';
  assert not exists (select 1 from public.conference_settings where event_id = ev), 'and the sample meeting times';
  assert not exists (select 1 from public.demo_samples where event_id = ev), 'nothing left on the list';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d6';

-- Pilot requests: only known event types can be saved.
do $$ begin
  begin
    insert into public.pilot_requests (name, email, organization, event_types)
    values ('Odd Type', 'odd@example.com', 'Odd PTO', array['rodeo']);
    raise exception 'FAIL: saved an unknown event type on a pilot request';
  exception when check_violation then null;
  end;
  insert into public.pilot_requests (name, email, organization, event_types)
  values ('Fair Host', 'fairhost@example.com', 'Oak PTO', array['fair', 'volunteer']);
  delete from public.pilot_requests where email = 'fairhost@example.com';
  -- Teachers ask for parent-teacher conferences through the same form.
  insert into public.pilot_requests (name, email, organization, event_types)
  values ('Tess Teacher', 'tess@example.com', 'Oak Elementary', array['conference']);
  delete from public.pilot_requests where email = 'tess@example.com';
end $$;

-- Volunteer reminders: only the server marks a shift as reminded.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    update public.volunteer_assignments set reminded_at = now();
    raise exception 'FAIL: a browser marked volunteer shifts as reminded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Data retention (privacy policy): closing accounts, old pilot requests,
-- directors' details after 2 years, booth contacts after 15 months, files
-- after 30 days. Only FieldCommand admins close accounts; only the server
-- runs the clean-ups.
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f8', 'closehost@example.com', '{"full_name":"Cleo Closing"}'),
  ('00000000-0000-0000-0000-0000000000f9', 'closeteam@example.com', '{"full_name":"Tad Team"}');
insert into public.organizations (id, name, slug)
values ('60000000-0000-0000-0000-000000000001', 'Closing Boosters', 'closing-boosters');
insert into public.organization_members (organization_id, user_id, role)
values ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f8', 'owner');
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000a9', '60000000-0000-0000-0000-000000000001', 'Closing Contest', 'closing-contest',
        'published', current_date + 20, current_date + 20, now() + interval '20 days', now() + interval '20 days 6 hours', '9 Close Rd');
-- Their team member also directs a band at another organization's contest, so keeps their account.
insert into public.event_staff (event_id, user_id, role)
values ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000f9', 'section_lead');
insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone, student_count, chaperone_count)
values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f9', 'Team HS', 'Team Band', '4A', 'addr',
        'closeteam@example.com', 'Tad Team', 'closeteam@example.com', '+15125550109', 40, 5);
insert into public.pilot_requests (name, email, organization, organization_id)
values ('Cleo Closing', 'closehost@example.com', 'Closing Boosters', '60000000-0000-0000-0000-000000000001');
insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences)
values ('10000000-0000-0000-0000-0000000000a9', 'Parking', '10000000-0000-0000-0000-0000000000a9/parking.pdf', 'parking.pdf',
        'application/pdf', 100, array['public']);
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform public.admin_close_account('60000000-0000-0000-0000-000000000001', null);
    raise exception 'FAIL: a host closed an account';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.purge_closed_accounts();
    raise exception 'FAIL: a browser ran the closed-account clean-up';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.user_deletion_queue;
    raise exception 'FAIL: a browser read the account deletion queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.purge_band_directors();
    raise exception 'FAIL: a browser ran the directors'' details clean-up';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.expired_event_files();
    raise exception 'FAIL: a browser listed expired files';
  exception when insufficient_privilege then null;
  end;
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.admin_close_account('60000000-0000-0000-0000-000000000001', 'Moving to another tool');
reset role;
do $$ begin
  assert (select closed_at is not null from public.organizations where id = '60000000-0000-0000-0000-000000000001'), 'an admin closes the account';
  assert (select status from public.events where id = '10000000-0000-0000-0000-0000000000a9') = 'draft',
         'closing an account takes its published events offline';
  assert (select (details->>'unpublished')::int from public.admin_log
           where organization_id = '60000000-0000-0000-0000-000000000001' and action = 'account_closed') = 1,
         'the log says how many events went offline';
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000a9';
    raise exception 'FAIL: a closed account published an event';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;
do $$ begin
  begin
    perform public.admin_close_account('60000000-0000-0000-0000-000000000001', null);
    raise exception 'FAIL: closed an account twice';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
select public.admin_reopen_account('60000000-0000-0000-0000-000000000001', 'Changed their mind');
reset role;
do $$ begin
  assert (select closed_at is null from public.organizations where id = '60000000-0000-0000-0000-000000000001'), 'and can reopen it';
end $$;
set role authenticated;
select public.admin_close_account('60000000-0000-0000-0000-000000000001', null);
reset role;
do $$ begin
  assert (select count(*) from public.admin_log where organization_id = '60000000-0000-0000-0000-000000000001'
            and action in ('account_closed', 'account_reopened')) = 3, 'closing and reopening are logged';
end $$;

set role service_role;
do $$ begin
  assert public.purge_closed_accounts() = 0, 'a just-closed account stays for 90 days';
end $$;
reset role;
update public.organizations set closed_at = now() - interval '91 days' where id = '60000000-0000-0000-0000-000000000001';
set role service_role;
do $$ begin
  assert exists (select 1 from public.expired_event_files() where path = '10000000-0000-0000-0000-0000000000a9/parking.pdf'),
         'its files are handed to the server to remove from storage first';
  assert public.purge_closed_accounts() = 1, '90 days after closing, the account goes';
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.organizations where id = '60000000-0000-0000-0000-000000000001'), 'no organization left';
  assert not exists (select 1 from public.events where id = '10000000-0000-0000-0000-0000000000a9'), 'nor its events';
  assert not exists (select 1 from public.pilot_requests where email = 'closehost@example.com'), 'nor its pilot request';
  assert exists (select 1 from public.user_deletion_queue where user_id = '00000000-0000-0000-0000-0000000000f8'),
         'its host, with no other role, is queued for account deletion';
  assert not exists (select 1 from public.user_deletion_queue where user_id = '00000000-0000-0000-0000-0000000000f9'),
         'a team member who directs a band elsewhere keeps their account';
end $$;
set role service_role;
do $$ begin
  assert (select array_agg(u) from public.user_deletions_due() u) = array['00000000-0000-0000-0000-0000000000f8'::uuid],
         'the server is handed the host to delete';
end $$;
reset role;
-- Someone who picks up a role before the server gets to them leaves the queue.
insert into public.organizations (id, name, slug) values ('60000000-0000-0000-0000-000000000002', 'New Start PTO', 'new-start');
insert into public.organization_members (organization_id, user_id, role)
values ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f8', 'owner');
set role service_role;
do $$ begin
  assert not exists (select 1 from public.user_deletions_due()), 'a host who started again isn''t deleted';
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.user_deletion_queue), 'and is out of the queue';
end $$;
delete from public.organizations where id = '60000000-0000-0000-0000-000000000002';

-- Pilot requests that never became an account go after a year.
insert into public.pilot_requests (name, email, organization, created_at) values
  ('Old Lead', 'oldlead@example.com', 'Old PTO', now() - interval '13 months'),
  ('New Lead', 'newlead2@example.com', 'New PTO', now() - interval '11 months');
insert into public.pilot_requests (name, email, organization, organization_id, created_at)
values ('Old Customer', 'oldcustomer@example.com', 'Customer Boosters', :'org_id', now() - interval '13 months');
set role service_role;
do $$ begin
  assert public.purge_pilot_requests() = 1, 'a request over a year old with no account is deleted';
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.pilot_requests where email = 'oldlead@example.com'), 'the old lead is gone';
  assert exists (select 1 from public.pilot_requests where email = 'newlead2@example.com'), 'a newer one stays';
  assert exists (select 1 from public.pilot_requests where email = 'oldcustomer@example.com'), 'one that became an account stays';
end $$;
delete from public.pilot_requests where email in ('newlead2@example.com', 'oldcustomer@example.com');

-- Directors' details are removed 2 years after the event; the band's name and headcounts stay.
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000b8', :'org_id', 'Ancient Contest', 'ancient-contest', 'published',
        current_date - interval '2 years 5 days', current_date - interval '2 years 5 days',
        now() - interval '2 years 5 days', now() - interval '2 years 5 days' + interval '6 hours', '1 Past Ln'),
       ('10000000-0000-0000-0000-0000000000b9', :'org_id', 'Recent Contest', 'recent-contest', 'published',
        current_date - interval '2 years' + interval '5 days', current_date - interval '2 years' + interval '5 days',
        now() - interval '2 years' + interval '5 days', now() - interval '2 years' + interval '5 days 6 hours', '2 Past Ln');
insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          assistant_directors, student_count, chaperone_count, special_needs)
values ('40000000-0000-0000-0000-0000000000b8', '10000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-000000000005',
        'Old HS', 'Old Band', '5A', '1 Old School Rd', 'band@example.com', 'Bo Band', 'band@example.com', '+15125550105',
        array['Ann Assistant'], 90, 10, 'Ramp for a wheelchair'),
       ('40000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-000000000005',
        'Old HS', 'Newer Band', '5A', '1 Old School Rd', 'band@example.com', 'Bo Band', 'band@example.com', '+15125550105',
        '{}', 80, 10, null);
insert into public.band_invitations (event_id, email) values ('10000000-0000-0000-0000-0000000000b8', 'band@example.com');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert exists (select 1 from public.past_band_directors('10000000-0000-0000-0000-00000000000a') d where 'Old Band (Old HS)' = any (d.bands)),
         'before the clean-up, the host can invite the old band''s director back';
end $$;
reset role;
set role service_role;
do $$ begin
  assert public.purge_band_directors() = 1, 'one registration over 2 years old loses its director''s details';
  assert public.purge_band_directors() = 0, 'and only once';
end $$;
reset role;
do $$ begin
  assert (select head_director_name = '' and head_director_email = '' and head_director_phone = '' and contact_email = ''
             and school_address = '' and assistant_directors = '{}' and special_needs is null and details_removed_at is not null
            from public.bands where id = '40000000-0000-0000-0000-0000000000b8'), 'no names, emails, phones, address or notes left';
  assert (select band_name = 'Old Band' and school_name = 'Old HS' and student_count = 90
            from public.bands where id = '40000000-0000-0000-0000-0000000000b8'), 'the band, school and headcount stay';
  assert (select head_director_email = 'band@example.com' from public.bands where id = '40000000-0000-0000-0000-0000000000b9'),
         'a registration under 2 years old keeps its details';
  assert not exists (select 1 from public.band_invitations where event_id = '10000000-0000-0000-0000-0000000000b8'),
         'the old event''s invitations are gone';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert not exists (select 1 from public.past_band_directors('10000000-0000-0000-0000-00000000000a') d where 'Old Band (Old HS)' = any (d.bands)),
         'after it, the old registration no longer offers its director to invite';
end $$;
reset role;
delete from public.events where id in ('10000000-0000-0000-0000-0000000000b8', '10000000-0000-0000-0000-0000000000b9');

-- Fair booth contacts are removed 15 months after the fair.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000c8', :'org_id', 'Old Fair', 'old-fair', 'published', 'fair',
        current_date - interval '16 months', current_date - interval '16 months',
        now() - interval '16 months', now() - interval '16 months' + interval '4 hours', '1 Fair Rd'),
       ('10000000-0000-0000-0000-0000000000c9', :'org_id', 'Last Year Fair', 'last-year-fair', 'published', 'fair',
        current_date - interval '14 months', current_date - interval '14 months',
        now() - interval '14 months', now() - interval '14 months' + interval '4 hours', '2 Fair Rd');
insert into public.fair_booths (event_id, title, contact_name, contact_email, contact_phone) values
  ('10000000-0000-0000-0000-0000000000c8', 'Old Dunk Tank', 'Pat Partner', 'pat@partner.example', '+15125550110'),
  ('10000000-0000-0000-0000-0000000000c9', 'New Dunk Tank', 'Pat Partner', 'pat@partner.example', '+15125550110');
set role service_role;
do $$ begin
  assert public.purge_booth_contacts() = 1, 'a booth at a fair over 15 months ago loses its contact';
end $$;
reset role;
do $$ begin
  assert (select contact_name is null and contact_email is null and contact_phone is null and title = 'Old Dunk Tank'
            from public.fair_booths where event_id = '10000000-0000-0000-0000-0000000000c8'), 'the booth stays, without its contact';
  assert (select contact_email = 'pat@partner.example' from public.fair_booths where event_id = '10000000-0000-0000-0000-0000000000c9'),
         'a fair 14 months ago keeps its contacts';
end $$;
delete from public.events where id in ('10000000-0000-0000-0000-0000000000c8', '10000000-0000-0000-0000-0000000000c9');

-- Uploaded files are listed for removal 30 days after the event.
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000d8', :'org_id', 'Old Files Contest', 'old-files', 'published',
        current_date - 35, current_date - 35, now() - interval '35 days', now() - interval '35 days' + interval '6 hours', '1 File Rd'),
       ('10000000-0000-0000-0000-0000000000d9', :'org_id', 'Recent Files Contest', 'recent-files', 'published',
        current_date - 25, current_date - 25, now() - interval '25 days', now() - interval '25 days' + interval '6 hours', '2 File Rd');
insert into public.event_files (event_id, label, path, file_name, content_type, size_bytes, audiences) values
  ('10000000-0000-0000-0000-0000000000d8', 'Old map', '10000000-0000-0000-0000-0000000000d8/map.pdf', 'map.pdf', 'application/pdf', 100, array['public']),
  ('10000000-0000-0000-0000-0000000000d9', 'New map', '10000000-0000-0000-0000-0000000000d9/map.pdf', 'map.pdf', 'application/pdf', 100, array['public']);
set role service_role;
do $$ begin
  assert (select array_agg(path) from public.expired_event_files()) = array['10000000-0000-0000-0000-0000000000d8/map.pdf'],
         'only the file of the event over 30 days ago is due for removal';
end $$;
reset role;
delete from public.events where id in ('10000000-0000-0000-0000-0000000000d8', '10000000-0000-0000-0000-0000000000d9');
delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';

-- Deleting an event (Edit details → Delete this event): only its hosts can,
-- and everything attached to it goes too (stations, shifts, volunteers, team).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end,
                           venue_address, volunteer_signup_open)
values ('10000000-0000-0000-0000-0000000000e9', :'org_id', 'Delete Me Fair', 'delete-me', 'published',
        current_date + 20, current_date + 20, now() + interval '20 days', now() + interval '20 days 4 hours',
        '9 Gone Rd', true);
insert into public.stations (id, event_id, name, station_type) values
  ('20000000-0000-0000-0000-0000000000e9', '10000000-0000-0000-0000-0000000000e9', 'Snacks', 'passive');
insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
  ('30000000-0000-0000-0000-0000000000e9', '20000000-0000-0000-0000-0000000000e9', 'Snack Shift',
   now() + interval '20 days', now() + interval '20 days 2 hours', 3);
reset role;
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000003', 'section_lead');
set role service_role;
select public.register_volunteer('10000000-0000-0000-0000-0000000000e9', 'Del Volunteer', 'del@example.com', '+15125550188',
       array['30000000-0000-0000-0000-0000000000e9']::uuid[]);
reset role;

-- A Section Lead and a stranger can't delete it (the row just isn't theirs to delete).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
delete from public.events where id = '10000000-0000-0000-0000-0000000000e9';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
delete from public.events where id = '10000000-0000-0000-0000-0000000000e9';
reset role;
do $$ begin
  assert exists (select 1 from public.events where id = '10000000-0000-0000-0000-0000000000e9'),
         'only a host can delete an event';
end $$;

-- The host can, and its volunteers, shifts, stations and team go with it.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
delete from public.events where id = '10000000-0000-0000-0000-0000000000e9';
reset role;
do $$ begin
  assert not exists (select 1 from public.events where id = '10000000-0000-0000-0000-0000000000e9'), 'the host deleted the event';
  assert not exists (select 1 from public.volunteers where email = 'del@example.com'), 'its volunteers are deleted';
  assert not exists (select 1 from public.shifts where id = '30000000-0000-0000-0000-0000000000e9'), 'its shifts are deleted';
  assert not exists (select 1 from public.stations where id = '20000000-0000-0000-0000-0000000000e9'), 'its stations are deleted';
  assert not exists (select 1 from public.event_staff where event_id = '10000000-0000-0000-0000-0000000000e9'), 'its team is removed';
end $$;

-- Spreadsheet imports. Bands: the host saves directors' details (band_prefills);
-- only the director with that email sees them, nobody is registered.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end,
                           venue_address, volunteer_signup_open)
values ('10000000-0000-0000-0000-0000000000f1', :'org_id', 'Import Contest', 'import-contest', 'draft', 'band_contest',
        current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 8 hours', '1 Sheet Rd', false),
       ('10000000-0000-0000-0000-0000000000f2', :'org_id', 'Import Lunch', 'import-lunch', 'draft', 'school_visit',
        current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 2 hours', '2 Sheet Rd', false),
       ('10000000-0000-0000-0000-0000000000f3', :'org_id', 'Import Picnic', 'import-picnic', 'draft', 'volunteer',
        current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 2 hours', '3 Sheet Rd', false);
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002', 'volunteer_director'),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', 'section_lead'),
  ('10000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000003', 'section_lead');
insert into public.stations (id, event_id, name, station_type) values
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'Gate', 'passive');
insert into public.shifts (id, station_id, event_id, title, starts_at, ends_at, max_capacity) values
  ('30000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1',
   'Gate Morning', now() + interval '30 days', now() + interval '30 days 2 hours', 1);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.band_prefills (event_id, email, school_name, band_name, classification, created_by) values
  ('10000000-0000-0000-0000-0000000000f1', 'band@example.com', 'Sheet High', 'Sheet High Band', '5A',
   '00000000-0000-0000-0000-000000000001');
-- Importing the same row again updates it in place.
insert into public.band_prefills (event_id, email, school_name, band_name, classification, created_by) values
  ('10000000-0000-0000-0000-0000000000f1', 'band@example.com', 'Sheet High', 'Sheet High Band', '6A',
   '00000000-0000-0000-0000-000000000001')
on conflict (event_id, email, band_name) do update
  set event_id = excluded.event_id, email = excluded.email, band_name = excluded.band_name,
      school_name = excluded.school_name, classification = excluded.classification, created_by = excluded.created_by;
do $$ begin
  assert (select count(*) = 1 and min(classification) = '6A' from public.band_prefills where email = 'band@example.com'),
         'a re-import updates the saved details';
  -- Not for a volunteer event, and never in someone else's name.
  begin
    insert into public.band_prefills (event_id, email, band_name, created_by)
    values ('10000000-0000-0000-0000-0000000000f3', 'band@example.com', 'Nope', '00000000-0000-0000-0000-000000000001');
    raise exception 'saved band details for a volunteer event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.band_prefills (event_id, email, band_name, created_by)
    values ('10000000-0000-0000-0000-0000000000f1', 'band@example.com', 'Nope', '00000000-0000-0000-0000-000000000006');
    raise exception 'saved band details as someone else';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.bands where event_id = '10000000-0000-0000-0000-0000000000f1'),
         'importing registers nobody';
end $$;

set role authenticated;
-- Not a Volunteer Lead, a Section Lead or a stranger: they can't read or add any.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select count(*) from public.band_prefills) = 0, 'a Volunteer Lead can''t read saved band details';
  assert (select count(*) from public.my_band_prefills('10000000-0000-0000-0000-0000000000f1')) = 0,
         'nor see them for someone else''s email';
  begin
    insert into public.band_prefills (event_id, email, band_name, created_by)
    values ('10000000-0000-0000-0000-0000000000f1', 'x@example.com', 'Nope', '00000000-0000-0000-0000-000000000002');
    raise exception 'a Volunteer Lead saved band details';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.band_prefills) = 0, 'a stranger can''t read saved band details';
  delete from public.band_prefills;
end $$;
-- The director it names sees their own.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
do $$ begin
  assert (select band_name from public.my_band_prefills('10000000-0000-0000-0000-0000000000f1')) = 'Sheet High Band',
         'the director sees the details saved for them';
  assert (select count(*) from public.band_prefills) = 0, 'but not the table itself';
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.my_band_prefills('10000000-0000-0000-0000-0000000000f1');
    raise exception 'anon read saved band details';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.band_prefills where event_id = '10000000-0000-0000-0000-0000000000f1') = 1,
         'the stranger''s delete removed nothing';
end $$;

-- Volunteers: hosts and Volunteer Leads import; a full shift grows to fit.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
select public.import_volunteer('10000000-0000-0000-0000-0000000000f1', 'Ida Import', 'ida@example.com', '+15125550170', false,
       '[{"name": "Ivy Importson", "minor": true}]', array['30000000-0000-0000-0000-0000000000f1']::uuid[]) \g /dev/null
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
select public.import_volunteer('10000000-0000-0000-0000-0000000000f1', 'Lia Lead-Added', 'lia@example.com', null, false,
       '[]', array['30000000-0000-0000-0000-0000000000f1']::uuid[]) \g /dev/null
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.import_volunteer('10000000-0000-0000-0000-0000000000f1', 'No Way', 'noway@example.com', null, false,
            '[]', array['30000000-0000-0000-0000-0000000000f1']::uuid[]);
    raise exception 'a Section Lead imported volunteers';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.import_volunteer('10000000-0000-0000-0000-0000000000f1', 'No Way', 'noway@example.com', null, false,
            '[]', array['30000000-0000-0000-0000-0000000000f1']::uuid[]);
    raise exception 'a stranger imported volunteers';
  exception when insufficient_privilege then null;
  end;
  -- Nor onto another event's shift through an event they don't run.
  begin
    perform public.import_volunteer('10000000-0000-0000-0000-0000000000f3', 'No Way', 'noway@example.com', null, false,
            '[]', array['30000000-0000-0000-0000-0000000000f1']::uuid[]);
    raise exception 'a stranger imported volunteers to an event they don''t run';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select registered_count = 3 and max_capacity = 3 from public.shifts where id = '30000000-0000-0000-0000-0000000000f1'),
         'the full shift grew to fit the three imported people';
  assert exists (select 1 from public.volunteers where full_name = 'Ivy I.' and minor and contact_id is not null),
         'an imported under-18 helper keeps only a last initial';
  assert not exists (select 1 from public.volunteers where email = 'noway@example.com'), 'nobody else was imported';
end $$;

-- A host can't import onto another event's shift through their own event.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform public.import_volunteer('10000000-0000-0000-0000-0000000000f3', 'Wrong Event', 'wrong@example.com', null, false,
            '[]', array['30000000-0000-0000-0000-0000000000f1']::uuid[]);
    raise exception 'imported onto a shift from another event';
  exception when raise_exception then
    if sqlerrm not like '%does not exist%' then raise; end if;
  end;
end $$;

-- Parents: the host of a school visit only, open or not; an email already registered is left alone.
select public.import_parent_registration('10000000-0000-0000-0000-0000000000f2', 'Pam Parent', 'pam@example.com', null,
       '[{"name": "Pia Parent", "teacher": "Smith", "grade": "3rd"}]') \g /dev/null
do $$ begin
  assert public.import_parent_registration('10000000-0000-0000-0000-0000000000f2', 'Someone Else', 'pam@example.com', null,
         '[{"name": "Other Kid", "teacher": "Jones", "grade": "1st"}]') is null, 'a second import of the same email changes nothing';
  begin
    perform public.import_parent_registration('10000000-0000-0000-0000-0000000000f1', 'Pam Parent', 'pam2@example.com', null,
            '[{"name": "Pia Parent", "teacher": "Smith", "grade": "3rd"}]');
    raise exception 'imported parents into a band contest';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  begin
    perform public.import_parent_registration('10000000-0000-0000-0000-0000000000f2', 'Lead Parent', 'leadp@example.com', null,
            '[{"name": "Kid", "teacher": "Smith", "grade": "3rd"}]');
    raise exception 'a Section Lead imported children''s details';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select parent_name = 'Pam Parent' and children -> 0 ->> 'name' = 'Pia Parent'
            from public.parent_registrations where email = 'pam@example.com'), 'the imported family is registered once';
  assert not exists (select 1 from public.parent_registrations where email = 'leadp@example.com'), 'the lead''s import was refused';
end $$;

-- Saved band details go once the event is over.
-- (Two days back, so it's over in the event's own time zone at any hour.)
update public.events set starts_on = current_date - 2, ends_on = current_date - 2,
       window_start = now() - interval '2 days', window_end = now() - interval '44 hours'
 where id = '10000000-0000-0000-0000-0000000000f1';
set role service_role;
do $$ begin
  assert public.purge_band_prefills() = 1, 'saved band details are removed after the event';
end $$;
reset role;
delete from public.events where id in ('10000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f2',
                                       '10000000-0000-0000-0000-0000000000f3');

-- Stations, step by step: hosts and Volunteer Leads mark a station's details
-- as saved; a Section Lead or a stranger can't.
insert into public.events (id, organization_id, name, slug, status, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000fa', :'org_id', 'Steps Fair', 'steps-fair', 'draft',
        current_date + 40, current_date + 40, now() + interval '40 days', now() + interval '40 days 4 hours', '4 Step Rd');
insert into public.stations (id, event_id, name, station_type) values
  ('20000000-0000-0000-0000-0000000000fa', '10000000-0000-0000-0000-0000000000fa', 'Ticket Table', 'passive');
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-000000000002', 'volunteer_director'),
  ('10000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-000000000003', 'section_lead');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
update public.stations set details_saved_at = now() where id = '20000000-0000-0000-0000-0000000000fa';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
update public.stations set details_saved_at = now() where id = '20000000-0000-0000-0000-0000000000fa';
reset role;
do $$ begin
  assert (select details_saved_at is null from public.stations where id = '20000000-0000-0000-0000-0000000000fa'),
         'a Section Lead or a stranger can''t mark station details saved';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
update public.stations set details_saved_at = now() where id = '20000000-0000-0000-0000-0000000000fa';
reset role;
do $$ begin
  assert (select details_saved_at is not null from public.stations where id = '20000000-0000-0000-0000-0000000000fa'),
         'a Volunteer Lead marks station details saved';
end $$;
delete from public.events where id = '10000000-0000-0000-0000-0000000000fa';

-- Parent-teacher conferences: free (no plan needed), one published per
-- account, ready before publishing; one day; never switch kinds. Settings
-- (with the video link) are for the event's hosts and team only.
reset role;
update public.organizations set subscription_status = 'none' where id = :'org_id';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address)
values
  ('10000000-0000-0000-0000-0000000000c1', :'org_id', 'Fall Conferences', 'fall-conf', 'draft', 'conference',
   current_date + 20, current_date + 20, now() + interval '20 days', now() + interval '20 days 4 hours', '1 School Rd'),
  ('10000000-0000-0000-0000-0000000000c2', :'org_id', 'Spring Conferences', 'spring-conf', 'draft', 'conference',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 4 hours', '1 School Rd'),
  ('10000000-0000-0000-0000-0000000000c3', :'org_id', 'Book Fair Helpers', 'book-fair-helpers', 'draft', 'volunteer',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 4 hours', '1 School Rd');
reset role;
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000003', 'section_lead');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean;
begin
  -- One day only.
  ok := false;
  begin
    update public.events set ends_on = starts_on + 1 where id = '10000000-0000-0000-0000-0000000000c1';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a conference can''t span two days';
  -- Never switches kinds, either way.
  ok := false;
  begin
    update public.events set event_type = 'volunteer' where id = '10000000-0000-0000-0000-0000000000c1';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a conference can''t become another kind of event';
  ok := false;
  begin
    update public.events set event_type = 'conference' where id = '10000000-0000-0000-0000-0000000000c3';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'another kind of event can''t become a conference';
  -- Settings only on conferences.
  ok := false;
  begin
    insert into public.conference_settings (event_id) values ('10000000-0000-0000-0000-0000000000c3');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'meeting times only belong to conferences';
  -- Not ready yet: publishing says what's missing.
  ok := false;
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c1';
  exception when sqlstate 'P0001' then ok := sqlerrm like '%meeting times%';
  end;
  assert ok, 'a conference without meeting times can''t be published';
  insert into public.conference_settings (event_id, meeting_minutes, times_saved_at, meeting_mode, video_link)
  values ('10000000-0000-0000-0000-0000000000c1', 15, now(), 'video', 'https://zoom.us/j/123');
  ok := false;
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c1';
  exception when sqlstate 'P0001' then ok := sqlerrm like '%waiting room%';
  end;
  assert ok, 'a video conference needs the waiting room ticked';
  ok := false;
  begin
    update public.conference_settings set video_link = 'javascript:alert(1)' where event_id = '10000000-0000-0000-0000-0000000000c1';
  exception when check_violation then ok := true;
  end;
  assert ok, 'the meeting link must be an https link';
  update public.conference_settings set waiting_room_confirmed = true where event_id = '10000000-0000-0000-0000-0000000000c1';
  -- Free: publishes without a plan.
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c1';
  assert (select status from public.events where id = '10000000-0000-0000-0000-0000000000c1') = 'published',
         'a ready conference publishes without a paid plan';
  -- Only one published at a time.
  insert into public.conference_settings (event_id, meeting_minutes, times_saved_at, meeting_mode, room)
  values ('10000000-0000-0000-0000-0000000000c2', 20, now(), 'in_person', 'Room 214, purple hallway');
  ok := false;
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c2';
  exception when sqlstate 'P0001' then ok := sqlerrm like '%Fall Conferences%';
  end;
  assert ok, 'only one conference can be published at a time';
  update public.events set status = 'draft' where id = '10000000-0000-0000-0000-0000000000c1';
  -- In person needs the school's address (asked in step 2).
  update public.events set venue_address = '' where id = '10000000-0000-0000-0000-0000000000c2';
  ok := false;
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c2';
  exception when sqlstate 'P0001' then ok := sqlerrm like '%address%';
  end;
  assert ok, 'an in-person conference needs the school''s address';
  update public.events set venue_address = '1 School Rd' where id = '10000000-0000-0000-0000-0000000000c2';
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c2';
  -- Video always needs the one pasted link: "I'll add it to each invite" no longer counts (20270123000000).
  update public.conference_settings set video_link = null, waiting_room_confirmed = false, own_link = true
   where event_id = '10000000-0000-0000-0000-0000000000c1';
  assert public.conference_not_ready('10000000-0000-0000-0000-0000000000c1') = 'Add your meeting link first.',
         'a video conference needs its link, even with the old "own link" setting';
  update public.conference_settings set video_link = 'https://zoom.us/j/123', waiting_room_confirmed = true, own_link = false
   where event_id = '10000000-0000-0000-0000-0000000000c1';
  -- Other kinds still need a plan.
  ok := false;
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c3';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'other kinds of event still need a plan to publish';
  -- The contact email shown when every time is booked (20270124000000): the host sets it; it must look like one.
  update public.conference_settings set contact_email = 'dana@example.com' where event_id = '10000000-0000-0000-0000-0000000000c1';
  assert (select contact_email from public.conference_settings where event_id = '10000000-0000-0000-0000-0000000000c1') = 'dana@example.com',
         'the host sets a contact email';
  ok := false;
  begin
    update public.conference_settings set contact_email = 'not an email' where event_id = '10000000-0000-0000-0000-0000000000c1';
  exception when check_violation then ok := true;
  end;
  assert ok, 'a contact email has to look like one';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$
declare ok boolean := false;
begin
  update public.conference_settings set contact_email = 'lead@evil.example' where event_id = '10000000-0000-0000-0000-0000000000c1';
  assert (select contact_email from public.conference_settings where event_id = '10000000-0000-0000-0000-0000000000c1') = 'dana@example.com',
         'the team can''t change the contact email';
  assert (select video_link from public.conference_settings where event_id = '10000000-0000-0000-0000-0000000000c1') = 'https://zoom.us/j/123',
         'the conference''s team can read its settings';
  update public.conference_settings set video_link = 'https://evil.example' where event_id = '10000000-0000-0000-0000-0000000000c1';
  assert (select video_link from public.conference_settings where event_id = '10000000-0000-0000-0000-0000000000c1') = 'https://zoom.us/j/123',
         'the team can''t change the settings';
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000c1';
  exception when others then ok := true;
  end;
  assert ok or (select status from public.events where id = '10000000-0000-0000-0000-0000000000c1') = 'draft',
         'the team can''t publish a conference';
  assert public.conference_not_ready('10000000-0000-0000-0000-0000000000c1') like 'Only the event%',
         'readiness is for the event''s hosts';
  assert public.other_published_conference('10000000-0000-0000-0000-0000000000c1') is null,
         'and so is the other published conference';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.conference_settings) = 0, 'strangers can''t read conference settings';
end $$;
set role anon;
set request.jwt.claims = '';
do $$
declare n integer;
begin
  begin
    select count(*) into n from public.conference_settings;
    raise exception 'FAIL: anonymous visitors read conference settings';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from public.events where id in ('10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c2',
                                       '10000000-0000-0000-0000-0000000000c3');
update public.organizations set subscription_status = 'comped' where id = :'org_id';

-- Conference bookings: families book open times (one family per time, one
-- meeting per child), the public sees only open times, the team reads
-- bookings, families change or cancel by link, and old bookings are purged.
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000d1', :'org_id', 'Ms. Smith Conferences', 'conf-d1', 'published', 'conference', 'America/Chicago',
        current_date + 3, current_date + 3,
        ((current_date + 3) + time '15:00') at time zone 'America/Chicago',
        ((current_date + 3) + time '16:00') at time zone 'America/Chicago', '1 School Rd');
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, room)
values ('10000000-0000-0000-0000-0000000000d1', 15, 0, '[{"start": "15:30", "minutes": 15, "label": "Break"}]', now(), 'in_person', 'Room 214');
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000003', 'section_lead');
do $$
declare
  d   date := current_date + 3;
  s1  timestamptz := (d + time '15:00') at time zone 'America/Chicago';
  s2  timestamptz := (d + time '15:15') at time zone 'America/Chicago';
  s3  timestamptz := (d + time '15:45') at time zone 'America/Chicago';
  t1  uuid;
  ok  boolean;
  fam jsonb := '[{"name": "Maria Lopez", "email": "Maria@Example.com"}, {"name": "Jo Lopez", "email": "jo@example.com"}]';
begin
  assert (select array_agg(t order by t) from public.conference_slot_starts('10000000-0000-0000-0000-0000000000d1') t) = array[s1, s2, s3],
         'meeting times skip the break';
  t1 := public.book_conference('10000000-0000-0000-0000-0000000000d1', s1, 'Ava Lopez', fam, 'video', 'Reading');
  assert (select meeting_mode from public.conference_bookings where access_token = t1) = 'in_person',
         'an in-person conference books in person, whatever the form says';
  assert (select parents -> 0 ->> 'email' from public.conference_bookings where access_token = t1) = 'maria@example.com',
         'parents'' emails are stored lower case';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000d1', s1, 'Ben Park', '[{"name": "Kim Park", "email": "kim@example.com"}]', null, null);
  exception when sqlstate 'P0001' then ok := sqlerrm like '%just taken%';
  end;
  assert ok, 'a booked time can''t be booked again';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000d1', s2, ' ava lopez ', fam, null, null);
  exception when sqlstate 'P0001' then ok := sqlerrm like '%already has a meeting%';
  end;
  assert ok, 'a child has one meeting';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000d1', s1 + interval '5 minutes', 'Cy Diaz', '[{"name": "Al Diaz", "email": "al@example.com"}]', null, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'only real meeting times can be booked';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000d1', s2, 'Cy Diaz', '[{"name": "Al Diaz", "email": "not-an-email"}]', null, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'each parent needs an email address';
  -- Change from the link: a new time, and a new calendar version.
  perform public.change_conference_booking(t1, s3, null);
  assert (select starts_at = s3 and calendar_sequence = 1 from public.conference_bookings where access_token = t1),
         'a family moves their meeting';
end $$;
-- "Emailed a link to pick a new time" is for one time: it clears when the meeting's time changes.
do $$
declare t1 uuid := (select access_token from public.conference_bookings where child_name = 'Ava Lopez');
begin
  update public.conference_bookings set reschedule_requested_at = now() where access_token = t1;
  update public.conference_bookings set note = note where access_token = t1;
  assert (select reschedule_requested_at is not null from public.conference_bookings where access_token = t1),
         'the emailed mark stays while the time is the same';
  update public.conference_bookings set starts_at = starts_at + interval '1 minute' where access_token = t1;
  assert (select reschedule_requested_at is null from public.conference_bookings where access_token = t1),
         'the emailed mark clears when the meeting''s time changes';
  update public.conference_bookings set starts_at = starts_at - interval '1 minute' where access_token = t1;
  update public.conference_bookings set reschedule_requested_at = now() where access_token = t1;
end $$;
-- The public sees only open times, and can't read or make bookings directly.
set role anon;
set request.jwt.claims = '';
do $$
declare ok boolean := false; n integer;
begin
  assert (select count(*) from public.conference_open_times('conf-d1')) = 2, 'the public sees the two open times';
  assert not exists (select 1 from public.conference_open_times('conf-d1') o
                      join (select ((current_date + 3) + time '15:45') at time zone 'America/Chicago' as t) b on o.starts_at = b.t),
         'a booked time isn''t listed';
  begin
    select count(*) into n from public.conference_bookings;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anonymous visitors can''t read bookings';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000d1', now() + interval '3 days', 'X Y', '[]', null, null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anonymous visitors can''t call the booking function directly';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.conference_bookings) = 0, 'strangers can''t read bookings';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d1') = 0,
         'only the teacher sees bookings, not the event''s team';
  delete from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d1';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d1') = 1,
         'the team can''t cancel bookings';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d1') = 1,
         'the teacher sees their bookings';
  assert (select reschedule_requested_at is not null from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d1'),
         'the teacher sees who was emailed a link to pick a new time';
  declare ok boolean := false;
  begin
    begin
      update public.conference_bookings set reschedule_requested_at = null where event_id = '10000000-0000-0000-0000-0000000000d1';
    exception when insufficient_privilege then ok := true;
    end;
    assert ok, 'only the server marks who was emailed a link';
  end;
  delete from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d1';
end $$;
reset role;
do $$
declare
  t uuid;
  ok boolean := false;
begin
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d1') = 0,
         'the host can cancel a booking';
  -- Cancel by link.
  t := public.book_conference('10000000-0000-0000-0000-0000000000d1', ((current_date + 3) + time '15:15') at time zone 'America/Chicago',
                              'Dee Fox', '[{"name": "Ann Fox", "email": "ann@example.com"}]', null, null);
  perform public.cancel_conference_booking(t);
  assert not exists (select 1 from public.conference_bookings where access_token = t), 'a family cancels by link';
  -- Drafts take no bookings.
  update public.events set status = 'draft' where id = '10000000-0000-0000-0000-0000000000d1';
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000d1', ((current_date + 3) + time '15:15') at time zone 'America/Chicago',
                                   'Dee Fox', '[{"name": "Ann Fox", "email": "ann@example.com"}]', null, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'an unpublished conference takes no bookings';
  assert (select count(*) from public.conference_open_times('conf-d1')) = 0, 'and lists no times';
  -- Purged 30 days after.
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000d1';
  perform public.book_conference('10000000-0000-0000-0000-0000000000d1', ((current_date + 3) + time '15:15') at time zone 'America/Chicago',
                                 'Dee Fox', '[{"name": "Ann Fox", "email": "ann@example.com"}]', null, null);
  update public.events set starts_on = current_date - 40, ends_on = current_date - 40 where id = '10000000-0000-0000-0000-0000000000d1';
  assert public.purge_conference_bookings() = 1, 'bookings are deleted 30 days after the conference';
end $$;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d1';

-- ---------------------------------------------------------------------------
-- Free teacher accounts: by invitation, conferences only
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000000a-0000-0000-0000-000000000001', 'teacher@example.com', '{}'),
  ('0000000a-0000-0000-0000-000000000002', 'uninvited@example.com', '{}');
set role authenticated;
-- Without an invitation, nobody makes a teacher account (or an organization).
set request.jwt.claims = '{"sub":"0000000a-0000-0000-0000-000000000002","email":"uninvited@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.create_teacher_account('Una Uninvited', 'Oak Elementary', 'America/Chicago');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a teacher account needs an invitation';
  ok := false;
  begin
    perform public.create_organization('Una Boosters', 'una-boosters');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'so does an organization';
end $$;
reset role;
insert into public.host_invitations (email) values ('teacher@example.com');
set role authenticated;
set request.jwt.claims = '{"sub":"0000000a-0000-0000-0000-000000000001","email":"teacher@example.com"}';
do $$
declare
  org public.organizations;
  ok boolean := false;
begin
  begin
    perform public.create_teacher_account('Tia Teacher', '', 'America/Chicago');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a teacher account needs a school';
  ok := false;
  begin
    perform public.create_teacher_account('Tia Teacher', 'Oak Elementary', 'Not/AZone');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a teacher account needs a real time zone';

  org := public.create_teacher_account('Tia Teacher', 'Oak Elementary', 'America/Chicago');
  assert org.account_kind = 'teacher' and org.school = 'Oak Elementary', 'an invited teacher sets up their account';
  assert org.subscription_status = 'none', 'with no plan: one free conference, weekly hours stay premium';
  assert (select full_name from public.profiles where id = auth.uid()) = 'Tia Teacher', 'their name is saved';
  ok := false;
  begin
    perform public.create_teacher_account('Tia Teacher', 'Oak Elementary', 'America/Chicago');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'one account per person';

  insert into public.events (organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address)
  values (org.id, 'Fall Conferences', 'tia-fall', 'conference', current_date + 5, current_date + 5,
          now() + interval '5 days', now() + interval '5 days 3 hours', '');
  ok := false;
  begin
    insert into public.events (organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address)
    values (org.id, 'Fun Run', 'tia-run', 'volunteer', current_date + 5, current_date + 5,
            now() + interval '5 days', now() + interval '5 days 3 hours', '1 Oak St');
  exception when insufficient_privilege then ok := true;
  end;
  assert not ok, 'teacher accounts can set up other kinds of events to try';
  ok := false;
  begin
    update public.events set status = 'published' where slug = 'tia-run';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'teacher accounts publish conferences only';
  delete from public.events where slug = 'tia-run';

  ok := false;
  begin
    update public.organizations set account_kind = 'standard' where id = org.id;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a teacher can''t upgrade their own account';
end $$;
reset role;
do $$ begin
  assert (select used_at is not null from public.host_invitations where email = 'teacher@example.com'), 'the teacher''s invitation is used';
end $$;
set role authenticated;
-- A host with an organization can't also make a teacher account.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.create_teacher_account('Hana Host', 'Oak Elementary', 'America/Chicago');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'people who already host can''t make a second account';
end $$;
set role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform public.create_teacher_account('Anon', 'Oak Elementary', 'America/Chicago');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'signing up needs a sign-in';
end $$;
reset role;
do $$
declare ok boolean := false;
begin
  -- Other kinds of events on a teacher account are try-it events, and the
  -- outside-invitation rule holds even for the server.
  insert into public.events (organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address)
  values ((select id from public.organizations where school = 'Oak Elementary'), 'Band Day', 'tia-band', 'band_contest',
          current_date + 5, current_date + 5, now() + interval '5 days', now() + interval '5 days 3 hours', '1 Oak St');
  assert public.event_is_trial((select id from public.events where slug = 'tia-band')), 'a band contest is a try-it event for a teacher';
  begin
    insert into public.band_invitations (event_id, email) values ((select id from public.events where slug = 'tia-band'), 'dir@example.com');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'the outside-invitation rule holds for everyone';
  delete from public.events where slug = 'tia-band';
end $$;

-- ---------------------------------------------------------------------------
-- Admin tools for teacher accounts: pipeline card, suspend, upgrade
-- ---------------------------------------------------------------------------
select set_config('test.tia_org', id::text, false) from public.organizations where school = 'Oak Elementary';
do $$ begin
  assert (select status from public.pilot_requests
           where organization_id = current_setting('test.tia_org')::uuid) = 'teacher',
         'a teacher sign-up adds a Teacher (free) pipeline card';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"0000000a-0000-0000-0000-000000000001","email":"teacher@example.com"}';
do $$
declare
  org uuid := current_setting('test.tia_org')::uuid;
  ok boolean := false;
begin
  begin
    perform public.admin_upgrade_teacher(org, 'event', null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a teacher can''t upgrade their own account';
  ok := false;
  begin
    perform public.admin_unsuspend_account(org, null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only admins can unsuspend';
end $$;
reset role;
update public.events set status = 'published' where slug = 'tia-fall';
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare
  org uuid := current_setting('test.tia_org')::uuid;
begin
  assert public.admin_suspend_account(org, 'Spam') = 1, 'suspending unpublishes the account''s events';
end $$;
reset role;
do $$
declare
  org uuid := current_setting('test.tia_org')::uuid;
  ok boolean := false;
begin
  assert (select status from public.events where slug = 'tia-fall') = 'draft', 'the conference is offline';
  assert exists (select 1 from public.admin_log where organization_id = org and action = 'account_suspended'), 'suspending is logged';
  begin
    update public.events set status = 'published' where slug = 'tia-fall';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a suspended account can''t publish';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare
  org uuid := current_setting('test.tia_org')::uuid;
begin
  perform public.admin_unsuspend_account(org, null);
  perform public.admin_upgrade_teacher(org, 'event', 'Joined the pilot');
end $$;
reset role;
do $$
declare
  org uuid := current_setting('test.tia_org')::uuid;
begin
  assert (select account_kind from public.organizations where id = org) = 'standard', 'an admin upgrades a teacher account';
  assert (select status from public.pilot_requests where organization_id = org) = 'set_up', 'its pipeline card moves to Set up';
  update public.events set status = 'published' where slug = 'tia-fall';
  insert into public.events (organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address)
  values (org, 'Fun Run', 'tia-run2', 'volunteer', current_date + 5, current_date + 5,
          now() + interval '5 days', now() + interval '5 days 3 hours', '1 Oak St');
end $$;
delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';

-- Penetration test hardening (20261129000000_security_hardening.sql) ---------
-- An invitation can't be re-sent within 5 minutes, and one organization can't
-- send more than 40 invitation emails an hour (even by cancelling and re-inviting).
reset role;
insert into public.invitations (event_id, email, role, invited_by)
values ('10000000-0000-0000-0000-00000000000a', 'flood@example.com', 'volunteer_director', '00000000-0000-0000-0000-000000000001');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  perform public.prepare_invitation_email((select id from public.invitations where email = 'flood@example.com'));
  begin
    perform public.prepare_invitation_email((select id from public.invitations where email = 'flood@example.com'));
  exception when raise_exception then ok := true;
  end;
  assert ok, 'the same invitation can''t be re-sent within 5 minutes';
end $$;
reset role;
update public.invitations set sent_at = null where email = 'flood@example.com';
insert into public.invitation_sends (organization_id)
select e.organization_id from public.events e, generate_series(1, 40) where e.id = '10000000-0000-0000-0000-00000000000a';
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    perform public.prepare_invitation_email((select id from public.invitations where email = 'flood@example.com'));
  exception when raise_exception then ok := true;
  end;
  assert ok, 'an organization can''t send more than 40 invitation emails an hour';
end $$;
-- Nobody can read the send records directly.
do $$
declare ok boolean := false;
begin
  begin
    perform 1 from public.invitation_sends;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'invitation send records are private';
end $$;
reset role;
delete from public.invitation_sends;
delete from public.invitations where email = 'flood@example.com';

-- Visitors who aren't signed in have no write permission on any table.
set role anon;
do $$
declare
  t text;
  ok boolean;
begin
  foreach t in array array['volunteers', 'parent_registrations', 'conference_bookings', 'events', 'organizations',
                           'organization_members', 'profiles', 'bands', 'invitations'] loop
    ok := false;
    begin
      execute format('delete from public.%I', t);
    exception when insufficient_privilege then ok := true;
    end;
    assert ok, format('anon can''t delete from %s', t);
  end loop;
  ok := false;
  begin
    insert into public.volunteers (event_id, full_name, email) values (gen_random_uuid(), 'X', 'x@example.com');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon can''t add volunteers directly';
end $$;
reset role;
do $$ begin
  assert not exists (
    select 1 from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ), 'anon holds no write permission on any table';
end $$;

-- Conference outcomes (20261130000000_conference_outcomes.sql) --------------
-- The teacher marks a started meeting Met or No-show; nobody else can.
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000d2', :'org_id', 'Mr. Lee Conferences', 'conf-d2', 'published', 'conference', 'America/Chicago',
        current_date + 3, current_date + 3,
        ((current_date + 3) + time '15:00') at time zone 'America/Chicago',
        ((current_date + 3) + time '16:00') at time zone 'America/Chicago', '1 School Rd');
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, room)
values ('10000000-0000-0000-0000-0000000000d2', 15, 0, '[]', now(), 'in_person', 'Room 9');
select set_config('test.outcome_token', public.book_conference('10000000-0000-0000-0000-0000000000d2',
  ((current_date + 3) + time '15:00') at time zone 'America/Chicago', 'Eli Ward', '[{"name": "Sam Ward", "email": "sam@example.com"}]', null, null)::text, false) \g /dev/null
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare
  bid uuid := (select b.id from public.conference_bookings b where b.event_id = '10000000-0000-0000-0000-0000000000d2');
  ok boolean := false;
begin
  begin
    perform public.set_conference_outcome(bid, 'met');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a meeting can''t be marked before it starts';
end $$;
reset role;
update public.conference_bookings set starts_at = now() - interval '10 minutes' where access_token = current_setting('test.outcome_token')::uuid;
set role authenticated;
do $$
declare
  bid uuid := (select b.id from public.conference_bookings b where b.event_id = '10000000-0000-0000-0000-0000000000d2');
  ok boolean := false;
begin
  perform public.set_conference_outcome(bid, 'met');
  assert (select outcome from public.conference_bookings where conference_bookings.id = bid) = 'met', 'the teacher marks a meeting Met';
  perform public.set_conference_outcome(bid, 'no_show');
  assert (select outcome from public.conference_bookings where conference_bookings.id = bid) = 'no_show', 'and changes it to No-show';
  begin
    perform public.set_conference_outcome(bid, 'late');
  exception when sqlstate '22023' then ok := true;
  end;
  assert ok, 'only Met or No-show';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_conference_outcome((select id from public.conference_bookings limit 1), 'met');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'strangers can''t mark meetings';
end $$;
reset role;
do $$
declare
  ok boolean := false;
  -- The stranger can't see the booking's id, so try it with the real one too.
  real_id uuid := (select id from public.conference_bookings where access_token = current_setting('test.outcome_token')::uuid);
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}', true);
  begin
    perform public.set_conference_outcome(real_id, 'met');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'strangers can''t mark a meeting even with its id';
end $$;
reset role;
do $$ begin
  assert (select outcome from public.conference_bookings where access_token = current_setting('test.outcome_token')::uuid) = 'no_show',
         'the stranger changed nothing';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  perform public.set_conference_outcome((select id from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d2'), null);
  assert (select outcome is null and outcome_at is null from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d2'),
         'tapping again undoes it';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d2';

-- Conference bookings: the event's hosts and co-hosts, and rescheduling
-- (20261228000000_reschedule_meetings.sql; 20261209000000 kept bookings to the
-- teacher who set the conference up). Another host on the account now sees and
-- manages the bookings, and can move a meeting to an open time or a typed-in one.
insert into public.organization_members (organization_id, user_id, role)
values (:'org_id', '00000000-0000-0000-0000-000000000009', 'admin');
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address, created_by)
values ('10000000-0000-0000-0000-0000000000d3', :'org_id', 'Ms. Park Conferences', 'conf-d3', 'published', 'conference', 'America/Chicago',
        current_date + 3, current_date + 3,
        ((current_date + 3) + time '15:00') at time zone 'America/Chicago',
        ((current_date + 3) + time '16:00') at time zone 'America/Chicago', '1 School Rd', '00000000-0000-0000-0000-000000000001');
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, room)
values ('10000000-0000-0000-0000-0000000000d3', 15, 0, '[]', now(), 'in_person', 'Room 3');
select set_config('test.park_token', public.book_conference('10000000-0000-0000-0000-0000000000d3',
  ((current_date + 3) + time '15:00') at time zone 'America/Chicago', 'Ivy Chen', '[{"name": "Lin Chen", "email": "lin@example.com"}]', null, 'Math')::text, false) \g /dev/null
select set_config('test.park_token2', public.book_conference('10000000-0000-0000-0000-0000000000d3',
  ((current_date + 3) + time '15:15') at time zone 'America/Chicago', 'Max Lee', '[{"name": "Ana Lee", "email": "ana@example.com"}]', null, null)::text, false) \g /dev/null
select set_config('test.ivy', (select id::text from public.conference_bookings where access_token = current_setting('test.park_token')::uuid), false) \g /dev/null
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","email":"cohost@example.com"}';
do $$
declare
  ev  uuid := '10000000-0000-0000-0000-0000000000d3';
  ivy uuid := current_setting('test.ivy')::uuid;
  at3 timestamptz := ((current_date + 3) + time '15:00') at time zone 'America/Chicago';
  ok  boolean;
begin
  assert public.is_conference_teacher(ev), 'another host on the account runs its conferences too';
  assert (select count(*) from public.conference_bookings where event_id = ev) = 2, 'and reads the bookings';

  perform public.reschedule_conference_booking(ivy, ((current_date + 3) + time '17:10') at time zone 'America/Chicago');
  reset role;
  assert (select starts_at = ((current_date + 3) + time '17:10') at time zone 'America/Chicago' and calendar_sequence = 1
            from public.conference_bookings where id = ivy),
         'a co-host moves a meeting to a typed-in time after hours (and the calendar invite updates)';
  set local role authenticated;
  assert exists (select 1 from public.conference_open_times('conf-d3') t where t.starts_at = at3), 'its old time opens up';

  perform public.reschedule_conference_booking(ivy, ((current_date + 3) + time '15:37') at time zone 'America/Chicago');
  assert not exists (select 1 from public.conference_open_times('conf-d3') t
                      where t.starts_at in (at3 + interval '30 minutes', at3 + interval '45 minutes')),
         'families aren''t offered times that overlap a typed-in meeting';
  assert exists (select 1 from public.conference_open_times('conf-d3') t where t.starts_at = at3), 'but are offered the rest';

  ok := false;
  begin
    perform public.reschedule_conference_booking(ivy, ((current_date + 3) + time '15:20') at time zone 'America/Chicago');
  exception when others then ok := sqlerrm = 'That time overlaps another meeting. Pick another.';
  end;
  assert ok, 'a reschedule can''t overlap another meeting';
  ok := false;
  begin
    perform public.reschedule_conference_booking(ivy, ((current_date + 4) + time '15:00') at time zone 'America/Chicago');
  exception when others then ok := sqlerrm = 'Pick a day within the event''s dates.';
  end;
  assert ok, 'or fall outside the event''s days';
  ok := false;
  begin
    perform public.reschedule_conference_booking(ivy, now() - interval '1 hour');
  exception when others then ok := sqlerrm = 'Pick a time that hasn''t passed yet.';
  end;
  assert ok, 'or be in the past';
end $$;
reset role;
do $$
declare
  at3 timestamptz := ((current_date + 3) + time '15:00') at time zone 'America/Chicago';
  ok  boolean := false;
begin
  begin
    perform public.change_conference_booking(current_setting('test.park_token2')::uuid, at3 + interval '45 minutes', null);
  exception when others then ok := sqlerrm = 'That time was just taken. Please pick another.';
  end;
  assert ok, 'a family can''t change into a time that overlaps a typed-in meeting';
  perform public.change_conference_booking(current_setting('test.park_token2')::uuid, at3, null);
  assert (select starts_at = at3 from public.conference_bookings where access_token = current_setting('test.park_token2')::uuid),
         'but can change to an open time';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  assert public.conference_booked_count('10000000-0000-0000-0000-0000000000d3') is null, 'strangers get no count';
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d3') = 0,
         'or bookings';
  begin
    perform public.reschedule_conference_booking('00000000-0000-0000-0000-000000000000', now() + interval '1 day');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'and can''t reschedule';
end $$;
reset role;
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}', true);
  begin
    perform public.reschedule_conference_booking(current_setting('test.ivy')::uuid,
      ((current_date + 3) + time '15:30') at time zone 'America/Chicago');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'not even a real meeting they can''t see';
end $$;
reset role;
update public.conference_bookings set starts_at = now() - interval '10 minutes' where access_token = current_setting('test.park_token')::uuid;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","email":"cohost@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.reschedule_conference_booking(current_setting('test.ivy')::uuid, now() + interval '1 hour');
  exception when others then ok := sqlerrm = 'This meeting has already started, so it can''t be moved.';
  end;
  assert ok, 'a meeting that has started can''t be moved';
  perform public.set_conference_outcome(current_setting('test.ivy')::uuid, 'met');
  delete from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d3';
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000d3') = 0,
         'a co-host marks and cancels meetings too';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d3';
delete from public.organization_members where user_id = '00000000-0000-0000-0000-000000000009';

-- Conference bookings follow the day (20261210000000_conference_bookings_follow_day.sql)
-- Changing a conference's day moves each booking to the new day at the same
-- time of day, and bumps its calendar sequence for the updated invites.
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address, created_by)
values ('10000000-0000-0000-0000-0000000000d4', :'org_id', 'Moving Conferences', 'conf-d4', 'published', 'conference', 'America/Chicago',
        current_date + 3, current_date + 3,
        ((current_date + 3) + time '15:00') at time zone 'America/Chicago',
        ((current_date + 3) + time '16:00') at time zone 'America/Chicago', '1 School Rd', '00000000-0000-0000-0000-000000000001');
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, room)
values ('10000000-0000-0000-0000-0000000000d4', 15, 0, '[]', now(), 'in_person', 'Room 4');
select set_config('test.move_token', public.book_conference('10000000-0000-0000-0000-0000000000d4',
  ((current_date + 3) + time '15:15') at time zone 'America/Chicago', 'Max Ruiz', '[{"name": "Ana Ruiz", "email": "ana@example.com"}]', null, null)::text, false) \g /dev/null
update public.conference_bookings set reminded_at = now() where access_token = current_setting('test.move_token')::uuid;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.move_conference_bookings('10000000-0000-0000-0000-0000000000d4', 'UTC');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'nobody calls move_conference_bookings directly';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  perform public.reschedule_event('10000000-0000-0000-0000-0000000000d4', current_date + 5, current_date + 5,
    ((current_date + 5) + time '15:00') at time zone 'America/Chicago',
    ((current_date + 5) + time '16:00') at time zone 'America/Chicago', 'America/Chicago');
end $$;
reset role;
do $$ begin
  assert (select starts_at from public.conference_bookings where access_token = current_setting('test.move_token')::uuid)
         = ((current_date + 5) + time '15:15') at time zone 'America/Chicago',
         'a booking moves to the conference''s new day at the same time';
  assert (select calendar_sequence = 1 and reminded_at is null from public.conference_bookings where access_token = current_setting('test.move_token')::uuid),
         'a moved booking gets a new calendar sequence and a fresh reminder';
end $$;
-- A booking left on another day (before this fix) lands on the conference's
-- day the next time the day changes.
update public.conference_bookings set starts_at = ((current_date + 9) + time '15:30') at time zone 'America/Chicago'
 where access_token = current_setting('test.move_token')::uuid;
update public.events set starts_on = current_date + 6, ends_on = current_date + 6,
       window_start = ((current_date + 6) + time '15:00') at time zone 'America/Chicago',
       window_end = ((current_date + 6) + time '16:00') at time zone 'America/Chicago'
 where id = '10000000-0000-0000-0000-0000000000d4';
do $$ begin
  assert (select starts_at from public.conference_bookings where access_token = current_setting('test.move_token')::uuid)
         = ((current_date + 6) + time '15:30') at time zone 'America/Chicago',
         'a stray booking lands on the conference''s day';
end $$;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d4';

-- ---------------------------------------------------------------------------
-- Children's details: the 30 days are counted in the event's own time zone.
-- Kiritimati (UTC+14) and Pago Pago (UTC-11) are always 1 or 2 calendar days
-- apart, so with the same end date one is past 30 days and the other isn't.
-- ---------------------------------------------------------------------------
insert into public.events (id, organization_id, name, slug, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
select x.id, :'org_id', x.name, x.slug, x.kind::public.event_type, x.tz,
       (now() at time zone 'Pacific/Kiritimati')::date - 31, (now() at time zone 'Pacific/Kiritimati')::date - 31,
       now() - interval '32 days', now() - interval '32 days' + interval '3 hours', '1 School Rd'
  from (values
    ('10000000-0000-0000-0000-0000000000e1'::uuid, 'East visit', 'tz-east-visit', 'school_visit', 'Pacific/Kiritimati'),
    ('10000000-0000-0000-0000-0000000000e2'::uuid, 'West visit', 'tz-west-visit', 'school_visit', 'Pacific/Pago_Pago'),
    ('10000000-0000-0000-0000-0000000000e3'::uuid, 'East conference', 'tz-east-conf', 'conference', 'Pacific/Kiritimati'),
    ('10000000-0000-0000-0000-0000000000e4'::uuid, 'West conference', 'tz-west-conf', 'conference', 'Pacific/Pago_Pago')
  ) as x(id, name, slug, kind, tz);
insert into public.parent_registrations (event_id, parent_name, email, phone, children)
select id, 'Pat Lee', 'pat@example.com', '+15125550100', '[{"name": "Sam Lee", "teacher": "Ms. Ray", "grade": "2"}]'
  from public.events where id in ('10000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e2');
insert into public.conference_bookings (event_id, starts_at, child_name, parents, meeting_mode)
select id, window_start, 'Sam Lee', '[{"name": "Pat Lee", "email": "pat@example.com"}]', 'in_person'
  from public.events where id in ('10000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-0000000000e4');
set role service_role;
do $$ begin
  assert not public.parent_data_kept('10000000-0000-0000-0000-0000000000e1'), 'past 30 days in the event''s time zone: hidden';
  assert public.parent_data_kept('10000000-0000-0000-0000-0000000000e2'), 'not yet 30 days in the event''s time zone: still shown';
  assert public.purge_parent_registrations() = 1, 'only the visit past 30 days, local time, is erased';
  assert exists (select 1 from public.parent_registrations where event_id = '10000000-0000-0000-0000-0000000000e2'), 'the other is kept';
  assert public.purge_conference_bookings() = 1, 'only the conference past 30 days, local time, is erased';
  assert exists (select 1 from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000e4'), 'the other is kept';
end $$;
reset role;
delete from public.events where id in ('10000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e2',
                                       '10000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-0000000000e4');

-- ---------------------------------------------------------------------------
-- "Saved by" (20261203000000_event_saves.sql): each part of an event keeps its
-- last save by a host or Volunteer Lead. Saves by anyone else, background jobs
-- and joining a team don't count. Read only through event_saves(), by the
-- event's hosts and Volunteer Leads.
-- ---------------------------------------------------------------------------
set request.jwt.claims = '';
insert into public.events (id, organization_id, name, slug, event_type, status, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000005a1', :'org_id', 'Saves Fair', 'saves-fair', 'fair', 'draft',
        current_date + 40, current_date + 40, now() + interval '40 days', now() + interval '40 days 4 hours', '5 Save Rd');
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000002', 'volunteer_director'),
  ('10000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000003', 'section_lead');
insert into public.stations (id, event_id, name, station_type) values
  ('20000000-0000-0000-0000-0000000005a1', '10000000-0000-0000-0000-0000000005a1', 'Gate', 'passive');
do $$ begin
  assert not exists (select 1 from public.event_saves where event_id = '10000000-0000-0000-0000-0000000005a1'),
         'changes with nobody signed in (background jobs) aren''t saves';
end $$;

-- Someone who doesn't manage the event (a Section Lead, a band director, a stranger) never shows as a save.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
insert into public.fair_zones (event_id, name) values ('10000000-0000-0000-0000-0000000005a1', 'North');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
update public.events set venue_name = 'Band field' where id = '10000000-0000-0000-0000-0000000005a1';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
insert into public.announcements (event_id, sender_id, audiences, priority, body)
values ('10000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000006', '{volunteers}', 'routine', 'Hi');
-- Joining a team isn't editing it.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
insert into public.event_staff (event_id, user_id, role)
values ('10000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000007', 'volunteer_director');
do $$ begin
  assert not exists (select 1 from public.event_saves where event_id = '10000000-0000-0000-0000-0000000005a1'),
         'saves by people who don''t manage the event, or joining a team, aren''t recorded';
end $$;
delete from public.event_staff where event_id = '10000000-0000-0000-0000-0000000005a1'
   and user_id = '00000000-0000-0000-0000-000000000007';

-- The host edits details and opens volunteer sign-up; the Volunteer Lead adds a shift.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set venue_name = 'Main lot', volunteer_signup_open = true where id = '10000000-0000-0000-0000-0000000005a1';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
insert into public.shifts (station_id, title, starts_at, ends_at, max_capacity)
values ('20000000-0000-0000-0000-0000000005a1', 'Morning', now() + interval '40 days', now() + interval '40 days 2 hours', 3);
do $$ begin
  begin
    perform public.record_event_save('10000000-0000-0000-0000-0000000005a1', 'details');
    raise exception 'FAIL: record_event_save can be called directly';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.event_saves) = 0, 'the saves table isn''t readable directly';
  assert (select count(*) from public.event_saves('10000000-0000-0000-0000-0000000005a1')) = 2, 'a Volunteer Lead reads the saves';
  assert (select role = 'Volunteer Lead' and is_you from public.event_saves('10000000-0000-0000-0000-0000000005a1') where area = 'volunteers'),
         'the shift is saved by the Volunteer Lead (you)';
  assert (select name = 'Hana Host' and role = 'Host' and not is_you and managers >= 2
            from public.event_saves('10000000-0000-0000-0000-0000000005a1') where area = 'details'),
         'details are saved by the Host, by name';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert (select count(*) from public.event_saves('10000000-0000-0000-0000-0000000005a1')) = 0, 'a Section Lead can''t read saves';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.event_saves('10000000-0000-0000-0000-0000000005a1')) = 0, 'a stranger can''t read saves';
end $$;
set role anon;
set request.jwt.claims = '';
do $$ begin
  begin
    perform public.event_saves('10000000-0000-0000-0000-0000000005a1');
    raise exception 'FAIL: a visitor read saves';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- Turning sign-up on again (no change) or a sign-up count changing isn't a new save.
update public.event_saves set saved_at = now() - interval '1 day' where event_id = '10000000-0000-0000-0000-0000000005a1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set volunteer_signup_open = true where id = '10000000-0000-0000-0000-0000000005a1';
reset role;
update public.shifts set registered_count = registered_count + 1 where station_id = '20000000-0000-0000-0000-0000000005a1';
do $$ begin
  assert (select bool_and(saved_at < now() - interval '12 hours') from public.event_saves
           where event_id = '10000000-0000-0000-0000-0000000005a1'), 'no-change updates aren''t saves';
end $$;
delete from public.events where id = '10000000-0000-0000-0000-0000000005a1';
do $$ begin
  assert not exists (select 1 from public.event_saves where event_id = '10000000-0000-0000-0000-0000000005a1'),
         'deleting the event removes its saves';
end $$;
set request.jwt.claims = '';

-- ---------------------------------------------------------------------------
-- Account logo for volunteer badges (20261205000000_org_logo.sql): only the
-- account's hosts set it, only into the account's own folder, and nobody
-- writes the column directly.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
select public.set_org_logo(:'org_id', :'org_id' || '/logo.png') as first_old \gset
do $$ begin
  assert (select logo_path from public.organizations where id = (select organization_id from public.organization_members
            where user_id = '00000000-0000-0000-0000-000000000001' limit 1)) like '%/logo.png', 'a host sets the account logo';
end $$;
select public.set_org_logo(:'org_id', :'org_id' || '/new.png') as old_path \gset
\if :{?old_path}
\else
  \echo 'FAIL: no previous logo path returned'
  select 1/0;
\endif
do $$ begin
  begin
    perform public.set_org_logo((select organization_id from public.organization_members
                                  where user_id = '00000000-0000-0000-0000-000000000001' limit 1), '00000000-0000-0000-0000-00000000dead/x.png');
    raise exception 'FAIL: a logo was set from another account''s folder';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.organizations set logo_path = null;
    raise exception 'FAIL: the logo column was written directly';
  exception when insufficient_privilege then null;
  end;
end $$;
-- A Volunteer Lead, a Section Lead and a stranger can't change it.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  begin
    perform public.set_org_logo((select organization_id from public.events where slug = 'future'), null);
    raise exception 'FAIL: a Volunteer Lead changed the account logo';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.set_org_logo((select organization_id from public.events where slug = 'future'), null);
    raise exception 'FAIL: a stranger changed the account logo';
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
set request.jwt.claims = '';
do $$ begin
  begin
    perform public.set_org_logo((select id from public.organizations limit 1), null);
    raise exception 'FAIL: a visitor changed an account logo';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select logo_path from public.organizations where id = (select organization_id from public.events where slug = 'future')) like '%/new.png',
         'the logo is unchanged by people who can''t set it';
end $$;

-- ---------------------------------------------------------------------------
-- Account color (20261206000000_org_brand_color.sql): only the account's hosts
-- set it, only as a #rrggbb color, and nobody writes the column directly.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
select public.set_org_brand_color(:'org_id', '#7a1f2b');
do $$ begin
  assert (select brand_color from public.organizations where id = (select organization_id from public.events where slug = 'future')) = '#7a1f2b',
         'a host sets the account color';
  begin
    perform public.set_org_brand_color((select organization_id from public.events where slug = 'future'), 'red; drop table events');
    raise exception 'FAIL: a color that isn''t #rrggbb was saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.organizations set brand_color = '#000000';
    raise exception 'FAIL: the color column was written directly';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  begin
    perform public.set_org_brand_color((select organization_id from public.events where slug = 'future'), '#000000');
    raise exception 'FAIL: a Volunteer Lead changed the account color';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.set_org_brand_color((select organization_id from public.events where slug = 'future'), '#000000');
    raise exception 'FAIL: a stranger changed the account color';
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
set request.jwt.claims = '';
do $$ begin
  begin
    perform public.set_org_brand_color((select id from public.organizations limit 1), '#000000');
    raise exception 'FAIL: a visitor changed an account color';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select brand_color from public.organizations where id = (select organization_id from public.events where slug = 'future')) = '#7a1f2b',
         'the color is unchanged by people who can''t set it';
end $$;

-- ---------------------------------------------------------------------------
-- Director withdraw (20261207000000_director_withdraw.sql): a director marks
-- only their own band withdrawn; nobody else can, and it can't be undone by them.
-- ---------------------------------------------------------------------------
reset role;
insert into public.bands (id, event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('40000000-0000-0000-0000-0000000000dd', '10000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-000000000005', 'West HS', 'Westwind Winds', '5A', 'addr',
        'band@example.com', 'Bo Band', 'band@example.com', '+15125550105', 60, 8);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.withdraw_my_band('40000000-0000-0000-0000-0000000000dd');
    raise exception 'FAIL: a stranger withdrew someone else''s band';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform public.withdraw_my_band('40000000-0000-0000-0000-0000000000dd');
    raise exception 'FAIL: a host used the director''s withdraw';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"band@example.com"}';
select public.withdraw_my_band('40000000-0000-0000-0000-0000000000dd');
-- Undoing it isn't theirs to do: a direct write fails or changes nothing (checked below).
do $$ begin
  begin
    update public.bands set scratched_at = null where id = '40000000-0000-0000-0000-0000000000dd';
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
set request.jwt.claims = '';
do $$ begin
  begin
    perform public.withdraw_my_band('40000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a visitor withdrew a band';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select scratched_at from public.bands where id = '40000000-0000-0000-0000-0000000000dd') is not null,
         'the director withdrew their band, and only the organizer can undo it';
end $$;

-- ---------------------------------------------------------------------------
-- Pending band registrations (20261208000000_pending_band_registrations.sql):
-- only our server touches them. Visitors and signed-in people can't read,
-- add, or change one.
-- ---------------------------------------------------------------------------
reset role;
insert into public.pending_band_registrations (event_id, email, details)
values ('10000000-0000-0000-0000-00000000000a', 'someone@example.com', '{"band_name":"Waiting Winds"}');
set role anon;
set request.jwt.claims = '';
do $$ begin
  begin
    perform 1 from public.pending_band_registrations;
    raise exception 'FAIL: a visitor read pending registrations';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.pending_band_registrations (event_id, email, details)
    values ('10000000-0000-0000-0000-00000000000a', 'x@example.com', '{}');
    raise exception 'FAIL: a visitor added a pending registration';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform 1 from public.pending_band_registrations;
    raise exception 'FAIL: a host read pending registrations';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"someone@example.com"}';
do $$ begin
  begin
    delete from public.pending_band_registrations;
    raise exception 'FAIL: a signed-in person deleted pending registrations';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.pending_band_registrations where email = 'someone@example.com') = 1,
         'pending registrations are untouched by browsers';
end $$;


-- ---------------------------------------------------------------------------
-- Conference weekly hours and phone calls (20261211000000_conference_weekly_hours.sql)
-- ---------------------------------------------------------------------------
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address, created_by)
values ('10000000-0000-0000-0000-0000000000e1', :'org_id', 'Ms. Park Call Hours', 'calls-e1', 'draft', 'conference', 'America/Chicago',
        (now() at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date,
        now(), now() + interval '1 hour', '', '00000000-0000-0000-0000-000000000001');
-- Every day 3 to 4, 15-minute calls, a day off, 24 hours' notice, two weeks ahead.
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, schedule,
                                        weekly_hours, closed_dates, min_notice_hours, max_days_ahead)
values ('10000000-0000-0000-0000-0000000000e1', 15, 0, '[]', now(), 'phone', 'weekly',
        (select jsonb_agg(jsonb_build_object('day', d, 'start', '15:00', 'end', '16:00')) from generate_series(0, 6) d),
        jsonb_build_array(((now() at time zone 'America/Chicago')::date + 3)::text), 24, 14);
do $$
declare
  ok boolean := false;
  today date := (now() at time zone 'America/Chicago')::date;
begin
  -- Weekly hours run between the first and last day.
  update public.events set ends_on = today + 60 where id = '10000000-0000-0000-0000-0000000000e1';
  begin
    update public.conference_settings set schedule = 'one_day' where event_id = '10000000-0000-0000-0000-0000000000e1';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a conference day has to be one day';
  ok := false;
  begin
    update public.conference_settings set weekly_hours = '[{"day": 2, "start": "16:30", "end": "15:30"}]'
     where event_id = '10000000-0000-0000-0000-0000000000e1';
  exception when check_violation then ok := true;
  end;
  assert ok, 'weekly hours have to end after they start';
  ok := false;
  begin
    update public.conference_settings set closed_dates = '["next tuesday"]' where event_id = '10000000-0000-0000-0000-0000000000e1';
  exception when check_violation then ok := true;
  end;
  assert ok, 'days off are dates';
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000e1';
end $$;

set role anon;
do $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  times timestamptz[];
begin
  select array_agg(starts_at) into times from public.conference_open_times('calls-e1');
  assert (select min(t) from unnest(times) t) > now() + interval '24 hours', 'families book at least 24 hours ahead';
  assert (select max((t at time zone 'America/Chicago')::date) from unnest(times) t) <= today + 14, 'and up to two weeks ahead';
  assert not exists (select 1 from unnest(times) t where (t at time zone 'America/Chicago')::date = today + 3), 'not on a day off';
  assert (select count(*) from unnest(times) t where (t at time zone 'America/Chicago')::date = today + 5) = 4,
         'four 15-minute calls each day from 3 to 4';
end $$;
reset role;

set role service_role;
do $$
declare
  day5 timestamptz := (((now() at time zone 'America/Chicago')::date + 5) + time '15:00') at time zone 'America/Chicago';
  ok boolean := false;
  tok uuid;
begin
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000e1', day5, 'Ivy Chen',
      '[{"name": "Lin Chen", "email": "lin@example.com"}]', null, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'phone calls need a number to call';
  tok := public.book_conference('10000000-0000-0000-0000-0000000000e1', day5, 'Ivy Chen',
    '[{"name": "Lin Chen", "email": "lin@example.com"}]', null, null, '(512) 555-0101');
  assert (select meeting_mode = 'phone' and call_phone = '5125550101' from public.conference_bookings where access_token = tok),
         'the family''s number is saved for the teacher to call';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000e1', day5 + interval '15 minutes', 'ivy chen',
      '[{"name": "Lin Chen", "email": "lin@example.com"}]', null, null, '5125550101');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'one upcoming meeting per child';
  -- Once it's past, the family can book again.
  update public.conference_bookings set starts_at = now() - interval '2 days' where access_token = tok;
  perform public.book_conference('10000000-0000-0000-0000-0000000000e1', day5 + interval '15 minutes', 'Ivy Chen',
    '[{"name": "Lin Chen", "email": "lin@example.com"}]', null, null, '5125550101');
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000e1') = 2,
         'with weekly hours, a family books again after their meeting';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000e1', now() + interval '2 hours', 'Max Ruiz',
      '[{"name": "Ana Ruiz", "email": "ana@example.com"}]', null, null, '5125550102');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'not inside the notice';

  -- Children's details go 30 days after each meeting, not after the last day.
  update public.conference_bookings set starts_at = now() - interval '32 days' where access_token = tok;
  assert public.purge_conference_bookings() = 1, 'a weekly meeting is deleted 30 days after it';
  assert (select count(*) from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000e1') = 1,
         'and the upcoming one is kept';
end $$;
reset role;
do $$
declare before timestamptz;
begin
  before := (select starts_at from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000e1');
  update public.events set starts_on = starts_on + 1 where id = '10000000-0000-0000-0000-0000000000e1';
  assert (select starts_at from public.conference_bookings where event_id = '10000000-0000-0000-0000-0000000000e1') = before,
         'weekly meetings stay put when the first day changes';
end $$;
delete from public.events where id = '10000000-0000-0000-0000-0000000000e1';

-- Weekly hours are premium: a free teacher account can't publish them until it has a plan.
set role authenticated;
set request.jwt.claims = '{"sub":"0000000a-0000-0000-0000-000000000001","email":"teacher@example.com"}';
do $$
declare
  org uuid := (select organization_id from public.organization_members where user_id = auth.uid());
  today date := (now() at time zone 'America/Chicago')::date;
  ok boolean := false;
begin
  insert into public.events (id, organization_id, name, slug, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address, created_by)
  values ('10000000-0000-0000-0000-0000000000e2', org, 'Tia Call Hours', 'tia-calls', 'conference', 'America/Chicago',
          today, today, now(), now() + interval '1 hour', '', auth.uid());
  insert into public.conference_settings (event_id, meeting_minutes, times_saved_at, meeting_mode, schedule, weekly_hours)
  values ('10000000-0000-0000-0000-0000000000e2', 15, now(), 'phone', 'weekly', '[{"day": 2, "start": "15:00", "end": "16:00"}]');
  update public.events set ends_on = today + 30 where id = '10000000-0000-0000-0000-0000000000e2';
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000e2';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'weekly hours need a plan';
end $$;
reset role;
update public.organizations set subscription_status = 'comped', free_until = null
 where id = (select organization_id from public.events where id = '10000000-0000-0000-0000-0000000000e2');
set role authenticated;
do $$ begin
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000e2';
  assert (select status = 'published' from public.events where id = '10000000-0000-0000-0000-0000000000e2'),
         'with a plan, weekly hours publish';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000e2';

-- ---------------------------------------------------------------------------
-- Who gets an event's notifications (20261230000000): one row per kind of
-- email, hosts only, and only plain email addresses, at most five.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  insert into public.event_notification_recipients (event_id, kind, member_ids, extra_emails)
  values ('10000000-0000-0000-0000-00000000000a', 'volunteer_digest', array['00000000-0000-0000-0000-000000000001']::uuid[], array['office@school.org']);
  assert (select extra_emails = array['office@school.org'] from public.event_notification_recipients where event_id = '10000000-0000-0000-0000-00000000000a'),
         'a host picks who gets notifications';
  begin
    insert into public.event_notification_recipients (event_id, kind) values ('10000000-0000-0000-0000-00000000000a', 'everything');
    raise exception 'FAIL: an unknown kind of notification was saved';
  exception when check_violation then null;
  end;
  begin
    update public.event_notification_recipients set extra_emails = array['x@y.org>, evil@z.org'] where event_id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: an address with extra recipients was saved';
  exception when check_violation then null;
  end;
  begin
    update public.event_notification_recipients set extra_emails = array['a@x.org','b@x.org','c@x.org','d@x.org','e@x.org','f@x.org']
     where event_id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: more than five other addresses were saved';
  exception when check_violation then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert not exists (select 1 from public.event_notification_recipients), 'a Volunteer Lead can''t see who gets notifications';
  update public.event_notification_recipients set extra_emails = array['vl@example.com'] where event_id = '10000000-0000-0000-0000-00000000000a';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not exists (select 1 from public.event_notification_recipients), 'a stranger can''t see who gets notifications';
  begin
    insert into public.event_notification_recipients (event_id, kind, extra_emails) values ('10000000-0000-0000-0000-00000000000b', 'bookings', array['phish@example.com']);
    raise exception 'FAIL: a stranger added themselves to an event''s notifications';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select extra_emails = array['office@school.org'] from public.event_notification_recipients where event_id = '10000000-0000-0000-0000-00000000000a'),
         'the Volunteer Lead''s change didn''t apply';
end $$;
set role anon;
do $$ begin
  begin
    perform 1 from public.event_notification_recipients;
    raise exception 'FAIL: the public read who gets notifications';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from public.event_notification_recipients;

-- A dropped sign-up is noted for the daily summary; only the server can read the note.
do $$
declare a record;
begin
  select va.id, va.shift_id, v.full_name into a
    from public.volunteer_assignments va join public.volunteers v on v.id = va.volunteer_id limit 1;
  if a.id is null then raise notice 'no sign-up to test the dropped-shift note on'; return; end if;
  begin
    delete from public.volunteer_assignments where id = a.id;
    assert exists (select 1 from public.volunteer_dropped_shifts where shift_id = a.shift_id and full_name = a.full_name),
           'a cancelled sign-up is noted for the daily summary';
    raise exception 'undo the test delete';
  exception when raise_exception then
    if sqlerrm <> 'undo the test delete' then raise; end if;
  end;
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  perform 1 from public.volunteer_dropped_shifts;
  raise exception 'FAIL: a host read the dropped sign-ups table directly';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Event email settings (where replies go): Hosts only, never the public or
-- the event team, and only a plain email address.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  insert into public.event_email_settings (event_id, replies, reply_to)
  values ('10000000-0000-0000-0000-00000000000a', true, 'info@boosters.org');
  assert (select reply_to from public.event_email_settings where event_id = '10000000-0000-0000-0000-00000000000a') = 'info@boosters.org',
         'a host saves where replies go';
  update public.event_email_settings set replies = false where event_id = '10000000-0000-0000-0000-00000000000a';
  assert (select not replies from public.event_email_settings where event_id = '10000000-0000-0000-0000-00000000000a'),
         'a host turns replies off';
  begin
    update public.event_email_settings set reply_to = 'x@y.org>, evil@z.org' where event_id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a reply address with extra recipients was saved';
  exception when check_violation then null;
  end;
end $$;
-- Volunteer Lead, Section Lead and a stranger: can't see or change it.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert not exists (select 1 from public.event_email_settings), 'a Volunteer Lead can''t read where replies go';
  update public.event_email_settings set reply_to = 'vl@example.com' where event_id = '10000000-0000-0000-0000-00000000000a';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert not exists (select 1 from public.event_email_settings), 'a Section Lead can''t read where replies go';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not exists (select 1 from public.event_email_settings), 'a stranger can''t read where replies go';
  begin
    insert into public.event_email_settings (event_id, replies, reply_to)
    values ('10000000-0000-0000-0000-00000000000b', true, 'phish@example.com');
    raise exception 'FAIL: a stranger set where an event''s replies go';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select reply_to from public.event_email_settings where event_id = '10000000-0000-0000-0000-00000000000a') = 'info@boosters.org',
         'the Volunteer Lead''s change didn''t apply';
end $$;
-- Who emails come from: one of the account's hosts, never anyone else.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  update public.event_email_settings set sender_id = '00000000-0000-0000-0000-000000000001'
   where event_id = '10000000-0000-0000-0000-00000000000a';
  assert (select sender_id from public.event_email_settings where event_id = '10000000-0000-0000-0000-00000000000a')
         = '00000000-0000-0000-0000-000000000001', 'a host names themself as who emails come from';
  begin
    -- The Volunteer Lead is on the event's team but isn't one of the account's hosts.
    update public.event_email_settings set sender_id = '00000000-0000-0000-0000-000000000002'
     where event_id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: emails were set to come from someone who isn''t a host';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.event_email_settings;
    raise exception 'FAIL: the public read event email settings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.calendar_entries(array[]::uuid[], false);
    raise exception 'FAIL: the public called calendar_entries';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from public.event_email_settings;

-- ---------------------------------------------------------------------------
-- Several ways to meet: a teacher offers any mix of in person, video and phone;
-- each family picks one the teacher offers, and a phone call needs a number.
-- ---------------------------------------------------------------------------
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address, created_by)
values ('10000000-0000-0000-0000-0000000000f1', :'org_id', 'Ms. Ito Conferences', 'conf-f1', 'published', 'conference', 'America/Chicago',
        current_date + 3, current_date + 3,
        ((current_date + 3) + time '15:00') at time zone 'America/Chicago',
        ((current_date + 3) + time '16:00') at time zone 'America/Chicago', '1 School Rd', '00000000-0000-0000-0000-000000000001');
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_modes, room)
values ('10000000-0000-0000-0000-0000000000f1', 15, 0, '[]', now(), array['in_person', 'phone'], 'Room 9');
do $$
declare
  d    date := current_date + 3;
  s1   timestamptz := (d + time '15:00') at time zone 'America/Chicago';
  s2   timestamptz := (d + time '15:15') at time zone 'America/Chicago';
  s3   timestamptz := (d + time '15:30') at time zone 'America/Chicago';
  t_in uuid;
  t_ph uuid;
  fam  jsonb := '[{"name": "Lee Ito", "email": "lee@example.com"}]';
  ok   boolean;
begin
  assert (select meeting_mode from public.conference_settings where event_id = '10000000-0000-0000-0000-0000000000f1') = 'in_person',
         'the old single column follows the list';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000f1', s1, 'Kai Ito', fam, 'video', null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a family can''t pick a way the teacher doesn''t offer';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000f1', s1, 'Kai Ito', fam, null, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'with several ways, the family has to pick one';
  ok := false;
  begin
    perform public.book_conference('10000000-0000-0000-0000-0000000000f1', s1, 'Kai Ito', fam, 'phone', null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a phone call needs a number to call';
  t_ph := public.book_conference('10000000-0000-0000-0000-0000000000f1', s1, 'Kai Ito', fam, 'phone', null, '(512) 555-0199');
  assert (select meeting_mode = 'phone' and call_phone = '5125550199' from public.conference_bookings where access_token = t_ph),
         'a family books a phone call';
  t_in := public.book_conference('10000000-0000-0000-0000-0000000000f1', s2, 'Mia Ito', fam, 'in_person', null, '5125550199');
  assert (select meeting_mode = 'in_person' and call_phone is null from public.conference_bookings where access_token = t_in),
         'an in-person meeting keeps no number to call';
  ok := false;
  begin
    perform public.change_conference_booking(t_in, s3, 'phone');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'switching to a phone call needs a number';
  perform public.change_conference_booking(t_in, s3, 'phone', '512-555-0123');
  assert (select meeting_mode = 'phone' and call_phone = '5125550123' and starts_at = s3
            from public.conference_bookings where access_token = t_in),
         'a family switches to a phone call';
  perform public.change_conference_booking(t_ph, s2, 'in_person');
  assert (select meeting_mode = 'in_person' and call_phone is null from public.conference_bookings where access_token = t_ph),
         'switching away from a call drops the number';
  ok := false;
  begin
    update public.conference_settings set meeting_modes = array['fax'] where event_id = '10000000-0000-0000-0000-0000000000f1';
  exception when check_violation then ok := true;
  end;
  assert ok, 'only in person, video and phone';
  ok := false;
  begin
    update public.conference_settings set meeting_modes = array['video', 'video'] where event_id = '10000000-0000-0000-0000-0000000000f1';
  exception when check_violation then ok := true;
  end;
  assert ok, 'each way once';
  ok := false;
  begin
    update public.conference_settings set meeting_modes = array[]::text[] where event_id = '10000000-0000-0000-0000-0000000000f1';
  exception when check_violation then ok := true;
  end;
  assert ok, 'at least one way';
  -- The app from before this update still sets the old column.
  update public.conference_settings set meeting_mode = 'either' where event_id = '10000000-0000-0000-0000-0000000000f1';
  assert (select meeting_modes = array['in_person', 'video'] from public.conference_settings where event_id = '10000000-0000-0000-0000-0000000000f1'),
         'the list follows the old single column';
end $$;
-- Publishing checks every way offered: adding video needs its link.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  update public.conference_settings set meeting_modes = array['in_person', 'phone'] where event_id = '10000000-0000-0000-0000-0000000000f1';
  assert public.conference_not_ready('10000000-0000-0000-0000-0000000000f1') is null, 'in person and phone with a room is ready';
  update public.conference_settings set meeting_modes = array['phone', 'video'] where event_id = '10000000-0000-0000-0000-0000000000f1';
  assert public.conference_not_ready('10000000-0000-0000-0000-0000000000f1') = 'Add your meeting link first.',
         'adding video needs a meeting link';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000f1';

-- Tables get no access automatically (Supabase from October 30, 2026), so a
-- migration that creates one must grant it: the server's key needs every table.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not has_table_privilege('service_role', c.oid, 'select, insert, update, delete');
  if missing is not null then
    raise exception 'FAIL: grant select, insert, update, delete to service_role on: %', missing;
  end if;
  -- The live database still has today's access; this keeps the tests honest about it.
  assert has_table_privilege('anon', 'public.events', 'select'), 'published events stay readable by visitors';
  assert not has_table_privilege('anon', 'public.events', 'insert'), 'visitors still can''t write';
  assert not has_table_privilege('authenticated', 'public.event_email_settings', 'insert'),
         'reply settings stay limited to their own columns';
end $$;

-- The QA outbox: only the server (its own key) reads or writes it.
do $$ begin
  assert not has_table_privilege('anon', 'public.qa_outbox', 'select'), 'visitors can''t read the QA outbox';
  assert not has_table_privilege('authenticated', 'public.qa_outbox', 'select'), 'signed-in people can''t read the QA outbox';
  assert not has_table_privilege('authenticated', 'public.qa_outbox', 'insert'), 'signed-in people can''t write to the QA outbox';
  assert has_table_privilege('service_role', 'public.qa_outbox', 'insert'), 'the server saves QA emails';
  -- QA comments and replies: the same.
  assert not has_table_privilege('anon', 'public.qa_comments', 'select'), 'visitors can''t read QA comments';
  assert not has_table_privilege('authenticated', 'public.qa_comments', 'select'), 'signed-in people can''t read QA comments';
  assert not has_table_privilege('authenticated', 'public.qa_comment_replies', 'insert'), 'signed-in people can''t write QA replies';
  assert has_table_privilege('service_role', 'public.qa_comment_replies', 'insert'), 'the server saves QA replies';
  -- Site visit counts: the same, and only the server can add to them.
  assert not has_table_privilege('anon', 'public.site_metrics', 'select'), 'visitors can''t read site visit counts';
  assert not has_table_privilege('anon', 'public.site_metrics', 'insert'), 'visitors can''t write site visit counts';
  assert not has_table_privilege('authenticated', 'public.site_metrics', 'select'), 'signed-in people can''t read site visit counts';
  assert not has_function_privilege('anon', 'public.bump_site_metric(date, text, text, text, text)', 'execute'), 'visitors can''t add to the counts directly';
  assert not has_function_privilege('authenticated', 'public.bump_site_metric(date, text, text, text, text)', 'execute'), 'signed-in people can''t add to the counts directly';
  assert has_function_privilege('service_role', 'public.bump_site_metric(date, text, text, text, text)', 'execute'), 'the server adds to the counts';
end $$;
-- Counting twice adds up, in one row; a click's label keeps it apart.
select public.bump_site_metric('2026-10-24', '/', 'Google', 'view');
select public.bump_site_metric('2026-10-24', '/', 'Google', 'view');
select public.bump_site_metric('2026-10-24', '/', 'Google', 'click', 'Header: FAQ');
do $$ begin
  assert (select count from public.site_metrics where day = '2026-10-24' and path = '/' and source = 'Google' and event = 'view') = 2,
         'two visits make a count of two';
  assert (select count from public.site_metrics where day = '2026-10-24' and event = 'click' and label = 'Header: FAQ') = 1,
         'a click is counted under its label';
  begin
    perform public.bump_site_metric('2026-10-24', '/', 'Google', 'hovered');
    raise exception 'FAIL: an unknown kind of count was saved';
  exception when check_violation then null;
  end;
end $$;
delete from public.site_metrics where day = '2026-10-24';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  begin
    perform 1 from public.qa_outbox;
    raise exception 'FAIL: a signed-in person read the QA outbox';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.qa_comments;
    raise exception 'FAIL: a signed-in person read QA comments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.bump_site_metric('2026-10-24', '/', 'Google', 'view');
    raise exception 'FAIL: a signed-in person added to the site visit counts';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Conferences that don't ask for the child's name: none is kept, and a family
-- books one meeting per first parent's email
-- ---------------------------------------------------------------------------
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address, ask_child_name)
values ('1c000000-0000-0000-0000-000000000001', :'org_id', 'No-Name Conferences', 'conf-no-child', 'published', 'conference', 'America/Chicago',
        current_date + 3, current_date + 3,
        ((current_date + 3) + time '09:00') at time zone 'America/Chicago',
        ((current_date + 3) + time '10:00') at time zone 'America/Chicago', '1 School Rd', false);
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, room)
values ('1c000000-0000-0000-0000-000000000001', 20, 0, '[]', now(), 'in_person', 'Room 5');
do $$
declare
  d  date := current_date + 3;
  s1 timestamptz := (d + time '09:00') at time zone 'America/Chicago';
  s2 timestamptz := (d + time '09:20') at time zone 'America/Chicago';
  t1 uuid;
  ok boolean := false;
begin
  t1 := public.book_conference('1c000000-0000-0000-0000-000000000001', s1, 'Should Not Keep',
          '[{"name": "Dana Reyes", "email": "Dana@Example.com"}]', null, null);
  assert (select child_name is null from public.conference_bookings where access_token = t1),
         'no child''s name is kept when the teacher doesn''t ask for it';
  begin
    perform public.book_conference('1c000000-0000-0000-0000-000000000001', s2, null, '[{"name": "Dana R", "email": "dana@example.com"}]', null, null);
  exception when sqlstate 'P0001' then ok := sqlerrm like '%already have a meeting%';
  end;
  assert ok, 'one meeting per first parent''s email';
  perform public.book_conference('1c000000-0000-0000-0000-000000000001', s2, null, '[{"name": "Lee Park", "email": "lee@example.com"}]', null, null);
  -- Asking again: the child's name is required.
  update public.events set ask_child_name = true where id = '1c000000-0000-0000-0000-000000000001';
  ok := false;
  begin
    perform public.book_conference('1c000000-0000-0000-0000-000000000001', s1 + interval '40 minutes', null, '[{"name": "Mo Li", "email": "mo@example.com"}]', null, null);
  exception when sqlstate 'P0001' then ok := sqlerrm like '%child%';
  end;
  assert ok, 'with the question on, the child''s name is required';
end $$;
delete from public.events where id = '1c000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Each event can switch the account's logo and color off (on by default)
-- ---------------------------------------------------------------------------
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
values ('1b000000-0000-0000-0000-000000000001', :'org_id', 'Brand Switch', 'brand-switch', 'draft', 'volunteer', 'America/Chicago',
        current_date + 3, current_date + 3, now() + interval '3 days', now() + interval '3 days 2 hours', '1 Main St');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set show_brand = false where id = '1b000000-0000-0000-0000-000000000001';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
update public.events set show_brand = true where id = '1b000000-0000-0000-0000-000000000001';
reset role;
do $$
begin
  assert (select not show_brand from public.events where id = '1b000000-0000-0000-0000-000000000001'),
         'a host switches the logo off for one event, and a stranger can''t switch it back';
  assert (select show_brand from public.events where id = '10000000-0000-0000-0000-00000000000a'), 'events show it by default';
end $$;
delete from public.events where id = '1b000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Volunteer history: shifts signed up and checked in per adult, per account;
-- hosts and Volunteer Leads read it; kept when volunteers are deleted;
-- hosts remove people; forgotten 2 years after their last event
-- ---------------------------------------------------------------------------
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
values
  ('1d000000-0000-0000-0000-000000000001', :'org_id', 'Spring Car Wash', 'vh-past', 'published', 'volunteer', 'America/Chicago',
   current_date - 20, current_date - 20, now() - interval '20 days', now() - interval '20 days' + interval '4 hours', '1 Main St'),
  ('1d000000-0000-0000-0000-000000000002', :'org_id', 'Fall Fair', 'vh-next', 'published', 'volunteer', 'America/Chicago',
   current_date + 20, current_date + 20, now() + interval '20 days', now() + interval '20 days 4 hours', '1 Main St');
insert into public.stations (id, event_id, name, station_type) values
  ('1d000000-0000-0000-0000-0000000000a1', '1d000000-0000-0000-0000-000000000001', 'Wash', 'passive'),
  ('1d000000-0000-0000-0000-0000000000a2', '1d000000-0000-0000-0000-000000000002', 'Tickets', 'passive');
insert into public.shifts (id, station_id, event_id, title, starts_at, ends_at, max_capacity) values
  ('1d000000-0000-0000-0000-0000000000b1', '1d000000-0000-0000-0000-0000000000a1', '1d000000-0000-0000-0000-000000000001', 'Morning',
   now() - interval '20 days', now() - interval '20 days' + interval '2 hours', 10),
  ('1d000000-0000-0000-0000-0000000000b2', '1d000000-0000-0000-0000-0000000000a1', '1d000000-0000-0000-0000-000000000001', 'Afternoon',
   now() - interval '20 days' + interval '2 hours', now() - interval '20 days' + interval '4 hours', 10),
  ('1d000000-0000-0000-0000-0000000000b3', '1d000000-0000-0000-0000-0000000000a2', '1d000000-0000-0000-0000-000000000002', 'Evening',
   now() + interval '20 days', now() + interval '20 days 2 hours', 10);
insert into public.volunteers (id, event_id, full_name, email, phone, minor) values
  ('1d000000-0000-0000-0000-0000000000c1', '1d000000-0000-0000-0000-000000000001', 'Ann Able', 'ann@example.com', '+15125550001', false),
  ('1d000000-0000-0000-0000-0000000000c2', '1d000000-0000-0000-0000-000000000001', 'Bob Bell', 'bob@example.com', '+15125550002', false),
  ('1d000000-0000-0000-0000-0000000000c3', '1d000000-0000-0000-0000-000000000001', 'Kid A.', 'kid@example.com', '+15125550003', true),
  ('1d000000-0000-0000-0000-0000000000c4', '1d000000-0000-0000-0000-000000000002', 'Ann Able', 'ann@example.com', '+15125550001', false);
insert into public.volunteer_assignments (shift_id, volunteer_id, checked_in_at) values
  ('1d000000-0000-0000-0000-0000000000b1', '1d000000-0000-0000-0000-0000000000c1', now() - interval '20 days'),
  ('1d000000-0000-0000-0000-0000000000b2', '1d000000-0000-0000-0000-0000000000c1', null),
  ('1d000000-0000-0000-0000-0000000000b1', '1d000000-0000-0000-0000-0000000000c2', now() - interval '20 days'),
  ('1d000000-0000-0000-0000-0000000000b1', '1d000000-0000-0000-0000-0000000000c3', now() - interval '20 days'),
  ('1d000000-0000-0000-0000-0000000000b3', '1d000000-0000-0000-0000-0000000000c4', null);
insert into public.event_staff (event_id, user_id, role) values
  ('1d000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'volunteer_director');
-- An old volunteer, last seen over 2 years ago.
insert into public.volunteer_history (organization_id, email, event_id, event_name, event_on, full_name, signed_up, checked_in)
values (:'org_id', 'vh-old@example.com', gen_random_uuid(), 'Old Fair', current_date - interval '3 years', 'Old Timer', 2, 2);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare org uuid := (select organization_id from public.events where id = '1d000000-0000-0000-0000-000000000001');
begin
  assert (select signed_up = 2 and checked_in = 1 and events = 1 from public.volunteer_report(org) where email = 'ann@example.com'),
         'a host sees Ann: 2 ended shifts signed up, 1 checked in (her upcoming shift doesn''t count yet)';
  assert (select signed_up = 1 and checked_in = 1 from public.volunteer_report(org) where email = 'bob@example.com'), 'and Bob';
  assert not exists (select 1 from public.volunteer_report(org) where email = 'kid@example.com'), 'under-18 helpers are left out';
end $$;
do $$
declare ok boolean := false;
begin
  begin
    perform 1 from public.volunteer_history;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'hosts can''t read the history table directly';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$
declare org uuid := (select organization_id from public.events where id = '1d000000-0000-0000-0000-000000000002');
        ok boolean := false;
begin
  assert (select count(*) from public.volunteer_report(org)) >= 2, 'a Volunteer Lead on one of the account''s events sees the history';
  begin
    perform public.remove_volunteer_history(org, 'ann@example.com');
  exception when sqlstate '42501' then ok := true;
  end;
  assert ok, 'but only hosts remove people';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform 1 from public.volunteer_report((select organization_id from public.organization_members where user_id = '00000000-0000-0000-0000-000000000001' limit 1));
  exception when sqlstate '42501' then ok := true;
  end;
  assert ok, 'strangers can''t see an account''s volunteer history';
end $$;

-- The daily clean-up keeps the counts, deletes the volunteers, and forgets old history.
reset role;
select public.purge_volunteers();
do $$
begin
  assert not exists (select 1 from public.volunteers where event_id = '1d000000-0000-0000-0000-000000000001'), 'volunteers are still deleted';
  assert (select signed_up = 2 and checked_in = 1 and event_name = 'Spring Car Wash'
            from public.volunteer_history where email = 'ann@example.com'), 'Ann''s counts are kept';
  assert not exists (select 1 from public.volunteer_history where email = 'kid@example.com'), 'under-18 helpers aren''t kept';
  assert not exists (select 1 from public.volunteer_history where email = 'vh-old@example.com'), 'history over 2 years old is forgotten';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare org uuid := (select organization_id from public.events where id = '1d000000-0000-0000-0000-000000000001');
begin
  assert (select signed_up = 2 and checked_in = 1 from public.volunteer_report(org) where email = 'ann@example.com'),
         'the report reads the same after the clean-up';
  perform public.remove_volunteer_history(org, 'Ann@Example.com');
  assert not exists (select 1 from public.volunteer_report(org) where email = 'ann@example.com'), 'a host removes Ann';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.volunteer_history where email = 'ann@example.com'), 'her history is deleted';
end $$;
delete from public.events where id in ('1d000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000002');
delete from public.volunteer_history where email = 'bob@example.com';
-- Without volunteer tracking in the package, nothing is kept: volunteers are simply deleted.
select set_config('app.package_change', 'on', false);
update public.organizations set package = 'schedule' where id = :'org_id';
select set_config('app.package_change', '', false);
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
values ('1d000000-0000-0000-0000-000000000003', :'org_id', 'Bake Sale', 'vh-nopkg', 'published', 'volunteer', 'America/Chicago',
        current_date - 20, current_date - 20, now() - interval '20 days', now() - interval '20 days' + interval '4 hours', '1 Main St');
insert into public.stations (id, event_id, name, station_type) values
  ('1d000000-0000-0000-0000-0000000000a3', '1d000000-0000-0000-0000-000000000003', 'Table', 'passive');
insert into public.shifts (id, station_id, event_id, title, starts_at, ends_at, max_capacity) values
  ('1d000000-0000-0000-0000-0000000000b4', '1d000000-0000-0000-0000-0000000000a3', '1d000000-0000-0000-0000-000000000003', 'Morning',
   now() - interval '20 days', now() - interval '20 days' + interval '2 hours', 10);
insert into public.volunteers (id, event_id, full_name, email, phone, minor) values
  ('1d000000-0000-0000-0000-0000000000c5', '1d000000-0000-0000-0000-000000000003', 'Cal Cook', 'cal@example.com', '+15125550005', false);
insert into public.volunteer_assignments (shift_id, volunteer_id, checked_in_at) values
  ('1d000000-0000-0000-0000-0000000000b4', '1d000000-0000-0000-0000-0000000000c5', now() - interval '20 days');
select public.purge_volunteers();
do $$
begin
  assert not exists (select 1 from public.volunteers where event_id = '1d000000-0000-0000-0000-000000000003'), 'the volunteer is deleted';
  assert not exists (select 1 from public.volunteer_history where email = 'cal@example.com'),
         'and without volunteer tracking in the package, no history is kept';
end $$;
delete from public.events where id = '1d000000-0000-0000-0000-000000000003';
select set_config('app.package_change', 'on', false);
update public.organizations set package = 'event' where id = :'org_id';
select set_config('app.package_change', '', false);
delete from public.volunteer_history_removed where email = 'ann@example.com';

-- ---------------------------------------------------------------------------
-- Meetings: booked like conferences, with no child; one per main contact
-- ---------------------------------------------------------------------------
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, timezone, starts_on, ends_on, window_start, window_end, venue_address)
values ('1e000000-0000-0000-0000-000000000001', :'org_id', 'Advising Meetings', 'meet-1e', 'published', 'meeting', 'America/Chicago',
        current_date + 3, current_date + 3,
        ((current_date + 3) + time '09:00') at time zone 'America/Chicago',
        ((current_date + 3) + time '10:00') at time zone 'America/Chicago', '1 Office Rd');
insert into public.conference_settings (event_id, meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, room)
values ('1e000000-0000-0000-0000-000000000001', 20, 0, '[]', now(), 'in_person', 'Suite 2');
do $$
declare
  d  date := current_date + 3;
  s1 timestamptz := (d + time '09:00') at time zone 'America/Chicago';
  s2 timestamptz := (d + time '09:20') at time zone 'America/Chicago';
  t1 uuid;
  ok boolean := false;
begin
  t1 := public.book_conference('1e000000-0000-0000-0000-000000000001', s1, null,
          '[{"name": "Dana Reyes", "email": "Dana@Example.com"}, {"name": "Lee Reyes", "email": "lee@example.com"}]', null, 'Planning');
  assert (select child_name is null and parents -> 0 ->> 'email' = 'dana@example.com' from public.conference_bookings where access_token = t1),
         'a meeting is booked with no child, the main contact first';
  begin
    perform public.book_conference('1e000000-0000-0000-0000-000000000001', s2, null, '[{"name": "Dana R", "email": "dana@example.com"}]', null, null);
  exception when sqlstate 'P0001' then ok := sqlerrm like '%already have a meeting%';
  end;
  assert ok, 'one meeting per main contact';
  perform public.book_conference('1e000000-0000-0000-0000-000000000001', s2, null, '[{"name": "Lee Reyes", "email": "lee@example.com"}]', null, null);
  assert (select count(*) from public.conference_bookings where event_id = '1e000000-0000-0000-0000-000000000001') = 2,
         'someone else can book their own meeting';
  assert not exists (select 1 from public.conference_open_times('meet-1e') t where t in (s1, s2)), 'booked times aren''t offered';
  -- A meeting never keeps a child's name, even if one is sent.
  delete from public.conference_bookings where event_id = '1e000000-0000-0000-0000-000000000001' and parents -> 0 ->> 'email' = 'lee@example.com';
  t1 := public.book_conference('1e000000-0000-0000-0000-000000000001', s2, 'Some Kid', '[{"name": "Lee Reyes", "email": "lee@example.com"}]', null, null);
  assert (select child_name is null from public.conference_bookings where access_token = t1), 'a meeting never keeps a child''s name';
  ok := false;
  begin
    perform public.book_conference('1e000000-0000-0000-0000-000000000001', s1 + interval '40 minutes', null, '[]', null, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a meeting needs someone to book it';
  ok := false;
  begin
    update public.events set event_type = 'conference' where id = '1e000000-0000-0000-0000-000000000001';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a meeting can''t become a conference';
  insert into public.pilot_requests (name, email, organization, event_types)
  values ('Mo Meet', 'mo@example.com', 'Mo Advising', array['meeting']);
  delete from public.pilot_requests where email = 'mo@example.com';
end $$;
-- Meetings need a plan to publish (no free one like a teacher's conference).
update public.events set status = 'draft' where id = '1e000000-0000-0000-0000-000000000001';
create temp table meet_plan as select subscription_status, free_until from public.organizations where id = :'org_id';
update public.organizations set subscription_status = 'none', free_until = null where id = :'org_id';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    update public.events set status = 'published' where id = '1e000000-0000-0000-0000-000000000001';
  exception when sqlstate '42501' then ok := sqlerrm like '%plan isn''t active%';
  end;
  assert ok, 'publishing meetings needs a plan';
end $$;
reset role;
update public.organizations set subscription_status = 'comped', free_until = date '2099-01-01' where id = :'org_id';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
update public.events set status = 'published' where id = '1e000000-0000-0000-0000-000000000001';
reset role;
do $$ begin
  assert (select status = 'published' from public.events where id = '1e000000-0000-0000-0000-000000000001'), 'with a plan, meetings publish';
end $$;
update public.organizations o set subscription_status = m.subscription_status, free_until = m.free_until
  from meet_plan m where o.id = :'org_id';
drop table meet_plan;
-- Demo mode: sample people book meetings, with no child.
delete from public.conference_bookings where event_id = '1e000000-0000-0000-0000-000000000001';
insert into public.demo_events (owner_id, event_id) values ('00000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001');
set role service_role;
do $$
begin
  perform public.demo_seed('00000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', null);
  assert (select count(*) from public.conference_bookings where event_id = '1e000000-0000-0000-0000-000000000001') > 0, 'sample meetings are booked';
  assert not exists (select 1 from public.conference_bookings where event_id = '1e000000-0000-0000-0000-000000000001' and child_name is not null),
         'sample meetings have no child';
  assert not exists (select 1 from public.volunteers where event_id = '1e000000-0000-0000-0000-000000000001'), 'meetings get no volunteers';
  perform public.demo_leave('00000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001');
end $$;
reset role;
delete from public.events where id = '1e000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Packages and event passes (20261223000000_packages.sql)
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000000b-0000-0000-0000-000000000001', 'pkhost@example.com', '{"full_name":"Pat Package"}'),
  ('0000000b-0000-0000-0000-000000000002', 'pkco@example.com', '{"full_name":"Cora Cohost"}'),
  ('0000000b-0000-0000-0000-000000000003', 'pkthird@example.com', '{"full_name":"Theo Third"}');
insert into public.organizations (id, name, slug, subscription_status, free_until)
values ('70000000-0000-0000-0000-000000000001', 'Package PTA', 'package-pta', 'comped', date '2099-01-01');
insert into public.organization_members (organization_id, user_id, role)
values ('70000000-0000-0000-0000-000000000001', '0000000b-0000-0000-0000-000000000001', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
do $$ begin
  assert (select package from public.organizations where id = '70000000-0000-0000-0000-000000000001') = 'event',
         'accounts start on Event Command';
  assert not exists (select 1 from public.organizations where account_kind = 'teacher' and package <> 'free_teacher'),
         'free teacher accounts are on Free Teacher';
  assert (select price_cents from public.plan_tiers where code = 'pass_band_contest') = 15000, 'pass prices are in plan_tiers';
end $$;

-- Only an admin, or a payment (the service role), changes a package.
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.plan_tiers) >= 10, 'hosts can read the packages';
  begin
    perform public.set_account_package('70000000-0000-0000-0000-000000000001', 'district', 'standard', null, 'admin');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t change their own package';
  ok := false;
  begin
    perform public.add_event_pass('70000000-0000-0000-0000-000000000001', 'fair', null, 'payment', 0);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t give themselves a pass';
  ok := false;
  begin
    update public.plan_tiers set max_team = 99 where code = 'schedule';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'hosts can''t change package limits';
  ok := false;
  begin
    insert into public.event_passes (organization_id, event_type, price_cents, source)
    values ('70000000-0000-0000-0000-000000000001', 'fair', 0, 'admin');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'hosts can''t write passes directly';
end $$;
reset role;
do $$
declare ok boolean := false;
begin
  begin
    update public.organizations set package = 'district' where id = '70000000-0000-0000-0000-000000000001';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'even the server changes packages only through set_account_package()';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_account_package('70000000-0000-0000-0000-000000000001', 'schedule', 'standard', null, 'payment');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'an admin can''t claim to be a payment';
  perform public.set_account_package('70000000-0000-0000-0000-000000000001', 'schedule', 'standard', 'Chose Schedule Command', 'admin');
end $$;
reset role;
do $$ begin
  assert (select package from public.organizations where id = '70000000-0000-0000-0000-000000000001') = 'schedule', 'an admin sets the package';
  assert exists (select 1 from public.admin_log where organization_id = '70000000-0000-0000-0000-000000000001'
                   and action = 'package_changed' and details ->> 'source' = 'admin'
                   and details -> 'to' ->> 'package' = 'schedule'), 'the change is logged as made by an admin';
end $$;

-- Schedule Command: one published volunteer event at a time, no band contests.
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare
  ok boolean := false;
  msg text;
begin
  insert into public.events (id, organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address)
  values ('70000000-0000-0000-0000-0000000000e1', '70000000-0000-0000-0000-000000000001', 'Fall Fun Run', 'pk-run', 'volunteer',
          current_date + 9, current_date + 9, now() + interval '9 days', now() + interval '9 days 3 hours', '1 Track Rd'),
         ('70000000-0000-0000-0000-0000000000e2', '70000000-0000-0000-0000-000000000001', 'Book Fair', 'pk-books', 'volunteer',
          current_date + 19, current_date + 19, now() + interval '19 days', now() + interval '19 days 3 hours', '1 Library Ln');
  -- A volunteer event publishes with a job volunteers can see.
  insert into public.stations (id, event_id, name) values
    ('70000000-0000-0000-0000-0000000000f1', '70000000-0000-0000-0000-0000000000e1', 'Water table'),
    ('70000000-0000-0000-0000-0000000000f2', '70000000-0000-0000-0000-0000000000e2', 'Book sorting');
  insert into public.shifts (station_id, title, starts_at, ends_at, max_capacity) values
    ('70000000-0000-0000-0000-0000000000f1', 'Morning', now() + interval '9 days', now() + interval '9 days 2 hours', 4),
    ('70000000-0000-0000-0000-0000000000f2', 'Morning', now() + interval '19 days', now() + interval '19 days 2 hours', 4);
  update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e1';
  assert public.org_can_publish('70000000-0000-0000-0000-0000000000e2') like
         'Your Schedule Command plan publishes one volunteer event at a time%Volunteer Command.',
         'org_can_publish says why, in plain words';
  begin
    update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e2';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%You can publish this one after Fall Fun Run ends, or upgrade to Volunteer Command.',
         'one published volunteer event at a time, and the message never suggests unpublishing';
  update public.events set name = 'Fall Fun Run 5K' where id = '70000000-0000-0000-0000-0000000000e1';
  -- Any type can be a draft (a "try it" event); publishing it needs a plan or a pass.
  insert into public.events (id, organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address)
  values ('70000000-0000-0000-0000-0000000000e4', '70000000-0000-0000-0000-000000000001', 'Try a Contest', 'pk-band-try', 'band_contest',
          current_date + 9, current_date + 9, now() + interval '9 days', now() + interval '9 days 3 hours', '1 Field Rd');
  assert public.event_trial('70000000-0000-0000-0000-0000000000e4'), 'a band contest is a try-it event on Schedule Command';
  assert not public.event_trial('70000000-0000-0000-0000-0000000000e2'), 'a volunteer event isn''t';
  ok := false;
  begin
    update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e4';
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%doesn''t include band contests. Add a band contest pass or upgrade to Event Command.',
         'Schedule Command can''t publish band contests without a pass';
  -- A published event can't switch to a type the plan doesn't include.
  ok := false;
  begin
    update public.events set event_type = 'fair' where id = '70000000-0000-0000-0000-0000000000e1';
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%doesn''t include school fairs%', 'a published event can''t change to a type outside the plan';
  -- A draft can.
  update public.events set event_type = 'fair' where id = '70000000-0000-0000-0000-0000000000e2';
  update public.events set event_type = 'volunteer' where id = '70000000-0000-0000-0000-0000000000e2';
end $$;
-- Strangers don't learn whether an event is a try-it event.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not public.event_trial('70000000-0000-0000-0000-0000000000e4'), 'only the event''s team sees whether it''s a try-it event';
end $$;
-- Try-it events can't invite directors from outside the account, even from the server.
reset role;
do $$
declare
  ok boolean := false;
  msg text;
begin
  begin
    insert into public.band_invitations (event_id, email) values ('70000000-0000-0000-0000-0000000000e4', 'dir@example.com');
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%this event can''t send invitations yet%', 'a try-it event can''t send band invitations';
end $$;
-- Only events that haven't ended count toward "one at a time".
update public.events set starts_on = current_date - 3, ends_on = current_date - 3,
       window_start = now() - interval '3 days', window_end = now() - interval '3 days' + interval '3 hours'
 where id = '70000000-0000-0000-0000-0000000000e1';
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$ begin
  assert public.org_can_publish('70000000-0000-0000-0000-0000000000e2') is null, 'a finished event doesn''t block the next one';
  update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e2';
  update public.events set status = 'draft' where id = '70000000-0000-0000-0000-0000000000e2';
end $$;
reset role;
update public.events set starts_on = current_date + 9, ends_on = current_date + 9,
       window_start = now() + interval '9 days', window_end = now() + interval '9 days 3 hours'
 where id = '70000000-0000-0000-0000-0000000000e1';
-- "Hasn't ended" is in the event's own time zone: an event that ends today
-- where it happens still counts, even when it's already tomorrow in UTC.
update public.events set timezone = 'Pacific/Kiritimati',
       starts_on = (now() at time zone 'Pacific/Kiritimati')::date, ends_on = (now() at time zone 'Pacific/Kiritimati')::date
 where id = '70000000-0000-0000-0000-0000000000e1';
do $$ begin
  assert public.org_publish_reason('70000000-0000-0000-0000-000000000001', 'volunteer', '70000000-0000-0000-0000-0000000000e2') like '%at a time%',
         'an event ending today in its own time zone still counts';
end $$;
update public.events set ends_on = (now() at time zone 'Pacific/Kiritimati')::date - 1, starts_on = (now() at time zone 'Pacific/Kiritimati')::date - 1
 where id = '70000000-0000-0000-0000-0000000000e1';
do $$ begin
  assert public.org_publish_reason('70000000-0000-0000-0000-000000000001', 'volunteer', '70000000-0000-0000-0000-0000000000e2') is null,
         'one that ended yesterday in its own time zone doesn''t';
  assert coalesce((public.account_plan('70000000-0000-0000-0000-000000000001') -> 'published' ->> 'volunteer')::int, 0) = 0,
         'the plan summary doesn''t count a finished event as published';
end $$;
update public.events set timezone = 'America/Chicago', starts_on = current_date + 9, ends_on = current_date + 9
 where id = '70000000-0000-0000-0000-0000000000e1';
-- Event emails from a try-it event go only to the account's own people.
do $$ begin
  assert public.event_email_blocked('70000000-0000-0000-0000-0000000000e4', array['pkhost@example.com', 'Parent@Example.com'])
         = array['Parent@Example.com'], 'a try-it event emails nobody outside the account';
  assert public.event_email_blocked('70000000-0000-0000-0000-0000000000e2', array['parent@example.com']) = '{}'::text[],
         'other events email as usual';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.event_email_blocked('70000000-0000-0000-0000-0000000000e4', array['x@example.com']);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only the server asks which emails are held back';
  assert (select name from public.account_host('70000000-0000-0000-0000-000000000001')) is not null, 'the account''s hosts see who the Account Host is';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","email":"outsider@example.com"}';
do $$ begin
  assert not exists (select 1 from public.account_host('70000000-0000-0000-0000-000000000001')), 'nobody else does';
end $$;
-- After the plan lapses: only conferences publish, published events stay up and
-- aren't try-it events.
reset role;
update public.organizations set free_until = current_date - 10 where id = '70000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  begin
    update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e2';
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%isn''t active right now, so you can publish parent-teacher conferences only%', 'a lapsed plan publishes conferences only';
  assert (select status from public.events where id = '70000000-0000-0000-0000-0000000000e1') = 'published', 'published events stay up';
  assert not public.event_trial('70000000-0000-0000-0000-0000000000e1'), 'and a published event is never a try-it event';
  -- Unpublishing it now means it can't be published again until the plan comes back.
  assert public.org_can_publish('70000000-0000-0000-0000-0000000000e1') like '%isn''t active right now%',
         'the app can warn before unpublishing that it can''t be republished';
  update public.events set status = 'draft' where id = '70000000-0000-0000-0000-0000000000e1';
  ok := false;
  begin
    update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e1';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'an unpublished event can''t be republished while the plan is lapsed';
end $$;
reset role;
update public.organizations set free_until = date '2099-01-01' where id = '70000000-0000-0000-0000-000000000001';
update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e1';
-- Someone on the try-it event's own team isn't outside the account (event staff
-- normally needs a bigger plan, so this row skips the triggers).
set session_replication_role = replica;
insert into public.event_staff (event_id, user_id, role)
values ('70000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000003', 'volunteer_director');
set session_replication_role = origin;
select set_config('pk.staff_email', (select email from public.profiles where id = '00000000-0000-0000-0000-000000000003'), false);
do $$ begin
  assert public.event_email_blocked('70000000-0000-0000-0000-0000000000e4', array[current_setting('pk.staff_email')]) = '{}'::text[],
         'a try-it event can email its own team';
end $$;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000003', 'email', current_setting('pk.staff_email'))::text, false);
do $$ begin
  assert public.event_trial('70000000-0000-0000-0000-0000000000e4'), 'its Volunteer Lead sees that it''s a try-it event';
end $$;
reset role;
delete from public.event_staff where event_id = '70000000-0000-0000-0000-0000000000e4';

-- A pass publishes one band contest, once.
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select set_config('pk.pass', public.add_event_pass('70000000-0000-0000-0000-000000000001', 'band_contest', 'Spring contest', 'admin')::text, false);
reset role;
set role service_role;
select public.add_event_pass('70000000-0000-0000-0000-000000000001', 'fair', null, 'payment') as pk_fair_pass \gset
reset role;
update public.event_passes set expires_at = now() - interval '1 day' where id = :'pk_fair_pass';
do $$ begin
  assert (select pass_total_cents from public.organizations where id = '70000000-0000-0000-0000-000000000001') = 25000,
         'pass purchases add up toward Event Command';
  assert exists (select 1 from public.admin_log where action = 'pass_added' and details ->> 'source' = 'payment'), 'a paid pass is logged as a payment';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.event_passes where organization_id = '70000000-0000-0000-0000-000000000001') = 2,
         'hosts see their own passes';
  insert into public.events (id, organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address, band_registration_deadline)
  values ('70000000-0000-0000-0000-0000000000e3', '70000000-0000-0000-0000-000000000001', 'Marching Contest', 'pk-band', 'band_contest',
          current_date + 9, current_date + 9, now() + interval '9 days', now() + interval '9 days 3 hours', '1 Field Rd', current_date + 5);
  update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e3';
  assert (select event_id from public.event_passes where id = current_setting('pk.pass')::uuid) = '70000000-0000-0000-0000-0000000000e3',
         'publishing uses the pass';
  update public.events set status = 'draft' where id = '70000000-0000-0000-0000-0000000000e3';
  update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e3';
  insert into public.events (id, organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address, band_registration_deadline)
  values ('70000000-0000-0000-0000-0000000000e5', '70000000-0000-0000-0000-000000000001', 'Second Contest', 'pk-band2', 'band_contest',
          current_date + 9, current_date + 9, now() + interval '9 days', now() + interval '9 days 3 hours', '1 Field Rd', current_date + 5),
         ('70000000-0000-0000-0000-0000000000e6', '70000000-0000-0000-0000-000000000001', 'Fall Fair', 'pk-fair', 'fair',
          current_date + 9, current_date + 9, now() + interval '9 days', now() + interval '9 days 3 hours', '1 Fair Rd', null);
  begin
    update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e5';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a pass is for one event';
  ok := false;
  begin
    update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e6';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'an expired pass can''t be used';
  assert public.event_trial('70000000-0000-0000-0000-0000000000e3') is false, 'an event with its own pass isn''t a try-it event';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.event_passes where event_id is not null and organization_id = '70000000-0000-0000-0000-000000000001') = 1,
         'republishing the same event doesn''t use another pass';
end $$;
-- A published event that used a pass can't change kind (one pass per event).
set role service_role;
select public.add_event_pass('70000000-0000-0000-0000-000000000001', 'fair', null, 'payment') as pk_fair_pass2 \gset
reset role;
do $$
declare ok boolean := false; msg text;
begin
  begin
    update public.events set event_type = 'fair' where id = '70000000-0000-0000-0000-0000000000e3';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%published with a band contest pass%', 'a published event with a pass keeps its kind';
end $$;
select set_config('pk.fair2', :'pk_fair_pass2', false);
do $$ begin
  assert (select event_id from public.event_passes where id = current_setting('pk.fair2')::uuid) is null, 'and the other pass stays unused';
end $$;

-- Team: Schedule Command is a host and a co-host, with no Volunteer Leads or Section Leads.
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare
  ok boolean := false;
  msg text;
begin
  insert into public.invitations (event_id, email, as_host, invited_by)
  values ('70000000-0000-0000-0000-0000000000e1', 'pkco@example.com', true, '0000000b-0000-0000-0000-000000000001');
  begin
    insert into public.invitations (event_id, email, role, invited_by)
    values ('70000000-0000-0000-0000-0000000000e1', 'pkthird@example.com', 'volunteer_director', '0000000b-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%doesn''t include Volunteer Leads or Coordinators%', 'Schedule Command has no Volunteer Leads';
end $$;
reset role;
insert into public.organization_members (organization_id, user_id, role)
values ('70000000-0000-0000-0000-000000000001', '0000000b-0000-0000-0000-000000000002', 'admin');
-- A Co-host sees who the Account Host is (to ask about a plan).
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000002","email":"pkco@example.com"}';
do $$ begin
  assert (select user_id from public.account_host('70000000-0000-0000-0000-000000000001')) = '0000000b-0000-0000-0000-000000000001'
     and (select email from public.account_host('70000000-0000-0000-0000-000000000001')) is not null,
         'a Co-host sees the Account Host''s name and email';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare
  ok boolean := false;
  msg text;
begin
  begin
    insert into public.invitations (event_id, email, as_host, invited_by)
    values ('70000000-0000-0000-0000-0000000000e1', 'pkthird@example.com', true, '0000000b-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%Your team is full: your Schedule Command plan includes 2 team spots%', 'a full team can''t invite more';
end $$;
reset role;
do $$
declare ok boolean := false;
begin
  begin
    insert into public.organization_members (organization_id, user_id, role)
    values ('70000000-0000-0000-0000-000000000001', '0000000b-0000-0000-0000-000000000003', 'admin');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'team limits hold however someone is added';
end $$;

-- Volunteer Command: a team of up to 5, Volunteer Leads, and volunteer history.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.set_account_package('70000000-0000-0000-0000-000000000001', 'volunteer', 'standard', null, 'admin');
reset role;
insert into public.event_staff (event_id, user_id, role)
values ('70000000-0000-0000-0000-0000000000e1', '0000000b-0000-0000-0000-000000000003', 'volunteer_director');
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$ begin
  update public.events set status = 'published' where id = '70000000-0000-0000-0000-0000000000e2';
  assert (select (public.account_plan('70000000-0000-0000-0000-000000000001') ->> 'team')::int) = 3, 'the team counts each person once';
  perform public.volunteer_report('70000000-0000-0000-0000-000000000001');
end $$;
-- Downgrading keeps everyone, and published events stay up and editable.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.set_account_package('70000000-0000-0000-0000-000000000001', 'schedule', 'standard', 'Downgraded', 'admin');
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.events where organization_id = '70000000-0000-0000-0000-000000000001' and status = 'published') = 3,
         'a downgrade leaves published events up';
  update public.events set name = 'Book Fair 2' where id = '70000000-0000-0000-0000-0000000000e2';
  begin
    perform public.volunteer_report('70000000-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'with no history from before, a downgraded account sees the preview, not volunteer tracking';
  assert not (public.account_plan('70000000-0000-0000-0000-000000000001') ->> 'volunteer_tracking')::boolean, 'the plan says it''s a preview';
end $$;
reset role;
-- With history it built up on Volunteer Command, a downgraded account keeps seeing its tracking.
insert into public.volunteer_history (organization_id, email, event_id, event_name, event_on, full_name, signed_up, checked_in)
values ('70000000-0000-0000-0000-000000000001', 'pkvol@example.com', gen_random_uuid(), 'Spring Fair', date '2026-04-01', 'Pat Vol', 2, 2);
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000001","email":"pkhost@example.com"}';
do $$ begin
  assert (select count(*) from public.volunteer_report('70000000-0000-0000-0000-000000000001')) = 1, 'a downgraded account with history keeps its tracking';
  assert (public.account_plan('70000000-0000-0000-0000-000000000001') ->> 'volunteer_tracking')::boolean, 'and the plan says so';
end $$;
-- Hosts can't mark an account as having had tracking.
do $$
declare ok boolean := false;
begin
  begin
    update public.organizations set had_volunteer_tracking = true where id = '70000000-0000-0000-0000-000000000001';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'had_volunteer_tracking changes only with the package';
end $$;
reset role;
-- An account that never had tracking sees the preview, even with history recorded.
insert into public.organizations (id, name, slug, account_kind) values ('70000000-0000-0000-0000-000000000002', 'Pkg Teacher', 'pkg-teacher', 'teacher');
insert into public.organization_members (organization_id, user_id, role)
values ('70000000-0000-0000-0000-000000000002', '0000000b-0000-0000-0000-000000000002', 'owner');
insert into public.volunteer_history (organization_id, email, event_id, event_name, event_on, full_name, signed_up, checked_in)
values ('70000000-0000-0000-0000-000000000002', 'pkvol@example.com', gen_random_uuid(), 'Book Fair', date '2026-04-01', 'Pat Vol', 1, 1);
set role authenticated;
set request.jwt.claims = '{"sub":"0000000b-0000-0000-0000-000000000002","email":"pkco@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.volunteer_report('70000000-0000-0000-0000-000000000002');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'an account that never had volunteer tracking sees the preview';
  ok := false;
  begin
    perform public.volunteer_history_export('70000000-0000-0000-0000-000000000002');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'and can''t download its history either';
end $$;
reset role;
delete from public.organizations where id = '70000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select count(*) from public.org_team('70000000-0000-0000-0000-000000000001')) = 3, 'nobody is removed on a downgrade';
end $$;
-- Someone outside the account can't read its passes or plan.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  assert not exists (select 1 from public.event_passes where organization_id = '70000000-0000-0000-0000-000000000001'), 'passes are private';
  assert public.org_can_publish('70000000-0000-0000-0000-0000000000e2') = 'That event wasn''t found.', 'publishing reasons are private';
  begin
    perform public.account_plan('70000000-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'an account''s plan is private';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Package and pilot length chosen on a host invitation (20261224000000_invitation_plan.sql)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000000c-0000-0000-0000-000000000001', 'chosen@example.com', '{"full_name":"Cho Chosen"}'),
  ('0000000c-0000-0000-0000-000000000002', 'plain@example.com', '{"full_name":"Pla Plain"}'),
  ('0000000c-0000-0000-0000-000000000003', 'teachchoice@example.com', '{"full_name":"Tea Choice"}');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  perform public.admin_invite_host('chosen@example.com', null, 'volunteer', 'trialing', date '2027-03-01');
  -- Inviting again with nothing chosen keeps the earlier choices.
  perform public.admin_invite_host('chosen@example.com');
  assert (select package = 'volunteer' and plan_status = 'trialing' and free_until = date '2027-03-01'
            from public.host_invitations where email = 'chosen@example.com'), 're-inviting keeps earlier choices';
  -- Changed before it's used.
  perform public.admin_set_invitation_plan('chosen@example.com', 'schedule', 'comped', date '2027-02-01');
  perform public.admin_invite_host('plain@example.com');
  perform public.admin_invite_host('teachchoice@example.com', null, 'free', 'comped', date '2027-02-15');
  begin
    perform public.admin_invite_host('nope@example.com', null, 'pass_fair', null, null);
    raise exception 'FAIL: an invitation took a pass as its package';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.admin_invite_host('nope@example.com', null, 'event', 'active', date '2027-01-01');
    raise exception 'FAIL: an invitation took a paid plan';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- The chosen package and plan carry over when they set up.
set request.jwt.claims = '{"sub":"0000000c-0000-0000-0000-000000000001","email":"chosen@example.com"}';
do $$
declare
  org public.organizations;
begin
  begin
    perform public.admin_set_invitation_plan('chosen@example.com', 'district', 'comped', date '2099-01-01');
    raise exception 'FAIL: an invited person changed their own invitation';
  exception when insufficient_privilege then null;
  end;
  org := public.create_organization('Chosen Boosters', 'chosen-boosters');
  assert org.package = 'schedule' and org.subscription_status = 'comped' and org.free_until = date '2027-02-01',
         'the invitation''s package and plan carry over to the organization';
end $$;
-- A host can't set their own package, plan, or free-through date.
do $$
declare ok boolean;
begin
  ok := false;
  begin
    update public.organizations set package = 'event' where slug = 'chosen-boosters';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t change their own package';
  ok := false;
  begin
    update public.organizations set subscription_status = 'active', free_until = date '2099-01-01' where slug = 'chosen-boosters';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t change their own plan or free-through date';
  ok := false;
  begin
    perform public.set_account_package((select id from public.organizations where slug = 'chosen-boosters'), 'event', 'standard', null, 'admin');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t call set_account_package';
  ok := false;
  begin
    perform public.admin_set_plan((select id from public.organizations where slug = 'chosen-boosters'), 'comped', date '2099-01-01', null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t call admin_set_plan';
  ok := false;
  begin
    perform public.apply_package((select id from public.organizations where slug = 'chosen-boosters'), 'event', 'standard', null, 'admin', null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t call the shared package steps directly';
end $$;

-- No choices: exactly as before (Event Command, free pilot through Jan 1, 2027).
set request.jwt.claims = '{"sub":"0000000c-0000-0000-0000-000000000002","email":"plain@example.com"}';
do $$
declare
  org public.organizations;
begin
  org := public.create_organization('Plain Boosters', 'plain-boosters');
  assert org.package = 'event' and org.subscription_status = 'comped' and org.free_until = date '2027-01-01',
         'an invitation with no package behaves as before';
end $$;

-- A free teacher account picks up its invitation's plan too.
set request.jwt.claims = '{"sub":"0000000c-0000-0000-0000-000000000003","email":"teachchoice@example.com"}';
do $$
declare
  org public.organizations;
begin
  org := public.create_teacher_account('Tea Choice', 'Choice Elementary', 'America/Chicago');
  assert org.package = 'free' and org.subscription_status = 'comped' and org.free_until = date '2027-02-15',
         'a teacher account gets its invitation''s plan';
end $$;

-- Logged as the admin who invited them, and the used invitation can't be changed.
reset role;
do $$ begin
  assert exists (select 1 from public.admin_log l join public.organizations o on o.id = l.organization_id
                  where o.slug = 'chosen-boosters' and l.action = 'plan_changed'
                    and l.details ->> 'note' = 'Set from host invitation'
                    and l.admin_id = '00000000-0000-0000-0000-000000000006'), 'the plan from the invitation is logged';
  assert exists (select 1 from public.admin_log l join public.organizations o on o.id = l.organization_id
                  where o.slug = 'chosen-boosters' and l.action = 'package_changed'
                    and l.details ->> 'note' = 'Set from host invitation'), 'and the package';
  assert not exists (select 1 from public.admin_log l join public.organizations o on o.id = l.organization_id
                      where o.slug = 'plain-boosters' and l.details ->> 'note' = 'Set from host invitation'),
         'nothing is logged when nothing was chosen';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    perform public.admin_set_invitation_plan('chosen@example.com', 'event', 'comped', date '2027-01-01');
    raise exception 'FAIL: changed a used invitation';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
reset role;
delete from public.organizations where slug in ('chosen-boosters', 'plain-boosters')
   or id in (select organization_id from public.organization_members where user_id = '0000000c-0000-0000-0000-000000000003');
delete from public.host_invitations where email in ('chosen@example.com', 'plain@example.com', 'teachchoice@example.com');

-- ---------------------------------------------------------------------------
-- Invite a host from the panel (20261225000000_invite_host_panel.sql)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000000d-0000-0000-0000-000000000001', 'panelhost@example.com', '{"full_name":"Nia Panel"}'),
  ('0000000d-0000-0000-0000-000000000002', 'noorg@example.com', '{"full_name":"Noel Noorg"}');
insert into public.pilot_requests (id, name, email, organization, status)
values ('0000000d-0000-0000-0000-0000000000a1', 'Asa Asked', 'asked@example.com', 'Asked PTA', 'new');
set role authenticated;
set request.jwt.claims = '{"sub":"0000000d-0000-0000-0000-000000000001","email":"panelhost@example.com"}';
do $$ begin
  perform public.admin_send_host_invitation('panelhost@example.com', 'Nia Panel', null, null, 'event', 'comped', date '2027-02-01');
  raise exception 'FAIL: a non-admin sent a host invitation';
exception when insufficient_privilege then null;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare
  first uuid;
  again uuid;
  asked uuid;
begin
  first := public.admin_send_host_invitation(' PanelHost@Example.com ', 'Nia Panel', null, '+15125550100', 'volunteer', 'comped', date '2027-02-01');
  assert (select status = 'invited' and organization = 'Nia Panel' and phone = '+15125550100' and email = 'panelhost@example.com'
            from public.pilot_requests where id = first), 'the panel adds a card under Invited';
  assert (select package = 'volunteer' and plan_status = 'comped' and free_until = date '2027-02-01' and pilot_request_id = first
            from public.host_invitations where email = 'panelhost@example.com'), 'with the package and free period on the invitation';
  again := public.admin_send_host_invitation('panelhost@example.com', 'Nia Panel', 'Panel PTA', null, 'schedule', 'trialing', date '2027-03-01');
  assert again = first, 'inviting again uses the same card';
  assert (select organization = 'Panel PTA' and phone = '+15125550100' from public.pilot_requests where id = first),
         'and updates it, keeping what wasn''t changed';
  asked := public.admin_send_host_invitation('asked@example.com', 'Asa Asked', null, null, 'event', 'comped', date '2027-01-15');
  assert asked = '0000000d-0000-0000-0000-0000000000a1', 'someone who asked to join keeps their card';
  assert (select status = 'invited' and organization = 'Asked PTA' from public.pilot_requests where id = asked), 'and it moves to Invited';
  perform public.admin_send_host_invitation('noorg@example.com', 'Noel Noorg', '', '', 'event', 'comped', date '2027-01-15');
  begin
    perform public.admin_send_host_invitation('nopkg@example.com', 'No Package', null, null, null, null, null);
    raise exception 'FAIL: invited without a package';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.admin_send_host_invitation('noname@example.com', ' ', null, null, 'event', 'comped', date '2027-01-15');
    raise exception 'FAIL: invited without a name';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
-- Setting up moves the card on, and a card with only their name gets the organization's.
set request.jwt.claims = '{"sub":"0000000d-0000-0000-0000-000000000001","email":"panelhost@example.com"}';
select 1 from public.create_organization('Panel Boosters', 'panel-boosters');
set request.jwt.claims = '{"sub":"0000000d-0000-0000-0000-000000000002","email":"noorg@example.com"}';
select 1 from public.create_organization('Noorg Boosters', 'noorg-boosters');
reset role;
do $$ begin
  assert (select status = 'set_up' and organization = 'Panel PTA' and organization_id is not null
            from public.pilot_requests where email = 'panelhost@example.com'), 'the card moves to Set up and keeps the name given';
  assert (select organization = 'Noorg Boosters' from public.pilot_requests where email = 'noorg@example.com'),
         'a card without an organization shows the one they set up';
  assert (select package = 'schedule' and subscription_status = 'trialing' from public.organizations where slug = 'panel-boosters'),
         'and they start on the package and plan from the panel';
end $$;
delete from public.organizations where slug in ('panel-boosters', 'noorg-boosters');
delete from public.host_invitations where email in ('panelhost@example.com', 'noorg@example.com', 'asked@example.com');
delete from public.pilot_requests where email in ('panelhost@example.com', 'noorg@example.com', 'asked@example.com');

-- ---------------------------------------------------------------------------
-- Save and invite later (20261226000000_host_leads.sql)
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000000e-0000-0000-0000-000000000001', 'savedlead@example.com', '{"full_name":"Lee Lead"}');
set role authenticated;
set request.jwt.claims = '{"sub":"0000000e-0000-0000-0000-000000000001","email":"savedlead@example.com"}';
do $$ begin
  perform public.admin_save_host_lead('savedlead@example.com', 'Lee Lead', null, null, 'event', 'comped', date '2027-01-15', null);
  raise exception 'FAIL: a non-admin saved a lead';
exception when insufficient_privilege then null;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare
  first uuid;
  again uuid;
begin
  first := public.admin_save_host_lead('SavedLead@Example.com', 'Lee Lead', null, '+15125550123', 'volunteer', 'trialing', date '2027-02-01', null);
  assert (select status = 'new' and organization = 'Lee Lead' and planned_package = 'volunteer' and planned_status = 'trialing'
            and planned_free_until = date '2027-02-01' from public.pilot_requests where id = first), 'a lead lands under Lead with the choices saved';
  assert not exists (select 1 from public.host_invitations where email = 'savedlead@example.com'), 'and nobody is invited';
  again := public.admin_save_host_lead('savedlead@example.com', 'Lee Lead', 'Lead PTA', null, 'schedule', 'comped', date '2027-03-01', null);
  assert again = first, 'saving again updates the same card';
  assert (select organization = 'Lead PTA' and planned_package = 'schedule' and phone = '+15125550123' from public.pilot_requests where id = first),
         'with the new choices';
  begin
    perform public.admin_save_host_lead('savedlead@example.com', 'Lee Lead', null, null, 'pass_fair', null, null, null);
    raise exception 'FAIL: saved a pass as a package';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
-- Until they're invited, a lead can't set up an account.
set request.jwt.claims = '{"sub":"0000000e-0000-0000-0000-000000000001","email":"savedlead@example.com"}';
do $$ begin
  perform public.create_organization('Lead Boosters', 'lead-boosters');
  raise exception 'FAIL: a lead set up an account without an invitation';
exception when insufficient_privilege then null;
end $$;
-- Inviting them later moves the same card to Invited.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert public.admin_send_host_invitation('savedlead@example.com', 'Lee Lead', null, null, 'schedule', 'comped', date '2027-03-01')
         = (select id from public.pilot_requests where email = 'savedlead@example.com'), 'inviting a lead uses their card';
  assert (select status = 'invited' from public.pilot_requests where email = 'savedlead@example.com'), 'and moves it to Invited';
end $$;
reset role;
delete from public.host_invitations where email = 'savedlead@example.com';
delete from public.pilot_requests where email = 'savedlead@example.com';

-- ---------------------------------------------------------------------------
-- Editable system emails (20261227000000_system_emails.sql)
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_save_system_email('team_invite_cohost', 'Hi', 'Hello', 'Body', null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t change a system email';
  ok := false;
  begin
    insert into public.system_email_overrides (key, subject, heading, body) values ('team_invite_cohost', 'x', 'x', 'x');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'nor write the table directly';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  perform public.admin_save_system_email('team_invite_cohost', ' Join {{organization}} ', 'Co-host with us', 'Hello {{name}}', ' ');
  assert (select subject = 'Join {{organization}}' and button_label is null from public.system_email_overrides where key = 'team_invite_cohost'),
         'an admin saves a system email (trimmed; a blank button keeps the built-in one)';
  perform public.admin_save_system_email('team_invite_cohost', 'Join us', 'Co-host with us', 'Hello', 'Accept');
  assert (select subject = 'Join us' and button_label = 'Accept' from public.system_email_overrides where key = 'team_invite_cohost'),
         'saving again updates it';
  assert exists (select 1 from public.admin_log where action = 'system_email_changed'), 'and it''s logged';
  begin
    perform public.admin_save_system_email('Bad Key!', 'x', 'x', 'x', null);
    raise exception 'FAIL: saved a bad key';
  exception when check_violation then null;
  end;
  perform public.admin_reset_system_email('team_invite_cohost');
  assert not exists (select 1 from public.system_email_overrides where key = 'team_invite_cohost'), 'resetting goes back to the built-in wording';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_reset_system_email('team_invite_cohost');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t reset a system email';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- One-tap host invitations and video passcodes (20261229000000_one_tap_host_invites_and_passcode.sql)
-- ---------------------------------------------------------------------------
insert into public.host_invitations (email, email_token, sent_at) values ('onetap@example.com', gen_random_uuid(), now());
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.host_invitations where email = 'onetap@example.com') = 1, 'an admin still reads host invitations';
  begin
    perform email_token from public.host_invitations where email = 'onetap@example.com';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'but not the secret sign-in key from the invitation email';
end $$;
reset role;
delete from public.host_invitations where email = 'onetap@example.com';
do $$
declare ok boolean := false;
begin
  assert has_column_privilege('authenticated', 'public.conference_settings', 'video_passcode', 'UPDATE'), 'hosts can save a meeting passcode';
  assert not has_column_privilege('anon', 'public.conference_settings', 'video_passcode', 'SELECT'), 'the public can''t read it';
  begin
    insert into public.conference_settings (event_id, video_passcode)
    select id, repeat('x', 51) from public.events where event_type in ('conference', 'meeting') limit 1;
    if not found then ok := true; raise notice 'no conference left to test the passcode length on'; end if;
  exception when check_violation then ok := true;
  end;
  assert ok, 'a passcode is at most 50 characters';
end $$;

-- ---------------------------------------------------------------------------
-- Items to bring (20261231000000): sections without times, sign-ups that
-- can't overfill, a public board of first names and notes only.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
insert into public.stations (id, event_id, name, signup_kind) values
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Potluck', 'items');
insert into public.station_items (id, station_id, event_id, name, needed) values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Desserts', 1),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Drinks', 3);
do $$ begin
  begin
    insert into public.station_items (station_id, event_id, name, needed)
    values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Chips', 2);
    raise exception 'FAIL: an item went in a section of time slots';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update public.station_items set claimed_count = 0;
    raise exception 'FAIL: a host set how many are claimed by hand';
  exception when insufficient_privilege then null;
  end;
end $$;
-- A station switches between time slots and items only while it's empty;
-- shifts never go in an items station.
insert into public.stations (id, event_id, name) values
  ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-00000000000a', 'Bake Sale');
update public.stations set signup_kind = 'items' where id = '20000000-0000-0000-0000-0000000000f2';
update public.stations set signup_kind = 'shifts' where id = '20000000-0000-0000-0000-0000000000f2';
do $$ begin
  assert (select signup_kind from public.stations where id = '20000000-0000-0000-0000-0000000000f2') = 'shifts',
    'an empty station switches kinds both ways';
  begin
    update public.stations set signup_kind = 'shifts' where id = '20000000-0000-0000-0000-0000000000f1';
    raise exception 'FAIL: a station with items switched to time slots';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update public.stations set signup_kind = 'items' where id = '20000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a station with shifts switched to items';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.shifts (station_id, title, starts_at, ends_at, max_capacity)
    values ('20000000-0000-0000-0000-0000000000f1', 'Sneaky', now() + interval '10 days', now() + interval '10 days 1 hour', 2);
    raise exception 'FAIL: a shift went in an items station';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
delete from public.stations where id = '20000000-0000-0000-0000-0000000000f2';
-- A stranger can't add items to someone else's event.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    insert into public.station_items (station_id, event_id, name, needed)
    values ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Spam', 9);
    raise exception 'FAIL: a stranger added an item';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role service_role;
do $$
declare v uuid;
begin
  v := public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Pat Potluck', 'pat.potluck@example.com', '+15125550170',
         array[]::uuid[], false, '[]', '[{"item": "70000000-0000-0000-0000-000000000001", "note": "Brownies"}]');
  assert (select claimed_count from public.station_items where id = '70000000-0000-0000-0000-000000000001') = 1,
         'signing up for an item claims one';
  begin
    perform public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Late Lou', 'lou@example.com', '+15125550171',
            array[]::uuid[], false, '[]', '[{"item": "70000000-0000-0000-0000-000000000002"}, {"item": "70000000-0000-0000-0000-000000000001"}]');
    raise exception 'FAIL: overfilled an item';
  exception when sqlstate 'P0002' then null;
  end;
  assert (select claimed_count from public.station_items where id = '70000000-0000-0000-0000-000000000002') = 0,
         'a failed item sign-up claims nothing';
  assert not exists (select 1 from public.volunteers where email = 'lou@example.com'), 'and leaves no volunteer behind';
  begin
    perform public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Nobody', 'nobody@example.com', '+15125550172',
            array[]::uuid[], false, '[]', '[]');
    raise exception 'FAIL: signed up for nothing';
  exception when sqlstate 'P0001' then null;
  end;
  -- Cancelling with the item's own link frees it again and is noted for the daily summary.
  assert public.cancel_item_with_pass(
           (select id from public.item_signups where volunteer_id = v), '{}',
           array[(select manage_token from public.item_signups where volunteer_id = v)]),
         'a volunteer cancels an item with their link';
  assert (select claimed_count from public.station_items where id = '70000000-0000-0000-0000-000000000001') = 0, 'which frees it';
  assert exists (select 1 from public.volunteer_dropped_shifts where item_id = '70000000-0000-0000-0000-000000000001'),
         'and is noted for the daily summary';
  perform public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Pat Potluck', 'pat.potluck@example.com', '+15125550170',
          array[]::uuid[], false, '[]', '[{"item": "70000000-0000-0000-0000-000000000001", "note": "Brownies"}]');
end $$;
reset role;

-- Shifts and items together: Judy can't take two overlapping shifts, but she
-- can bring her brownies and help set up at 5:30 in the same sign-up.
set role service_role;
do $$
declare
  day timestamptz := date_trunc('day', now() + interval '12 days');
  judy uuid;
begin
  insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
    ('3e1d0000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Setup 5:00', day + interval '17 hours', day + interval '18 hours', 5),
    ('3e1d0000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Setup 5:30', day + interval '17 hours 30 minutes', day + interval '18 hours 30 minutes', 5);
  insert into public.station_items (id, station_id, event_id, name, needed) values
    ('7e1d0000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Desserts', 4);

  begin
    perform public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Judy Baker', 'judy@example.com', '+15125550180',
            array['3e1d0000-0000-0000-0000-000000000001', '3e1d0000-0000-0000-0000-000000000002']::uuid[], false, '[]',
            '[{"item": "7e1d0000-0000-0000-0000-000000000003", "note": "Famous brownies"}]');
    raise exception 'FAIL: signed up for two overlapping shifts';
  exception when sqlstate 'P0003' then null;
  end;
  assert not exists (select 1 from public.volunteers where email = 'judy@example.com'), 'an overlap saves nothing, items included';
  assert (select claimed_count from public.station_items where id = '7e1d0000-0000-0000-0000-000000000003') = 0, 'the brownies are not claimed';

  judy := public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Judy Baker', 'judy@example.com', '+15125550180',
            array['3e1d0000-0000-0000-0000-000000000002']::uuid[], false, '[]',
            '[{"item": "7e1d0000-0000-0000-0000-000000000003", "note": "Famous brownies"}]');
  assert (select count(*) from public.volunteer_assignments where volunteer_id = judy) = 1, 'Judy has the 5:30 setup shift';
  assert (select note from public.item_signups where volunteer_id = judy) = 'Famous brownies', 'and is bringing her brownies';

  -- Coming back later for the 5:00 shift still overlaps her 5:30 one.
  begin
    perform public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Judy Baker', 'judy@example.com', '+15125550180',
            array['3e1d0000-0000-0000-0000-000000000001']::uuid[], false, '[]', '[]');
    raise exception 'FAIL: added an overlapping shift on a second visit';
  exception when sqlstate 'P0003' then null;
  end;

  -- And she can bring as many things as she likes: 14 more in one go.
  insert into public.station_items (station_id, event_id, name, needed)
  select '20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Extra ' || n, 2
    from generate_series(1, 14) n;
  perform public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'Judy Baker', 'judy@example.com', '+15125550180',
          array[]::uuid[], false, '[]',
          (select jsonb_agg(jsonb_build_object('item', id)) from public.station_items where name like 'Extra %'));
  assert (select count(*) from public.item_signups where volunteer_id = judy) = 15, 'Judy is bringing 15 things';

  delete from public.volunteers where id = judy;
  delete from public.station_items where name like 'Extra %';
  delete from public.shifts where id in ('3e1d0000-0000-0000-0000-000000000001', '3e1d0000-0000-0000-0000-000000000002');
  delete from public.station_items where id = '7e1d0000-0000-0000-0000-000000000003';
end $$;
reset role;

-- A volunteer under 18 bringing something: the public board shows what, never their name.
insert into public.volunteers (id, event_id, full_name, email, phone, minor)
values ('7e1d0000-0000-0000-0000-0000000000f9', '10000000-0000-0000-0000-00000000000a', 'Kit Y.', 'kit@example.com', '+15125550188', true);
insert into public.station_items (id, station_id, event_id, name, needed)
select '7e1d0000-0000-0000-0000-0000000000f8', station_id, event_id, 'Cookies for the bake table', 5
  from public.station_items where event_id = '10000000-0000-0000-0000-00000000000a' limit 1;
insert into public.item_signups (item_id, event_id, volunteer_id, note)
values ('7e1d0000-0000-0000-0000-0000000000f8', '10000000-0000-0000-0000-00000000000a', '7e1d0000-0000-0000-0000-0000000000f9', 'Cookies');
set role anon;
do $$ begin
  assert (select first_name is null from public.public_item_board('10000000-0000-0000-0000-00000000000a') where note = 'Cookies'),
         'the public never sees the name of a volunteer under 18 on the bring list';
  assert not exists (select 1 from public.public_item_board('10000000-0000-0000-0000-00000000000a') where first_name in ('Kit', 'Kit Y.')),
         'not even their first name';
end $$;
reset role;
delete from public.volunteers where id = '7e1d0000-0000-0000-0000-0000000000f9';
delete from public.station_items where id = '7e1d0000-0000-0000-0000-0000000000f8';

-- The board shows first names and notes, never emails or phones; not for drafts.
set role anon;
do $$ begin
  assert (select first_name = 'Pat' and note = 'Brownies' from public.public_item_board('10000000-0000-0000-0000-00000000000a') limit 1),
         'the public sees who is bringing what by first name';
  begin
    perform 1 from public.item_signups;
    raise exception 'FAIL: the public read item sign-ups directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sign_up_volunteer('10000000-0000-0000-0000-00000000000a', 'X', 'x@example.com', '1', array[]::uuid[], false, '[]', '[]');
    raise exception 'FAIL: the public called sign_up_volunteer directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- The Volunteer Lead sees the sign-ups; a stranger doesn't.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select count(*) from public.item_signups where event_id = '10000000-0000-0000-0000-00000000000a') = 1,
         'a Volunteer Lead sees who is bringing what';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not exists (select 1 from public.item_signups), 'a stranger can''t see item sign-ups';
end $$;
-- The volunteer, signed in with their email, sees and cancels their own.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f9","email":"pat.potluck@example.com"}';
do $$ begin
  assert (select count(*) from public.my_items()) = 1, 'a volunteer sees their own items';
  assert public.cancel_my_item((select signup_id from public.my_items() limit 1)), 'and cancels one';
end $$;
reset role;
delete from public.stations where id = '20000000-0000-0000-0000-0000000000f1';
delete from public.volunteers where email = 'pat.potluck@example.com';
delete from public.volunteer_dropped_shifts where item_id is not null;

-- ---------------------------------------------------------------------------
-- Group sign-ups (20270102000000): each person on their own shifts, adults-only
-- shifts and minimum ages, capacity counting everyone, the guardian's
-- permanent confirmation, switching shifts, and summary choices.
-- ---------------------------------------------------------------------------
set role service_role;
do $$
declare
  day     timestamptz := date_trunc('day', now() + interval '14 days');
  consent text := 'I confirm I am this volunteer''s parent or legal guardian, or have their permission to sign them up.';
  r       jsonb;
  judy    uuid;
  maya    uuid;
  bob     uuid;
  tickets uuid := '9a000000-0000-0000-0000-000000000004';
begin
  insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity, adults_only, min_age) values
    ('9a000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Chairs', day + interval '17 hours', day + interval '18 hours', 3, false, null),
    ('9a000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Concessions', day + interval '18 hours', day + interval '20 hours', 1, false, null),
    ('9a000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'Parking', day + interval '15 hours', day + interval '16 hours', 5, true, null),
    ('9a000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a', 'Tickets', day + interval '20 hours', day + interval '21 hours', 5, false, 16);

  -- Who can take which shift.
  assert public.shift_ineligible('9a000000-0000-0000-0000-000000000003', false, null) is null, 'adults can take adults-only shifts';
  assert public.shift_ineligible('9a000000-0000-0000-0000-000000000003', true, 17) = 'Adults only', 'minors can''t take adults-only shifts';
  assert public.shift_ineligible(tickets, true, 15) = 'Ages 16 and up', 'a 15-year-old is too young for a 16-and-up shift';
  assert public.shift_ineligible(tickets, true, 16) is null, 'a 16-year-old can take it';
  assert public.shift_ineligible(tickets, true, null) = 'Ages 16 and up', 'a minor with no age can''t take a shift with a minimum age';
  assert public.shift_ineligible(tickets, false, null) is null, 'an adult can take a shift with a minimum age';
  assert public.shift_ineligible('9a000000-0000-0000-0000-000000000001', true, 10) is null, 'anyone can take an open shift';

  -- A minor in the group needs the guardian's confirmation; nothing is saved without it.
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'Judy Ortiz', 'judy.o@example.com', '+15125550190',
      array['9a000000-0000-0000-0000-000000000001']::uuid[], false, null, '[]',
      '[{"name": "Maya Ortiz", "minor": true, "age": 15, "shift_ids": ["9a000000-0000-0000-0000-000000000001"]}]', null);
    raise exception 'FAIL: signed up a minor without the guardian''s confirmation';
  exception when sqlstate 'P0006' then null;
  end;
  assert not exists (select 1 from public.volunteers where email = 'judy.o@example.com'), 'no confirmation saves nothing';

  -- A 15-year-old can't be put on a 16-and-up shift, or an adults-only one.
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'Judy Ortiz', 'judy.o@example.com', '+15125550190',
      array['9a000000-0000-0000-0000-000000000001']::uuid[], false, null, '[]',
      '[{"name": "Maya Ortiz", "minor": true, "age": 15, "shift_ids": ["9a000000-0000-0000-0000-000000000004"]}]', consent);
    raise exception 'FAIL: a 15-year-old took a 16-and-up shift';
  exception when sqlstate 'P0005' then null;
  end;
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'Judy Ortiz', 'judy.o@example.com', '+15125550190',
      array['9a000000-0000-0000-0000-000000000001']::uuid[], false, null, '[]',
      '[{"name": "Maya Ortiz", "minor": true, "age": 17, "shift_ids": ["9a000000-0000-0000-0000-000000000003"]}]', consent);
    raise exception 'FAIL: a minor took an adults-only shift';
  exception when sqlstate 'P0005' then null;
  end;
  assert not exists (select 1 from public.volunteers where email = 'judy.o@example.com'), 'a refused person saves no one in the group';
  assert (select registered_count from public.shifts where id = '9a000000-0000-0000-0000-000000000001') = 0, 'and takes no spots';

  -- Up to 6 other people.
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'Judy Ortiz', 'judy.o@example.com', '+15125550190',
      array['9a000000-0000-0000-0000-000000000001']::uuid[], false, null, '[]',
      (select jsonb_agg(jsonb_build_object('name', 'Helper ' || n, 'minor', false, 'shift_ids', jsonb_build_array('9a000000-0000-0000-0000-000000000003')))
         from generate_series(1, 7) n), null);
    raise exception 'FAIL: added 7 other people';
  exception when sqlstate 'P0001' then null;
  end;

  -- Judy, her daughter Maya (15) on the same shift, and her neighbor Bob on another.
  r := public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'Judy Ortiz', 'judy.o@example.com', '+15125550190',
    array['9a000000-0000-0000-0000-000000000001']::uuid[], false, null, '[]',
    '[{"name": "Maya Ortiz", "minor": true, "age": 15, "shift_ids": ["9a000000-0000-0000-0000-000000000001"]},
      {"name": "Bob Lee", "minor": false, "email": "Bob.Lee@example.com", "phone": "+15125550191", "shift_ids": ["9a000000-0000-0000-0000-000000000002"]}]',
    consent);
  judy := (r ->> 'booker')::uuid;
  maya := (r -> 'people' ->> 0)::uuid;
  bob := (r -> 'people' ->> 1)::uuid;
  assert (select registered_count from public.shifts where id = '9a000000-0000-0000-0000-000000000001') = 2, 'Judy and Maya each take a spot';
  assert (select registered_count from public.shifts where id = '9a000000-0000-0000-0000-000000000002') = 1, 'Bob takes his own';
  assert (select contact_id = judy and minor and age = 15 and full_name = 'Maya O.' and email is null and phone = '+15125550190'
            from public.volunteers where id = maya), 'Maya is booked by Judy, kept as "Maya O." with her age, reached through Judy';
  assert (select contact_id = judy and email = 'bob.lee@example.com' and phone = '+15125550191' from public.volunteers where id = bob),
         'Bob is booked by Judy, with his own email and phone';
  assert (select access_token from public.volunteers where id = bob) <> (select access_token from public.volunteers where id = judy),
         'Bob has his own private link';
  assert (select count(*) from public.minor_consents where volunteer_id = maya) = 1, 'the guardian''s confirmation is kept for Maya';
  assert (select booker_name = 'Judy Ortiz' and booker_email = 'judy.o@example.com' and minor_name = 'Maya O.' and wording = consent
                 and timezone is not null and consented_at is not null
            from public.minor_consents where volunteer_id = maya), 'with who confirmed, when, and the exact words';
  assert not exists (select 1 from public.minor_consents where volunteer_id in (judy, bob)), 'adults get no confirmation record';

  -- A full shift refuses the whole group, and each person counts toward the spots.
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'Ann Ash', 'ann@example.com', '+15125550192',
      array['9a000000-0000-0000-0000-000000000003']::uuid[], false, null, '[]',
      '[{"name": "Al Ash", "minor": false, "shift_ids": ["9a000000-0000-0000-0000-000000000002"]}]', null);
    raise exception 'FAIL: booked a full shift';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'Ann Ash', 'ann@example.com', '+15125550192',
      array['9a000000-0000-0000-0000-000000000001']::uuid[], false, null, '[]',
      '[{"name": "Al Ash", "minor": false, "shift_ids": ["9a000000-0000-0000-0000-000000000001"]}]', null);
    raise exception 'FAIL: two people took the last spot';
  exception when sqlstate 'P0002' then null;
  end;
  assert not exists (select 1 from public.volunteers where email = 'ann@example.com'), 'a refused group saves no one';
  assert (select registered_count from public.shifts where id = '9a000000-0000-0000-0000-000000000001') = 2, 'and takes no spots';

  -- The confirmation can never be changed or deleted.
  begin
    update public.minor_consents set wording = 'Something else entirely, edited later.' where volunteer_id = maya;
    raise exception 'FAIL: edited a guardian''s confirmation';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.minor_consents where volunteer_id = maya;
    raise exception 'FAIL: deleted a guardian''s confirmation';
  exception when insufficient_privilege then null;
  end;

  -- Bob switches to Tickets with his own link; his old spot opens up and the summary hears of it.
  assert not public.swap_shift_with_pass((select id from public.volunteer_assignments where volunteer_id = bob), tickets,
           array[(select access_token from public.volunteers where id = judy)], '{}'),
         'Judy''s link can''t switch Bob''s shift';
  assert public.swap_shift_with_pass((select id from public.volunteer_assignments where volunteer_id = bob), tickets,
           array[(select access_token from public.volunteers where id = bob)], '{}'),
         'Bob switches his shift with his link';
  assert (select registered_count from public.shifts where id = '9a000000-0000-0000-0000-000000000002') = 0, 'Concessions has a spot again';
  assert (select registered_count from public.shifts where id = tickets) = 1, 'Tickets has Bob';
  assert exists (select 1 from public.volunteer_changes where volunteer_id = bob and to_shift_id = tickets), 'the switch is noted for the summary';
  -- Maya can't switch to a shift she's too young for.
  begin
    perform public.swap_shift_with_pass((select id from public.volunteer_assignments where volunteer_id = maya), tickets,
              array[(select access_token from public.volunteers where id = maya)], '{}');
    raise exception 'FAIL: a 15-year-old switched to a 16-and-up shift';
  exception when sqlstate 'P0005' then null;
  end;
end $$;
reset role;

-- No one but the server signs up a group.
set role anon;
do $$ begin
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-00000000000a', 'X', 'x@example.com', '1', array[]::uuid[]);
    raise exception 'FAIL: the public called sign_up_group directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.minor_consents;
    raise exception 'FAIL: the public read guardian confirmations';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The event team sees the confirmation (and the roster marks it); a stranger doesn't.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  assert (select count(*) from public.minor_consents where minor_name = 'Maya O.') = 1, 'a Volunteer Lead sees the guardian''s confirmation';
  assert (select guardian_confirmed and signed_up_by = 'Judy Ortiz'
            from public.station_roster('20000000-0000-0000-0000-00000000000a') where volunteer_name = 'Maya O.'),
         'the roster shows Maya was booked by Judy, with her guardian''s confirmation';
  assert (select not guardian_confirmed from public.station_roster('20000000-0000-0000-0000-00000000000a') where volunteer_name = 'Bob Lee'),
         'adults show no guardian marker';
  begin
    update public.minor_consents set wording = 'Changed by a Volunteer Lead, not allowed.';
    raise exception 'FAIL: a Volunteer Lead edited a guardian''s confirmation';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not exists (select 1 from public.minor_consents), 'a stranger sees no guardian confirmations';
end $$;

-- Summary choices: your own, on an event you run volunteers for; hosts set anyone's.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$ begin
  insert into public.volunteer_digest_prefs (event_id, user_id, new_bookings, changes, cancellations)
  values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', false, true, true);
  begin
    insert into public.volunteer_digest_prefs (event_id, user_id, new_bookings, changes, cancellations)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', false, false, false);
    raise exception 'FAIL: a Volunteer Lead set a host''s summary choices';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  begin
    insert into public.volunteer_digest_prefs (event_id, user_id) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006');
    raise exception 'FAIL: a stranger added summary choices to someone else''s event';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.volunteer_digest_prefs), 'a stranger sees no summary choices';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  update public.volunteer_digest_prefs set new_bookings = true
   where event_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-000000000002';
  assert (select new_bookings from public.volunteer_digest_prefs where user_id = '00000000-0000-0000-0000-000000000002'),
         'a host can change a Volunteer Lead''s summary choices';
end $$;
reset role;
delete from public.volunteer_digest_prefs;
delete from public.volunteers where email in ('judy.o@example.com', 'bob.lee@example.com') or full_name = 'Maya O.';
delete from public.shifts where id::text like '9a000000-%';
delete from public.volunteer_changes;
delete from public.volunteer_dropped_shifts;

delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';

-- ---------------------------------------------------------------------------
-- Feedback (20270103000000): only the server saves it, only platform admins read it.
-- ---------------------------------------------------------------------------
set role service_role;
insert into public.feedback (kind, message, page, sender_hash, email)
values ('bug', 'The Save button did nothing.', '/e/future/volunteer', 'abc', 'sam@example.com');
reset role;
set role anon;
do $$ begin
  begin
    insert into public.feedback (kind, message, page, sender_hash) values ('idea', 'Spam', '/', 'x');
    raise exception 'FAIL: the public saved feedback directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.feedback;
    raise exception 'FAIL: the public read feedback';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$ begin
  assert not exists (select 1 from public.feedback), 'a host can''t read anyone''s feedback';
  begin
    insert into public.feedback (kind, message, page, sender_hash) values ('idea', 'Sneaky', '/', 'x');
    raise exception 'FAIL: a signed-in user saved feedback directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert (select count(*) from public.feedback) = 1, 'a platform admin reads feedback';
end $$;
reset role;
delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';
delete from public.feedback;
do $$ begin
  assert not (select public from storage.buckets where id = 'feedback-screenshots'), 'feedback screenshots are private';
end $$;

-- ---------------------------------------------------------------------------
-- Volunteer jobs: showing or hidden
-- ---------------------------------------------------------------------------
update public.organizations set subscription_status = 'active', package = 'event' where id = :'org_id';
insert into public.events (id, organization_id, name, slug, event_type, starts_on, ends_on, window_start, window_end, venue_address, volunteer_signup_open)
values ('10000000-0000-0000-0000-0000000000b7', :'org_id', 'Spring Fling', 'spring-fling-jobs', 'volunteer',
        current_date + 40, current_date + 40, now() + interval '40 days', now() + interval '40 days 4 hours', '1 School Rd', true);
insert into public.event_staff (event_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-000000000002', 'volunteer_director'),
  ('10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-000000000003', 'section_lead'),
  ('10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-000000000007', 'section_lead');
do $$ begin
  assert (select showing from public.stations limit 1), 'jobs made before this update are showing';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  insert into public.stations (id, event_id, name, showing) values
    ('10000000-0000-0000-0000-0000000000b8', '10000000-0000-0000-0000-0000000000b7', 'Face painting', false),
    ('10000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-0000000000b7', 'Ticket table', true);
  insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
    ('10000000-0000-0000-0000-0000000000ba', '10000000-0000-0000-0000-0000000000b8', 'Morning', now() + interval '40 days', now() + interval '40 days 2 hours', 3);
  -- Only a hidden job: not ready to publish.
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000b7';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Show at least one volunteer job%', 'a volunteer event needs a showing job to publish';
  -- The showing job has no shift yet, so it doesn't count either.
  ok := false;
  begin
    update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000b7';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a showing job needs a shift or a thing to bring';
  insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
    ('10000000-0000-0000-0000-0000000000bb', '10000000-0000-0000-0000-0000000000b9', 'Morning', now() + interval '40 days', now() + interval '40 days 2 hours', 3);
  update public.events set status = 'published' where id = '10000000-0000-0000-0000-0000000000b7';
  -- The last showing job can't be hidden while it's live.
  ok := false;
  begin
    update public.stations set showing = false where id = '10000000-0000-0000-0000-0000000000b9';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%last job volunteers can see%', 'the last showing job stays while the event is live';
  -- Hosts see hidden jobs (to preview them).
  assert exists (select 1 from public.stations where id = '10000000-0000-0000-0000-0000000000b8'), 'a host sees a hidden job';
  assert exists (select 1 from public.shifts where id = '10000000-0000-0000-0000-0000000000ba'), 'and its shifts';
end $$;
reset role;
insert into public.station_leads (station_id, user_id, event_id) values
  ('10000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000b7'),
  ('10000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-0000000000b7');
-- The public sees only showing jobs.
set role anon;
set request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert not exists (select 1 from public.stations where id = '10000000-0000-0000-0000-0000000000b8'), 'the public doesn''t see a hidden job';
  assert not exists (select 1 from public.shifts where id = '10000000-0000-0000-0000-0000000000ba'), 'or its shifts';
  assert exists (select 1 from public.stations where id = '10000000-0000-0000-0000-0000000000b9'), 'it sees a showing job';
end $$;
-- The sign-up page signs people up through the server: still not onto a hidden job.
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
do $$
declare ok boolean := false; msg text;
begin
  begin
    perform public.sign_up_volunteer('10000000-0000-0000-0000-0000000000b7', 'Pat Parent', 'pat@example.com', null,
                                     array['10000000-0000-0000-0000-0000000000ba']::uuid[]);
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%isn''t open for sign-up yet%', 'nobody signs up for a hidden job, even with its id';
  perform public.sign_up_volunteer('10000000-0000-0000-0000-0000000000b7', 'Pat Parent', 'pat@example.com', null,
                                   array['10000000-0000-0000-0000-0000000000bb']::uuid[]);
end $$;
reset role;
-- Switching shifts with a pass (through the server) can't land on a hidden job either.
select set_config('jobs.asg', a.id::text, false), set_config('jobs.vtok', v.access_token::text, false)
  from public.volunteer_assignments a join public.volunteers v on v.id = a.volunteer_id
 where v.email = 'pat@example.com' and a.shift_id = '10000000-0000-0000-0000-0000000000bb';
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
do $$ begin
  begin
    perform public.swap_shift_with_pass(current_setting('jobs.asg')::uuid, '10000000-0000-0000-0000-0000000000ba',
                                        array[current_setting('jobs.vtok')::uuid], '{}'::uuid[]);
  exception when others then null;
  end;
  assert (select shift_id from public.volunteer_assignments where id = current_setting('jobs.asg')::uuid) = '10000000-0000-0000-0000-0000000000bb',
         'a volunteer can''t switch onto a hidden job';
end $$;
reset role;
-- Demo mode's volunteer joins a showing job, never a hidden one.
insert into public.demo_events (owner_id, event_id) values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b7');
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
do $$ begin
  perform public.demo_join('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b7', 'd0000000-0000-0000-0000-000000000004');
  assert (select a.shift_id from public.volunteer_assignments a join public.volunteers v on v.id = a.volunteer_id
           where v.email = 'vol-1@demo.fieldcommandevents.com' and v.event_id = '10000000-0000-0000-0000-0000000000b7')
         = '10000000-0000-0000-0000-0000000000bb', 'the demo volunteer joins the showing job';
  perform public.demo_leave('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b7');
end $$;
reset role;
-- Coordinators: their own hidden job, not anyone else's.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","email":"lead@example.com"}';
do $$ begin
  assert exists (select 1 from public.stations where id = '10000000-0000-0000-0000-0000000000b8'), 'a Coordinator previews their own hidden job';
  assert exists (select 1 from public.shifts where id = '10000000-0000-0000-0000-0000000000ba'), 'and its shifts';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
do $$ begin
  assert not exists (select 1 from public.stations where id = '10000000-0000-0000-0000-0000000000b8'), 'another Coordinator doesn''t see it';
  assert not exists (select 1 from public.shifts where id = '10000000-0000-0000-0000-0000000000ba'), 'or its shifts';
  assert exists (select 1 from public.stations where id = '10000000-0000-0000-0000-0000000000b9'), 'they see their own showing job';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  assert exists (select 1 from public.stations where id = '10000000-0000-0000-0000-0000000000b8'), 'a Volunteer Lead previews hidden jobs';
  -- Not even a Volunteer Lead adds a walk-up to a hidden job; they're told to show it first.
  begin
    perform public.add_walk_up('10000000-0000-0000-0000-0000000000ba', 'Wally Walkup', null);
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'This job is hidden from volunteers. Show it%', 'no walk-ups on a hidden job';
  ok := false;
  -- Signed up: the job can't be hidden, and its shift can't be deleted.
  update public.stations set showing = true where id = '10000000-0000-0000-0000-0000000000b8';
  begin
    update public.stations set showing = false where id = '10000000-0000-0000-0000-0000000000b9';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'People are signed up for this job%', 'a job with sign-ups can''t be hidden';
  ok := false;
  begin
    delete from public.shifts where id = '10000000-0000-0000-0000-0000000000bb';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a shift with sign-ups can''t be deleted';
  ok := false;
  begin
    delete from public.stations where id = '10000000-0000-0000-0000-0000000000b9';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'nor can its whole job';
  -- With another showing job, a job without sign-ups can be hidden again.
  update public.stations set showing = false where id = '10000000-0000-0000-0000-0000000000b8';
  -- Things to bring follow the same rules.
  insert into public.stations (id, event_id, name, signup_kind) values
    ('10000000-0000-0000-0000-0000000000bc', '10000000-0000-0000-0000-0000000000b7', 'Bake sale', 'items');
  insert into public.station_items (id, station_id, event_id, name, needed) values
    ('10000000-0000-0000-0000-0000000000bd', '10000000-0000-0000-0000-0000000000bc', '10000000-0000-0000-0000-0000000000b7', 'Brownies', 4);
end $$;
reset role;
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
select public.sign_up_volunteer('10000000-0000-0000-0000-0000000000b7', 'Bea Baker', 'bea@example.com', null, '{}'::uuid[], false, '[]',
                                '[{"item": "10000000-0000-0000-0000-0000000000bd"}]') is not null as signed_up \gset
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","email":"director@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    delete from public.station_items where id = '10000000-0000-0000-0000-0000000000bd';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a thing to bring with sign-ups can''t be deleted';
  ok := false;
  begin
    update public.stations set showing = false where id = '10000000-0000-0000-0000-0000000000bc';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'nor its job hidden';
end $$;
reset role;
-- Things to bring on a hidden job are hidden too.
update public.stations set showing = false where id = '10000000-0000-0000-0000-0000000000b8';
insert into public.stations (id, event_id, name, signup_kind, showing) values
  ('10000000-0000-0000-0000-0000000000be', '10000000-0000-0000-0000-0000000000b7', 'Raffle prizes', 'items', false);
insert into public.station_items (id, station_id, event_id, name, needed) values
  ('10000000-0000-0000-0000-0000000000bf', '10000000-0000-0000-0000-0000000000be', '10000000-0000-0000-0000-0000000000b7', 'Gift cards', 5);
set role anon;
set request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert not exists (select 1 from public.station_items where id = '10000000-0000-0000-0000-0000000000bf'),
         'the public doesn''t see a hidden job''s things to bring';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","email":"newlead@example.com"}';
do $$ begin
  assert not exists (select 1 from public.station_items where id = '10000000-0000-0000-0000-0000000000bf'),
         'nor does another Coordinator';
end $$;
-- Every other way onto a hidden job is refused too, even for organizers.
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.sign_up_group('10000000-0000-0000-0000-0000000000b7', 'Gus Group', 'gus@example.com', null,
                                 array['10000000-0000-0000-0000-0000000000ba']::uuid[]);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'the group sign-up refuses a hidden job';
  ok := false;
  begin
    perform public.sign_up_volunteer('10000000-0000-0000-0000-0000000000b7', 'Ida Item', 'ida@example.com', null, '{}'::uuid[], false, '[]',
                                     '[{"item": "10000000-0000-0000-0000-0000000000bf"}]');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'and a hidden job''s thing to bring';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  begin
    perform public.import_volunteer('10000000-0000-0000-0000-0000000000b7', 'Ivy Import', 'ivy@example.com', null, false, '[]',
                                    array['10000000-0000-0000-0000-0000000000ba']::uuid[]);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a host can''t import people onto a hidden job';
  -- A shift with sign-ups can't move into a hidden job.
  ok := false;
  begin
    update public.shifts set station_id = '10000000-0000-0000-0000-0000000000b8' where id = '10000000-0000-0000-0000-0000000000bb';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '%can''t move to a hidden job%', 'a signed-up shift doesn''t move into a hidden job';
  -- A live event keeps a job volunteers can see: its last ones can't be deleted.
  insert into public.stations (id, event_id, name) values
    ('10000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000b7', 'Parking');
  insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
    ('10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c0', 'Morning', now() + interval '40 days', now() + interval '40 days 2 hours', 3);
  delete from public.stations where id = '10000000-0000-0000-0000-0000000000c0';
end $$;
reset role;
-- Only one showing job left: its shift can't go.
delete from public.item_signups where item_id = '10000000-0000-0000-0000-0000000000bd';
delete from public.stations where id = '10000000-0000-0000-0000-0000000000bc';
delete from public.volunteer_assignments where shift_id = '10000000-0000-0000-0000-0000000000bb';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  begin
    delete from public.shifts where id = '10000000-0000-0000-0000-0000000000bb';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Volunteers need at least one job%', 'the last showing job''s last shift stays while the event is live';
  ok := false;
  begin
    delete from public.stations where id = '10000000-0000-0000-0000-0000000000b9';
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'and so does the job';
  -- Replacing its shifts (new ones first, like "Fill the day") is fine.
  insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
    ('10000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000b9', 'Midday', now() + interval '40 days 2 hours', now() + interval '40 days 4 hours', 3);
  delete from public.shifts where id = '10000000-0000-0000-0000-0000000000bb';
end $$;
reset role;
-- Switching a live event to a volunteer event needs a showing job too.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address)
values ('10000000-0000-0000-0000-0000000000c2', :'org_id', 'Fun Fair', 'fun-fair-switch', 'published', 'fair',
        current_date + 40, current_date + 40, now() + interval '40 days', now() + interval '40 days 4 hours', '1 School Rd');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  begin
    update public.events set event_type = 'volunteer' where id = '10000000-0000-0000-0000-0000000000c2';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Show at least one volunteer job%', 'a live event can''t become a volunteer event without a showing job';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000c2';
-- Deleting the whole event takes everything with it.
delete from public.events where id = '10000000-0000-0000-0000-0000000000b7';
do $$ begin
  assert not exists (select 1 from public.shifts where id = '10000000-0000-0000-0000-0000000000bb'), 'deleting the event removes its signed-up shifts too';
end $$;

-- Band registration rules (20270107000000): publishing needs a deadline and a classification,
-- registration needs a deadline to open, classifications bands use stay, one at a time, https links.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end,
                           venue_address, classifications)
values ('10000000-0000-0000-0000-0000000000d1', :'org_id', 'Rules Invitational', 'rules-invitational', 'draft', 'band_contest',
        current_date + 50, current_date + 50, now() + interval '50 days', now() + interval '50 days 10 hours', '1 Field Rd', '{}');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean; msg text; ev uuid := '10000000-0000-0000-0000-0000000000d1'; cls text[];
begin
  ok := false;
  begin
    update public.events set status = 'published' where id = ev;
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Publishing needs a registration deadline%', 'a band contest can''t publish without a deadline';

  update public.events set band_registration_deadline = current_date + 30 where id = ev;
  ok := false;
  begin
    update public.events set status = 'published' where id = ev;
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Publishing needs at least one classification%', 'or without a classification';

  cls := public.add_event_classification(ev, ' 1A ');
  cls := public.add_event_classification(ev, '1A');
  assert cls = array['1A'], 'classifications are added once, trimmed';
  cls := public.add_event_classification(ev, 'Class AA');
  assert cls = array['1A', 'Class AA'], 'and added one at a time';
  ok := false;
  begin
    perform public.add_event_classification(ev, '   ');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a blank classification is refused';

  update public.events set status = 'published' where id = ev;

  ok := false;
  begin
    update public.events set band_registration_deadline = null where id = ev;
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a live band contest''s deadline can''t be cleared';

  cls := public.remove_event_classification(ev, 'Class AA');
  ok := false;
  begin
    perform public.remove_event_classification(ev, '1A');
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Publishing needs at least one classification%', 'a live band contest keeps at least one classification';
end $$;
reset role;
-- A band registered in 1A keeps 1A on the list.
update public.events set band_registration_open = true where id = '10000000-0000-0000-0000-0000000000d1';
insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                          contact_email, head_director_name, head_director_email, head_director_phone,
                          student_count, chaperone_count)
values ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000005', 'Rule HS', 'Rule Band', '1A', 'addr',
        'rule@example.com', 'Ru Le', 'rule@example.com', '+15125550111', 60, 5);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean; msg text; ev uuid := '10000000-0000-0000-0000-0000000000d1';
begin
  perform public.add_event_classification(ev, '2A');
  ok := false;
  begin
    update public.events set classifications = array['2A'] where id = ev;
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Bands are registered in 1A%', 'a classification bands are registered in can''t be removed';
  perform public.remove_event_classification(ev, '2A');

  -- Reopening registration needs a deadline (closing first, as superuser can't clear it while live).
  update public.events set band_registration_open = false where id = ev;

  ok := false;
  begin
    update public.events set payment_link = 'http://example.com/pay' where id = ev;
  exception when check_violation then ok := true;
  end;
  assert ok, 'a payment link must be https';
  update public.events set payment_link = 'https://example.com/pay' where id = ev;
end $$;
reset role;
-- Reopening with no deadline: set up as the server (unpublished, no deadline), then try as the host.
update public.events set status = 'draft', band_registration_deadline = null where id = '10000000-0000-0000-0000-0000000000d1';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  begin
    update public.events set band_registration_open = true where id = '10000000-0000-0000-0000-0000000000d1';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Pick a registration deadline%', 'registration can''t open without a deadline';
end $$;
-- The deadline falls before contest day; the chaperone limit stays at or above what bands bring;
-- classifications match without case, and rename moves their bands.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean; msg text; ev uuid := '10000000-0000-0000-0000-0000000000d1'; cls text[];
begin
  ok := false;
  begin
    update public.events set band_registration_deadline = current_date + 50 where id = ev;
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'The registration deadline needs to be before contest day%', 'a deadline on contest day is refused';
  update public.events set band_registration_deadline = current_date + 30 where id = ev;
  ok := false;
  begin
    update public.events set starts_on = current_date + 20, ends_on = current_date + 20 where id = ev;
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'The registration deadline needs to be before contest day%', 'moving contest day before the deadline is refused';

  ok := false;
  begin
    update public.events set chaperone_limit = 3 where id = ev;
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Rule Band registered 5 chaperones%', 'the chaperone limit can''t drop below a registered band';
  update public.events set chaperone_limit = 5 where id = ev;

  cls := public.add_event_classification(ev, '1a');
  assert cls = array['1A'], 'a classification differing only in case isn''t added twice';

  cls := public.rename_event_classification(ev, '1A', '1A Small');
  assert cls = array['1A Small'], 'a classification with bands can be renamed';
  perform public.add_event_classification(ev, '2A');
  ok := false;
  begin
    perform public.rename_event_classification(ev, '2A', '1a small');
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like '1a small is already a classification%', 'a rename can''t duplicate another classification';
  perform public.remove_event_classification(ev, '2A');
end $$;
reset role;
do $$ begin
  assert (select classification from public.bands where event_id = '10000000-0000-0000-0000-0000000000d1') = '1A Small',
    'renaming a classification moves its bands with it';
end $$;
set role authenticated;
-- Someone outside the event can't add or remove classifications.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.add_event_classification('10000000-0000-0000-0000-0000000000d1', '9A');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a stranger can''t add a classification';
  ok := false;
  begin
    perform public.rename_event_classification('10000000-0000-0000-0000-0000000000d1', '1A Small', 'Mine');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'or rename one';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d1';

-- Registration that opens on a set day (20270108000000): not open before it, open from it, and it
-- can't open after the deadline.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end,
                           venue_address, classifications, band_registration_deadline, band_registration_open, band_registration_opens_on)
values ('10000000-0000-0000-0000-0000000000d2', :'org_id', 'Opens Later Classic', 'opens-later-classic', 'published', 'band_contest',
        current_date + 60, current_date + 60, now() + interval '60 days', now() + interval '60 days 10 hours', '1 Field Rd',
        '{1A}', current_date + 30, true, current_date + 5);
do $$ begin
  assert not public.band_registration_is_open('10000000-0000-0000-0000-0000000000d2'), 'registration isn''t open before its opening day';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","email":"director@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.bands (event_id, director_user_id, school_name, band_name, classification, school_address,
                              contact_email, head_director_name, head_director_email, head_director_phone, student_count, chaperone_count)
    values ('10000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000005', 'Early HS', 'Early Band', '1A', 'addr',
            'early@example.com', 'Ear Ly', 'early@example.com', '+15125550112', 50, 2);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a director can''t register before registration opens';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  begin
    update public.events set band_registration_opens_on = current_date + 40 where id = '10000000-0000-0000-0000-0000000000d2';
  exception when sqlstate 'P0001' then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Registration has to open on or before its deadline%', 'registration can''t open after its deadline';
  -- Today in the event's own time zone (the day can differ from UTC's near midnight).
  update public.events set band_registration_opens_on = (now() at time zone timezone)::date where id = '10000000-0000-0000-0000-0000000000d2';
  assert public.band_registration_is_open('10000000-0000-0000-0000-0000000000d2'), 'registration is open from its opening day';
  update public.events set band_registration_opens_on = null where id = '10000000-0000-0000-0000-0000000000d2';
  assert public.band_registration_is_open('10000000-0000-0000-0000-0000000000d2'), 'with no opening day, it''s open once published';
end $$;
reset role;
delete from public.events where id = '10000000-0000-0000-0000-0000000000d2';

-- ---------------------------------------------------------------------------
-- Spots held for adults (20270110000000): a job's shifts keep spots for adults;
-- under-18s can't take them (signing up or switching), adults go first in a
-- group, an organizer adding over capacity isn't held back, and the counts
-- show on a published event's sign-up page.
-- ---------------------------------------------------------------------------
set role service_role;
do $$
declare
  day   timestamptz := date_trunc('day', now() + interval '16 days');
  sh    uuid := '9c000000-0000-0000-0000-000000000001';
  sh2   uuid := '9c000000-0000-0000-0000-000000000002';
  t1 uuid; t2 uuid; t3 uuid; ad uuid; ad2 uuid; t4 uuid;
  ok boolean;
begin
  update public.stations set min_adults = 2 where id = '20000000-0000-0000-0000-00000000000a';
  insert into public.shifts (id, station_id, title, starts_at, ends_at, max_capacity) values
    (sh,  '20000000-0000-0000-0000-00000000000a', 'Teen concessions', day + interval '17 hours', day + interval '19 hours', 3),
    (sh2, '20000000-0000-0000-0000-00000000000a', 'Late concessions', day + interval '20 hours', day + interval '22 hours', 3);
  insert into public.volunteers (event_id, full_name, email, phone, minor) values
    ('10000000-0000-0000-0000-00000000000a', 'Teen A.', 'held.t1@example.com', '+15125550301', true) returning id into t1;
  insert into public.volunteers (event_id, full_name, email, phone, minor) values
    ('10000000-0000-0000-0000-00000000000a', 'Teen B.', 'held.t2@example.com', '+15125550302', true) returning id into t2;
  insert into public.volunteers (event_id, full_name, email, phone, minor) values
    ('10000000-0000-0000-0000-00000000000a', 'Teen C.', 'held.t3@example.com', '+15125550303', true) returning id into t3;
  insert into public.volunteers (event_id, full_name, email, phone, minor) values
    ('10000000-0000-0000-0000-00000000000a', 'Teen D.', 'held.t4@example.com', '+15125550304', true) returning id into t4;
  insert into public.volunteers (event_id, full_name, email, phone) values
    ('10000000-0000-0000-0000-00000000000a', 'Ada Adult', 'held.ad@example.com', '+15125550305') returning id into ad;
  insert into public.volunteers (event_id, full_name, email, phone) values
    ('10000000-0000-0000-0000-00000000000a', 'Abe Adult', 'held.ad2@example.com', '+15125550306') returning id into ad2;

  assert public.adults_still_needed(sh) = 2, 'an empty shift needs both its adults';
  -- 3 spots, 2 held for adults: one under-18 fits, a second doesn't.
  perform public.book_group('10000000-0000-0000-0000-00000000000a', array[t1], array[sh], false, false);
  ok := false;
  begin
    perform public.book_group('10000000-0000-0000-0000-00000000000a', array[t2], array[sh], false, false);
  exception when sqlstate 'P0005' then ok := true;
  end;
  assert ok, 'an under-18 can''t take a spot held for adults';
  -- An adult can, and it's still held for the other adult.
  perform public.book_group('10000000-0000-0000-0000-00000000000a', array[ad], array[sh], false, false);
  assert public.adults_still_needed(sh) = 1, 'one adult signed up, one still needed';
  ok := false;
  begin
    perform public.book_group('10000000-0000-0000-0000-00000000000a', array[t2], array[sh], false, false);
  exception when sqlstate 'P0005' then ok := true;
  end;
  assert ok, 'the last spot stays held for an adult';
  -- An organizer adding over capacity (a walk-up) isn't held back.
  perform public.book_group('10000000-0000-0000-0000-00000000000a', array[t2], array[sh], true, true);
  assert exists (select 1 from public.volunteer_assignments where shift_id = sh and volunteer_id = t2), 'an organizer can still add an under-18';

  -- A parent and teen signing up together: the adult goes first, so both fit in the order given teen-first.
  perform public.book_group('10000000-0000-0000-0000-00000000000a', array[t3, ad2], array[sh2], false, false);
  assert (select count(*) from public.volunteer_assignments where shift_id = sh2) = 2, 'a teen and adult together both fit';
  -- Now 1 spot left, 1 adult still needed: no more under-18s.
  ok := false;
  begin
    perform public.book_group('10000000-0000-0000-0000-00000000000a', array[t4], array[sh2], false, false);
  exception when sqlstate 'P0005' then ok := true;
  end;
  assert ok, 'with one spot left and one adult needed, an under-18 is refused';

  -- Adults-only jobs don't hold spots (nobody under 18 can sign up anyway).
  update public.stations set adults_only = true where id = '20000000-0000-0000-0000-00000000000a';
  assert public.adults_still_needed(sh2) = 0, 'an adults-only job holds no spots';
  update public.stations set adults_only = false where id = '20000000-0000-0000-0000-00000000000a';
end $$;

-- Switching to a shift whose open spot is held for an adult is refused for an under-18.
do $$
declare ok boolean := false; asg uuid; tok uuid;
begin
  select va.id, v.access_token into asg, tok from public.volunteer_assignments va join public.volunteers v on v.id = va.volunteer_id
   where v.email = 'held.t1@example.com';
  update public.events set volunteer_signup_open = true where id = '10000000-0000-0000-0000-00000000000a';
  begin
    perform public.swap_shift_with_pass(asg, '9c000000-0000-0000-0000-000000000002', array[tok], null);
  exception when sqlstate 'P0005' then ok := true;
  end;
  assert ok, 'an under-18 can''t switch into a spot held for adults';
end $$;

-- The sign-up page can read each shift's adults still needed (counts only).
set role anon;
do $$
begin
  assert (select adults_needed from public.shift_adult_needs('10000000-0000-0000-0000-00000000000a')
           where shift_id = '9c000000-0000-0000-0000-000000000002') = 1, 'a published event shows adults still needed';
end $$;
do $$
declare ok boolean := false;
begin
  begin
    perform public.adults_still_needed('9c000000-0000-0000-0000-000000000002');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'the public can''t call the per-shift helper directly';
end $$;
reset role;
delete from public.volunteers where email like 'held.%@example.com';
delete from public.shifts where id in ('9c000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000002');
update public.stations set min_adults = null where id = '20000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- Meals for visiting bands (20270111000000): directors can say how many meals
-- they need on their own registration; the public can't write it; prices and
-- lengths stay in bounds.
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  assert has_column_privilege('authenticated', 'public.bands', 'meal_counts', 'INSERT'), 'directors can order meals when registering';
  assert has_column_privilege('authenticated', 'public.bands', 'meal_counts', 'UPDATE'), 'and change the order while registration is open';
  assert has_column_privilege('authenticated', 'public.bands', 'meal_note', 'UPDATE'), 'with a note';
  assert not has_column_privilege('anon', 'public.bands', 'meal_counts', 'UPDATE'), 'the public can''t';
  -- Meal counts are whole numbers from 0 to 2,000, in a plain object.
  assert public.valid_meal_counts('{"Regular": 110, "Vegetarian": 6}'), 'a normal order is fine';
  assert public.valid_meal_counts('{}'), 'no order is fine';
  assert not public.valid_meal_counts('{"Regular": -1}'), 'no negative counts';
  assert not public.valid_meal_counts('{"Regular": 2.5}'), 'no half meals';
  assert not public.valid_meal_counts('{"Regular": 5000}'), 'no impossible counts';
  assert not public.valid_meal_counts('{"Regular": "lots"}'), 'numbers only';
  assert not public.valid_meal_counts('[1, 2]'), 'a plain object only';
  ok := false;
  begin
    update public.events set meal_options = array['1','2','3','4','5','6','7','8','9','10','11'] where id = '10000000-0000-0000-0000-00000000000a';
  exception when check_violation then ok := true;
  end;
  assert ok, 'up to 10 meal options';
  ok := false;
  begin
    update public.events set meal_price_cents = -1 where id = '10000000-0000-0000-0000-00000000000a';
  exception when check_violation then ok := true;
  end;
  assert ok, 'a meal price can''t be negative';
  ok := false;
  begin
    update public.events set meal_details = repeat('x', 1001) where id = '10000000-0000-0000-0000-00000000000a';
  exception when check_violation then ok := true;
  end;
  assert ok, 'meal details stay under 1,000 characters';
  update public.events set meals_offered = true, meal_price_cents = 850 where id = '10000000-0000-0000-0000-00000000000a';
  assert (select meals_offered and meal_price_cents = 850 from public.events where id = '10000000-0000-0000-0000-00000000000a'), 'a host can offer meals with a price';
  update public.events set meals_offered = false, meal_price_cents = null where id = '10000000-0000-0000-0000-00000000000a';
end $$;

-- ---------------------------------------------------------------------------
-- Start from a previous contest (20270112000000): a host copies an earlier
-- contest's setup into a new draft on the same account. Shifts move to the new
-- day; strangers can't copy; a contest that's already set up can't be copied into.
-- ---------------------------------------------------------------------------
set role service_role;
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, classifications)
select '10000000-0000-0000-0000-0000000000c7', organization_id, 'Future Classic 2', 'future-2', 'draft', 'band_contest',
       starts_on + 364, ends_on + 364, window_start + interval '364 days', window_end + interval '364 days', venue_address, '{}'
  from public.events where id = '10000000-0000-0000-0000-00000000000a';
update public.events set event_type = 'band_contest', classifications = array['1A','2A'], chaperone_limit = 7,
       band_registration_deadline = starts_on - 1
 where id = '10000000-0000-0000-0000-00000000000a';
-- Another draft, ten years earlier: the moved deadline lands in the past.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, classifications)
select '10000000-0000-0000-0000-0000000000ca', organization_id, 'Old Classic', 'old-classic', 'draft', 'band_contest',
       starts_on - 3650, ends_on - 3650, window_start - interval '3650 days', window_end - interval '3650 days', venue_address, '{}'
  from public.events where id = '10000000-0000-0000-0000-00000000000a';
-- A volunteer event on the same account.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address)
select '10000000-0000-0000-0000-0000000000c9', organization_id, 'Cleanup Day', 'cleanup-c9', 'draft', 'volunteer',
       starts_on + 364, ends_on + 364, window_start + interval '364 days', window_end + interval '364 days', venue_address
  from public.events where id = '10000000-0000-0000-0000-00000000000a';
reset role;
-- The same host's second account, with a draft band contest on it.
insert into public.organizations (id, name, slug) values ('60000000-0000-0000-0000-0000000000c8', 'Second Boosters', 'second-boosters');
insert into public.organization_members (organization_id, user_id, role)
values ('60000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-000000000001', 'owner');
set role service_role;
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, classifications)
select '10000000-0000-0000-0000-0000000000c8', '60000000-0000-0000-0000-0000000000c8', 'Other Classic', 'other-classic', 'draft', 'band_contest',
       starts_on + 364, ends_on + 364, window_start + interval '364 days', window_end + interval '364 days', venue_address, '{}'
  from public.events where id = '10000000-0000-0000-0000-00000000000a';
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.copy_band_contest_setup('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c7');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a stranger can''t copy a contest';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.copy_band_contest_setup('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c8');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a host of two accounts can''t copy a contest from one account into the other';
  assert (select classifications = '{}' from public.events where id = '10000000-0000-0000-0000-0000000000c8'), 'and nothing came over';
  ok := false;
  begin
    perform public.copy_band_contest_setup('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c9');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'only a band contest can start from a band contest';
  perform public.copy_band_contest_setup('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000ca');
  assert (select band_registration_deadline is null and classifications = array['1A','2A'] from public.events where id = '10000000-0000-0000-0000-0000000000ca'),
         'a deadline that would land in the past is left blank, and the rest still comes over';
end $$;
do $$
declare r jsonb; ok boolean := false;
begin
  r := public.copy_band_contest_setup('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c7');
  assert (select n.band_registration_deadline is not distinct from
                 (case when o.band_registration_deadline + 364 >= current_date then o.band_registration_deadline + 364 end)
            from public.events n, public.events o
           where n.id = '10000000-0000-0000-0000-0000000000c7' and o.id = '10000000-0000-0000-0000-00000000000a'),
         'the deadline moves by the same number of days as contest day';
  assert (r ->> 'jobs')::int = (select count(*) from public.stations where event_id = '10000000-0000-0000-0000-00000000000a'), 'every job comes over';
  assert (select classifications = array['1A','2A'] and chaperone_limit = 7 from public.events where id = '10000000-0000-0000-0000-0000000000c7'),
         'registration settings come over';
  assert (select count(*) from public.shifts where event_id = '10000000-0000-0000-0000-0000000000c7')
       = (select count(*) from public.shifts where event_id = '10000000-0000-0000-0000-00000000000a'), 'every shift comes over';
  assert not exists (
    select 1 from public.shifts n
     where n.event_id = '10000000-0000-0000-0000-0000000000c7'
       and not exists (select 1 from public.shifts o where o.event_id = '10000000-0000-0000-0000-00000000000a'
                         and o.title = n.title and o.starts_at + interval '364 days' = n.starts_at)), 'shifts move to the new contest day';
  assert (select coalesce(sum(registered_count), 0) from public.shifts where event_id = '10000000-0000-0000-0000-0000000000c7') = 0, 'nobody signed up comes over';
  assert not exists (select 1 from public.bands where event_id = '10000000-0000-0000-0000-0000000000c7'), 'no bands come over';
  begin
    perform public.copy_band_contest_setup('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c7');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a contest that''s already set up can''t be copied into';
end $$;
reset role;
set role service_role;
select set_config('app.cleaning_up', 'on', false);
delete from public.events where id in ('10000000-0000-0000-0000-0000000000c7', '10000000-0000-0000-0000-0000000000c8',
                                       '10000000-0000-0000-0000-0000000000c9', '10000000-0000-0000-0000-0000000000ca');
update public.events set band_registration_deadline = null where id = '10000000-0000-0000-0000-00000000000a';
select set_config('app.cleaning_up', 'off', false);
reset role;
delete from public.organizations where id = '60000000-0000-0000-0000-0000000000c8';

-- ---------------------------------------------------------------------------
-- My team (20270113000000): the removal ladder, leaving, co-host clean-up,
-- account-level co-host invitations, team spots (invitations hold one; past
-- events don't), and handing the account on.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000007e-0000-0000-0000-000000000001', 'tmowner@example.com', '{"full_name":"Tia Owner"}'),
  ('0000007e-0000-0000-0000-000000000002', 'tmco1@example.com', '{"full_name":"Cal Cohost"}'),
  ('0000007e-0000-0000-0000-000000000003', 'tmco2@example.com', '{"full_name":"Coy Cohost"}'),
  ('0000007e-0000-0000-0000-000000000004', 'tmvl@example.com', '{"full_name":"Vi Lead"}'),
  ('0000007e-0000-0000-0000-000000000005', 'tmcoord@example.com', '{"full_name":"Cy Coord"}'),
  ('0000007e-0000-0000-0000-000000000006', 'tmpast@example.com', '{"full_name":"Pat Past"}');
insert into public.organizations (id, name, slug, subscription_status, free_until)
values ('7d000000-0000-0000-0000-000000000001', 'Team PTA', 'team-pta', 'comped', date '2099-01-01');
insert into public.organization_members (organization_id, user_id, role) values
  ('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000001', 'owner'),
  ('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000002', 'admin'),
  ('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000003', 'admin');
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, timezone) values
  ('7d000000-0000-0000-0000-0000000000e1', '7d000000-0000-0000-0000-000000000001', 'Spring Fair', 'team-spring-fair', 'draft', 'volunteer',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 6 hours', '1 Fair Rd', 'America/Chicago'),
  ('7d000000-0000-0000-0000-0000000000e2', '7d000000-0000-0000-0000-000000000001', 'Last Fall', 'team-last-fall', 'draft', 'volunteer',
   current_date - 30, current_date - 30, now() - interval '30 days', now() - interval '30 days' + interval '6 hours', '1 Fair Rd', 'America/Chicago');
insert into public.stations (id, event_id, name) values
  ('7d000000-0000-0000-0000-0000000000b1', '7d000000-0000-0000-0000-0000000000e1', 'Ring toss');
insert into public.event_staff (event_id, user_id, role) values
  ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000004', 'volunteer_director'),
  ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000005', 'section_lead'),
  ('7d000000-0000-0000-0000-0000000000e2', '0000007e-0000-0000-0000-000000000006', 'section_lead');
-- Co-host 2 leads a job.
insert into public.station_leads (station_id, user_id, event_id)
values ('7d000000-0000-0000-0000-0000000000b1', '0000007e-0000-0000-0000-000000000003', '7d000000-0000-0000-0000-0000000000e1');

-- A co-host can't remove another co-host, or invite one.
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$
declare ok boolean := false;
begin
  delete from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000003';
  assert exists (select 1 from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000003'),
         'a co-host can''t remove another co-host';
  delete from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000001';
  assert exists (select 1 from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000001'),
         'nobody removes the Account Host';
  begin
    insert into public.invitations (organization_id, email, as_host, invited_by)
    values ('7d000000-0000-0000-0000-000000000001', 'tmnew@example.com', true, '0000007e-0000-0000-0000-000000000002');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a co-host can''t invite a co-host';
  -- A co-host can remove Volunteer Leads and Coordinators.
  assert public.is_event_admin('7d000000-0000-0000-0000-0000000000e1'), 'a co-host hosts every event';
end $$;
-- A Coordinator leaves on their own; a Volunteer Lead can't remove another Volunteer Lead.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000005","email":"tmcoord@example.com"}';
do $$ begin
  delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000005';
  assert not exists (select 1 from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000005'),
         'a Coordinator can leave an event';
end $$;
reset role;

-- The Account Host invites a co-host to the account (no event), and the invitation holds a spot.
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.set_account_package('7d000000-0000-0000-0000-000000000001', 'volunteer', 'standard', null, 'admin');
reset role;
delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  -- Owner, 2 co-hosts, and the Volunteer Lead: 4. Last Fall's Coordinator doesn't count.
  assert ((public.team_spots('7d000000-0000-0000-0000-000000000001')) ->> 'used')::int = 4, 'helpers on past events don''t hold a spot';
  insert into public.invitations (organization_id, email, as_host, invited_by)
  values ('7d000000-0000-0000-0000-000000000001', 'tmnew@example.com', true, '0000007e-0000-0000-0000-000000000001');
  assert ((public.team_spots('7d000000-0000-0000-0000-000000000001')) ->> 'used')::int = 5, 'an open invitation holds a spot';
  assert ((public.team_spots('7d000000-0000-0000-0000-000000000001')) ->> 'invited')::int = 1, 'and is counted as invited';
  begin
    insert into public.invitations (event_id, email, role, invited_by)
    values ('7d000000-0000-0000-0000-0000000000e1', 'tmsixth@example.com', 'section_lead', '0000007e-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Your team is full%', 'a full team (invitations included) can''t invite more';
  -- Someone already on the team can be invited to another role without a new spot.
  insert into public.invitations (event_id, email, role, invited_by)
  values ('7d000000-0000-0000-0000-0000000000e1', 'tmvl@example.com', 'section_lead', '0000007e-0000-0000-0000-000000000001');
  delete from public.invitations where email = 'tmvl@example.com';
end $$;
-- Invitations can be looked up by account, as My team and team setup do (20270119000000).
do $$ begin
  assert exists (select 1 from public.invitations
                  where organization_id = '7d000000-0000-0000-0000-000000000001' and email = 'tmnew@example.com'),
         'the Account Host can find the account''s invitations by account';
end $$;
-- A Volunteer Lead doesn't see the account's co-host invitations (co-hosts and the Account Host do).
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$ begin
  assert not exists (select 1 from public.invitations where email = 'tmnew@example.com'), 'a Volunteer Lead can''t see co-host invitations';
end $$;
-- What a Volunteer Lead can't do (design review 2026-11-05): read the hosts' team count, remove
-- another Volunteer Lead, or see removed Volunteer Leads (they see removed Coordinators).
reset role;
set session_replication_role = replica;
insert into public.event_staff (event_id, user_id, role)
values ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000006', 'volunteer_director');
set session_replication_role = origin;
insert into public.team_removals (organization_id, event_id, role, user_id, email, full_name)
values ('7d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-0000000000e1', 'volunteer_director',
        '0000007e-0000-0000-0000-000000000006', 'tmgonevl@example.com', 'Gone Lead'),
       ('7d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-0000000000e1', 'section_lead',
        '0000007e-0000-0000-0000-000000000006', 'tmgonecoord@example.com', 'Gone Coordinator');
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.team_spots('7d000000-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a Volunteer Lead can''t read the hosts'' team count';
  delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000006' and role = 'volunteer_director';
  assert exists (select 1 from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000006' and role = 'volunteer_director'),
         'a Volunteer Lead can''t remove another Volunteer Lead';
  assert exists (select 1 from public.team_removals where email = 'tmgonecoord@example.com'), 'a Volunteer Lead sees removed Coordinators';
  assert not exists (select 1 from public.team_removals where email = 'tmgonevl@example.com'), 'but not removed Volunteer Leads';
end $$;
reset role;
set session_replication_role = replica;
delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000006' and role = 'volunteer_director';
set session_replication_role = origin;
delete from public.team_removals where email in ('tmgonevl@example.com', 'tmgonecoord@example.com');
set role authenticated;

-- The invited co-host accepts the account invitation.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000006","email":"tmpast@example.com"}';
reset role;
update public.invitations set email = 'tmpast@example.com' where email = 'tmnew@example.com';
select set_config('tm.invite', (select token from public.invitations where email = 'tmpast@example.com' and as_host)::text, false);
set role authenticated;
do $$ begin
  assert public.accept_invitation(current_setting('tm.invite')::uuid) is null,
         'an account invitation has no event';
  assert exists (select 1 from public.organization_members where organization_id = '7d000000-0000-0000-0000-000000000001'
                   and user_id = '0000007e-0000-0000-0000-000000000006' and role = 'admin'), 'accepting makes them a co-host';
end $$;

-- Resending an expired invitation needs a free team spot, like a new one (20270115000000).
-- The team is full here (5 of 5 on Volunteer Command).
reset role;
set session_replication_role = replica;  -- add an old, expired invitation without today's checks
insert into public.invitations (organization_id, email, as_host, invited_by, expires_at)
values ('7d000000-0000-0000-0000-000000000001', 'tmexpired@example.com', true, '0000007e-0000-0000-0000-000000000001',
        now() - interval '1 day');
set session_replication_role = origin;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$
declare ok boolean := false; msg text;
begin
  assert ((public.team_spots('7d000000-0000-0000-0000-000000000001')) ->> 'used')::int
       = ((public.team_spots('7d000000-0000-0000-0000-000000000001')) ->> 'max')::int, 'the team is full';
  begin
    perform public.prepare_invitation_email((select id from public.invitations where email = 'tmexpired@example.com'));
  exception when insufficient_privilege then ok := true; msg := sqlerrm;
  end;
  assert ok and msg like 'Your team is full%', 'resending an expired invitation on a full team is refused';
  assert (select expires_at < now() from public.invitations where email = 'tmexpired@example.com'), 'and the link stays expired';
end $$;
-- A Volunteer Lead can see that the team is full (20270116000000); someone outside the account can't.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$ begin
  assert public.team_is_full('7d000000-0000-0000-0000-000000000001'), 'a Volunteer Lead sees the team is full';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.team_is_full('7d000000-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'someone outside the account can''t ask whether its team is full';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
-- People on an account's event team see who to ask; others see nothing (20270116000000).
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$ begin
  assert (select host_email from public.account_contacts(array['7d000000-0000-0000-0000-000000000001'::uuid])) = 'tmowner@example.com',
         'a Volunteer Lead sees the Account Host''s contact';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not exists (select 1 from public.account_contacts(array['7d000000-0000-0000-0000-000000000001'::uuid])),
         'someone outside the account sees no contact';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
-- Past helpers stop seeing an event 10 days after it ends (20270117000000); hosts keep it.
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, timezone) values
  ('7d000000-0000-0000-0000-0000000000e3', '7d000000-0000-0000-0000-000000000001', 'Long Over', 'team-long-over', 'draft', 'volunteer',
   current_date - 20, current_date - 20, now() - interval '20 days', now() - interval '20 days' + interval '6 hours', '1 Fair Rd', 'America/Chicago'),
  ('7d000000-0000-0000-0000-0000000000e4', '7d000000-0000-0000-0000-000000000001', 'Just Over', 'team-just-over', 'draft', 'volunteer',
   current_date - 5, current_date - 5, now() - interval '5 days', now() - interval '5 days' + interval '6 hours', '1 Fair Rd', 'America/Chicago');
set session_replication_role = replica;
insert into public.event_staff (event_id, user_id, role) values
  ('7d000000-0000-0000-0000-0000000000e3', '0000007e-0000-0000-0000-000000000004', 'volunteer_director'),
  ('7d000000-0000-0000-0000-0000000000e4', '0000007e-0000-0000-0000-000000000004', 'volunteer_director');
set session_replication_role = origin;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$ begin
  assert not exists (select 1 from public.events where id = '7d000000-0000-0000-0000-0000000000e3'),
         'a past Volunteer Lead can''t see an event 10 days after it ends';
  assert not public.can_manage_volunteers('7d000000-0000-0000-0000-0000000000e3'), 'or manage its volunteers';
  assert not exists (select 1 from public.event_staff where event_id = '7d000000-0000-0000-0000-0000000000e3'), 'or see its team';
  assert exists (select 1 from public.events where id = '7d000000-0000-0000-0000-0000000000e4'), 'within 10 days they still can';
  assert public.can_manage_volunteers('7d000000-0000-0000-0000-0000000000e4'), 'and still manage it';
  -- Leaving an event that's over doesn't erase it from their history.
  delete from public.event_staff where event_id = '7d000000-0000-0000-0000-0000000000e4' and user_id = '0000007e-0000-0000-0000-000000000004';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.event_staff where event_id = '7d000000-0000-0000-0000-0000000000e4'
                   and user_id = '0000007e-0000-0000-0000-000000000004'), 'a past role can''t be left (it''s history)';
end $$;
-- Volunteer history, with only past events left: refused once they're more than 10 days over.
set session_replication_role = replica;
create temp table tm_lead_rows as
  select * from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000004'
     and event_id not in ('7d000000-0000-0000-0000-0000000000e3', '7d000000-0000-0000-0000-0000000000e4');
delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000004'
   and event_id not in ('7d000000-0000-0000-0000-0000000000e3', '7d000000-0000-0000-0000-0000000000e4');
set session_replication_role = origin;
set role authenticated;
do $$ begin
  assert public.can_see_volunteer_history('7d000000-0000-0000-0000-000000000001'), 'within 10 days of their event, a Volunteer Lead sees volunteer history';
end $$;
reset role;
set session_replication_role = replica;
delete from public.event_staff where event_id = '7d000000-0000-0000-0000-0000000000e4' and user_id = '0000007e-0000-0000-0000-000000000004';
set session_replication_role = origin;
set role authenticated;
do $$ begin
  assert not public.can_see_volunteer_history('7d000000-0000-0000-0000-000000000001'),
         'with only an event over 10 days ago, a past Volunteer Lead can''t see volunteer history';
end $$;
reset role;
set session_replication_role = replica;
insert into public.event_staff select * from tm_lead_rows;
set session_replication_role = origin;
drop table tm_lead_rows;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$ begin
  assert exists (select 1 from public.event_staff where event_id = '7d000000-0000-0000-0000-0000000000e3'),
         'the Account Host still sees past teams (their history)';
end $$;
reset role;
set session_replication_role = replica;
delete from public.event_staff where event_id in ('7d000000-0000-0000-0000-0000000000e3', '7d000000-0000-0000-0000-0000000000e4');
set session_replication_role = origin;
delete from public.events where id in ('7d000000-0000-0000-0000-0000000000e3', '7d000000-0000-0000-0000-0000000000e4');
set role authenticated;

-- A Coordinator sees their event's Volunteer Lead (20270118000000); someone else doesn't.
reset role;
set session_replication_role = replica;
insert into public.event_staff (event_id, user_id, role)
values ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000006', 'section_lead');
set session_replication_role = origin;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000006","email":"tmpast@example.com"}';
do $$ begin
  assert exists (select 1 from public.event_volunteer_leads(array['7d000000-0000-0000-0000-0000000000e1'::uuid]) where email = 'tmvl@example.com'),
         'a Coordinator sees their event''s Volunteer Lead';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$ begin
  assert not exists (select 1 from public.event_volunteer_leads(array['7d000000-0000-0000-0000-0000000000e1'::uuid])),
         'someone not on the event sees no Volunteer Lead';
end $$;
reset role;
set session_replication_role = replica;
delete from public.event_staff where event_id = '7d000000-0000-0000-0000-0000000000e1'
   and user_id = '0000007e-0000-0000-0000-000000000006' and role = 'section_lead';
set session_replication_role = origin;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
-- Someone who already holds a spot can have their expired invitation sent again.
reset role;
update public.invitations set email = 'tmvl@example.com' where email = 'tmexpired@example.com';
set role authenticated;
do $$ begin
  perform public.prepare_invitation_email((select id from public.invitations where email = 'tmvl@example.com' and as_host));
  assert (select expires_at > now() from public.invitations where email = 'tmvl@example.com' and as_host),
         'resending renews the link when it needs no new spot';
end $$;
reset role;
delete from public.invitations where email = 'tmvl@example.com' and as_host;
set role authenticated;

-- Removing a co-host takes away their job leads too.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$ begin
  delete from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000003';
  assert not exists (select 1 from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000003'),
         'the Account Host removes a co-host';
  assert not exists (select 1 from public.station_leads where user_id = '0000007e-0000-0000-0000-000000000003'),
         'a removed co-host stops leading jobs';
end $$;
-- A co-host can leave on their own.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000006","email":"tmpast@example.com"}';
do $$ begin
  delete from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000006' and organization_id = '7d000000-0000-0000-0000-000000000001';
  assert not exists (select 1 from public.organization_members where user_id = '0000007e-0000-0000-0000-000000000006'
                       and organization_id = '7d000000-0000-0000-0000-000000000001'), 'a co-host can stop being a co-host';
end $$;

-- Test helper: an offer's token from its id (offer_account_host returns the id; the token
-- itself is never readable from the browser). Dropped at the end of the handing-on tests.
reset role;
create function public.test_handoff_token(p_id uuid) returns uuid language sql security definer set search_path = public
  as $f$ select token from account_host_handoffs where id = p_id $f$;
grant execute on function public.test_handoff_token(uuid) to authenticated;
set role authenticated;
-- Handing the account on: only the Account Host offers, only to a co-host, and only they accept.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000002');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a co-host can''t take the account';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000004');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'the account goes only to a co-host';
  perform set_config('tm.handoff', public.test_handoff_token(public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000002'))::text, false);
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.accept_account_host(current_setting('tm.handoff')::uuid);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'only the co-host it''s for can accept';
  assert not (select for_you from public.get_account_host_offer(current_setting('tm.handoff')::uuid)), 'and the link isn''t theirs';
  assert (select organization from public.get_account_host_offer(current_setting('tm.handoff')::uuid)) is null,
         'someone else learns nothing about the account from the link';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$ begin
  perform public.accept_account_host(current_setting('tm.handoff')::uuid);
  assert (select role from public.organization_members where organization_id = '7d000000-0000-0000-0000-000000000001'
            and user_id = '0000007e-0000-0000-0000-000000000002') = 'owner', 'the co-host becomes the Account Host';
  assert (select role from public.organization_members where organization_id = '7d000000-0000-0000-0000-000000000001'
            and user_id = '0000007e-0000-0000-0000-000000000001') = 'admin', 'and the old Account Host stays on as a co-host';
end $$;

-- ---------------------------------------------------------------------------
-- My team part 3 (20270120000000): Undo after removing, and handing on the role.
-- The Account Host is now tmco1 (…02); tmowner (…01) is a co-host; tmvl (…04) is the
-- Volunteer Lead of Spring Fair (…e1).
-- ---------------------------------------------------------------------------
reset role;
insert into public.station_leads (station_id, user_id, event_id)
values ('7d000000-0000-0000-0000-0000000000b1', '0000007e-0000-0000-0000-000000000004', '7d000000-0000-0000-0000-0000000000e1')
on conflict do nothing;
set role authenticated;
-- The Account Host removes the Volunteer Lead (who leads Ring toss), then undoes it.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$ begin
  delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000004' and event_id = '7d000000-0000-0000-0000-0000000000e1';
  assert not exists (select 1 from public.station_leads where user_id = '0000007e-0000-0000-0000-000000000004'), 'removing takes their jobs';
end $$;
reset role;
select set_config('tm.undo', (select id from public.team_removals where user_id = '0000007e-0000-0000-0000-000000000004'
                                and event_id = '7d000000-0000-0000-0000-0000000000e1' and role = 'volunteer_director')::text, false);
do $$ begin
  assert exists (select 1 from public.team_removal_jobs where removal_id = current_setting('tm.undo')::uuid),
         'the removal remembers the jobs they led';
end $$;
set role authenticated;
-- Someone else can't undo it, and nobody can read what the removal noted.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array[current_setting('tm.undo')::uuid]);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only whoever removed them can undo it';
  ok := false;
  begin
    perform 1 from public.team_removal_jobs;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'what a removal noted is server-only';
  ok := false;
  begin
    perform 1 from public.team_removal_notices;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'who was emailed is server-only';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$ begin
  perform public.undo_team_removals(array[current_setting('tm.undo')::uuid]);
  assert exists (select 1 from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000004'
                   and event_id = '7d000000-0000-0000-0000-0000000000e1' and role = 'volunteer_director'), 'Undo puts them back';
  assert exists (select 1 from public.station_leads where user_id = '0000007e-0000-0000-0000-000000000004'
                   and station_id = '7d000000-0000-0000-0000-0000000000b1'), 'with the jobs they led';
end $$;
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array[current_setting('tm.undo')::uuid]);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a second Undo finds nothing';
end $$;
-- After 10 minutes, Undo is refused.
do $$ begin
  delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000004' and event_id = '7d000000-0000-0000-0000-0000000000e1';
end $$;
reset role;
update public.team_removals set removed_at = now() - interval '11 minutes'
 where user_id = '0000007e-0000-0000-0000-000000000004' and event_id = '7d000000-0000-0000-0000-0000000000e1';
select set_config('tm.undo', (select id from public.team_removals where user_id = '0000007e-0000-0000-0000-000000000004'
                                and event_id = '7d000000-0000-0000-0000-0000000000e1')::text, false);
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array[current_setting('tm.undo')::uuid]);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'Undo ends after 10 minutes';
end $$;
-- Someone who left on their own can't be "undone" back in, even by themselves.
reset role;
select set_config('tm.left', (select id from public.team_removals where user_id = '0000007e-0000-0000-0000-000000000006'
                               and organization_id = '7d000000-0000-0000-0000-000000000001' and role = 'co_host')::text, false);
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000006","email":"tmpast@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array[current_setting('tm.left')::uuid]);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'leaving on your own can''t be undone';
end $$;
-- Invited again since: Undo is refused (the invitation decides).
reset role;
insert into public.event_staff (event_id, user_id, role)
values ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000004', 'volunteer_director');
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$ begin
  delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000004' and event_id = '7d000000-0000-0000-0000-0000000000e1';
end $$;
reset role;
insert into public.invitations (event_id, email, role, invited_by)
values ('7d000000-0000-0000-0000-0000000000e1', 'tmvl@example.com', 'volunteer_director', '0000007e-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array(select id from public.team_removals
      where user_id = '0000007e-0000-0000-0000-000000000004' and event_id = '7d000000-0000-0000-0000-0000000000e1'));
  exception when sqlstate 'P0001' then ok := sqlerrm like '%invited again%';
  end;
  assert ok, 'someone invited again since can''t be undone back in';
end $$;
reset role;
delete from public.invitations where event_id = '7d000000-0000-0000-0000-0000000000e1' and email = 'tmvl@example.com';
insert into public.event_staff (event_id, user_id, role)
values ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000003', 'section_lead');
set role authenticated;
-- One Undo is for one person: removals of two people can't be undone together.
do $$ begin
  delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000003' and event_id = '7d000000-0000-0000-0000-0000000000e1';
end $$;
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array(select id from public.team_removals
      where organization_id = '7d000000-0000-0000-0000-000000000001' and removed_by = '0000007e-0000-0000-0000-000000000002'
        and removed_at > now() - interval '10 minutes'
        and user_id in ('0000007e-0000-0000-0000-000000000004', '0000007e-0000-0000-0000-000000000003')));
  exception when sqlstate 'P0001' then ok := sqlerrm like '%one person%';
  end;
  assert ok, 'Undo puts back one person at a time';
end $$;
-- The team filled up after the removal: Undo is refused (it would go over the plan's spots).
reset role;
select set_config('tm.max_team', coalesce((public.package_tier('7d000000-0000-0000-0000-000000000001')).max_team::text, ''), false);
set session_replication_role = replica;
update public.plan_tiers set max_team = (select count(*) from public.org_team('7d000000-0000-0000-0000-000000000001'))
 where code = (public.package_tier('7d000000-0000-0000-0000-000000000001')).code;
set session_replication_role = origin;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array(select id from public.team_removals
      where user_id = '0000007e-0000-0000-0000-000000000004' and event_id = '7d000000-0000-0000-0000-0000000000e1'));
  exception when sqlstate 'P0001' then ok := sqlerrm like '%filled up%';
  end;
  assert ok, 'Undo can''t go over the plan''s team spots';
end $$;
reset role;
set session_replication_role = replica;
update public.plan_tiers set max_team = nullif(current_setting('tm.max_team'), '')::int
 where code = (public.package_tier('7d000000-0000-0000-0000-000000000001')).code;
set session_replication_role = origin;
-- The remover lost the role that let them remove someone: Undo is refused.
insert into public.event_staff (event_id, user_id, role) values
  ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000004', 'volunteer_director'),
  ('7d000000-0000-0000-0000-0000000000e1', '0000007e-0000-0000-0000-000000000003', 'section_lead');
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$ begin
  delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000003' and event_id = '7d000000-0000-0000-0000-0000000000e1';
  assert found, 'the Volunteer Lead removes a Coordinator';
end $$;
reset role;
delete from public.event_staff where user_id = '0000007e-0000-0000-0000-000000000004' and event_id = '7d000000-0000-0000-0000-0000000000e1';
select set_config('tm.undo', (select id from public.team_removals where user_id = '0000007e-0000-0000-0000-000000000003'
                                and event_id = '7d000000-0000-0000-0000-0000000000e1' and removed_by = '0000007e-0000-0000-0000-000000000004')::text, false);
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    perform public.undo_team_removals(array[current_setting('tm.undo')::uuid]);
  exception when insufficient_privilege then ok := sqlerrm like '%own role has changed%';
  end;
  assert ok, 'someone who has since lost their role can''t undo';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';

-- Handing on: an offer is closed by its own token, by the Account Host (withdrawn) or the
-- person it's for (declined), and by nobody else.
do $$ begin
  perform set_config('tm.handoff', public.test_handoff_token(public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000001'))::text, false);
end $$;
reset role;
do $$ begin
  assert (select expires_at from public.account_host_handoffs where token = current_setting('tm.handoff')::uuid)
       = ((((now() at time zone 'America/Chicago')::date + 15)::timestamp) at time zone 'America/Chicago'),
         'an offer is open to the end of the 14th day in the account''s time zone';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$
declare ok boolean := false;
begin
  assert public.my_account_host_offer('7d000000-0000-0000-0000-000000000001') = current_setting('tm.handoff')::uuid,
         'the person it''s for can get their link';
  begin
    perform token from public.account_host_handoffs;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'offer tokens stay on the server';
  assert public.close_account_host_offer(current_setting('tm.handoff')::uuid) = 'declined', 'the person it''s for declines it';
end $$;
-- An open offer ends when that co-host is removed, and Undo doesn't bring it back.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$
declare ok boolean := false;
begin
  perform set_config('tm.handoff', public.test_handoff_token(public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000001'))::text, false);
  delete from public.organization_members where organization_id = '7d000000-0000-0000-0000-000000000001'
     and user_id = '0000007e-0000-0000-0000-000000000001';
  assert (select closed_reason from public.account_host_handoffs where organization_id = '7d000000-0000-0000-0000-000000000001'
            and to_user = '0000007e-0000-0000-0000-000000000001' order by created_at desc limit 1) = 'left',
         'removing the co-host ends the offer';
  perform public.undo_team_removals(array[(select id from public.team_removals where organization_id = '7d000000-0000-0000-0000-000000000001'
                                             and user_id = '0000007e-0000-0000-0000-000000000001' and role = 'co_host')]);
  assert exists (select 1 from public.organization_members where organization_id = '7d000000-0000-0000-0000-000000000001'
                   and user_id = '0000007e-0000-0000-0000-000000000001' and role = 'admin'), 'Undo puts a co-host back';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.accept_account_host(current_setting('tm.handoff')::uuid);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'the ended offer stays ended after Undo';
end $$;
-- Someone not involved can't close an offer.
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$ begin
  perform set_config('tm.handoff', public.test_handoff_token(public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000001'))::text, false);
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000004","email":"tmvl@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.close_account_host_offer(current_setting('tm.handoff')::uuid);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only the Account Host or the person it''s for can close an offer';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$ begin
  assert public.close_account_host_offer(current_setting('tm.handoff')::uuid) = 'withdrawn', 'the Account Host withdraws it';
end $$;
-- Withdraw and decline say which they mean, so a stale page can't do the other.
do $$
declare ok boolean := false;
begin
  perform set_config('tm.handoff', public.test_handoff_token(public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000001'))::text, false);
  begin
    perform public.close_account_host_offer(current_setting('tm.handoff')::uuid, 'declined');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'the Account Host can''t decline their own offer';
  assert public.my_account_host_offer('7d000000-0000-0000-0000-000000000001') is null, 'the offer''s token is only for the person it''s for';
end $$;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000001","email":"tmowner@example.com"}';
do $$
declare o record;
begin
  assert public.my_account_host_offer('7d000000-0000-0000-0000-000000000001') = current_setting('tm.handoff')::uuid, 'the person it''s for gets its token';
  select * into o from public.get_account_host_offer(current_setting('tm.handoff')::uuid);
  assert o.open and o.closed_reason is null and o.current_host is not null and not o.host_now, 'the link shows the open offer and who has the role';
  assert public.accept_account_host(current_setting('tm.handoff')::uuid) = '7d000000-0000-0000-0000-000000000001', 'accepting returns the account';
  assert public.accept_account_host(current_setting('tm.handoff')::uuid) is null, 'accepting again changes nothing (so nobody is emailed twice)';
  select * into o from public.get_account_host_offer(current_setting('tm.handoff')::uuid);
  assert o.accepted and o.host_now, 'the link then shows it was accepted';
  -- An offer that runs out shows as expired.
  perform set_config('tm.handoff', public.test_handoff_token(public.offer_account_host('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000002'))::text, false);
end $$;
reset role;
update public.account_host_handoffs set expires_at = now() - interval '1 minute' where token = current_setting('tm.handoff')::uuid;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$
declare o record;
begin
  select * into o from public.get_account_host_offer(current_setting('tm.handoff')::uuid);
  assert not o.open and o.closed_reason = 'expired', 'an offer that ran out says it expired';
end $$;
-- Signed-out visitors can't read offers at all.
set role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform 1 from public.account_host_handoffs;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'offers aren''t readable signed out';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform last_sent_at from public.account_host_handoffs;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'when an offer email went out is server-only';
end $$;
-- An offer from someone who is no longer the Account Host can't be accepted.
reset role;
update public.account_host_handoffs set cancelled_at = now(), closed_reason = 'withdrawn'
 where organization_id = '7d000000-0000-0000-0000-000000000001' and accepted_at is null and cancelled_at is null;
insert into public.account_host_handoffs (organization_id, to_user, offered_by)
values ('7d000000-0000-0000-0000-000000000001', '0000007e-0000-0000-0000-000000000002', '0000007e-0000-0000-0000-000000000003');
select set_config('tm.handoff', (select token from public.account_host_handoffs where organization_id = '7d000000-0000-0000-0000-000000000001'
                                   and accepted_at is null and cancelled_at is null)::text, false);
set role authenticated;
set request.jwt.claims = '{"sub":"0000007e-0000-0000-0000-000000000002","email":"tmco1@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.accept_account_host(current_setting('tm.handoff')::uuid);
  exception when sqlstate 'P0001' then ok := sqlerrm like '%Account Host has changed%';
  end;
  assert ok, 'an offer from a former Account Host can''t be accepted';
  assert (select role from public.organization_members where organization_id = '7d000000-0000-0000-0000-000000000001'
            and user_id = '0000007e-0000-0000-0000-000000000002') = 'admin', 'and nothing changed';
end $$;
reset role;
reset role;
drop function public.test_handoff_token(uuid);
delete from public.organizations where id = '7d000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Packages page (20270114000000): only admins change what a package includes or
-- a pass's price; each change is checked and logged.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_package('free', '{conference,band_contest}', '{}', 2, false, false, null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t change a package';
  ok := false;
  begin
    perform public.admin_set_pass_price('pass_fair', 1, null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t change a pass price';
  ok := false;
  begin
    perform public.admin_package_impact('free', 'band_contest', 'yes');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t see package impact';
end $$;
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare ok boolean := false; before public.plan_tiers;
begin
  select * into before from public.plan_tiers where code = 'schedule';
  perform public.admin_update_package('schedule', '{conference,meeting,volunteer,band_contest}', '{volunteer}', 3, false, false, 'test');
  assert (select 'band_contest' = any (event_types) and max_team = 3 from public.plan_tiers where code = 'schedule'), 'an admin changes a package';
  assert exists (select 1 from public.admin_log where action = 'package_edited' and details ->> 'code' = 'schedule'), 'and it''s logged';
  assert (public.admin_package_impact('schedule', 'band_contest', 'no') ->> 'accounts') is not null, 'an admin sees the impact';
  begin
    perform public.admin_update_package('schedule', '{conference}', '{volunteer}', 2, false, false, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'one at a time must be an included type';
  ok := false;
  begin
    perform public.admin_update_package('schedule', '{conference,rocket_launch}', '{}', 2, false, false, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'only real event types';
  ok := false;
  perform public.admin_update_package('schedule', before.event_types, before.one_at_a_time, before.max_team, before.event_staff, before.volunteer_history, 'put back');
  perform public.admin_set_pass_price('pass_fair', 12000, 'test');
  assert (select price_cents from public.plan_tiers where code = 'pass_fair') = 12000, 'an admin changes a pass price';
  perform public.admin_set_pass_price('pass_fair', 10000, 'put back');
  -- Rename and price a package; teacher prices only stick where the package has a teacher rate.
  perform public.admin_update_package_details('volunteer', 'Volunteer Plus', 2500, 25000, 1000, 10000, 'test');
  assert (select name = 'Volunteer Plus' and price_year_cents = 25000 and teacher_year_cents is null from public.plan_tiers where code = 'volunteer'),
         'an admin renames and prices a package (one rate, no teacher price)';
  perform public.admin_update_package_details('schedule', 'Schedule Command', 900, 9000, 500, 5000, 'test');
  assert (select teacher_year_cents = 5000 from public.plan_tiers where code = 'schedule'), 'Schedule Command has a teacher rate';
  begin
    perform public.admin_update_package_details('volunteer', 'Event Command', null, null, null, null, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'two packages can''t share a name';
  perform public.admin_update_package_details('volunteer', 'Volunteer Command', null, null, null, null, 'put back');
  perform public.admin_update_package_details('schedule', 'Schedule Command', null, null, null, null, 'put back');
end $$;
reset role;
delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';

-- New packages and retiring them (20270127000000_package_create_retire.sql).
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"host@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_create_package('Sneaky Command', 'event', null);
  exception when sqlstate '42501' then ok := true;
  end;
  assert ok, 'a host can''t create a package';
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare
  made text;
  ok boolean := false;
begin
  made := public.admin_create_package('Booster Command', 'event', 'test');
  assert made = 'booster_command', 'the code comes from the name';
  assert (select n.event_types = t.event_types and n.max_team is not distinct from t.max_team and n.volunteer_history = t.volunteer_history
                 and n.price_month_cents is null and n.price_year_cents is null and n.retired_at is null
            from public.plan_tiers n, public.plan_tiers t where n.code = 'booster_command' and t.code = 'event'),
         'a new package copies what its starting package includes, with prices not set';
  begin
    perform public.admin_create_package('booster command', 'event', null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'two packages can''t share a name';
  ok := false;
  begin
    perform public.admin_create_package('Pass Copy', 'pass_fair', null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a package starts from a package, not a pass';
  ok := false;
  begin
    perform public.admin_set_package_retired('free', true, null);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'Free, Free Teacher, and Event Command can''t be retired';
end $$;
reset role;
-- An account on the package before it's retired keeps it.
select set_config('app.package_change', 'on', false);
update public.organizations set package = 'booster_command' where id = :'org_id';
select set_config('app.package_change', '', false);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.admin_set_package_retired('booster_command', true, 'test');
reset role;
do $$
declare ok boolean := false;
begin
  assert (select retired_at is not null from public.plan_tiers where code = 'booster_command'), 'retired';
  assert (select count(*) from public.organizations where package = 'booster_command') = 1, 'the account on it keeps it';
  perform set_config('app.package_change', 'on', false);
  update public.organizations set rate = rate where package = 'booster_command';
  begin
    update public.organizations set package = 'booster_command'
     where id = (select id from public.organizations where package <> 'booster_command' limit 1);
  exception when sqlstate 'P0001' then ok := true;
  end;
  perform set_config('app.package_change', '', false);
  assert ok, 'a retired package can''t be given to another account';
  ok := false;
  begin
    insert into public.host_invitations (email, package) values ('retired-pkg@example.com', 'booster_command');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'or to an invitation';
end $$;
-- An invitation sent before the package was retired still starts its host on it.
do $$
declare
  inv public.host_invitations;
  org uuid;
  ok boolean := false;
begin
  insert into public.organizations (name, slug) values ('Promised Boosters', 'promised-boosters-test') returning id into org;
  inv.email := 'promised@example.com';
  inv.package := 'booster_command';
  perform public.apply_invitation_plan(org, inv);
  assert (select package = 'booster_command' from public.organizations where id = org),
         'an invitation sent before retiring still gives its package';
  delete from public.organizations where id = org;
  -- A pilot request's plan can't be newly set to it.
  begin
    update public.pilot_requests set planned_package = 'booster_command' where id = (select id from public.pilot_requests limit 1);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok or not exists (select 1 from public.pilot_requests), 'or to a pilot request''s plan';
end $$;
-- An account already on it can still change only its rate.
select set_config('test.retired_org', (select id::text from public.organizations where package = 'booster_command' limit 1), false);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
do $$
declare org uuid := current_setting('test.retired_org')::uuid;
begin
  perform public.set_account_package(org, 'booster_command', 'teacher', 'rate only', 'admin');
  perform public.set_account_package(org, 'booster_command', 'standard', 'put back', 'admin');
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.admin_log where action = 'package_changed' and details ->> 'note' = 'rate only'),
         'changing only the rate keeps a retired package';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.admin_set_package_retired('booster_command', false, 'test');
reset role;
do $$ begin
  assert (select retired_at is null from public.plan_tiers where code = 'booster_command'), 'and it can be brought back';
  assert exists (select 1 from public.admin_log where action = 'package_created' and details ->> 'code' = 'booster_command'),
         'creating is logged';
  assert exists (select 1 from public.admin_log where action = 'package_retired' and details ->> 'code' = 'booster_command'),
         'retiring is logged';
end $$;
select set_config('app.package_change', 'on', false);
update public.organizations set package = 'event' where id = :'org_id';
select set_config('app.package_change', '', false);
delete from public.plan_tiers where code = 'booster_command';
delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';


-- ---------------------------------------------------------------------------
-- Co-hosts of one event (20270128000100): access to their event only, until 10 days after it;
-- only the Account Host adds, changes, or removes co-hosts, and deletes events; "From your team";
-- taking a co-host of every event off one event, Undo, and Change.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000008c-0000-0000-0000-000000000001', 'ecowner@example.com', '{"full_name":"Eve Owner"}'),
  ('0000008c-0000-0000-0000-000000000002', 'ecevery@example.com', '{"full_name":"Al Every"}'),
  ('0000008c-0000-0000-0000-000000000003', 'econe@example.com', '{"full_name":"Di One"}'),
  ('0000008c-0000-0000-0000-000000000004', 'ecvl@example.com', '{"full_name":"Jo Lead"}'),
  ('0000008c-0000-0000-0000-000000000005', 'ecother@example.com', '{"full_name":"Ot Other"}');
update public.profiles set phone = '+15555550101' where id::text like '0000008c%';
insert into public.organizations (id, name, slug, subscription_status, free_until)
values ('8c000000-0000-0000-0000-000000000001', 'Event Cohost Boosters', 'ec-boosters', 'comped', date '2099-01-01');
insert into public.organization_members (organization_id, user_id, role) values
  ('8c000000-0000-0000-0000-000000000001', '0000008c-0000-0000-0000-000000000001', 'owner'),
  ('8c000000-0000-0000-0000-000000000001', '0000008c-0000-0000-0000-000000000002', 'admin');
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, timezone) values
  ('8c000000-0000-0000-0000-0000000000e1', '8c000000-0000-0000-0000-000000000001', 'Drumline', 'ec-drumline', 'draft', 'volunteer',
   current_date + 20, current_date + 20, now() + interval '20 days', now() + interval '20 days 6 hours', '1 Band Rd', 'America/Chicago'),
  ('8c000000-0000-0000-0000-0000000000e2', '8c000000-0000-0000-0000-000000000001', 'Spring Concert', 'ec-spring', 'draft', 'volunteer',
   current_date + 60, current_date + 60, now() + interval '60 days', now() + interval '60 days 6 hours', '1 Band Rd', 'America/Chicago'),
  ('8c000000-0000-0000-0000-0000000000e3', '8c000000-0000-0000-0000-000000000001', 'Old Car Wash', 'ec-old', 'draft', 'volunteer',
   current_date - 20, current_date - 20, now() - interval '20 days', now() - interval '20 days' + interval '6 hours', '1 Band Rd', 'America/Chicago'),
  ('8c000000-0000-0000-0000-0000000000e4', '8c000000-0000-0000-0000-000000000001', 'Throwaway', 'ec-throwaway', 'draft', 'volunteer',
   current_date + 90, current_date + 90, now() + interval '90 days', now() + interval '90 days 6 hours', '1 Band Rd', 'America/Chicago');
insert into public.stations (id, event_id, name) values
  ('8c000000-0000-0000-0000-0000000000b1', '8c000000-0000-0000-0000-0000000000e1', 'Parking');
insert into public.event_staff (event_id, user_id, role) values
  ('8c000000-0000-0000-0000-0000000000e1', '0000008c-0000-0000-0000-000000000004', 'volunteer_director'),
  ('8c000000-0000-0000-0000-0000000000e2', '0000008c-0000-0000-0000-000000000005', 'section_lead');
insert into public.station_leads (station_id, user_id, event_id)
values ('8c000000-0000-0000-0000-0000000000b1', '0000008c-0000-0000-0000-000000000002', '8c000000-0000-0000-0000-0000000000e1');
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000006') on conflict do nothing;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","email":"stranger@example.com"}';
select public.set_account_package('8c000000-0000-0000-0000-000000000001', 'event', 'standard', null, 'admin');
reset role;
delete from public.platform_admins where user_id = '00000000-0000-0000-0000-000000000006';

-- A co-host of every event can't invite or add a co-host of one event.
set role authenticated;
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000002","email":"ecevery@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.invitations (event_id, email, role, invited_by)
    values ('8c000000-0000-0000-0000-0000000000e1', 'econe@example.com', 'co_host', '0000008c-0000-0000-0000-000000000002');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only the Account Host invites a co-host of one event';
  ok := false;
  begin
    perform public.add_team_member('8c000000-0000-0000-0000-0000000000e1', '0000008c-0000-0000-0000-000000000004', 'co_host');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only the Account Host adds a co-host from the team';
  -- Co-hosts of every event no longer delete events.
  delete from public.events where id = '8c000000-0000-0000-0000-0000000000e4';
  assert exists (select 1 from public.events where id = '8c000000-0000-0000-0000-0000000000e4'), 'a co-host can''t delete an event';
end $$;

-- The Account Host invites Di to co-host Drumline only; Di accepts.
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000001","email":"ecowner@example.com"}';
insert into public.invitations (event_id, email, role, invited_by)
values ('8c000000-0000-0000-0000-0000000000e1', 'econe@example.com', 'co_host', '0000008c-0000-0000-0000-000000000001');
reset role;
select set_config('test.ec_token', (select token::text from public.invitations where email = 'econe@example.com'), false);
set role authenticated;
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000003","email":"econe@example.com"}';
select public.accept_invitation(current_setting('test.ec_token')::uuid) \g /dev/null
do $$
declare ok boolean := false; n int;
begin
  assert public.is_event_admin('8c000000-0000-0000-0000-0000000000e1'), 'a co-host of one event hosts it';
  assert not public.is_event_admin('8c000000-0000-0000-0000-0000000000e2'), 'but not the account''s other events';
  assert not public.is_org_admin('8c000000-0000-0000-0000-000000000001'), 'and isn''t an account host';
  assert not exists (select 1 from public.events where id = '8c000000-0000-0000-0000-0000000000e2'), 'they can''t see other drafts';
  assert not exists (select 1 from public.organization_members where organization_id = '8c000000-0000-0000-0000-000000000001'),
         'they can''t read the account''s members';
  assert not exists (select 1 from public.event_staff where event_id = '8c000000-0000-0000-0000-0000000000e2'),
         'or other events'' teams';
  -- They run the event: edit it, but not move it to another account, or delete it.
  update public.events set name = 'Drumline Invitational' where id = '8c000000-0000-0000-0000-0000000000e1';
  assert (select name from public.events where id = '8c000000-0000-0000-0000-0000000000e1') = 'Drumline Invitational', 'they can edit it';
  begin
    update public.events set organization_id = '7d000000-0000-0000-0000-000000000001' where id = '8c000000-0000-0000-0000-0000000000e1';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'they can''t move it to another account';
  delete from public.events where id = '8c000000-0000-0000-0000-0000000000e1';
  assert exists (select 1 from public.events where id = '8c000000-0000-0000-0000-0000000000e1'), 'or delete it';
  -- The hosts: names and emails, no phone numbers but their own.
  select count(*) into n from public.event_hosts('8c000000-0000-0000-0000-0000000000e1') h where h.phone is not null;
  assert n = 1, 'a co-host of one event sees only their own phone number';
  -- From your team: only this event's people.
  assert not exists (select 1 from public.team_options('8c000000-0000-0000-0000-0000000000e1') o
                      where o.user_id in ('0000008c-0000-0000-0000-000000000005', '0000008c-0000-0000-0000-000000000002')),
         'their team list shows only people on this event';
  ok := false;
  begin
    perform public.add_team_member('8c000000-0000-0000-0000-0000000000e1', '0000008c-0000-0000-0000-000000000005', 'section_lead');
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'they can''t add someone from another event';
  ok := false;
  begin
    insert into public.invitations (event_id, email, role, invited_by)
    values ('8c000000-0000-0000-0000-0000000000e1', 'ecnew@example.com', 'co_host', '0000008c-0000-0000-0000-000000000003');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'they can''t invite co-hosts';
  ok := false;
  begin
    perform public.team_spots('8c000000-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'or see the account''s team count';
end $$;

-- A co-host of every event can't remove a co-host of one event; the Account Host can see them and add from the team.
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000002","email":"ecevery@example.com"}';
do $$ begin
  delete from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000003';
  assert exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000003'),
         'only the Account Host removes a co-host of one event';
end $$;
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000001","email":"ecowner@example.com"}';
do $$
declare n int;
begin
  select count(*) into n from public.event_hosts('8c000000-0000-0000-0000-0000000000e1');
  assert n = 3, 'the Account Host sees all three hosts of the event';
  assert exists (select 1 from public.team_options('8c000000-0000-0000-0000-0000000000e1') o
                  where o.user_id = '0000008c-0000-0000-0000-000000000005' and o.event_id = '8c000000-0000-0000-0000-0000000000e2'),
         'the Account Host''s team list includes other events'' people';
  -- Making the Volunteer Lead a co-host replaces the Volunteer Lead role.
  perform public.add_team_member('8c000000-0000-0000-0000-0000000000e1', '0000008c-0000-0000-0000-000000000004', 'co_host');
  assert (select array_agg(role::text) from public.event_staff
           where user_id = '0000008c-0000-0000-0000-000000000004' and event_id = '8c000000-0000-0000-0000-0000000000e1') = array['co_host'],
         'co-host replaces Volunteer Lead';
  assert not exists (select 1 from public.team_removals where user_id = '0000008c-0000-0000-0000-000000000004'),
         'and isn''t recorded as a removal';
end $$;

-- Taking the co-host of every event off Drumline: they keep the other open events, one by one; Undo restores.
do $$
declare rid uuid;
begin
  rid := public.remove_cohost_from_event('8c000000-0000-0000-0000-0000000000e1', '0000008c-0000-0000-0000-000000000002');
  assert not exists (select 1 from public.organization_members where user_id = '0000008c-0000-0000-0000-000000000002'),
         'off one event, they''re no longer a co-host of every event';
  assert exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000002'
                  and event_id = '8c000000-0000-0000-0000-0000000000e2' and role = 'co_host'), 'they stay on Spring Concert';
  assert not exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000002'
                      and event_id = '8c000000-0000-0000-0000-0000000000e1'), 'and are off Drumline';
  assert not exists (select 1 from public.station_leads where user_id = '0000008c-0000-0000-0000-000000000002'),
         'their job on Drumline needs a new Coordinator';
  assert (select count(*) from public.team_removals where user_id = '0000008c-0000-0000-0000-000000000002') = 1,
         'one removal is recorded (Drumline)';
  perform public.undo_team_removals(array[rid]);
  assert exists (select 1 from public.organization_members where user_id = '0000008c-0000-0000-0000-000000000002' and role = 'admin'),
         'Undo makes them a co-host of every event again';
  assert not exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000002'),
         'without the one-event rows';
  assert exists (select 1 from public.station_leads where user_id = '0000008c-0000-0000-0000-000000000002'),
         'and back on their job';
  -- Change: a co-host of one event to every event, and back to one.
  perform public.change_cohost('8c000000-0000-0000-0000-000000000001', '0000008c-0000-0000-0000-000000000003', 'every');
  assert exists (select 1 from public.organization_members where user_id = '0000008c-0000-0000-0000-000000000003'),
         'Change makes them a co-host of every event';
  assert not exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000003'), 'with no one-event row';
  perform public.change_cohost('8c000000-0000-0000-0000-000000000001', '0000008c-0000-0000-0000-000000000003', 'only',
                               '8c000000-0000-0000-0000-0000000000e1');
  assert not exists (select 1 from public.organization_members where user_id = '0000008c-0000-0000-0000-000000000003'),
         'and back to one event';
  assert exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000003' and role = 'co_host'),
         'on Drumline';
  -- The Account Host deletes events.
  delete from public.events where id = '8c000000-0000-0000-0000-0000000000e4';
  assert not exists (select 1 from public.events where id = '8c000000-0000-0000-0000-0000000000e4'), 'the Account Host deletes events';
end $$;

-- A co-host of one event can leave; access ends 10 days after their event.
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000004","email":"ecvl@example.com"}';
do $$ begin
  delete from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000004';
  assert not exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000004'),
         'a co-host of one event can leave';
end $$;
reset role;
insert into public.event_staff (event_id, user_id, role)
values ('8c000000-0000-0000-0000-0000000000e3', '0000008c-0000-0000-0000-000000000005', 'co_host');
set role authenticated;
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000005","email":"ecother@example.com"}';
do $$ begin
  assert not public.is_event_admin('8c000000-0000-0000-0000-0000000000e3'), 'access ends 10 days after the event';
end $$;
-- Light-check fixes (20270128000200): the Account Host's name, volunteer history like a Volunteer Lead, no
-- account-wide lists, no changing co-hosts, and leaving until access ends.
reset role;
update public.events set ends_on = current_date - 3, starts_on = current_date - 3 where id = '8c000000-0000-0000-0000-0000000000e3';
insert into public.event_staff (event_id, user_id, role)
values ('8c000000-0000-0000-0000-0000000000e3', '0000008c-0000-0000-0000-000000000004', 'co_host');
set role authenticated;
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000003","email":"econe@example.com"}';
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.account_host('8c000000-0000-0000-0000-000000000001')) = 1,
         'a co-host of one event can see who the Account Host is';
  assert public.can_see_volunteer_history('8c000000-0000-0000-0000-000000000001'),
         'a co-host of one event sees volunteer history, like a Volunteer Lead';
  assert not exists (select 1 from public.past_band_directors('8c000000-0000-0000-0000-0000000000e1')),
         'but not the account''s past band directors';
  begin
    perform public.change_cohost('8c000000-0000-0000-0000-000000000001', '0000008c-0000-0000-0000-000000000003', 'every');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a co-host of one event can''t change co-hosts (even themself)';
  ok := false;
  begin
    perform public.remove_cohost_from_event('8c000000-0000-0000-0000-0000000000e1', '0000008c-0000-0000-0000-000000000002');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'or take a co-host of every event off an event';
end $$;
set request.jwt.claims = '{"sub":"0000008c-0000-0000-0000-000000000004","email":"ecvl@example.com"}';
do $$ begin
  assert public.is_event_admin('8c000000-0000-0000-0000-0000000000e3'), 'three days after the event, a co-host still has access';
  delete from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000004';
  assert not exists (select 1 from public.event_staff where user_id = '0000008c-0000-0000-0000-000000000004'),
         'and can stop co-hosting until it ends';
end $$;
reset role;
delete from public.organizations where id = '8c000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Sponsors add-on (20270201000000): only a platform admin flips the switch; writes only by the event's hosts,
-- with the add-on on, on band contests, festivals, and fairs; at most 4 levels and one Presented by; moves
-- across levels; removing a level moves its sponsors; the public sees only published, shown, kept sponsors
-- with the add-on on; reuse only from events the person hosts; copying a contest or festival brings no
-- sponsors; and the daily cleanup.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0000005b-0000-0000-0000-000000000001', 'sphost@example.com', '{"full_name":"Sia Host"}'),
  ('0000005b-0000-0000-0000-000000000002', 'splead@example.com', '{"full_name":"Lou Lead"}'),
  ('0000005b-0000-0000-0000-000000000003', 'spother@example.com', '{"full_name":"Oz Other"}'),
  ('0000005b-0000-0000-0000-000000000004', 'spadmin@example.com', '{"full_name":"Ada Admin"}');
insert into public.organizations (id, name, slug, subscription_status, free_until) values
  ('5b000000-0000-0000-0000-000000000001', 'Sponsor Boosters', 'sp-boosters', 'comped', date '2099-01-01'),
  ('5b000000-0000-0000-0000-000000000002', 'Other Sponsor Boosters', 'sp-other-boosters', 'comped', date '2099-01-01');
insert into public.organization_members (organization_id, user_id, role) values
  ('5b000000-0000-0000-0000-000000000001', '0000005b-0000-0000-0000-000000000001', 'owner'),
  ('5b000000-0000-0000-0000-000000000002', '0000005b-0000-0000-0000-000000000003', 'owner');
insert into public.platform_admins (user_id) values ('0000005b-0000-0000-0000-000000000004');
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000004","email":"spadmin@example.com"}';
select public.set_account_package('5b000000-0000-0000-0000-000000000001', 'event', 'standard', null, 'admin');
select public.set_account_package('5b000000-0000-0000-0000-000000000002', 'event', 'standard', null, 'admin');
reset role;
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, timezone) values
  ('5b000000-0000-0000-0000-0000000000e1', '5b000000-0000-0000-0000-000000000001', 'Marching Classic', 'sp-band', 'draft', 'band_contest',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 8 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000e2', '5b000000-0000-0000-0000-000000000001', 'Marching Classic 2025', 'sp-band-2025', 'published', 'band_contest',
   current_date - 300, current_date - 300, now() - interval '300 days', now() - interval '300 days' + interval '8 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000e3', '5b000000-0000-0000-0000-000000000001', 'Choir Festival', 'sp-fest', 'draft', 'group_event',
   current_date + 60, current_date + 60, now() + interval '60 days', now() + interval '60 days 8 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000e4', '5b000000-0000-0000-0000-000000000001', 'Car Wash', 'sp-vol', 'draft', 'volunteer',
   current_date + 20, current_date + 20, now() + interval '20 days', now() + interval '20 days 4 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000e6', '5b000000-0000-0000-0000-000000000001', 'Marching Classic 2027', 'sp-band-2027', 'draft', 'band_contest',
   current_date + 400, current_date + 400, now() + interval '400 days', now() + interval '400 days 8 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000e7', '5b000000-0000-0000-0000-000000000001', 'Choir Festival 2027', 'sp-fest-2027', 'draft', 'group_event',
   current_date + 420, current_date + 420, now() + interval '420 days', now() + interval '420 days 8 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000e9', '5b000000-0000-0000-0000-000000000002', 'Other Classic', 'sp-other', 'published', 'band_contest',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 8 hours', '1 Band Rd', 'America/Chicago');
insert into public.event_staff (event_id, user_id, role)
values ('5b000000-0000-0000-0000-0000000000e1', '0000005b-0000-0000-0000-000000000002', 'volunteer_director');

-- With the add-on off, the host can't add sponsors; and only a platform admin flips the switch.
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$
declare ok boolean := false;
begin
  assert not public.sponsors_enabled('5b000000-0000-0000-0000-000000000001'), 'the add-on starts off';
  begin
    perform public.save_sponsor('5b000000-0000-0000-0000-0000000000e1', null, 'Ridge Line Pizza');
  exception when raise_exception then ok := true;
  end;
  assert ok, 'with the add-on off, sponsors can''t be added';
  ok := false;
  begin
    perform public.admin_set_sponsors('5b000000-0000-0000-0000-000000000001', true, null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a host can''t turn the add-on on';
  ok := false;
  begin
    update public.organizations set sponsors_on = true where id = '5b000000-0000-0000-0000-000000000001';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'or flip the column directly';
end $$;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000004","email":"spadmin@example.com"}';
select public.admin_set_sponsors('5b000000-0000-0000-0000-000000000001', true, 'Asked by the president');
select public.admin_set_sponsors('5b000000-0000-0000-0000-000000000002', true, null);
reset role;
do $$ begin
  assert (select sponsors_on and sponsors_on_since is not null and sponsors_on_by = '0000005b-0000-0000-0000-000000000004'
            from public.organizations where id = '5b000000-0000-0000-0000-000000000001'), 'on, since when, and by whom';
  assert exists (select 1 from public.admin_log where organization_id = '5b000000-0000-0000-0000-000000000001'
                   and action = 'sponsors_turned_on' and details ->> 'note' = 'Asked by the president'), 'turning it on is logged';
end $$;

-- The host sets up levels (at most 4) and sponsors (one Presented by).
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$
declare
  ev constant uuid := '5b000000-0000-0000-0000-0000000000e1';
  ok boolean := false;
  gold uuid; silver uuid; bronze uuid; friend uuid;
  a uuid; b uuid; c uuid; d uuid;
  r jsonb;
begin
  assert public.sponsors_enabled('5b000000-0000-0000-0000-000000000001'), 'the host sees the add-on is on';
  -- Before any level: no level needed. The first level takes everyone in.
  a := public.save_sponsor(ev, null, 'Ridge Line Pizza', p_website => 'https://ridgelinepizza.example',
         p_logo_path => '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e1/5b000000-0000-0000-0000-0000000000f1/master.png',
         p_logo_width => 1200, p_logo_height => 400, p_presented_by => true);
  assert (select level_id from public.sponsors where id = a) is null, 'no level before there are levels';
  gold := public.save_sponsor_level(ev, null, 'Gold');
  assert (select level_id from public.sponsors where id = a) = gold, 'the first level takes existing sponsors';
  silver := public.save_sponsor_level(ev, null, 'Silver');
  bronze := public.save_sponsor_level(ev, null, 'Bronze');
  b := public.save_sponsor(ev, null, 'Hill Country Credit Union', gold);
  c := public.save_sponsor(ev, null, 'Cedar Music Co.', null, 'Friend');
  friend := (select level_id from public.sponsors where id = c);
  assert (select name from public.sponsor_levels where id = friend) = 'Friend', 'a new level from the add window';
  begin
    perform public.save_sponsor_level(ev, null, 'Patron');
  exception when raise_exception then ok := true;
  end;
  assert ok, 'a fifth level is refused';
  ok := false;
  begin
    perform public.save_sponsor(ev, null, 'Two Rivers Coffee', null, 'Patron');
  exception when raise_exception then ok := true;
  end;
  assert ok, 'and a fifth from the add window too';
  ok := false;
  begin
    perform public.save_sponsor(ev, null, 'No Level Inc');
  exception when raise_exception then ok := true;
  end;
  assert ok, 'with levels, a sponsor needs one';
  ok := false;
  begin
    perform public.save_sponsor(ev, null, 'Sketchy Links', silver, p_website => 'http://sketchy.example');
  exception when check_violation then ok := true;
  end;
  assert ok, 'websites are https only (the database checks too)';
  ok := false;
  begin
    perform public.save_sponsor(ev, null, 'Wrong Folder', silver,
      p_logo_path => '5b000000-0000-0000-0000-000000000002/5b000000-0000-0000-0000-0000000000e9/5b000000-0000-0000-0000-0000000000f1/master.png',
      p_logo_width => 600, p_logo_height => 200);
  exception when raise_exception then ok := true;
  end;
  assert ok, 'a logo must be in this event''s own folder';

  -- Presented by: one per event; choosing another replaces it; a hidden sponsor can't be picked.
  d := public.save_sponsor(ev, null, 'Oak Street Dental', silver, p_presented_by => true);
  assert (select count(*) from public.sponsors where event_id = ev and presented_by) = 1, 'one Presented by per event';
  assert (select presented_by from public.sponsors where id = d), 'the new one replaces the old';
  perform public.set_presented_by(ev, a);
  assert (select presented_by from public.sponsors where id = a) and not (select presented_by from public.sponsors where id = d), 'Change Presented by';
  perform public.set_sponsor_shown(d, false);
  ok := false;
  begin
    perform public.set_presented_by(ev, d);
  exception when raise_exception then ok := true;
  end;
  assert ok, 'a hidden sponsor can''t be Presented by';
  perform public.set_sponsor_shown(d, true);

  -- Moves: within a level, then across into the next or previous level.
  r := public.move_sponsor(b, 'up');
  assert (r ->> 'place')::int = 1 and not (r ->> 'crossed')::boolean, 'up within Gold';
  r := public.move_sponsor(b, 'up');
  assert not (r ->> 'moved')::boolean, 'the very first can''t go up';
  r := public.move_sponsor(a, 'down');
  assert (r ->> 'crossed')::boolean and r ->> 'level_name' = 'Silver' and (r ->> 'place')::int = 1, 'down from the bottom of Gold goes to the top of Silver';
  assert (select position from public.sponsors where id = d) = 2, 'Silver''s others move down one';
  r := public.move_sponsor(a, 'up');
  assert (r ->> 'crossed')::boolean and r ->> 'level_name' = 'Gold' and (r ->> 'place')::int = 2, 'and up from the top of Silver goes to the bottom of Gold';
  r := public.move_sponsor(c, 'down');
  assert not (r ->> 'moved')::boolean, 'the very last can''t go down';

  -- Levels: reorder; remove one by choosing where its sponsors go.
  perform public.move_sponsor_level(friend, 'up');
  assert (select position from public.sponsor_levels where id = friend) = 3, 'a level moves up';
  ok := false;
  begin
    perform public.remove_sponsor_level(silver, null);
  exception when raise_exception then ok := true;
  end;
  assert ok, 'removing a level with sponsors needs a level for them';
  perform public.remove_sponsor_level(silver, bronze);
  assert (select level_id from public.sponsors where id = d) = bronze, 'its sponsors move in one step';
  assert (select count(*) from public.sponsor_levels where event_id = ev) = 3, 'and the level is gone';
  assert (select string_agg(name, ',' order by position) from public.sponsor_levels where event_id = ev) = 'Gold,Friend,Bronze', 'levels renumbered';

  -- Remove and Undo; Presented by comes back with it if nobody took it.
  perform public.remove_sponsor(a);
  assert (select removed_at is not null from public.sponsors where id = a), 'removed (kept for Undo)';
  r := public.restore_sponsor(a);
  assert (r ->> 'presented_by')::boolean and (select removed_at is null from public.sponsors where id = a), 'Undo brings it back as Presented by';
  perform public.remove_sponsor(a);
  perform public.set_presented_by(ev, b);
  r := public.restore_sponsor(a);
  assert not (r ->> 'presented_by')::boolean, 'Undo after someone else became Presented by leaves them';
  assert (select count(*) from public.sponsors where event_id = ev and presented_by and removed_at is null) = 1, 'still one Presented by';
  perform public.set_presented_by(ev, a);
  perform public.set_sponsor_shown(c, false);

  -- Not on other kinds of events.
  ok := false;
  begin
    perform public.save_sponsor('5b000000-0000-0000-0000-0000000000e4', null, 'Ridge Line Pizza');
  exception when raise_exception then ok := true;
  end;
  assert ok, 'no sponsors on a volunteer event';
end $$;
reset role;
do $$
declare ok boolean := false;
begin
  begin
    insert into public.sponsors (event_id, level_id, name, presented_by)
    values ('5b000000-0000-0000-0000-0000000000e1', (select id from public.sponsor_levels where name = 'Gold' and event_id = '5b000000-0000-0000-0000-0000000000e1'),
            'Second Title Sponsor', true);
  exception when unique_violation then ok := true;
  end;
  assert ok, 'the database refuses a second Presented by';
end $$;

-- Nobody else reads or writes them: not a Volunteer Lead of the event, not another account's host, not anon.
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000002","email":"splead@example.com"}';
do $$
declare ok boolean := false;
begin
  assert not exists (select 1 from public.sponsors), 'a Volunteer Lead reads no sponsors';
  assert not exists (select 1 from public.sponsor_levels), 'or levels';
  assert not public.sponsors_enabled('5b000000-0000-0000-0000-000000000001'), 'and isn''t told about the add-on';
  begin
    perform public.save_sponsor('5b000000-0000-0000-0000-0000000000e1', null, 'Lead''s Pick', (select null::uuid));
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'a Volunteer Lead can''t add sponsors';
end $$;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000003","email":"spother@example.com"}';
do $$
declare
  ok boolean := false;
  victim uuid;
begin
  assert not exists (select 1 from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e1'), 'another account''s host reads none';
  begin
    perform public.save_sponsor('5b000000-0000-0000-0000-0000000000e1', null, 'Intruder Inc');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'another account''s host can''t add sponsors';
  ok := false;
  begin
    perform public.remove_sponsor('00000000-0000-0000-0000-000000000000');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'or remove one';
  ok := false;
  begin
    perform public.reuse_sponsors('5b000000-0000-0000-0000-0000000000e9', '5b000000-0000-0000-0000-0000000000e1');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'or copy another account''s sponsors into their own event';
  assert not exists (select 1 from public.sponsor_reuse_sources('5b000000-0000-0000-0000-0000000000e9')), 'and isn''t offered them';
end $$;
reset role;
-- A Volunteer Lead and another account's host can't change a specific sponsor either.
do $$ begin perform set_config('sp.victim', (select id::text from public.sponsors where name = 'Hill Country Credit Union'), false); end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000002","email":"splead@example.com"}';
do $$
declare ok int := 0;
begin
  begin perform public.remove_sponsor(current_setting('sp.victim')::uuid); exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.move_sponsor(current_setting('sp.victim')::uuid, 'down'); exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.set_sponsor_shown(current_setting('sp.victim')::uuid, false); exception when insufficient_privilege then ok := ok + 1; end;
  assert ok = 3, 'a Volunteer Lead can''t remove, move, or hide a sponsor';
end $$;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000003","email":"spother@example.com"}';
do $$
declare ok int := 0;
begin
  begin perform public.remove_sponsor(current_setting('sp.victim')::uuid); exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.set_presented_by('5b000000-0000-0000-0000-0000000000e1', null); exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.save_sponsor_level('5b000000-0000-0000-0000-0000000000e1', null, 'Platinum'); exception when insufficient_privilege then ok := ok + 1; end;
  assert ok = 3, 'another account''s host can''t remove a sponsor, change Presented by, or add a level';
end $$;
reset role;

-- The public read: nothing on a draft (its hosts can preview), nothing hidden or removed, nothing with the add-on off.
set role anon;
set request.jwt.claims = '';
do $$ begin
  assert not exists (select 1 from public.public_sponsors('sp-band')), 'anon sees nothing on a draft';
end $$;
do $$
declare ok boolean := false;
begin
  begin
    perform 1 from public.sponsors;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon can''t read the sponsors table';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$ begin
  assert (select count(*) from public.public_sponsors('sp-band')) = 3, 'the host previews the draft''s showing sponsors';
end $$;
reset role;
update public.events set status = 'published' where id = '5b000000-0000-0000-0000-0000000000e1';
set role anon;
do $$ begin
  assert (select count(*) from public.public_sponsors('sp-band')) = 3, 'published: anon sees the showing sponsors';
  assert not exists (select 1 from public.public_sponsors('sp-band') where name = 'Cedar Music Co.'), 'not the hidden one';
  assert (select name from public.public_sponsors('sp-band') where presented_by) = 'Ridge Line Pizza', 'Presented by';
  assert (select level_rank from public.public_sponsors('sp-band') where name = 'Ridge Line Pizza') = 0, 'Gold is the first level';
  assert (select logo_version from public.public_sponsors('sp-band') where name = 'Ridge Line Pizza') = '5b000000-0000-0000-0000-0000000000f1',
         'the logo''s version, not its path';
  -- The logo route's one check: that sponsor, that version, on that page.
  assert (select published from public.public_sponsor_logo('sp-band', (select id from public.public_sponsors('sp-band') where name = 'Ridge Line Pizza'),
          '5b000000-0000-0000-0000-0000000000f1')), 'a shown logo is served, cacheable once published';
  assert not exists (select 1 from public.public_sponsor_logo('sp-band', (select id from public.public_sponsors('sp-band') where name = 'Ridge Line Pizza'),
          '5b000000-0000-0000-0000-0000000000f9')), 'not an old version';
  assert not exists (select 1 from public.public_sponsor_logo('sp-other', (select id from public.public_sponsors('sp-band') where name = 'Ridge Line Pizza'),
          '5b000000-0000-0000-0000-0000000000f1')), 'and not through another event''s page';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
select public.remove_sponsor((select id from public.sponsors where name = 'Oak Street Dental'));
reset role;
set role anon;
do $$ begin
  assert not exists (select 1 from public.public_sponsors('sp-band') where name = 'Oak Street Dental'), 'removed sponsors don''t show';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000004","email":"spadmin@example.com"}';
select public.admin_set_sponsors('5b000000-0000-0000-0000-000000000001', false, null);
reset role;
set role anon;
do $$ begin
  assert not exists (select 1 from public.public_sponsors('sp-band')), 'with the add-on off, nothing shows';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e1') = 4, 'but every sponsor is kept';
  assert exists (select 1 from public.admin_log where organization_id = '5b000000-0000-0000-0000-000000000001' and action = 'sponsors_turned_off'), 'turning it off is logged';
end $$;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e1') = 4, 'the host still sees them (kept)';
  begin
    perform public.set_sponsor_shown((select id from public.sponsors where name = 'Cedar Music Co.'), true);
  exception when raise_exception then ok := true;
  end;
  assert ok, 'but can''t change them while it''s off';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000004","email":"spadmin@example.com"}';
select public.admin_set_sponsors('5b000000-0000-0000-0000-000000000001', true, null);
reset role;

-- Reuse: last year's sponsors and levels, only from events the person hosts; duplicates skipped; 4 levels at most.
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$
declare
  last constant uuid := '5b000000-0000-0000-0000-0000000000e2';
  fest constant uuid := '5b000000-0000-0000-0000-0000000000e3';
  g uuid; s uuid; f uuid;
  r jsonb;
  ok boolean := false;
begin
  g := public.save_sponsor_level(last, null, 'Gold');
  s := public.save_sponsor_level(last, null, 'Silver');
  f := public.save_sponsor_level(last, null, 'Friends of the Band');
  perform public.save_sponsor(last, null, 'Ridge Line Pizza', g, p_presented_by => true,
    p_logo_path => '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e2/5b000000-0000-0000-0000-0000000000f2/master.jpg',
    p_logo_width => 900, p_logo_height => 300);
  perform public.save_sponsor(last, null, 'Big Sky Roofing', s);
  perform public.save_sponsor(last, null, 'Two Rivers Coffee', f, p_show => false);
  perform public.save_sponsor(last, null, 'Kolache Corner', f);

  assert (select count(*) from public.sponsor_reuse_sources(fest) where event_id = last and same_kind is false) = 1, 'other events the host runs are offered';
  -- Into the festival (no levels yet): year two brings the levels and the sponsors, none as Presented by, all showing.
  r := public.reuse_sponsors(fest, last, null, '{}', true);
  assert (r ->> 'added')::int = 4 and (r ->> 'skipped')::int = 0, 'all four come along';
  assert (select string_agg(name, ',' order by position) from public.sponsor_levels where event_id = fest) = 'Gold,Silver,Friends of the Band', 'with the levels, in order';
  assert not exists (select 1 from public.sponsors where event_id = fest and (presented_by or not show_public)), 'not Presented by, and showing';
  assert jsonb_array_length(r -> 'logos') = 1
         and (r -> 'logos' -> 0 ->> 'to') like '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e3/%/master.jpg',
         'the logo is copied into the new event''s folder';
  assert (select copied_from is not null from public.sponsors where event_id = fest and name = 'Big Sky Roofing'), 'remembers where it came from';
  r := public.reuse_sponsors(fest, last, null, '{}', true);
  assert (r ->> 'added')::int = 0 and (r ->> 'skipped')::int = 4, 'a second time, all are skipped as duplicates';
  assert (select count(*) from public.sponsor_levels where event_id = fest) = 3, 'and no levels are doubled';

  -- Into this year's contest (4 levels, the most): a level that doesn't match must be picked.
  perform public.save_sponsor_level('5b000000-0000-0000-0000-0000000000e1', null, 'Silver');
  begin
    perform public.reuse_sponsors('5b000000-0000-0000-0000-0000000000e1', last, null, '{}', false);
  exception when raise_exception then ok := true;
  end;
  assert ok, 'with 4 levels, an unmatched level needs a choice';
  r := public.reuse_sponsors('5b000000-0000-0000-0000-0000000000e1', last, null,
         jsonb_build_object('Friends of the Band', (select id from public.sponsor_levels where event_id = '5b000000-0000-0000-0000-0000000000e1' and name = 'Friend')), false);
  assert (r ->> 'skipped')::int = 1, 'Ridge Line Pizza is already there (same name)';
  assert (select count(*) from public.sponsor_levels where event_id = '5b000000-0000-0000-0000-0000000000e1') = 4, 'still 4 levels';
  assert (select l.name from public.sponsors sp join public.sponsor_levels l on l.id = sp.level_id
           where sp.event_id = '5b000000-0000-0000-0000-0000000000e1' and sp.name = 'Kolache Corner') = 'Friend', 'the picked level is used';
  assert (select l.name from public.sponsors sp join public.sponsor_levels l on l.id = sp.level_id
           where sp.event_id = '5b000000-0000-0000-0000-0000000000e1' and sp.name = 'Big Sky Roofing') = 'Silver', 'matched by name';
  assert not exists (select 1 from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e1' and copied_from is not null and show_public),
         'on a published event, copies arrive hidden so the organizer can check first';
  assert (select logo_path is null from public.sponsors where event_id = fest and name = 'Ridge Line Pizza'),
         'a copied logo isn''t attached until its files are copied';

  -- Not from another account's event the host doesn't run.
  ok := false;
  begin
    perform public.reuse_sponsors('5b000000-0000-0000-0000-0000000000e1', '5b000000-0000-0000-0000-0000000000e9');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'reuse only from events the person hosts';
end $$;

-- Copying last year's contest or festival brings no sponsors or levels.
do $$ begin
  perform public.copy_band_contest_setup('5b000000-0000-0000-0000-0000000000e2', '5b000000-0000-0000-0000-0000000000e6');
  perform public.copy_group_event_setup('5b000000-0000-0000-0000-0000000000e3', '5b000000-0000-0000-0000-0000000000e7');
  assert not exists (select 1 from public.sponsors where event_id in ('5b000000-0000-0000-0000-0000000000e6', '5b000000-0000-0000-0000-0000000000e7')),
         'copying a contest or festival brings no sponsors';
  assert not exists (select 1 from public.sponsor_levels where event_id in ('5b000000-0000-0000-0000-0000000000e6', '5b000000-0000-0000-0000-0000000000e7')),
         'or levels';
end $$;
reset role;

-- Reuse uses only this event's levels, stays inside the account (even for a co-host of another account's event),
-- and attaches a copied logo only to its own copy, in this event's folder.
insert into public.event_staff (event_id, user_id, role)
values ('5b000000-0000-0000-0000-0000000000e9', '0000005b-0000-0000-0000-000000000001', 'co_host');
insert into public.sponsors (event_id, name) values ('5b000000-0000-0000-0000-0000000000e9', 'Other Account Pizza');
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$
declare
  ok boolean := false;
  cp uuid;
  gold_there constant uuid := (select id from public.sponsor_levels where event_id = '5b000000-0000-0000-0000-0000000000e2' and name = 'Gold');
begin
  perform public.save_sponsor('5b000000-0000-0000-0000-0000000000e7', null, 'Lone Star Sheet Music');
  begin
    perform public.reuse_sponsors('5b000000-0000-0000-0000-0000000000e1', '5b000000-0000-0000-0000-0000000000e7', null, jsonb_build_object('', gold_there), false);
  exception when raise_exception then ok := sqlerrm = 'That level isn''t on this event.';
  end;
  assert ok, 'a level from another event can''t be used, even for sponsors with no level';
  ok := false;
  begin
    perform public.remove_sponsor_level((select id from public.sponsor_levels where event_id = '5b000000-0000-0000-0000-0000000000e1' and name = 'Friend'), gold_there);
  exception when raise_exception then ok := true;
  end;
  assert ok, 'removing a level moves its sponsors only to a level on the same event';

  assert public.is_event_admin('5b000000-0000-0000-0000-0000000000e9'), 'the host co-hosts another account''s event';
  assert not exists (select 1 from public.sponsor_reuse_sources('5b000000-0000-0000-0000-0000000000e1') where event_id = '5b000000-0000-0000-0000-0000000000e9'),
         'but isn''t offered its sponsors';
  ok := false;
  begin
    perform public.reuse_sponsors('5b000000-0000-0000-0000-0000000000e1', '5b000000-0000-0000-0000-0000000000e9');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'or able to copy them into their own account';

  cp := (select id from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e3' and name = 'Ridge Line Pizza');
  ok := false;
  begin
    perform public.attach_reused_sponsor_logo(cp, '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e1/5b000000-0000-0000-0000-0000000000f3/master.jpg');
  exception when raise_exception then ok := true;
  end;
  assert ok, 'a copied logo goes only in its own event''s folder';
  ok := false;
  begin
    perform public.attach_reused_sponsor_logo((select id from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e7' and name = 'Lone Star Sheet Music'),
      '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e7/5b000000-0000-0000-0000-0000000000f3/master.jpg');
  exception when raise_exception then ok := true;
  end;
  assert ok, 'and only on a sponsor copied with a logo';
  perform public.attach_reused_sponsor_logo(cp, '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e3/5b000000-0000-0000-0000-0000000000f3/master.jpg');
  assert (select logo_width = 900 and logo_height = 300 and logo_path like '%/5b000000-0000-0000-0000-0000000000f3/master.jpg' from public.sponsors where id = cp),
         'attached with the size of the logo it came from';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000003","email":"spother@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.attach_reused_sponsor_logo((select id from public.sponsors where name = 'Ridge Line Pizza' and event_id = '5b000000-0000-0000-0000-0000000000e3'), null);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'another account''s host can''t attach a logo to this account''s sponsor';
end $$;
reset role;

-- Cleanup: removed sponsors after a day, and files nothing points to.
update public.sponsors set removed_at = now() - interval '2 days' where name = 'Oak Street Dental';
do $$ begin perform set_config('sp.purged', (select id::text from public.sponsors where name = 'Oak Street Dental'), false); end $$;
insert into storage.objects (bucket_id, name, created_at) values
  ('sponsor-logos', '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e1/5b000000-0000-0000-0000-0000000000f1/master.png', now() - interval '3 days'),
  ('sponsor-logos', '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e1/5b000000-0000-0000-0000-0000000000f1/t0.png', now() - interval '3 days'),
  ('sponsor-logos', '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e1/5b000000-0000-0000-0000-0000000000f9/t0.png', now() - interval '3 days'),
  ('sponsor-logos', '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e1/5b000000-0000-0000-0000-0000000000f8/t0.png', now()),
  ('sponsor-logos', 'uploads/5b000000-0000-0000-0000-0000000000e1/old.png', now() - interval '2 days'),
  ('org-logos', 'somewhere/else.png', now() - interval '3 days');
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.purge_removed_sponsors();
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only the daily job purges';
end $$;
reset role;
set role service_role;
do $$ begin
  assert public.purge_removed_sponsors() = 1, 'a sponsor removed over a day ago is deleted';
  assert not exists (select 1 from public.sponsors where name = 'Oak Street Dental'), 'gone';
  assert (select array_agg(o order by o) from public.sponsor_logo_orphans() o) = array[
           '5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000e1/5b000000-0000-0000-0000-0000000000f9/t0.png',
           'uploads/5b000000-0000-0000-0000-0000000000e1/old.png'],
         'orphans: an unused version and an old upload, not files in use or made today';
end $$;
reset role;
-- Sponsors whose logo file is missing show by name (an hour after their last change).
update public.sponsors set updated_at = now() - interval '2 hours';
set role service_role;
do $$ begin
  assert public.clear_missing_sponsor_logos() >= 2, 'logos whose files are missing are cleared';
  assert (select logo_path is null and logo_width is null from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e2' and name = 'Ridge Line Pizza'),
         'last year''s, whose file was never stored';
  assert (select logo_path is not null from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e1' and name = 'Ridge Line Pizza'),
         'not one whose file is there';
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000001","email":"sphost@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.clear_missing_sponsor_logos();
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'only the daily job clears missing logos';
  ok := false;
  begin
    perform public.restore_sponsor(current_setting('sp.purged')::uuid);
  exception when sqlstate 'P0002' then ok := sqlerrm = 'That sponsor was removed for good.';
  end;
  assert ok, 'Undo after the daily cleanup says it was removed for good';
end $$;
reset role;
-- Demo mode's sample sponsors: server only; only on band contests, festivals, and fairs with the add-on on; once,
-- never beside the event's own sponsors; and gone again (levels too) when the demo ends.
insert into public.events (id, organization_id, name, slug, status, event_type, starts_on, ends_on, window_start, window_end, venue_address, timezone)
values
  ('5b000000-0000-0000-0000-0000000000d1', '5b000000-0000-0000-0000-000000000001', 'Demo Classic', 'sp-demo-band', 'draft', 'band_contest',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 8 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000d2', '5b000000-0000-0000-0000-000000000001', 'Demo Fair', 'sp-demo-fair', 'draft', 'fair',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 8 hours', '1 Band Rd', 'America/Chicago'),
  ('5b000000-0000-0000-0000-0000000000d3', '5b000000-0000-0000-0000-000000000001', 'Demo Car Wash', 'sp-demo-vol', 'draft', 'volunteer',
   current_date + 30, current_date + 30, now() + interval '30 days', now() + interval '30 days 8 hours', '1 Band Rd', 'America/Chicago');
insert into public.demo_events (owner_id, event_id)
select '0000005b-0000-0000-0000-000000000004', id from public.events where id::text like '5b000000-0000-0000-0000-0000000000d_';
-- The fair already has its own sponsor (and a level of its own).
insert into public.sponsor_levels (id, event_id, name, position) values ('5b000000-0000-0000-0000-0000000001d2', '5b000000-0000-0000-0000-0000000000d2', 'Booth hosts', 1);
insert into public.sponsors (event_id, level_id, name) values ('5b000000-0000-0000-0000-0000000000d2', '5b000000-0000-0000-0000-0000000001d2', 'Fair Own Sponsor');
update public.organizations set sponsors_on = true where id = '5b000000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claims = '{"sub":"0000005b-0000-0000-0000-000000000004","email":"spadmin@example.com"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.demo_seed_sponsors('0000005b-0000-0000-0000-000000000004', '5b000000-0000-0000-0000-0000000000d1', '["Gold"]', '[{"name":"Fake"}]');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'even a platform admin''s browser can''t add sample sponsors';
end $$;
reset role;

set role service_role;
do $$
declare
  owner constant uuid := '0000005b-0000-0000-0000-000000000004';
  band  constant uuid := '5b000000-0000-0000-0000-0000000000d1';
  fair  constant uuid := '5b000000-0000-0000-0000-0000000000d2';
  lv    jsonb := '["Gold", "Silver", "Bronze", "Friends", "Fifth"]';
  sp    jsonb := '[{"name": "Harbor Lane Credit Union", "level": 0, "presented_by": true, "website": "https://example.com/harbor-lane",
                    "logo_path": "5b000000-0000-0000-0000-000000000001/5b000000-0000-0000-0000-0000000000d1/0d000000-0000-0000-0000-000000000001/master.png",
                    "logo_width": 900, "logo_height": 300},
                   {"name": "Bluebird Bakery", "level": 1},
                   {"name": "Summit Music Supply", "level": 2, "presented_by": true},
                   {"name": "The Okafor Family", "level": 3}]';
  ok boolean := false;
begin
  begin
    perform public.demo_seed_sponsors(owner, '5b000000-0000-0000-0000-0000000000e1', lv, sp);
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'no sample sponsors without demo mode on';

  assert not public.demo_seed_sponsors(owner, '5b000000-0000-0000-0000-0000000000d3', lv, sp), 'a volunteer event gets none';
  assert not public.demo_seed_sponsors(owner, fair, lv, sp), 'an event with its own sponsors gets none';
  assert (select count(*) from public.sponsors where event_id = fair) = 1, 'the fair keeps only its own';

  assert public.demo_seed_sponsors(owner, band, lv, sp), 'a band contest with the add-on on gets them';
  assert not public.demo_seed_sponsors(owner, band, lv, sp), 'once';
  assert (select count(*) from public.sponsor_levels where event_id = band) = 4, 'at most four levels';
  assert (select count(*) from public.sponsors where event_id = band) = 4, 'every sample sponsor';
  assert (select count(*) from public.sponsors where event_id = band and presented_by) = 1, 'one Presented by';
  assert (select presented_by and logo_width = 900 and level_id = (select id from public.sponsor_levels where event_id = band and name = 'Gold')
            from public.sponsors where event_id = band and name = 'Harbor Lane Credit Union'), 'in its level, with its logo';
  assert (select count(*) from public.demo_samples where event_id = band and kind in ('sponsor', 'sponsor_level')) = 8, 'all on the list';
end $$;
reset role;

-- The add-on off: nothing is added.
delete from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000d2';
update public.organizations set sponsors_on = false where id = '5b000000-0000-0000-0000-000000000001';
set role service_role;
do $$ begin
  assert not public.demo_seed_sponsors('0000005b-0000-0000-0000-000000000004', '5b000000-0000-0000-0000-0000000000d2', '["Gold"]', '[{"name": "Bluebird Bakery", "level": 0}]'),
         'none with the add-on off';
end $$;
reset role;
update public.organizations set sponsors_on = true where id = '5b000000-0000-0000-0000-000000000001';
set role service_role;
do $$
declare
  owner constant uuid := '0000005b-0000-0000-0000-000000000004';
  band  constant uuid := '5b000000-0000-0000-0000-0000000000d1';
  fair  constant uuid := '5b000000-0000-0000-0000-0000000000d2';
begin
  -- With levels of its own (and no sponsors), the samples go into them; no new levels.
  assert public.demo_seed_sponsors(owner, fair, '["Gold", "Silver"]', '[{"name": "Bluebird Bakery", "level": 0}, {"name": "Northgate Hardware", "level": 1}]'),
         'a fair whose sponsors are gone gets samples';
  assert (select count(*) from public.sponsor_levels where event_id = fair) = 1, 'in its own level';
  assert (select count(*) from public.sponsors where event_id = fair and level_id = '5b000000-0000-0000-0000-0000000001d2') = 2, 'both of them';

  -- Something the admin adds during the demo, in a sample level, stays when the demo ends.
  insert into public.sponsors (event_id, level_id, name)
  select band, id, 'Added During Demo' from public.sponsor_levels where event_id = band and name = 'Silver';
  perform public.demo_leave(owner, band);
  perform public.demo_leave(owner, fair);
  assert (select count(*) from public.sponsors where event_id = band) = 1, 'sample sponsors are gone';
  assert (select level_id is null from public.sponsors where event_id = band), 'what the admin added stays, with no level';
  assert not exists (select 1 from public.sponsor_levels where event_id = band), 'sample levels are gone';
  assert not exists (select 1 from public.sponsors where event_id = fair), 'the fair''s samples are gone';
  assert exists (select 1 from public.sponsor_levels where event_id = fair), 'its own level stays';
  assert not exists (select 1 from public.demo_samples where event_id in (band, fair)), 'nothing left on the list';
end $$;
reset role;
delete from public.events where id::text like '5b000000-0000-0000-0000-0000000000d_';

-- Deleting an event deletes its sponsors (their files become orphans).
delete from public.events where id = '5b000000-0000-0000-0000-0000000000e1';
do $$ begin
  assert not exists (select 1 from public.sponsors where event_id = '5b000000-0000-0000-0000-0000000000e1'), 'a deleted event''s sponsors go with it';
  assert (select count(*) from public.sponsor_logo_orphans()) = 4, 'and its files are swept';
end $$;
delete from storage.objects where bucket_id in ('sponsor-logos', 'org-logos');
delete from public.organizations where id in ('5b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000002');
delete from public.platform_admins where user_id = '0000005b-0000-0000-0000-000000000004';

\echo 'All database security tests passed.'
