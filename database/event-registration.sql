-- Add event registrations, a server-validated full discount and participant entitlements.
begin;
create table auction_private.event_settings (
 id boolean primary key default true check(id), capacity integer not null default 70 check(capacity>0),
 registration_open boolean not null default true, coupon_active boolean not null default true
);
insert into auction_private.event_settings(id) values(true);
alter table auction_private.event_settings enable row level security;
revoke all on auction_private.event_settings from public,anon,authenticated;
create table public.event_registrations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id),
 kind text not null check(kind in ('individual','pair')), seats integer not null,
 full_name text not null check(length(full_name) between 2 and 120),
 email text not null, phone text not null check(length(phone) between 6 and 30),
 billing_address text not null check(length(billing_address) between 5 and 500),
 partner_name text, base_price integer not null, discount_amount integer not null, amount_due integer not null,
 settlement text not null check(settlement='discount'), discount_code text not null,
 status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 terms_version text not null check(terms_version='registration-test-v1'),
 created_at timestamptz not null default now(),
 check((kind='individual' and seats=1 and base_price=10000 and partner_name is null) or
       (kind='pair' and seats=2 and base_price=25000 and partner_name is not null and length(partner_name) between 2 and 120)),
 check(discount_amount=base_price and amount_due=0)
);
alter table public.event_registrations enable row level security;
revoke all on public.event_registrations from public,anon,authenticated;
grant select on public.event_registrations to authenticated;
create policy registration_read on public.event_registrations for select to authenticated
 using(user_id=(select auth.uid()) or (select auction_private.is_admin()));

