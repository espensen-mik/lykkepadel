import { createClient } from '@supabase/supabase-js';
import { countdownShort, countdownBar, isOver } from './countdown.js';
import { initialLots, demoHistory } from './demo.js';
import { termsFor, keyTerms, stepsFor, faqFor } from './terms.js';
import { mountEvent } from './event.js';
import { eventAdminView } from './event-admin.js';
import { $, esc, money, date, toast, modal, closeModal, setupModal, useForm, field, errorHtml, errorMessage, setTestbar, setHeader, downloadCsv } from './ui.js';

// One page shell serves /auktion, /tilmelding, /deltager and /admin. The address decides what to show.
const path = location.pathname;
const adminPage = /^\/(admin|administration)\/?$/.test(path);
const registrationPage = /^\/tilmelding\/?$/.test(path);
const participantPage = /^\/deltager\/?$/.test(path);
// Keep the registered OAuth return address working, but show the short one.
if (path.startsWith('/administration')) history.replaceState(null, '', '/admin' + location.search + location.hash);

const main = $('#main');
const DEMO_KEY = 'lykke-auction-demo-v4';
const STEP = 500;
const MAX_BID = 10000000;

let demo = new URLSearchParams(location.search).get('demo') === '1';
let client;
let user = null;
let profile = null;
let eventAccess = false;
let isAdmin = false;
let lots = [];
const typeParam = new URLSearchParams(location.search).get('type');
let filter = typeParam === 'makkere' ? 'partner' : typeParam === 'produkter' ? 'item' : 'Alle';
let adminTab = 'lots';
let polling = false;

setupModal();

// ---------- Data ----------

function readDemo() {
  try {
    return JSON.parse(sessionStorage.getItem(DEMO_KEY)) || initialLots();
  } catch {
    return initialLots();
  }
}
function saveDemo() {
  sessionStorage.setItem(DEMO_KEY, JSON.stringify(lots));
}

async function loadIdentity() {
  if (demo) {
    isAdmin = adminPage;
    return;
  }
  const { data, error } = await client.auth.getUser();
  user = error ? null : data.user;
  profile = null;
  eventAccess = false;
  isAdmin = false;
  if (!user) return;
  const [profiles, admin, access] = await Promise.all([
    client.from('auction_profiles').select('*').eq('user_id', user.id),
    client.rpc('auction_is_admin'),
    client.rpc('event_bid_access'),
  ]);
  for (const result of [profiles, admin, access]) if (result.error) throw result.error;
  profile = profiles.data[0] || null;
  isAdmin = admin.data === true;
  eventAccess = access.data === true;
}

async function fetchLots() {
  if (demo) return;
  const { data, error } = await client.from('auction_lots').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  lots = data || [];
}

const liveLots = () => lots.filter((lot) => lot.status === 'live');
const closed = (lot) => isOver(lot.ends_at);
const minimum = (lot) => (lot.bid_count ? lot.current_bid + STEP : lot.starting_price);
const firstName = (lot) => lot.name.split(' ')[0];
// Charity products need an active profile; padel partners also need an individual tournament registration.
const canBid = (lot) => demo || (profile?.approved === true && (lot.kind === 'item' || eventAccess));

function safeImage(value) {
  try {
    const url = new URL(value, location.origin);
    if (url.origin === location.origin && /^\/(images|auktioner)\//.test(url.pathname)) return url.href;
    return url.protocol === 'https:' ? url.href : '/images/lykke-padel.svg';
  } catch {
    return '/images/lykke-padel.svg';
  }
}

function link(id) {
  return `/auktion${demo ? '?demo=1' : ''}${id ? '#spiller/' + encodeURIComponent(id) : ''}`;
}

function instagram(lot) {
  if (!/^[a-zA-Z0-9_.]{1,30}$/.test(lot.instagram || '')) return '';
  return `<a href="https://www.instagram.com/${esc(lot.instagram)}/" target="_blank" rel="noopener noreferrer">@${esc(lot.instagram)} på Instagram</a>`;
}

// ---------- Header ----------

function updateHeader() {
  if (adminPage) {
    setHeader({ loggedIn: Boolean(user), text: user ? 'Log ud' : 'Log ind', href: '/admin', onClick: user ? logout : showAdminLogin, logout: false });
    return;
  }
  setHeader({ loggedIn: Boolean(user) });
}

async function logout() {
  await client.auth.signOut();
  user = profile = null;
  isAdmin = eventAccess = false;
  closeModal();
  await refresh();
}

// ---------- Auction overview ----------

const KINDS = { partner: 'Padelmakkere', item: 'Charity-produkter' };
const kindOf = (lot) => (lot.kind === 'item' ? 'item' : 'partner');

function lotCard(lot, index) {
  const over = closed(lot);
  const item = kindOf(lot) === 'item';
  return `<article class="lp-lot">
    <a class="lp-lot__link" href="${link(lot.id)}">
      <div class="lp-lot__media">
        <img src="${esc(safeImage(lot.image_url))}" alt="${esc(lot.name)}" loading="${index < 3 ? 'eager' : 'lazy'}">
        <p class="lp-lot__tag">${esc(lot.category)}</p>
      </div>
      <div class="lp-lot__body">
        <h3 class="lp-lot__name">${esc(lot.name)}</h3>
        ${item && lot.value_text ? `<p class="lp-lot__value">Værdi: ${esc(lot.value_text)}</p>` : ''}
        <div class="lp-lot__bid">
          <div>
            <p class="lp-lot__meta">${lot.bid_count ? `Højeste bud · ${lot.bid_count} bud` : 'Startpris'}</p>
            <p class="lp-lot__amount">${money(lot.current_bid || lot.starting_price)}</p>
          </div>
          <p class="lp-lot__ends">${over ? 'Auktionen<br>er slut' : `Slutter om<br><span data-countdown="short" data-ends="${esc(lot.ends_at)}">${countdownShort(lot.ends_at)}</span>`}</p>
        </div>
        <span class="lp-btn lp-btn--primary lp-btn--block">${over ? 'Se resultat' : item ? 'Se og byd' : `Byd på ${esc(firstName(lot))}`}</span>
      </div>
    </a>
  </article>`;
}

const soonCard = `<article class="lp-lot lp-lot--soon">
  <p class="lp-lot__mark" aria-hidden="true">?</p>
  <h3 class="lp-lot__name">Flere auktioner</h3>
  <p class="lp-lot__meta">Afsløres snart</p>
</article>`;

function countdownSection(visible) {
  const upcoming = visible.filter((lot) => !closed(lot)).sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at))[0];
  const label = !visible.length ? 'Auktionerne afsløres snart' : upcoming ? (visible.length > 1 ? 'Næste auktion slutter om' : 'Auktionen slutter om') : 'Auktionen er afsluttet';
  return `<section class="lp-countdown" aria-label="Nedtælling">
    <div class="lp-wrap lp-countdown__inner">
      <p class="lp-countdown__label">${label}</p>
      ${upcoming ? `<div class="lp-countdown__time" data-countdown="bar" data-ends="${esc(upcoming.ends_at)}" role="timer">${countdownBar(upcoming.ends_at)}</div>` : ''}
      <p class="lp-countdown__meta">2. april 2027 · Pakhus77, Aarhus</p>
    </div>
  </section>`;
}

