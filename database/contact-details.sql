-- Min side: participants and bidders correct their own name, phone and billing address.
-- Run after auction-items.sql. Only adds a function; no tables are changed.
begin;

-- Updates the bidder profile and, if there is one, the user's tournament registration.
-- The mail is the login and cannot be changed here.
create function auction_private.update_my_contact(p_name text, p_phone text, p_address text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cleaned_name text := trim(coalesce(p_name, '')); cleaned_phone text := trim(coalesce(p_phone, ''));
  cleaned_address text := trim(coalesce(p_address, '')); profiles integer; registrations integer;
begin
  if auth.uid() is null then raise exception 'Log ind først.'; end if;
  if length(cleaned_name) not between 2 and 120 or length(cleaned_address) not between 5 and 500
    or cleaned_phone !~ '^[+0-9 ()-]{6,30}$' then
    raise exception 'Udfyld navn, telefon og faktureringsadresse korrekt.';
  end if;
  update public.auction_profiles set full_name = cleaned_name, phone = cleaned_phone, billing_address = cleaned_address
    where user_id = auth.uid();
  get diagnostics profiles = row_count;
  update public.event_registrations set full_name = cleaned_name, phone = cleaned_phone, billing_address = cleaned_address
    where user_id = auth.uid() and status = 'confirmed';
  get diagnostics registrations = row_count;
  if profiles + registrations = 0 then raise exception 'Opret en profil først.'; end if;
  insert into auction_private.audit(actor, action, target) values (auth.uid(), 'update_my_contact', auth.uid()::text);
  return jsonb_build_object('full_name', cleaned_name, 'phone', cleaned_phone, 'billing_address', cleaned_address);
end; $$;
create function public.update_my_contact(p_name text, p_phone text, p_address text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.update_my_contact(p_name, p_phone, p_address)$$;

revoke all on function auction_private.update_my_contact(text,text,text), public.update_my_contact(text,text,text) from public, anon, authenticated;
grant execute on function auction_private.update_my_contact(text,text,text), public.update_my_contact(text,text,text) to authenticated;

commit;
