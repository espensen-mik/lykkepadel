-- Invoices: participation and won auctions are paid by invoice, and admins mark what is sent and paid.
-- Run once after auction-items.sql (and after delete-people.sql, if used). No data is deleted.
begin;

-- 1. Registrations can be settled by invoice (full price) or, with a valid code, by discount (free).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.event_registrations'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%amount_due = 0%' or pg_get_constraintdef(oid) like '%settlement%')
  loop
    execute format('alter table public.event_registrations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.event_registrations
  alter column discount_code drop not null,
  add constraint event_registrations_settlement_check check (
    (settlement = 'discount' and discount_amount = base_price and amount_due = 0)
    or (settlement = 'invoice' and discount_amount = 0 and amount_due = base_price)),
  add column invoice_sent_at timestamptz,
  add column paid_at timestamptz;

create or replace function auction_private.complete_registration(p_kind text,p_name text,p_phone text,p_address text,p_partner text,p_code text,p_terms text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity_email text; existing public.event_registrations; result public.event_registrations;
 settings auction_private.event_settings; quote jsonb; occupied integer; free boolean;
begin
 if auth.uid() is null then raise exception 'Bekræft din mailadresse, før du tilmelder dig.'; end if;
 select email into identity_email from auth.users where id=auth.uid() and email_confirmed_at is not null and not is_anonymous for update;
 if not found then raise exception 'Bekræft din mailadresse, før du tilmelder dig.'; end if;
 select * into existing from public.event_registrations where user_id=auth.uid();
 if found then
  if existing.status='confirmed' and existing.kind=p_kind and existing.full_name=trim(p_name) and existing.phone=trim(p_phone)
   and existing.billing_address=trim(p_address) and coalesce(existing.partner_name,'')=(case when p_kind='pair' then trim(coalesce(p_partner,'')) else '' end) then return to_jsonb(existing); end if;
  raise exception 'Du har allerede en tilmelding. Kontakt LykkeLiga, hvis den skal ændres.';
 end if;
 if p_terms is distinct from 'registration-test-v1' then raise exception 'Accepter vilkårene først.'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 or length(trim(coalesce(p_address,''))) not between 5 and 500
  or trim(coalesce(p_phone,'')) !~ '^[+0-9 ()-]{6,30}$' then raise exception 'Udfyld navn, telefon og faktureringsadresse korrekt.'; end if;
 if p_kind='pair' and length(trim(coalesce(p_partner,''))) not between 2 and 120 then raise exception 'Udfyld din makkers navn.'; end if;
 select * into settings from auction_private.event_settings where id for update;
 if not settings.registration_open then raise exception 'Tilmeldingen er lukket.'; end if;
 quote:=auction_private.registration_quote(p_kind,p_code);
 free:=(quote->>'amount_due')::integer=0;
 select coalesce(sum(seats),0) into occupied from public.event_registrations where status='confirmed';
 if occupied+(quote->>'seats')::integer>settings.capacity then raise exception 'Der er ikke flere ledige pladser til denne kategori.'; end if;
 insert into public.event_registrations(user_id,kind,seats,full_name,email,phone,billing_address,partner_name,base_price,discount_amount,amount_due,settlement,discount_code,terms_version)
 values(auth.uid(),p_kind,(quote->>'seats')::integer,trim(p_name),lower(identity_email),trim(p_phone),trim(p_address),case when p_kind='pair' then trim(p_partner) else null end,
 (quote->>'base_price')::integer,(quote->>'discount_amount')::integer,(quote->>'amount_due')::integer,
 case when free then 'discount' else 'invoice' end,case when free then 'Rabat' end,p_terms) returning * into result;
 insert into public.auction_profiles(user_id,full_name,phone,billing_address,approved,terms_version)
 values(auth.uid(),trim(p_name),trim(p_phone),trim(p_address),true,'preview-v1')
 on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,billing_address=excluded.billing_address;
 insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'event_registration',result.id::text,jsonb_build_object('kind',p_kind,'settlement',result.settlement));
 return to_jsonb(result);
end; $$;

-- 2. Bidding on padel partners needs a confirmed individual registration, paid or not.
create or replace function auction_private.has_event_access() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.event_registrations r join auth.users u on u.id=r.user_id
 where r.user_id=auth.uid() and r.status='confirmed' and r.kind='individual'
 and u.email_confirmed_at is not null and not u.is_anonymous and lower(u.email)=r.email)
$$;

