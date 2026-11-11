import { $, esc, money, toast, modal, closeModal, useForm, errorHtml, downloadCsv, field, paymentChecks, bindPaymentChecks, yesDate } from './ui.js';

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
  const header = ['Reference', 'Status', 'Deltagelse', 'Pris', 'Afregning', 'Faktura sendt', 'Betalt', 'Navn', 'T-shirt', 'Virksomhed', 'Makker', 'Makkers T-shirt', 'Makkers virksomhed', 'Må nævnes i promovering', 'Mail', 'Telefon', 'Faktureringsadresse', 'Oprettet'];
  const data = rows.map((r) => [r.id.slice(0, 8).toUpperCase(), r.status === 'confirmed' ? 'Bekræftet' : 'Annulleret', r.kind === 'pair' ? 'Makkerpar' : 'Individuel', r.amount_due, r.settlement === 'invoice' ? 'Faktura' : 'Rabatkode', yesDate(r.invoice_sent_at), yesDate(r.paid_at), r.full_name, r.shirt_size, r.company, r.partner_name, r.partner_shirt_size, r.partner_company, r.publish_consent ? 'Ja' : 'Nej', r.email, r.phone, r.billing_address, new Date(r.created_at).toLocaleDateString('da-DK')]);
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
    ${rows.some((r) => 'paid_at' in r) ? (() => {
      const billable = rows.filter((r) => r.status === 'confirmed' && r.settlement === 'invoice');
      const unpaid = billable.filter((r) => !r.paid_at);
      return `<div class="lp-panel" style="gap: 6px; padding: 22px"><p class="lp-lot__meta">Mangler betaling</p><p style="margin: 0; font: 400 48px/1 var(--font-display)">${money(unpaid.reduce((sum, r) => sum + r.amount_due, 0))}</p><p class="lp-help">${billable.length - unpaid.length} af ${billable.length} fakturerede tilmeldinger er betalt. ${billable.filter((r) => !r.invoice_sent_at).length} mangler faktura.</p></div>`;
    })() : ''}
    ${'shirt_size' in (rows[0] || { shirt_size: null }) ? (() => {
      const { counts, missing } = shirtCounts(rows);
      return `<div class="lp-panel" style="gap: 10px; padding: 22px"><p class="lp-lot__meta">T-shirts</p><p style="margin: 0; font: 600 16px/1.6 var(--font-body)">${SIZES.filter((size) => counts[size]).map((size) => `${size}: ${counts[size]}`).join(' · ') || 'Ingen valgt endnu'}</p>${missing ? `<p class="lp-help">${missing} ${missing === 1 ? 'spiller mangler' : 'spillere mangler'} at vælge.</p>` : ''}</div>`;
    })() : ''}
    <div class="lp-panel" style="gap: 10px; padding: 22px"><p class="lp-lot__meta">Rabatkoden "Rabat"</p><p style="margin: 0; font: 400 32px/1 var(--font-display)">${settings.coupon_active ? 'Aktiv' : 'Slået fra'}</p><div><button class="lp-btn lp-btn--secondary lp-btn--small" type="button" id="toggle-coupon" style="border-width: 3px">${settings.coupon_active ? 'Slå rabatkoden fra' : 'Slå rabatkoden til'}</button></div></div>
  </div>
  ${rows.length
    ? `<div class="lp-section-head" style="margin-bottom: 16px"><p class="lp-help">T-shirt, virksomhed og samtykke vælger deltagerne selv ved tilmelding og på Min side.</p><button class="lp-btn lp-btn--secondary" type="button" id="export-registrations">Download tilmeldinger (CSV)</button></div>
    <div class="lp-tablebox"><table class="lp-table">
      <thead><tr><th scope="col">Navn</th><th scope="col">Kontakt</th><th scope="col">Deltagelse</th><th scope="col">T-shirt og synlighed</th><th scope="col">Betaling</th><th scope="col">Status</th><th scope="col">Oprettet</th><th scope="col"><span class="sr-only">Handling</span></th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
        <td><strong>${esc(r.full_name)}</strong>${r.partner_name ? `<br><span class="lp-help">& ${esc(r.partner_name)}</span>` : ''}<br><span class="lp-help">Ref. ${esc(r.id.slice(0, 8).toUpperCase())}</span></td>
        <td>${esc(r.email)}<br>${esc(r.phone)}<br><span class="lp-help">${esc(r.billing_address)}</span></td>
        <td>${r.kind === 'individual' ? 'Individuel · 1 plads' : 'Makkerpar · 2 pladser'}</td>
        <td>${'shirt_size' in r ? `${r.shirt_size ? esc(r.shirt_size) : '<span class="lp-help">Ingen størrelse</span>'}${r.kind === 'pair' ? ` / ${r.partner_shirt_size ? esc(r.partner_shirt_size) : '<span class="lp-help">–</span>'}` : ''}${r.company ? `<br>${esc(r.company)}` : ''}${r.partner_company ? `<br><span class="lp-help">& ${esc(r.partner_company)}</span>` : ''}<br><span class="lp-help">${r.publish_consent ? 'Må nævnes' : 'Må ikke nævnes'}</span>` : '<span class="lp-help">–</span>'}</td>
        <td>${r.settlement === 'invoice' ? `<strong>${money(r.amount_due)}</strong>${'paid_at' in r && r.status === 'confirmed' ? paymentChecks(r.id, r) : ''}` : `${money(0)}<br><span class="lp-help">Rabatkode</span>`}</td>
        <td>${r.status === 'confirmed' ? '<span class="lp-pill lp-pill--lead">Bekræftet</span>' : '<span class="lp-pill lp-pill--quiet">Annulleret</span>'}</td>
        <td>${new Date(r.created_at).toLocaleDateString('da-DK')}</td>
        <td><div class="lp-row-actions"><button class="lp-btn--text" type="button" data-edit-registration="${esc(r.id)}">Ret</button>${r.status === 'confirmed' ? `<button class="lp-btn--text" type="button" data-cancel="${esc(r.id)}">Annuller</button>` : `<button class="lp-btn--text" type="button" data-delete-registration="${esc(r.id)}">Slet</button>`}</div></td>
      </tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="lp-empty"><p class="lp-text">Ingen tilmeldinger endnu. Nye tilmeldinger vises her, når mail og rabatkode er bekræftet.</p></div>'}`;

  bindPaymentChecks(body, async (id, values) => {
    const { error: payError } = await client.rpc('set_registration_payment', { p_id: id, p_invoice_sent: null, p_paid: null, ...values });
    if (payError) throw payError;
    const row = rows.find((r) => r.id === id);
    if ('p_invoice_sent' in values) row.invoice_sent_at = values.p_invoice_sent ? new Date().toISOString() : null;
    if ('p_paid' in values) row.paid_at = values.p_paid ? new Date().toISOString() : null;
  });

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

  body.querySelectorAll('[data-edit-registration]').forEach((button) => {
    button.onclick = () => editRegistration(client, rows.find((row) => row.id === button.dataset.editRegistration), refresh);
  });

  body.querySelectorAll('[data-delete-registration]').forEach((button) => {
    button.onclick = () => {
      const r = rows.find((row) => row.id === button.dataset.deleteRegistration);
      modal(`<h2 id="modal-title">Slet tilmelding?</h2>
        <p class="lp-text">${esc(r.full_name)}${r.partner_name ? ` & ${esc(r.partner_name)}` : ''} · annulleret</p>
        <p class="lp-help">Tilmeldingen fjernes for altid fra oversigten. Personens budprofil og login påvirkes ikke.</p>
        <form id="delete-registration-form" class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">Slet tilmelding</button><button class="lp-btn lp-btn--secondary" type="button" id="delete-registration-keep">Behold</button></form>`);
      $('#delete-registration-keep').onclick = closeModal;
      useForm($('#delete-registration-form'), async () => {
        const { error: deleteError } = await client.rpc('delete_event_registration', { p_id: r.id });
        if (deleteError) throw /PGRST202|could not find/i.test(`${deleteError.code} ${deleteError.message}`) ? new Error('Kør database/delete-people.sql i Supabase først.') : deleteError;
        closeModal();
        await refresh();
        toast('Tilmeldingen er slettet.');
      });
    };
  });
}