function listing() {
  document.title = 'Lykke Auktion – Lykke Padel';
  const visible = liveLots().sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at));
  const kinds = Object.keys(KINDS).filter((k) => visible.some((lot) => kindOf(lot) === k));
  if (filter !== 'Alle' && !kinds.includes(filter)) filter = 'Alle';
  const shown = filter === 'Alle' ? visible : visible.filter((lot) => kindOf(lot) === filter);
  const totalBids = visible.reduce((sum, lot) => sum + lot.bid_count, 0);
  const totalAmount = visible.reduce((sum, lot) => sum + (lot.bid_count ? lot.current_bid : 0), 0);

  main.innerHTML = `
  <section class="lp-band-brown">
    <div class="lp-wrap lp-hero">
      <div class="lp-heading">
        <p class="lp-eyebrow">${visible.length ? 'Auktionen er åben' : 'Charity-auktion'}</p>
        <h1 class="lp-display lp-display--hero">Lykke Auktion</h1>
        <p class="lp-lead">Byd på unikke oplevelser, særlige ting og en plads ved siden af Danmarks padelprofiler. Hele beløbet går ubeskåret til LykkeLiga.</p>
        <div class="lp-actions">
          <a class="lp-btn lp-btn--on-dark lp-btn--large" href="#auktioner">Se auktionerne</a>
          <a class="lp-btn lp-btn--outline-dark lp-btn--large" href="#saadan">Sådan byder du</a>
        </div>
      </div>
      <dl class="lp-stats">
        <div><dt>Samlede bud</dt><dd>${money(totalAmount)}</dd></div>
        <div><dt>Antal bud</dt><dd>${totalBids}</dd></div>
        <div><dt>Auktioner</dt><dd>${visible.length}</dd></div>
      </dl>
    </div>
  </section>
  ${countdownSection(visible)}
  <section class="lp-band-cream" id="auktioner">
    <div class="lp-wrap lp-section">
      <div class="lp-section-head">
        <h2 class="lp-display">Auktionerne</h2>
        ${kinds.length > 1 ? `<div class="lp-chips" role="group" aria-label="Filtrer auktioner">${['Alle', ...kinds].map((k) => `<button class="lp-chip" type="button" data-filter="${k}" aria-pressed="${k === filter}">${k === 'Alle' ? 'Alle' : KINDS[k]}</button>`).join('')}</div>` : ''}
      </div>
      <p class="lp-text" style="margin-top: 20px; max-width: 680px">Alle med en gratis profil kan byde på charity-produkterne. Padelmakkere kan kun bydes på af individuelle deltagere i Charity Turnering. Du byder i hele 500 kr., og højeste bud, når tiden udløber, vinder.</p>
      ${visible.length
        ? `<div class="lp-lots" style="margin-top: 48px">${shown.map(lotCard).join('')}${visible.length < 6 && filter === 'Alle' ? soonCard : ''}</div>`
        : `<div class="lp-empty" style="margin-top: 48px"><p class="lp-text">Auktionerne bliver offentliggjort her, når LykkeLiga åbner dem.</p><a class="lp-btn lp-btn--primary" href="${profileLink()}">Opret gratis profil</a></div>`}
    </div>
  </section>
  <section class="lp-band-cream lp-section--rule" id="saadan">
    <div class="lp-wrap lp-section">
      <h2 class="lp-display" style="font-size: clamp(52px, 6vw, 88px); margin-bottom: 40px">Sådan byder du</h2>
      <ol class="lp-steps">
        <li class="lp-step"><p class="lp-step__num" aria-hidden="true">1</p><div><h3 class="lp-step__title">Opret en gratis profil</h3><p class="lp-step__text">Log ind med din mail, og vælg det navn, dine bud skal vises med. <a href="${profileLink()}">Opret profil</a></p></div></li>
        <li class="lp-step"><p class="lp-step__num" aria-hidden="true">2</p><div><h3 class="lp-step__title">Byd på charity-produkter</h3><p class="lp-step__text">Følg med i budhistorikken, og byd, så længe nedtællingen kører.</p></div></li>
        <li class="lp-step"><p class="lp-step__num" aria-hidden="true">3</p><div><h3 class="lp-step__title">Vil du have en padelmakker?</h3><p class="lp-step__text">Tilmeld dig Charity Turnering individuelt, så kan du også byde på padelmakkerne. <a href="/charity-turnering">Om turneringen</a></p></div></li>
      </ol>
    </div>
  </section>
  <section class="lp-band-brown">
    <div class="lp-wrap lp-section" style="display: flex; flex-direction: column; gap: 48px">
      <div class="lp-section-head">
        <div class="lp-heading">
          <p class="lp-eyebrow">2. april 2027 · Pakhus77, Aarhus</p>
          <h2 class="lp-display lp-display--band">Én dag, to dele</h2>
        </div>
        <p class="lp-lead" style="max-width: 460px">Charity Turnering for deltagerne om eftermiddagen og Charity Showkamp for op til 500 tilskuere fra kl. 16.00.</p>
      </div>
      <figure class="lp-photo"><img src="/images/pakhus77.jpeg" alt="Padelbaner i Pakhus77" width="1015" height="425" loading="lazy"><figcaption>Pakhus77, Aarhus</figcaption></figure>
      <div class="lp-actions"><a class="lp-btn lp-btn--on-dark" href="/charity-turnering">Charity Turnering</a><a class="lp-btn lp-btn--outline-dark" href="/charity-showkamp">Charity Showkamp</a></div>
    </div>
  </section>
  <section class="lp-band-red">
    <div class="lp-wrap" style="padding-block: var(--space-band); display: flex; flex-wrap: wrap; gap: 40px; align-items: center">
      <div style="flex: 999 1 420px; min-width: 0">
        <h2 class="lp-display lp-display--band">Spil med i Charity Turnering</h2>
        <p class="lp-big-note">Individuel deltagelse giver adgang til at byde på padelmakkerne.</p>
      </div>
      <div class="lp-prices" style="flex: 1 1 520px">
        <div class="lp-price"><p class="lp-price__meta">1 spiller · kan byde på makkere</p><p class="lp-price__name">Individuel</p><p class="lp-price__amount">10.000 kr.</p><a class="lp-btn lp-btn--primary lp-btn--block" href="/tilmelding?type=individual">Vælg individuel</a></div>
        <div class="lp-price"><p class="lp-price__meta">2 spillere · fast makkerpar</p><p class="lp-price__name">Makkerpar</p><p class="lp-price__amount">25.000 kr.</p><a class="lp-btn lp-btn--secondary lp-btn--block" href="/tilmelding?type=pair">Vælg makkerpar</a></div>
      </div>
    </div>
  </section>`;

  main.querySelectorAll('[data-filter]').forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.filter;
      listing();
      $('#auktioner').scrollIntoView();
    };
  });
}

