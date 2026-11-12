import { $, esc, toast, modal, closeModal, useForm, errorHtml, field } from './ui.js';
import { TRACKS, clock } from './program.js';

const missingSql = (error) => (/PGRST20|program_items|could not find/i.test(`${error?.code} ${error?.message}`) ? new Error('Kør database/program.sql i Supabase først.') : error);

// Admin → Program: the day's program in its two parts. Changes show on the front page and the Charity Showkamp page at once.
export async function programAdminView(client, body, { refresh }) {
  const { data: items, error } = await client.from('program_items').select('*').order('starts_at', { ascending: true }).order('created_at', { ascending: true });
  if (error) {
    body.innerHTML = errorHtml(missingSql(error).message);
    return;
  }
  const row = (i, withPage) => `<tr>
      <td><strong class="lp-program-time">${clock(i.starts_at)}${i.ends_at ? `–${clock(i.ends_at)}` : ''}</strong></td>
      <td><strong>${esc(i.title)}</strong>${i.description ? `<br><span class="lp-help">${esc(i.description)}</span>` : ''}</td>
      ${withPage ? `<td>${i.on_showkamp_page ? '<span class="lp-pill lp-pill--outbid">Vises også</span>' : '<span class="lp-pill lp-pill--quiet">Kun forsiden</span>'}</td>` : ''}
      <td><div class="lp-row-actions"><button class="lp-btn--text" type="button" data-edit-item="${esc(i.id)}">Ret</button><button class="lp-btn--text" type="button" data-delete-item="${esc(i.id)}">Slet</button></div></td>
    </tr>`;
  const section = (track) => {
    const own = items.filter((i) => i.track === track);
    return `<section class="lp-program-admin lp-program-admin--${track}" aria-labelledby="program-${track}">
      <div class="lp-section-head">
        <div><h2 id="program-${track}" class="lp-program-admin__title">${TRACKS[track].name}</h2><p class="lp-help">${TRACKS[track].meta}</p></div>
        <button class="lp-btn lp-btn--secondary" type="button" data-add-item="${track}">Tilføj punkt</button>
      </div>
      ${own.length
        ? `<div class="lp-tablebox"><table class="lp-table lp-table--stack" style="min-width: 640px">
          <thead><tr><th scope="col" style="width: 150px">Tid</th><th scope="col">Punkt</th>${track === 'turnering' ? '<th scope="col" style="width: 150px">Showkamp-siden</th>' : ''}<th scope="col" style="width: 120px"><span class="sr-only">Handling</span></th></tr></thead>
          <tbody>${own.map((i) => row(i, track === 'turnering')).join('')}</tbody></table></div>`
        : '<div class="lp-empty"><p class="lp-text">Ingen punkter endnu.</p></div>'}
    </section>`;
  };
  body.innerHTML = `<div style="display: flex; flex-direction: column; gap: 40px">
    <p class="lp-help" style="max-width: 680px">Programmet vises på forsiden med de to dele side om side og på Charity Showkamp-siden. Punkter fra Charity Turnering kan også vises på Showkamp-siden, fx finalerne. Ændringer vises med det samme.</p>
    ${section('turnering')}
    ${section('showkamp')}
  </div>`;

  body.querySelectorAll('[data-add-item]').forEach((button) => (button.onclick = () => itemForm(client, { track: button.dataset.addItem }, refresh)));
  body.querySelectorAll('[data-edit-item]').forEach((button) => (button.onclick = () => itemForm(client, items.find((i) => i.id === button.dataset.editItem), refresh)));
  body.querySelectorAll('[data-delete-item]').forEach((button) => {
    button.onclick = () => {
      const item = items.find((i) => i.id === button.dataset.deleteItem);
      modal(`<h2 id="modal-title">Slet punkt?</h2>
        <p class="lp-text">${clock(item.starts_at)} · ${esc(item.title)}</p>
        <p class="lp-help">Punktet fjernes fra programmet på hele sitet.</p>
        <form id="delete-item-form" class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">Slet punkt</button><button class="lp-btn lp-btn--secondary" type="button" id="delete-item-keep">Behold</button></form>`);
      $('#delete-item-keep').onclick = closeModal;
      useForm($('#delete-item-form'), async () => {
        const { error: deleteError } = await client.rpc('delete_program_item', { p_id: item.id });
        if (deleteError) throw missingSql(deleteError);
        closeModal();
        await refresh();
        toast(`"${item.title}" er slettet fra programmet.`);
      });
    };
  });
}

