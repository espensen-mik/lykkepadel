-- Lykke Auktion: charity products alongside padel partners.
-- Run after event-registration.sql and bid-history.sql.
--
-- * Every lot gets a kind: 'partner' (a padel partner for the tournament) or 'item' (a charity product).
-- * Anyone with a confirmed mail can create a free bidder profile and bid on items.
-- * Bids on partners still require a confirmed individual tournament registration.
-- * auction_profiles.approved is now only a block switch. It no longer encodes "may bid on partners".
-- Old function signatures keep working, so the site works before and after this file is applied.
begin;

alter table public.auction_lots
  add column kind text not null default 'partner' check (kind in ('partner', 'item')),
  add column value_text text check (value_text is null or length(value_text) between 1 and 60);

-- Pair registrations used approved=false to keep them away from partner bids. That rule now lives
-- in place_bid, so confirmed pairs may bid on charity products like everyone else.
update public.auction_profiles p set approved = true
  from public.event_registrations r
  where r.user_id = p.user_id and r.kind = 'pair' and r.status = 'confirmed';

-- Registration: same as before, except every confirmed registration gets an active bidder profile.
create or replace function auction_private.complete_registration(p_kind text,p_name text,p_phone text,p_address text,p_partner text,p_code text,p_terms text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity_email text; existing public.event_registrations; result public.event_registrations;
 settings auction_private.event_settings; quote jsonb; occupied integer;
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
 if p_terms is distinct from 'registration-test-v1' then raise exception 'Accepter testvilkårene først.'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 or length(trim(coalesce(p_address,''))) not between 5 and 500
  or trim(coalesce(p_phone,'')) !~ '^[+0-9 ()-]{6,30}$' then raise exception 'Udfyld navn, telefon og faktureringsadresse korrekt.'; end if;
 if p_kind='pair' and length(trim(coalesce(p_partner,''))) not between 2 and 120 then raise exception 'Udfyld din makkers navn.'; end if;
 select * into settings from auction_private.event_settings where id for update;
 if not settings.registration_open then raise exception 'Tilmeldingen er lukket.'; end if;
 quote:=auction_private.registration_quote(p_kind,p_code);
 if (quote->>'amount_due')::integer<>0 then raise exception 'Betaling er ikke åbnet. Brug en gyldig rabatkode for at gennemføre testen.'; end if;
 select coalesce(sum(seats),0) into occupied from public.event_registrations where status='confirmed';
 if occupied+(quote->>'seats')::integer>settings.capacity then raise exception 'Der er ikke flere ledige pladser til denne kategori.'; end if;
 insert into public.event_registrations(user_id,kind,seats,full_name,email,phone,billing_address,partner_name,base_price,discount_amount,amount_due,settlement,discount_code,terms_version)
 values(auth.uid(),p_kind,(quote->>'seats')::integer,trim(p_name),lower(identity_email),trim(p_phone),trim(p_address),case when p_kind='pair' then trim(p_partner) else null end,
 (quote->>'base_price')::integer,(quote->>'discount_amount')::integer,0,'discount','Rabat',p_terms) returning * into result;
 insert into public.auction_profiles(user_id,full_name,phone,billing_address,approved,terms_version)
 values(auth.uid(),trim(p_name),trim(p_phone),trim(p_address),true,'preview-v1')
 on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,billing_address=excluded.billing_address;
 insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'event_registration',result.id::text,jsonb_build_object('kind',p_kind,'settlement','discount'));
 return to_jsonb(result);
end; $$;

