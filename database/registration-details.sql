-- Charity Turnering: T-shirt sizes, company and consent to be named in the promotion.
-- Run after event-registration.sql. Adds columns and one function; existing rows keep working.
begin;

alter table public.event_registrations
  add column shirt_size text check (shirt_size in ('XS','S','M','L','XL','XXL','3XL')),
  add column partner_shirt_size text check (partner_shirt_size in ('XS','S','M','L','XL','XXL','3XL')),
  add column company text check (company is null or length(company) between 1 and 120),
  add column partner_company text check (partner_company is null or length(partner_company) between 1 and 120),
  -- Opt-in: false until the participant actively says yes.
  add column publish_consent boolean not null default false,
  add column details_updated_at timestamptz;

-- The participant sets or changes the details on their own confirmed registration.
create function auction_private.set_registration_details(p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reg public.event_registrations; sizes text[] := array['XS','S','M','L','XL','XXL','3XL'];
begin
  if auth.uid() is null then raise exception 'Log ind først.'; end if;
  select * into reg from public.event_registrations where user_id = auth.uid() for update;
  if not found or reg.status <> 'confirmed' then raise exception 'Du har ingen aktiv tilmelding.'; end if;
  if p_shirt is null or not (p_shirt = any(sizes)) then raise exception 'Vælg en T-shirt-størrelse.'; end if;
  if reg.kind = 'pair' and (p_partner_shirt is null or not (p_partner_shirt = any(sizes))) then
    raise exception 'Vælg en T-shirt-størrelse til din makker.';
  end if;
  if length(trim(coalesce(p_company, ''))) > 120 or length(trim(coalesce(p_partner_company, ''))) > 120 then
    raise exception 'Virksomhedens navn må højst være 120 tegn.';
  end if;
  update public.event_registrations set
    shirt_size = p_shirt,
    partner_shirt_size = case when reg.kind = 'pair' then p_partner_shirt end,
    company = nullif(trim(coalesce(p_company, '')), ''),
    partner_company = case when reg.kind = 'pair' then nullif(trim(coalesce(p_partner_company, '')), '') end,
    publish_consent = coalesce(p_publish, false),
    details_updated_at = now()
  where id = reg.id returning * into reg;
  insert into auction_private.audit(actor, action, target, details)
    values (auth.uid(), 'registration_details', reg.id::text, jsonb_build_object('publish_consent', reg.publish_consent));
  return to_jsonb(reg);
end; $$;
create function public.set_registration_details(p_shirt text, p_partner_shirt text, p_company text, p_partner_company text, p_publish boolean) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.set_registration_details(p_shirt, p_partner_shirt, p_company, p_partner_company, p_publish)$$;

revoke all on function auction_private.set_registration_details(text,text,text,text,boolean), public.set_registration_details(text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function auction_private.set_registration_details(text,text,text,text,boolean), public.set_registration_details(text,text,text,text,boolean) to authenticated;

commit;
