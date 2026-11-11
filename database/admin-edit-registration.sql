-- Admin: correct a participant's details, e.g. a wrong T-shirt size.
-- Run once after registration-details.sql. Only adds a function; no tables change.
-- The mail is the participant's login and the kind sets the price, so neither can be changed here.
begin;

create function auction_private.admin_update_registration(p_id uuid, p_name text, p_phone text, p_address text, p_partner text,
  p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reg public.event_registrations; sizes text[] := array['XS','S','M','L','XL','XXL','3XL'];
  v_name text := trim(coalesce(p_name, '')); v_phone text := trim(coalesce(p_phone, '')); v_address text := trim(coalesce(p_address, ''));
  v_partner text := trim(coalesce(p_partner, ''));
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  select * into reg from public.event_registrations where id = p_id for update;
  if not found then raise exception 'Tilmeldingen findes ikke.'; end if;
  if length(v_name) not between 2 and 120 or length(v_address) not between 5 and 500 or v_phone !~ '^[+0-9 ()-]{6,30}$' then
    raise exception 'Udfyld navn, telefon og faktureringsadresse korrekt.';
  end if;
  if reg.kind = 'pair' and length(v_partner) not between 2 and 120 then raise exception 'Udfyld makkerens navn.'; end if;
  if (p_shirt is not null and not (p_shirt = any(sizes))) or (p_partner_shirt is not null and not (p_partner_shirt = any(sizes))) then
    raise exception 'Vælg en gyldig T-shirt-størrelse.';
  end if;
  if length(trim(coalesce(p_company, ''))) > 120 or length(trim(coalesce(p_partner_company, ''))) > 120 then
    raise exception 'Virksomhedens navn må højst være 120 tegn.';
  end if;
  update public.event_registrations set
    full_name = v_name, phone = v_phone, billing_address = v_address,
    partner_name = case when reg.kind = 'pair' then v_partner end,
    shirt_size = p_shirt,
    partner_shirt_size = case when reg.kind = 'pair' then p_partner_shirt end,
    company = nullif(trim(coalesce(p_company, '')), ''),
    partner_company = case when reg.kind = 'pair' then nullif(trim(coalesce(p_partner_company, '')), '') end,
    publish_consent = coalesce(p_publish, false),
    details_updated_at = now()
  where id = p_id returning * into reg;
  -- Keep the bidder profile in step, as when participants edit their own details.
  update public.auction_profiles set full_name = v_name, phone = v_phone, billing_address = v_address where user_id = reg.user_id;
  insert into auction_private.audit(actor, action, target, details)
    values (auth.uid(), 'admin_update_registration', p_id::text, jsonb_build_object('shirt', reg.shirt_size, 'partner_shirt', reg.partner_shirt_size));
  return to_jsonb(reg);
end; $$;
create function public.admin_update_registration(p_id uuid, p_name text, p_phone text, p_address text, p_partner text,
  p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.admin_update_registration(p_id,p_name,p_phone,p_address,p_partner,p_shirt,p_partner_shirt,p_company,p_partner_company,p_publish)$$;

revoke all on function auction_private.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean),
  public.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function auction_private.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean),
  public.admin_update_registration(uuid,text,text,text,text,text,text,text,text,boolean) to authenticated;

commit;
