// The latest players who may be shown on the website, newest first: [{ name, title }].
// Admins choose who is shown ("Må vises på websitet"). Returns [] if the list cannot be loaded in time.
let loading;
export function loadLatestPlayers(timeout = 4000) {
  loading ??= (async () => {
    try {
      const response = await fetch('/api/auction-config?context=participant');
      if (!response.ok) return [];
      const { url, key } = await response.json();
      const result = await fetch(new URL('/rest/v1/rpc/latest_players', url), {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const list = result.ok ? await result.json() : [];
      return Array.isArray(list) ? list.filter((p) => p && p.name) : [];
    } catch {
      return [];
    }
  })();
  return Promise.race([loading, new Promise((resolve) => setTimeout(() => resolve([]), timeout))]);
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const playerHtml = (p) => `<strong>${esc(p.name)}</strong>${p.title ? `<span>${esc(p.title)}</span>` : ''}`;

// Takes turns between the .lp-countdown__slide elements in root. Each slide stays for its data-hold
// time (or the root's), then rolls down and out while the next rolls in from above.
// Waits while the tab is hidden.
export function startTicker(root) {
  const slides = [...root.querySelectorAll(':scope > .lp-countdown__slide')];
  if (slides.length < 2) return;
  let index = slides.findIndex((s) => s.classList.contains('is-active'));
  if (index < 0) slides[(index = 0)].classList.add('is-active');
  let timer;
  const show = () => slides.forEach((s, n) => s.setAttribute('aria-hidden', String(n !== index)));
  const hold = () => Number(slides[index].dataset.hold || root.dataset.hold) || 6000;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => (document.hidden ? schedule() : next()), hold());
  };
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
    show();
    schedule();
  };
  show();
  schedule();
}
