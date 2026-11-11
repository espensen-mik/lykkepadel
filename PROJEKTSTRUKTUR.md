# Lykke Padel — stack, database og auktionsfunktionalitet

Dokumenteret 9. november 2026 ud fra projektets lokale kildekode, SQL-filer og tests.

Dette dokument beskriver projektets tekniske struktur og funktionelle forløb. Det indeholder ingen designinstruktioner. Det dækker den aktuelle arbejdskopi, også ændringer som endnu ikke nødvendigvis er deployet. Der er ikke foretaget en live-inspektion af Supabase, Google Cloud, Resend eller Vercel som led i denne dokumentation. Eksterne indstillinger omtales derfor som projektets dokumenterede opsætning, ikke som en ny verificering af driftsmiljøet.

## Indhold

1. [Projektets formål og nuværende niveau](#1-projektets-formål-og-nuværende-niveau)
2. [Stack og systemgrænser](#2-stack-og-systemgrænser)
3. [Filer, moduler og ruter](#3-filer-moduler-og-ruter)
4. [Build, lokal afvikling og deployment](#4-build-lokal-afvikling-og-deployment)
5. [Konfiguration og miljøvariabler](#5-konfiguration-og-miljøvariabler)
6. [Databasens opbygning](#6-databasens-opbygning)
7. [RPC-funktioner og adgangskontrol](#7-rpc-funktioner-og-adgangskontrol)
8. [Login, identitet og administratorer](#8-login-identitet-og-administratorer)
9. [Tilmeldingsforløbet](#9-tilmeldingsforløbet)
10. [Auktionsfunktionaliteten i dybden](#10-auktionsfunktionaliteten-i-dybden)
11. [Data og synlighed](#11-data-og-synlighed)
12. [Mail og Resend](#12-mail-og-resend)
13. [SQL-historik og ændringer af databasen](#13-sql-historik-og-ændringer-af-databasen)
14. [Tests og verifikation](#14-tests-og-verifikation)
15. [Ikke færdigudviklede funktioner og åbne beslutninger](#15-ikke-færdigudviklede-funktioner-og-åbne-beslutninger)
16. [Hvor man finder den autoritative implementering](#16-hvor-man-finder-den-autoritative-implementering)

## 1. Projektets formål og nuværende niveau

Lykke Padel er et charityarrangement den 2. april 2027 i Pakhus 77, Aarhus. Projektet omfatter en offentlig landing page, en prøve på en senere forside, eventtilmelding, deltageradgang, makkerauktioner og administration.

Det planlagte arrangement har omkring 70 deltagende spillere. Deltagelse findes i to kategorier:

- **Individuel:** 10.000 DKK, én deltager. Arrangøren sammensætter en makker, med mulighed for i stedet at vinde en kendt eller professionel makker på auktion.
- **Par:** 25.000 DKK, to deltagere som et fast makkerpar. Kategorien giver ikke adgang til at byde på makkere.

Deltagelsesprisen og et eventuelt auktionsbud er to forskellige beløb. Et vinderbud skal efter den planlagte model faktureres særskilt efter auktionen. Tilmeldingsbetalingen forventes senere koblet til Quickpay/Clearhaus.

Den implementerede Supabase-version er fortsat en **test med reelt gemte data**. Rabatkoden `Rabat` giver en tilmelding til 0 kr. Der er ingen kortbetaling eller automatisk fakturering. Testvilkårene bruger versionsnavnene `registration-test-v1` og `preview-v1`; de beskriver ikke en færdig, økonomisk bindende produktionsauktion.

## 2. Stack og systemgrænser

### 2.1 Frontend

Frontend er almindelig HTML, CSS og JavaScript med ES-moduler. Projektet bruger ikke React, Next.js eller en tilsvarende applikationsramme. Siderne genereres som statiske filer, og funktionerne kører i browseren.

De aktuelle pakkeversioner i `package.json` er:

- `@supabase/supabase-js` **2.118.0**: browserklient til Supabase Auth, tabellæsning og RPC-kald.
- `esbuild` **0.28.2**: bundling og minificering af JavaScript til browseren.
- `@electric-sql/pglite` **0.5.14**: lokal, isoleret PostgreSQL-lignende testdatabase. Kun en udviklingsafhængighed; ikke produktionsdatabasen.

Projektets `engines` angiver **Node.js 22 eller nyere**. `package-lock.json` fastholder afhængighederne. Node bruges til build, lokal server, kontroller og serverfunktionen; browseren kører den byggede klientkode.

### 2.2 Hosting og repository

- Repository: `https://github.com/espensen-mik/lykkepadel`.
- Offentligt domæne: `https://www.lykkepadel.dk`.
- Hosting: Vercel, med `dist/` som outputmappe.
- Vercel bygger med `npm run build` ifølge `vercel.json`.
- Git-push og databaseændringer er separate handlinger. En deployment anvender ikke automatisk SQL-filerne.

### 2.3 Backend og database

Backend består af to forskellige dele:

1. **En lille Node-serverfunktion på Vercel:** `/api/auction-config`, som udleverer aktiveret offentlig Supabase-konfiguration.
2. **Supabase:** Auth, PostgreSQL, Data API og databasefunktioner, hvor de autoritative regler for tilmelding, bud og administration ligger.

Browseren sender ikke bud til en egen Vercel-budserver. Den kalder Supabase med sin session og den offentlige publishable key. Supabase håndhæver tabelrettigheder, Row Level Security (RLS) og kontrollerne i RPC-funktionerne.

Det dokumenterede Supabase-projekt er:

- Projektreference: `iszexytxmdbcejjidfkm`.
- Projekt-URL: `https://iszexytxmdbcejjidfkm.supabase.co`.

Der er ingen implementeret egen Express-server, ORM, Redis, jobkø, Supabase Edge Function eller Supabase Storage-upload i dette repository. Billeder leveres som statiske filer eller HTTPS-adresser.

### 2.4 Overordnet kaldesti

```text
Browser
  ├─ HTML/CSS/JS/billeder fra Vercel
  ├─ GET /api/auction-config?context=participant eller admin
  │    └─ Offentlig Supabase-URL og publishable key
  └─ Supabase-klient
       ├─ Auth: mailkode eller Google OAuth
       ├─ SELECT: auktioner, egen profil, egen tilmelding
       └─ RPC: tilmelding, bud, administration, vindere
            └─ PostgreSQL: rettigheder, RLS, validering og låse

Supabase Auth → SMTP → Resend → modtagerens mail
```

## 3. Filer, moduler og ruter

> **Opdatering (branch `design/nyt-look`):** Alle sider undtagen den nuværende forside (`/`, `index.html` + `style.css`) bruger nu designsystemet "Lykke Padel designsystem".
> - `src/lp.css` erstatter `src/auction.css` og indeholder designsystemets tokens og `lp-`-komponentklasser.
> - `src/partials/header.html` og `footer.html` sættes ind af `scripts/build.mjs` på alle sider.
> - `src/ui.js` samler fælles hjælpere (dialog, toast, formularer, header-tilstand).
> - Nye statiske sider: `/om-dagen` (`src/om-dagen.html`, inkl. program på `#program`) og `/sagen` (`src/sagen.html`).
> - `/forsidetest` og `src/front-test.*` er fjernet; adressen sender videre til `/auktion`, som er den kommende forside.
> - `src/select.js` er fjernet; admin bruger almindelige `select`-felter.
> - Den gamle konto-kode med adgangskode, nulstilling af adgangskode og manuel budprofil (`register_bidder`) samt den lokale demotilmelding (`/tilmelding?demo=1`) er fjernet fra `auction.js`. Databasen er uændret.
> Afsnittene nedenfor beskriver delvist den tidligere struktur.

### 3.1 Mapper og centrale filer

- `index.html`: den nuværende offentlige landing page. Den har ingen indgang til administration eller de nye eventfunktioner.
- `style.css`: landing pagens stylesheet.
- `public/`: statiske filer, som kopieres direkte til buildets rod. `public/images/x.jpg` bliver til `/images/x.jpg`.
- `src/`: de funktionelle siders HTML, JavaScript-moduler og stylesheets.
- `api/`: Vercel-serverfunktionen for offentlig konfiguration.
- `database/`: manuelle SQL-opsætningsfiler og dokumentation af database- og Google-opsætning.
- `scripts/`: build, lokal server og forbindelsestjek.
- `tests/`: tests med Node-testløberen og PGlite.
- `docs/`: procesbeskrivelse og kilder til eksempelprofiler.
- `dist/`: genererede deploymentfiler. Mappen ignoreres i Git og genskabes ved build.

### 3.2 Browsermoduler

**`src/auction.js`** er hovedmodulet til auktionssider og administration. Det håndterer blandt andet konfiguration, Supabase-klient, identitet, hentning af auktioner, oversigt, detaljeside, budbekræftelse, adminfaner og eksport. Det indeholder også ældre konto-/passwordfunktioner og en lokal testtilmelding.

**`src/event.js`** er det aktuelle Supabase-baserede tilmeldings- og deltagerforløb: kategori, kontaktdata, serverberegnet pris, rabatkode, mailkode, afslutning af tilmelding og visning af deltagerens registrering.

**`src/event-admin.js`** viser tilmeldinger og kapacitet i administrationen. Herfra kan admin aktivere/deaktivere testkoden og annullere tilmeldinger.

**`src/registration.js`** indeholder kategorier/priser, klientvalidering og helpers til den særskilte browserdemo. Priserne findes også som autoritative regler i SQL; klientværdierne alene kan ikke oprette en gyldig tilmelding.

**`src/front.js`** driver nedtællingen på `/forsidetest` og henter auktioner med status Live til forsidens karrusel.

**`src/front-test.js`** bygger de tre eksempelkort på `/forsidetest`. Denne side læser i den aktuelle kode ikke auktionerne fra Supabase.

**`src/countdown.js`** indeholder fælles beregning og HTML for nedtælling. Modulet findes i den aktuelle arbejdskopi og bruges af testforsiden og auktionsmodulet. Beregningen er en browserfunktion, ikke en servermæssig afgørelse af udløb.

**`src/select.js`** er en helper til formularernes select-felter. Den indeholder ingen pris-, adgangs- eller budregler.

### 3.3 Ruter

- `/`: offentlig landing page.
- `/forsidetest`: separat, `noindex`-markeret eksempel på en kommende forside med information, tilmelding og de auktioner, der er Live.
- `/auktion`: oversigt over auktioner med status Live, når forbindelsen er aktiveret.
- `/auktion#spiller/<id>`: detaljeside for en auktion. ID'et læses fra URL-fragmentet; der er ikke en særskilt serverrute for hver spiller.
- `/tilmelding`: aktuel eventtilmelding.
- `/tilmelding?type=individual` og `?type=pair`: forvalg af kategori, ikke en pris- eller adgangsgodkendelse.
- `/deltager`: login med mailkode og visning af egen eventtilmelding.
- `/admin`: administration med Google-login og databasekontrolleret autorisation.
- `/administration`: kompatibilitetsadresse for tidligere links og OAuth-retur. Vercel omdirigerer til `/admin`; klienten normaliserer også adressen.

`src/auction.html` er den fælles HTML-skal til `/auktion`, `/tilmelding`, `/deltager`, `/admin` og `/administration`. JavaScript vælger funktion ud fra adressen. `/forsidetest` har sin egen HTML-skal.

Admin er ikke linket fra den offentlige navigation. Den skjulte adresse er en praktisk opdeling; den egentlige adgangskontrol er Google-sessionen, administratorrollen og SQL-kontrollerne.

## 4. Build, lokal afvikling og deployment

```sh
npm ci
npm run dev
```

`npm run dev` kører `scripts/serve.mjs`, som først bygger projektet og derefter serverer `dist/` på `127.0.0.1:5173`. Porten kan ændres med miljøvariablen `PORT`.

Der er ikke hot module replacement. Ændringer af kildefiler kræver nyt build og genindlæsning af browseren:

```sh
npm run build
npm run preview
```

`npm run preview` serverer et allerede bygget `dist/`. Det starter ikke et nyt build.

Buildscriptet:

1. Fjerner og genskaber `dist/`.
2. Kopierer landing page og stylesheet.
3. Kopierer `public/` til roden af `dist/`.
4. Opretter mapper og HTML for de funktionelle ruter.
5. Kopierer stylesheets.
6. Bundler `auction.js` og `front-test.js` med deres importer til browser-ES-moduler.

Vercel serverer de statiske filer og `/api/auction-config`. Den lokale server kalder samme konfigurationshandler, så konfigurationen ikke kræver en anden kodevej lokalt. `.env.local` indlæses lokalt; allerede angivne procesmiljøvariabler har forrang.

På en almindelig statisk filhost er HTML-filerne tilgængelige, men den Supabase-tilsluttede del kræver også en tilsvarende implementering af konfigurationsendpointet. `dist/` alene indeholder ikke den Vercel-serverfunktion.

## 5. Konfiguration og miljøvariabler

`.env.example` viser variabelnavnene. `.env.local`, andre lokale miljøfiler, `node_modules/` og `dist/` ignoreres af Git.

- `SUPABASE_URL`: projektets HTTPS-URL.
- `SUPABASE_PUBLISHABLE_KEY`: offentlig nøgle med præfikset `sb_publishable_`.
- `AUCTIONS_ENABLED`: når værdien er præcis strengen `true`, kan konfigurationsendpointet returnere forbindelse uden en særlig kontekstbegrænsning.
- `ADMIN_AUTH_ENABLED`: giver konfiguration til forespørgsler med `context=admin`.
- `REGISTRATION_ENABLED`: giver konfiguration til `context=participant`, som bruges til tilmelding, deltagerside og den offentlige auktionskode.
- `PORT`: lokal servers port; standard er 5173.

### 5.1 Konfigurationsendpointet

`GET /api/auction-config` returnerer kun offentlig URL og publishable key, når et relevant flag er aktiveret. Kun GET accepteres.

- **200:** `{enabled:true,url,key}`.
- **404:** funktionen er ikke aktiveret i den efterspurgte kontekst.
- **503:** URL eller gyldig publishable key mangler.
- **405:** anden HTTP-metode end GET.

Svaret markeres `Cache-Control: no-store`.

Flags er en konfigurationsmekanisme, ikke databaseautorisation. Når offentlig forbindelse er udleveret, kan Data API kaldes direkte. En database med offentligt læsbare `live`-auktioner bliver derfor ikke privat alene ved at skjule navigation eller slå et frontendflag fra.

Der bruges ingen service-role-nøgle i browseren. Resend-nøgle og Google Client Secret hører til eksterne tjenesteindstillinger og udleveres ikke fra dette endpoint.

## 6. Databasens opbygning

Databasen bruger Supabases `auth`-schema, applikationstabeller i `public` og et særskilt `auction_private`-schema. `auction_private` er ifølge projektets opsætning ikke et eksponeret Data API-schema.

Alle applikationstabeller i SQL-filerne har RLS aktiveret. Direkte tabelrettigheder er også eksplicit begrænset. RLS og SQL-funktionernes egne kontroller arbejder sammen; RLS er ikke den eneste kontrol.

### 6.1 `auth.users` og `auth.identities`

Supabase administrerer disse tabeller.

- `auth.users.id` er identitetsnøglen for deltagere, budgivere og admins.
- Bekræftet mail og `is_anonymous` kontrolleres ved registrering og bud.
- `auth.identities` bruges til at verificere adminens Google-identitet og dens mailadresse.
- En Auth-konto er ikke i sig selv en eventtilmelding, en godkendt budprofil eller en administratorrolle.

### 6.2 `public.auction_profiles`

Én budgiverprofil pr. Auth-bruger, identificeret af `user_id` som primærnøgle og reference til `auth.users`.

Felter:

- `user_id`: kontoens UUID.
- `full_name`: 2–120 tegn.
- `phone`: 6–30 tegn.
- `billing_address`: 5–500 tegn.
- `approved`: godkendt/blokeret til bud; standard `false`.
- `terms_version`: aktuelt bundet til `preview-v1`.
- `created_at`: oprettelsestidspunkt med tidszone.

Brugeren kan læse sin egen profil; admin kan læse alle. Klienten kan ikke selv skrive `approved=true` via et almindeligt tabelkald.

Den aktuelle eventregistrering opretter eller opdaterer også profilen. Individuel deltagelse giver `approved=true`; par giver `approved=false`. Admin kan efterfølgende blokere profilen. Profilgodkendelse alene er ikke nok til at byde efter eventregistreringsopdateringen.

### 6.3 `public.auction_lots`

Én række pr. udbudt makkeroplevelse. Spilleren er aktuelt ikke normaliseret til en særskilt spiller-/person-tabel.

- `id`: genereret UUID.
- `name`: spillerens navn, 2–100 tegn.
- `category`: beskrivende kategori, 1–60 tegn.
- `description`: tekst, 10–3.000 tegn.
- `image_url`: HTTPS-adresse. Databasens constraint accepterer ikke en lokal `/images/...`-sti.
- `ends_at`: absolut sluttidspunkt, `timestamptz`.
- `starting_price`: helt antal kroner; 500–10.000.000 og deleligt med 500.
- `current_bid`: seneste accepterede bud; 0 før første bud.
- `bid_count`: antal accepterede bud.
- `status`: kun `draft` eller `live`.
- `created_at`: oprettelsestidspunkt.

`current_bid` og `bid_count` er opsummeringer af budbogen. De opdateres i samme databasetransaktion som indsættelsen af et bud.

Der er ikke en gemt status `ended`, en `winner_id`, en startdato eller en betalingsstatus på auktionen. Afslutning udledes af `ends_at` og databasens aktuelle tid.

Efter `event-registration.sql` kan alle læse rækker med `status='live'`, også uden login. Kun admin kan læse kladder. Auktionstabellen indeholder ikke budgiverens navn, kontaktdata eller vinderidentitet.

### 6.4 `public.event_registrations`

Én eventtilmelding pr. Auth-bruger. `id` er et genereret UUID; `user_id` har en unik constraint og refererer til `auth.users`.

Felterne beskriver både deltagelse og den aktuelle testafregning:

- `kind`: `individual` eller `pair`.
- `seats`: henholdsvis 1 eller 2.
- `full_name`, `email`, `phone`, `billing_address`: tilmelderens kontaktdata.
- `partner_name`: krævet for par; `null` ved individuel deltagelse.
- `base_price`: 10.000 for individuel og 25.000 for par.
- `discount_amount`: i den aktuelle test altid hele grundprisen.
- `amount_due`: i den aktuelle tabeldefinition altid 0.
- `settlement`: i denne version kun `discount`.
- `discount_code`: anvendt kode; afslutningsfunktionen gemmer `Rabat`.
- `status`: `confirmed` eller `cancelled`.
- `terms_version`: aktuelt `registration-test-v1`.
- `created_at`: oprettelsestidspunkt.

Tabellen har constraints, der binder kategori, antal pladser, pris og partnerfelt sammen. Den kan endnu ikke repræsentere en almindelig kortbetalt eller afventende betaling: det kræver en senere schemaændring.

Brugeren kan læse sin egen tilmelding; admin kan læse alle. Direkte klient-INSERT, UPDATE og DELETE er ikke tilladt.

En parregistrering har kun én konto og partnerens navn som tekst. Partneren oprettes ikke som en selvstændig deltagerkonto. En annulleret række bliver stående, og den unikke `user_id` betyder, at samme konto ikke blot kan tilmelde sig igen gennem det eksisterende flow.

### 6.5 `auction_private.bids`

Den private budbog med én række pr. accepteret bud:

- `id`: genereret UUID.
- `lot_id`: reference til auktionen.
- `user_id`: reference til budgiverens Auth-konto.
- `amount`: helt antal kroner, 500–10.000.000 og deleligt med 500.
- `request_id`: unik UUID til dubletbeskyttelse.
- `created_at`: registreret med databasens `clock_timestamp()`.

Der er indeks på `(lot_id, created_at desc)` og på `user_id`. Klientroller har ingen direkte tabeladgang. Budbogen bliver hverken udleveret som offentlig budhistorik eller ændret af klienten direkte.

### 6.6 `auction_private.admins`

Eksplicitte administratorroller med `user_id` som primærnøgle og reference til `auth.users`. Rollen giver kun adminadgang, hvis den aktuelle `is_admin()`-funktion også accepterer kontoens domæne, Google-identitet og session.

### 6.7 `auction_private.admin_allowlist`

Tilføjet af den seneste Google-domæneopdatering. Indeholder lowercase-mailadresser på præcis `lykkeliga.dk`. Filen indsætter `mikael@lykkeliga.dk`.

En allowlist-post kan opfylde rollekravet, før der findes en post i `admins`, men erstatter ikke Google- og sessionskontrollerne. Andre LykkeLiga-konti bliver ikke automatisk admins alene på grund af deres domæne.

### 6.8 `auction_private.settings`

En enkelt konfigurationsrække med `is_open`, oprindeligt `false`. Den blev brugt af den oprindelige `can_view()`-funktion til at styre offentlig auktionslæsning.

**Vigtig historik:** `event-registration.sql` erstatter læsepolitikken med `status='live' OR is_admin()`. Efter denne opdatering styrer `settings.is_open` ikke længere den aktive SELECT-politik på `auction_lots`. Tabellen og den gamle helper er ikke slettet, men de må ikke forveksles med den aktuelle offentlige åbningsmekanisme.

### 6.9 `auction_private.event_settings`

Én konfigurationsrække:

- `capacity`: standard 70 pladser.
- `registration_open`: standard `true`.
- `coupon_active`: standard `true`.

`id` er en boolean-primærnøgle med constraint, der tillader én singleton-række. Samme princip anvendes i `settings`.

Admin-RPC'en kan ændre `coupon_active`. Kapacitet og `registration_open` kan læses gennem admin-RPC'en, men har ikke redigeringskontroller i det nuværende adminmodul.

### 6.10 `auction_private.audit`

Administrativ og funktionel hændelseslog:

- `id`: identity-genereret bigint.
- `actor`: aktørens UUID; ikke defineret som fremmednøgle i denne tabel.
- `action`: handlingens navn.
- `target`: reference som tekst.
- `details`: valgfri JSONB med yderligere oplysninger.
- `created_at`: databasens hændelsestidspunkt.

Der logges blandt andet `save_lot`, `approve_bidder`, `event_registration`, `event_coupon` og `cancel_event_registration`. Bud findes i deres egen budbog; auditloggen er ikke en fuldstændig log over alle læsninger, loginforsøg eller systemhændelser. Der er ingen auditlogfane i admin.

## 7. RPC-funktioner og adgangskontrol

Offentlige RPC-navne findes i `public`. De fungerer overvejende som små `SECURITY INVOKER`-wrappers til funktioner i `auction_private`.

De private implementeringer bruger `SECURITY DEFINER`, tom `search_path` og fuldt kvalificerede tabelnavne. De foretager eksplicit identitets- og rettighedskontrol. Standardrettigheder er tilbagekaldt, og execute gives til de tilsigtede roller. At en funktion ligger i `auction_private` betyder ikke, at den aldrig eksekveres på vegne af en browser; browseren når den gennem den tilladte wrapper og databasefunktionens kontroller.

### 7.1 Deltager- og budfunktioner

- `event_registration_quote(p_kind, p_code)`: offentlig prisberegning. Returnerer grundpris, rabat, restbeløb og antal pladser. Reserverer ikke en plads.
- `complete_event_registration(p_kind, p_name, p_phone, p_address, p_partner, p_code, p_terms)`: opretter tilmelding, kontrollerer identitet, kategori, pris, rabat, kapacitet og vilkår; opretter/opdaterer budprofil i samme transaktion.
- `event_bid_access()`: returnerer, om den aktuelle konto har en kvalificerende individuel eventtilmelding. Funktionen inkluderer ikke i sig selv profilens `approved`; den kontrolleres særskilt ved bud.
- `register_bidder(p_name, p_phone, p_address)`: ældre separat oprettelse af budprofil. Den kan ikke erstatte en eventtilmelding.
- `place_auction_bid(p_lot, p_amount, p_request)`: autoritativ budafgivelse; beskrevet i afsnit 10.

### 7.2 Adminfunktioner

- `auction_is_admin()`: afgør, om den aktuelle konto og session opfylder administratorreglerne.
- `save_auction_lot(...)`: opretter eller opdaterer en auktion. Kræver admin, fremtidig sluttid og ingen eksisterende bud ved redigering.
- `approve_auction_bidder(p_user, p_approved)`: godkender eller blokerer en profil. Giver ikke i sig selv individuel eventdeltagelse.
- `auction_winners()`: returnerer højeste bud og kontaktoplysninger for udløbne, publicerede auktioner med bud. Kun admin.
- `event_admin_settings(p_coupon default null)`: returnerer kapacitet, optagne pladser og status; kan samtidig aktivere/deaktivere testkoden.
- `cancel_event_registration(p_id)`: annullerer tilmelding, blokerer profil og logger handlingen. Bud slettes ikke.

## 8. Login, identitet og administratorer

### 8.1 Deltagere: engangskode på mail

Den aktuelle deltagermodel er passwordfri:

1. Browseren kalder `signInWithOtp` med mailadressen.
2. Ved tilmelding er `shouldCreateUser=true`; ved deltagerlogin er den `false`.
3. Supabase Auth sender mail gennem SMTP.
4. Brugeren indtaster koden.
5. `verifyOtp` med `type:'email'` opretter en Supabase-session.
6. Efter verificering kan tilmeldingen afsluttes eller egen registrering hentes.

Klienten anvender Supabase-klientens standardhåndtering af sessioner. En eksisterende gyldig session kan bruges igen på samme enhed; en ny enhed kan få en ny kode. Kodeudløb, udbyderindstillinger og Auth-rate limits er Supabase-konfiguration uden for repository. Frontend har en 60-sekunders ventetid på gensendelsesknappen og håndterer HTTP 429, men den knap er ikke en servermæssig misbrugsbeskyttelse.

**Mailbekræftelse er ikke dokumenteret identitetskontrol.** Navn, telefon og faktureringsadresse er selvoplyste. Der er ingen SMS-verificering, MitID eller kortverificering i den implementerede adgangskæde.

### 8.2 Administratorer: Google OAuth og eksplicit adgang

Admin starter Google-login gennem Supabase med returadresse `<origin>/administration`. Google-klienten bruger et `hd=lykkeliga.dk`-hint og kontovælger. Hintet er ikke adgangskontrollen.

Den seneste SQL-version af `is_admin()` kræver samlet:

- En eksisterende Auth-bruger med bekræftet mail, som ikke er anonym.
- En mailadresse på præcis `lykkeliga.dk`.
- Enten en eksplicit brugerrolle i `admins` eller mailadressen i `admin_allowlist`.
- En Google-identitet i `auth.identities`, hvis verificerede mail matcher Auth-brugerens mail.
- At sessionens JWT-`amr` indeholder `oauth`.
- At `amr` ikke indeholder en af de eksplicit afviste password-/recovery-/OTP-/mailmetoder.

Denne model kræver Google-login og domæne, men hævder ikke selv at kontrollere aktuelt medlemskab af Google Workspace gennem et organisations-API. Den seneste domænefil afløser den tidligere mere Workspace-orienterede instruktion.

OAuth-forløbet har to forskellige returdestinationer:

- Google → Supabase: `https://iszexytxmdbcejjidfkm.supabase.co/auth/v1/callback`.
- Supabase → applikationen: `<origin>/administration`, hvorefter adressen normaliseres til `/admin`.

Google Client ID, Client Secret, provideraktivering og tilladte returadresser ligger i Google Cloud/Supabase, ikke i frontendkoden. De eksterne indstillinger skal passe til det miljø og den lokale port, man faktisk benytter.

### 8.3 Ældre kontokode

`auction.js` indeholder stadig funktioner til email/password-login, passwordreset og separat manuel budprofil. Det primære aktuelle deltagerflow går gennem `event.js` og OTP. En ældre godkendt budprofil kan ikke omgå kravet om bekræftet individuel eventtilmelding i den seneste SQL.

## 9. Tilmeldingsforløbet

### 9.1 Klientens trin

1. Vælg individuel deltagelse eller par.
2. Indtast navn, mail, telefon, faktureringsadresse og eventuelt partnernavn.
3. Indtast eventuel rabatkode.
4. Hent et tilbud via `event_registration_quote`.
5. Gennemse oplysninger og accepter testtilmeldingen.
6. Bekræft mail med OTP, hvis der ikke allerede er en gyldig indlogget konto.
7. Kald `complete_event_registration`.
8. Vis registreringens reference og adgang til auktionen/deltagersiden.

Et uafsluttet tilmeldingsudkast gemmes i browserens `sessionStorage` under `lykke-event-draft-v2`. Det er ikke en reservation, databasekvittering eller en dokumenteret betaling. Udkastet fjernes efter en vellykket afslutning.

Mailen, som gemmes i databasen, kommer fra den bekræftede Auth-konto. Browseren kan ikke vælge en anden mailadresse som tilmeldingens identitet ved RPC-kaldet.

### 9.2 Rabat og pris

`Rabat` kontrolleres case-insensitivt og med trimning af mellemrum. Koden giver 100 % rabat, hvis både registreringen og kuponen er aktive. En ikke-tom, ukendt eller deaktiveret kode afvises. Uden kode kan prisfunktionen godt returnere fuld pris, men afslutningsfunktionen afviser et beløb forskelligt fra 0.

Pris og rabat beregnes igen ved afslutning. Det tilbud, som browseren så tidligere, er ikke bindende for databasens efterfølgende kontrol. Deaktivering af koden påvirker nye afslutninger, ikke allerede bekræftede tilmeldinger.

### 9.3 Transaktion, kapacitet og dubletbeskyttelse

Afslutningen låser først Auth-brugeren, så samtidige afslutninger for samme konto serialiseres. Derefter låses singleton-rækken i `event_settings`, så tildeling af pladser serialiseres på tværs af konti.

Databasen tæller `seats` for `confirmed`-tilmeldinger og kontrollerer, at den nye tilmelding ikke overskrider kapaciteten. Par optager to pladser. Først herefter indsættes tilmelding, budprofil og auditpost som én samlet operation.

Hvis samme konto gentager en allerede bekræftet tilmelding med samme kategori, navn, telefon, adresse og partner, returneres den eksisterende række. Ændrede oplysninger eller en tidligere annulleret registrering afvises med besked om at kontakte arrangøren. Det er ikke et selvbetjent ændrings-/genaktiveringsflow.

Der er ingen tidsbegrænset pladsreservation, venteliste eller betalingssession, der holder pladser under et checkout.

### 9.4 Budadgang og annullering

En individuel, bekræftet rabattilmelding giver i denne test automatisk en godkendt profil. Et par får ikke denne godkendelse.

Ved annullering beholdes tilmeldingen med `status='cancelled'`, og profilens `approved` sættes til `false`. Pladserne tælles herefter ikke med. Nye bud afvises; gamle bud ligger stadig i budbogen og kan fortsat være højeste bud. Der er endnu ikke en automatisk omfordeling af sådanne bud.

## 10. Auktionsfunktionaliteten i dybden

### 10.1 Hvad der auktioneres over

Et lot repræsenterer muligheden for at blive makker med den navngivne person. Datastrukturen gemmer navn, kategori, beskrivelse, billede, startpris, sluttid og budopsummering.

Der er endnu ikke en selvstændig kontrakt-/oplevelsestabel, programplan, kampplan eller en relation, der efter en sejr opretter det endelige makkerpar. Det nuværende system registrerer bud og beregner vinderen; arrangementets praktiske makkerfordeling er et senere lag.

### 10.2 Oprettelse og publicering

Admin opretter et lot via `save_auction_lot`. Et lot kan være kladde eller publiceret. Sluttid skal ligge i fremtiden. Startprisen skal overholde databasens beløbsgrænser og 500-kroners trin.

Når `status='live'`, er lot'et læsbart for offentligheden efter den seneste SQL-opdatering. Der er ingen særskilt `starts_at`, så en publiceret auktion med fremtidig sluttid er straks åben for kvalificerede bud.

Så snart der er et bud, afviser gemmefunktionen alle almindelige redigeringer, også ændringer af navn, tekst, billede, pris, status og sluttid. Adminvisningen viser i stedet oplysningerne. Der er ingen implementeret nødstops-, budannullerings- eller tvistprocedure i modulet.

### 10.3 Offentlig visning og opdatering

Browseren henter `auction_lots` gennem SELECT og sorterer/viser de rækker, RLS tillader. Admin kan se kladder; andre kan kun se publicerede lots.

Den Supabase-tilsluttede auktion poller efter lotdata hvert **10. sekund**, når fanen er synlig, admin ikke vises, og der ikke er en åben modal eller en igangværende polling. Ændret lotdata fører til ny visning.

Der er ikke en Supabase Realtime-subscription, WebSocket-budstrøm eller øjeblikkelig pushopdatering til alle besøgende. Et vist seneste bud kan derfor være forældet. Det er tilladt, fordi databasen genkontrollerer den aktuelle pris, når nogen forsøger at byde.

Nedtællingen beregnes hvert sekund fra `ends_at` og browserens ur. Det er en informationsvisning. Databasens ur afgør, om buddet faktisk er modtaget i tide.

### 10.4 Samlet adgangskrav til et bud

Et databasebud kræver alle følgende forhold:

1. En indlogget Auth-bruger.
2. En profil med `approved=true`.
3. En bekræftet mail og en ikke-anonym konto.
4. En `confirmed` eventtilmelding af typen `individual`.
5. Tilmeldingens `amount_due=0` og `settlement='discount'` i den aktuelle testmodel.
6. At registreringens mail stadig matcher kontoens bekræftede mail.
7. Et publiceret lot, som endnu ikke er udløbet.
8. Et gyldigt beløb og en gyldig budreference.

`event_bid_access()` svarer på eventdelen af adgangen. Profilgodkendelse og de øvrige budkontroller ligger også i budfunktionen. En adminrolle betyder ikke i sig selv, at kontoen er tilmeldt som individuel deltager.

Par kan ikke få budadgang blot ved at blive manuelt godkendt som budgivere. En tidligere oprettet profil uden eventtilmelding kan heller ikke byde.

### 10.5 Beløb og budtrin

Beløb gemmes som **hele danske kroner**, ikke øre og ikke flydende tal.

- Før første bud er minimum lot'ets `starting_price`.
- Efter første bud er minimum `current_bid + 500`.
- Alle bud skal være delelige med 500.
- Maksimalt bud er 10.000.000 DKK.
- Det er muligt at springe flere trin over; præcis 500 kr. højere er ikke et krav.

Eksempel: Ved et aktuelt bud på 3.500 kr. kan 4.000, 4.500 eller 5.000 accepteres. 3.500 og 4.100 afvises. Hvis to personer ser 3.500 og begge byder 4.000, kan kun det første accepterede 4.000-bud vinde den pris; den anden skal byde mindst 4.500.

Der er ingen maksimumsbud/proxybud eller automatisk budrobot. Det indsendte beløb er det faktiske bud.

### 10.6 Fra klik til registreret bud

1. Deltageren åbner lot'ets detaljeside.
2. Klienten beregner et foreløbigt minimum og lader deltageren indtaste et beløb.
3. Klienten kontrollerer heltal og budtrin og viser en særskilt bekræftelse.
4. Der genereres en UUID med `crypto.randomUUID()` som `p_request` for bekræftelsen.
5. Ved bekræftelse kaldes `place_auction_bid(p_lot, p_amount, p_request)`.
6. Databasen kontrollerer rettigheder, registrering, lot, tid og pris under låse.
7. Budrækken indsættes, og lot'ets opsummering opdateres atomisk.
8. Klienten henter lotdata igen og viser kvittering for det accepterede beløb.

Ved afvisning henter klienten nye lotdata, så et højere minimum eller udløb kan vises. En lokal succesbesked er ikke budets datagrundlag; den accepterede databaseoperation er det.

### 10.7 Låse og samtidige bud

Den aktuelle private `place_bid`-funktion bruger følgende hovedrækkefølge:

1. Kontroller indlogget konto.
2. Lås den godkendte profil med `FOR SHARE`.
3. Kontroller bekræftet, ikke-anonym Auth-bruger.
4. Lås den kvalificerende eventregistrering med `FOR SHARE` og kontroller eventadgang.
5. Lås lot-rækken med `FOR UPDATE`.
6. Behandl eventuel eksisterende `request_id`.
7. Kontroller `live`, `ends_at`, minimum og budtrin.
8. Indsæt bud og opdater lot i samme transaktion.

Lot-låsen betyder, at bud mod samme lot behandles efter hinanden. Den anden transaktion ser den opdaterede `current_bid`, når den får låsen. Kontrollen af `clock_timestamp()` sker efter lot-låsen: et bud, der venter på en lås og først kan behandles efter udløb, bliver afvist.

Profilens shared lock koordinerer med adminblokering og annullering. En blokering/annullering, der får sin skrivende lås først, forhindrer efterfølgende nye bud. Et allerede accepteret bud slettes ikke af en senere blokering.

Dette er databasens implementerede mekanisme. De lokale tests er ikke en belastningstest af mange samtidige forbindelser til den eksterne Supabase-instans.

### 10.8 Idempotens og netværksfejl

`bids.request_id` er unik. En gentagelse med samme request-ID, bruger, lot og beløb returnerer det tidligere accepterede bud uden at øge budtælleren igen. Genbruges samme reference med andre data, afvises den.

Rettigheds- og registreringskontrollerne sker før replay-opslaget. Et gammelt accepteret bud kan derfor ikke nødvendigvis genafspilles som succes efter en efterfølgende blokering eller annullering, selv om budrækken består.

Idempotens beskytter kun gentagelser med **samme** nøgle. En helt ny bekræftelsesdialog genererer en ny UUID. Der er ikke en implementeret holdbar retrykø, som overlever genindlæsning og automatisk genbruger en usikkert leveret budreference. To samtidige kald mod forskellige lots med samme request-ID kan desuden ende i den unikke constraint frem for en pæn replay-kvittering; der indsættes stadig ikke to bud med samme reference.

### 10.9 Udløb og afslutning

Auktionen er lukket for nye bud, når `ends_at <= clock_timestamp()` eller `status` ikke er `live`. Sluttiden gemmes som `timestamptz`. Adminindtastning konverteres fra dansk lokaltid med `Europe/Copenhagen`, og visningerne anvender dansk tid, uanset browserens lokale tidszone.

Der er ingen automatisk forlængelse ved sene bud. Der er heller ingen cron-opgave, der ændrer lot'ets status ved udløb. Et udløbet lot kan stadig have `status='live'`; frontend og vinderfunktionen fortolker tiden.

Der gemmes ikke et permanent afslutnings-/vinderevent. Vinderlisten beregnes ved forespørgsel.

### 10.10 Vindere og fakturagrundlag

`auction_winners()` er kun til admin. Den finder lots med `status='live'` og overskredet sluttid og vælger det højeste bud for hvert lot. Budreglerne gør accepterede beløb strengt stigende inden for samme lot; samme beløb kan derfor ikke skabe en normal delt førsteplads.

Funktionen sammenkobler lot, budbog, budprofil og Auth-konto og returnerer blandt andet:

- Lot-ID og spillernavn.
- Vinderbeløb og budtidspunkt.
- Vinderens navn, mail, telefon og faktureringsadresse.

Kontaktdata læses fra de aktuelle profil-/Auth-rækker. De er ikke et historisk faktureringssnapshot gemt på budtidspunktet.

Admin kan hente et semikolonsepareret CSV-fakturagrundlag med navn, beløb og kontaktoplysninger. Klienten skriver UTF-8-BOM og forsøger at neutralisere indledende regnearksformeltegn i cellerne.

CSV er ikke en faktura. Systemet opretter ikke fakturanumre, sender ikke betalingskrav og registrerer ikke, om vinderen har betalt. Lot uden bud giver ingen vinder. Annullering af eventtilmelding eller blokering af profilen fjerner ikke automatisk en person fra en eksisterende vinderposition.

### 10.11 Flere samtidige auktioner og makkerfordeling

Der er ingen regel, som forhindrer samme deltager i at byde på eller vinde flere lots. Vinderfunktionen beregner resultatet pr. lot uden at koordinere på tværs af spillere.

Det er en central åben forretningsregel: deltageren skal normalt kun have én makker. Valg af regel kan påvirke hele budmotoren, eksempelvis om man må føre på flere lots, om en sejr lukker andre muligheder, og hvad der sker med tidligere bud. Ingen sådan model er implementeret endnu.

Der er heller ikke implementeret automatisk matching af dem, der ikke vinder, eller sammensætning af endelige hold til arrangementet.

## 11. Data og synlighed

Der er ingen browserdemo længere; `/auktion?demo=1` viser den almindelige side. Alle ruter bruger Supabase. Besøgende ser kun auktioner med status `live` (RLS-politikken `auction_read`). Kladder og auktioner i papirkurven ses kun af administratorer. `/forsidetest` henter de samme live auktioner direkte via REST med den publishable nøgle.

## 12. Mail og Resend

Mailkæden er dokumenteret som:

```text
Frontend → Supabase Auth → custom SMTP hos Supabase → Resend → mailmodtager
```

Projektets dokumenterede afsender er `Lykke Padel <padel@forms.lykkeliga.dk>`. Supabases Auth-mailskabeloner bruger kodevariablen `{{ .Token }}` til mailbekræftelse/login.

Resend er SMTP-leverandør for Auth. Browseren kalder ikke Resends API, og der er ingen Resend-SDK eller direkte afsendelsesfunktion i repository. SMTP-nøgle og legitimationsoplysninger ligger i Supabases konfiguration; de skal ikke kopieres ind i dokumentationen eller klientkonfigurationen.

Der er endnu ingen separate mails for tilmeldingskvittering, overbud, auktionssejr, påmindelser eller faktura. Resend fungerer heller ikke i sig selv som deltagerdatabase. Deltagerdata og adgang ligger i PostgreSQL/Auth.

## 13. SQL-historik og ændringer af databasen

Filerne i `database/` er manuelle SQL-scripts, ikke en komplet tidsstemplet Supabase CLI-migrationskæde med automatisk deploy.

Deres rolle er:

1. `auction-setup.sql`: oprindelige schemas, tabeller, budmotor, rettigheder og RPC'er. Engangsopsætning; ikke idempotent.
2. `auction-demo-seed.sql`: valgfri indsættelse af seks fiktive kladder. Engangsseed; ikke et aktuelt databaseudtræk.
3. `auction-google-admin.sql`: historisk første stramning af adminlogin til Google-session/domæne med eksplicit rolle.
4. `auction-admin.sql`: historisk bootstrap af Mikaels bruger-ID efter verificeret Google-login.
5. `auction-google-domain-login.sql`: seneste erstatning af `is_admin()`, inklusive mail-allowlist og den aktuelle domænemodel.
6. `event-registration.sql`: tilmelding, rabat, kapacitet, eventadgang, adminannullering og erstatning af budfunktion og offentlig læsepolitik.

For en ny database er grundopsætningen nødvendig før de afhængige opdateringer. Den seneste domænefil kan erstatte behovet for den historiske manuelle administratorbootstrap, men rækkefølgen og projektet skal stadig gennemgås ved en ny installation. `event-registration.sql` er heller ikke et script, der blot kan køres igen uden vurdering.

De senest definerede funktioner og politikker gælder. Det er derfor forkert at beskrive systemet alene ud fra `auction-setup.sql` eller ældre README-afsnit. Eksempelvis er offentlig læsning og krav om eventtilmelding ændret senere.

Dette dokument verificerer ikke hvilke scripts, der aktuelt er anvendt på den eksterne database. En sammenligning med den konkrete database kræver særskilt schema-/funktionsinspektion. Ingen SQL er kørt mod driftsdatabasen som led i dokumentationen.

## 14. Tests og verifikation

```sh
npm test
npm run build
npm run check:supabase
```

- `npm test`: Node's indbyggede testløber med filerne i `tests/`.
- `npm run build`: kontrollerer at sider og JavaScript kan bygges til `dist/`.
- `npm run check:supabase`: read-only kald til Supabase Auth-indstillinger med den konfigurerede publishable key. Det er ikke en kontrol af auktionsschema, RLS, Google-login eller SMTP-levering.

Testfilerne dækker forskellige lag:

- `auction-config.test.mjs`: flag, kontekster og sikring mod forkert nøgleformat.
- `auction-database.test.mjs`: oprindelig budmotor, adgang, udløb, idempotens og efterfølgende Google-adminregler.
- `event-registration.test.mjs`: pris/rabat, registrering, kapacitet, privatliv mellem brugere, annullering, eventbetinget budadgang og den nye offentlige læsepolitik.
- `registration.test.mjs`: klientvalidering og lokal demo-adgang.

SQL-tests kører i midlertidige PGlite-databaser med simulerede Supabase Auth-tabeller, roller og claims. De ændrer ikke det eksterne Supabase-projekt.

Testsuiten er lagdelt: ikke alle filer installerer alle SQL-opdateringer sammen. At en test af grundopsætningen forventer lukket offentlig læsning, er derfor foreneligt med, at eventtesten forventer offentlige `live`-lots efter den senere migration.

Automatiserede lokale tests beviser ikke virkelig OAuth-konfiguration, maillevering, raceforløb på tværs af mange eksterne forbindelser, driftens faktiske RLS-schema eller et fremtidigt betalingsflow. De forhold kræver separate integrationstests.

## 15. Ikke færdigudviklede funktioner og åbne beslutninger

Dette afsnit beskriver planlagte eller manglende domænefunktioner; de er ikke implementeret alene ved at være nævnt her.

### 15.1 Quickpay/Clearhaus til eventtilmelding

Tilmelding forventes senere at kræve serververificeret betaling, før budadgang gives. Der findes endnu ingen checkout-oprettelse, betalingsordre, signeret callback, statusafstemning eller refundering i koden.

En sådan integration kræver en udvidet datamodel til betalingsreferencer og tilstande. Den nuværende database tillader kun fuld rabat og 0 kr. til betaling. `has_event_access()` og budfunktionen kræver specifikt rabatafregning og vil derfor også skulle ændres til den nye afregningsmodel.

Priser skal fortsat bestemmes på serveren, og betalingsstatus må ikke baseres på browserens returadresse. Det skal også afklares, hvornår en plads holdes, frigives eller mistes under et betalingsforløb.

### 15.2 Vinderbetaling og fakturering

Den ønskede model er faktura for vinderbuddet efter auktionen, særskilt fra eventtilmelding. Fakturaudstedelse, betalingsfrister, modtagelse af betaling, rykkere, kreditnotaer og afviste betalinger er ikke repræsenteret som et færdigt forløb.

Der mangler en beslutning om, hvordan manglende betaling håndteres: eksempelvis om næste budgiver tilbydes lot'et, og hvordan dette registreres. Den nuværende vinderfunktion vælger blot det højeste historiske bud og foretager ingen inkasso-/betalingsvurdering.

### 15.3 Én makker pr. deltager

Begrænsning på flere samtidige førerpositioner eller flere sejre, efterfølgende matching og hensyn til allerede registrerede par er ikke implementeret. Den regel skal afklares før automatisk endelig makkerfordeling kan beskrives som en del af systemet.

### 15.4 Identitetskontrol og falske bud

Der er konto-, mail-, tilmeldings- og profilkontrol, men ingen sikker garanti for at en budgiver er den selvoplyste person eller vil betale. En senere betalt eventtilmelding kan øge den økonomiske forpligtelse, men er ikke implementeret endnu. Eventuel telefonverificering, manuel identitetskontrol eller anden løsning er endnu ikke valgt som færdig del af stacken.

### 15.5 Auktionens driftsforløb

Der mangler blandt andet et defineret forløb for budannullering, fejlrettelser efter første bud, aflysning af en makker, nødlukning, permanent afslutning og godkendelse af endelige vindere. Ingen automatisk forlængelse, reservepris ud over startpris eller proxybud er implementeret.

En person med eksisterende bud kan annulleres som eventdeltager eller blokeres for nye bud uden at de gamle bud forsvinder. Dette kræver en særskilt forretningsmæssig håndtering; den sker ikke automatisk.

### 15.6 Kommunikation og administration

Separat tilmeldingskvittering, overbudsmails, vindermails, påmindelser og eventuelt udsendelseskø mangler. Billedupload til et medielager, Instagram-felt i databasen og selvbetjente ændringer af registrering er heller ikke implementeret.

Der er ikke et administrationsmodul til kapacitetsændring, genaktivering af annullerede registreringer eller visning af auditloggen. Om de 70 pladser inkluderer de kendte/professionelle makkere, er ifølge procesbeskrivelsen ikke endeligt afklaret.

### 15.7 Produktionsvilkår og datahåndtering

Endelige deltagelses-/auktionsvilkår, acceptversioner, privatlivsoplysninger og regler for afbud/manglende betaling er ikke erstattet af testversionerne endnu. Et egentligt register over accepteret endelig kontrakttekst eller et faktureringssnapshot ved budafgivelse findes ikke som særskilt model.

Repository beskriver ikke et færdigt backup-/restoreforløb, slette-/opbevaringsjob eller en samlet overvågnings- og alarmeringsopsætning. Eventuelle tjenesteindstillinger i Supabase/Vercel er eksterne forhold, som ikke kan udledes af kildekoden alene.

## 16. Hvor man finder den autoritative implementering

Ved uoverensstemmelser mellem beskrivelser er disse filer centrale:

- **Afhængigheder og kommandoer:** `package.json`, `package-lock.json`.
- **Ruter og build:** `scripts/build.mjs`, `scripts/serve.mjs`, `vercel.json`.
- **Offentlig forbindelseskonfiguration:** `api/auction-config.mjs`, `.env.example`.
- **Grundlæggende database og vinderberegning:** `database/auction-setup.sql`.
- **Aktuelle event- og budadgangsregler:** `database/event-registration.sql`, som erstatter dele af grundopsætningen.
- **Aktuel administratorregel:** `database/auction-google-domain-login.sql`.
- **Budafgivelse, polling og CSV-eksport i browseren:** `src/auction.js`.
- **OTP og tilmelding:** `src/event.js`.
- **Eventadministration:** `src/event-admin.js`.
- **Forsidens auktioner:** `src/front.js`.
- **Nedtælling:** `src/countdown.js` i den aktuelle arbejdskopi.
- **Forventet lokal adfærd:** `tests/`.
- **Supplerende procesbeskrivelse:** `docs/TILMELDING-OG-AUKTION.md`.

SQL-filerne beskriver den tilsigtede database efter anvendelse af opdateringerne; den faktisk anvendte eksterne database kan kun fastslås ved inspektion af netop den instans. Dette dokument er en teknisk beskrivelse af repository og funktionerne, ikke en påstand om at projektet er færdigt til en økonomisk bindende lancering.