// ---------- Player page ----------

// Min side, sending the user back to this lot afterwards.
const profileLink = () => `/deltager?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;

function bidAccessNotice(lot) {
  const partner = kindOf(lot) === 'partner';
  if (!user && partner)
    return `<div class="lp-notice" style="flex-direction: column"><span>Padelmakkere kan kun bydes på af individuelle deltagere i Charity Turnering. Er du tilmeldt, så log ind med din mail.</span><span class="lp-actions"><a class="lp-btn lp-btn--primary lp-btn--small" href="${profileLink()}">Log ind</a><a class="lp-btn lp-btn--secondary lp-btn--small" href="/tilmelding">Tilmeld dig</a></span></div>`;
  if (!user)
    return `<div class="lp-notice" style="flex-direction: column"><span>Log ind med din mail, eller opret en gratis profil, for at byde. Det tager et minut.</span><span class="lp-actions"><a class="lp-btn lp-btn--primary lp-btn--small" href="${profileLink()}">Log ind eller opret profil</a></span></div>`;
  if (!profile)
    return `<div class="lp-notice">Opret din gratis budprofil for at byde. <a href="${profileLink()}">Opret profil</a></div>`;
  if (profile.approved !== true) return `<div class="lp-notice">Din budadgang er sat på pause. Kontakt LykkeLiga på signe@lykkeliga.dk.</div>`;
  return `<div class="lp-notice">Padelmakkere kan kun bydes på af individuelle deltagere i Charity Turnering. Makkerpar kan byde på charity-produkterne. <a href="/tilmelding">Se tilmelding</a></div>`;
}

function bidForm(lot) {
  const min = minimum(lot);
  const quick = [min, min + STEP, min + 2 * STEP].filter((amount) => amount <= MAX_BID);
  return `<form id="bid-form" class="lp-form" novalidate>
    <div class="lp-field">
      <label for="amount">Dit bud i kr.</label>
      <div class="lp-stepper">
        <button class="lp-stepper__btn" type="button" id="amount-down" aria-label="Sænk buddet med 500 kr."><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>
        <input id="amount" name="amount" class="lp-input lp-input--big" type="number" inputmode="numeric" min="${min}" max="${MAX_BID}" step="${STEP}" value="${min}" required>
        <button class="lp-stepper__btn" type="button" id="amount-up" aria-label="Hæv buddet med 500 kr."><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4v12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>
      </div>
      <p class="lp-help">Mindst ${money(min)} Bud i hele 500 kr.</p>
    </div>
    <div class="lp-chips" role="group" aria-label="Hurtige bud">
      ${quick.map((amount, i) => `<button class="lp-chip" type="button" data-amount="${amount}" aria-pressed="${i === 0}">${money(amount)}</button>`).join('')}
    </div>
    <button class="lp-btn lp-btn--primary lp-btn--large lp-btn--block" type="submit" id="bid-submit">Byd ${money(min)}</button>
    <p class="lp-help">Du ser og bekræfter buddet i næste trin, før det bliver sendt.</p>
  </form>`;
}

function detail(id) {
  const lot = lots.find((l) => l.id === id && (l.status === 'live' || isAdmin));
  if (!lot) {
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">Ingen auktion her</h1><p class="lp-text">Auktionen findes ikke eller er ikke offentliggjort endnu.</p><a class="lp-btn lp-btn--primary" href="${link()}">Se hele auktionen</a></div></div>`;
    return;
  }
  document.title = `${lot.name} – Lykke Auktion – Lykke Padel`;
  const over = closed(lot);
  const item = kindOf(lot) === 'item';
  const others = liveLots().filter((l) => l.id !== lot.id).slice(0, 3);
  const meta = [esc(lot.category), item && lot.value_text ? `Værdi: ${esc(lot.value_text)}` : '', instagram(lot)].filter(Boolean).join(' · ');

  main.innerHTML = `
  <div class="lp-wrap" style="padding-block: 28px var(--space-9)">
    <a class="lp-back" href="${link()}">← Hele auktionen</a>
    <div class="lp-split" style="margin-top: 20px">
      <div class="lp-lot__media lp-detail-media">
        <img src="${esc(safeImage(lot.image_url))}" alt="${esc(lot.name)}">
        <p class="lp-lot__tag">${esc(lot.category)}</p>
      </div>
      <div class="lp-detail-body">
        <div style="display: flex; flex-direction: column; gap: 12px">
          <p class="lp-eyebrow" style="color: var(--red-text)">${item ? 'Charity-produkt' : 'Padelmakker · kun for deltagere i Charity Turnering'}</p>
          <h1 class="lp-detail-name">${esc(lot.name)}</h1>
          <p class="lp-lot__insta">${meta}</p>
        </div>
        <p class="lp-text" style="white-space: pre-line">${esc(lot.description)}</p>
        <section class="lp-panel" aria-label="Bud på ${esc(lot.name)}">
          <dl class="lp-bid-stats">
            <div><dt>${lot.bid_count ? 'Højeste bud' : 'Startpris'}</dt><dd class="is-amount">${money(lot.current_bid || lot.starting_price)}</dd></div>
            <div><dt>Antal bud</dt><dd>${lot.bid_count}</dd></div>
            <div><dt>${over ? 'Status' : 'Slutter om'}</dt><dd>${over ? 'Slut' : `<span data-countdown="short" data-ends="${esc(lot.ends_at)}">${countdownShort(lot.ends_at)}</span>`}</dd></div>
          </dl>
          <p class="lp-help">${over ? `Auktionen sluttede ${date(lot.ends_at)}. Der kan ikke afgives flere bud.` : `Slutter ${date(lot.ends_at)} (dansk tid). Højeste bud, når tiden udløber, vinder.`}</p>
          ${over ? '' : canBid(lot) ? bidForm(lot) : bidAccessNotice(lot)}
        </section>
        <section class="lp-history" id="bid-history" aria-label="Budhistorik" hidden></section>
        ${demo ? '<div class="lp-notice">Demo: buddene er eksempler og gemmes kun i din browser.</div>' : '<p class="lp-help">Testversion. Der udsendes ingen betaling eller faktura fra testen.</p>'}
      </div>
    </div>
  </div>
  ${lotInfo(lot)}
  ${others.length ? `<section class="lp-band-cream lp-section--rule"><div class="lp-wrap lp-section"><h2 class="lp-display lp-display--s">Andre auktioner</h2><div class="lp-lots lp-lots--carousel" style="margin-top: 40px">${others.map(lotCard).join('')}</div></div></section>` : ''}`;

  if (!over && canBid(lot)) wireBidForm(lot);
  renderHistory(lot);
}

