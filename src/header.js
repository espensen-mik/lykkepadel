import { setHeader, sessionUserId } from './ui.js';
import { loadLatestPlayers, playerHtml, startTicker } from './ticker.js';

// Content pages don't load Supabase. A stored session is enough to show "Min side" (or "Admin");
// the pages behind the button check the session properly when they open.
// The auction pages set the header themselves once they know the user.
if (!document.querySelector('script[src="/auction.js"]')) setHeader({ loggedIn: Boolean(sessionUserId()) });

// The tournament page's red bar: the latest players, one at a time. Hidden when there are none.
document.querySelectorAll('[data-latest-players]').forEach(async (el) => {
  const players = await loadLatestPlayers();
  const bar = el.closest('section');
  if (!players.length) {
    bar.hidden = true;
    return;
  }
  el.innerHTML = players.map((p) => `<p class="lp-countdown__slide lp-countdown__player">${playerHtml(p)}</p>`).join('');
  void el.offsetWidth;
  el.firstElementChild.classList.add('is-active');
  startTicker(el);
});
