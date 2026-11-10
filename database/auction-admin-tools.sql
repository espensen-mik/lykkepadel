-- Admin tools for Lykke Auktion: start time, trash and image upload.
-- Run once after auction-items.sql. Adds a column, a status and functions; no data is deleted.
begin;

-- 1. Start time. Empty means the auction is open as soon as it is live.
alter table public.auction_lots add column starts_at timestamptz;

-- 2. Trash. A trashed lot is hidden from everyone but admins and can be restored as a draft.
alter table public.auction_lots drop constraint auction_lots_status_check;
alter table public.auction_lots add constraint auction_lots_status_check check (status in ('draft', 'live', 'trashed'));

-- Bids before the start time are refused. A trigger covers every way a bid can be inserted.
create function auction_private.check_bid_start() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.auction_lots where id = new.lot_id and starts_at > clock_timestamp()) then
    raise exception 'Auktionen er ikke startet endnu.';
  end if;
  return new;
end; $$;
create trigger bids_after_start before insert on auction_private.bids
  for each row execute function auction_private.check_bid_start();

-- Saving with a start time. The older save functions keep working and leave the start time as it is.
create function auction_private.save_lot_v3(p_id uuid,p_name text,p_category text,p_description text,p_image text,p_starts timestamptz,p_ends timestamptz,p_start integer,p_status text,p_kind text,p_value text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  if p_status is null or p_status not in ('draft', 'live') then raise exception 'Vælg kladde eller live.'; end if;
  if p_starts is not null and p_starts >= p_ends then raise exception 'Starttidspunktet skal ligge før sluttidspunktet.'; end if;
  if p_id is not null and exists(select 1 from public.auction_lots where id = p_id and status = 'trashed') then
    raise exception 'Gendan auktionen fra papirkurven, før du retter den.';
  end if;
  target := auction_private.save_lot_v2(p_id, p_name, p_category, p_description, p_image, p_ends, p_start, p_status, p_kind, p_value);
  update public.auction_lots set starts_at = p_starts where id = target;
  return target;
end; $$;
create function public.save_auction_lot(p_id uuid,p_name text,p_category text,p_description text,p_image text,p_starts timestamptz,p_ends timestamptz,p_start integer,p_status text,p_kind text,p_value text) returns uuid
language sql security invoker set search_path='' as $$select auction_private.save_lot_v3(p_id,p_name,p_category,p_description,p_image,p_starts,p_ends,p_start,p_status,p_kind,p_value)$$;

-- Move to the trash, or restore as a draft so nothing goes live by accident.
create function auction_private.trash_lot(p_id uuid, p_trash boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  update public.auction_lots set status = case when p_trash then 'trashed' else 'draft' end
  where id = p_id and (status = 'trashed') <> p_trash;
  if not found then raise exception 'Auktionen findes ikke, eller den er allerede %.', case when p_trash then 'i papirkurven' else 'gendannet' end; end if;
  insert into auction_private.audit(actor, action, target) values(auth.uid(), case when p_trash then 'trash_lot' else 'restore_lot' end, p_id::text);
end; $$;
create function public.trash_auction_lot(p_id uuid, p_trash boolean) returns void
language sql security invoker set search_path='' as $$select auction_private.trash_lot(p_id, p_trash)$$;

-- Delete for good. Only from the trash and only without bids, so the bid history is never lost.
create function auction_private.delete_lot(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare lot public.auction_lots;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  select * into lot from public.auction_lots where id = p_id for update;
  if not found then raise exception 'Auktionen findes ikke.'; end if;
  if lot.status <> 'trashed' then raise exception 'Læg auktionen i papirkurven først.'; end if;
  if lot.bid_count > 0 or exists(select 1 from auction_private.bids where lot_id = p_id) then
    raise exception 'Auktioner med bud kan ikke slettes. De bliver i papirkurven.';
  end if;
  delete from public.auction_lots where id = p_id;
  insert into auction_private.audit(actor, action, target, details) values(auth.uid(), 'delete_lot', p_id::text, jsonb_build_object('name', lot.name));
end; $$;
create function public.delete_auction_lot(p_id uuid) returns void
language sql security invoker set search_path='' as $$select auction_private.delete_lot(p_id)$$;

revoke all on function auction_private.check_bid_start(),
  auction_private.save_lot_v3(uuid,text,text,text,text,timestamptz,timestamptz,integer,text,text,text), public.save_auction_lot(uuid,text,text,text,text,timestamptz,timestamptz,integer,text,text,text),
  auction_private.trash_lot(uuid,boolean), public.trash_auction_lot(uuid,boolean),
  auction_private.delete_lot(uuid), public.delete_auction_lot(uuid)
  from public, anon, authenticated;
grant execute on function
  auction_private.save_lot_v3(uuid,text,text,text,text,timestamptz,timestamptz,integer,text,text,text), public.save_auction_lot(uuid,text,text,text,text,timestamptz,timestamptz,integer,text,text,text),
  auction_private.trash_lot(uuid,boolean), public.trash_auction_lot(uuid,boolean),
  auction_private.delete_lot(uuid), public.delete_auction_lot(uuid)
  to authenticated;

-- 3. Images. A public bucket: anyone can see the pictures, only admins can upload or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('auction-images', 'auction-images', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
create policy auction_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'auction-images' and (select auction_private.is_admin()));
-- Supabase needs read access on the object rows to delete a file.
create policy auction_images_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'auction-images' and (select auction_private.is_admin()));
create policy auction_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'auction-images' and (select auction_private.is_admin()));

commit;
