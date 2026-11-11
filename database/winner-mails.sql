-- Winner mails: remember when each winner was mailed. The mail itself is sent by /api/winner-mails.
-- Run once after invoice-payments.sql. Adds two columns and a function; no data is deleted.
begin;

alter table auction_private.lot_payments
  add column winner_mail_sent_at timestamptz,
  add column winner_mail_to text;

create or replace function auction_private.winners() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 return coalesce((select jsonb_agg(result order by result.ends_at, result.name) from (
  select l.id,l.name,l.kind,l.category,l.value_text,l.ends_at,b.amount,b.created_at,p.full_name,p.phone,p.billing_address,u.email,
   pay.invoice_sent_at,pay.paid_at,pay.winner_mail_sent_at,pay.winner_mail_to
  from public.auction_lots l
  join lateral(select * from auction_private.bids where lot_id=l.id order by amount desc limit 1) b on true
  join public.auction_profiles p on p.user_id=b.user_id join auth.users u on u.id=b.user_id
  left join auction_private.lot_payments pay on pay.lot_id=l.id
  where l.status='live' and l.ends_at<=clock_timestamp()
 )result),'[]'::jsonb);
end; $$;

-- Called by the mail endpoint with the admin's own session after Resend accepted the mail.
create function auction_private.mark_winner_mail(p_lot uuid, p_email text) returns void
language plpgsql security definer set search_path='' as $$
declare winner_email text;
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 select lower(u.email) into winner_email from public.auction_lots l
  join lateral(select * from auction_private.bids where lot_id=l.id order by amount desc limit 1) b on true
  join auth.users u on u.id=b.user_id
  where l.id=p_lot and l.ends_at<=clock_timestamp();
 if winner_email is null then raise exception 'Auktionen er ikke afsluttet med en vinder.'; end if;
 if winner_email<>lower(trim(coalesce(p_email,''))) then raise exception 'Mailen passer ikke til vinderen.'; end if;
 insert into auction_private.lot_payments(lot_id) values(p_lot) on conflict (lot_id) do nothing;
 update auction_private.lot_payments set winner_mail_sent_at=now(), winner_mail_to=winner_email, updated_at=now() where lot_id=p_lot;
 insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'winner_mail',p_lot::text,jsonb_build_object('to',winner_email));
end; $$;
create function public.mark_auction_winner_mail(p_lot uuid, p_email text) returns void
language sql security invoker set search_path='' as $$select auction_private.mark_winner_mail(p_lot,p_email)$$;

revoke all on function auction_private.mark_winner_mail(uuid,text), public.mark_auction_winner_mail(uuid,text) from public, anon, authenticated;
grant execute on function auction_private.mark_winner_mail(uuid,text), public.mark_auction_winner_mail(uuid,text) to authenticated;

commit;
