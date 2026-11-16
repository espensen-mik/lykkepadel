import { setHeader, sessionUserId } from './ui.js';
import { loadLatestPlayers, playerHtml, startTicker } from './ticker.js';
import { mountProgram } from './program.js';
import { mountDonate } from './donate.js';

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

// The program on the front page and the Charity Showkamp page comes from the database (Admin → Program).
mountProgram();

// The floating "Støt LykkeLiga" button.
mountDonate();

// The "Kontakt" button in the top bar opens a small card with Signe's mail and phone.
const contact = document.querySelector('.lp-contactmenu');
if (contact) {
  const toggle = contact.querySelector('.lp-contactmenu__toggle');
  const card = contact.querySelector('.lp-contactmenu__card');
  const open = (show, focusBack = true) => {
    card.hidden = !show;
    contact.classList.toggle('is-open', show);
    toggle.setAttribute('aria-expanded', String(show));
    if (show) card.querySelector('a')?.focus({ preventScroll: true });
    else if (focusBack) toggle.focus();
  };
  toggle.addEventListener('click', () => open(card.hidden));
  contact.addEventListener('keydown', (event) => event.key === 'Escape' && !card.hidden && open(false));
  document.addEventListener('click', (event) => !card.hidden && !contact.contains(event.target) && open(false, false));
}