function itemForm(client, item, refresh) {
  const isNew = !item.id;
  const shown = (track) => track === 'showkamp' || item.on_showkamp_page;
  modal(`<p class="lp-eyebrow" style="color: var(--red-text)">Program</p>
    <h2 id="modal-title">${isNew ? 'Tilføj punkt' : 'Ret punkt'}</h2>
    <form id="program-form" class="lp-form" style="gap: 16px">
      <fieldset class="lp-field" style="border: 0; padding: 0; margin: 0"><legend class="lp-label" style="margin-bottom: 8px; font-weight: 700">Del af dagen</legend>
        <div class="lp-actions">${Object.entries(TRACKS)
          .map(([key, t]) => `<label class="lp-check"><input type="radio" name="track" value="${key}" ${item.track === key ? 'checked' : ''}><span>${t.name}</span></label>`)
          .join('')}</div>
      </fieldset>
      <div class="lp-field-row">
        <div class="lp-field"><label for="pi-starts">Starttid</label><input id="pi-starts" class="lp-input" name="starts" value="${clock(item.starts_at)}" required placeholder="16.30" inputmode="decimal" pattern="([01]?[0-9]|2[0-3])[.:][0-5][0-9]" maxlength="5"></div>
        <div class="lp-field"><label for="pi-ends">Sluttid (valgfri)</label><input id="pi-ends" class="lp-input" name="ends" value="${clock(item.ends_at)}" placeholder="18.30" inputmode="decimal" pattern="([01]?[0-9]|2[0-3])[.:][0-5][0-9]" maxlength="5"><p class="lp-help">Vises som "· til 18.30".</p></div>
      </div>
      <div class="lp-field"><label for="pi-title">Titel</label><input id="pi-title" class="lp-input" name="title" value="${esc(item.title || '')}" required maxlength="80"></div>
      <div class="lp-field"><label for="pi-text">Tekst (valgfri)</label><textarea id="pi-text" class="lp-input" name="description" maxlength="300" rows="3">${esc(item.description || '')}</textarea></div>
      <label class="lp-check" id="pi-showkamp-row"><input type="checkbox" name="onShowkamp" ${shown(item.track) ? 'checked' : ''}><span>Vis også på Charity Showkamp-siden</span></label>
      <div class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">${isNew ? 'Tilføj punkt' : 'Gem ændringer'}</button><button class="lp-btn lp-btn--secondary" type="button" id="program-cancel">Fortryd</button></div>
    </form>`);
  $('#program-cancel').onclick = closeModal;
  // Showkamp items are always on the Showkamp page; only Turnering items need the choice.
  const form = $('#program-form');
  const syncShowkamp = () => ($('#pi-showkamp-row').hidden = form.elements.track.value === 'showkamp');
  form.querySelectorAll('[name=track]').forEach((input) => (input.onchange = syncShowkamp));
  syncShowkamp();
  useForm(form, async () => {
    const track = form.elements.track.value;
    const { error } = await client.rpc('save_program_item', {
      p_id: item.id || null,
      p_track: track,
      p_starts: field(form, 'starts'),
      p_ends: field(form, 'ends'),
      p_title: field(form, 'title'),
      p_description: field(form, 'description'),
      p_on_showkamp: track === 'showkamp' || form.elements.onShowkamp.checked,
    });
    if (error) throw missingSql(error);
    closeModal();
    await refresh();
    toast(isNew ? `"${field(form, 'title')}" er tilføjet programmet.` : `"${field(form, 'title')}" er rettet.`);
  });
}
