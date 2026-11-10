# Manuel opsætning i Supabase

Projekt: `iszexytxmdbcejjidfkm` (Lykke Padel). Kør aldrig filerne i et andet projekt.

1. Åbn Supabase-projektet → SQL Editor → New query.
2. Indsæt hele `auction-setup.sql`, og klik Run. Kør den én gang. Den opretter nye tabeller og funktioner i én transaktion. Den ændrer ikke eksisterende tabeller og opretter ingen Auth-brugere.
3. Kør derefter eventuelt `auction-demo-seed.sql`. Den opretter seks tydeligt fiktive profiler som kladder uden bud. Kør også kun denne én gang.
4. Kontrollér med forespørgslen nedenfor.

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('auction_lots', 'auction_profiles');

select name, status, starting_price, ends_at
from public.auction_lots order by created_at;

select is_open from auction_private.settings;
```

Forventet: to tabeller med `rowsecurity = true`; seks kladder, hvis seed-filen er kørt; `is_open = false`.

Dette er manuelle SQL-opsætningsfiler, ikke registrerede Supabase CLI-migrationer. Bevar filerne i Git som versionshistorik. En ny ændring skal laves i en separat fil; kør ikke første opsætning igen. Hvis opsætningen fejler, så send fejlen, og kør ikke seed-filen endnu.

## Administrator – Google Workspace

Følg `GOOGLE-ADMIN.md`. Kør først `auction-google-admin.sql` for at begrænse adminadgang til Google OAuth-sessioner med en verificeret @lykkeliga.dk-identitet og eksplicit administratorrolle. Google OAuth-klienten skal være Internal i LykkeLigas Workspace-organisation.

Efter første Google-login med `mikael@lykkeliga.dk` køres `auction-admin.sql`. Den verificerer, at Google-identiteten findes, før rollen tildeles. Der skal ikke oprettes en adgangskode til administratoren.

Hold `auction_private` uden for Supabases eksponerede API-schemas.

## Synligt navn og offentlig budhistorik

Kør `bid-history.sql` én gang efter `event-registration.sql`. Den:

- tilføjer kolonnen `display_name` til `auction_profiles` (2–40 tegn, unik uanset store/små bogstaver),
- tilføjer `set_auction_display_name(p_name)`, som en tilmeldt bruger kalder for at vælge eller skifte sit synlige navn,
- tilføjer `auction_bid_history(p_lot)`, som alle kan kalde for publicerede auktioner. Den returnerer kun beløb, tidspunkt, synligt navn og `is_mine`, aldrig bruger-id eller kontaktoplysninger. Budgivere uden navn vises som "Anonym budgiver".

Den eksisterende tilmeldingsfunktion er uændret, så siden virker både før og efter filen er kørt. Før kørslen er budhistorikken skjult, og synlige navne gemmes ikke.

Kontrol:

```sql
select column_name from information_schema.columns where table_name = 'auction_profiles' and column_name = 'display_name';
select public.auction_bid_history(id) from public.auction_lots where status = 'live' limit 1;
```

`node --test tests/bid-history.test.mjs` tester navne, unikhed og at historikken ikke afslører identiteter.

## Lykke Auktion: charity-produkter og padelmakkere

Kør `auction-items.sql` én gang efter `bid-history.sql`. Den:

- giver auktionerne en type, `kind`: `partner` (padelmakker) eller `item` (charity-produkt), samt en valgfri `value_text` (fx "Uvurderligt"). Eksisterende auktioner bliver padelmakkere.
- tilføjer `register_auction_bidder(...)`, så alle med en bekræftet mail kan oprette en gratis budprofil med synligt navn.
- ændrer budreglerne: alle aktive profiler kan byde på charity-produkter, mens padelmakkere stadig kræver en bekræftet individuel tilmelding.
- gør `auction_profiles.approved` til en ren blokeringsknap. Bekræftede makkerpar får en aktiv profil, så de kan byde på produkter.
- tilføjer `save_auction_lot` med type og værdi (10 argumenter). Den gamle udgave med 8 argumenter virker stadig og gemmer en padelmakker.

Siden virker både før og efter kørslen. Før kørslen kan admin kun oprette padelmakkere, og gratis profiler kan ikke oprettes.

`node --test tests/auction-items.test.mjs` tester budreglerne for begge typer.

## Ikke en offentlig lancering

Opsætningen er lukket for offentlig læsning. Administratorer kan se kladder, godkendte budgivere kan se publicerede auktioner. En anonym besøgende kan først se publicerede auktioner, når `auction_private.settings.is_open` bevidst sættes til true. Ingen ændring af forsiden er nødvendig.

Der er ingen automatisk fakturering, SMS- eller MitID-kontrol, Resend-udsendelser eller offentligt accepterede auktionsvilkår i denne opsætning. `preview-v1` markerer foreløbig accept, som skal erstattes af de endelige vilkår før rigtige bud. Budmotoren kontrollerer godkendelse og bekræftet mail, men det er ikke dokumenteret identitetskontrol.

## Lokale kontroller

`node --test tests/auction-database.test.mjs` kører SQL'en i en separat midlertidig PGlite-database med simulerede Supabase Auth-roller. Den tester RLS, tilladelser, budtrin, udløb, gentagne forespørgsler og adminbeskyttelse. Den bruger ikke den rigtige database. Samtidighed og den faktiske Supabase-integration skal også verificeres på testdata i projektet før lancering.
