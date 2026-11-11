-- Tickets for Charity Showkamp: orders, unique tickets, receipts and check-in at the door.
-- Run once after auction-setup.sql. Creates new tables and functions; nothing existing changes.
-- Buyers do not log in. Each order has a secret token; the ticket page and receipt mail use it.
-- Until QuickPay is connected the shop runs in test mode: payments are simulated and tickets
-- are marked as test tickets that are not valid at the door.
begin;

create table auction_private.ticket_settings (
  id boolean primary key default true check (id),
  price integer not null default 200 check (price > 0),
  capacity integer not null default 500 check (capacity > 0),
  max_per_order integer not null default 10 check (max_per_order between 1 and 50),
  sales_open boolean not null default true,
  test_mode boolean not null default true
);
insert into auction_private.ticket_settings(id) values (true);
alter table auction_private.ticket_settings enable row level security;
revoke all on auction_private.ticket_settings from public, anon, authenticated;

-- Receipts are numbered in sequence for bookkeeping. Test receipts have their own series.
create sequence auction_private.ticket_receipt_seq;
create sequence auction_private.ticket_test_receipt_seq;

create table public.ticket_orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'expired')),
  is_test boolean not null,
  quantity integer not null check (quantity between 1 and 50),
  unit_price integer not null check (unit_price > 0),
  amount integer not null,
  buyer_name text not null check (length(buyer_name) between 2 and 120),
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  phone text check (phone is null or phone ~ '^[+0-9 ()-]{6,30}$'),
  company_name text check (company_name is null or length(company_name) between 2 and 120),
  company_cvr text check (company_cvr is null or company_cvr ~ '^[0-9]{8}$'),
  company_address text check (company_address is null or length(company_address) between 5 and 500),
  terms_version text not null,
  provider text not null default 'test' check (provider in ('test', 'quickpay')),
  provider_payment_id text,
  receipt_no integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  paid_at timestamptz,
  cancelled_at timestamptz,
  receipt_sent_at timestamptz,
  check (amount = quantity * unit_price),
  check ((company_name is null) = (company_cvr is null) and (company_name is null) = (company_address is null))
);
create index ticket_orders_status on public.ticket_orders(status, is_test);

-- The secret token lives apart from the order, so it never leaves the database by accident.
create table auction_private.ticket_tokens (
  order_id uuid primary key references public.ticket_orders(id) on delete cascade,
  token text not null unique
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ticket_orders(id) on delete cascade,
  code text not null unique,
  is_test boolean not null,
  status text not null default 'valid' check (status in ('valid', 'void')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);
create index tickets_order on public.tickets(order_id);

alter table public.ticket_orders enable row level security;
alter table public.tickets enable row level security;
alter table auction_private.ticket_tokens enable row level security;
revoke all on public.ticket_orders, public.tickets from public, anon, authenticated;
revoke all on auction_private.ticket_tokens from public, anon, authenticated;
grant select on public.ticket_orders, public.tickets to authenticated;
create policy ticket_orders_admin on public.ticket_orders for select to authenticated using ((select auction_private.is_admin()));
create policy tickets_admin on public.tickets for select to authenticated using ((select auction_private.is_admin()));

-- Seats taken: paid and reserved (pending, not expired) real orders.
create function auction_private.tickets_taken() returns integer
language sql stable security definer set search_path='' as $$
  select coalesce(sum(quantity), 0)::integer from public.ticket_orders
  where not is_test and (status = 'paid' or (status = 'pending' and expires_at > now()))
$$;

create function auction_private.ticket_info() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('price', price, 'capacity', capacity, 'max_per_order', max_per_order,
    'sales_open', sales_open, 'test_mode', test_mode,
    'remaining', greatest(capacity - auction_private.tickets_taken(), 0))
  from auction_private.ticket_settings where id
$$;
create function public.ticket_info() returns jsonb
language sql security invoker set search_path='' as $$select auction_private.ticket_info()$$;

create function auction_private.create_ticket_order(p_quantity integer, p_name text, p_email text, p_phone text,
  p_company text, p_cvr text, p_address text, p_terms text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings auction_private.ticket_settings; result public.ticket_orders; secret text; company boolean;
begin
  -- Locking the settings row serialises orders, so capacity cannot be oversold.
  select * into settings from auction_private.ticket_settings where id for update;
  if not settings.sales_open then raise exception 'Billetsalget er lukket.'; end if;
  if p_terms is distinct from 'tickets-v1' then raise exception 'Accepter handelsbetingelserne for at købe.'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > settings.max_per_order then
    raise exception 'Vælg mellem 1 og % billetter.', settings.max_per_order;
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 120 then raise exception 'Udfyld dit navn.'; end if;
  if lower(trim(coalesce(p_email, ''))) !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Udfyld en gyldig mailadresse.'; end if;
  if nullif(trim(coalesce(p_phone, '')), '') !~ '^[+0-9 ()-]{6,30}$' then raise exception 'Telefonnummeret er ugyldigt.'; end if;
  company := nullif(trim(coalesce(p_company, '')), '') is not null;
  if company and (coalesce(trim(p_cvr), '') !~ '^[0-9]{8}$' or length(trim(coalesce(p_address, ''))) not between 5 and 500) then
    raise exception 'Udfyld firmanavn, CVR-nummer (8 cifre) og adresse.';
  end if;
  update public.ticket_orders set status = 'expired' where status = 'pending' and expires_at <= now();
  if (select count(*) from public.ticket_orders where status = 'pending' and lower(email) = lower(trim(p_email)) and expires_at > now()) >= 3 then
    raise exception 'Du har allerede ordrer, der venter på betaling. Prøv igen om lidt.';
  end if;
  if not settings.test_mode and auction_private.tickets_taken() + p_quantity > settings.capacity then
    raise exception 'Der er ikke flere billetter nok tilbage.';
  end if;
  insert into public.ticket_orders(is_test, quantity, unit_price, amount, buyer_name, email, phone,
    company_name, company_cvr, company_address, terms_version, provider)
  values (settings.test_mode, p_quantity, settings.price, p_quantity * settings.price, trim(p_name), lower(trim(p_email)),
    nullif(trim(coalesce(p_phone, '')), ''),
    case when company then trim(p_company) end, case when company then trim(p_cvr) end, case when company then trim(p_address) end,
    p_terms, case when settings.test_mode then 'test' else 'quickpay' end)
  returning * into result;
  secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into auction_private.ticket_tokens values (result.id, secret);
  return jsonb_build_object('id', result.id, 'token', secret, 'amount', result.amount, 'quantity', result.quantity, 'is_test', result.is_test);
end; $$;
create function public.create_ticket_order(p_quantity integer, p_name text, p_email text, p_phone text,
  p_company text, p_cvr text, p_address text, p_terms text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.create_ticket_order(p_quantity,p_name,p_email,p_phone,p_company,p_cvr,p_address,p_terms)$$;

-- The order with its tickets, for whoever holds the token (the buyer, or the mail endpoint).
create function auction_private.ticket_order_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(o) - 'provider_payment_id' || jsonb_build_object(
    'receipt', case when o.receipt_no is null then null
      when o.is_test then 'TEST-' || lpad(o.receipt_no::text, 4, '0')
      else 'LP-' || to_char(o.paid_at at time zone 'Europe/Copenhagen', 'YYYY') || '-' || lpad(o.receipt_no::text, 4, '0') end,
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'status', t.status, 'checked_in_at', t.checked_in_at, 'is_test', t.is_test) order by t.code)
      from public.tickets t where t.order_id = o.id), '[]'::jsonb))
  from public.ticket_orders o where o.id = p_id
