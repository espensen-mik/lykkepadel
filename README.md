# Lykke Padel

Faviconet er tilpasset fra Tabler Icons' `ping-pong`-ikon med padelhuller og brandfarver. Kilde: https://github.com/tabler/tabler-icons. MIT-licensen findes i `public/licenses/tabler-icons-MIT.txt`.

En enkel, responsiv forside i HTML og CSS. Kræver Node.js 20 eller nyere. Ingen pakker skal installeres.

## Start lokalt

```sh
npm run dev
```

Åbn http://127.0.0.1:5173.

## Logoer og billeder

Læg logoer i `public/logos/` og billeder i `public/images/`. Filer fra public bruges direkte fra roden: `public/logos/logo.svg` bliver til `/logos/logo.svg` i HTML.

Forsiden bruger SVG-logoer i `public/images/lykke-padel.svg` og `public/images/lykkeliga.svg`, afledt af originalerne i `public/logos/` med beskåret viewBox. Originalerne er bevaret. Bebas Neue leveres lokalt fra `public/fonts/`, hvor fontlicensen også ligger. Tekst ændres i `index.html`, og farver og layout i `style.css`.

## Supabase

Kopiér `.env.example` til `.env.local`, og angiv projektets URL og publishable key. `.env.local` ignoreres af Git og kopieres ikke til den offentlige hjemmeside. Kontrollér forbindelsen med `npm run check:supabase` (Node.js 20.12 eller nyere).

Ved senere integration på Vercel oprettes de samme miljøvariabler: `SUPABASE_URL` og `SUPABASE_PUBLISHABLE_KEY`. Brug ikke secret/service-role-nøgler i offentlig kode. Forbindelsestjekket læser kun Auth-indstillinger; det tester ikke tabeladgang. Forsiden bruger endnu ikke Supabase, og auktionstabeller og adgangspolitikker oprettes separat.

## Byg til hosting

```sh
npm run build
npm run preview
```

`dist/` indeholder den færdige statiske hjemmeside og kan bruges på statisk hosting. Der er endnu ingen tilmelding eller formular.

GitHub-repo: https://github.com/espensen-mik/lykkepadel

## Makkerauktion (under udvikling)

Installér projektets pakker med `npm ci` (Node.js 22 eller nyere). `npm run dev` bygger siderne og starter serveren. Efter ændring af kildefiler bygges igen med `npm run build`, og browseren genindlæses.

- `/` er uændret og har ingen links til auktionen.
- `/auktion` er Supabase-tilsluttet testversion med login, profil og manuel godkendelse af budgivere.
- `/admin` bruger Google-login med præcis @lykkeliga.dk-domænekontrol og en eksplicit administratorrolle/allowlist.
- `/auktion?demo=1` og `/admin?demo=1` er design-/funktionstest, der også kan bruges på live-sitet. De bruger fiktive profiler, stockportrætter og sessionStorage, aldrig rigtige bud eller databaseændringer. Luk browserens session eller brug Nulstil testdata for at nulstille.

Den lokale `.env.local` har `AUCTIONS_ENABLED=true` til test. På Vercel viser `/auktion` automatisk den tydeligt markerede browserdemo, når Supabase-forbindelsen er deaktiveret (konfigurations-API svarer 404). `/admin` giver ikke administratoradgang via denne fallback. Demo-administration findes kun med `?demo=1` og arbejder udelukkende med browserens testdata. Ved senere Supabase-test angives `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` og `AUCTIONS_ENABLED=true` i miljøvariabler og der laves ny deployment. API-nøglen i konfigurationen er kun publishable. Databasens RLS og administratorfunktioner er de egentlige adgangsregler, også hvis nogen kender API-adressen.

Google-opsætning og første administrator: se `database/GOOGLE-ADMIN.md`. Den seneste SQL-opdatering er `auction-google-domain-login.sql`; den giver den verificerede Google-konto mikael@lykkeliga.dk administratoradgang efter første login. De tidligere Google-admin-filer er historik og skal ikke genkøres. `ADMIN_AUTH_ENABLED=true` aktiverer den rigtige adminforbindelse uden at skifte den offentlige auktion væk fra browserdemo. De fiktive eksempelauktioner ligger som kladder, indtil admin publicerer dem; auktioner med bud låses for redigering. Billeder indsættes som HTTPS-URL'er; upload kan tilføjes senere.

Budmotoren bruger databaselås, servertid og idempotente forespørgsler. Bud i danske kroner skal være i trin på 500 kr., og mindst 500 kr. over det aktuelle bud. Første bud skal være mindst startprisen. Visningen opdaterer bud automatisk hvert 10. sekund; serveren kontrollerer altid det aktuelle beløb ved afgivelse. Der er ingen automatisk forlængelse ved sene bud i denne version.

Afsluttede auktioners højeste bud kan eksporteres som fakturagrundlag i admin. Der sendes ingen faktura automatisk, og ingen penge trækkes. Resend, SMS, MitID og endelige auktionsvilkår er endnu ikke tilkoblet. Supabase Auth står for konto-/bekræftelsesmails; produktionsudsendelse kræver SMTP-opsætning (fx Resend). `preview-v1` er kun testvilkår og må ikke bruges til rigtige betalingsforpligtelser.

Kør `npm test` for lokale database- og konfigurationskontroller. Rigtig OAuth, maillevering og bud fra flere samtidige Supabase-sessioner skal end-to-end-testes før offentlig åbning. De manuelle SQL-filer er ikke registreret i Supabase CLI-migrationshistorikken.

Den tidligere adresse `/administration` fører til `/admin`. Google-login bruger fortsat den allerede registrerede OAuth-returadresse `/administration`, som fører videre til `/admin`.
