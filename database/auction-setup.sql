-- Run once in the intended Supabase project's SQL Editor. No existing tables are modified.
-- Private implementation functions enforce privileges even when called outside the UI.
begin;
create schema auction_private;
revoke all on schema auction_private from public, anon;
grant usage on schema auction_private to authenticated;
create table auction_private.admins (user_id uuid primary key references auth.users(id));
create table auction_private.settings (id boolean primary key default true check(id), is_open boolean not null default false);
insert into auction_private.settings values(true,false);
create table public.auction_profiles (
 user_id uuid primary key references auth.users(id), full_name text not null check(length(full_name) between 2 and 120),
 phone text not null check(length(phone) between 6 and 30), billing_address text not null check(length(billing_address) between 5 and 500),
 approved boolean not null default false, terms_version text not null check(terms_version='preview-v1'),
 created_at timestamptz not null default now()
);
create table public.auction_lots (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 100),
 category text not null check(length(category) between 1 and 60), description text not null check(length(description) between 10 and 3000),
 image_url text not null check(image_url ~ '^https://'), ends_at timestamptz not null,
 starting_price integer not null default 500 check(starting_price>=500 and starting_price<=10000000 and starting_price%500=0),
 current_bid integer not null default 0 check(current_bid>=0), bid_count integer not null default 0,
 status text not null default 'draft' check(status in ('draft','live')), created_at timestamptz not null default now()
);
create table auction_private.bids (
 id uuid primary key default gen_random_uuid(), lot_id uuid not null references public.auction_lots(id),
 user_id uuid not null references auth.users(id), amount integer not null check(amount>=500 and amount<=10000000 and amount%500=0),
 request_id uuid not null unique, created_at timestamptz not null default clock_timestamp()
);
create index auction_bids_lot on auction_private.bids(lot_id,created_at desc);
create index auction_bids_user on auction_private.bids(user_id);
create table auction_private.audit (
 id bigint generated always as identity primary key, actor uuid, action text not null,
 target text not null, details jsonb, created_at timestamptz not null default clock_timestamp()
);
alter table public.auction_profiles enable row level security;
alter table public.auction_lots enable row level security;
alter table auction_private.admins enable row level security;
alter table auction_private.settings enable row level security;
alter table auction_private.bids enable row level security;
alter table auction_private.audit enable row level security;
revoke all on public.auction_profiles, public.auction_lots from anon, authenticated;
revoke all on all tables in schema auction_private from public, anon, authenticated;

create function auction_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auction_private.admins where user_id=auth.uid());
$$;
create function auction_private.can_view() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auction_private.settings where is_open) or auction_private.is_admin()
 or exists(select 1 from public.auction_profiles where user_id=auth.uid() and approved);
$$;
grant select on public.auction_lots to anon,authenticated;
create policy auction_read on public.auction_lots for select to anon, authenticated
 using ((status='live' and (select auction_private.can_view())) or (select auction_private.is_admin()));
grant select on public.auction_profiles to authenticated;
create policy profile_read on public.auction_profiles for select to authenticated
 using(user_id=(select auth.uid()) or (select auction_private.is_admin()));

create function auction_private.register_bidder(p_name text,p_phone text,p_address text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not is_anonymous) then raise exception 'Bekræft din mailadresse først.'; end if;
 insert into public.auction_profiles(user_id,full_name,phone,billing_address,terms_version)
 values(auth.uid(),trim(p_name),trim(p_phone),trim(p_address),'preview-v1');
end; $$;
create function public.register_bidder(p_name text,p_phone text,p_address text) returns void language sql security invoker set search_path='' as $$select auction_private.register_bidder(p_name,p_phone,p_address);$$;

