import { createClient } from '@supabase/supabase-js';
import { countdownShort, countdownBar, isOver } from './countdown.js';
import { termsFor, keyTerms, stepsFor, faqFor } from './terms.js';
import { mountEvent } from './event.js';
import { eventAdminView } from './event-admin.js';
import { imageEditor, isProcessed } from './image-crop.js';
import { $, esc, money, date, toast, modal, closeModal, setupModal, useForm, field, errorHtml, errorMessage, setHeader, rememberAdmin, paymentChecks, bindPaymentChecks, yesDate, downloadCsv } from './ui.js';

// One page shell serves /auktion, /tilmelding, /deltager and /admin. The address decides what to show.
const path = location.pathname;
const adminPage = /^\/(admin|administration)\/?$/.test(path);
const registrationPage = /^\/tilmelding\/?$/.test(path);
const participantPage = /^\/deltager\/?$/.test(path);
// Keep the registered OAuth return address working, but show the short one.
if (path.startsWith('/administration')) history.replaceState(null, '', '/admin' + location.search + location.hash);

const main = $('#main');
const STEP = 500;
const MAX_BID = 10000000;

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

async function loadIdentity() {
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
  rememberAdmin(isAdmin ? user.id : null);
  eventAccess = access.data === true;
}

async function fetchLots() {
  const { data, error } = await client.from('auction_lots').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  lots = data || [];
}

const liveLots = () => lots.filter((lot) => lot.status === 'live');
const closed = (lot) => isOver(lot.ends_at);
// Live but waiting for its start time: visible, with a countdown, but no bidding yet.
const notStarted = (lot) => Boolean(lot.starts_at) && !isOver(lot.starts_at) && !closed(lot);
// Uploaded images already carry the duotone, so the CSS filter is skipped.
const duo = (lot) => (isProcessed(lot.image_url) ? ' is-duotone' : '');
const minimum = (lot) => (lot.bid_count ? lot.current_bid + STEP : lot.starting_price);
const firstName = (lot) => lot.name.split(' ')[0];
// Charity products need an active profile; padel partners also need an individual tournament registration.
const canBid = (lot) => (profile?.approved === true && (lot.kind === 'item' || eventAccess));

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
  return `/auktion${id ? '#spiller/' + encodeURIComponent(id) : ''}`;
}

function instagram(lot) {
  if (!/^[a-zA-Z0-9_.]{1,30}$/.test(lot.instagram || '')) return '';
  return `<a href="https://www.instagram.com/${esc(lot.instagram)}/" target="_blank" rel="noopener noreferrer">@${esc(lot.instagram)} på Instagram</a>`;
}

// ---------- Header ----------

function updateHeader() {
  if (adminPage && isAdmin) {
    setHeader({ loggedIn: true, admin: true, onLogout: logout });
    return;
  }
  if (adminPage) {
    setHeader({ loggedIn: Boolean(user), text: user ? 'Log ud' : 'Log ind', href: '/admin', onClick: user ? logout : showAdminLogin, logout: false });
    return;
  }
  setHeader({ loggedIn: Boolean(user), admin: isAdmin });
}

