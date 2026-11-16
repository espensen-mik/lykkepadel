-- Text change: "tombola" is now "fundraising" in the program.
-- Run once after program.sql. Only changes text; an admin could also do it under Admin → Program.
begin;
update public.program_items
  set description = replace(replace(description, 'tombola', 'fundraising'), 'Tombola', 'Fundraising'), updated_at = now()
  where description ilike '%tombola%' or title ilike '%tombola%';
update public.program_items
  set title = replace(replace(title, 'tombola', 'fundraising'), 'Tombola', 'Fundraising')
  where title ilike '%tombola%';
select starts_at, title, description from public.program_items order by starts_at;
commit;
