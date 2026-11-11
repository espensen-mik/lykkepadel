import { $, esc, money, field, errorHtml, errorMessage } from './ui.js';
import { qrSvg } from './qr.js';
import { SELLER, EVENT, receiptNote } from './ticket-receipt.js';

// Tickets for Charity Showkamp. /billetter is the shop, /billet#<order>.<token> shows the bought tickets.
// Buyers don't log in: the secret token in the link gives access to the order.
const main = $('#main');
const viewPage = /^\/billet\/?$/.test(location.pathname);
const TERMS = 'tickets-v1';
let api;
let info;

async function connect() {
  const response = await fetch('/api/auction-config?context=participant');
  if (!response.ok) throw new Error('Billetsalget er ikke åbent endnu.');
  const { url, key } = await response.json();
  api = async (name, args = {}) => {
    const result = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await result.json().catch(() => null);
    if (!result.ok) throw new Error(/PGRST202|could not find/i.test(`${data?.code} ${data?.message}`) ? 'Billetsalget er ikke åbent endnu.' : data?.message || 'Noget gik galt. Prøv igen.');
    return data;
  };
}

function progress(step) {
  return `<ol class="lp-progress" aria-label="Trin">${['Billetter', 'Betaling', 'Dine billetter']
    .map((name, i) => `<li class="${i + 1 === step ? 'is-current' : i + 1 < step ? 'is-done' : ''}" ${i + 1 === step ? 'aria-current="step"' : ''}><b>${i + 1}</b>${name}</li>`)
    .join('')}</ol>`;
}

function shell(step, title, intro = '') {
  main.innerHTML = `<div class="lp-wrap" style="padding-block: 48px var(--space-9); display: flex; flex-direction: column; gap: 32px">
    ${progress(step)}
    <div class="lp-heading"><h1 class="lp-display lp-display--m">${title}</h1>${intro}</div>
    <div id="ticket-content"></div>
  </div>`;
  window.scrollTo(0, 0);
  return $('#ticket-content');
}

const testNotice = () =>
  info?.test_mode
    ? '<div class="lp-notice"><span><strong>Testtilstand.</strong> Betaling er ikke åbnet endnu. Du kan prøve hele købet, men der trækkes ingen penge, og testbilletter giver ikke adgang.</span></div>'
    : '';

function summaryPanel(quantity, title = 'Din ordre') {
  return `<aside class="lp-panel" style="flex: 1 1 320px" aria-label="${title}">
    <p style="margin: 0; font: 400 32px/1 var(--font-display)">${title}</p>
    <dl class="lp-summary">
      <div><dt>${quantity} × billet til ${EVENT.name}</dt><dd>${money(quantity * info.price)}</dd></div>
      <div class="is-total"><dt>I alt</dt><dd id="ticket-total">${money(quantity * info.price)}</dd></div>
    </dl>
    <p class="lp-help">${EVENT.date} · Dørene åbner ${EVENT.doors} · ${EVENT.place}. ${receiptNote}</p>
  </aside>`;
}

