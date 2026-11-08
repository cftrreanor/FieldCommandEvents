-- Meetings and conferences: an email the organizer chooses to show when every time is booked
-- (decisions 2026-11-08). Empty by default: nothing about the organizer is shown unless they add it,
-- and the booking page stops showing it once the event is over.
alter table public.conference_settings
  add column contact_email text check (contact_email is null or (char_length(contact_email) <= 200 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
grant insert (contact_email), update (contact_email) on public.conference_settings to authenticated;