$$;

create function auction_private.ticket_order(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from auction_private.ticket_tokens where order_id = p_id and token = p_token) then
    raise exception 'Ordren findes ikke, eller linket er forkert.';
  end if;
  update public.ticket_orders set status = 'expired' where id = p_id and status = 'pending' and expires_at <= now();
  return auction_private.ticket_order_json(p_id);
end; $$;
create function public.ticket_order(p_id uuid, p_token text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.ticket_order(p_id,p_token)$$;

-- Marks an order as paid: receipt number and one unique ticket per person.
-- Called by the test payment now, and by the QuickPay callback later.
create function auction_private.fulfil_ticket_order(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare target public.ticket_orders; code text;
begin
  select * into target from public.ticket_orders where id = p_id for update;
  if target.status = 'paid' then return; end if;
  if target.status <> 'pending' then raise exception 'Ordren er udløbet eller annulleret. Start et nyt køb.'; end if;
  update public.ticket_orders set status = 'paid', paid_at = now(),
    receipt_no = case when target.is_test then nextval('auction_private.ticket_test_receipt_seq') else nextval('auction_private.ticket_receipt_seq') end
  where id = p_id;
  for i in 1..target.quantity loop
    loop
      code := upper(substr(md5(gen_random_uuid()::text), 1, 4) || '-' || substr(md5(gen_random_uuid()::text), 1, 4));
      begin
        insert into public.tickets(order_id, code, is_test) values (p_id, code, target.is_test);
        exit;
      exception when unique_violation then
        -- Try another code.
      end;
    end loop;
  end loop;
end; $$;

create function auction_private.pay_test_ticket_order(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.ticket_orders;
begin
  perform auction_private.ticket_order(p_id, p_token);
  select * into target from public.ticket_orders where id = p_id;
  if not target.is_test then raise exception 'Ordren skal betales gennem betalingsvinduet.'; end if;
  if not (select test_mode from auction_private.ticket_settings where id) then raise exception 'Testbetaling er slået fra.'; end if;
  perform auction_private.fulfil_ticket_order(p_id);
  return auction_private.ticket_order_json(p_id);
end; $$;
create function public.pay_test_ticket_order(p_id uuid, p_token text) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.pay_test_ticket_order(p_id,p_token)$$;

-- The mail endpoint claims the receipt before sending, so it goes out once; it releases it if sending fails.
create function auction_private.claim_ticket_receipt(p_id uuid, p_token text, p_claim boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform auction_private.ticket_order(p_id, p_token);
  if p_claim then
    update public.ticket_orders set receipt_sent_at = now() where id = p_id and status = 'paid' and receipt_sent_at is null;
    return found;
  end if;
  update public.ticket_orders set receipt_sent_at = null where id = p_id;
  return true;
end; $$;
create function public.claim_ticket_receipt(p_id uuid, p_token text, p_claim boolean) returns boolean
language sql security invoker set search_path='' as $$select auction_private.claim_ticket_receipt(p_id,p_token,p_claim)$$;

-- Admin: the token for resending a receipt, cancelling, and checking in at the door.
create function auction_private.admin_ticket_token(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  return (select token from auction_private.ticket_tokens where order_id = p_id);
end; $$;
create function public.admin_ticket_token(p_id uuid) returns text
language sql security invoker set search_path='' as $$select auction_private.admin_ticket_token(p_id)$$;

create function auction_private.cancel_ticket_order(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  update public.ticket_orders set status = 'cancelled', cancelled_at = now() where id = p_id and status in ('pending', 'paid');
  if not found then raise exception 'Ordren findes ikke eller er allerede annulleret.'; end if;
  update public.tickets set status = 'void' where order_id = p_id;
  insert into auction_private.audit(actor, action, target) values (auth.uid(), 'cancel_ticket_order', p_id::text);
end; $$;
create function public.cancel_ticket_order(p_id uuid) returns void
language sql security invoker set search_path='' as $$select auction_private.cancel_ticket_order(p_id)$$;

create function auction_private.check_in_ticket(p_code text, p_undo boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tickets; o public.ticket_orders; earlier timestamptz;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  select * into t from public.tickets where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('result', 'unknown', 'code', upper(trim(coalesce(p_code, '')))); end if;
  select * into o from public.ticket_orders where id = t.order_id;
  earlier := t.checked_in_at;
  if p_undo then
    update public.tickets set checked_in_at = null where id = t.id;
  elsif t.status = 'valid' and not t.is_test and earlier is null then
    update public.tickets set checked_in_at = now() where id = t.id;
    insert into auction_private.audit(actor, action, target) values (auth.uid(), 'check_in_ticket', t.code);
  end if;
  return jsonb_build_object(
    'result', case when p_undo then 'undone' when t.status = 'void' then 'void' when t.is_test then 'test'
      when earlier is not null then 'used' else 'ok' end,
    'code', t.code, 'checked_in_at', coalesce(earlier, now()), 'buyer_name', o.buyer_name, 'company_name', o.company_name,
    'quantity', o.quantity,
    'checked_in', (select count(*) from public.tickets where order_id = o.id and checked_in_at is not null));
end; $$;
create function public.check_in_ticket(p_code text, p_undo boolean) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.check_in_ticket(p_code,p_undo)$$;

revoke all on function auction_private.tickets_taken(), auction_private.ticket_info(), public.ticket_info(),
  auction_private.create_ticket_order(integer,text,text,text,text,text,text,text), public.create_ticket_order(integer,text,text,text,text,text,text,text),
  auction_private.ticket_order_json(uuid), auction_private.ticket_order(uuid,text), public.ticket_order(uuid,text),
  auction_private.fulfil_ticket_order(uuid),
  auction_private.pay_test_ticket_order(uuid,text), public.pay_test_ticket_order(uuid,text),
  auction_private.claim_ticket_receipt(uuid,text,boolean), public.claim_ticket_receipt(uuid,text,boolean),
  auction_private.admin_ticket_token(uuid), public.admin_ticket_token(uuid),
  auction_private.cancel_ticket_order(uuid), public.cancel_ticket_order(uuid),
  auction_private.check_in_ticket(text,boolean), public.check_in_ticket(text,boolean)
  from public, anon, authenticated;
-- Buying needs no login.
grant execute on function auction_private.ticket_info(), public.ticket_info(),
  auction_private.create_ticket_order(integer,text,text,text,text,text,text,text), public.create_ticket_order(integer,text,text,text,text,text,text,text),
  auction_private.ticket_order(uuid,text), public.ticket_order(uuid,text),
  auction_private.pay_test_ticket_order(uuid,text), public.pay_test_ticket_order(uuid,text),
  auction_private.claim_ticket_receipt(uuid,text,boolean), public.claim_ticket_receipt(uuid,text,boolean)
  to anon, authenticated;
grant execute on function auction_private.admin_ticket_token(uuid), public.admin_ticket_token(uuid),
  auction_private.cancel_ticket_order(uuid), public.cancel_ticket_order(uuid),
  auction_private.check_in_ticket(text,boolean), public.check_in_ticket(text,boolean)
  to authenticated;

commit;
