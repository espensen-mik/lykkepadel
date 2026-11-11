-- Delete cancelled registrations and bidder profiles from the admin.
-- Run once after auction-items.sql. Adds two functions; no tables change.
-- The Supabase Auth login stays; the person can register again later.
begin;

-- Only cancelled registrations can be deleted. Confirmed ones are cancelled first.
create function auction_private.delete_registration(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare target public.event_registrations;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  select * into target from public.event_registrations where id = p_id for update;
  if not found then raise exception 'Tilmeldingen findes ikke.'; end if;
  if target.status <> 'cancelled' then raise exception 'Annuller tilmeldingen, før du sletter den.'; end if;
  delete from public.event_registrations where id = p_id;
  insert into auction_private.audit(actor, action, target, details)
    values(auth.uid(), 'delete_event_registration', p_id::text, jsonb_build_object('name', target.full_name, 'user', target.user_id));
end; $$;
create function public.delete_event_registration(p_id uuid) returns void
language sql security invoker set search_path='' as $$select auction_private.delete_registration(p_id)$$;

-- A bidder can be deleted when they have no bids (so bid history and invoices stay intact)
-- and no confirmed tournament registration.
create function auction_private.delete_bidder(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare target public.auction_profiles;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  select * into target from public.auction_profiles where user_id = p_user for update;
  if not found then raise exception 'Budgiveren findes ikke.'; end if;
  if exists(select 1 from auction_private.bids where user_id = p_user) then
    raise exception 'Budgivere med bud kan ikke slettes. Blokér budgiveren i stedet.';
  end if;
  if exists(select 1 from public.event_registrations where user_id = p_user and status = 'confirmed') then
    raise exception 'Budgiveren er tilmeldt turneringen. Annuller tilmeldingen først.';
  end if;
  delete from public.auction_profiles where user_id = p_user;
  insert into auction_private.audit(actor, action, target, details)
    values(auth.uid(), 'delete_bidder', p_user::text, jsonb_build_object('name', target.full_name));
end; $$;
create function public.delete_auction_bidder(p_user uuid) returns void
language sql security invoker set search_path='' as $$select auction_private.delete_bidder(p_user)$$;

revoke all on function auction_private.delete_registration(uuid), public.delete_event_registration(uuid),
  auction_private.delete_bidder(uuid), public.delete_auction_bidder(uuid) from public, anon, authenticated;
grant execute on function auction_private.delete_registration(uuid), public.delete_event_registration(uuid),
  auction_private.delete_bidder(uuid), public.delete_auction_bidder(uuid) to authenticated;

commit;
