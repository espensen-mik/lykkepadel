# Google-login til administrationen

Lykke Padel bruger almindeligt Google-login via Supabase. Det kræver ikke en Internal Google Workspace-app. Adgang afhænger af en verificeret Google-identitet, præcis maildomænet `lykkeliga.dk`, en OAuth-session og en eksplicit administratorrolle eller mail-allowlist. Det er ikke kontrol af Workspace-medlemskab.

## Database

`auction-setup.sql` og `auction-demo-seed.sql` er kørt manuelt. Den senere migration `google_domain_admin_login` er kørt via Supabase-pluginet fra filen `auction-google-domain-login.sql`. Den tillader administratoradgang for `mikael@lykkeliga.dk` efter første verificerede Google-login uden manuel brugeroprettelse. Andre adresser på domænet får ikke automatisk rollen.

De tidligere filer `auction-google-admin.sql` og `auction-admin.sql` er bevaret som historik, men skal ikke køres igen.

## Google og Supabase

Genbrug Google OAuth-klienten fra LykkeLiga Kontrolpanel. Bevar dens eksisterende redirect-adresser, og tilføj:

`https://iszexytxmdbcejjidfkm.supabase.co/auth/v1/callback`

I Lykke Padels Supabase-projekt aktiveres Google-provider med samme Client ID og Client Secret. Secret indtastes kun i Supabases indstillinger. Der er ikke brug for adgang til Gmail, Drive eller andre Google-tjenester; kun email/profil/OpenID. Nonce- og emailkontroller skal forblive aktiveret.

Authentication → URL Configuration:

- Site URL: `https://www.lykkepadel.dk`.
- Redirect URLs: `https://www.lykkepadel.dk/administration`, `http://127.0.0.1:5173/administration`, `https://www.lykkepadel.dk/auktion`, `http://127.0.0.1:5173/auktion`.

`hd=lykkeliga.dk` hjælper med kontovalg hos Google, men adgangskontrollen ligger i databasen. Google er projektets eneste sociale OAuth-provider i første version. Hvis andre OAuth-providers tilføjes senere, skal udbyderspecifik sessionskontrol udvides.

## Vercel

Production har `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` og `ADMIN_AUTH_ENABLED=true`. En ny deployment indlæser værdierne. `AUCTIONS_ENABLED` er fortsat fravalgt: `/auktion` viser browserdemo, mens `/administration` bruger rigtig Supabase og Google-login. Admin-endpointet returnerer kun den offentlige publishable key; alle rettigheder kontrolleres af RLS og databasefunktioner.

## Test

Åbn `/administration` uden `?demo=1`, og log ind med `mikael@lykkeliga.dk`. Du bør se de seks kladder fra databasen. En anden mailadresse, en passwordsession eller en ikke-tildelt kollega skal afvises. Kontoen behøver ingen adgangskode i Supabase.

`npm test` kontrollerer domæne, verificeret Google-identitet, OAuth-session, administratorrolle og afvisning af almindelige brugere i en isoleret database. Rigtig Google-login og Google Cloud-konfiguration skal også verificeres i browseren.

Kilder:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://developers.google.com/identity/openid-connect/openid-connect