// Step 1: number of tickets and buyer details.
function shop(draft = { quantity: 1 }) {
  const content = shell(1, 'Billetter til Charity Showkamp', `<p class="lp-lead" style="max-width: 720px">Padel i verdensklasse og ren LykkeLiga-energi. ${money(info.price)} pr. person – hele beløbet går til LykkeLiga.</p>`);
  if (!info.sales_open || (!info.test_mode && info.remaining < 1)) {
    content.innerHTML = `<div class="lp-empty"><p class="lp-text">${info.sales_open ? 'Der er ikke flere billetter.' : 'Billetsalget er lukket.'}</p><a class="lp-btn lp-btn--primary" href="/charity-showkamp">Tilbage til Charity Showkamp</a></div>`;
    return;
  }
  const max = info.test_mode ? info.max_per_order : Math.min(info.max_per_order, info.remaining);
  content.innerHTML = `${testNotice()}<div class="lp-split" style="margin-top: 24px">
    <form id="ticket-form" class="lp-form" style="flex: 999 1 520px" novalidate>
      <div class="lp-field"><label for="tk-qty">Antal billetter</label>
        <div class="lp-stepper" style="max-width: 280px">
          <button class="lp-stepper__btn" type="button" id="qty-down" aria-label="Færre billetter"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>
          <input id="tk-qty" class="lp-input" name="quantity" type="number" inputmode="numeric" min="1" max="${max}" value="${draft.quantity}" required>
          <button class="lp-stepper__btn" type="button" id="qty-up" aria-label="Flere billetter"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4v12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>
        </div>
        <p class="lp-help">Højst ${max} pr. køb. Hver person får sin egen billet med QR-kode.</p>
      </div>
      <div class="lp-field-row">
        <div class="lp-field"><label for="tk-name">Fulde navn</label><input id="tk-name" class="lp-input" name="name" autocomplete="name" minlength="2" maxlength="120" value="${esc(draft.name)}" required></div>
        <div class="lp-field"><label for="tk-phone">Telefon <span class="lp-help">(valgfri)</span></label><input id="tk-phone" class="lp-input" name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(draft.phone)}"></div>
      </div>
      <div class="lp-field"><label for="tk-email">Mail</label><input id="tk-email" class="lp-input" name="email" type="email" autocomplete="email" maxlength="254" value="${esc(draft.email)}" required><p class="lp-help">Billetterne og kvitteringen sendes hertil.</p></div>
      <label class="lp-check"><input type="checkbox" id="tk-company-toggle" ${draft.company ? 'checked' : ''}><span>Jeg køber til en virksomhed og vil have firmanavn og CVR på kvitteringen</span></label>
      <div id="tk-company" class="lp-fieldset" ${draft.company ? '' : 'hidden'}>
        <div class="lp-field-row">
          <div class="lp-field"><label for="tk-cname">Firmanavn</label><input id="tk-cname" class="lp-input" name="company" autocomplete="organization" maxlength="120" value="${esc(draft.company)}"></div>
          <div class="lp-field"><label for="tk-cvr">CVR-nummer</label><input id="tk-cvr" class="lp-input" name="cvr" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" value="${esc(draft.cvr)}"></div>
        </div>
        <div class="lp-field"><label for="tk-caddress">Firmaadresse</label><textarea id="tk-caddress" class="lp-input" name="address" autocomplete="street-address" maxlength="500">${esc(draft.address)}</textarea></div>
      </div>
      <label class="lp-check"><input type="checkbox" name="terms" ${draft.terms ? 'checked' : ''}><span>Jeg accepterer <a href="/handelsbetingelser" target="_blank">handelsbetingelserne</a> og har læst <a href="/privatlivspolitik" target="_blank">privatlivspolitikken</a>.</span></label>
      <div><button class="lp-btn lp-btn--primary lp-btn--large" type="submit">Gå til betaling</button></div>
    </form>
    <div id="ticket-summary" style="flex: 1 1 320px; display: flex">${summaryPanel(draft.quantity)}</div>
  </div>`;

  const qty = $('#tk-qty');
  const clamp = (value) => Math.min(max, Math.max(1, Math.round(Number(value) || 1)));
  const update = () => ($('#ticket-summary').innerHTML = summaryPanel(clamp(qty.value)));
  $('#qty-down').onclick = () => {
    qty.value = clamp(qty.value - 1);
    update();
  };
  $('#qty-up').onclick = () => {
    qty.value = clamp(Number(qty.value) + 1);
    update();
  };
  qty.oninput = update;
  qty.onchange = () => {
    qty.value = clamp(qty.value);
    update();
  };
  $('#tk-company-toggle').onchange = (event) => ($('#tk-company').hidden = !event.target.checked);

  const form = $('#ticket-form');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    form.querySelector('.lp-error')?.remove();
    button.disabled = true;
    try {
      const company = $('#tk-company-toggle').checked;
      const next = {
        quantity: clamp(qty.value),
        name: field(form, 'name'),
        email: field(form, 'email'),
        phone: field(form, 'phone'),
        company: company ? field(form, 'company') : '',
        cvr: company ? field(form, 'cvr').replace(/\s/g, '') : '',
        address: company ? field(form, 'address') : '',
        terms: form.querySelector('[name=terms]').checked,
      };
      if (next.name.length < 2) throw new Error('Udfyld dit navn.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new Error('Udfyld en gyldig mailadresse.');
      if (company && (next.company.length < 2 || !/^\d{8}$/.test(next.cvr) || next.address.length < 5)) throw new Error('Udfyld firmanavn, CVR-nummer (8 cifre) og firmaadresse.');
      if (!next.terms) throw new Error('Accepter handelsbetingelserne for at købe.');
      const order = await api('create_ticket_order', {
        p_quantity: next.quantity,
        p_name: next.name,
        p_email: next.email,
        p_phone: next.phone,
        p_company: next.company,
        p_cvr: next.cvr,
        p_address: next.address,
        p_terms: TERMS,
      });
      if (!order.is_test) throw new Error('Betaling er ikke åbnet endnu. Prøv igen senere.');
      checkout(order, next);
    } catch (error) {
      form.insertAdjacentHTML('beforeend', errorHtml(errorMessage(error)));
    } finally {
      button.disabled = false;
    }
  };
}

