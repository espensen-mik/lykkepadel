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

## Byg til hosting

```sh
npm run build
npm run preview
```

`dist/` indeholder den færdige statiske hjemmeside og kan bruges på statisk hosting. Der er endnu ingen tilmelding eller formular.

GitHub-repo: https://github.com/espensen-mik/lykkepadel
