-- Google account login with exact email-domain restriction.
-- This does not claim to verify Google Workspace membership.
begin;
create table if not exists auction_private.admin_allowlist (
 email text primary key check(email=lower(email) and email ~ '^[^@]+@lykkeliga[.]dk$')
);
alter table auction_private.admin_allowlist enable row level security;
revoke all on auction_private.admin_allowlist from public, anon, authenticated;
insert into auction_private.admin_allowlist(email) values('mikael@lykkeliga.dk') on conflict do nothing;
create or replace function auction_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and exists(select 1 from auth.users u where u.id=auth.uid()
   and u.email_confirmed_at is not null and not u.is_anonymous
   and lower(u.email) ~ '^[^@]+@lykkeliga[.]dk$'
   and (exists(select 1 from auction_private.admins a where a.user_id=u.id)
     or exists(select 1 from auction_private.admin_allowlist a where a.email=lower(u.email))))
 and exists(select 1 from auth.identities i join auth.users u on u.id=i.user_id
   where i.user_id=auth.uid() and i.provider='google'
   and lower(i.identity_data->>'email')=lower(u.email)
   and i.identity_data->>'email_verified'='true')
 and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a where a->>'method'='oauth')
 and not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
   where a->>'method' in ('password','recovery','otp','magiclink','email/signup'));
$$;
revoke all on function auction_private.is_admin() from public;
grant execute on function auction_private.is_admin() to anon, authenticated;
commit;