// Step 2: the payment. Until QuickPay is connected, a clearly marked test payment.
function checkout(order, draft) {
  const content = shell(2, 'Betaling');
  content.innerHTML = `<div class="lp-split">
    <section class="lp-panel" style="flex: 999 1 520px; gap: 20px" aria-labelledby="pay-title">
      <p class="lp-eyebrow" style="color: var(--red-text)">Testbetaling</p>
      <h2 id="pay-title" class="lp-display lp-display--s" style="color: var(--ink)">Betal ${money(order.amount)}</h2>
      <p class="lp-text">Her kommer betalingsvinduet med kort og MobilePay, når betaling åbner. Indtil da kan du gennemføre købet som en test. Der trækkes ingen penge, og testbilletter giver ikke adgang ved indgangen.</p>
      <p class="lp-help">Ordren er reserveret i 30 minutter.</p>
      <div class="lp-actions">
        <button class="lp-btn lp-btn--primary lp-btn--large" type="button" id="pay-test">Gennemfør testbetaling</button>
        <button class="lp-btn lp-btn--secondary lp-btn--large" type="button" id="pay-cancel">Tilbage</button>
      </div>
      <div id="pay-error"></div>
    </section>
    ${summaryPanel(order.quantity)}
  </div>`;
  $('#pay-cancel').onclick = () => shop(draft);
  $('#pay-test').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    $('#pay-error').innerHTML = '';
    try {
      await api('pay_test_ticket_order', { p_id: order.id, p_token: order.token });
      // The receipt mail must not hold up the tickets; the ticket page works either way.
      fetch('/api/ticket-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: order.id, token: order.token }) }).catch(() => {});
      location.assign(`/billet#${order.id}.${order.token}`);
    } catch (error) {
      $('#pay-error').innerHTML = errorHtml(errorMessage(error));
      button.disabled = false;
    }
  };
}

const ticketUrl = (code) => `${location.origin}/admin#billet/${code}`;
const kr = (value) => money(value);
const date = (value) => new Date(value).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen' });

