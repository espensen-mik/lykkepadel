// Auction terms, the bidding guide and FAQ shown on every lot page.
// Edit the texts here; they are used both on the page and in the bid confirmation.

export const TERMS_VERSION = 'auktion-test-v1';

const common = [
  'Et bud er bindende. Når du byder, accepterer du disse vilkår.',
  'Højeste bud, når auktionen slutter, vinder. Et afgivet bud kan ikke trækkes tilbage.',
  'Der betales ikke på siden. LykkeLiga kontakter vinderen senest dagen efter auktionens afslutning.',
  'Betaling sker mod faktura inden 7 dage.',
  'Hele beløbet går ubeskåret til LykkeLiga.',
  'Kan ikke ombyttes til kontanter.',
  'Betaler vinderen ikke, går auktionen til næsthøjeste bud.',
  'Dit synlige navn vises ved dine bud. Dine kontaktoplysninger vises aldrig offentligt.',
];

const byKind = {
  partner: [
    'Kun individuelle deltagere i Charity Turnering kan byde på padelmakkere.',
    'Makkerskabet gælder Charity Turnering 2. april 2027 i Pakhus77 og kan ikke overdrages.',
    'Bliver makkeren forhindret i at deltage, kontakter LykkeLiga dig.',
  ],
  item: ['Levering, afhentning og tidspunkt aftales direkte med LykkeLiga.'],
};

export function termsFor(kind) {
  return [...common.slice(0, 2), ...(byKind[kind] || byKind.item), ...common.slice(2)];
}

// The short version in the bid confirmation.
export const keyTerms = [
  'Buddet er bindende og kan ikke trækkes tilbage.',
  'Vinder du, sender LykkeLiga en faktura med betaling inden 7 dage.',
  'Hele beløbet går ubeskåret til LykkeLiga.',
];

export function stepsFor(kind) {
  return [
    ['Log ind', kind === 'partner' ? 'Log ind med den mail, du er tilmeldt Charity Turnering med. Du får en engangskode og skal ikke bruge en adgangskode.' : 'Log ind eller opret en gratis profil med din mail. Du får en engangskode og skal ikke bruge en adgangskode.'],
    ['Byd', 'Højeste bud, når auktionen slutter, vinder. Følg med i budhistorikken her på siden.'],
    ['LykkeLiga kontakter vinderen', 'Vi sender en faktura og aftaler det praktiske direkte med dig.'],
  ];
}

export function faqFor(kind) {
  return [
    ['Skal jeg betale, når jeg byder?', 'Nej. Der betales ikke på siden. Vinder du, sender LykkeLiga en faktura med betaling inden 7 dage.'],
    ['Er mit bud bindende?', 'Ja. Når du bekræfter et bud, accepterer du vilkårene, og buddet kan ikke trækkes tilbage.'],
    ['Hvem kan byde?', kind === 'partner' ? 'Kun individuelle deltagere i Charity Turnering kan byde på padelmakkere. Charity-produkterne kan alle med en gratis profil byde på.' : 'Alle med en gratis profil kan byde på charity-produkterne. Du opretter profilen med din mail på få minutter.'],
    ['Hvordan følger jeg med?', 'Siden opdateres automatisk, og budhistorikken viser alle bud. Vi sender endnu ikke besked, når du bliver overbudt, så kig forbi, inden auktionen slutter.'],
    ['Hvem kan se mit navn?', 'Alle kan se det synlige navn, du har valgt til dine bud. Dit rigtige navn, din mail og dit telefonnummer vises aldrig offentligt.'],
    ['Kan jeg byde på flere auktioner?', 'Ja, du kan byde på så mange auktioner, du vil.'],
  ];
}
