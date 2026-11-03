-- Run AFTER auction-setup.sql. Safe to rerun.
-- Google OAuth must be configured as an INTERNAL application in the lykkeliga.dk
-- Google Workspace organization. Google is the only social OAuth provider for this project.
-- `hd` in the login URL is a UI hint, not an access control.
begin;
create or replace function auction_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and exists(select 1 from auction_private.admins where user_id=auth.uid())
 and exists(select 1 from auth.users where id=auth.uid()
   and email_confirmed_at is not null and not is_anonymous
   and lower(email) ~ '^[^@]+@lykkeliga[.]dk$')
 and exists(select 1 from auth.identities i join auth.users u on u.id=i.user_id
   where i.user_id=auth.uid() and i.provider='google'
   and lower(i.identity_data->>'email')=lower(u.email)
   and i.identity_data->>'email_verified'='true')
 and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
   where a->>'method'='oauth')
 and not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
   where a->>'method' in ('password','recovery','otp','magiclink','email/signup'));
$$;
revoke all on function auction_private.is_admin() from public;
grant execute on function auction_private.is_admin() to anon,authenticated;
commit;
