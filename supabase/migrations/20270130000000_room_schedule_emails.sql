-- =============================================================================
-- Festival schedule emails: a send list (owner decisions 2026-11-11, "an email send list with retries";
-- docs/design-decisions/2026-11-11-group-festivals.md).
--
-- Posting a festival's schedule, or saving new times once it's posted, emails each group's directors. The
-- page lists who gets one first, then every email is a row here: claimed before it's sent (so two senders never
-- double up), marked sent or failed, and tried again from the page if sending stopped partway. The page reads
-- it to say "Sent to 5 of 6 directors".
--
-- Addresses come from each group's registration (head director and contact), never from the page, so a host
-- can't use this to email anyone else. Safe to run again.
-- =============================================================================

create table if not exists public.room_schedule_emails (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  -- One posting or one save: every email it sends.
  batch        uuid not null,
  kind         text not null check (kind in ('posted', 'changed')),
  band_id      uuid not null references public.bands (id) on delete cascade,
  to_email     citext not null,
  -- "Hi Priya," (the head director's or the registering director's first name), when it's known.
  greet_name   text,
  -- For a change: what changed for this group, in words ("Performance hall 9:10 AM (was 9:00 AM)").
  what_changed text check (what_changed is null or length(what_changed) <= 2000),
  status       text not null default 'waiting' check (status in ('waiting', 'sending', 'sent', 'failed')),
  tries        integer not null default 0,
  error        text check (error is null or length(error) <= 500),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  sent_at      timestamptz,
  unique (batch, band_id, to_email)
);
create index if not exists room_schedule_emails_event on public.room_schedule_emails (event_id, created_at desc);
create index if not exists room_schedule_emails_batch on public.room_schedule_emails (batch, status);
alter table public.room_schedule_emails enable row level security;
revoke all on public.room_schedule_emails from anon, authenticated;
grant all on public.room_schedule_emails to service_role;
grant select on public.room_schedule_emails to authenticated;
drop policy if exists "schedule emails: hosts read" on public.room_schedule_emails;
create policy "schedule emails: hosts read" on public.room_schedule_emails
  for select to authenticated using (public.is_event_admin(event_id));

-- The send list for a posting or a save: each group's directors (head director and contact, once each). Hosts
-- only, a published festival with its schedule posted, and groups registered for it (not withdrawn).
-- p_changes: {band_id: "what changed"} for kind 'changed'. Returns the batch, or null when nobody is on it.
create or replace function public.queue_room_schedule_emails(p_event uuid, p_kind text, p_band_ids uuid[], p_changes jsonb default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  ev  events;
  bid uuid := gen_random_uuid();
  n   integer;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'Only the event''s host can email directors their times.' using errcode = '42501';
  end if;
  select * into ev from events where id = p_event;
  if ev.event_type::text <> 'group_event' or p_kind not in ('posted', 'changed') then
    raise exception 'Schedule emails are for group events.' using errcode = 'P0001';
  end if;
  if ev.status <> 'published' or not ev.performance_order_published then
    raise exception 'Post the schedule before emailing directors their times.' using errcode = 'P0001';
  end if;
  insert into room_schedule_emails (event_id, batch, kind, band_id, to_email, greet_name, what_changed, created_by)
  select p_event, bid, p_kind, a.band_id, a.email, a.greet, left(p_changes ->> a.band_id::text, 2000), auth.uid()
    from (
      select distinct on (b.id, lower(x.email)) b.id as band_id, x.email, x.greet, x.ord
        from bands b
        left join profiles p on p.id = b.director_user_id
        cross join lateral (values
          (b.head_director_email::text, nullif(split_part(btrim(coalesce(b.head_director_name, '')), ' ', 1), ''), 1),
          (b.contact_email::text,
           case when lower(p.email::text) = lower(b.contact_email::text) then nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') end, 2)
        ) as x(email, greet, ord)
       where b.event_id = p_event and b.scratched_at is null and b.id = any (p_band_ids)
         and coalesce(btrim(x.email), '') <> ''
       order by b.id, lower(x.email), x.ord
    ) a;
  get diagnostics n = row_count;
  return case when n > 0 then bid end;
end;
$$;
revoke execute on function public.queue_room_schedule_emails(uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.queue_room_schedule_emails(uuid, text, uuid[], jsonb) to authenticated;

-- Sending stopped partway (or some failed): put the rest of a batch back on the list. Hosts only. Returns how
-- many will be tried again. An email claimed more than 10 minutes ago with no answer counts as stopped.
create or replace function public.retry_room_schedule_emails(p_event uuid, p_batch uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'Only the event''s host can send these again.' using errcode = '42501';
  end if;
  update room_schedule_emails
     set status = 'waiting', error = null
   where event_id = p_event and batch = p_batch
     and (status = 'failed' or (status = 'sending' and claimed_at < now() - interval '10 minutes')
          or (status = 'waiting' and created_at < now() - interval '2 minutes'));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.retry_room_schedule_emails(uuid, uuid) from public, anon;
grant execute on function public.retry_room_schedule_emails(uuid, uuid) to authenticated;
