# Google Workspace-login til administrationen

Administratorer skal have:

- En Google Workspace-konto i LykkeLigas organisation med præcis domænet `lykkeliga.dk`.
- En session oprettet via Google OAuth, ikke via mail/adgangskode.
- En verificeret Google-identitet i Supabase Auth med samme mailadresse som brugeren.
- En eksplicit række i `auction_private.admins`.

## 1. Kør den ekstra SQL-opdatering

Kør `database/auction-google-admin.sql` i Supabase SQL Editor i projektet `iszexytxmdbcejjidfkm`. De to tidligere SQL-filer skal ikke køres igen.

Dette erstatter adgangskontrollen med Google- og domænekrav. Der oprettes ingen nye brugere.

## 2. Opret Google OAuth-klienten

Log ind på Google Cloud Console med jeres Workspace-konto. Vælg/opret et projekt under LykkeLigas Google-organisation. Under Google Auth Platform:

- Branding: brug fx `Lykke Padel` og jeres kontaktmail.
- Audience: vælg **Internal**. Dette er en nødvendig del af Workspace-afgrænsningen. Hvis Internal ikke findes, er projektet ikke placeret under jeres Workspace-organisation; få organisationens administrator til at hjælpe. Vælg ikke External som en genvej.
- Data Access: kun `openid`, `email` og `profile`. Ingen adgang til mail eller drev er nødvendig.
- Clients: opret en OAuth-klient af typen Web application.
- Authorized JavaScript origins: `http://127.0.0.1:5173` og `https://www.lykkepadel.dk`.
- Authorized redirect URI: `https://iszexytxmdbcejjidfkm.supabase.co/auth/v1/callback`.

Hvis andre udviklingsadresser bruges, tilføjes de præcist; brug ikke brede produktions-wildcards.

## 3. Aktiver Google i Supabase

I Supabase: Authentication → Sign In / Providers → Google. Indsæt Client ID og Client Secret fra Google, og aktivér Google. Behold kontrol af email og nonce aktiveret. Client Secret skal kun indtastes i Supabases dashboard, ikke i chat, browserkode eller Git.

Hold Google som projektets eneste sociale OAuth-provider i denne første version. Databasens AMR-kontrol genkender OAuth-sessioner; hvis flere OAuth-providers indføres senere, skal udbyderspecifik sessionskontrol udvides og testes.

Under Authentication → URL Configuration:

- Site URL: `https://www.lykkepadel.dk`.
- Redirect URLs: `http://127.0.0.1:5173/administration`, `http://127.0.0.1:5173/auktion`, `https://www.lykkepadel.dk/administration`, `https://www.lykkepadel.dk/auktion`.

Login sender `hd=lykkeliga.dk` til Google for korrekt kontovalg, men dette er kun et hint. Workspace-begrænsningen håndhæves af Internal-konfigurationen, og databasen kræver desuden verificeret Google-identitet, præcist domæne, OAuth-session og administratorrollen. Den bruger ikke user_metadata til rettigheder.

## 4. Første login og administratorrolle

Åbn `http://127.0.0.1:5173/administration`, og vælg **Log ind med Google**. Brug `mikael@lykkeliga.dk`. Første login opretter brugeren uden administratorrettigheder.

Kør derefter `database/auction-admin.sql` i SQL Editor. Den tildeler kun rollen til den bekræftede Google-bruger med denne mail. Kontrollér, at resultatet viser `mikael@lykkeliga.dk` og `Administrator`. Genindlæs administrationssiden.

Kontoen behøver ikke oprette en adgangskode. Andre Workspace-konti får ikke automatisk administratorrollen.

## 5. Test før åbning

Kontrollér rigtig Google-login med en tildelt admin, afvisning af andre konti og afvisning af adgang via passwordsession. Den lokale databasetest simulerer identiteter og JWT'er; den kan ikke erstatte testen af den faktiske Google-/Supabase-konfiguration.

Kilder:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://support.google.com/cloud/answer/15549945
- https://developers.google.com/identity/openid-connect/openid-connect
