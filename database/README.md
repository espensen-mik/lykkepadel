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

## Ikke en offentlig lancering

Opsætningen er lukket for offentlig læsning. Administratorer kan se kladder, godkendte budgivere kan se publicerede auktioner. En anonym besøgende kan først se publicerede auktioner, når `auction_private.settings.is_open` bevidst sættes til true. Ingen ændring af forsiden er nødvendig.

Der er ingen automatisk fakturering, SMS- eller MitID-kontrol, Resend-udsendelser eller offentligt accepterede auktionsvilkår i denne opsætning. `preview-v1` markerer foreløbig accept, som skal erstattes af de endelige vilkår før rigtige bud. Budmotoren kontrollerer godkendelse og bekræftet mail, men det er ikke dokumenteret identitetskontrol.

## Lokale kontroller

`node --test tests/auction-database.test.mjs` kører SQL'en i en separat midlertidig PGlite-database med simulerede Supabase Auth-roller. Den tester RLS, tilladelser, budtrin, udløb, gentagne forespørgsler og adminbeskyttelse. Den bruger ikke den rigtige database. Samtidighed og den faktiske Supabase-integration skal også verificeres på testdata i projektet før lancering.
