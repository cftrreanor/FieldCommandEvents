-- Meetings and conferences: video means one pasted link for everyone (decisions 2026-11-07 and
-- 2026-11-08). "I'll add it to each invite" never reached anyone (the calendar invite comes from us),
-- so it's gone: an event that used it now needs a pasted link, like every other, before it can be
-- published again. Already-published ones stay published; Meeting setup says what's missing.

update public.conference_settings set own_link = false where own_link;
alter table public.conference_settings alter column own_link set default false;

create or replace function public.conference_not_ready(ev uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when not public.is_event_admin(ev) then 'Only the event''s hosts can publish it.'
    when s.event_id is null or s.times_saved_at is null then 'Save your meeting times first.'
    when s.schedule = 'weekly' and jsonb_array_length(s.weekly_hours) = 0 then 'Add your weekly hours first.'
    when s.meeting_modes is null then 'Choose where you''ll meet first.'
    when 'in_person' = any (s.meeting_modes) and coalesce(trim(e.venue_address), '') = ''
      then case when e.event_type::text = 'meeting' then 'Add the address first.' else 'Add your school''s address first.' end
    when 'in_person' = any (s.meeting_modes) and coalesce(trim(s.room), '') = '' then 'Add your room and directions first.'
    when 'video' = any (s.meeting_modes) and s.video_link is null then 'Add your meeting link first.'
    when 'video' = any (s.meeting_modes) and not s.waiting_room_confirmed
      then 'Tick that your meeting has a waiting room and runs the whole time.'
  end
  from events e
  left join conference_settings s on s.event_id = e.id
  where e.id = ev;
$$;
