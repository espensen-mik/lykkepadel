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

Flere administratorer tilføjes til `auction_private.admin_allowlist` (kun @lykkeliga.dk-adresser). `admin-signe.sql` tilføjer signe@lykkeliga.dk.

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

## Min side: Dine bud

Kør `my-bids.sql` én gang efter `auction-items.sql`. Den tilføjer kun funktionen `my_auction_bids()`. Funktionen giver den indloggede bruger én række pr. publiceret auktion, brugeren har budt på: højeste eget bud, aktuel pris, om brugeren fører, og om auktionen er slut. Den viser aldrig andre budgiveres identitet, og anonyme kan ikke kalde den.

Før kørslen er sektionen "Dine bud" på Min side bare skjult.

`node --test tests/my-bids.test.mjs` tester listen.

## Charity Turnering: T-shirt, virksomhed og samtykke

Kør `registration-details.sql` én gang efter `event-registration.sql`. Den tilføjer kolonner til `event_registrations`: `shirt_size`, `partner_shirt_size` (XS–3XL), `company`, `partner_company`, `publish_consent` (standard false, så det er et aktivt ja) og `details_updated_at`. Den tilføjer også `set_registration_details(...)`, som deltageren bruger til at gemme eller ændre sine valg på sin egen bekræftede tilmelding.

Før kørslen gemmes valgene ikke, og panelet på Min side og T-shirt-kolonnen i admin er skjult.

`node --test tests/registration-details.test.mjs` tester felterne.

## Min side: ret egne oplysninger

Kør `contact-details.sql` én gang efter `auction-items.sql`. Den tilføjer kun funktionen `update_my_contact(navn, telefon, faktureringsadresse)`. Funktionen retter brugerens egen budprofil og, hvis brugeren er tilmeldt turneringen, også tilmeldingen. Mailen er login og kan ikke ændres her.

Før kørslen viser Min side en besked om at skrive til signe@lykkeliga.dk.

`node --test tests/contact-details.test.mjs` tester funktionen.

## Auktionerne fra test-sitet

Kør `auction-lots-2027.sql` én gang efter `auction-items.sql`. Den opretter de fem auktioner fra demoen (to charity-produkter og tre padelmakkere) som kladder med sluttid 31. marts 2027 kl. 18.00. Rediger dem i `/admin`, og sæt status til "Live" for at offentliggøre dem. Auktioner med samme navn springes over, så filen kan køres igen uden dubletter. Instagram-profilerne fra demoen findes ikke i databasen og vises ikke på rigtige auktioner.

`node --test tests/auction-lots-2027.test.mjs` tester filen.

## Admin: starttid, papirkurv og billed-upload

Kør `auction-admin-tools.sql` én gang efter `auction-items.sql`. Den:

- tilføjer kolonnen `starts_at` til `auction_lots`. Tom betyder, at der kan bydes, så snart auktionen er live. Med en starttid vises auktionen med nedtælling, og databasen afviser bud før starttidspunktet.
- tilføjer `save_auction_lot` med starttid (11 argumenter). De ældre udgaver virker stadig og rører ikke starttiden.
- tilføjer status `trashed` (papirkurv) samt `trash_auction_lot(id, true/false)` og `delete_auction_lot(id)`. En auktion i papirkurven er skjult for alle undtagen admin og gendannes som kladde. Kun auktioner i papirkurven uden bud kan slettes for altid, så budhistorik aldrig forsvinder.
- opretter den offentlige Storage-bucket `auction-images` (kun JPEG, højst 5 MB). Alle kan se billederne, men kun administratorer kan uploade og slette dem. Billedet beskæres og får duotone i browseren, før det uploades.

Før kørslen virker admin som før. Starttid, papirkurv og upload giver en besked om at køre filen.

`node --test tests/auction-admin-tools.test.mjs` tester starttid, papirkurv, sletning og bucket-adgang.

## Admin: slet annullerede deltagere og budgivere

Kør `delete-people.sql` én gang efter `auction-items.sql`. Den tilføjer to funktioner, som kun administratorer kan kalde:

