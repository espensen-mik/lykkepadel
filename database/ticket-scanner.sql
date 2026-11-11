-- Ticket scanner for volunteers at /scan. Admins create a day code; volunteers log in with it on their own phones.
-- Run once after tickets.sql. Adds two columns and functions; nothing else changes.
-- The code is 12 random characters (48 bits), stored only as a hash, and works until it expires or is turned off.
-- The scanner sees only the buyer's first name and how many from the order have checked in.
begin;

alter table auction_private.ticket_settings
  add column scan_code_hash text,
  add column scan_valid_until timestamptz;

create function auction_private.scan_hash(p_code text) returns text
language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'UTF8')), 'hex')
$$;

create function auction_private.scan_code_ok(p_code text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auction_private.ticket_settings
    where id and scan_code_hash is not null and scan_valid_until > now() and scan_code_hash = auction_private.scan_hash(p_code))
$$;

-- Admin: a new day code, valid for p_hours (1–72). The code is shown once; only its hash is kept.
create function auction_private.new_scan_code(p_hours integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare raw text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)); until timestamptz;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  if p_hours is null or p_hours not between 1 and 72 then raise exception 'Vælg mellem 1 og 72 timer.'; end if;
  until := now() + make_interval(hours => p_hours);
  update auction_private.ticket_settings set scan_code_hash = auction_private.scan_hash(raw), scan_valid_until = until where id;
  insert into auction_private.audit(actor, action, target, details) values (auth.uid(), 'new_scan_code', 'scanner', jsonb_build_object('valid_until', until));
  return jsonb_build_object('code', substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4), 'valid_until', until);
end; $$;

create function auction_private.stop_scan_code() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  update auction_private.ticket_settings set scan_code_hash = null, scan_valid_until = null where id;
  insert into auction_private.audit(actor, action, target) values (auth.uid(), 'stop_scan_code', 'scanner');
end; $$;

create function auction_private.scan_code_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  return (select jsonb_build_object('active', scan_code_hash is not null and scan_valid_until > now(), 'valid_until', scan_valid_until)
    from auction_private.ticket_settings where id);
end; $$;

-- Scanner login: is the code valid, and how many have checked in so far.
create function auction_private.scan_status(p_scan_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not auction_private.scan_code_ok(p_scan_code) then raise exception 'Koden er forkert eller udløbet.'; end if;
  return jsonb_build_object(
    'valid_until', (select scan_valid_until from auction_private.ticket_settings where id),
    'checked_in', (select count(*) from public.tickets t join public.ticket_orders o on o.id = t.order_id
      where t.checked_in_at is not null and not t.is_test and o.status = 'paid'),
    'sold', (select count(*) from public.tickets t join public.ticket_orders o on o.id = t.order_id
      where t.status = 'valid' and not t.is_test and o.status = 'paid'));
end; $$;

-- Check a ticket in with the day code. Same rules as the admin check-in: valid, real tickets once.
create function auction_private.scan_ticket(p_scan_code text, p_ticket text, p_undo boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tickets; o public.ticket_orders; earlier timestamptz; v_code text := upper(trim(coalesce(p_ticket, '')));
begin
  if not auction_private.scan_code_ok(p_scan_code) then raise exception 'Koden er forkert eller udløbet.'; end if;
  select * into t from public.tickets where public.tickets.code = v_code for update;
  if not found then return jsonb_build_object('result', 'unknown', 'code', v_code); end if;
  select * into o from public.ticket_orders where id = t.order_id;
  earlier := t.checked_in_at;
  if p_undo then
    update public.tickets set checked_in_at = null where id = t.id;
    insert into auction_private.audit(actor, action, target) values (null, 'scan_undo', t.code);
  elsif t.status = 'valid' and not t.is_test and earlier is null then
    update public.tickets set checked_in_at = now() where id = t.id;
    insert into auction_private.audit(actor, action, target) values (null, 'scan_ticket', t.code);
  end if;
  return jsonb_build_object(
    'result', case when p_undo then 'undone' when t.status = 'void' then 'void' when t.is_test then 'test'
      when earlier is not null then 'used' else 'ok' end,
    'code', t.code, 'checked_in_at', coalesce(earlier, now()),
    'first_name', split_part(o.buyer_name, ' ', 1), 'quantity', o.quantity,
    'checked_in', (select count(*) from public.tickets where order_id = o.id and checked_in_at is not null));
end; $$;

create function public.new_scan_code(p_hours integer) returns jsonb language sql security invoker set search_path='' as $$select auction_private.new_scan_code(p_hours)$$;
create function public.stop_scan_code() returns void language sql security invoker set search_path='' as $$select auction_private.stop_scan_code()$$;
create function public.scan_code_status() returns jsonb language sql security invoker set search_path='' as $$select auction_private.scan_code_status()$$;
create function public.scan_status(p_scan_code text) returns jsonb language sql security invoker set search_path='' as $$select auction_private.scan_status(p_scan_code)$$;
create function public.scan_ticket(p_scan_code text, p_ticket text, p_undo boolean) returns jsonb language sql security invoker set search_path='' as $$select auction_private.scan_ticket(p_scan_code, p_ticket, p_undo)$$;

revoke all on function auction_private.scan_hash(text), auction_private.scan_code_ok(text),
  auction_private.new_scan_code(integer), public.new_scan_code(integer),
  auction_private.stop_scan_code(), public.stop_scan_code(),
  auction_private.scan_code_status(), public.scan_code_status(),
  auction_private.scan_status(text), public.scan_status(text),
  auction_private.scan_ticket(text,text,boolean), public.scan_ticket(text,text,boolean)
  from public, anon, authenticated;
-- Volunteers are not logged in: the day code is their access.
grant execute on function auction_private.scan_status(text), public.scan_status(text),
  auction_private.scan_ticket(text,text,boolean), public.scan_ticket(text,text,boolean) to anon, authenticated;
grant execute on function auction_private.new_scan_code(integer), public.new_scan_code(integer),
  auction_private.stop_scan_code(), public.stop_scan_code(),
  auction_private.scan_code_status(), public.scan_code_status() to authenticated;

commit;
