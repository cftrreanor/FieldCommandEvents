-- Handing on the Account Host role: take locks in one order everywhere, so an Account Host
-- changing an offer (or removing the co-host) at the moment the co-host accepts can't deadlock.
-- The order is: the account's member rows (the Account Host's and the co-host's), then the offer.
-- offer_account_host and the removal trigger already follow it; accepting locked the offer first.
-- (Design decisions 2026-11-07, "Later": lock order.)

create or replace function public.accept_account_host(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  h account_host_handoffs;
  org uuid;
  owner_id uuid;
begin
  -- Which account, without locking anything yet.
  select organization_id into org from account_host_handoffs where token = p_token;
  if org is null then
    raise exception 'This link isn''t for your account. Sign in as the person it was sent to.' using errcode = 'P0001';
  end if;
  -- 1. The member rows: the Account Host's and yours, in a fixed order.
  perform 1 from organization_members
   where organization_id = org and (role = 'owner' or user_id = auth.uid())
   order by user_id
     for update;
  -- 2. Then the offer, read again now that nothing can change under it.
  select * into h from account_host_handoffs where token = p_token for update;
  if h.id is null or h.to_user <> auth.uid() then
    raise exception 'This link isn''t for your account. Sign in as the person it was sent to.' using errcode = 'P0001';
  end if;
  -- Already accepted (a second tap, another tab): nothing to do, and null says so.
  if h.accepted_at is not null then
    return null;
  end if;
  if h.cancelled_at is not null or h.expires_at < now() then
    raise exception 'This offer is no longer open. Ask the Account Host to offer it again.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from organization_members where organization_id = h.organization_id and user_id = auth.uid() and role = 'admin') then
    raise exception 'You''re no longer a co-host on this account, so you can''t become its Account Host.' using errcode = 'P0001';
  end if;
  -- Still made by the current Account Host (the role may have changed hands since).
  select m.user_id into owner_id from organization_members m where m.organization_id = h.organization_id and m.role = 'owner';
  if owner_id is distinct from h.offered_by then
    raise exception 'This offer is no longer open: the Account Host has changed. Ask them to offer it again.' using errcode = 'P0001';
  end if;
  update organization_members set role = 'admin' where organization_id = h.organization_id and role = 'owner';
  update organization_members set role = 'owner' where organization_id = h.organization_id and user_id = auth.uid();
  update account_host_handoffs set accepted_at = now() where id = h.id;
  return h.organization_id;
end;
$$;
