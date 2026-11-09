import { $, esc, money, toast, modal, closeModal, useForm, errorHtml } from './ui.js';

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
    <div class="lp-panel" style="gap: 10px; padding: 22px"><p class="lp-lot__meta">Rabatkoden "Rabat"</p><p style="margin: 0; font: 400 32px/1 var(--font-display)">${settings.coupon_active ? 'Aktiv' : 'Slået fra'}</p><div><button class="lp-btn lp-btn--secondary lp-btn--small" type="button" id="toggle-coupon" style="border-width: 3px">${settings.coupon_active ? 'Slå rabatkoden fra' : 'Slå rabatkoden til'}</button></div></div>
  </div>
  ${rows.length
    ? `<div class="lp-tablebox"><table class="lp-table">
      <thead><tr><th scope="col">Navn</th><th scope="col">Kontakt</th><th scope="col">Deltagelse</th><th scope="col" class="num">Betalt</th><th scope="col">Status</th><th scope="col">Oprettet</th><th scope="col"><span class="sr-only">Handling</span></th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
        <td><strong>${esc(r.full_name)}</strong>${r.partner_name ? `<br><span class="lp-help">& ${esc(r.partner_name)}</span>` : ''}<br><span class="lp-help">Ref. ${esc(r.id.slice(0, 8).toUpperCase())}</span></td>
        <td>${esc(r.email)}<br>${esc(r.phone)}<br><span class="lp-help">${esc(r.billing_address)}</span></td>
        <td>${r.kind === 'individual' ? 'Individuel · 1 plads' : 'Makkerpar · 2 pladser'}</td>
        <td class="num">${money(r.amount_due)}<br><span class="lp-help">${money(r.discount_amount)} rabat</span></td>
        <td>${r.status === 'confirmed' ? '<span class="lp-pill lp-pill--lead">Bekræftet</span>' : '<span class="lp-pill lp-pill--quiet">Annulleret</span>'}</td>
        <td>${new Date(r.created_at).toLocaleDateString('da-DK')}</td>
        <td>${r.status === 'confirmed' ? `<button class="lp-btn--text" type="button" data-cancel="${esc(r.id)}">Annuller</button>` : ''}</td>
      </tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="lp-empty"><p class="lp-text">Ingen tilmeldinger endnu. Nye tilmeldinger vises her, når mail og rabatkode er bekræftet.</p></div>'}`;

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
