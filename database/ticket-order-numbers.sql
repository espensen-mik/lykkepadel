-- Order numbers for ticket orders: short, unique and letters/digits only, as QuickPay requires (4–20 characters).
-- Real orders: LP00001, LP00002 … Test orders: LPT00001 … The LP prefix keeps them apart from the webshop on lykkeliga.dk.
-- Run once after tickets.sql. Existing orders are numbered in the order they were created.
begin;

create sequence auction_private.ticket_order_seq;
create sequence auction_private.ticket_test_order_seq;
alter table public.ticket_orders add column order_no text;

-- Number existing orders, oldest first.
do $$
declare o record;
begin
  for o in select id, is_test from public.ticket_orders order by created_at, id loop
    update public.ticket_orders set order_no = case when o.is_test
      then 'LPT' || lpad(nextval('auction_private.ticket_test_order_seq')::text, 5, '0')
      else 'LP' || lpad(nextval('auction_private.ticket_order_seq')::text, 5, '0') end
    where id = o.id;
  end loop;
end $$;

create function auction_private.set_ticket_order_no() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.order_no := case when new.is_test
    then 'LPT' || lpad(nextval('auction_private.ticket_test_order_seq')::text, 5, '0')
    else 'LP' || lpad(nextval('auction_private.ticket_order_seq')::text, 5, '0') end;
  return new;
end; $$;
revoke all on function auction_private.set_ticket_order_no() from public, anon, authenticated;
create trigger ticket_orders_order_no before insert on public.ticket_orders
  for each row execute function auction_private.set_ticket_order_no();

alter table public.ticket_orders
  alter column order_no set not null,
  add constraint ticket_orders_order_no_key unique (order_no),
  add constraint ticket_orders_order_no_check check (order_no ~ '^LPT?[0-9]{5,15}$');

commit;
