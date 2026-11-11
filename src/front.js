import { countdownBar, isOver } from './countdown.js';
import { isProcessed } from './image-crop.js';

// The test front page: the countdown to the event and the live auctions.
function tick() {
  document.querySelectorAll('[data-countdown="bar"]').forEach((el) => (el.innerHTML = countdownBar(el.dataset.ends)));
}
tick();
setInterval(tick, 1000);

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
      rest.search = 'select=id,name,category,image_url,ends_at,created_at&status=eq.live&order=created_at.asc';
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
