-- Meetings and conferences: an email the organizer chooses to show when every time is booked
-- (decisions 2026-11-08). Empty by default: nothing about the organizer is shown unless they add it,
-- and the booking page stops showing it once the event is over.
alter table public.conference_settings
  add column contact_email text check (contact_email is null or (char_length(contact_email) <= 200 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
grant insert (contact_email), update (contact_email) on public.conference_settings to authenticated;

-- When a booked meeting was left outside new hours and its people were emailed a link to pick a new
-- time: so later saves never email them again (decisions 2026-11-08, light check). Server only.
alter table public.conference_bookings add column reschedule_requested_at timestamptz;
-- Readable by those who can read the booking (row-level security still applies): Your meetings says
-- who was emailed.
grant select (reschedule_requested_at) on public.conference_bookings to authenticated;

-- The mark is for the time they were emailed about: when the meeting's time changes (they picked a new
-- time, the organizer moved it, or the day moved), it clears, so a later change can email them again
-- (light check, 2026-11-08).
create or replace function public.clear_reschedule_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.reschedule_requested_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_reschedule_request() from public, anon, authenticated;

create trigger conference_bookings_clear_reschedule_request
  before update of starts_at on public.conference_bookings
  for each row execute function public.clear_reschedule_request();
