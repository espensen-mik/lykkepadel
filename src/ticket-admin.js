import { $, esc, money, toast, modal, closeModal, errorHtml, errorMessage, downloadCsv } from './ui.js';

// Admin tab: ticket orders for Charity Showkamp, receipts, cancelling and check-in at the door.
// Scanning a ticket's QR code opens /admin#billet/<code>, which checks the ticket in straight away.

const STATUS = { paid: 'Betalt', pending: 'Afventer betaling', cancelled: 'Annulleret', expired: 'Udløbet' };
const receiptNo = (o) => (o.receipt_no == null ? '–' : o.is_test ? `TEST-${String(o.receipt_no).padStart(4, '0')}` : `LP-${new Date(o.paid_at).getFullYear()}-${String(o.receipt_no).padStart(4, '0')}`);
const time = (value) => new Date(value).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' });

function resultHtml(r) {
  const who = r.buyer_name ? `${esc(r.buyer_name)}${r.company_name ? ` · ${esc(r.company_name)}` : ''} · ${r.checked_in} af ${r.quantity} tjekket ind` : '';
  const views = {
    ok: ['is-ok', 'Velkommen', who],
    used: ['is-bad', 'Allerede brugt', `Tjekket ind ${time(r.checked_in_at)}. ${who}`],
    void: ['is-bad', 'Annulleret billet', who],
    test: ['is-warn', 'Testbillet', `Giver ikke adgang. ${who}`],
    unknown: ['is-bad', 'Ukendt billet', 'Koden findes ikke. Tjek, at den er skrevet rigtigt.'],
    undone: ['is-warn', 'Tjek ind fortrudt', who],
  };
  const [cls, title, text] = views[r.result] || views.unknown;
  return `<div class="lp-checkin__result ${cls}" role="status"><strong>${title}</strong>${esc(r.code)}${text ? ` · ${text}` : ''}
    ${r.result === 'ok' ? `<div style="margin-top: 12px"><button class="lp-btn lp-btn--secondary lp-btn--small" type="button" data-undo="${esc(r.code)}" style="background: #fff">Fortryd</button></div>` : ''}</div>`;
}

