import { countdownBar, countdownShort, isOver } from './countdown.js';
import { isProcessed } from './image-crop.js';

// The test front page: the countdown to the event and the live auctions.
function tick() {
  document.querySelectorAll('[data-countdown="bar"]').forEach((el) => (el.innerHTML = countdownBar(el.dataset.ends)));
  document.querySelectorAll('[data-lot-time]').forEach((el) => (el.innerHTML = lotTime(el.dataset.starts, el.dataset.ends)));
}

// "Starter om", "Slutter om" or "Slut", counted down every second.
function lotTime(starts, ends) {
  if (isOver(ends)) return 'Auktionen<br>er slut';
  if (starts && !isOver(starts)) return `Starter om<br><strong>${countdownShort(starts)}</strong>`;
  return `Slutter om<br><strong>${countdownShort(ends)}</strong>`;
}
const kr = (value) => `${new Intl.NumberFormat('da-DK').format(value)} kr.`;
tick();
setInterval(tick, 1000);

// The red bar takes turns between its slides. Each slide stays for its data-hold time,
// then rolls down and out while the next rolls in from above. Pauses while the tab is hidden.
function ticker(root) {
  const slides = [...root.querySelectorAll('.lp-countdown__slide')];
  if (slides.length < 2) return;
  let index = 0;
  let timer;
  const show = (i) => slides.forEach((s, n) => s.setAttribute('aria-hidden', String(n !== i)));
  const next = () => {
    const current = slides[index];
    index = (index + 1) % slides.length;
    const incoming = slides[index];
    // Put the incoming slide above the bar without animating, so it can roll in from there.
    incoming.classList.add('is-reset');
    incoming.classList.remove('is-leaving');
    void incoming.offsetWidth;
    incoming.classList.remove('is-reset');
    current.classList.replace('is-active', 'is-leaving');
    incoming.classList.add('is-active');
    show(index);
    schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => (document.hidden ? schedule() : next()), Number(slides[index].dataset.hold) || 6000);
  };
  show(0);
  schedule();
}
document.querySelectorAll('[data-ticker]').forEach(ticker);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function image(value) {
  try {
    const url = new URL(value, location.origin);
    if (url.origin === location.origin && /^\/(images|auktioner)\//.test(url.pathname)) return url.href;
    if (url.protocol === 'https:') return url.href;
  } catch {}
  return '/images/lykke-padel.svg';
}

const card = (lot) => `<a class="lp-player" href="/auktion#spiller/${encodeURIComponent(lot.id)}">
  <div class="lp-lot__media"><img src="${esc(image(lot.image_url))}" alt="${esc(lot.name)}" loading="lazy"${isProcessed(lot.image_url) ? ' class="is-duotone"' : ''}><p class="lp-lot__tag">${esc(lot.category)}</p></div>
  <h3 class="lp-lot__name">${esc(lot.name)}</h3>
  <div class="lp-lot__bid">
    <div>
      <p class="lp-lot__meta">${lot.bid_count ? `Nuværende bud · ${lot.bid_count} bud` : 'Startbud'}</p>
      <p class="lp-lot__amount">${kr(lot.bid_count ? lot.current_bid : lot.starting_price)}</p>
    </div>
    <p class="lp-lot__ends" data-lot-time data-starts="${esc(lot.starts_at || '')}" data-ends="${esc(lot.ends_at)}">${lotTime(lot.starts_at, lot.ends_at)}</p>
  </div>
</a>`;

// Only live auctions are shown. Open ones come first; without a connection the section says they open soon.
async function showLots() {
  const list = document.getElementById('front-lots');
  const empty = document.getElementById('front-lots-empty');
  if (!list) return;
  let lots = [];
  try {
    const response = await fetch('/api/auction-config?context=participant');
    if (response.ok) {
      const { url, key } = await response.json();
      const rest = new URL('/rest/v1/auction_lots', url);
      rest.search = 'select=*&status=eq.live&order=created_at.asc';
      const result = await fetch(rest, { headers: { apikey: key } });
      if (result.ok) lots = await result.json();
    }
  } catch {}
  lots.sort((a, b) => isOver(a.ends_at) - isOver(b.ends_at));
  list.innerHTML = lots.slice(0, 6).map(card).join('');
  list.hidden = !lots.length;
  empty.hidden = Boolean(lots.length);
}
showLots();
