import { $, esc, money, toast, modal, closeModal, useForm, errorHtml, downloadCsv, field, paymentChecks, bindPaymentChecks, yesDate } from './ui.js';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
// Cancelled registrations are hidden from the list until the admin asks to see them.
let showCancelled = false;
const SETTLEMENT = { invoice: 'Faktura', discount: 'Rabatkode', invited: 'Inviteret' };
const missingSql = (error, file) => (/PGRST202|could not find/i.test(`${error.code} ${error.message}`) ? new Error(`Kør database/${file} i Supabase først.`) : error);

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
  const header = ['Reference', 'Status', 'Deltagelse', 'Pris', 'Afregning', 'Faktura sendt', 'Betalt', 'Navn', 'Titel på websitet', 'T-shirt', 'Virksomhed', 'Makker', 'Makkers titel', 'Makkers T-shirt', 'Makkers virksomhed', 'Må vises på websitet', 'Mail', 'Telefon', 'Faktureringsadresse', 'Oprettet'];
  const data = rows.map((r) => [r.id.slice(0, 8).toUpperCase(), r.status === 'confirmed' ? 'Bekræftet' : 'Annulleret', r.kind === 'pair' ? 'Makkerpar' : 'Individuel', r.amount_due, SETTLEMENT[r.settlement] || r.settlement, yesDate(r.invoice_sent_at), yesDate(r.paid_at), r.full_name, r.public_title, r.shirt_size, r.company, r.partner_name, r.partner_public_title, r.partner_shirt_size, r.partner_company, r.publish_consent ? 'Ja' : 'Nej', r.email, r.phone, r.billing_address, new Date(r.created_at).toLocaleDateString('da-DK')]);
  downloadCsv('lykke-padel-tilmeldinger.csv', header, data);
}

// The line under a name: website title and company, without the company when the title already names it.
const subline = (title, company) => {
  const parts = [title, company && !(title || '').toLowerCase().includes(company.toLowerCase()) ? company : null].filter(Boolean);
  return parts.length ? `<br><span class="lp-help">${parts.map(esc).join(' · ')}</span>` : '';
};

