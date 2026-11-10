-- Lykke Auktion 2027: the five lots from the test site, created as drafts.
-- Run once after auction-items.sql. Lots that already exist (same name) are skipped.
-- Edit end time, start price, text and image in /admin, and set the status to "Live" to publish.
begin;

insert into public.auction_lots (name, category, description, image_url, ends_at, starting_price, status, kind, value_text)
select v.name, v.category, v.description, v.image_url, v.ends_at::timestamptz, v.starting_price, v.status, v.kind, v.value_text
from (values
  ('LykkeLiga ShowKamp på din virksomhed', 'Oplevelse', 'En helt unik mulighed for at se lykkelig håndbold i verdensklasse ude på din egen virksomhed. 10 af vores allerstørste stjerner møder op og viser, hvor lykkeskabet skal stå, når de spiller en showkamp på jeres parkeringsplads, i jeres reception eller på direktørens kontor. LykkeLiga medbringer mål og dommer og giver jeres virksomhed et eksklusivt skud lykke i arbejdsdagen.', 'https://www.lykkepadel.dk/images/brand/spillere2_16_9.jpg', '2027-03-31 18:00:00+02', 5000, 'draft', 'item', 'Uvurderligt'),
  ('Personlig video-hyldest med Rikke & Magda', 'Oplevelse', 'Trænger du til ros for dit padelspil? Hvis du vinder denne auktion, laver LykkeLiga-ikonerne Rikke Nielsen og datteren Magda en personlig video, hvor de roser dig for dine evner på padelbanen. Videoen kan fx bruges på dine sociale kanaler til at overbevise alle dine venner og kontakter om, at du faktisk ER en rigtig dygtig padelspiller.', 'https://www.lykkepadel.dk/auktioner/rikkeogmagda.jpeg', '2027-03-31 18:00:00+02', 1000, 'draft', 'item', null),
  ('Emil Lilleøre', 'Padelspiller', 'Dansk padelspiller og danmarksmester i 2026 sammen med Malthe Nielsen. Emil har også repræsenteret Danmark på seniorlandsholdet og spiller turneringer på den internationale FIP-tour.', 'https://www.lykkepadel.dk/images/Makker/lille%C3%B8re.jpeg', '2027-03-31 18:00:00+02', 500, 'draft', 'partner', null),
  ('Emil Okkels', 'Padelspiller', 'En profil i dansk elitepadel med landsholdserfaring og internationale FIP-turneringer på CV’et. I 2026 spillede Emil sig til DM-sølv sammen med Oscar Sebber.', 'https://www.lykkepadel.dk/images/Makker/emil_okkels.webp', '2027-03-31 18:00:00+02', 500, 'draft', 'partner', null),
  ('Stig Tøfting', 'Fodboldprofil', 'Du kender ham som Tøffe. Den tidligere landsholdsspiller har spillet for blandt andre AGF, Hamburger SV og Bolton. I dag er han kendt som fodboldkommentator — og padel er også blandt hans interesser.', 'https://www.lykkepadel.dk/images/Makker/stig_t%C3%B8fting.webp', '2027-03-31 18:00:00+02', 500, 'draft', 'partner', null)
) as v(name, category, description, image_url, ends_at, starting_price, status, kind, value_text)
where not exists (select 1 from public.auction_lots l where l.name = v.name);

commit;