// Admin correction of a participant: contact, partner, T-shirt sizes, company and consent.
// The mail is the login and the kind sets the price, so they are shown but cannot be changed.
function editRegistration(client, r, refresh) {
  const pair = r.kind === 'pair';
  const sizeField = (id, name, label, value) =>
    `<div class="lp-field"><label for="${id}">${label}</label><select id="${id}" class="lp-input" name="${name}"><option value="">Ikke valgt</option>${SIZES.map((size) => `<option ${size === value ? 'selected' : ''}>${size}</option>`).join('')}</select></div>`;
  const text = (id, name, label, value, extra = '') =>
    `<div class="lp-field"><label for="${id}">${label}</label><input id="${id}" class="lp-input" name="${name}" value="${esc(value || '')}" ${extra}></div>`;
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">${pair ? 'Makkerpar' : 'Individuel'} · Ref. ${esc(r.id.slice(0, 8).toUpperCase())}</p>
    <h2 id="modal-title">Ret tilmelding</h2>
    <form id="edit-registration-form" class="lp-form" style="gap: 16px">
      <div class="lp-field-row">${text('er-name', 'name', 'Navn', r.full_name, 'required minlength="2" maxlength="120"')}${text('er-phone', 'phone', 'Telefon', r.phone, 'required maxlength="30" type="tel"')}</div>
      <div class="lp-field"><label for="er-email">Mail</label><input id="er-email" class="lp-input" value="${esc(r.email)}" readonly><p class="lp-help">Mailen er deltagerens login og kan ikke rettes her.</p></div>
      <div class="lp-field"><label for="er-address">Faktureringsadresse</label><textarea id="er-address" class="lp-input" name="address" required minlength="5" maxlength="500">${esc(r.billing_address)}</textarea></div>
      <div class="lp-field-row">${sizeField('er-shirt', 'shirt', 'T-shirt', r.shirt_size)}${text('er-company', 'company', 'Virksomhed', r.company, 'maxlength="120"')}</div>
      ${pair ? `${text('er-partner', 'partner', 'Makkers navn', r.partner_name, 'required minlength="2" maxlength="120"')}
      <div class="lp-field-row">${sizeField('er-pshirt', 'partnerShirt', 'Makkers T-shirt', r.partner_shirt_size)}${text('er-pcompany', 'partnerCompany', 'Makkers virksomhed', r.partner_company, 'maxlength="120"')}</div>` : ''}
      <label class="lp-check"><input type="checkbox" name="publish" ${r.publish_consent ? 'checked' : ''}><span>Må nævnes i promovering</span></label>
      <div class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">Gem ændringer</button><button class="lp-btn lp-btn--secondary" type="button" id="edit-registration-cancel">Fortryd</button></div>
    </form>`);
  $('#edit-registration-cancel').onclick = closeModal;
  useForm($('#edit-registration-form'), async (form) => {
    const { error } = await client.rpc('admin_update_registration', {
      p_id: r.id,
      p_name: field(form, 'name'),
      p_phone: field(form, 'phone'),
      p_address: field(form, 'address'),
      p_partner: pair ? field(form, 'partner') : null,
      p_shirt: field(form, 'shirt') || null,
      p_partner_shirt: pair ? field(form, 'partnerShirt') || null : null,
      p_company: field(form, 'company'),
      p_partner_company: pair ? field(form, 'partnerCompany') : null,
      p_publish: form.querySelector('[name=publish]').checked,
    });
    if (error) throw /PGRST202|could not find/i.test(`${error.code} ${error.message}`) ? new Error('Kør database/admin-edit-registration.sql i Supabase først.') : error;
    closeModal();
    await refresh();
    toast(`Tilmeldingen for ${field(form, 'name')} er rettet.`);
  });
}
