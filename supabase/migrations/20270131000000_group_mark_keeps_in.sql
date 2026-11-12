-- =============================================================================
-- Festivals on the day (build 3, 2026-11-11): marking a group done in a room keeps
-- the mark that it went in, so Undo puts the group back "in since 8:41 AM" with its
-- first time and who marked it, instead of a new time. A group is in a room now when
-- it has an 'in' mark there and no 'done' mark (every reader checks both).
-- Same function as 20270129000000_group_festival_update.sql, without that delete.
-- Safe to run again.
-- =============================================================================

create or replace function public.apply_group_mark(p_event uuid, p_band uuid, p_room uuid, p_kind text, p_on boolean, p_actor text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_kind not in ('in', 'done', 'no_show') or (p_kind = 'in' and p_room is null) or (p_kind = 'no_show' and p_room is not null) then
    raise exception 'That isn''t a mark.' using errcode = 'P0001';
  end if;
  if p_room is not null and not exists (select 1 from rooms where id = p_room and event_id = p_event and path_order is not null) then
    raise exception 'That room isn''t on this event''s path.' using errcode = 'P0001';
  end if;
  if not p_on then
    delete from group_checkins where band_id = p_band and room_id is not distinct from p_room and kind = p_kind;
    return;
  end if;
  insert into group_checkins (event_id, band_id, room_id, kind, created_by, actor_name)
  values (p_event, p_band, p_room, p_kind, auth.uid(), p_actor)
  on conflict do nothing;
  if p_kind <> 'no_show' then
    -- Being in a room (or done there) means the group arrived, and it did come.
    insert into group_checkins (event_id, band_id, room_id, kind, created_by, actor_name)
    values (p_event, p_band, null, 'done', auth.uid(), p_actor)
    on conflict do nothing;
    delete from group_checkins where band_id = p_band and kind = 'no_show';
  end if;
end;
$$;
revoke execute on function public.apply_group_mark(uuid, uuid, uuid, text, boolean, text) from public, anon, authenticated;
