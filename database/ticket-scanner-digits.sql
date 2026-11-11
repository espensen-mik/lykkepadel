-- Scanner day codes with digits only (1234-5678-9012), so phones show the number keypad.
-- Run once after ticket-scanner.sql. Replaces one function. Make a new code in admin afterwards;
-- an existing code keeps working until it expires.
begin;

create or replace function auction_private.new_scan_code(p_hours integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare raw text; until timestamptz;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  if p_hours is null or p_hours not between 1 and 72 then raise exception 'Vælg mellem 1 og 72 timer.'; end if;
  -- 12 digits from 48 random bits of a UUID (about 40 bits of entropy).
  raw := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint % 1000000000000)::text, 12, '0');
  until := now() + make_interval(hours => p_hours);
  update auction_private.ticket_settings set scan_code_hash = auction_private.scan_hash(raw), scan_valid_until = until where id;
  insert into auction_private.audit(actor, action, target, details) values (auth.uid(), 'new_scan_code', 'scanner', jsonb_build_object('valid_until', until));
  return jsonb_build_object('code', substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4), 'valid_until', until);
end; $$;

commit;
