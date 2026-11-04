# Lykke Padel: tilmelding og deltageradgang

2. april 2027 · Pakhus 77, Aarhus. Forsiden er fortsat en selvstændig landing page uden tilmeldings- eller adminlinks.

## Flowet nu

1. `/tilmelding`: vælg individuel deltagelse (10.000 kr., én plads) eller par (25.000 kr., to pladser). Begge inkluderer mad, forplejning, t-shirt, præmier, goodiebag og showkamp.
2. Indtast navn, mail, mobil og faktureringsadresse. Par angiver også makkers navn. Der er én tilmelding pr. mailkonto.
3. Rabatkoden `Rabat` giver 100 % rabat på begge kategorier. Supabase beregner pris, rabat og antal pladser; browseren kan ikke bestemme beløbet. Koden er ikke følsom og er beregnet til test. Uden gyldig kode kan flowet ikke afsluttes, da betaling endnu ikke er integreret.
4. Gennemse oplysningerne og bekræft testtilmeldingen. Ikke-indloggede brugere får en personlig engangskode på mail fra `Lykke Padel <padel@forms.lykkeliga.dk>` via Supabase Auth og Resend SMTP. Koden indtastes på siden; ingen adgangskode skal vælges.
5. Efter mailbekræftelse gemmes tilmeldingen i Supabase. Gentagen indsendelse af samme tilmelding giver samme reference og tæller ikke som en ny plads.
6. Individuel deltagelse med bekræftet 0-kr.-tilmelding giver automatisk testbudadgang. Par har allerede en makker og får ikke budadgang. Databasen kontrollerer det ved hvert bud sammen med bekræftet mail og profilens godkendelsesstatus.
7. `/deltager` viser tilmeldingen. På samme enhed huskes login; på en ny enhed bruges en ny engangskode. Adgang til deltagersiden findes fra tilmeldingssiden og når man forsøger at byde. Ingen login- eller admin-knap i auktionssidens navigation.
8. `/admin` har en fane Tilmeldinger med kontaktoplysninger, rabat, status og pladsantal. Admin kan deaktivere `Rabat` for nye tilmeldinger og annullere en tilmelding. Annullering frigiver pladser og fjerner budadgang; eksisterende bud bevares. Adminadgang kræver fortsat Google og eksplicit LykkeLiga-administratoradgang.

## Hvad testen betyder

Der trækkes ingen penge, og testbud faktureres ikke. Tilmeldingerne og testbuddene gemmes reelt i Supabase og kan ses på tværs af enheder. En rabattilmelding registreres som `settlement=discount`, ikke som en kortbetaling. Der sendes login-/bekræftelsesmails, men endnu ingen separat tilmeldingskvittering.

Kapaciteten er foreløbigt 70 pladser. Par bruger to pladser. Serveren tildeler pladser under en databaselås, så samtidige tilmeldinger ikke overbooker. Det skal afklares, om de 70 inkluderer de kendte/professionelle makkere, før den endelige kapacitet fastsættes. Rabat kan slås fra i admin uden at annullere allerede bekræftede tilmeldinger.

`/auktion` bruger nu Supabase, når `REGISTRATION_ENABLED=true`. Kun publicerede auktioner vises. Kladdespillere skal publiceres i admin, før deltagere kan se dem. `/auktion?demo=1` og `/admin?demo=1` er fortsat særskilte browserdemoer og deler ikke data med Supabase.

## Database og sikkerhed

Migration: `database/event-registration.sql`, anvendt som `event_registration_discount_access` i projektet `iszexytxmdbcejjidfkm`.

- `public.event_registrations`: RLS og SELECT alene til ejer eller admin. Ingen direkte klient-INSERT/UPDATE/DELETE.
- `auction_private.event_settings`: kapacitet, åben/lukket og kuponstatus; ingen direkte klientadgang.
- `event_registration_quote`: kun en prisberegning, ingen personoplysninger.
- `complete_event_registration`: kræver bekræftet, ikke-anonym konto; mail hentes fra auth.users. Pris og rabat valideres igen ved afslutning. Der tildeles aldrig pladser på baggrund af en browserkvittering.
- `place_auction_bid`: kræver godkendt profil samt bekræftet individuel tilmelding, 0 kr. til betaling og rabatafregning. Par og gamle godkendte profiler uden eventtilmelding kan ikke omgå kravet via API.
- Auktionslæsning tillader offentlige `live`-auktioner uden kontaktdata; kladder er kun for admin. Budgiveres kontaktdata og budhistorik er ikke offentlige.
- Annullering og kuponændringer skrives i auditloggen. Ingen service-role-/Resend-nøgle sendes til browseren.

Supabase Auth-mails har kodebaserede skabeloner for både Confirm sign up og Magic link or OTP. Resend-nøglen ligger krypteret i Supabase SMTP og er begrænset til afsendelse fra `forms.lykkeliga.dk`; den ligger ikke i repository eller Vercel-klientkonfigurationen.

## Senere: betaling og rigtig auktion

Quickpay/Clearhaus erstatter rabatafregningen med serververificeret betaling: fast serverpris, signeret callback, beløb/valuta-/ordrevalidering og dubletbeskyttelse. En browserretur er aldrig betalingsbevis. Betalingsstatus og refundering skal kunne tilbagekalde budadgang.

Før en rigtig auktion åbnes mangler endelige deltagelses-/auktionsvilkår, privatlivstekst, separat kvittering, regler om afbud og manglende betaling, og beslutning om hvordan vi sikrer højst én vunden makker pr. deltager. Vinderbud kommer oveni deltagelsesprisen og skal senere faktureres særskilt. Deltagere uden auktionssejr får en makker sammensat af LykkeLiga. Automatisk fakturaudsendelse er ikke implementeret.