create or replace function auction_private.place_bid(p_lot uuid,p_amount integer,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare lot public.auction_lots; previous auction_private.bids; minimum integer; lot_kind text;
begin
 if auth.uid() is null then raise exception 'Log ind for at byde.'; end if;
 perform 1 from public.auction_profiles where user_id=auth.uid() and approved for share;
 if not found then raise exception 'Opret en profil for at byde. Er din profil blokeret, så kontakt LykkeLiga.'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not is_anonymous) then raise exception 'Bekræft din mailadresse først.'; end if;
 select kind into lot_kind from public.auction_lots where id=p_lot;
 if not found then raise exception 'Auktionen findes ikke.'; end if;
 if lot_kind='partner' then
  perform 1 from public.event_registrations where user_id=auth.uid() and status='confirmed' and kind='individual' for share;
  if not found or not auction_private.has_event_access() then raise exception 'Kun individuelle deltagere i Charity Turnering kan byde på padelmakkere.'; end if;
 end if;
 select * into lot from public.auction_lots where id=p_lot for update;
 select * into previous from auction_private.bids where request_id=p_request;
 if found then
  if previous.user_id<>auth.uid() or previous.lot_id<>p_lot or previous.amount<>p_amount then raise exception 'Ugyldig budreference.'; end if;
  return jsonb_build_object('id',previous.id,'amount',previous.amount);
 end if;
 if lot.status<>'live' or lot.ends_at<=clock_timestamp() then raise exception 'Auktionen er ikke åben.'; end if;
 minimum:=case when lot.bid_count=0 then lot.starting_price else lot.current_bid+500 end;
 if p_amount is null or p_amount<minimum or p_amount%500<>0 or p_amount>10000000 then raise exception 'Buddet skal være mindst % kr. og i hele trin på 500 kr.',minimum; end if;
 insert into auction_private.bids(lot_id,user_id,amount,request_id) values(p_lot,auth.uid(),p_amount,p_request) returning * into previous;
 update public.auction_lots set current_bid=p_amount,bid_count=bid_count+1 where id=p_lot;
 return jsonb_build_object('id',previous.id,'amount',previous.amount);
end; $$;

-- 3. Payment status for won auctions. One row per lot, created when an admin marks something.
create table auction_private.lot_payments (
  lot_id uuid primary key references public.auction_lots(id) on delete cascade,
  invoice_sent_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table auction_private.lot_payments enable row level security;
revoke all on auction_private.lot_payments from public, anon, authenticated;

create or replace function auction_private.winners() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 return coalesce((select jsonb_agg(result order by result.ends_at, result.name) from (
  select l.id,l.name,l.kind,l.ends_at,b.amount,b.created_at,p.full_name,p.phone,p.billing_address,u.email,
   pay.invoice_sent_at,pay.paid_at
  from public.auction_lots l
  join lateral(select * from auction_private.bids where lot_id=l.id order by amount desc limit 1) b on true
  join public.auction_profiles p on p.user_id=b.user_id join auth.users u on u.id=b.user_id
  left join auction_private.lot_payments pay on pay.lot_id=l.id
  where l.status='live' and l.ends_at<=clock_timestamp()
 )result),'[]'::jsonb);
end; $$;

-- 4. Admin: mark invoice sent and paid. Null leaves a field as it is.
create function auction_private.set_registration_payment(p_id uuid, p_invoice_sent boolean, p_paid boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target public.event_registrations;
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 select * into target from public.event_registrations where id=p_id for update;
 if not found then raise exception 'Tilmeldingen findes ikke.'; end if;
 if target.settlement<>'invoice' then raise exception 'Tilmeldingen er gratis med rabatkode og skal ikke faktureres.'; end if;
 update public.event_registrations set
  invoice_sent_at=case when p_invoice_sent is null then invoice_sent_at when p_invoice_sent then coalesce(invoice_sent_at, now()) end,
  paid_at=case when p_paid is null then paid_at when p_paid then coalesce(paid_at, now()) end
 where id=p_id;
 insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'registration_payment',p_id::text,
  jsonb_build_object('invoice_sent',p_invoice_sent,'paid',p_paid));
end; $$;
create function public.set_registration_payment(p_id uuid, p_invoice_sent boolean, p_paid boolean) returns void
language sql security invoker set search_path='' as $$select auction_private.set_registration_payment(p_id,p_invoice_sent,p_paid)$$;

create function auction_private.set_lot_payment(p_lot uuid, p_invoice_sent boolean, p_paid boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 if not exists(select 1 from public.auction_lots l where l.id=p_lot and l.ends_at<=clock_timestamp()
   and exists(select 1 from auction_private.bids b where b.lot_id=l.id)) then
  raise exception 'Auktionen er ikke afsluttet med en vinder.';
 end if;
 insert into auction_private.lot_payments(lot_id) values(p_lot) on conflict (lot_id) do nothing;
 update auction_private.lot_payments set
  invoice_sent_at=case when p_invoice_sent is null then invoice_sent_at when p_invoice_sent then coalesce(invoice_sent_at, now()) end,
  paid_at=case when p_paid is null then paid_at when p_paid then coalesce(paid_at, now()) end,
  updated_at=now()
 where lot_id=p_lot;
 insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'lot_payment',p_lot::text,
  jsonb_build_object('invoice_sent',p_invoice_sent,'paid',p_paid));
end; $$;
create function public.set_auction_lot_payment(p_lot uuid, p_invoice_sent boolean, p_paid boolean) returns void
language sql security invoker set search_path='' as $$select auction_private.set_lot_payment(p_lot,p_invoice_sent,p_paid)$$;

revoke all on function auction_private.set_registration_payment(uuid,boolean,boolean), public.set_registration_payment(uuid,boolean,boolean),
  auction_private.set_lot_payment(uuid,boolean,boolean), public.set_auction_lot_payment(uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function auction_private.set_registration_payment(uuid,boolean,boolean), public.set_registration_payment(uuid,boolean,boolean),
  auction_private.set_lot_payment(uuid,boolean,boolean), public.set_auction_lot_payment(uuid,boolean,boolean) to authenticated;

commit;