async function logout() {
  await client.auth.signOut();
  rememberAdmin(null);
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
  const waiting = notStarted(lot);
  const item = kindOf(lot) === 'item';
  return `<article class="lp-lot">
    <a class="lp-lot__link" href="${link(lot.id)}">
      <div class="lp-lot__media">
        <img class="lp-lot__img${duo(lot)}" src="${esc(safeImage(lot.image_url))}" alt="${esc(lot.name)}" loading="${index < 3 ? 'eager' : 'lazy'}">
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
          <p class="lp-lot__ends">${over ? 'Auktionen<br>er slut' : waiting ? `Starter om<br><span data-countdown="short" data-ends="${esc(lot.starts_at)}" data-starts>${countdownShort(lot.starts_at)}</span>` : `Slutter om<br><span data-countdown="short" data-ends="${esc(lot.ends_at)}">${countdownShort(lot.ends_at)}</span>`}</p>
        </div>
        <span class="lp-btn lp-btn--primary lp-btn--block">${over ? 'Se resultat' : waiting ? 'Se auktionen' : item ? 'Se og byd' : `Byd på ${esc(firstName(lot))}`}</span>
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
  const open = visible.filter((lot) => !closed(lot) && !notStarted(lot)).sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at))[0];
  const next = visible.filter(notStarted).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
  // Count down to the next end while bidding is open; otherwise to the next start.
  const target = open ? open.ends_at : next?.starts_at;
  const label = !visible.length ? 'Auktionerne afsløres snart' : open ? (visible.length > 1 ? 'Næste auktion slutter om' : 'Auktionen slutter om') : next ? 'Auktionen åbner om' : 'Auktionen er afsluttet';
  return `<section class="lp-countdown" aria-label="Nedtælling">
    <div class="lp-wrap lp-countdown__inner">
      <p class="lp-countdown__label">${label}</p>
      ${target ? `<div class="lp-countdown__time" data-countdown="bar" data-ends="${esc(target)}" ${open ? '' : 'data-starts'} role="timer">${countdownBar(target)}</div>` : ''}
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
        <p class="lp-eyebrow">${visible.some((lot) => !closed(lot) && !notStarted(lot)) ? 'Auktionen er åben' : visible.some(notStarted) ? 'Auktionen åbner snart' : 'Charity-auktion'}</p>
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
  const waiting = notStarted(lot);
  const item = kindOf(lot) === 'item';
  const others = liveLots().filter((l) => l.id !== lot.id).slice(0, 3);
  const meta = [esc(lot.category), item && lot.value_text ? `Værdi: ${esc(lot.value_text)}` : '', instagram(lot)].filter(Boolean).join(' · ');

  main.innerHTML = `
  <div class="lp-wrap" style="padding-block: 28px var(--space-9)">
    <a class="lp-back" href="${link()}">← Hele auktionen</a>
    <div class="lp-split" style="margin-top: 20px">
      <div class="lp-lot__media lp-detail-media">
        <img class="lp-lot__img${duo(lot)}" src="${esc(safeImage(lot.image_url))}" alt="${esc(lot.name)}">
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
            <div><dt>${over ? 'Status' : waiting ? 'Starter om' : 'Slutter om'}</dt><dd>${over ? 'Slut' : waiting ? `<span data-countdown="short" data-ends="${esc(lot.starts_at)}" data-starts>${countdownShort(lot.starts_at)}</span>` : `<span data-countdown="short" data-ends="${esc(lot.ends_at)}">${countdownShort(lot.ends_at)}</span>`}</dd></div>
          </dl>
          <p class="lp-help">${over ? `Auktionen sluttede ${date(lot.ends_at)}. Der kan ikke afgives flere bud.` : waiting ? `Budgivningen åbner ${date(lot.starts_at)} og slutter ${date(lot.ends_at)} (dansk tid).` : `Slutter ${date(lot.ends_at)} (dansk tid). Højeste bud, når tiden udløber, vinder.`}</p>
          ${over ? '' : waiting ? `<div class="lp-notice">Du kan byde, når nedtællingen er slut.${canBid(lot) ? '' : ' Gør din profil klar allerede nu.'}</div>${canBid(lot) ? '' : bidAccessNotice(lot)}` : canBid(lot) ? bidForm(lot) : bidAccessNotice(lot)}
        </section>
        <section class="lp-history" id="bid-history" aria-label="Budhistorik" hidden></section>
      </div>
    </div>
  </div>
  ${lotInfo(lot)}
  ${others.length ? `<section class="lp-band-cream lp-section--rule"><div class="lp-wrap lp-section"><h2 class="lp-display lp-display--s">Andre auktioner</h2><div class="lp-lots lp-lots--carousel" style="margin-top: 40px">${others.map(lotCard).join('')}</div></div></section>` : ''}`;

  if (!over && !waiting && canBid(lot)) wireBidForm(lot);
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
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">Bekræft dit bud</p>
    <h2 id="modal-title">${kindOf(lot) === 'item' ? `Byd på ${esc(lot.name)}?` : `Dig og ${esc(firstName(lot))}?`}</h2>
    <p class="lp-text">Du byder <strong>${money(amount)}</strong> ${kindOf(lot) === 'item' ? `på ${esc(lot.name)}` : `på at blive makker med ${esc(lot.name)}`}.</p>
    <ul class="lp-terms">${keyTerms.map((t) => `<li>${t}</li>`).join('')}</ul>
    <form id="confirm-form" class="lp-form" style="gap: 18px">
      <label class="lp-check"><input type="checkbox" name="terms" required><span>Jeg accepterer <a href="#vilkaar" id="confirm-terms-link">vilkårene for auktionen</a> og ved, at mit bud er bindende.</span></label>
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
    const { error } = await client.rpc('place_auction_bid', { p_lot: lot.id, p_amount: amount, p_request: request });
    await fetchLots();
    if (error) {
      detail(lot.id);
      throw error;
    }
    closeModal();
    detail(lot.id);
    toast(`Bud på ${money(amount)} er registreret.`);
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

const pill = (kind, text) => `<span class="lp-pill lp-pill--${kind}">${text}</span>`;
const statusPill = (lot) =>
  lot.status === 'trashed'
    ? pill('quiet', 'I papirkurven')
    : lot.status === 'draft'
      ? pill('quiet', 'Kladde')
      : closed(lot)
        ? pill('quiet', 'Afsluttet')
        : notStarted(lot)
          ? pill('lead', 'Starter snart')
          : pill('live', 'Live');

const ICONS = {
  trash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  restore: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5"/></svg>',
  calendar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 15v5h16v-5"/></svg>',
  minus: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4v12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
};

const BUCKET = 'auction-images';
const trashed = () => lots.filter((lot) => lot.status === 'trashed');
// Before database/auction-admin-tools.sql is applied the new functions do not exist.
const missingFunction = (error) => /PGRST202|could not find/i.test(`${error?.code} ${error?.message}`);
const needsSql = (error) => (missingFunction(error) ? new Error('Kør database/auction-admin-tools.sql i Supabase først.') : error);
const fail = (error) => toast(errorMessage(error));

async function adminView() {
  document.title = 'Admin – Lykke Padel';
  if (!isAdmin) {
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty">
      <p class="lp-eyebrow" style="color: var(--red-text)">Kun for arrangører</p>
      <h1 class="lp-display lp-display--s" style="color: var(--ink)">Administration</h1>
      <p class="lp-text">Log ind med din Google-konto på @lykkeliga.dk. Kun udpegede administratorer har adgang.</p>
      <button class="lp-btn lp-btn--primary" type="button" id="admin-login">Log ind med Google</button>
    </div></div>`;
    $('#admin-login').onclick = showAdminLogin;
    return;
  }
  const inTrash = trashed().length;
  const tabs = [
    ['registrations', 'Tilmeldinger'],
    ['lots', 'Auktioner'],
    ['people', 'Budgivere'],
    ['winners', 'Vindere'],
    ['trash', `${ICONS.trash}<span>Papirkurv</span>${inTrash ? `<span class="lp-tabs__count">${inTrash}</span>` : ''}`],
  ];
  main.innerHTML = `<div class="lp-wrap" style="padding-block: 48px var(--space-9); display: flex; flex-direction: column; gap: 32px">
    <div class="lp-section-head">
      <h1 class="lp-display lp-display--s" style="color: var(--ink)">Administration</h1>
      <div class="lp-actions"><a class="lp-btn lp-btn--secondary" href="${link()}">Se auktionen</a><button class="lp-btn lp-btn--primary" type="button" id="new-lot">Ny auktion</button></div>
    </div>
    <p class="lp-help">Auktioner med bud kan ikke redigeres. Tider vises i dansk tid.</p>
    <nav class="lp-tabs" aria-label="Administration">${tabs.map(([key, label]) => `<a href="#" data-tab="${key}" ${key === adminTab ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div id="admin-body"></div>
  </div>`;
  $('#new-lot').onclick = () => editLot();
  main.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.onclick = (event) => {
      event.preventDefault();
      adminTab = tab.dataset.tab;
      adminView();
    };
  });
  const body = $('#admin-body');
  if (adminTab === 'registrations') return eventAdminView(client, { refresh: adminView });
  if (adminTab === 'lots') return adminLots(body);
  if (adminTab === 'people') return adminPeople(body);
  if (adminTab === 'winners') return adminWinners(body);
  if (adminTab === 'trash') return adminTrash(body);
}

// Open auctions first, then upcoming, drafts and finished ones.
const adminOrder = (lot) => (lot.status === 'draft' ? 2 : closed(lot) ? 3 : notStarted(lot) ? 1 : 0);

function adminLots(body) {
  const shown = lots.filter((lot) => lot.status !== 'trashed').sort((a, b) => adminOrder(a) - adminOrder(b) || new Date(a.ends_at) - new Date(b.ends_at));
  if (!shown.length) {
    body.innerHTML = '<div class="lp-empty"><p class="lp-text">Ingen auktioner endnu. Opret den første med "Ny auktion".</p></div>';
    return;
  }
  body.innerHTML = `<div class="lp-tablebox"><table class="lp-table">
    <thead><tr><th scope="col">Auktion</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Starter</th><th scope="col">Slutter</th><th scope="col" class="num">Startpris</th><th scope="col" class="num">Højeste bud</th><th scope="col"><span class="sr-only">Handlinger</span></th></tr></thead>
    <tbody>${shown
      .map(
        (lot) => `<tr>
      <td><div class="lp-cell-name"><img class="lp-thumb${duo(lot)}" src="${esc(safeImage(lot.image_url))}" alt=""><strong>${esc(lot.name)}</strong></div></td>
      <td>${kindOf(lot) === 'item' ? 'Charity-produkt' : 'Padelmakker'}</td>
      <td>${statusPill(lot)}</td>
      <td>${lot.starts_at ? date(lot.starts_at) : '<span class="lp-help">Straks</span>'}</td>
      <td>${date(lot.ends_at)}</td>
      <td class="num">${money(lot.starting_price)}</td>
      <td class="num">${lot.bid_count ? `${money(lot.current_bid)}<br><span class="lp-help">${lot.bid_count} bud</span>` : '–'}</td>
      <td><div class="lp-row-actions"><button class="lp-btn--text" type="button" data-edit="${esc(lot.id)}">${lot.bid_count ? 'Se' : 'Rediger'}</button><button class="lp-iconbtn" type="button" data-trash="${esc(lot.id)}" aria-label="Læg ${esc(lot.name)} i papirkurven" title="Læg i papirkurven">${ICONS.trash}</button></div></td>
    </tr>`,
      )
      .join('')}</tbody></table></div>`;
  const find = (id) => lots.find((l) => l.id === id);
  body.querySelectorAll('[data-edit]').forEach((button) => (button.onclick = () => editLot(find(button.dataset.edit))));
  body.querySelectorAll('[data-trash]').forEach((button) => (button.onclick = () => askTrash(find(button.dataset.trash))));
}

// Trashing is reversible, so it only asks when the auction already has bids.
function askTrash(lot) {
  if (!lot.bid_count) return setTrashed(lot, true).catch(fail);
  modal(`<h2 id="modal-title">Læg i papirkurven?</h2>
    <p class="lp-text"><strong>${esc(lot.name)}</strong> har ${lot.bid_count} bud. Auktionen bliver skjult for alle, og budgivningen stopper. Buddene bliver gemt, og du kan gendanne auktionen som kladde.</p>
    <div class="lp-actions"><button class="lp-btn lp-btn--primary" type="button" id="trash-yes">Læg i papirkurven</button><button class="lp-btn lp-btn--secondary" type="button" id="trash-no">Fortryd</button></div>`);
  $('#trash-no').onclick = closeModal;
  $('#trash-yes').onclick = () => setTrashed(lot, true).catch(fail);
}

async function setTrashed(lot, trash) {
  const { error } = await client.rpc('trash_auction_lot', { p_id: lot.id, p_trash: trash });
  if (error) throw needsSql(error);
  await fetchLots();
  closeModal();
  await adminView();
  toast(trash ? `"${lot.name}" er lagt i papirkurven.` : `"${lot.name}" er gendannet som kladde.`);
}

function adminTrash(body) {
  const rows = trashed();
  if (!rows.length) {
    body.innerHTML = `<div class="lp-empty"><p class="lp-text">Papirkurven er tom. Brug skraldespanden ved en auktion for at fjerne den fra siden.</p></div>`;
    return;
  }
  const deletable = rows.filter((lot) => !lot.bid_count);
  body.innerHTML = `<div class="lp-section-head" style="margin-bottom: 20px"><p class="lp-help" style="max-width: 560px">Auktionerne her er skjult for alle. Gendan en auktion som kladde, eller slet den for altid. Auktioner med bud kan ikke slettes, så buddene bevares.</p>${deletable.length ? `<button class="lp-btn lp-btn--secondary" type="button" id="empty-trash">Tøm papirkurven</button>` : ''}</div>
  <div class="lp-tablebox"><table class="lp-table">
    <thead><tr><th scope="col">Auktion</th><th scope="col">Type</th><th scope="col" class="num">Bud</th><th scope="col"><span class="sr-only">Handlinger</span></th></tr></thead>
    <tbody>${rows
      .map(
        (lot) => `<tr>
      <td><div class="lp-cell-name"><img class="lp-thumb${duo(lot)}" src="${esc(safeImage(lot.image_url))}" alt=""><strong>${esc(lot.name)}</strong></div></td>
      <td>${kindOf(lot) === 'item' ? 'Charity-produkt' : 'Padelmakker'}</td>
      <td class="num">${lot.bid_count}</td>
      <td><div class="lp-row-actions"><button class="lp-btn--text lp-btn--icon" type="button" data-restore="${esc(lot.id)}">${ICONS.restore}Gendan</button>${lot.bid_count ? '<span class="lp-help">Har bud</span>' : `<button class="lp-btn--text" type="button" data-delete="${esc(lot.id)}">Slet for altid</button>`}</div></td>
    </tr>`,
      )
      .join('')}</tbody></table></div>`;
  const find = (id) => lots.find((l) => l.id === id);
  body.querySelectorAll('[data-restore]').forEach((button) => (button.onclick = () => setTrashed(find(button.dataset.restore), false).catch(fail)));
  body.querySelectorAll('[data-delete]').forEach((button) => (button.onclick = () => askDelete([find(button.dataset.delete)])));
  $('#empty-trash')?.addEventListener('click', () => askDelete(deletable));
}

function askDelete(list) {
  const one = list.length === 1;
  modal(`<h2 id="modal-title">Slet for altid?</h2>
    <p class="lp-text">${one ? `<strong>${esc(list[0].name)}</strong> bliver slettet` : `${list.length} auktioner bliver slettet`} sammen med ${one ? 'sit' : 'deres'} billede. Det kan ikke fortrydes.</p>
    ${one ? '' : `<ul class="lp-text" style="margin: 0; padding-left: 20px">${list.map((lot) => `<li>${esc(lot.name)}</li>`).join('')}</ul>`}
    <div class="lp-actions"><button class="lp-btn lp-btn--primary" type="button" id="delete-yes">Slet for altid</button><button class="lp-btn lp-btn--secondary" type="button" id="delete-no">Behold</button></div>`);
  $('#delete-no').onclick = closeModal;
  $('#delete-yes').onclick = async () => {
    $('#delete-yes').disabled = true;
    try {
      for (const lot of list) {
        const { error } = await client.rpc('delete_auction_lot', { p_id: lot.id });
        if (error) throw needsSql(error);
        await removeImage(lot.image_url);
      }
      await fetchLots();
      closeModal();
      await adminView();
      toast(one ? `"${list[0].name}" er slettet.` : `${list.length} auktioner er slettet.`);
    } catch (error) {
      await fetchLots().catch(() => {});
      closeModal();
      await adminView();
      fail(error);
    }
  };
}

async function adminPeople(body) {
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
      <td><div class="lp-row-actions"><button class="lp-btn--text" type="button" data-approve="${esc(p.user_id)}" data-approved="${p.approved}">${p.approved ? 'Blokér' : 'Godkend'}</button><button class="lp-iconbtn" type="button" data-delete-bidder="${esc(p.user_id)}" aria-label="Slet ${esc(p.full_name)}" title="Slet budgiver">${ICONS.trash}</button></div></td></tr>`,
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
  body.querySelectorAll('[data-delete-bidder]').forEach((button) => {
    button.onclick = () => askDeleteBidder(people.find((p) => p.user_id === button.dataset.deleteBidder));
  });
}

// Bidders with bids or a confirmed registration are protected; the database gives the reason.
function askDeleteBidder(person) {
  modal(`<h2 id="modal-title">Slet budgiver?</h2>
    <p class="lp-text">${esc(person.full_name)}${person.display_name ? ` (${esc(person.display_name)})` : ''}</p>
    <p class="lp-help">Budprofilen fjernes for altid. Budgivere, der har budt, eller som er tilmeldt turneringen, kan ikke slettes. Personen kan senere oprette en ny profil med samme mail.</p>
    <form id="delete-bidder-form" class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">Slet budgiver</button><button class="lp-btn lp-btn--secondary" type="button" id="delete-bidder-keep">Behold</button></form>`);
  $('#delete-bidder-keep').onclick = closeModal;
  useForm($('#delete-bidder-form'), async () => {
    const { error } = await client.rpc('delete_auction_bidder', { p_user: person.user_id });
    if (error) throw missingFunction(error) ? new Error('Kør database/delete-people.sql i Supabase først.') : error;
    closeModal();
    await adminView();
    toast(`${person.full_name} er slettet.`);
  });
}

async function adminWinners(body) {
  const { data: winners, error } = await client.rpc('auction_winners');
  if (error) {
    body.innerHTML = errorHtml(error.message);
    return;
  }
  if (!winners.length) {
    body.innerHTML = '<div class="lp-empty"><p class="lp-text">Vindere vises her, når en auktion er afsluttet med mindst ét bud.</p></div>';
    return;
  }
  const tracked = winners.some((w) => 'paid_at' in w);
  const unpaid = winners.filter((w) => !w.paid_at);
  body.innerHTML = `<div class="lp-section-head" style="margin-bottom: 20px"><p class="lp-help">Fakturagrundlag fra afsluttede auktioner. Faktura oprettes manuelt i jeres fakturasystem${tracked ? `. ${winners.length - unpaid.length} af ${winners.length} er betalt, og der mangler ${money(unpaid.reduce((sum, w) => sum + w.amount, 0))}` : ''}.</p><button class="lp-btn lp-btn--secondary" type="button" id="export">Download fakturagrundlag (CSV)</button></div>
  <div class="lp-tablebox"><table class="lp-table">
    <thead><tr><th scope="col">Auktion</th><th scope="col" class="num">Vinderbud</th><th scope="col">Vinder</th><th scope="col">Kontakt</th><th scope="col">Faktureringsadresse</th>${tracked ? '<th scope="col">Betaling</th>' : ''}</tr></thead>
    <tbody>${winners.map((w) => `<tr><td><strong>${esc(w.name)}</strong></td><td class="num">${money(w.amount)}</td><td>${esc(w.full_name)}</td><td>${esc(w.email)}<br>${esc(w.phone)}</td><td>${esc(w.billing_address)}</td>${tracked ? `<td>${paymentChecks(w.id, w)}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
  bindPaymentChecks(body, async (id, values) => {
    const { error: payError } = await client.rpc('set_auction_lot_payment', { p_lot: id, p_invoice_sent: null, p_paid: null, ...values });
    if (payError) throw payError;
    const row = winners.find((w) => w.id === id);
    if ('p_invoice_sent' in values) row.invoice_sent_at = values.p_invoice_sent ? new Date().toISOString() : null;
    if ('p_paid' in values) row.paid_at = values.p_paid ? new Date().toISOString() : null;
  });
  $('#export').onclick = () => {
    const header = ['Auktion', 'Vinderbud', 'Vinder', 'Mail', 'Telefon', 'Faktureringsadresse', 'Faktura sendt', 'Betalt'];
    downloadCsv('lykke-padel-fakturagrundlag.csv', header, winners.map((w) => [w.name, w.amount, w.full_name, w.email, w.phone, w.billing_address, yesDate(w.invoice_sent_at), yesDate(w.paid_at)]));
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

// Uploaded images live in the public bucket under lots/.
function bucketPath(url) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = (url || '').indexOf(marker);
  return at === -1 ? null : decodeURIComponent(url.slice(at + marker.length));
}

async function uploadImage(blob) {
  const path = `lots/${crypto.randomUUID()}.jpg`;
  const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error) throw /not found|bucket/i.test(error.message) ? new Error('Billed-upload kræver, at database/auction-admin-tools.sql er kørt i Supabase.') : error;
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Best effort: a leftover file only costs storage, so errors are ignored.
async function removeImage(url) {
  const path = bucketPath(url);
  if (path) await client.storage.from(BUCKET).remove([path]).catch(() => {});
}

const dateField = (id, name, value, extra = '') =>
  `<div class="lp-datefield"><input id="${id}" class="lp-input" name="${name}" type="datetime-local" value="${value}" ${extra}><button class="lp-datefield__btn" type="button" data-picker="${id}" tabindex="-1" aria-hidden="true">${ICONS.calendar}</button></div>`;

function editLot(lot) {
  if (lot?.bid_count) {
    modal(`<h2 id="modal-title">${esc(lot.name)}</h2><p class="lp-text">${esc(lot.description)}</p>
      <p class="lp-text">${lot.bid_count} bud · højeste bud ${money(lot.current_bid)}<br>Slutter ${date(lot.ends_at)}</p>
      <p class="lp-help">Auktionen har bud og er låst. Budhistorikken må ikke ændres. Du kan lægge den i papirkurven, hvis den skal fjernes fra siden.</p>
      <div class="lp-actions"><button class="lp-btn--text lp-btn--icon" type="button" id="lot-trash">${ICONS.trash}Læg i papirkurven</button></div>`);
    $('#lot-trash').onclick = () => askTrash(lot);
    return;
  }
  const startsNow = !lot?.starts_at;
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">Administration</p>
    <h2 id="modal-title">${lot ? 'Rediger auktion' : 'Ny auktion'}</h2>
    <form id="lot-form" class="lp-form">
      <div class="lp-field"><label for="lot-kind">Type</label><select id="lot-kind" class="lp-input" name="kind"><option value="item" ${lot?.kind !== 'partner' ? 'selected' : ''}>Charity-produkt – alle med profil kan byde</option><option value="partner" ${lot?.kind === 'partner' ? 'selected' : ''}>Padelmakker – kun individuelle deltagere kan byde</option></select></div>
      <div class="lp-field"><label for="lot-name">Navn</label><input id="lot-name" class="lp-input" name="name" value="${esc(lot?.name || '')}" minlength="2" maxlength="100" required></div>
      <div class="lp-field"><label for="lot-category">Kategori</label><input id="lot-category" class="lp-input" name="category" value="${esc(lot?.category || '')}" placeholder="Fx Padelspiller, Oplevelse eller Design" maxlength="60" required></div>
      <div class="lp-field">
        <p class="lp-label">Billede</p>
        <div class="lp-upload${lot?.image_url ? ' has-image' : ''}" id="lot-upload">
          <div class="lp-upload__frame">
            <canvas class="lp-upload__preview" tabindex="0" aria-label="Udsnit af billedet. Brug piletasterne for at flytte det." hidden></canvas>
            ${lot?.image_url ? `<img class="lp-upload__current${duo(lot)}" src="${esc(safeImage(lot.image_url))}" alt="Nuværende billede">` : '<p class="lp-upload__empty" aria-hidden="true">Intet billede</p>'}
          </div>
          <div class="lp-upload__side">
            <label class="lp-btn lp-btn--secondary lp-btn--small lp-upload__pick">${ICONS.upload}<span>${lot?.image_url ? 'Skift billede' : 'Vælg billede'}</span><input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic"></label>
            <p class="lp-help lp-upload__hint">Eller træk et billede hertil. Det bliver automatisk beskåret til kortformatet og får duotone.</p>
            <button class="lp-btn--text" type="button" id="image-url-toggle">Brug en billedadresse i stedet</button>
          </div>
        </div>
        <div class="lp-field" id="image-url-field" hidden><label for="lot-image">Billedadresse (https)</label><input id="lot-image" class="lp-input" name="image" type="url" value="${esc(bucketPath(lot?.image_url) ? '' : lot?.image_url || '')}" placeholder="https://"><p class="lp-help">Bruges kun, hvis du ikke uploader et billede.</p></div>
      </div>
      <div class="lp-field"><label for="lot-description">Beskrivelse</label><textarea id="lot-description" class="lp-input" name="description" minlength="10" maxlength="3000" required>${esc(lot?.description || '')}</textarea></div>
      <div class="lp-field-row">
        <div class="lp-field"><label for="lot-start">Startpris i kr.</label><div class="lp-stepper lp-stepper--small"><button class="lp-stepper__btn" type="button" data-price="-${STEP}" aria-label="Sænk startprisen med 500 kr.">${ICONS.minus}</button><input id="lot-start" class="lp-input" name="start" type="number" inputmode="numeric" min="500" max="${MAX_BID}" step="${STEP}" value="${lot?.starting_price || 500}" required><button class="lp-stepper__btn" type="button" data-price="${STEP}" aria-label="Hæv startprisen med 500 kr.">${ICONS.plus}</button></div></div>
        <div class="lp-field"><label for="lot-value">Værdi <span class="lp-optional">(valgfri)</span></label><input id="lot-value" class="lp-input" name="value" maxlength="60" value="${esc(lot?.value_text || '')}" placeholder="Fx Uvurderligt"></div>
      </div>
      <fieldset class="lp-fieldset">
        <legend class="lp-label">Tidspunkt (dansk tid)</legend>
        <label class="lp-check"><input type="checkbox" name="startnow" id="lot-startnow" ${startsNow ? 'checked' : ''}><span>Budgivningen starter, så snart auktionen er live</span></label>
        <div class="lp-field-row">
          <div class="lp-field" id="lot-starts-field" ${startsNow ? 'hidden' : ''}><label for="lot-starts">Starter</label>${dateField('lot-starts', 'starts', localDate(lot?.starts_at || new Date(Date.now() + 86400000)))}</div>
          <div class="lp-field"><label for="lot-ends">Slutter</label>${dateField('lot-ends', 'ends', localDate(lot?.ends_at || new Date(Date.now() + 7 * 86400000)), 'required')}</div>
        </div>
        <p class="lp-help">Med en starttid vises auktionen med nedtælling, og der kan først bydes fra starttidspunktet.</p>
      </fieldset>
      <div class="lp-field"><label for="lot-status">Status</label><select id="lot-status" class="lp-input" name="status"><option value="draft">Kladde – kun synlig her</option><option value="live" ${lot?.status === 'live' ? 'selected' : ''}>Live – synlig på siden</option></select></div>
      <p class="lp-help">Bud stiger med mindst 500 kr. Tjek navn, billede og beskrivelse, før du sætter auktionen live.</p>
      <div class="lp-form__foot"><button class="lp-btn lp-btn--primary" type="submit">Gem auktion</button>${lot ? `<button class="lp-btn--text lp-btn--icon" type="button" id="lot-trash">${ICONS.trash}Læg i papirkurven</button>` : ''}</div>
    </form>`);

  const form = $('#lot-form');
  const editor = imageEditor($('#lot-upload'), { onError: (error) => toast(errorMessage(error)) });
  $('#image-url-toggle').onclick = () => {
    const box = $('#image-url-field');
    box.hidden = !box.hidden;
    if (!box.hidden) $('#lot-image').focus();
  };
  form.querySelectorAll('[data-picker]').forEach((button) => {
    button.onclick = () => {
      const input = $('#' + button.dataset.picker);
      try {
        input.showPicker();
      } catch {
        input.focus();
      }
    };
  });
  form.querySelectorAll('[data-price]').forEach((button) => {
    button.onclick = () => {
      const input = $('#lot-start');
      const next = Math.round((Number(input.value) || 0) / STEP) * STEP + Number(button.dataset.price);
      input.value = Math.min(MAX_BID, Math.max(500, next));
    };
  });
  $('#lot-startnow').onchange = (event) => ($('#lot-starts-field').hidden = event.target.checked);
  $('#lot-trash')?.addEventListener('click', () => askTrash(lot));

  useForm(form, async () => {
    const start = Number(field(form, 'start'));
    if (start < 500 || start > MAX_BID || start % STEP) throw new Error('Startprisen skal være mindst 500 kr. og i hele 500 kr.');
    const ends = danishInstant(field(form, 'ends'));
    if (new Date(ends) <= new Date()) throw new Error('Sluttidspunktet skal ligge i fremtiden.');
    const starts = $('#lot-startnow').checked ? null : danishInstant(field(form, 'starts'));
    if (starts && new Date(starts) >= new Date(ends)) throw new Error('Starttidspunktet skal ligge før sluttidspunktet.');
    const typed = field(form, 'image');
    if (typed && !/^https:\/\//.test(typed)) throw new Error('Billedadressen skal starte med https://');
    let image = typed || lot?.image_url || '';
    if (editor.changed) image = await uploadImage(await editor.blob());
    if (!image) throw new Error('Vælg et billede til auktionen.');

    const values = {
      p_id: lot?.id || null,
      p_name: field(form, 'name'),
      p_category: field(form, 'category'),
      p_description: field(form, 'description'),
      p_image: image,
      p_starts: starts,
      p_ends: ends,
      p_start: start,
      p_status: field(form, 'status'),
      p_kind: field(form, 'kind'),
      p_value: field(form, 'value') || null,
    };
    let { error } = await client.rpc('save_auction_lot', values);
    // Older databases: without auction-admin-tools.sql there is no start time, without auction-items.sql no kind.
    if (error && missingFunction(error)) {
      if (starts) throw new Error('Starttid kræver, at database/auction-admin-tools.sql er kørt i Supabase.');
      const { p_starts, ...v2 } = values;
      ({ error } = await client.rpc('save_auction_lot', v2));
      if (error && missingFunction(error)) {
        const { p_kind, p_value, ...old } = v2;
        if (p_kind === 'item') throw new Error('Charity-produkter kræver, at database/auction-items.sql er kørt i Supabase.');
        ({ error } = await client.rpc('save_auction_lot', old));
      }
    }
    if (error) {
      if (editor.changed) await removeImage(image);
      throw error;
    }
    if (lot && lot.image_url !== image) await removeImage(lot.image_url);
    await fetchLots();
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
  await loadIdentity();
  await fetchLots();
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
  // A start countdown reached zero: show the auction as open.
  if (!adminPage && [...document.querySelectorAll('[data-starts]')].some((el) => isOver(el.dataset.ends))) render();
}, 1000);

// Poll for new bids every 10 seconds while the tab is visible.
setInterval(async () => {
  if (!client || document.hidden || polling || $('#modal').open || adminPage || registrationPage || participantPage) return;
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

async function start() {
  const response = await fetch('/api/auction-config?context=' + (adminPage ? 'admin' : 'participant'));
  if (!response.ok) {
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">${registrationPage ? 'Tilmeldingen er ikke åben endnu' : 'Siden er ikke åben endnu'}</h1><p class="lp-text">Vi gør klar. Kig forbi igen senere.</p><a class="lp-btn lp-btn--primary" href="/forsidetest">Til forsiden</a></div></div>`;
    setHeader();
    return;
  }
  const config = await response.json();
  client = createClient(config.url, config.key);
  if (registrationPage || participantPage) {
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
  await client.auth.getSession();
  await refresh();
}

start().catch((error) => {
  main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">Vi mangler forbindelsen</h1><p class="lp-text">Siden kunne ikke indlæses.</p>${errorHtml(errorMessage(error))}<button class="lp-btn lp-btn--primary" type="button" id="retry">Prøv igen</button></div></div>`;
  $('#retry').onclick = () => location.reload();
});