// Guide, terms and FAQ, as on a classic charity auction page.
function lotInfo(lot) {
  const kind = kindOf(lot);
  const gets = kind === 'partner'
    ? [`En plads som makker med ${esc(lot.name)} i Charity Turnering`, '2. april 2027 kl. 12.30–17.00 i Pakhus77, Aarhus']
    : lot.value_text ? [`${esc(lot.name)}`, `Værdi: ${esc(lot.value_text)}`] : [];
  return `<section class="lp-band-cream lp-section--rule" id="vilkaar">
    <div class="lp-wrap lp-section lp-info">
      <div class="lp-info__col">
        ${gets.length ? `<div class="lp-info__block"><h2 class="lp-info__title">Det får du</h2><ul class="lp-terms">${gets.map((g) => `<li>${g}</li>`).join('')}</ul></div>` : ''}
        <div class="lp-info__block">
          <h2 class="lp-info__title">Sådan foregår det</h2>
          <ol class="lp-howto">${stepsFor(kind).map(([title, text], i) => `<li><span class="lp-howto__num" aria-hidden="true">${i + 1}</span><div><h3 class="lp-step__title">${title}</h3><p class="lp-step__text">${text}</p></div></li>`).join('')}</ol>
        </div>
        <div class="lp-panel lp-info__cause">
          <p class="lp-lot__meta">Til fordel for</p>
          <p style="margin: 0; font: 400 36px/1 var(--font-display)">LykkeLiga</p>
          <p class="lp-text">Et nationalt fællesskab for børn og unge med funktionsnedsættelser. Hele beløbet går ubeskåret til LykkeLigas arbejde.</p>
          <a href="/om-lykkeliga">Om LykkeLiga</a>
        </div>
      </div>
      <div class="lp-info__col">
        <div class="lp-info__block">
          <h2 class="lp-info__title">Vilkår</h2>
          <ul class="lp-terms">${termsFor(kind).map((t) => `<li>${t}</li>`).join('')}</ul>
          <p class="lp-help">Testversion af vilkårene.</p>
        </div>
        <div class="lp-info__block">
          <h2 class="lp-info__title">Spørgsmål og svar</h2>
          <div class="lp-faq">${faqFor(kind).map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
        </div>
      </div>
    </div>
  </section>`;
}

const bidTime = (value) => {
  const d = new Date(value);
  const day = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen' }).format(d);
  const time = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' }).format(d);
  return `${day} kl. ${time}`;
};

async function loadHistory(lot) {
  if (demo) return demoHistory(lot);
  const { data, error } = await client.rpc('auction_bid_history', { p_lot: lot.id });
  // Before database/bid-history.sql is applied the function does not exist; then the section stays hidden.
  return error ? null : data;
}