// Seats taken and left, e.g. "Tilmeldte 12 / 70 · 58 tilbage".
const seatPanel = (label, taken, capacity, help) => {
  const left = Math.max(capacity - taken, 0);
  return `<div class="lp-panel" style="gap: 6px; padding: 22px"><p class="lp-lot__meta">${label}</p><p style="margin: 0; font: 400 48px/1 var(--font-display)">${taken} / ${capacity}</p><p style="margin: 0; font: 700 15px var(--font-body); color: ${left ? 'var(--ink)' : 'var(--red-text)'}">${left ? `${left} ${left === 1 ? 'plads' : 'pladser'} tilbage` : 'Fuldt'}</p><p class="lp-help">${help}</p></div>`;
};

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

  const cancelled = rows.filter((r) => r.status !== 'confirmed').length;
  const shown = showCancelled ? rows : rows.filter((r) => r.status === 'confirmed');
  body.innerHTML = `
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px">
    ${'invited_capacity' in settings
      ? `${seatPanel('Tilmeldte', settings.paid_taken, settings.capacity, 'Betalende og rabatkode. Makkerpar tæller som to pladser.')}
    ${seatPanel('Inviterede', settings.invited_taken, settings.invited_capacity, `Reserveret til inviterede spillere. I alt ${settings.seats_taken} af ${settings.total_capacity} pladser.`)}`
      : `<div class="lp-panel" style="gap: 6px; padding: 22px"><p class="lp-lot__meta">Tilmeldte pladser</p><p style="margin: 0; font: 400 48px/1 var(--font-display)">${settings.seats_taken} / ${settings.capacity}</p><p class="lp-help">Kør database/seats-96.sql for at dele pladserne i tilmeldte og inviterede.</p></div>`}
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
  <div class="lp-section-head" style="margin-bottom: 16px"><p class="lp-help">T-shirt, virksomhed og samtykke vælger deltagerne selv ved tilmelding og på Min side. Inviterede spillere tilmelder du her, og de betaler ikke.</p><div class="lp-actions"><button class="lp-btn lp-btn--primary" type="button" id="invite-player">Tilmeld inviteret spiller</button>${rows.length ? '<button class="lp-btn lp-btn--secondary" type="button" id="export-registrations">Download (CSV)</button>' : ''}</div></div>
  ${cancelled ? `<label class="lp-check lp-check--small" style="margin-bottom: 12px"><input type="checkbox" id="show-cancelled" ${showCancelled ? 'checked' : ''}><span>Vis annullerede (${cancelled})</span></label>` : ''}
  ${shown.length
    ? `
    <div class="lp-tablebox"><table class="lp-table lp-table--stack">
      <thead><tr><th scope="col">Navn</th><th scope="col">Kontakt</th><th scope="col">Deltagelse</th><th scope="col">T-shirt</th><th scope="col">Website</th><th scope="col">Betaling</th><th scope="col">Status</th><th scope="col">Oprettet</th><th scope="col"><span class="sr-only">Handling</span></th></tr></thead>
      <tbody>${shown
        .map(
          (r) => `<tr>
        <td><strong>${esc(r.full_name)}</strong>${subline(r.public_title, r.company)}${r.partner_name ? `<br><strong>& ${esc(r.partner_name)}</strong>${subline(r.partner_public_title, r.partner_company)}` : ''}<br><span class="lp-help">Ref. ${esc(r.id.slice(0, 8).toUpperCase())}</span></td>
        <td>${[r.email, r.phone].filter(Boolean).map(esc).join('<br>') || '<span class="lp-help">Ingen kontakt</span>'}${r.billing_address ? `<br><span class="lp-help">${esc(r.billing_address)}</span>` : ''}</td>
        <td>${r.kind === 'individual' ? 'Individuel · 1 plads' : 'Makkerpar · 2 pladser'}</td>
        <td>${[r.shirt_size, ...(r.kind === 'pair' ? [r.partner_shirt_size] : [])].map((size) => (size ? esc(size) : '<span class="lp-help">–</span>')).join(' / ')}</td>
        <td>${r.publish_consent ? '<span class="lp-pill lp-pill--outbid">Vises</span>' : '<span class="lp-pill lp-pill--quiet">Skjult</span>'}</td>
        <td>${r.settlement === 'invoice' ? `<strong>${money(r.amount_due)}</strong>${'paid_at' in r && r.status === 'confirmed' ? paymentChecks(r.id, r) : ''}` : r.settlement === 'invited' ? `<span class="lp-pill lp-pill--live">Inviteret</span><br><span class="lp-help">Gratis</span>` : `${money(0)}<br><span class="lp-help">Rabatkode</span>`}</td>
        <td>${r.status === 'confirmed' ? '<span class="lp-pill lp-pill--lead">Bekræftet</span>' : '<span class="lp-pill lp-pill--quiet">Annulleret</span>'}</td>
        <td>${new Date(r.created_at).toLocaleDateString('da-DK')}</td>
        <td><div class="lp-row-actions"><button class="lp-btn--text" type="button" data-edit-registration="${esc(r.id)}">Ret</button>${r.status === 'confirmed' ? `<button class="lp-btn--text" type="button" data-cancel="${esc(r.id)}">Annuller</button>` : `<button class="lp-btn--text" type="button" data-delete-registration="${esc(r.id)}">Slet</button>`}</div></td>
      </tr>`,
        )
        .join('')}</tbody></table></div>`
    : `<div class="lp-empty"><p class="lp-text">${rows.length ? 'Ingen aktive tilmeldinger.' : 'Ingen tilmeldinger endnu. Nye tilmeldinger vises her, når mailen er bekræftet.'}</p></div>`}`;

  $('#show-cancelled')?.addEventListener('change', (event) => {
    showCancelled = event.currentTarget.checked;
    refresh();
  });

  $('#invite-player').onclick = () => playerForm(client, null, refresh);

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
    button.onclick = () => playerForm(client, rows.find((row) => row.id === button.dataset.editRegistration), refresh);
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

