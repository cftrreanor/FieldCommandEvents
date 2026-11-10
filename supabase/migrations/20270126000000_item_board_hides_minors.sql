-- The public "who's bringing what" list shows the first name of each adult bringing something, but never a
-- volunteer under 18: their entry shows only what they're bringing (owner, 2026-11-10). Children's names stay
-- with the event team, as the website promises.
create or replace function public.public_item_board(p_event_id uuid)
returns table (item_id uuid, first_name text, note text)
language sql stable security definer set search_path = public
as $$
  select s.item_id,
         case when v.minor then null else split_part(trim(v.full_name), ' ', 1) end,
         s.note
    from item_signups s
    join volunteers v on v.id = s.volunteer_id
    join events e on e.id = s.event_id
   where s.event_id = p_event_id and e.status = 'published'
   order by s.created_at;
$$;
grant execute on function public.public_item_board(uuid) to anon, authenticated, service_role;
