-- Min side: the signed-in user's own bids, one row per lot.
-- Run after auction-items.sql. Only adds a function; no tables are changed.
begin;

-- For each published lot the user has bid on: their highest bid, the current price and
-- whether they lead. Never returns other bidders' identities.
create function auction_private.my_bids() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', l.id,
      'name', l.name,
      'kind', l.kind,
      'image_url', l.image_url,
      'ends_at', l.ends_at,
      'current_bid', l.current_bid,
      'bid_count', l.bid_count,
      'my_bid', mine.amount,
      'my_bid_count', mine.bids,
      'leading', leader.user_id = auth.uid(),
      'ended', l.ends_at <= clock_timestamp()
    ) order by l.ends_at, l.name), '[]'::jsonb)
  from (
    select lot_id, max(amount) as amount, count(*) as bids
    from auction_private.bids where user_id = auth.uid() group by lot_id
  ) mine
  join public.auction_lots l on l.id = mine.lot_id and l.status = 'live'
  left join lateral (
    select b.user_id from auction_private.bids b where b.lot_id = l.id
    order by b.amount desc, b.created_at limit 1
  ) leader on true
  where auth.uid() is not null
$$;
create function public.my_auction_bids() returns jsonb
language sql security invoker set search_path='' as $$select auction_private.my_bids()$$;

revoke all on function auction_private.my_bids(), public.my_auction_bids() from public, anon, authenticated;
grant execute on function auction_private.my_bids(), public.my_auction_bids() to authenticated;

commit;