// Public bid history: the leading (or winning) bid first, earlier bids below.
async function renderHistory(lot) {
  const slot = $('#bid-history');
  if (!slot) return;
  const rows = await loadHistory(lot);
  if (!rows || $('#bid-history') !== slot) return;
  const name = (row) => `${esc(row.display_name)}${row.is_mine ? ' <span class="lp-history__you">(dig)</span>' : ''}`;
  const [lead, ...earlier] = rows;
  slot.hidden = false;
  slot.innerHTML = `<h2 class="lp-history__title">Budhistorik</h2>
    ${lead
      ? `<div class="lp-history__lead">
          <div><p class="lp-history__label">${closed(lot) ? 'Vindende bud' : 'Højeste bud'}</p><p class="lp-history__name">${name(lead)}</p><p class="lp-history__meta">Budt ${bidTime(lead.created_at)}</p></div>
          <p class="lp-history__amount">${money(lead.amount)}</p>
        </div>
        ${earlier.length ? `<p class="lp-history__label lp-history__label--list">Tidligere bud</p><ol class="lp-history__list">${earlier.map((row) => `<li><div><p class="lp-history__row-name">${name(row)}</p><p class="lp-history__row-meta">Overbudt · budt ${bidTime(row.created_at)}</p></div><p class="lp-history__row-amount">${money(row.amount)}</p></li>`).join('')}</ol>` : ''}`
      : `<p class="lp-help">Ingen bud endnu. ${closed(lot) ? '' : 'Bliv den første til at byde.'}</p>`}`;
}

function wireBidForm(lot) {
  const input = $('#amount');
  const submit = $('#bid-submit');
  const chips = main.querySelectorAll('[data-amount]');
  const sync = () => {
    const amount = Number(input.value);
    submit.textContent = Number.isFinite(amount) && amount > 0 ? `Byd ${money(amount)}` : 'Byd';
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(Number(chip.dataset.amount) === amount)));
  };
  chips.forEach((chip) => {
    chip.onclick = () => {
      input.value = chip.dataset.amount;
      sync();
    };
  });
  const step = (direction) => {
    const current = Number(input.value) || minimum(lot);
    // Snap to the 500 kr. grid, then move one step within the allowed range.
    const snapped = Math.round(current / STEP) * STEP;
    input.value = Math.min(MAX_BID, Math.max(minimum(lot), snapped + direction * STEP));
    sync();
  };
  $('#amount-down').onclick = () => step(-1);
  $('#amount-up').onclick = () => step(1);
  input.addEventListener('input', sync);
  $('#bid-form').onsubmit = (event) => {
    event.preventDefault();
    confirmBid(lot, Number(input.value));
  };
}

function confirmBid(lot, amount) {
  if (!Number.isSafeInteger(amount) || amount < minimum(lot) || amount > MAX_BID || amount % STEP !== 0) {
    toast(`Dit bud skal være mindst ${money(minimum(lot))} og i hele 500 kr.`);
    return;
  }
  const request = crypto.randomUUID();
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">${demo ? 'Demobud' : 'Bekræft dit bud'}</p>
    <h2 id="modal-title">${kindOf(lot) === 'item' ? `Byd på ${esc(lot.name)}?` : `Dig og ${esc(firstName(lot))}?`}</h2>
    <p class="lp-text">Du byder <strong>${money(amount)}</strong> ${kindOf(lot) === 'item' ? `på ${esc(lot.name)}` : `på at blive makker med ${esc(lot.name)}`}.</p>
    <ul class="lp-terms">${keyTerms.map((t) => `<li>${t}</li>`).join('')}</ul>
    <form id="confirm-form" class="lp-form" style="gap: 18px">
      <label class="lp-check"><input type="checkbox" name="terms" required><span>Jeg accepterer <a href="#vilkaar" id="confirm-terms-link">vilkårene for auktionen</a> og ved, at mit bud er bindende.</span></label>
      ${demo ? '<p class="lp-help">Demo: buddet gemmes kun i din browser.</p>' : ''}
      <div class="lp-actions">
        <button class="lp-btn lp-btn--primary" type="submit">Bekræft ${money(amount)}</button>
        <button class="lp-btn lp-btn--secondary" type="button" id="confirm-cancel">Fortryd</button>
      </div>
    </form>`);
  $('#confirm-terms-link').onclick = (event) => {
    event.preventDefault();
    closeModal();
    $('#vilkaar')?.scrollIntoView({ behavior: 'smooth' });
  };
  $('#confirm-cancel').onclick = closeModal;
  useForm($('#confirm-form'), async (form) => {
    if (!form.querySelector('[name=terms]').checked) throw new Error('Accepter vilkårene for at byde.');
    if (demo) {
      if (closed(lot) || amount < minimum(lot)) throw new Error('Auktionen er slut, eller buddet er blevet overbudt.');
      lot.history = [{ amount, created_at: new Date().toISOString(), display_name: 'Demobudgiver', is_mine: true }, ...demoHistory(lot)];
      lot.current_bid = amount;
      lot.bid_count++;
      saveDemo();
    } else {
      const { error } = await client.rpc('place_auction_bid', { p_lot: lot.id, p_amount: amount, p_request: request });
      await fetchLots();
      if (error) {
        detail(lot.id);
        throw error;
      }
    }
    closeModal();
    detail(lot.id);
    toast(`${demo ? 'Demobud' : 'Bud'} på ${money(amount)} er registreret.`);
  });
}

// ---------- Admin ----------

async function googleLogin() {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + '/administration', queryParams: { hd: 'lykkeliga.dk', prompt: 'select_account' } },
  });
  if (error) throw error;
}

function showAdminLogin() {
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">Kun for LykkeLiga</p>
    <h2 id="modal-title">Log ind som admin</h2>
    <p class="lp-text">Brug din Google-konto på <strong>@lykkeliga.dk</strong>. Kontoen skal også have administratoradgang.</p>
    <form id="google-form"><button class="lp-btn lp-btn--primary" type="submit">Log ind med Google</button></form>
    ${user ? `<p class="lp-help">Du er logget ind som ${esc(user.email)}, men kontoen har ikke administratoradgang.</p><button class="lp-btn lp-btn--secondary" type="button" id="admin-logout">Log ud</button>` : ''}`);
  useForm($('#google-form'), googleLogin);
  $('#admin-logout')?.addEventListener('click', logout);
}

