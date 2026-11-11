-- A co-host of one event (owner, 2026-11-11): a role on that event's team, like Volunteer Leads and
-- Coordinators. Its own migration, because a new enum value can't be used in the transaction that adds it.
alter type public.event_staff_role add value if not exists 'co_host';