// One form for both a new invited player (r = null) and correcting an existing registration.
// A paying participant's mail is their login and the kind sets the price, so neither can be changed.
function playerForm(client, r, refresh) {
  const isNew = !r;
  const invited = isNew || r.settlement === 'invited';
  const sizeField = (id, name, label, value) =>
    `<div class="lp-field"><label for="${id}">${label}</label><select id="${id}" class="lp-input" name="${name}"><option value="">Ikke valgt</option>${SIZES.map((size) => `<option ${size === value ? 'selected' : ''}>${size}</option>`).join('')}</select></div>`;
  const text = (id, name, label, value, extra = '', help = '') =>
    `<div class="lp-field"><label for="${id}">${label}</label><input id="${id}" class="lp-input" name="${name}" value="${esc(value || '')}" ${extra}>${help ? `<p class="lp-help">${help}</p>` : ''}</div>`;
  const partnerFields = (v = {}) => `${text('er-partner', 'partner', 'Makkers navn', v.partner_name, 'required minlength="2" maxlength="120"')}
      ${text('er-ptitle', 'partnerTitle', 'Makkers titel på websitet', v.partner_public_title, 'maxlength="80"')}
      <div class="lp-field-row">${sizeField('er-pshirt', 'partnerShirt', 'Makkers T-shirt', v.partner_shirt_size)}${text('er-pcompany', 'partnerCompany', 'Makkers virksomhed', v.partner_company, 'maxlength="120"')}</div>`;
  const v = r || {};
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">${isNew ? 'Inviteret spiller · gratis' : `${r.kind === 'pair' ? 'Makkerpar' : 'Individuel'}${invited ? ' · Inviteret' : ''} · Ref. ${esc(r.id.slice(0, 8).toUpperCase())}`}</p>
    <h2 id="modal-title">${isNew ? 'Tilmeld inviteret spiller' : 'Ret tilmelding'}</h2>
    <form id="player-form" class="lp-form" style="gap: 16px">
      ${isNew ? `<div class="lp-field"><label for="er-kind">Deltagelse</label><select id="er-kind" class="lp-input" name="kind"><option value="individual">Individuel · 1 plads</option><option value="pair">Makkerpar · 2 pladser</option></select></div>` : ''}
      <div class="lp-field-row">${text('er-name', 'name', 'Navn', v.full_name, 'required minlength="2" maxlength="120"')}${text('er-title', 'title', 'Titel på websitet', v.public_title, 'maxlength="80" placeholder="Fx Stifter af NORMAL"')}</div>
      <div class="lp-field-row">${invited ? text('er-email', 'email', 'Mail (valgfri)', v.email, 'type="email" maxlength="254"') : `<div class="lp-field"><label for="er-email">Mail</label><input id="er-email" class="lp-input" value="${esc(v.email)}" readonly><p class="lp-help">Mailen er deltagerens login.</p></div>`}${text('er-phone', 'phone', invited ? 'Telefon (valgfri)' : 'Telefon', v.phone, `${invited ? '' : 'required '}maxlength="30" type="tel"`)}</div>
      ${invited && isNew ? '' : `<div class="lp-field"><label for="er-address">${invited ? 'Adresse (valgfri)' : 'Faktureringsadresse'}</label><textarea id="er-address" class="lp-input" name="address" ${invited ? '' : 'required minlength="5"'} maxlength="500">${esc(v.billing_address || '')}</textarea></div>`}
      <div class="lp-field-row">${sizeField('er-shirt', 'shirt', 'T-shirt', v.shirt_size)}${text('er-company', 'company', 'Virksomhed', v.company, 'maxlength="120"')}</div>
      <div id="er-partner-fields">${!isNew && r.kind === 'pair' ? partnerFields(v) : ''}</div>
      <label class="lp-check"><input type="checkbox" name="publish" ${v.publish_consent ? 'checked' : ''}><span>Må vises på websitet under "Seneste tilmeldte spillere" og nævnes i promovering</span></label>
      <p class="lp-help">Under navnet vises titlen, eller virksomheden hvis der ikke er en titel.</p>
      <div class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">${isNew ? 'Tilmeld spiller' : 'Gem ændringer'}</button><button class="lp-btn lp-btn--secondary" type="button" id="player-cancel">Fortryd</button></div>
    </form>`);
  $('#player-cancel').onclick = closeModal;
  const kind = $('#er-kind');
  if (kind) kind.onchange = () => ($('#er-partner-fields').innerHTML = kind.value === 'pair' ? partnerFields() : '');
  useForm($('#player-form'), async (form) => {
    const pair = isNew ? kind.value === 'pair' : r.kind === 'pair';
    const common = {
      p_name: field(form, 'name'),
      p_title: field(form, 'title'),
      p_phone: field(form, 'phone'),
      p_partner: pair ? field(form, 'partner') : null,
      p_partner_title: pair ? field(form, 'partnerTitle') : null,
      p_shirt: field(form, 'shirt') || null,
      p_partner_shirt: pair ? field(form, 'partnerShirt') || null : null,
      p_company: field(form, 'company'),
      p_partner_company: pair ? field(form, 'partnerCompany') : null,
      p_publish: form.querySelector('[name=publish]').checked,
    };
    const { error } = isNew
      ? await client.rpc('admin_add_invited_registration', { p_kind: kind.value, p_email: field(form, 'email'), ...common })
      : await client.rpc('admin_update_registration', { p_id: r.id, p_address: field(form, 'address'), p_email: invited ? field(form, 'email') : null, ...common });
    if (error) throw missingSql(error, 'invited-players.sql');
    closeModal();
    await refresh();
    toast(isNew ? `${common.p_name} er tilmeldt som inviteret spiller.` : `Tilmeldingen for ${common.p_name} er rettet.`);
  });
}