const statusPill = (lot) =>
  lot.status === 'draft'
    ? '<span class="lp-pill lp-pill--quiet">Kladde</span>'
    : closed(lot)
      ? '<span class="lp-pill lp-pill--quiet">Afsluttet</span>'
      : '<span class="lp-pill lp-pill--live">Live</span>';

async function adminView() {
  document.title = 'Admin – Lykke Padel';
  if (!demo && !isAdmin) {
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty">
      <p class="lp-eyebrow" style="color: var(--red-text)">Kun for arrangører</p>
      <h1 class="lp-display lp-display--s" style="color: var(--ink)">Administration</h1>
      <p class="lp-text">Log ind med din Google-konto på @lykkeliga.dk. Kun udpegede administratorer har adgang.</p>
      <button class="lp-btn lp-btn--primary" type="button" id="admin-login">Log ind med Google</button>
    </div></div>`;
    $('#admin-login').onclick = showAdminLogin;
    return;
  }
  const tabs = [...(demo ? [] : [['registrations', 'Tilmeldinger']]), ['lots', 'Auktioner'], ['people', 'Budgivere'], ['winners', 'Vindere']];
  main.innerHTML = `<div class="lp-wrap" style="padding-block: 48px var(--space-9); display: flex; flex-direction: column; gap: 32px">
    <div class="lp-section-head">
      <h1 class="lp-display lp-display--s" style="color: var(--ink)">Administration</h1>
      <div class="lp-actions"><a class="lp-btn lp-btn--secondary" href="${link()}">Se auktionen</a><button class="lp-btn lp-btn--primary" type="button" id="new-lot">Ny auktion</button></div>
    </div>
    <p class="lp-help">${demo ? 'Demo-administration. Ændringer gemmes kun i denne browser.' : 'Testmiljø. Makkere med bud kan ikke redigeres. Tider vises i dansk tid.'}</p>
    <nav class="lp-tabs" aria-label="Administration">${tabs.map(([key, label]) => `<a href="#" data-tab="${key}" ${key === adminTab ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div id="admin-body"></div>
    ${demo ? '<p><button class="lp-btn--text" type="button" id="reset-demo">Nulstil demodata</button></p>' : ''}
  </div>`;
  $('#new-lot').onclick = () => editLot();
  main.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.onclick = (event) => {
      event.preventDefault();
      adminTab = tab.dataset.tab;
      adminView();
    };
  });
  $('#reset-demo')?.addEventListener('click', () => {
    lots = initialLots();
    saveDemo();
    adminView();
    toast('Demodata er nulstillet.');
  });
  const body = $('#admin-body');
  if (adminTab === 'registrations') return eventAdminView(client, { refresh: adminView });
  if (adminTab === 'lots') return adminLots(body);
  if (adminTab === 'people') return adminPeople(body);
  if (adminTab === 'winners') return adminWinners(body);
}

function adminLots(body) {
  if (!lots.length) {
    body.innerHTML = '<div class="lp-empty"><p class="lp-text">Ingen auktioner endnu. Opret den første med "Ny auktion".</p></div>';
    return;
  }
  body.innerHTML = `<div class="lp-tablebox"><table class="lp-table">
    <thead><tr><th scope="col">Auktion</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col" class="num">Startpris</th><th scope="col" class="num">Højeste bud</th><th scope="col" class="num">Bud</th><th scope="col">Slutter</th><th scope="col"><span class="sr-only">Handling</span></th></tr></thead>
    <tbody>${lots
      .map(
        (lot) => `<tr>
      <td><div class="lp-cell-name"><img class="lp-thumb" src="${esc(safeImage(lot.image_url))}" alt=""><strong>${esc(lot.name)}</strong></div></td>
      <td>${kindOf(lot) === 'item' ? 'Charity-produkt' : 'Padelmakker'}</td>
      <td>${statusPill(lot)}</td>
      <td class="num">${money(lot.starting_price)}</td>
      <td class="num">${lot.bid_count ? money(lot.current_bid) : '–'}</td>
      <td class="num">${lot.bid_count}</td>
      <td>${date(lot.ends_at)}</td>
      <td><button class="lp-btn--text" type="button" data-edit="${esc(lot.id)}">${lot.bid_count ? 'Se' : 'Rediger'}</button></td>
    </tr>`,
      )
      .join('')}</tbody></table></div>`;
  body.querySelectorAll('[data-edit]').forEach((button) => (button.onclick = () => editLot(lots.find((l) => l.id === button.dataset.edit))));
}

async function adminPeople(body) {
  if (demo) {
    body.innerHTML = '<div class="lp-empty"><p class="lp-text">Budgivere vises kun i den Supabase-tilsluttede version.</p></div>';
    return;
  }
  const { data: people, error } = await client.from('auction_profiles').select('*').order('created_at', { ascending: false });
  if (error) {
    body.innerHTML = errorHtml(error.message);
    return;
  }
  if (!people.length) {
    body.innerHTML = '<div class="lp-empty"><p class="lp-text">Ingen budgivere endnu.</p></div>';
    return;
  }
  body.innerHTML = `<div class="lp-tablebox"><table class="lp-table">
    <thead><tr><th scope="col">Navn</th><th scope="col">Synligt navn</th><th scope="col">Telefon</th><th scope="col">Adresse</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Handling</span></th></tr></thead>
    <tbody>${people
      .map(
        (p) => `<tr><td><strong>${esc(p.full_name)}</strong></td><td>${p.display_name ? esc(p.display_name) : '<span class="lp-help">Ikke valgt</span>'}</td><td>${esc(p.phone)}</td><td>${esc(p.billing_address)}</td>
      <td>${p.approved ? '<span class="lp-pill lp-pill--lead">Godkendt</span>' : '<span class="lp-pill lp-pill--quiet">Blokeret</span>'}</td>
      <td><button class="lp-btn--text" type="button" data-approve="${esc(p.user_id)}" data-approved="${p.approved}">${p.approved ? 'Blokér' : 'Godkend'}</button></td></tr>`,
      )
      .join('')}</tbody></table></div>`;
  body.querySelectorAll('[data-approve]').forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      const { error: approveError } = await client.rpc('approve_auction_bidder', {
        p_user: button.dataset.approve,
        p_approved: button.dataset.approved !== 'true',
      });
      if (approveError) {
        toast(approveError.message);
        button.disabled = false;
        return;
      }
      await adminView();
      toast('Budgiverens status er opdateret.');
    };
  });
}

