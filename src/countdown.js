// Countdown helpers. The browser clock is only used for display;
// the database decides whether a bid arrived in time.

function parts(value) {
  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const seconds = Math.floor(remaining / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}

// "3 d 14 t", "14 t 22 m" or "22 m 10 s" – used in cards and the bid panel.
export function countdownShort(value) {
  const p = parts(value);
  if (!p) return 'Slut';
  if (p.days) return `${p.days} d ${p.hours} t`;
  if (p.hours) return `${p.hours} t ${p.minutes} m`;
  return `${p.minutes} m ${p.seconds} s`;
}

// HTML for the red countdown bar: "03 dage 14 timer 22 min".
export function countdownBar(value) {
  const p = parts(value);
  if (!p) return '<p>Slut</p>';
  const pad = (n) => String(n).padStart(2, '0');
  if (p.days) return `<p>${pad(p.days)} <span>dage</span></p><p>${pad(p.hours)} <span>timer</span></p><p>${pad(p.minutes)} <span>min</span></p>`;
  return `<p>${pad(p.hours)} <span>timer</span></p><p>${pad(p.minutes)} <span>min</span></p><p>${pad(p.seconds)} <span>sek</span></p>`;
}

export function isOver(value) {
  return parts(value) === null;
}