create function auction_private.registration_quote(p_kind text,p_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare price integer; seats integer; active boolean;
begin
 if p_kind not in ('individual','pair') or p_kind is null then raise exception 'Vælg individuel deltagelse eller par.'; end if;
 price:=case when p_kind='individual' then 10000 else 25000 end;
 seats:=case when p_kind='individual' then 1 else 2 end;
 select coupon_active and registration_open into active from auction_private.event_settings where id;
 if length(coalesce(p_code,''))>80 then raise exception 'Rabatkoden er ugyldig.'; end if;
 if coalesce(trim(p_code),'')<>'' and (lower(trim(p_code))<>'rabat' or not active) then raise exception 'Rabatkoden er ugyldig eller ikke længere aktiv.'; end if;
 return jsonb_build_object('base_price',price,'discount_amount',case when lower(trim(p_code))='rabat' and active then price else 0 end,
 'amount_due',case when lower(trim(p_code))='rabat' and active then 0 else price end,'seats',seats);
end; $$;
create function public.event_registration_quote(p_kind text,p_code text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.registration_quote(p_kind,p_code)$$;

create function auction_private.complete_registration(p_kind text,p_name text,p_phone text,p_address text,p_partner text,p_code text,p_terms text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity_email text; existing public.event_registrations; result public.event_registrations;
 settings auction_private.event_settings; quote jsonb; occupied integer;
begin
 if auth.uid() is null then raise exception 'Bekræft din mailadresse, før du tilmelder dig.'; end if;
 -- Serialise retries for the same account, then capacity allocation across accounts.
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
 values(auth.uid(),trim(p_name),trim(p_phone),trim(p_address),p_kind='individual','preview-v1')
 on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,billing_address=excluded.billing_address,approved=excluded.approved;
 insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'event_registration',result.id::text,jsonb_build_object('kind',p_kind,'settlement','discount'));
 return to_jsonb(result);
end; $$;
create function public.complete_event_registration(p_kind text,p_name text,p_phone text,p_address text,p_partner text,p_code text,p_terms text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.complete_registration(p_kind,p_name,p_phone,p_address,p_partner,p_code,p_terms)$$;

create function auction_private.has_event_access() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.event_registrations r join auth.users u on u.id=r.user_id
 where r.user_id=auth.uid() and r.status='confirmed' and r.kind='individual' and r.amount_due=0 and r.settlement='discount'
 and u.email_confirmed_at is not null and not u.is_anonymous and lower(u.email)=r.email)
$$;
create function public.event_bid_access() returns boolean language sql security invoker set search_path='' as $$select auction_private.has_event_access()$$;

create function auction_private.event_admin_settings(p_coupon boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 if p_coupon is not null then
  update auction_private.event_settings set coupon_active=p_coupon where id;
  insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'event_coupon','Rabat',jsonb_build_object('active',p_coupon));
 end if;
 select jsonb_build_object('capacity',capacity,'coupon_active',coupon_active,'registration_open',registration_open,
 'seats_taken',(select coalesce(sum(seats),0) from public.event_registrations where status='confirmed')) into result from auction_private.event_settings where id;
 return result;
end; $$;
create function public.event_admin_settings(p_coupon boolean default null) returns jsonb language sql security invoker set search_path='' as $$select auction_private.event_admin_settings(p_coupon)$$;

create function auction_private.cancel_registration(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare target public.event_registrations;
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 -- Same lock order as bidding: profile before registration.
 select * into target from public.event_registrations where id=p_id;
 if not found then raise exception 'Tilmeldingen findes ikke.'; end if;
 perform 1 from public.auction_profiles where user_id=target.user_id for update;
 update public.event_registrations set status='cancelled' where id=p_id;
 update public.auction_profiles set approved=false where user_id=target.user_id;
 insert into auction_private.audit(actor,action,target) values(auth.uid(),'cancel_event_registration',p_id::text);
end; $$;
create function public.cancel_event_registration(p_id uuid) returns void language sql security invoker set search_path='' as $$select auction_private.cancel_registration(p_id)$$;

-- Public lot details contain no bidder contact data. Drafts remain restricted to admins.
drop policy auction_read on public.auction_lots;
create policy auction_read on public.auction_lots for select to anon,authenticated using(status='live' or (select auction_private.is_admin()));

revoke all on function auction_private.registration_quote(text,text),auction_private.complete_registration(text,text,text,text,text,text,text),auction_private.has_event_access(),auction_private.event_admin_settings(boolean),auction_private.cancel_registration(uuid) from public,anon,authenticated;
revoke all on function public.event_registration_quote(text,text),public.complete_event_registration(text,text,text,text,text,text,text),public.event_bid_access(),public.event_admin_settings(boolean),public.cancel_event_registration(uuid) from public,anon,authenticated;
grant execute on function auction_private.registration_quote(text,text),public.event_registration_quote(text,text) to anon,authenticated;
grant execute on function auction_private.complete_registration(text,text,text,text,text,text,text),public.complete_event_registration(text,text,text,text,text,text,text),auction_private.has_event_access(),public.event_bid_access(),auction_private.event_admin_settings(boolean),public.event_admin_settings(boolean),auction_private.cancel_registration(uuid),public.cancel_event_registration(uuid) to authenticated;
create or replace function auction_private.place_bid(p_lot uuid,p_amount integer,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare lot public.auction_lots; previous auction_private.bids; minimum integer;
begin
 if auth.uid() is null then raise exception 'Log ind for at byde.'; end if;
 -- Lock the profile, so blocking a bidder and placing a bid cannot race.
 perform 1 from public.auction_profiles where user_id=auth.uid() and approved for share;
 if not found then raise exception 'Din profil skal godkendes, før du kan byde.'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not is_anonymous) then raise exception 'Bekræft din mailadresse først.'; end if;
 perform 1 from public.event_registrations where user_id=auth.uid() and status='confirmed' and kind='individual' and amount_due=0 and settlement='discount' for share;
 if not found or not auction_private.has_event_access() then raise exception 'Individuel deltagelse skal være bekræftet og afregnet, før du kan byde.'; end if;
 select * into lot from public.auction_lots where id=p_lot for update;
 if not found then raise exception 'Auktionen findes ikke.'; end if;
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

commit;
