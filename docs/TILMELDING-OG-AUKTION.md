# Lykke Padel: deltagelse og makkerauktion

2. april 2027 · Pakhus 77, Aarhus · cirka 70 deltagende spillere.

## Deltagelse

Individuel deltagelse koster 10.000 kr. for én deltager. LykkeLiga sammensætter en makker, medmindre deltageren vinder en makker i auktionen. Deltagelsesbeløbet skal være betalt, før der kan bydes. Makkerauktionen er et tilkøb; vinderbuddet erstatter ikke deltagelsesprisen.

Deltagelse som par koster 25.000 kr. for to deltagere, der spiller sammen. Et par får ikke budadgang til makkerauktionen.

Begge kategorier inkluderer mad, forplejning, t-shirt, præmier, goodiebag og showkamp om aftenen. Tilmeldingen er arrangementets primære charitybidrag.

## Det planlagte forløb

1. Deltageren åbner Tilmeld dig fra auktionssiden og vælger individuel deltagelse eller et par. Den nuværende forside er fortsat en selvstændig landing page uden links til funktionerne.
2. Deltageren indtaster navn, mail og mobil. Ved par indtastes også makkers navn. Ved rigtig lancering tilføjes relevante vilkår, privatlivsinformation og nødvendige faktureringsoplysninger. T-shirtstørrelser og kostbehov kan indsamles senere.
3. Deltageren gennemser oplysninger og pris. En rigtig ordre oprettes på serveren med fast pris og antal pladser fra kategorien; klientens pris må aldrig være autoritativ.
4. Senere: Quickpay håndterer betalingen via Clearhaus. Serveren verificerer den signerede callback og beløb/valuta/ordre, håndterer gentagne callbacks sikkert og registrerer først betalt status efter dokumenteret betaling. En browserretur fra Quickpay er ikke betalingsbevis. Betalingsreservation og capture skal afstemmes med den konkrete aftale, før flowet lanceres.
5. Betalt individuel deltagelse knyttes til en bekræftet brugerkonto. Deltageren får en adgangsmail, fx gennem Resend, og kommer ind via et deltagerlink, uden en separat login-knap i sidens navigation. Admin har fortsat sit eget Google-login på /admin.
6. Budadgang kræver serverkontrol af bekræftet bruger, betalt individuel deltagelse og eventuel arrangørgodkendelse. Par og ubetalte/annullerede deltagelser afvises af databasen, også ved direkte API-kald.
7. Deltageren ser seneste bud, auktionens slutdato og beløbet, der mindst kan bydes. Bud hæves i trin på 500 kr. og bekræftes før afgivelse. Samtidige bud valideres atomisk i databasen mod serverens ur.
8. Ved udløb fastlægges vinderen. Vi skal håndhæve én makker pr. individuel deltager: før lancering skal vi beslutte, om flere samtidige førende bud forhindres, eller hvordan flere sejre løses. Det er endnu ikke implementeret.
9. Arrangøren fakturerer vinderbuddet særskilt. Deltagere uden auktionssejr får en makker sammensat af LykkeLiga. Automatisk fakturaudsendelse er ikke bygget.

## Testversionen nu

/tilmelding er en browserprototype med kategorivalg, kontaktoplysninger, gennemgang og kvittering. Den gemmer kun den seneste testtilmelding i sessionStorage i den aktuelle fane. Brug fiktive data. Ingen database, mails, betaling, bindende tilmelding eller pladsreservation. Genindlæsning i samme fane bevarer testtilmeldingen; andre enheder deler den ikke.

Individuel testtilmelding giver adgang til lokale testbud på /auktion?demo=1. Par kan se auktionerne, men kan ikke afgive testbud. Testens klientkontrol er kun en demonstration og kan ikke anvendes til at beskytte en rigtig auktion. Databaseforbundne bud fra den offentlige UI er sat på pause, indtil betalingskravet er implementeret. Eksisterende databasefunktioner har stadig den tidligere profilgodkendelse og skal udvides før offentlig åbning.

Admin er ikke linket fra auktionssiden, tilmeldingen eller forsiden. /admin er stadig beskyttet med Google-login og eksplicit administratoradgang. At skjule links erstatter ikke adgangskontrol.

## Næste tekniske trin

- Supabase-tabeller for tilmeldinger, deltagere, betalingsstatus og adgang til auktion. To pladser pr. par, én pr. individuel tilmelding. Adgangsregler og atomisk kapacitetskontrol for en endelig kapacitet skal være på serveren.
- Quickpay-serverintegration, verificeret callback, betalingsudløb, dubletbeskyttelse og håndtering af afvist/refunderet betaling.
- Resend til bekræftelse og deltageradgang. Ingen markedsføringsabonnement uden særskilt valg. Adgangsmails skal kunne gensendes uden at afsløre, hvem der er tilmeldt.
- Adminoversigt over tilmeldinger, kapacitet og betalingsstatus; kontrolleret manuel testgodkendelse adskilt fra rigtig betalt status.
- Opdatering af databasens budfunktion, så godkendt profil alene aldrig giver rigtig budadgang uden betalt individuel deltagelse.
- Endelige regler for makkeroplevelsen, én auktionssejr pr. deltager, udebleven betaling, afbud og fakturering. Fastlæg også, om de cirka 70 spillere inkluderer pro-/kendisspillerne, før pladskapaciteten sættes.