- `delete_event_registration(id)` sletter en tilmelding, der er annulleret. Bekræftede tilmeldinger skal annulleres først. Personens budprofil bliver liggende.
- `delete_auction_bidder(user_id)` sletter en budprofil. Budgivere, der har budt, kan ikke slettes, så budhistorik og fakturagrundlag bevares. Bloker dem i stedet. Budgivere med en bekræftet tilmelding skal have tilmeldingen annulleret først.

Login-kontoen i Supabase Auth slettes ikke, så personen kan oprette en ny profil senere. Begge sletninger skrives i audit-loggen.

`node --test tests/delete-people.test.mjs` tester reglerne.

## Faktura: tilmelding og vundne auktioner

Kør `invoice-payments.sql` én gang efter `auction-items.sql`. Den:

- lader tilmeldinger blive faktureret. Uden rabatkode gemmes tilmeldingen til fuld pris med afregning `invoice`. Med den gyldige rabatkode er den stadig gratis (`discount`). Eksisterende tilmeldinger røres ikke.
- giver individuelle deltagere adgang til at byde på padelmakkere, så snart tilmeldingen er bekræftet, også før fakturaen er betalt.
- tilføjer `invoice_sent_at` og `paid_at` på tilmeldinger og en privat tabel `lot_payments` til vundne auktioner. Vinderlisten (`auction_winners`) viser nu de to felter.
- tilføjer `set_registration_payment(id, faktura_sendt, betalt)` og `set_auction_lot_payment(lot, faktura_sendt, betalt)`, som kun administratorer kan kalde. `null` lader et felt være uændret. Ændringer skrives i audit-loggen.

Selve fakturaerne laves fortsat i jeres regnskabsprogram. Før kørslen kan tilmeldinger uden rabatkode ikke gennemføres, og felterne vises ikke i admin.

`node --test tests/invoice-payments.test.mjs` tester reglerne.

## Vindermails

Kør `winner-mails.sql` én gang efter `invoice-payments.sql`. Den gemmer, hvornår og til hvilken mail hver vinder har fået en vindermail, og viser det i vinderlisten. Den tilføjer `mark_auction_winner_mail(lot, mail)`, som kun administratorer kan kalde, og kun med vinderens egen mail.

Mailen sendes af `/api/winner-mails` gennem Resend fra `padel@forms.lykkeliga.dk` med svar til signe@lykkeliga.dk. Funktionen kræver Resend-nøglen i Vercel som `Resend_Api_Key` (eller `RESEND_API_KEY`). Den bruger administratorens egen Supabase-session, så der skal ikke ligge en service-nøgle i Vercel. Teksten findes i `src/winner-mail.js`.

I admin under Vindere kan man se hver mail, sende en testmail til sig selv, sende til én vinder eller sende alle, der ikke har fået en mail.

`node --test tests/winner-mails-db.test.mjs tests/winner-mails.test.mjs` tester databasen, mailen og afsendelsen.

## Billetter til Charity Showkamp

Kør `tickets.sql` én gang efter `auction-setup.sql`. Den opretter billetsalget:

- `ticket_orders` og `tickets`: ordrer og én unik billet med kode pr. person. Kun administratorer kan læse tabellerne.
- Købere logger ikke ind. Hver ordre får et hemmeligt token, som giver adgang til billetsiden `/billet#<ordre>.<token>` og kvitteringen. Tokenet ligger i en privat tabel.
- Prisen (200 kr.), kapaciteten (500) og højst 10 billetter pr. køb ligger i `auction_private.ticket_settings`. Serveren beregner beløbet. Ubetalte ordrer reserverer billetter i 30 minutter. Der kan højst være 3 ubetalte ordrer pr. mail.
- Kvitteringer får fortløbende numre (`LP-2027-0001`). Testkøb har deres egen nummerserie (`TEST-0001`).
- **Testtilstand** (`test_mode = true`, standard): betalingen simuleres, og billetterne er testbilletter, der ikke giver adgang og ikke tæller med i kapaciteten. Når QuickPay er koblet på, slås testtilstand fra.
- Admin: oversigt, send kvittering igen, annuller ordre og tjek billetter ind. QR-koden på billetten åbner `/admin#billet/<kode>`, som tjekker billetten ind med det samme.

