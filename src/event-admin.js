import { $, esc, money, toast, modal, closeModal, useForm, errorHtml, downloadCsv } from './ui.js';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

// T-shirts to order: every confirmed player, partners included.
function shirtCounts(rows) {
  const counts = Object.fromEntries(SIZES.map((size) => [size, 0]));
  let missing = 0;
  for (const r of rows.filter((row) => row.status === 'confirmed')) {
    for (const size of r.kind === 'pair' ? [r.shirt_size, r.partner_shirt_size] : [r.shirt_size]) {
      if (size in counts) counts[size]++;
      else missing++;
    }
  }
  return { counts, missing };
}

function exportRegistrations(rows) {
  const header = ['Reference', 'Status', 'Deltagelse', 'Navn', 'T-shirt', 'Virksomhed', 'Makker', 'Makkers T-shirt', 'Makkers virksomhed', 'Må nævnes i promovering', 'Mail', 'Telefon', 'Faktureringsadresse', 'Oprettet'];
  const data = rows.map((r) => [r.id.slice(0, 8).toUpperCase(), r.status === 'confirmed' ? 'Bekræftet' : 'Annulleret', r.kind === 'pair' ? 'Makkerpar' : 'Individuel', r.full_name, r.shirt_size, r.company, r.partner_name, r.partner_shirt_size, r.partner_company, r.publish_consent ? 'Ja' : 'Nej', r.email, r.phone, r.billing_address, new Date(r.created_at).toLocaleDateString('da-DK')]);
  downloadCsv('lykke-padel-tilmeldinger.csv', header, data);
}