async function adminWinners(body) {
  let winners = [];
  if (!demo) {
    const { data, error } = await client.rpc('auction_winners');
    if (error) {
      body.innerHTML = errorHtml(error.message);
      return;
    }
    winners = data;
  }
  if (!winners.length) {
    body.innerHTML = '<div class="lp-empty"><p class="lp-text">Vindere vises her, når en auktion er afsluttet med mindst ét bud.</p></div>';
    return;
  }
  body.innerHTML = `<div class="lp-section-head" style="margin-bottom: 20px"><p class="lp-help">Fakturagrundlag fra afsluttede auktioner. Faktura oprettes manuelt i jeres fakturasystem.</p><button class="lp-btn lp-btn--secondary" type="button" id="export">Download fakturagrundlag (CSV)</button></div>
  <div class="lp-tablebox"><table class="lp-table">
    <thead><tr><th scope="col">Makker</th><th scope="col" class="num">Vinderbud</th><th scope="col">Vinder</th><th scope="col">Kontakt</th><th scope="col">Faktureringsadresse</th></tr></thead>
    <tbody>${winners.map((w) => `<tr><td><strong>${esc(w.name)}</strong></td><td class="num">${money(w.amount)}</td><td>${esc(w.full_name)}</td><td>${esc(w.email)}<br>${esc(w.phone)}</td><td>${esc(w.billing_address)}</td></tr>`).join('')}</tbody>
  </table></div>`;
  $('#export').onclick = () => {
    const keys = ['name', 'amount', 'full_name', 'email', 'phone', 'billing_address'];
    downloadCsv('lykke-padel-fakturagrundlag.csv', keys, winners.map((w) => keys.map((k) => w[k])));
  };
}

function localDate(value) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
  return parts.replace(' ', 'T');
}

// Convert Copenhagen wall-clock input to an instant, independent of the browser's time zone.
function danishInstant(value) {
  const wall = new Date(value + 'Z');
  let result = wall.getTime();
  for (let i = 0; i < 3; i++) result += wall.getTime() - new Date(localDate(new Date(result)) + 'Z').getTime();
  if (localDate(new Date(result)) !== value) throw new Error('Dette klokkeslæt findes ikke i dansk tid. Vælg et andet tidspunkt.');
  return new Date(result).toISOString();
}

