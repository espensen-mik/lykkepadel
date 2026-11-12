-- Invited players: admins sign up players who don't pay (e.g. known profiles) and choose who is shown on the website.
-- Run once after invoice-payments.sql and admin-edit-registration.sql. Existing registrations are not changed.
-- Invited players have no login, so mail, phone and address are optional for them.
begin;

-- 1. Allow registrations without a login when they are invited.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.event_registrations'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%settlement%' or pg_get_constraintdef(oid) like '%terms_version%')
  loop
    execute format('alter table public.event_registrations drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.event_registrations
  alter column user_id drop not null,
  alter column email drop not null,
  alter column phone drop not null,
  alter column billing_address drop not null,
  -- Shown under the name on the website, e.g. "Stifter af NORMAL". Without it, the company is shown.
  add column public_title text check (public_title is null or length(public_title) between 1 and 80),
  add column partner_public_title text check (partner_public_title is null or length(partner_public_title) between 1 and 80),
  add constraint event_registrations_settlement_check check (
    (settlement = 'discount' and discount_amount = base_price and amount_due = 0)
    or (settlement = 'invoice' and discount_amount = 0 and amount_due = base_price)
    or (settlement = 'invited' and discount_amount = base_price and amount_due = 0)),
  add constraint event_registrations_terms_version_check check (terms_version in ('registration-test-v1', 'admin-invited')),
  -- Everyone except invited players keeps a login, mail, phone and address.
  add constraint event_registrations_account_check check (
    (settlement = 'invited' and user_id is null and terms_version = 'admin-invited')
    or (settlement <> 'invited' and user_id is not null and email is not null and phone is not null and billing_address is not null));

-- 2. Admin: sign up an invited player. Takes seats like everyone else, costs nothing and gets no invoice.
create function auction_private.admin_add_invited_registration(p_kind text, p_name text, p_title text, p_email text, p_phone text,
  p_partner text, p_partner_title text, p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reg public.event_registrations; sizes text[] := array['XS','S','M','L','XL','XXL','3XL'];
  v_name text := trim(coalesce(p_name, '')); v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), ''); v_partner text := trim(coalesce(p_partner, ''));
  v_title text := nullif(trim(coalesce(p_title, '')), ''); v_partner_title text := nullif(trim(coalesce(p_partner_title, '')), '');
  v_pair boolean := p_kind = 'pair';
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  if p_kind is null or p_kind not in ('individual', 'pair') then raise exception 'Vælg individuel deltagelse eller makkerpar.'; end if;
  if length(v_name) not between 2 and 120 then raise exception 'Udfyld spillerens navn.'; end if;
  if v_pair and length(v_partner) not between 2 and 120 then raise exception 'Udfyld makkerens navn.'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Mailadressen er ugyldig.'; end if;
  if v_phone is not null and v_phone !~ '^[+0-9 ()-]{6,30}$' then raise exception 'Telefonnummeret er ugyldigt.'; end if;
  if length(coalesce(v_title, '')) > 80 or length(coalesce(v_partner_title, '')) > 80 then raise exception 'Titlen må højst være 80 tegn.'; end if;
  if (p_shirt is not null and not (p_shirt = any(sizes))) or (p_partner_shirt is not null and not (p_partner_shirt = any(sizes))) then
    raise exception 'Vælg en gyldig T-shirt-størrelse.';
  end if;
  if length(trim(coalesce(p_company, ''))) > 120 or length(trim(coalesce(p_partner_company, ''))) > 120 then
    raise exception 'Virksomhedens navn må højst være 120 tegn.';
  end if;
  insert into public.event_registrations(user_id, kind, seats, full_name, email, phone, billing_address, partner_name,
    base_price, discount_amount, amount_due, settlement, discount_code, terms_version,
    shirt_size, partner_shirt_size, company, partner_company, publish_consent, public_title, partner_public_title, details_updated_at)
  values (null, p_kind, case when v_pair then 2 else 1 end, v_name, v_email, v_phone, null, case when v_pair then v_partner end,
    case when v_pair then 25000 else 10000 end, case when v_pair then 25000 else 10000 end, 0, 'invited', 'Inviteret', 'admin-invited',
    p_shirt, case when v_pair then p_partner_shirt end, nullif(trim(coalesce(p_company, '')), ''),
    case when v_pair then nullif(trim(coalesce(p_partner_company, '')), '') end, coalesce(p_publish, false),
    v_title, case when v_pair then v_partner_title end, now())
  returning * into reg;
  insert into auction_private.audit(actor, action, target, details)
    values (auth.uid(), 'admin_add_invited_registration', reg.id::text, jsonb_build_object('name', v_name, 'kind', p_kind));
  return to_jsonb(reg);
