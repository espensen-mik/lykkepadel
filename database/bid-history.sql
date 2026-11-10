-- Public bid history with a bidder-chosen display name.
-- Run after event-registration.sql. The existing registration function is unchanged,
-- so the site keeps working whether this file has been applied or not.
begin;

-- The name shown next to a participant's bids: a nickname, a company name or their real name.
alter table public.auction_profiles
  add column display_name text
  check (display_name is null or (length(display_name) between 2 and 40 and display_name !~ '[[:cntrl:]]'));

-- Two bidders must never appear under the same name.
create unique index auction_profiles_display_name_key
  on public.auction_profiles (lower(display_name))
  where display_name is not null;

-- Set or change the caller's own display name. Requires a bidder profile (created at registration).
create function auction_private.set_display_name(p_name text) returns text
language plpgsql security definer set search_path='' as $$
declare cleaned text;
begin
  if auth.uid() is null then raise exception 'Log ind for at vælge et synligt navn.'; end if;
  cleaned := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if length(cleaned) not between 2 and 40 or cleaned ~ '[[:cntrl:]]' then
    raise exception 'Det synlige navn skal være mellem 2 og 40 tegn.';
  end if;
  perform 1 from public.auction_profiles where user_id = auth.uid() for update;
  if not found then raise exception 'Tilmeld dig, før du vælger et synligt navn.'; end if;
  if exists (select 1 from public.auction_profiles where lower(display_name) = lower(cleaned) and user_id <> auth.uid()) then
    raise exception 'Navnet er allerede i brug. Vælg et andet.';
  end if;
  update public.auction_profiles set display_name = cleaned where user_id = auth.uid();
  insert into auction_private.audit(actor, action, target) values (auth.uid(), 'set_display_name', auth.uid()::text);
  return cleaned;
end; $$;
create function public.set_auction_display_name(p_name text) returns text
language sql security invoker set search_path='' as $$select auction_private.set_display_name(p_name)$$;

-- Bids on a published lot, newest first. Only amount, time and display name are exposed;
-- never user ids or contact details. "is_mine" lets a signed-in bidder recognise their own bids.
create function auction_private.bid_history(p_lot uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'amount', b.amount,
      'created_at', b.created_at,
      'display_name', coalesce(p.display_name, 'Anonym budgiver'),
      'is_mine', coalesce(b.user_id = auth.uid(), false)
    ) order by b.created_at desc, b.amount desc), '[]'::jsonb)
  from auction_private.bids b
  join public.auction_lots l on l.id = b.lot_id
  left join public.auction_profiles p on p.user_id = b.user_id
  where b.lot_id = p_lot and (l.status = 'live' or auction_private.is_admin())
$$;
create function public.auction_bid_history(p_lot uuid) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.bid_history(p_lot)$$;

revoke all on function auction_private.set_display_name(text), public.set_auction_display_name(text),
  auction_private.bid_history(uuid), public.auction_bid_history(uuid) from public, anon, authenticated;
grant execute on function auction_private.set_display_name(text), public.set_auction_display_name(text) to authenticated;
grant execute on function auction_private.bid_history(uuid), public.auction_bid_history(uuid) to anon, authenticated;

commit;
