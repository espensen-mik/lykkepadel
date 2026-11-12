-- Charity Turnering has 96 players: 70 seats for registrations and 26 reserved for invited players.
-- Run once after invited-players.sql. Adds one setting, a check on invited players and replaces two functions.
-- Before this, invited players took seats from the 70.
begin;

alter table auction_private.event_settings
  add column invited_capacity integer not null default 26 check (invited_capacity >= 0);
-- capacity is the seats for registrations (paying or with discount code).
update auction_private.event_settings set capacity = 70, invited_capacity = 26 where id;

-- 1. Registrations count only registered seats, not invited players.
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
 select coalesce(sum(seats),0) into occupied from public.event_registrations where status='confirmed' and settlement<>'invited';
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

-- 2. Invited players have their own 26 seats. Checked on every new invited player, whichever function adds it.
create function auction_private.check_invited_seats() returns trigger
language plpgsql security definer set search_path='' as $$
declare settings auction_private.event_settings; taken integer;
begin
  -- Same lock as registrations, so two admins cannot take the last seat at once.
  select * into settings from auction_private.event_settings where id for update;
  select coalesce(sum(seats), 0) into taken from public.event_registrations where status = 'confirmed' and settlement = 'invited';
  if taken + new.seats > settings.invited_capacity then
    raise exception 'Der er ikke flere pladser til inviterede spillere (% af % er brugt).', taken, settings.invited_capacity;
  end if;
  return new;
end; $$;
create trigger event_registrations_invited_seats before insert on public.event_registrations
  for each row when (new.settlement = 'invited' and new.status = 'confirmed') execute function auction_private.check_invited_seats();
revoke all on function auction_private.check_invited_seats() from public, anon, authenticated;

-- 3. Admin overview: seats taken and left for registrations and for invited players.
create or replace function auction_private.event_admin_settings(p_coupon boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; paid integer; invited integer;
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 if p_coupon is not null then
  update auction_private.event_settings set coupon_active=p_coupon where id;
  insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'event_coupon','Rabat',jsonb_build_object('active',p_coupon));
 end if;
 select coalesce(sum(seats) filter (where settlement<>'invited'),0), coalesce(sum(seats) filter (where settlement='invited'),0)
   into paid, invited from public.event_registrations where status='confirmed';
 select jsonb_build_object('capacity',capacity,'invited_capacity',invited_capacity,'total_capacity',capacity+invited_capacity,
   'paid_taken',paid,'invited_taken',invited,'seats_taken',paid+invited,
   'coupon_active',coupon_active,'registration_open',registration_open) into result from auction_private.event_settings where id;
 return result;
end; $$;

commit;
