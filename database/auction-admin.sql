-- Run AFTER auction-google-admin.sql and the first Google Workspace login.
-- This does not create an Auth user or bypass email confirmation.
do $$
declare target uuid;
begin
 select id into target from auth.users
 where lower(email)='mikael@lykkeliga.dk' and email_confirmed_at is not null and not is_anonymous
 and exists(select 1 from auth.identities i where i.user_id=auth.users.id and i.provider='google' and lower(i.identity_data->>'email')='mikael@lykkeliga.dk' and i.identity_data->>'email_verified'='true');
 if target is null then
  raise exception 'Log først ind med mikael@lykkeliga.dk via Google Workspace-knappen i administrationen.';
 end if;
 insert into auction_private.admins(user_id) values(target) on conflict do nothing;
end;
$$;
select u.email, 'Administrator' as role
from auction_private.admins a join auth.users u on u.id=a.user_id
where lower(u.email)='mikael@lykkeliga.dk';
