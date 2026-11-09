import { countdownBar } from './countdown.js';

// The test front page only needs the countdown to the event.
function tick() {
  document.querySelectorAll('[data-countdown="bar"]').forEach((el) => (el.innerHTML = countdownBar(el.dataset.ends)));
}
tick();
setInterval(tick, 1000);