create function auction_private.place_bid(p_lot uuid,p_amount integer,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare lot public.auction_lots; previous auction_private.bids; minimum integer;
begin
 if auth.uid() is null then raise exception 'Log ind for at byde.'; end if;
 -- Lock the profile, so blocking a bidder and placing a bid cannot race.
 perform 1 from public.auction_profiles where user_id=auth.uid() and approved for share;
 if not found then raise exception 'Din profil skal godkendes, før du kan byde.'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not is_anonymous) then raise exception 'Bekræft din mailadresse først.'; end if;
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
create function public.place_auction_bid(p_lot uuid,p_amount integer,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select auction_private.place_bid(p_lot,p_amount,p_request);$$;

create function auction_private.save_lot(p_id uuid,p_name text,p_category text,p_description text,p_image text,p_ends timestamptz,p_start integer,p_status text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid; existing public.auction_lots;
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 if p_ends<=clock_timestamp() then raise exception 'Vælg en fremtidig sluttid.'; end if;
 if p_id is null then
  insert into public.auction_lots(name,category,description,image_url,ends_at,starting_price,status)
  values(trim(p_name),trim(p_category),trim(p_description),p_image,p_ends,p_start,p_status) returning id into target;
 else
  select * into existing from public.auction_lots where id=p_id for update;
  if not found then raise exception 'Auktionen findes ikke.'; end if;
  if existing.bid_count>0 then raise exception 'Auktioner med bud er låst for redigering.'; end if;
  update public.auction_lots set name=trim(p_name),category=trim(p_category),description=trim(p_description),image_url=p_image,ends_at=p_ends,starting_price=p_start,status=p_status where id=p_id;
  target:=p_id;
 end if;
 insert into auction_private.audit(actor,action,target) values(auth.uid(),'save_lot',target::text);
 return target;
end; $$;
create function public.save_auction_lot(p_id uuid,p_name text,p_category text,p_description text,p_image text,p_ends timestamptz,p_start integer,p_status text) returns uuid language sql security invoker set search_path='' as $$select auction_private.save_lot(p_id,p_name,p_category,p_description,p_image,p_ends,p_start,p_status);$$;
create function auction_private.approve_bidder(p_user uuid,p_approved boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 update public.auction_profiles set approved=p_approved where user_id=p_user;
 if not found then raise exception 'Budgiveren findes ikke.'; end if;
 insert into auction_private.audit(actor,action,target,details) values(auth.uid(),'approve_bidder',p_user::text,jsonb_build_object('approved',p_approved));
end; $$;
create function public.approve_auction_bidder(p_user uuid,p_approved boolean) returns void language sql security invoker set search_path='' as $$select auction_private.approve_bidder(p_user,p_approved);$$;
create function public.auction_is_admin() returns boolean language sql security invoker set search_path='' as $$select auction_private.is_admin();$$;
create function auction_private.winners() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
 return coalesce((select jsonb_agg(result) from (
 select l.id,l.name,b.amount,b.created_at,p.full_name,p.phone,p.billing_address,u.email from public.auction_lots l
 join lateral(select * from auction_private.bids where lot_id=l.id order by amount desc limit 1) b on true
 join public.auction_profiles p on p.user_id=b.user_id join auth.users u on u.id=b.user_id
 where l.status='live' and l.ends_at<=clock_timestamp()
 )result),'[]'::jsonb);
end; $$;
create function public.auction_winners() returns jsonb language sql security invoker set search_path='' as $$select auction_private.winners();$$;

-- Remove default function access; allow only the intended entry points.
revoke all on all functions in schema auction_private from public,anon,authenticated;
grant execute on function auction_private.is_admin(),auction_private.can_view() to anon,authenticated;
grant usage on schema auction_private to anon;
grant execute on function auction_private.register_bidder(text,text,text),auction_private.place_bid(uuid,integer,uuid),auction_private.save_lot(uuid,text,text,text,text,timestamptz,integer,text),auction_private.approve_bidder(uuid,boolean),auction_private.winners() to authenticated;
revoke all on function public.register_bidder(text,text,text),public.place_auction_bid(uuid,integer,uuid),public.save_auction_lot(uuid,text,text,text,text,timestamptz,integer,text),public.approve_auction_bidder(uuid,boolean),public.auction_is_admin(),public.auction_winners() from public,anon,authenticated;
grant execute on function public.register_bidder(text,text,text),public.place_auction_bid(uuid,integer,uuid),public.save_auction_lot(uuid,text,text,text,text,timestamptz,integer,text),public.approve_auction_bidder(uuid,boolean),public.auction_is_admin(),public.auction_winners() to authenticated;
commit;
-- Bootstrap an administrator AFTER signing up and confirming email:
-- insert into auction_private.admins(user_id) select id from auth.users where email='YOUR-EMAIL';
-- Keep auction_private out of the exposed Data API schemas.
-- Public opening is a deliberate later step: update auction_private.settings set is_open=true;