Kvitteringsmailen sendes af `/api/ticket-receipt` gennem Resend én gang pr. ordre. Teksten findes i `src/ticket-receipt.js`.

Kør derefter `ticket-order-numbers.sql` én gang. Den giver hver ordre et ordrenummer, som QuickPay kan bruge (4–20 tegn, kun bogstaver og tal): `LP00001`, `LP00002` … for rigtige køb og `LPT00001` … for testkøb. Forstavelsen `LP` holder numrene adskilt fra webshoppen på lykkeliga.dk. Eksisterende ordrer nummereres efter oprettelse. Ordrenummeret står på billetsiden, i mailen og i admin. Kvitteringsnummeret (`LP-2027-0001`) er uændret og tildeles først ved betaling.

`node --test tests/tickets.test.mjs tests/ticket-receipt.test.mjs tests/ticket-order-numbers.test.mjs` tester billetsalget, mailen og ordrenumrene.

## Admin: ret deltageroplysninger

Kør `admin-edit-registration.sql` én gang efter `registration-details.sql`. Den tilføjer `admin_update_registration(...)`, som kun administratorer kan kalde. Den retter navn, telefon, faktureringsadresse, makkers navn, T-shirt-størrelser, virksomheder og samtykke på en tilmelding. Navn, telefon og adresse opdateres også på personens budprofil. Mailen (login) og deltagelsestypen (pris) kan ikke ændres. Ændringen skrives i audit-loggen.

`node --test tests/admin-edit-registration.test.mjs` tester funktionen.

## Billetscanner til frivillige (/scan)

Kør `ticket-scanner.sql` én gang efter `tickets.sql`. Den tilføjer en dagskode til scanneren på `lykkepadel.dk/scan`:

- Admin laver koden under Billetter (`new_scan_code(timer)`, 1–72 timer). Koden er 12 tilfældige tegn, vises én gang og gemmes kun som hash. En ny kode gør den gamle ugyldig, og `stop_scan_code()` slår den fra.
- Frivillige logger ind med koden på deres egen telefon uden Google-login. `scan_ticket(kode, billet, fortryd)` tjekker billetter ind efter de samme regler som admin. Scanneren viser kun køberens fornavn og hvor mange fra ordren, der er tjekket ind.
- Billetternes QR-kode peger nu på `/scan#KODE`. Siden læser QR-koder med kameraet på både Android og iPhone: med browserens egen QR-læser, hvor den findes, og ellers med biblioteket jsQR. Kamera-appens link og indtastning af koden virker også. Ældre links til `/admin#billet/KODE` sendes videre til scanneren for alle, der ikke er administratorer.

Kør derefter `ticket-scanner-digits.sql` én gang. Den ændrer koden til 12 cifre (`1234-5678-9012`), så telefonen viser taltastaturet. En eksisterende kode virker, til den udløber; lav en ny i admin bagefter.

`node --test tests/ticket-scanner.test.mjs` tester koden og indtjekningen.

## Ikke en offentlig lancering

Opsætningen er lukket for offentlig læsning. Administratorer kan se kladder, godkendte budgivere kan se publicerede auktioner. En anonym besøgende kan først se publicerede auktioner, når `auction_private.settings.is_open` bevidst sættes til true. Ingen ændring af forsiden er nødvendig.

Der er ingen automatisk fakturering, SMS- eller MitID-kontrol, Resend-udsendelser eller offentligt accepterede auktionsvilkår i denne opsætning. `preview-v1` markerer foreløbig accept, som skal erstattes af de endelige vilkår før rigtige bud. Budmotoren kontrollerer godkendelse og bekræftet mail, men det er ikke dokumenteret identitetskontrol.

## Lokale kontroller

`node --test tests/auction-database.test.mjs` kører SQL'en i en separat midlertidig PGlite-database med simulerede Supabase Auth-roller. Den tester RLS, tilladelser, budtrin, udløb, gentagne forespørgsler og adminbeskyttelse. Den bruger ikke den rigtige database. Samtidighed og den faktiske Supabase-integration skal også verificeres på testdata i projektet før lancering.