function editLot(lot) {
  if (lot?.bid_count) {
    modal(`<h2 id="modal-title">${esc(lot.name)}</h2><p class="lp-text">${esc(lot.description)}</p>
      <p class="lp-text">${lot.bid_count} bud · højeste bud ${money(lot.current_bid)}<br>Slutter ${date(lot.ends_at)}</p>
      <p class="lp-help">Makkeren har bud og er låst. Kontakt den tekniske ansvarlige ved fejl; budhistorikken må ikke ændres.</p>`);
    return;
  }
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">Administration</p>
    <h2 id="modal-title">${lot ? 'Rediger auktion' : 'Ny auktion'}</h2>
    <form id="lot-form" class="lp-form">
      <div class="lp-field"><label for="lot-kind">Type</label><select id="lot-kind" class="lp-input" name="kind"><option value="item" ${lot?.kind !== 'partner' ? 'selected' : ''}>Charity-produkt – alle med profil kan byde</option><option value="partner" ${lot?.kind === 'partner' ? 'selected' : ''}>Padelmakker – kun individuelle deltagere kan byde</option></select></div>
      <div class="lp-field"><label for="lot-name">Navn</label><input id="lot-name" class="lp-input" name="name" value="${esc(lot?.name || '')}" minlength="2" maxlength="100" required></div>
      <div class="lp-field"><label for="lot-category">Kategori</label><input id="lot-category" class="lp-input" name="category" value="${esc(lot?.category || '')}" placeholder="Fx Padelspiller, Oplevelse eller Design" maxlength="60" required></div>
      <div class="lp-field"><label for="lot-image">Billede (HTTPS-adresse)</label><input id="lot-image" class="lp-input" name="image" type="url" pattern="https://.*" value="${esc(lot?.image_url || '')}" required></div>
      <div class="lp-field"><label for="lot-description">Beskrivelse</label><textarea id="lot-description" class="lp-input" name="description" minlength="10" maxlength="3000" required>${esc(lot?.description || '')}</textarea></div>
      <div class="lp-field-row">
        <div class="lp-field"><label for="lot-start">Startpris i kr.</label><input id="lot-start" class="lp-input" name="start" type="number" min="500" max="${MAX_BID}" step="${STEP}" value="${lot?.starting_price || 500}" required></div>
        <div class="lp-field"><label for="lot-status">Status</label><select id="lot-status" class="lp-input" name="status"><option value="draft">Kladde</option><option value="live" ${lot?.status === 'live' ? 'selected' : ''}>Live</option></select></div>
      </div>
      <div class="lp-field"><label for="lot-value">Værdi (valgfri)</label><input id="lot-value" class="lp-input" name="value" maxlength="60" value="${esc(lot?.value_text || '')}" placeholder="Fx Uvurderligt eller 4.000 kr."><p class="lp-help">Vises på charity-produkter.</p></div>
      <div class="lp-field"><label for="lot-ends">Slutter (dansk tid)</label><input id="lot-ends" class="lp-input" name="ends" type="datetime-local" value="${localDate(lot?.ends_at || new Date(Date.now() + 7 * 86400000))}" required></div>
      <p class="lp-help">Bud stiger med mindst 500 kr. En live auktion kan ses af alle. Tjek navn, billede og beskrivelse, før du sætter den live.</p>
      <div><button class="lp-btn lp-btn--primary" type="submit">Gem auktion</button></div>
    </form>`);
  useForm($('#lot-form'), async (form) => {
    const ends = danishInstant(field(form, 'ends'));
    if (new Date(ends) <= new Date()) throw new Error('Sluttidspunktet skal ligge i fremtiden.');
    const values = {
      p_id: lot?.id || null,
      p_name: field(form, 'name'),
      p_category: field(form, 'category'),
      p_description: field(form, 'description'),
      p_image: field(form, 'image'),
      p_ends: ends,
      p_start: Number(field(form, 'start')),
      p_status: field(form, 'status'),
      p_kind: field(form, 'kind'),
      p_value: field(form, 'value') || null,
    };
    if (demo) {
      const next = {
        id: lot?.id || crypto.randomUUID(),
        name: values.p_name,
        category: values.p_category,
        description: values.p_description,
        image_url: values.p_image,
        ends_at: ends,
        starting_price: values.p_start,
        status: values.p_status,
        kind: values.p_kind,
        value_text: values.p_value,
        current_bid: 0,
        bid_count: 0,
      };
      if (lot) lots[lots.findIndex((l) => l.id === lot.id)] = next;
      else lots.push(next);
      saveDemo();
    } else {
      let { error } = await client.rpc('save_auction_lot', values);
      // Before database/auction-items.sql is applied only the old 8-argument function exists.
      if (error && /PGRST202|could not find/i.test(`${error.code} ${error.message}`)) {
        const { p_kind, p_value, ...old } = values;
        if (p_kind === 'item') throw new Error('Charity-produkter kræver, at database/auction-items.sql er kørt i Supabase.');
        ({ error } = await client.rpc('save_auction_lot', old));
      }
      if (error) throw error;
      await fetchLots();
    }
    closeModal();
    await adminView();
    toast('Auktionen er gemt.');
  });
}

// ---------- Rendering and start ----------

async function render() {
  updateHeader();
  if (adminPage) return adminView();
  const id = location.hash.startsWith('#spiller/') ? decodeURIComponent(location.hash.slice(9)) : null;
  if (id) detail(id);
  else listing();
}

async function refresh() {
  if (!demo) {
    await loadIdentity();
    await fetchLots();
  }
  await render();
}

window.addEventListener('hashchange', () => {
  if (registrationPage || participantPage) return;
  if (['#auktioner', '#makkerne', '#saadan'].includes(location.hash)) return;
  window.scrollTo(0, 0);
  render().catch((error) => toast(errorMessage(error)));
});

// Update countdowns every second; re-render a player page when its auction ends.
setInterval(() => {
  document.querySelectorAll('[data-countdown="short"]').forEach((el) => (el.textContent = countdownShort(el.dataset.ends)));
  document.querySelectorAll('[data-countdown="bar"]').forEach((el) => (el.innerHTML = countdownBar(el.dataset.ends)));
  if ($('#bid-form')) {
    const id = decodeURIComponent(location.hash.slice(9));
    if (lots.find((l) => l.id === id && closed(l))) detail(id);
  }
}, 1000);

// Poll for new bids every 10 seconds while the tab is visible.
setInterval(async () => {
  if (demo || !client || document.hidden || polling || $('#modal').open || adminPage || registrationPage || participantPage) return;
  if (document.activeElement?.id === 'amount') return;
  polling = true;
  try {
    const before = JSON.stringify(lots);
    await fetchLots();
    if (before !== JSON.stringify(lots)) await render();
  } catch {
    toast('Kunne ikke opdatere buddene. Vi prøver igen om lidt.');
  } finally {
    polling = false;
  }
}, 10000);

function startDemo() {
  demo = true;
  setTestbar('Demo · eksempler på auktioner og bud · ingen betaling');
  lots = readDemo();
  return render();
}

async function start() {
  if (demo && !registrationPage && !participantPage) return startDemo();
  const response = await fetch('/api/auction-config?context=' + (adminPage ? 'admin' : 'participant'));
  if (response.status === 404 && !adminPage && !registrationPage && !participantPage) return startDemo();
  if (!response.ok) {
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">${registrationPage ? 'Tilmeldingen er ikke åben endnu' : 'Siden er ikke åben endnu'}</h1><p class="lp-text">Vi gør klar. Kig forbi igen senere.</p><a class="lp-btn lp-btn--primary" href="/forsidetest">Til forsiden</a></div></div>`;
    setHeader();
    return;
  }
  const config = await response.json();
  client = createClient(config.url, config.key);
  if (registrationPage || participantPage) {
    setTestbar('Testtilmelding · ingen kortbetaling · data gemmes hos LykkeLiga');
    await mountEvent(client, { participant: participantPage });
    return;
  }
  if (adminPage) {
    const authError = new URLSearchParams(location.hash.slice(1)).get('error_description') || new URLSearchParams(location.search).get('error_description');
    if (authError) {
      history.replaceState(null, '', '/admin');
      toast('Google-login kunne ikke gennemføres. Prøv igen eller kontakt arrangøren.');
    }
  }
  setTestbar('Testmiljø · eksempelprofiler · ingen betaling eller fakturering');
  await client.auth.getSession();
  await refresh();
}

start().catch((error) => {
  main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">Vi mangler forbindelsen</h1><p class="lp-text">Siden kunne ikke indlæses.</p>${errorHtml(errorMessage(error))}<button class="lp-btn lp-btn--primary" type="button" id="retry">Prøv igen</button></div></div>`;
  $('#retry').onclick = () => location.reload();
});