// Admin tab: event registrations, capacity and the temporary discount code.
export async function eventAdminView(client, { refresh }) {
  const body = $('#admin-body');
  const [{ data: rows, error }, { data: settings, error: settingsError }] = await Promise.all([
    client.from('event_registrations').select('*').order('created_at', { ascending: false }),
    client.rpc('event_admin_settings'),
  ]);
  if (error || settingsError) {
    body.innerHTML = errorHtml((error || settingsError).message);
    return;
  }

  body.innerHTML = `
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 32px">
    <div class="lp-panel" style="gap: 6px; padding: 22px"><p class="lp-lot__meta">Tilmeldte pladser</p><p style="margin: 0; font: 400 48px/1 var(--font-display)">${settings.seats_taken} / ${settings.capacity}</p><p class="lp-help">Makkerpar tæller som to pladser.</p></div>
    ${'shirt_size' in (rows[0] || { shirt_size: null }) ? (() => {
      const { counts, missing } = shirtCounts(rows);
      return `<div class="lp-panel" style="gap: 10px; padding: 22px"><p class="lp-lot__meta">T-shirts</p><p style="margin: 0; font: 600 16px/1.6 var(--font-body)">${SIZES.filter((size) => counts[size]).map((size) => `${size}: ${counts[size]}`).join(' · ') || 'Ingen valgt endnu'}</p>${missing ? `<p class="lp-help">${missing} ${missing === 1 ? 'spiller mangler' : 'spillere mangler'} at vælge.</p>` : ''}</div>`;
    })() : ''}
    <div class="lp-panel" style="gap: 10px; padding: 22px"><p class="lp-lot__meta">Rabatkoden "Rabat"</p><p style="margin: 0; font: 400 32px/1 var(--font-display)">${settings.coupon_active ? 'Aktiv' : 'Slået fra'}</p><div><button class="lp-btn lp-btn--secondary lp-btn--small" type="button" id="toggle-coupon" style="border-width: 3px">${settings.coupon_active ? 'Slå rabatkoden fra' : 'Slå rabatkoden til'}</button></div></div>
  </div>
  ${rows.length
    ? `<div class="lp-section-head" style="margin-bottom: 16px"><p class="lp-help">T-shirt, virksomhed og samtykke vælger deltagerne selv ved tilmelding og på Min side.</p><button class="lp-btn lp-btn--secondary" type="button" id="export-registrations">Download tilmeldinger (CSV)</button></div>
    <div class="lp-tablebox"><table class="lp-table">
      <thead><tr><th scope="col">Navn</th><th scope="col">Kontakt</th><th scope="col">Deltagelse</th><th scope="col">T-shirt og synlighed</th><th scope="col" class="num">Betalt</th><th scope="col">Status</th><th scope="col">Oprettet</th><th scope="col"><span class="sr-only">Handling</span></th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
        <td><strong>${esc(r.full_name)}</strong>${r.partner_name ? `<br><span class="lp-help">& ${esc(r.partner_name)}</span>` : ''}<br><span class="lp-help">Ref. ${esc(r.id.slice(0, 8).toUpperCase())}</span></td>
        <td>${esc(r.email)}<br>${esc(r.phone)}<br><span class="lp-help">${esc(r.billing_address)}</span></td>
        <td>${r.kind === 'individual' ? 'Individuel · 1 plads' : 'Makkerpar · 2 pladser'}</td>
        <td>${'shirt_size' in r ? `${r.shirt_size ? esc(r.shirt_size) : '<span class="lp-help">Ingen størrelse</span>'}${r.kind === 'pair' ? ` / ${r.partner_shirt_size ? esc(r.partner_shirt_size) : '<span class="lp-help">–</span>'}` : ''}${r.company ? `<br>${esc(r.company)}` : ''}${r.partner_company ? `<br><span class="lp-help">& ${esc(r.partner_company)}</span>` : ''}<br><span class="lp-help">${r.publish_consent ? 'Må nævnes' : 'Må ikke nævnes'}</span>` : '<span class="lp-help">–</span>'}</td>
        <td class="num">${money(r.amount_due)}<br><span class="lp-help">${money(r.discount_amount)} rabat</span></td>
        <td>${r.status === 'confirmed' ? '<span class="lp-pill lp-pill--lead">Bekræftet</span>' : '<span class="lp-pill lp-pill--quiet">Annulleret</span>'}</td>
        <td>${new Date(r.created_at).toLocaleDateString('da-DK')}</td>
        <td>${r.status === 'confirmed' ? `<button class="lp-btn--text" type="button" data-cancel="${esc(r.id)}">Annuller</button>` : ''}</td>
      </tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="lp-empty"><p class="lp-text">Ingen tilmeldinger endnu. Nye tilmeldinger vises her, når mail og rabatkode er bekræftet.</p></div>'}`;

  const exportButton = $('#export-registrations');
  if (exportButton) exportButton.onclick = () => exportRegistrations(rows);

  $('#toggle-coupon').onclick = async (event) => {
    event.currentTarget.disabled = true;
    const { error: toggleError } = await client.rpc('event_admin_settings', { p_coupon: !settings.coupon_active });
    if (toggleError) {
      toast(toggleError.message);
      event.currentTarget.disabled = false;
      return;
    }
    await refresh();
  };

  body.querySelectorAll('[data-cancel]').forEach((button) => {
    button.onclick = () => {
      const r = rows.find((row) => row.id === button.dataset.cancel);
      modal(`<h2 id="modal-title">Annuller tilmelding?</h2>
        <p class="lp-text">${esc(r.full_name)} · ${r.seats} ${r.seats === 1 ? 'plads' : 'pladser'}</p>
        <p class="lp-help">Tilmeldingen bliver i oversigten, men pladserne frigives, og budadgangen fjernes. Eksisterende bud slettes ikke.</p>
        <form id="cancel-form" class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">Annuller tilmelding</button><button class="lp-btn lp-btn--secondary" type="button" id="cancel-keep">Behold</button></form>`);
      $('#cancel-keep').onclick = closeModal;
      useForm($('#cancel-form'), async () => {
        const { error: cancelError } = await client.rpc('cancel_event_registration', { p_id: r.id });
        if (cancelError) throw cancelError;
        closeModal();
        await refresh();
        toast('Tilmeldingen er annulleret.');
      });
    };
  });
}