// Step 3: the tickets and the receipt.
async function showOrder() {
  const [id, token] = location.hash.slice(1).split('.');
  if (!id || !token) {
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">Linket er ikke komplet</h1><p class="lp-text">Brug linket fra din kvitteringsmail.</p><a class="lp-btn lp-btn--primary" href="/billetter">Køb billetter</a></div></div>`;
    return;
  }
  const order = await api('ticket_order', { p_id: id, p_token: token });
  document.title = 'Dine billetter – Lykke Padel';
  if (order.status !== 'paid') {
    const text = { pending: 'Betalingen er ikke gennemført endnu.', expired: 'Ordren er udløbet, fordi betalingen ikke blev gennemført.', cancelled: 'Ordren er annulleret, og billetterne er ugyldige.' }[order.status];
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">Ingen gyldige billetter</h1><p class="lp-text">${text}</p><a class="lp-btn lp-btn--primary" href="/billetter">Køb billetter</a></div></div>`;
    return;
  }
  const content = shell(3, order.quantity === 1 ? 'Din billet' : 'Dine billetter', `<p class="lp-lead">${EVENT.name} · ${EVENT.date} · Dørene åbner ${EVENT.doors} · ${EVENT.place}</p>`);
  const tickets = order.tickets
    .map(
      (t, i) => `<article class="lp-ticket ${t.status === 'void' ? 'is-void' : ''}" aria-label="Billet ${i + 1} af ${order.tickets.length}">
      <div class="lp-ticket__qr">${qrSvg(ticketUrl(t.code), { label: `QR-kode til billet ${t.code}` })}</div>
      <div class="lp-ticket__info">
        <p class="lp-eyebrow">${t.is_test ? 'Testbillet · giver ikke adgang' : `Billet ${i + 1} af ${order.tickets.length}`}</p>
        <p class="lp-ticket__name">${EVENT.name}</p>
        <p class="lp-ticket__code">${esc(t.code)}</p>
        <p class="lp-help">${t.status === 'void' ? 'Annulleret' : t.checked_in_at ? 'Brugt ved indgangen' : '1 person · gyldig én gang'}</p>
      </div>
    </article>`,
    )
    .join('');
  content.innerHTML = `${order.is_test ? '<div class="lp-notice"><span><strong>Testkøb.</strong> Der er ikke trukket penge, og billetterne giver ikke adgang.</span></div>' : ''}
  <p class="lp-text" style="margin: 24px 0">Vis billetterne på din telefon ved indgangen. Hver billet kan bruges én gang. Del ikke linket til denne side med andre end dem, du har købt billetter til.</p>
  <div class="lp-tickets">${tickets}</div>
  <div class="lp-actions lp-noprint" style="margin-top: 24px"><button class="lp-btn lp-btn--secondary" type="button" id="print">Udskriv billetter og kvittering</button></div>
  <section class="lp-receipt" aria-labelledby="receipt-title">
    <h2 id="receipt-title" class="lp-display lp-display--s" style="color: var(--ink)">Kvittering</h2>
    <div class="lp-receipt__grid">
      <div><p class="lp-lot__meta">Sælger</p><p>${SELLER.name}<br>${SELLER.address}<br>CVR ${SELLER.cvr}<br>${SELLER.email}</p></div>
      <div><p class="lp-lot__meta">Køber</p><p>${esc(order.buyer_name)}<br>${esc(order.email)}${order.company_name ? `<br>${esc(order.company_name)}<br>CVR ${esc(order.company_cvr)}<br><span style="white-space: pre-line">${esc(order.company_address)}</span>` : ''}</p></div>
      <div><p class="lp-lot__meta">Kvittering</p><p>Nr. ${esc(order.receipt)}<br>${date(order.paid_at)}<br>${order.is_test ? 'Testbetaling – intet beløb trukket' : 'Betalt med kort/MobilePay'}</p></div>
    </div>
    <dl class="lp-summary">
      <div><dt>${order.quantity} × billet til ${EVENT.name} à ${kr(order.unit_price)}</dt><dd>${kr(order.amount)}</dd></div>
      <div class="is-total"><dt>I alt</dt><dd>${kr(order.amount)}</dd></div>
    </dl>
    <p class="lp-help">${receiptNote}</p>
  </section>`;
  $('#print').onclick = () => window.print();
}

async function start() {
  try {
    await connect();
    if (viewPage) return await showOrder();
    info = await api('ticket_info');
    shop();
  } catch (error) {
    main.innerHTML = `<div class="lp-wrap lp-section"><div class="lp-empty"><h1 class="lp-display lp-display--s">${viewPage ? 'Billetterne kunne ikke vises' : 'Billetsalget er ikke åbent endnu'}</h1>${errorHtml(errorMessage(error))}<a class="lp-btn lp-btn--primary" href="/charity-showkamp">Til Charity Showkamp</a></div></div>`;
  }
}

start();