end; $$;
create function public.admin_add_invited_registration(p_kind text, p_name text, p_title text, p_email text, p_phone text,
  p_partner text, p_partner_title text, p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.admin_add_invited_registration(p_kind,p_name,p_title,p_email,p_phone,p_partner,p_partner_title,p_shirt,p_partner_shirt,p_company,p_partner_company,p_publish)$$;

-- 3. Admin edit: now also the website titles, and for invited players the mail; their phone and address are optional.
drop function public.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean);
drop function auction_private.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean);
create function auction_private.admin_update_registration(p_id uuid, p_name text, p_phone text, p_address text, p_partner text,
  p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean,
  p_title text, p_partner_title text, p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reg public.event_registrations; sizes text[] := array['XS','S','M','L','XL','XXL','3XL'];
  v_name text := trim(coalesce(p_name, '')); v_phone text := trim(coalesce(p_phone, '')); v_address text := trim(coalesce(p_address, ''));
  v_partner text := trim(coalesce(p_partner, '')); v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_title text := nullif(trim(coalesce(p_title, '')), ''); v_partner_title text := nullif(trim(coalesce(p_partner_title, '')), '');
  v_invited boolean;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  select * into reg from public.event_registrations where id = p_id for update;
  if not found then raise exception 'Tilmeldingen findes ikke.'; end if;
  v_invited := reg.settlement = 'invited';
  if length(v_name) not between 2 and 120 then raise exception 'Udfyld navn, telefon og faktureringsadresse korrekt.'; end if;
  if v_invited then
    if v_phone <> '' and v_phone !~ '^[+0-9 ()-]{6,30}$' then raise exception 'Telefonnummeret er ugyldigt.'; end if;
    if v_address <> '' and length(v_address) not between 5 and 500 then raise exception 'Adressen skal være mindst 5 tegn.'; end if;
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Mailadressen er ugyldig.'; end if;
  elsif length(v_address) not between 5 and 500 or v_phone !~ '^[+0-9 ()-]{6,30}$' then
    raise exception 'Udfyld navn, telefon og faktureringsadresse korrekt.';
  end if;
  if reg.kind = 'pair' and length(v_partner) not between 2 and 120 then raise exception 'Udfyld makkerens navn.'; end if;
  if (p_shirt is not null and not (p_shirt = any(sizes))) or (p_partner_shirt is not null and not (p_partner_shirt = any(sizes))) then
    raise exception 'Vælg en gyldig T-shirt-størrelse.';
  end if;
  if length(trim(coalesce(p_company, ''))) > 120 or length(trim(coalesce(p_partner_company, ''))) > 120 then
    raise exception 'Virksomhedens navn må højst være 120 tegn.';
  end if;
  if length(coalesce(v_title, '')) > 80 or length(coalesce(v_partner_title, '')) > 80 then raise exception 'Titlen må højst være 80 tegn.'; end if;
  update public.event_registrations set
    full_name = v_name,
    phone = case when v_invited then nullif(v_phone, '') else v_phone end,
    billing_address = case when v_invited then nullif(v_address, '') else v_address end,
    -- The mail of a paying participant is their login and is not changed here.
    email = case when v_invited then v_email else email end,
    partner_name = case when reg.kind = 'pair' then v_partner end,
    shirt_size = p_shirt,
    partner_shirt_size = case when reg.kind = 'pair' then p_partner_shirt end,
    company = nullif(trim(coalesce(p_company, '')), ''),
    partner_company = case when reg.kind = 'pair' then nullif(trim(coalesce(p_partner_company, '')), '') end,
    publish_consent = coalesce(p_publish, false),
    public_title = v_title,
    partner_public_title = case when reg.kind = 'pair' then v_partner_title end,
    details_updated_at = now()
  where id = p_id returning * into reg;
  -- Keep the bidder profile in step, as when participants edit their own details.
  if not v_invited then
    update public.auction_profiles set full_name = v_name, phone = v_phone, billing_address = v_address where user_id = reg.user_id;
  end if;
  insert into auction_private.audit(actor, action, target, details)
    values (auth.uid(), 'admin_update_registration', p_id::text, jsonb_build_object('shirt', reg.shirt_size, 'partner_shirt', reg.partner_shirt_size));
  return to_jsonb(reg);
end; $$;
create function public.admin_update_registration(p_id uuid, p_name text, p_phone text, p_address text, p_partner text,
  p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean,
  p_title text, p_partner_title text, p_email text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.admin_update_registration(p_id,p_name,p_phone,p_address,p_partner,p_shirt,p_partner_shirt,p_company,p_partner_company,p_publish,p_title,p_partner_title,p_email)$$;

-- 4. Public: the latest players who may be shown, newest first. Only name and title leave the database.
create function auction_private.latest_players() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'title', title) order by created_at desc, ord), '[]'::jsonb)
  from (
    select name, title, created_at, ord from (
      select full_name as name, coalesce(public_title, company) as title, created_at, 0 as ord
        from public.event_registrations where status = 'confirmed' and publish_consent
      union all
      select partner_name, coalesce(partner_public_title, partner_company), created_at, 1
        from public.event_registrations where status = 'confirmed' and publish_consent and kind = 'pair' and partner_name is not null
    ) p order by created_at desc, ord limit 30
  ) latest
$$;
create function public.latest_players() returns jsonb
language sql stable security invoker set search_path='' as $$select auction_private.latest_players()$$;

revoke all on function auction_private.admin_add_invited_registration(text,text,text,text,text,text,text,text,text,text,text,boolean),
  public.admin_add_invited_registration(text,text,text,text,text,text,text,text,text,text,text,boolean),
  auction_private.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean,text,text,text),
  public.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean,text,text,text),
  auction_private.latest_players(), public.latest_players() from public, anon, authenticated;
grant execute on function auction_private.admin_add_invited_registration(text,text,text,text,text,text,text,text,text,text,text,boolean),
  public.admin_add_invited_registration(text,text,text,text,text,text,text,text,text,text,text,boolean),
  auction_private.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean,text,text,text),
  public.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean,text,text,text) to authenticated;
grant execute on function auction_private.latest_players(), public.latest_players() to anon, authenticated;

commit;
