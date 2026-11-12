// The day's program from the database (admins edit it under Admin → Program).
// The pages keep the program in their HTML as well, so it still shows if the database cannot be reached.

export const TRACKS = {
  turnering: { name: 'Charity Turnering', meta: 'Lukket · kun for deltagere', href: '/charity-turnering' },
  showkamp: { name: 'Charity Showkamp', meta: 'Åbent · op til 500 tilskuere · 200 kr.', href: '/charity-showkamp' },
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// "16:30:00" → "16.30"
export const clock = (value) => (value ? String(value).slice(0, 5).replace(':', '.') : '');
const title = (item) => `${esc(item.title)}${item.ends_at ? ` · til ${clock(item.ends_at)}` : ''}`;
const text = (item) => (item.description ? `<p class="lp-schedule__text">${esc(item.description)}</p>` : '');

export async function loadProgram() {
  try {
    const response = await fetch('/api/auction-config?context=participant');
    if (!response.ok) return [];
    const { url, key } = await response.json();
    const rest = new URL('/rest/v1/program_items', url);
    rest.search = 'select=*&order=starts_at.asc,created_at.asc';
    const result = await fetch(rest, { headers: { apikey: key } });
    const rows = result.ok ? await result.json() : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// The front page: one row per time, the two tracks side by side. A track's line runs from its first to its last item.
export function scheduleRows(items) {
  const times = [...new Set(items.map((i) => i.starts_at))].sort();
  const span = Object.fromEntries(
    Object.keys(TRACKS).map((track) => {
      const own = items.filter((i) => i.track === track).map((i) => i.starts_at).sort();
      return [track, own.length ? [own[0], own.at(-1)] : null];
    }),
  );
  const cell = (track, time) => {
    const here = items.filter((i) => i.track === track && i.starts_at === time);
    const range = span[track];
    if (here.length) {
      const end = range && time === range[1] && track === 'turnering' ? ' is-end' : '';
      return `<div role="cell" class="lp-schedule__cell is-${track}${end}">${here.map((i) => `<p class="lp-schedule__title">${title(i)}</p>${text(i)}`).join('')}</div>`;
    }
    if (range && time > range[0] && time < range[1]) return `<div role="cell" class="lp-schedule__cell is-${track} is-empty"></div>`;
    return '<div role="cell" class="lp-schedule__cell"></div>';
  };
  return times
    .map((time) => `<div class="lp-schedule__row" role="row"><span role="cell" class="lp-schedule__time">${clock(time)}</span>${cell('turnering', time)}${cell('showkamp', time)}</div>`)
    .join('');
}

// The Charity Showkamp page: its own items and those marked for it, as one list.
export function showkampTimeline(items) {
  return items
    .filter((i) => i.track === 'showkamp' || i.on_showkamp_page)
    .map(
      (i) =>
        `<div><dt>${clock(i.starts_at)}</dt><dd>${i.track === 'turnering' ? '<p class="lp-schedule__lane-meta">Charity Turnering</p>' : ''}<p class="lp-step__title">${title(i)}</p>${i.description ? `<p class="lp-step__text">${esc(i.description)}</p>` : ''}</dd></div>`,
    )
    .join('');
}

// Fills [data-program="schedule"] and [data-program="showkamp"] on the page.
export async function mountProgram() {
  const targets = document.querySelectorAll('[data-program]');
  if (!targets.length) return;
  const items = await loadProgram();
  if (!items.length) return;
  targets.forEach((el) => {
    if (el.dataset.program === 'schedule') {
      el.querySelectorAll('.lp-schedule__row:not(.lp-schedule__head)').forEach((row) => row.remove());
      el.insertAdjacentHTML('beforeend', scheduleRows(items));
    } else if (el.dataset.program === 'showkamp') {
      const html = showkampTimeline(items);
      if (html) el.innerHTML = html;
    }
  });
}