export async function ticketAdminView(client, body, { refresh, code } = {}) {
  const [orders, info] = await Promise.all([
    client.from('ticket_orders').select('*, tickets(code, status, checked_in_at)').order('created_at', { ascending: false }),
    client.rpc('ticket_info'),
  ]);
  if (orders.error || info.error) {
    const missing = /ticket_orders|ticket_info|PGRST20/.test(`${(orders.error || info.error).code} ${(orders.error || info.error).message}`);
    body.innerHTML = missing ? '<div class="lp-empty"><p class="lp-text">Kør database/tickets.sql i Supabase for at slå billetsalget til.</p></div>' : errorHtml((orders.error || info.error).message);
    return;
  }
  const rows = orders.data;
  const settings = info.data;
  const real = rows.filter((o) => !o.is_test && o.status === 'paid');
  const sold = real.reduce((sum, o) => sum + o.quantity, 0);
  const checkedIn = real.flatMap((o) => o.tickets).filter((t) => t.checked_in_at).length;

  body.innerHTML = `
  ${settings.test_mode ? '<div class="lp-notice" style="margin-bottom: 24px"><span><strong>Testtilstand.</strong> Køb betales ikke rigtigt, og billetterne giver ikke adgang. Betaling med QuickPay slås til, når aftalen er klar.</span></div>' : ''}
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 32px">
    <div class="lp-panel" style="gap: 6px; padding: 22px"><p class="lp-lot__meta">Solgte billetter</p><p style="margin: 0; font: 400 48px/1 var(--font-display)">${sold} / ${settings.capacity}</p><p class="lp-help">${settings.remaining} tilbage, inkl. reservationer.</p></div>
    <div class="lp-panel" style="gap: 6px; padding: 22px"><p class="lp-lot__meta">Billetsalg</p><p style="margin: 0; font: 400 48px/1 var(--font-display)">${money(real.reduce((sum, o) => sum + o.amount, 0))}</p><p class="lp-help">${real.length} betalte ordrer. Testkøb tæller ikke med.</p></div>
    <div class="lp-panel" style="gap: 6px; padding: 22px"><p class="lp-lot__meta">Tjekket ind</p><p style="margin: 0; font: 400 48px/1 var(--font-display)">${checkedIn} / ${sold}</p><p class="lp-help">Scan billettens QR-kode med telefonens kamera.</p></div>
  </div>
  <section class="lp-checkin" aria-labelledby="checkin-title" style="margin-bottom: 32px">
    <h2 id="checkin-title" style="margin: 0; font: 800 20px var(--font-body)">Tjek billet ind</h2>
    <form id="checkin-form" class="lp-actions" style="align-items: flex-end">
      <div class="lp-field" style="flex: 1 1 220px"><label for="checkin-code">Billetkode</label><input id="checkin-code" class="lp-input" name="code" autocomplete="off" autocapitalize="characters" placeholder="AB12-CD34" maxlength="9" required></div>
      <button class="lp-btn lp-btn--primary" type="submit">Tjek ind</button>
    </form>
    <div id="checkin-result" aria-live="polite"></div>
  </section>
  ${rows.length
    ? `<div class="lp-section-head" style="margin-bottom: 16px"><p class="lp-help">Kvitteringen gælder som faktura. Annullering refunderer ikke automatisk.</p><button class="lp-btn lp-btn--secondary" type="button" id="export-tickets">Download ordrer (CSV)</button></div>
    <div class="lp-tablebox"><table class="lp-table">
      <thead><tr><th scope="col">Kvittering</th><th scope="col">Køber</th><th scope="col" class="num">Billetter</th><th scope="col" class="num">Beløb</th><th scope="col">Status</th><th scope="col">Købt</th><th scope="col"><span class="sr-only">Handling</span></th></tr></thead>
      <tbody>${rows
        .map(
          (o) => `<tr>
        <td><strong>${receiptNo(o)}</strong>${o.is_test ? '<br><span class="lp-pill lp-pill--quiet">Test</span>' : ''}</td>
        <td><strong>${esc(o.buyer_name)}</strong><br>${esc(o.email)}${o.phone ? `<br>${esc(o.phone)}` : ''}${o.company_name ? `<br><span class="lp-help">${esc(o.company_name)} · CVR ${esc(o.company_cvr)}</span>` : ''}</td>
        <td class="num">${o.quantity}${o.status === 'paid' ? `<br><span class="lp-help">${o.tickets.filter((t) => t.checked_in_at).length} tjekket ind</span>` : ''}</td>
        <td class="num">${money(o.amount)}</td>
        <td><span class="lp-pill ${o.status === 'paid' ? 'lp-pill--lead' : 'lp-pill--quiet'}">${STATUS[o.status]}</span>${o.status === 'paid' ? `<br><span class="lp-help">${o.receipt_sent_at ? 'Kvittering sendt' : 'Kvittering ikke sendt'}</span>` : ''}</td>
        <td>${time(o.created_at)}</td>
        <td><div class="lp-row-actions">${o.status === 'paid' ? `<button class="lp-btn--text" type="button" data-receipt="${esc(o.id)}">Send kvittering</button>` : ''}${['paid', 'pending'].includes(o.status) ? `<button class="lp-btn--text" type="button" data-cancel-order="${esc(o.id)}">Annuller</button>` : ''}</div></td>
      </tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="lp-empty"><p class="lp-text">Ingen billetkøb endnu.</p></div>'}`;

  const checkIn = async (value, undo = false) => {
    const target = $('#checkin-result');
    try {
      const { data, error } = await client.rpc('check_in_ticket', { p_code: value, p_undo: undo });
      if (error) throw error;
      target.innerHTML = resultHtml(data);
      target.querySelector('[data-undo]')?.addEventListener('click', (event) => checkIn(event.currentTarget.dataset.undo, true));
    } catch (error) {
      target.innerHTML = errorHtml(errorMessage(error));
    }
  };
  $('#checkin-form').onsubmit = async (event) => {
    event.preventDefault();
    const input = $('#checkin-code');
    await checkIn(input.value.trim().toUpperCase());
    input.value = '';
    input.focus();
  };
  if (code) {
    await checkIn(code);
    $('#checkin-title').scrollIntoView({ block: 'start' });
  }

  $('#export-tickets')?.addEventListener('click', () => {
    const header = ['Kvittering', 'Status', 'Test', 'Købt', 'Betalt', 'Navn', 'Mail', 'Telefon', 'Firma', 'CVR', 'Firmaadresse', 'Antal', 'Stykpris', 'Beløb', 'Billetkoder', 'Tjekket ind'];
    downloadCsv('lykke-padel-billetter.csv', header, rows.map((o) => [receiptNo(o), STATUS[o.status], o.is_test ? 'Ja' : 'Nej', time(o.created_at), o.paid_at ? time(o.paid_at) : '', o.buyer_name, o.email, o.phone, o.company_name, o.company_cvr, o.company_address, o.quantity, o.unit_price, o.amount, o.tickets.map((t) => t.code).join(' '), o.tickets.filter((t) => t.checked_in_at).length]));
  });

  body.querySelectorAll('[data-receipt]').forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        const { data } = await client.auth.getSession();
        const response = await fetch('/api/ticket-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
          body: JSON.stringify({ order: button.dataset.receipt }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Kvitteringen kunne ikke sendes.');
        toast(`Kvitteringen er sendt til ${result.to}.`);
      } catch (error) {
        toast(errorMessage(error));
      } finally {
        button.disabled = false;
      }
    };
  });

  body.querySelectorAll('[data-cancel-order]').forEach((button) => {
    button.onclick = () => {
      const o = rows.find((row) => row.id === button.dataset.cancelOrder);
      modal(`<h2 id="modal-title">Annuller ordre?</h2>
        <p class="lp-text">${esc(o.buyer_name)} · ${o.quantity} ${o.quantity === 1 ? 'billet' : 'billetter'} · ${money(o.amount)}</p>
        <p class="lp-help">Billetterne bliver ugyldige ved indgangen. ${o.status === 'paid' && !o.is_test ? 'Pengene betales ikke tilbage automatisk – refunder beløbet i QuickPay.' : ''}</p>
        <div class="lp-actions"><button class="lp-btn lp-btn--primary" type="button" id="cancel-order-yes">Annuller ordren</button><button class="lp-btn lp-btn--secondary" type="button" id="cancel-order-no">Behold</button></div>`);
      $('#cancel-order-no').onclick = closeModal;
      $('#cancel-order-yes').onclick = async () => {
        $('#cancel-order-yes').disabled = true;
        const { error } = await client.rpc('cancel_ticket_order', { p_id: o.id });
        closeModal();
        if (error) return toast(errorMessage(error));
        await refresh();
        toast('Ordren er annulleret.');
      };
    };
  });
}