-- A free bidder profile for the charity auction, without a tournament registration.
create function auction_private.register_auction_bidder(p_name text, p_phone text, p_address text, p_display_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.auction_profiles; shown text;
begin
  if auth.uid() is null then raise exception 'Log ind med din mail først.'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null and not is_anonymous) then
    raise exception 'Bekræft din mailadresse først.';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 120 or length(trim(coalesce(p_address, ''))) not between 5 and 500
    or trim(coalesce(p_phone, '')) !~ '^[+0-9 ()-]{6,30}$' then
    raise exception 'Udfyld navn, telefon og faktureringsadresse korrekt.';
  end if;
  select * into existing from public.auction_profiles where user_id = auth.uid() for update;
  if found then
    update public.auction_profiles set full_name = trim(p_name), phone = trim(p_phone), billing_address = trim(p_address) where user_id = auth.uid();
  else
    insert into public.auction_profiles(user_id, full_name, phone, billing_address, approved, terms_version)
    values (auth.uid(), trim(p_name), trim(p_phone), trim(p_address), true, 'preview-v1');
  end if;
  shown := auction_private.set_display_name(p_display_name);
  insert into auction_private.audit(actor, action, target) values (auth.uid(), 'register_auction_bidder', auth.uid()::text);
  return jsonb_build_object('full_name', trim(p_name), 'display_name', shown);
end; $$;
create function public.register_auction_bidder(p_name text, p_phone text, p_address text, p_display_name text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.register_auction_bidder(p_name, p_phone, p_address, p_display_name)$$;

-- Bidding: any active profile may bid on items; partners also need an individual registration.
create or replace function auction_private.place_bid(p_lot uuid,p_amount integer,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare lot public.auction_lots; previous auction_private.bids; minimum integer; lot_kind text;
begin
 if auth.uid() is null then raise exception 'Log ind for at byde.'; end if;
 -- Lock the profile, so blocking a bidder and placing a bid cannot race.
 perform 1 from public.auction_profiles where user_id=auth.uid() and approved for share;
 if not found then raise exception 'Opret en profil for at byde. Er din profil blokeret, så kontakt LykkeLiga.'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not is_anonymous) then raise exception 'Bekræft din mailadresse først.'; end if;
 select kind into lot_kind from public.auction_lots where id=p_lot;
 if not found then raise exception 'Auktionen findes ikke.'; end if;
 if lot_kind='partner' then
  perform 1 from public.event_registrations where user_id=auth.uid() and status='confirmed' and kind='individual' and amount_due=0 and settlement='discount' for share;
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

-- Saving lots with kind and value. The old 8-argument function stays and saves a partner.
create function auction_private.save_lot_v2(p_id uuid,p_name text,p_category text,p_description text,p_image text,p_ends timestamptz,p_start integer,p_status text,p_kind text,p_value text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  if p_kind not in ('partner', 'item') or p_kind is null then raise exception 'Vælg padelmakker eller charity-produkt.'; end if;
  if p_value is not null and length(trim(p_value)) > 60 then raise exception 'Værdien må højst være 60 tegn.'; end if;
  target := auction_private.save_lot(p_id, p_name, p_category, p_description, p_image, p_ends, p_start, p_status);
  update public.auction_lots set kind = p_kind, value_text = nullif(trim(coalesce(p_value, '')), '') where id = target;
  return target;
end; $$;
create function public.save_auction_lot(p_id uuid,p_name text,p_category text,p_description text,p_image text,p_ends timestamptz,p_start integer,p_status text,p_kind text,p_value text) returns uuid
language sql security invoker set search_path='' as $$select auction_private.save_lot_v2(p_id,p_name,p_category,p_description,p_image,p_ends,p_start,p_status,p_kind,p_value)$$;

revoke all on function auction_private.register_auction_bidder(text,text,text,text), public.register_auction_bidder(text,text,text,text),
  auction_private.save_lot_v2(uuid,text,text,text,text,timestamptz,integer,text,text,text), public.save_auction_lot(uuid,text,text,text,text,timestamptz,integer,text,text,text)
  from public, anon, authenticated;
grant execute on function auction_private.register_auction_bidder(text,text,text,text), public.register_auction_bidder(text,text,text,text),
  auction_private.save_lot_v2(uuid,text,text,text,text,timestamptz,integer,text,text,text), public.save_auction_lot(uuid,text,text,text,text,timestamptz,integer,text,text,text)
  to authenticated;

commit;
