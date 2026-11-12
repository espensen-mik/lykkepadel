-- The day's program, edited by admins. Shown on the front page (two tracks side by side) and on the Charity Showkamp page.
-- Run once after auction-setup.sql. Adds one table with the current program and two admin functions.
begin;

create table public.program_items (
  id uuid primary key default gen_random_uuid(),
  -- The two parts of the day.
  track text not null check (track in ('turnering', 'showkamp')),
  starts_at time not null,
  ends_at time check (ends_at is null or ends_at > starts_at),
  title text not null check (length(title) between 1 and 80),
  description text check (description is null or length(description) between 1 and 300),
  -- Also listed on the Charity Showkamp page (e.g. the finals, which are played in front of the audience).
  on_showkamp_page boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.program_items enable row level security;
revoke all on public.program_items from public, anon, authenticated;
grant select on public.program_items to anon, authenticated;
create policy program_read on public.program_items for select to anon, authenticated using (true);

-- The program as it is on the site today.
insert into public.program_items(track, starts_at, ends_at, title, description, on_showkamp_page) values
  ('turnering', '12:30', null, 'Turneringen begynder', 'For erhvervslivet, partnere og inviterede gæster.', false),
  ('showkamp', '16:00', null, 'Dørene åbner', 'Madboder, drikkevarer, NORMAL × LykkeLiga-tombola og DJ.', true),
  ('turnering', '16:30', null, 'Finaler', 'Spilles foran publikum.', true),
  ('turnering', '17:00', null, 'Turneringen slutter', 'Deltagerne fortsætter med VIP-adgang: spisning, drikkevarer og VIP-område.', false),
  ('showkamp', '17:30', '18:30', 'Fundraising hour', 'Beat the pro, kicksmash- og stopboldkonkurrence.', true),
  ('showkamp', '19:00', null, 'Showkamp', 'Spillerne offentliggøres senere.', true);

-- "12.30" or "12:30" → time. Empty → null.
create function auction_private.program_time(p_value text) returns time
language plpgsql immutable set search_path='' as $$
declare v text := trim(coalesce(p_value, ''));
begin
  if v = '' then return null; end if;
  if v !~ '^([01]?[0-9]|2[0-3])[.:][0-5][0-9]$' then raise exception 'Skriv tiden som fx 16.30.'; end if;
  return replace(v, '.', ':')::time;
end; $$;

-- Admin: add (p_id null) or change a program item.
create function auction_private.save_program_item(p_id uuid, p_track text, p_starts text, p_ends text, p_title text, p_description text, p_on_showkamp boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.program_items; v_starts time; v_ends time;
  v_title text := trim(coalesce(p_title, '')); v_text text := nullif(trim(coalesce(p_description, '')), '');
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  if p_track is null or p_track not in ('turnering', 'showkamp') then raise exception 'Vælg Charity Turnering eller Charity Showkamp.'; end if;
  v_starts := auction_private.program_time(p_starts);
  if v_starts is null then raise exception 'Udfyld starttiden.'; end if;
  v_ends := auction_private.program_time(p_ends);
  if v_ends is not null and v_ends <= v_starts then raise exception 'Sluttiden skal være efter starttiden.'; end if;
  if length(v_title) not between 1 and 80 then raise exception 'Udfyld en titel på højst 80 tegn.'; end if;
  if length(coalesce(v_text, '')) > 300 then raise exception 'Teksten må højst være 300 tegn.'; end if;
  if p_id is null then
    insert into public.program_items(track, starts_at, ends_at, title, description, on_showkamp_page)
      values (p_track, v_starts, v_ends, v_title, v_text, coalesce(p_on_showkamp, false)) returning * into item;
  else
    update public.program_items set track = p_track, starts_at = v_starts, ends_at = v_ends, title = v_title,
      description = v_text, on_showkamp_page = coalesce(p_on_showkamp, false), updated_at = now()
      where id = p_id returning * into item;
    if not found then raise exception 'Punktet findes ikke.'; end if;
  end if;
  insert into auction_private.audit(actor, action, target, details)
    values (auth.uid(), 'save_program_item', item.id::text, jsonb_build_object('title', item.title, 'track', item.track));
  return to_jsonb(item);
end; $$;
create function public.save_program_item(p_id uuid, p_track text, p_starts text, p_ends text, p_title text, p_description text, p_on_showkamp boolean) returns jsonb
language sql security invoker set search_path='' as $$select auction_private.save_program_item(p_id,p_track,p_starts,p_ends,p_title,p_description,p_on_showkamp)$$;

create function auction_private.delete_program_item(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.program_items;
begin
  if not auction_private.is_admin() then raise exception 'Kun administratorer har adgang.'; end if;
  delete from public.program_items where id = p_id returning * into item;
  if not found then raise exception 'Punktet findes ikke.'; end if;
  insert into auction_private.audit(actor, action, target, details)
    values (auth.uid(), 'delete_program_item', p_id::text, jsonb_build_object('title', item.title, 'track', item.track));
end; $$;
create function public.delete_program_item(p_id uuid) returns void
language sql security invoker set search_path='' as $$select auction_private.delete_program_item(p_id)$$;

revoke all on function auction_private.program_time(text),
  auction_private.save_program_item(uuid,text,text,text,text,text,boolean), public.save_program_item(uuid,text,text,text,text,text,boolean),
  auction_private.delete_program_item(uuid), public.delete_program_item(uuid) from public, anon, authenticated;
grant execute on function auction_private.program_time(text),
  auction_private.save_program_item(uuid,text,text,text,text,text,boolean), public.save_program_item(uuid,text,text,text,text,text,boolean),
  auction_private.delete_program_item(uuid), public.delete_program_item(uuid) to authenticated;

commit;
