import { setHeader, sessionUserId } from './ui.js';
import { LATEST_PLAYERS, playerHtml, startTicker } from './ticker.js';

// Content pages don't load Supabase. A stored session is enough to show "Min side" (or "Admin");
// the pages behind the button check the session properly when they open.
// The auction pages set the header themselves once they know the user.
if (!document.querySelector('script[src="/auction.js"]')) setHeader({ loggedIn: Boolean(sessionUserId()) });

// The tournament page's red bar: the latest players, one at a time.
document.querySelectorAll('[data-latest-players]').forEach((el) => {
  el.innerHTML = LATEST_PLAYERS.map((p, i) => `<p class="lp-countdown__slide lp-countdown__player${i ? '' : ' is-active'}">${playerHtml(p)}</p>`).join('');
  startTicker(el);
});
