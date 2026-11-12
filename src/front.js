import { loadLatestPlayers, playerHtml, startTicker } from './ticker.js';
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

// The red bar: the newest players, then the countdown. Without players it shows only the countdown.
// No slide is active until the names are loaded, so the first one rolls in.
document.querySelectorAll('[data-ticker]').forEach(async (root) => {
  const players = await loadLatestPlayers(2500);
  const names = root.querySelector('[data-latest-names]');
  if (names && players.length) names.innerHTML = players.slice(0, 2).map((p) => `<li>${playerHtml(p)}</li>`).join('');
  else names?.closest('.lp-countdown__slide')?.remove();
  root.querySelector('.lp-countdown__slide')?.classList.add('is-active');
  startTicker(root);
});

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
