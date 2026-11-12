// The latest registered players, newest first. Shown in the red bar on the front page and the tournament page.
export const LATEST_PLAYERS = [
  { name: 'Torben Mouritzen', title: 'Stifter af NORMAL' },
  { name: 'Rikke Nielsen', title: 'Stifter af LykkeLiga' },
];

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const playerHtml = (p) => `<strong>${esc(p.name)}</strong><span>${esc(p.title)}</span>`;

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
