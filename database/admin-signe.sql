-- Give signe@lykkeliga.dk admin access. She logs in with Google at /admin as usual;
-- the role applies once she has a verified Google login with that address.
insert into auction_private.admin_allowlist(email) values ('signe@lykkeliga.dk') on conflict do nothing;

-- Check: both admins are listed.
select email from auction_private.admin_allowlist order by email;
