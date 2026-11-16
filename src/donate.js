// "Støt LykkeLiga" – a floating button in the bottom right corner that opens a small card for a gift with MobilePay.
// Shown on the public pages, not in admin or the scanner.
import { qrSvg } from './qr.js';

// The MobilePay number is not ready yet. Until it is set, the button shows a test message instead of opening MobilePay.
// When the number arrives: set it here and pick the link that fits the agreement (MobilePay Box or MyShop).
export const MOBILEPAY = { number: null };
const payLink = (amount) => (MOBILEPAY.number ? `https://qr.mobilepay.dk/box/${encodeURIComponent(MOBILEPAY.number)}/pay-in?amount=${amount}` : null);

const AMOUNTS = [100, 200, 500, 1000];
const MIN = 10;
const MAX = 50000;
const kr = (value) => `${new Intl.NumberFormat('da-DK').format(value)} kr.`;
const heart = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 21s-7.5-4.6-9.6-9.4C.9 8.1 3 4.5 6.6 4.5c2.1 0 3.5 1.1 4.4 2.5.9-1.4 2.3-2.5 4.4-2.5 3.6 0 5.7 3.6 4.2 7.1C19.5 16.4 12 21 12 21z" fill="currentColor"/></svg>';

export function mountDonate() {
  if (/^\/(admin|administration|scan)\/?$/.test(location.pathname) || document.querySelector('.lp-donate')) return;
  let amount = 200;
  const root = document.createElement('div');
  root.className = 'lp-donate';
  root.innerHTML = `
    <section class="lp-donate__panel" id="donate-panel" role="dialog" aria-modal="false" aria-labelledby="donate-title" hidden>
      <button class="lp-donate__close" type="button" aria-label="Luk">×</button>
      <p class="lp-donate__eyebrow">${heart}<span>Hele beløbet går til LykkeLiga</span></p>
      <h2 class="lp-donate__title" id="donate-title">Støt LykkeLiga</h2>
      <p class="lp-donate__text">Giv et valgfrit beløb til fællesskabet for børn og unge med funktionsnedsættelser.</p>
      <div class="lp-donate__amounts" role="group" aria-label="Vælg beløb">
        ${AMOUNTS.map((a) => `<button class="lp-donate__amount" type="button" data-amount="${a}" aria-pressed="${a === amount}">${kr(a)}</button>`).join('')}
      </div>
      <label class="lp-donate__custom"><span>Andet beløb</span><span class="lp-donate__field"><input type="number" inputmode="numeric" min="${MIN}" max="${MAX}" step="1" placeholder="Fx 250" aria-describedby="donate-error"><span aria-hidden="true">kr.</span></span></label>
      <p class="lp-donate__error" id="donate-error" role="alert"></p>
      <a class="lp-donate__pay" href="#" rel="noopener">Støt med MobilePay · <span data-donate-sum>${kr(amount)}</span></a>
      <div class="lp-donate__qr" hidden></div>
      <p class="lp-donate__result" role="status" aria-live="polite"></p>
    </section>
    <button class="lp-donate__toggle" type="button" aria-expanded="false" aria-controls="donate-panel">${heart}<span>Støt LykkeLiga</span></button>`;
  document.body.append(root);

  const $ = (selector) => root.querySelector(selector);
  const panel = $('.lp-donate__panel');
  const toggle = $('.lp-donate__toggle');
  const input = $('input');
  const error = $('.lp-donate__error');
  const result = $('.lp-donate__result');
  const pay = $('.lp-donate__pay');

  const valid = () => Number.isInteger(amount) && amount >= MIN && amount <= MAX;
  const update = () => {
    root.querySelectorAll('[data-amount]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === amount && !input.value)));
    $('[data-donate-sum]').textContent = valid() ? kr(amount) : '–';
    pay.classList.toggle('is-disabled', !valid());
    result.textContent = '';
    $('.lp-donate__qr').hidden = true;
  };
  const open = (show) => {
    panel.hidden = !show;
    root.classList.toggle('is-open', show);
    toggle.setAttribute('aria-expanded', String(show));
    if (show) requestAnimationFrame(() => root.querySelector('[aria-pressed="true"]')?.focus());
    else toggle.focus();
  };

  toggle.onclick = () => open(panel.hidden);
  $('.lp-donate__close').onclick = () => open(false);
  root.addEventListener('keydown', (event) => event.key === 'Escape' && !panel.hidden && open(false));
  document.addEventListener('click', (event) => !panel.hidden && !root.contains(event.target) && open(false));

  root.querySelectorAll('[data-amount]').forEach((button) => {
    button.onclick = () => {
      amount = Number(button.dataset.amount);
      input.value = '';
      error.textContent = '';
      update();
    };
  });
  input.oninput = () => {
    amount = input.value ? Math.round(Number(input.value)) : 200;
    error.textContent = input.value && !valid() ? `Vælg et beløb mellem ${kr(MIN)} og ${kr(MAX)}.` : '';
    update();
  };

  pay.onclick = (event) => {
    if (!valid()) {
      event.preventDefault();
      error.textContent = `Vælg et beløb mellem ${kr(MIN)} og ${kr(MAX)}.`;
      return;
    }
    const link = payLink(amount);
    if (!link) {
      event.preventDefault();
      result.innerHTML = `<strong>Testvisning.</strong> Her åbner MobilePay med ${kr(amount)}, når LykkeLigas MobilePay-nummer er sat op.`;
      return;
    }
    // On a computer, show a QR code to scan with the phone instead of trying to open the app.
    if (!matchMedia('(hover: none)').matches) {
      event.preventDefault();
      const qr = $('.lp-donate__qr');
      qr.innerHTML = `${qrSvg(link, { label: `QR-kode til MobilePay, ${kr(amount)}` })}<p>Scan med din telefon for at åbne MobilePay.</p>`;
      qr.hidden = false;
      return;
    }
    pay.href = link;
  };
}
