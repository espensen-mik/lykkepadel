import { packages, validateRegistration } from './registration.js';
import { $, esc, money, field, errorHtml, errorMessage, setHeader, modal, closeModal, useForm, toast } from './ui.js';
import { mountMyBids } from './my-bids.js';

// Registration (/tilmelding) and the participant page (/deltager), backed by Supabase.
const DRAFT_KEY = 'lykke-event-draft-v2';
const INCLUDES = 'turnering, forplejning, T-shirt og goodiebag, præmier, networking, synlighed i forbindelse med eventet samt VIP-adgang til Charity Showkamp';
const LABELS = { individual: 'Individuel', pair: 'Makkerpar' };
const DESCRIPTIONS = {
  individual:
    'Du køber én plads i turneringen, og vi matcher dig med en makker på dit niveau. Du kan desuden byde på padelmakkerne i Lykke Auktion, hvor du kan vinde en professionel eller kendt profil som makker.',
  pair: 'I tilmelder jer som fast makkerpar og spiller hele turneringen sammen. I kan repræsentere én virksomhed eller gå sammen på tværs af to, og I bliver præsenteret som officielt makkerpar. Makkerpar kan byde på charity-produkterne i Lykke Auktion, men ikke på padelmakkere.',
};

let client;
let currentUser;
let main;
let draft = { type: 'individual' };
let quote;

function saveDraft() {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

// Disable the submit button while the action runs and show errors below the form.
function formAction(selector, action) {
  $(selector).onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    form.querySelector('.lp-error')?.remove();
    try {
      await action(form);
    } catch (error) {
      form.insertAdjacentHTML('beforeend', errorHtml(errorMessage(error)));
    } finally {
      button.disabled = false;
    }
  };
}

const PROFILE_STEPS = ['Mail', 'Kode', 'Dine oplysninger'];

// Where to go after login or a new profile, e.g. back to the lot the user wanted to bid on.
const NEXT = (() => {
  const next = new URLSearchParams(location.search).get('next') || '';
  return next.startsWith('/auktion') && !next.startsWith('//') ? next : '';
})();

function progress(step, names = ['Deltagelse', 'Oplysninger', 'Bekræft']) {
  return `<ol class="lp-progress" aria-label="Trin">${names
    .map((name, i) => {
      const n = i + 1;
      const state = n < step ? 'is-done' : n === step ? 'is-current' : '';
      return `<li class="${state}" ${n === step ? 'aria-current="step"' : ''}><b>${n}</b>${name}</li>`;
    })
    .join('')}</ol>`;
}

function shell(step, title, { back, names } = {}) {
  main.innerHTML = `<div class="lp-wrap" style="padding-block: 48px var(--space-9); display: flex; flex-direction: column; gap: 36px">
    ${back ? `<a class="lp-back" href="${back.href}" id="shell-back">← ${back.label}</a>` : ''}
    ${step ? progress(step, names) : ''}
    <h1 class="lp-display lp-display--m">${title}</h1>
    <div id="event-content"></div>
  </div>`;
  window.scrollTo(0, 0);
  return $('#event-content');
}

export async function mountEvent(connectedClient, { participant = false } = {}) {
  client = connectedClient;
  main = $('#main');
  document.title = participant ? 'Min side – Lykke Padel' : 'Tilmelding – Lykke Padel';
  setHeader();
  const params = new URLSearchParams(location.search);
  if (participant && params.has('logout')) {
    await client.auth.signOut();
    history.replaceState(null, '', '/deltager');
    return login({ loggedOut: true });
  }
  const { data, error } = await client.auth.getUser();
  currentUser = error ? null : data.user;
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || draft;
  } catch {}
  const preferred = new URLSearchParams(location.search).get('type');
  if (preferred === 'individual' || preferred === 'pair') draft.type = preferred;
  if (currentUser) {
    const { data: rows, error: loadError } = await client.from('event_registrations').select('*').eq('user_id', currentUser.id);
    if (loadError) throw loadError;
    if (rows.length) return NEXT && participant ? location.assign(NEXT) : receipt(rows[0]);
    if (participant) return participantHome();
    draft.email = currentUser.email;
  }
  if (participant) return login();
  choose();
}

// Step 1: choose individual or pair.
function choose() {
  const content = shell(1, 'En plads på banen.<br>En forskel for andre.');
  content.innerHTML = `<form id="choose-event" class="lp-form" style="gap: 32px">
    <fieldset style="border: 0; margin: 0; padding: 0">
      <legend style="padding: 0; margin-bottom: 20px; font: 800 22px var(--font-body)">Hvordan vil du deltage?</legend>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 24px">
        ${Object.entries(packages)
          .map(
            ([key, p]) => `<label class="lp-choice ${draft.type === key ? 'is-selected' : ''}">
          <input type="radio" name="type" value="${key}" ${draft.type === key ? 'checked' : ''}>
          <span class="lp-price__meta" ${key === 'pair' ? 'style="color: var(--ink-muted)"' : ''}>${key === 'individual' ? '1 spiller · kan byde på makkere' : '2 spillere · fast makkerpar'}</span>
          <span class="lp-price__name" style="font-size: 44px">${LABELS[key]}</span>
          <span class="lp-price__amount">${money(p.price)}</span>
          <span style="font-size: 16px; line-height: 1.55">${DESCRIPTIONS[key]}</span>
        </label>`,
          )
          .join('')}
      </div>
    </fieldset>
    <div class="lp-section-head" style="padding-top: 24px; border-top: 2px solid var(--ink)">
      <p class="lp-text" style="font-size: 16px; max-width: 760px"><strong>Begge inkluderer:</strong> ${INCLUDES}.</p>
      <button class="lp-btn lp-btn--primary lp-btn--large" type="submit">Fortsæt</button>
    </div>
    <p class="lp-help">Allerede tilmeldt? <a href="/deltager">Gå til Min side</a></p>
  </form>`;
  content.querySelectorAll('.lp-choice input').forEach((input) => {
    input.onchange = () => content.querySelectorAll('.lp-choice').forEach((card) => card.classList.toggle('is-selected', card.querySelector('input').checked));
  });
  formAction('#choose-event', async (form) => {
    draft.type = field(form, 'type');
    saveDraft();
    details();
  });
}

function summary(rows, note) {
  return `<aside class="lp-panel" style="flex: 1 1 340px" aria-label="Opsummering">
    <p style="margin: 0; font: 400 32px/1 var(--font-display)">Din tilmelding</p>
    <dl class="lp-summary">${rows.map(([k, v, total]) => `<div class="${total ? 'is-total' : ''}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <p class="lp-help">${note}</p>
  </aside>`;
}

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

function sizeSelect(id, name, label, value) {
  return `<div class="lp-field"><label for="${id}">${label}</label><select id="${id}" class="lp-input" name="${name}" required>
    <option value="" ${value ? '' : 'selected'} disabled>Vælg størrelse</option>
    ${SIZES.map((size) => `<option ${size === value ? 'selected' : ''}>${size}</option>`).join('')}
  </select></div>`;
}

// T-shirt, company and consent. Used in the registration and on Min side.
function playerFields(kind, v = {}) {
  const pair = kind === 'pair';
  return `<div class="lp-field-row">
      ${sizeSelect('ev-shirt', 'shirt', pair ? 'Din T-shirt-størrelse' : 'T-shirt-størrelse', v.shirt)}
      <div class="lp-field"><label for="ev-company">${pair ? 'Din virksomhed' : 'Virksomhed'} <span class="lp-optional">(valgfri)</span></label><input id="ev-company" class="lp-input" name="company" autocomplete="organization" maxlength="120" value="${esc(v.company)}"></div>
    </div>
    ${pair ? `<div class="lp-field-row">
      ${sizeSelect('ev-partner-shirt', 'partnerShirt', 'Makkers T-shirt-størrelse', v.partnerShirt)}
      <div class="lp-field"><label for="ev-partner-company">Makkers virksomhed <span class="lp-optional">(valgfri)</span></label><input id="ev-partner-company" class="lp-input" name="partnerCompany" maxlength="120" value="${esc(v.partnerCompany)}"></div>
    </div>` : ''}
    <p class="lp-help" style="margin-top: -8px">T-shirts er unisex.</p>
    <label class="lp-check"><input type="checkbox" name="publish" ${v.publish ? 'checked' : ''}><span>${pair ? 'I må gerne nævne vores navne og virksomheder som deltagere, når Lykke Padel bliver promoveret. Jeg har aftalt det med min makker.' : 'I må gerne nævne mit navn og min virksomhed som deltager, når Lykke Padel bliver promoveret.'}</span></label>`;
}

function readPlayerFields(form, kind) {
  const value = (name) => (form.elements[name]?.value || '').trim().replace(/\s+/g, ' ');
  const v = { shirt: value('shirt'), company: value('company'), publish: Boolean(form.elements.publish?.checked) };
  if (kind === 'pair') Object.assign(v, { partnerShirt: value('partnerShirt'), partnerCompany: value('partnerCompany') });
  if (!SIZES.includes(v.shirt)) throw new Error('Vælg en T-shirt-størrelse.');
  if (kind === 'pair' && !SIZES.includes(v.partnerShirt)) throw new Error('Vælg en T-shirt-størrelse til din makker.');
  return v;
}

function saveDetails(v) {
  return client.rpc('set_registration_details', {
    p_shirt: v.shirt,
    p_partner_shirt: v.partnerShirt || null,
    p_company: v.company || null,
    p_partner_company: v.partnerCompany || null,
    p_publish: v.publish,
  });
}

const publishText = (kind, yes) => (yes ? 'Ja, I må nævne ' + (kind === 'pair' ? 'os' : 'mig') : 'Nej tak');

// Step 2: contact details and discount code.
function details() {
  const p = packages[draft.type];
  const content = shell(2, 'Dine oplysninger', { back: { href: '#', label: 'Skift deltagelse' } });
  content.innerHTML = `<div class="lp-split">
    <form id="event-details" class="lp-form" style="flex: 999 1 520px">
      <div class="lp-field-row">
        <div class="lp-field"><label for="ev-name">Fulde navn</label><input id="ev-name" class="lp-input" name="name" autocomplete="name" minlength="2" maxlength="120" value="${esc(draft.name)}" required></div>
        <div class="lp-field"><label for="ev-phone">Telefon</label><input id="ev-phone" class="lp-input" name="phone" type="tel" autocomplete="tel" minlength="6" maxlength="30" value="${esc(draft.phone)}" required></div>
      </div>
      <div class="lp-field"><label for="ev-email">Mail</label><input id="ev-email" class="lp-input" name="email" type="email" autocomplete="email" maxlength="254" value="${esc(currentUser?.email || draft.email)}" ${currentUser ? 'readonly' : ''} required><p class="lp-help">Din mail bliver din adgang til Min side. Vi sender en kode hertil, før tilmeldingen gemmes.</p></div>
      <div class="lp-field"><label for="ev-address">Faktureringsadresse</label><textarea id="ev-address" class="lp-input" name="address" autocomplete="street-address" minlength="5" maxlength="500" required>${esc(draft.address)}</textarea></div>
      ${true ? `<div class="lp-field"><label for="ev-display">Synligt navn ved bud</label><input id="ev-display" class="lp-input" name="display" autocomplete="nickname" minlength="2" maxlength="40" value="${esc(draft.display)}" required><p class="lp-help">Vises ved dine bud i Lykke Auktion, så alle kan følge med. Brug dit navn, et kaldenavn eller din virksomheds navn.</p></div>` : ''}
      ${draft.type === 'pair' ? `<div class="lp-field"><label for="ev-partner">Din makkers fulde navn</label><input id="ev-partner" class="lp-input" name="partner" minlength="2" maxlength="120" value="${esc(draft.partner)}" required></div>` : ''}
      ${playerFields(draft.type, draft.player)}
      <div class="lp-field"><label for="ev-code">Rabatkode</label><input id="ev-code" class="lp-input" name="code" autocomplete="off" maxlength="80" value="${esc(draft.code)}"><p class="lp-help">Rabatten beregnes, når du fortsætter.</p></div>
      <div><button class="lp-btn lp-btn--primary lp-btn--large" type="submit">Fortsæt</button></div>
    </form>
    ${summary([[`${LABELS[draft.type]} · ${p.seats} ${p.seats === 1 ? 'spiller' : 'spillere'}`, money(p.price)]], draft.type === 'individual' ? 'Giver adgang til at byde på padelmakkere i Lykke Auktion. Et eventuelt vinderbud faktureres separat efter auktionen.' : 'Makkerpar kan byde på charity-produkterne i Lykke Auktion.')}
  </div>`;
  $('#shell-back').onclick = (event) => {
    event.preventDefault();
    const form = $('#event-details');
    draft = { ...draft, ...Object.fromEntries(new FormData(form)) };
    try {
      draft.player = readPlayerFields(form, draft.type);
    } catch {
      // Keep what is filled in; it is checked again on Fortsæt.
    }
    saveDraft();
    choose();
  };
  formAction('#event-details', async (form) => {
    const fields = Object.fromEntries(new FormData(form));
    const player = readPlayerFields(form, draft.type);
    draft = { ...validateRegistration({ ...fields, type: draft.type }), address: field(form, 'address'), code: field(form, 'code'), display: field(form, 'display').replace(/\s+/g, ' '), player };
    if (draft.address.length < 5) throw new Error('Udfyld din faktureringsadresse.');
    if ((draft.display.length < 2 || draft.display.length > 40)) throw new Error('Det synlige navn skal være mellem 2 og 40 tegn.');
    saveDraft();
    const { data, error } = await client.rpc('event_registration_quote', { p_kind: draft.type, p_code: draft.code });
    if (error) throw error;
    quote = data;
    review();
  });
}

// Step 3: review and confirm (sends the mail code if not signed in).
function review() {
  const content = shell(3, 'Gennemse og bekræft', { back: { href: '#', label: 'Ret oplysninger' } });
  const rows = [
    ['Navn', esc(draft.name)],
    ...(draft.type === 'pair' ? [['Makker', esc(draft.partner)]] : []),
    ['Synligt navn ved bud', esc(draft.display)],
    ['Mail', esc(draft.email)],
    ['Telefon', esc(draft.phone)],
    ['Faktureringsadresse', esc(draft.address)],
    ['T-shirt', esc(draft.type === 'pair' ? `${draft.player.shirt} / makker ${draft.player.partnerShirt}` : draft.player.shirt)],
    ...(draft.player.company ? [['Virksomhed', esc(draft.player.company)]] : []),
    ...(draft.player.partnerCompany ? [['Makkers virksomhed', esc(draft.player.partnerCompany)]] : []),
    ['Må nævnes i promovering', publishText(draft.type, draft.player.publish)],
  ];
  content.innerHTML = `<div class="lp-split">
    <form id="event-confirm" class="lp-form" style="flex: 999 1 520px">
      <dl class="lp-summary" style="border-top: 2px solid var(--ink)">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd style="text-align: right; white-space: pre-line">${v}</dd></div>`).join('')}</dl>
      <label class="lp-check"><input name="confirm" type="checkbox" required><span>Jeg vil gemme denne testtilmelding hos LykkeLiga. Oplysningerne bruges til deltagelse og auktionsadgang. Der trækkes ingen penge, og bud i testauktionen faktureres ikke.</span></label>
      <div><button class="lp-btn lp-btn--primary lp-btn--large" type="submit">${currentUser ? 'Bekræft tilmelding' : 'Send kode til min mail'}</button></div>
    </form>
    ${summary(
      [
        [`${LABELS[draft.type]} · ${packages[draft.type].seats} ${packages[draft.type].seats === 1 ? 'spiller' : 'spillere'}`, money(quote.base_price)],
        ['Rabat', quote.discount_amount ? '−' + money(quote.discount_amount) : money(0)],
        ['I alt', money(quote.amount_due), true],
      ],
      'Kun tilmeldinger til 0 kr. kan gennemføres, indtil betaling åbner.',
    )}
  </div>`;
  $('#shell-back').onclick = (event) => {
    event.preventDefault();
    details();
  };
  formAction('#event-confirm', async () => {
    if (quote.amount_due !== 0) throw new Error('Betaling er ikke åbnet endnu. Brug en gyldig rabatkode for at gennemføre testtilmeldingen.');
    if (currentUser) await complete();
    else await sendCode(draft.email, true, complete);
  });
}

async function complete() {
  const { data, error } = await client.rpc('complete_event_registration', {
    p_kind: draft.type,
    p_name: draft.name,
    p_phone: draft.phone,
    p_address: draft.address,
    p_partner: draft.partner || '',
    p_code: draft.code,
    p_terms: 'registration-test-v1',
  });
  if (error) throw error;
  let nameProblem = '';
  if (draft.display) {
    const { error: nameError } = await client.rpc('set_auction_display_name', { p_name: draft.display });
    if (nameError) nameProblem = nameError.message;
  }
  let registration = data;
  let detailsProblem = '';
  if (draft.player) {
    const { data: saved, error: detailsError } = await saveDetails(draft.player);
    if (saved) registration = saved;
    else if (detailsError && !/PGRST202|could not find/i.test(`${detailsError.code} ${detailsError.message}`)) detailsProblem = detailsError.message;
  }
  sessionStorage.removeItem(DRAFT_KEY);
  receipt(registration, { nameProblem, detailsProblem });
}

async function loadDisplayName() {
  // The column only exists once database/bid-history.sql has been applied.
  const { data, error } = await client.from('auction_profiles').select('display_name').eq('user_id', currentUser.id);
  if (error) return { available: false, name: null };
  return { available: true, name: data[0]?.display_name || null };
}

// Min side: show and change the name shown next to the participant's bids.
async function displayNameSection(r, nameProblem) {
  if (r.status === 'cancelled') return;
  const slot = $('#display-name-slot');
  const { available, name } = await loadDisplayName();
  if (!available || !slot) return;
  const render = (current, message = '') => {
    slot.innerHTML = `<div class="lp-panel" style="flex: 1 1 340px">
      <p style="margin: 0; font: 400 32px/1 var(--font-display)">Synligt navn ved bud</p>
      <p class="lp-text">${current ? `Dine bud vises som <strong>${esc(current)}</strong>.` : 'Du har ikke valgt et synligt navn endnu, så dine bud vises som "Anonym budgiver".'}</p>
      ${message ? `<p class="lp-error" role="alert">${esc(message)}</p>` : ''}
      <form id="display-name-form" class="lp-form" style="gap: 12px">
        <div class="lp-field"><label for="display-name">${current ? 'Skift navn' : 'Vælg navn'}</label><input id="display-name" class="lp-input" name="display" minlength="2" maxlength="40" value="${esc(current || '')}" required></div>
        <div><button class="lp-btn lp-btn--secondary lp-btn--small" type="submit" style="border-width: 3px">Gem navn</button></div>
      </form>
    </div>`;
    formAction('#display-name-form', async (form) => {
      const { data, error } = await client.rpc('set_auction_display_name', { p_name: field(form, 'display') });
      if (error) throw error;
      render(data);
    });
  };
  render(name, nameProblem ? `Vi kunne ikke gemme dit synlige navn: ${nameProblem}` : '');
}

// Min side: the participant corrects name, phone and billing address. The mail is the login.
function contactNote(editable) {
  return `${editable ? '<button class="lp-btn lp-btn--secondary lp-btn--small" type="button" id="edit-contact" style="border-width: 3px; margin-bottom: 12px">Ret oplysninger</button><br>' : ''}Mailen er dit login og kan ikke ændres her. Skal den ændres, så skriv til <a href="mailto:signe@lykkeliga.dk">signe@lykkeliga.dk</a>.`;
}

function setupContactEdit(current) {
  const button = $('#edit-contact');
  if (!button) return;
  button.onclick = () => {
    modal(`<h2 id="modal-title" class="lp-display lp-display--s">Ret dine oplysninger</h2>
      <form id="contact-form" class="lp-form" style="gap: 20px">
        <div class="lp-field"><label for="ct-name">Fulde navn</label><input id="ct-name" class="lp-input" name="name" autocomplete="name" minlength="2" maxlength="120" value="${esc(current.full_name)}" required></div>
        <div class="lp-field"><label for="ct-phone">Telefon</label><input id="ct-phone" class="lp-input" name="phone" type="tel" autocomplete="tel" minlength="6" maxlength="30" value="${esc(current.phone)}" required></div>
        <div class="lp-field"><label for="ct-address">Faktureringsadresse</label><textarea id="ct-address" class="lp-input" name="address" autocomplete="street-address" minlength="5" maxlength="500" required>${esc(current.billing_address)}</textarea><p class="lp-help">Vinder du en auktion, sender vi fakturaen hertil. Skriv gerne firmanavn og CVR, hvis fakturaen skal til en virksomhed.</p></div>
        <div class="lp-actions"><button class="lp-btn lp-btn--primary" type="submit">Gem</button><button class="lp-btn lp-btn--secondary" type="button" id="contact-cancel">Annuller</button></div>
      </form>`);
    $('#contact-cancel').onclick = closeModal;
    useForm($('#contact-form'), async (form) => {
      const { error } = await client.rpc('update_my_contact', { p_name: field(form, 'name'), p_phone: field(form, 'phone'), p_address: field(form, 'address') });
      if (error && /PGRST202|could not find/i.test(`${error.code} ${error.message}`)) throw new Error('Det er ikke muligt at rette oplysninger endnu. Skriv til signe@lykkeliga.dk.');
      if (error) throw error;
      closeModal();
      await participantHome({ redirect: false });
      toast('Dine oplysninger er gemt.');
    });
  };
}

// Min side: T-shirt, company and consent. Only once database/registration-details.sql is applied.
function playerDetailsSection(r, problem) {
  const slot = $('#player-details-slot');
  if (!slot || r.status === 'cancelled' || !('shirt_size' in r)) return;
  const render = (reg, message = '', saved = false) => {
    const missing = !reg.shirt_size || (reg.kind === 'pair' && !reg.partner_shirt_size);
    slot.innerHTML = `<div class="lp-panel" style="flex: 1 1 340px" id="spiller">
      <p style="margin: 0; font: 400 32px/1 var(--font-display)">T-shirt og synlighed</p>
      ${missing ? '<div class="lp-notice">Vælg T-shirt-størrelse, så vi kan bestille den rigtige.</div>' : '<p class="lp-text">Du kan ændre dine valg her frem til eventet.</p>'}
      ${message ? `<p class="lp-error" role="alert">${esc(message)}</p>` : ''}
      ${saved ? '<p class="lp-help" role="status">Gemt.</p>' : ''}
      <form id="player-details-form" class="lp-form" style="gap: 16px">
        ${playerFields(reg.kind, { shirt: reg.shirt_size, partnerShirt: reg.partner_shirt_size, company: reg.company, partnerCompany: reg.partner_company, publish: reg.publish_consent })}
        <div><button class="lp-btn lp-btn--secondary lp-btn--small" type="submit" style="border-width: 3px">Gem</button></div>
      </form>
    </div>`;
    formAction('#player-details-form', async (form) => {
      const { data, error } = await saveDetails(readPlayerFields(form, reg.kind));
      if (error) throw error;
      render(data, '', true);
    });
  };
  render(r, problem ? `Vi kunne ikke gemme T-shirt og synlighed: ${problem}` : '');
}

// Min side: show "Dine bud" once the list has loaded.
function loadMyBids() {
  return mountMyBids(client, $('#dine-bud'));
}

// Min side: log in or create a free profile with a one-time code.
function login({ loggedOut = false } = {}) {
  const content = shell(1, 'Log ind eller opret profil', { names: PROFILE_STEPS });
  content.innerHTML = `<form id="participant-login" class="lp-form" style="max-width: 560px">
    ${loggedOut ? '<div class="lp-notice" role="status">Du er logget ud.</div>' : ''}
    <p class="lp-lead">Skriv din mail, så sender vi dig en kode. Du skal ikke bruge en adgangskode.</p>
    <p class="lp-text">Er du ny, beder vi bagefter om navn, telefon og faktureringsadresse, så vi kan kontakte dig og sende en faktura, hvis du vinder. Har du allerede en profil, ${NEXT ? 'kommer du direkte tilbage til auktionen' : 'kommer du direkte til Min side'}.</p>
    <div class="lp-field"><label for="login-email">Mail</label><input id="login-email" class="lp-input" name="email" type="email" autocomplete="email" required maxlength="254"></div>
    <div><button class="lp-btn lp-btn--primary lp-btn--large" type="submit">Send kode</button></div>
    <p class="lp-help">Med en profil kan du byde på charity-produkterne i Lykke Auktion. Vil du spille med i Charity Turnering? <a href="/tilmelding">Tilmeld dig her</a></p>
  </form>`;
  formAction('#participant-login', async (form) => sendCode(field(form, 'email'), true, participantHome, false));
}

// After login: the registration, else the auction profile, else the form to create one.
async function participantHome({ redirect = true } = {}) {
  const { data, error } = await client.from('event_registrations').select('*').eq('user_id', currentUser.id);
  if (error) throw error;
  if (data.length && redirect && NEXT) return location.assign(NEXT);
  if (data.length) return receipt(data[0]);
  const { data: profiles, error: profileError } = await client.from('auction_profiles').select('*').eq('user_id', currentUser.id);
  if (profileError) throw profileError;
  if (profiles.length && redirect && NEXT) return location.assign(NEXT);
  if (profiles.length) return profileHome(profiles[0]);
  profileForm();
}

function profileForm() {
  const content = shell(3, 'Dine oplysninger', { names: PROFILE_STEPS });
  content.innerHTML = `<div class="lp-split">
    <form id="auction-profile" class="lp-form" style="flex: 999 1 520px">
      <p class="lp-lead">Sidste trin. Med en gratis profil kan du byde på charity-produkterne i Lykke Auktion. Vinder du, sender LykkeLiga en faktura til adressen herunder.${NEXT ? ' Bagefter sender vi dig tilbage til auktionen.' : ''}</p>
      <div class="lp-field-row">
        <div class="lp-field"><label for="pf-name">Fulde navn</label><input id="pf-name" class="lp-input" name="name" autocomplete="name" minlength="2" maxlength="120" required></div>
        <div class="lp-field"><label for="pf-phone">Telefon</label><input id="pf-phone" class="lp-input" name="phone" type="tel" autocomplete="tel" minlength="6" maxlength="30" required></div>
      </div>
      <div class="lp-field"><label for="pf-address">Faktureringsadresse</label><textarea id="pf-address" class="lp-input" name="address" autocomplete="street-address" minlength="5" maxlength="500" required></textarea><p class="lp-help">Skriv gerne firmanavn og CVR, hvis fakturaen skal til en virksomhed. Du kan rette den senere på Min side.</p></div>
      <div class="lp-field"><label for="pf-display">Synligt navn ved bud</label><input id="pf-display" class="lp-input" name="display" autocomplete="nickname" minlength="2" maxlength="40" required><p class="lp-help">Vises ved dine bud, så alle kan følge med. Brug dit navn, et kaldenavn eller din virksomheds navn.</p></div>
      <label class="lp-check"><input type="checkbox" name="terms" required><span>Jeg accepterer, at mine oplysninger gemmes hos LykkeLiga, og at et vindende bud er bindende og faktureres efter auktionen. Dette er en testversion.</span></label>
      <div><button class="lp-btn lp-btn--primary lp-btn--large" type="submit">Opret profil</button></div>
    </form>
    <aside class="lp-panel" style="flex: 1 1 320px">
      <p style="margin: 0; font: 400 32px/1 var(--font-display)">Padelmakkere?</p>
      <p class="lp-text">Bud på padelmakkere kræver individuel tilmelding til Charity Turnering.</p>
      <a class="lp-btn lp-btn--secondary lp-btn--small" href="/tilmelding" style="align-self: flex-start; border-width: 3px">Tilmeld dig turneringen</a>
    </aside>
  </div>`;
  formAction('#auction-profile', async (form) => {
    const { error } = await client.rpc('register_auction_bidder', {
      p_name: field(form, 'name'),
      p_phone: field(form, 'phone'),
      p_address: field(form, 'address'),
      p_display_name: field(form, 'display'),
    });
    if (error && /PGRST202|could not find/i.test(`${error.code} ${error.message}`)) throw new Error('Profiler til auktionen er ikke åbnet endnu. Prøv igen senere.');
    if (error) throw error;
    await participantHome();
  });
}

// Min side for bidders without a tournament registration.
function profileHome(p) {
  document.title = 'Min side – Lykke Padel';
  setHeader({ loggedIn: true });
  main.innerHTML = `
  <section class="lp-band-brown">
    <div class="lp-wrap lp-hero">
      <div class="lp-heading">
        <p class="lp-eyebrow">Min side</p>
        <h1 class="lp-display lp-display--band">Hej ${esc(p.full_name.split(' ')[0])}</h1>
        <p class="lp-lead">${p.approved ? 'Din profil er klar. Du kan byde på charity-produkterne i Lykke Auktion.' : 'Din budadgang er sat på pause. Kontakt LykkeLiga, hvis det er en fejl.'}</p>
      </div>
      <dl class="lp-stats">
        <div><dt>Profil</dt><dd>${p.approved ? 'Aktiv' : 'På pause'}</dd></div>
        <div><dt>Charity Turnering</dt><dd>Ikke tilmeldt</dd></div>
      </dl>
    </div>
  </section>
  <section class="lp-wrap lp-section lp-mybids-section" id="dine-bud" aria-label="Dine bud" hidden></section>
  <div class="lp-wrap lp-section lp-split" style="gap: 56px">
    <section style="flex: 999 1 520px; display: flex; flex-direction: column; gap: 24px">
      <h2 class="lp-display lp-display--s">Byd for lykke</h2>
      <p class="lp-text">Find charity-produkterne i Lykke Auktion. Vil du også byde på padelmakkere, skal du tilmelde dig Charity Turnering individuelt.</p>
      <div class="lp-actions">
        <a class="lp-btn lp-btn--primary lp-btn--large" href="/auktion?type=produkter">Se auktionen</a>
        <a class="lp-btn lp-btn--secondary lp-btn--large" href="/charity-turnering">Om Charity Turnering</a>
      </div>
      <div><button class="lp-btn--text" type="button" id="event-logout">Log ud</button></div>
    </section>
    ${summary(
      [
        ['Navn', esc(p.full_name)],
        ['Telefon', esc(p.phone)],
        ['Faktureringsadresse', esc(p.billing_address)],
      ],
      contactNote(p.approved),
    )}
    <div id="display-name-slot" style="flex: 1 1 100%; display: flex"></div>
  </div>`;
  $('#event-logout').onclick = () => location.assign('/deltager?logout=1');
  setupContactEdit(p);
  displayNameSection({ status: p.approved ? 'confirmed' : 'cancelled' }, '');
  loadMyBids();
  window.scrollTo(0, 0);
}

async function sendCode(email, create, onVerified, registering = create) {
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: create } });
  if (error) throw new Error(error.status === 429 ? 'Vent lidt, før du beder om en ny kode.' : 'Mailen med koden kunne ikke sendes. Prøv igen eller kontakt LykkeLiga.');
  const content = registering
    ? shell(3, 'Tjek din mail', { back: { href: '#', label: 'Gå tilbage og ret' } })
    : shell(2, 'Tjek din mail', { names: PROFILE_STEPS });
  content.innerHTML = `<form id="verify-email" class="lp-form" style="max-width: 640px; gap: 28px">
    <p class="lp-lead">Vi har sendt en kode til <strong>${esc(email)}</strong>. Indtast den her${registering ? ' for at gennemføre tilmeldingen' : ''}. Tjek også spam.</p>
    <div class="lp-field"><label for="otp">Kode fra mailen</label><input id="otp" class="lp-input lp-input--big" name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required autofocus style="max-width: 320px; letter-spacing: 6px"></div>
    <div class="lp-actions" style="align-items: center">
      <button class="lp-btn lp-btn--primary lp-btn--large" type="submit">${registering ? 'Bekræft og tilmeld' : 'Log ind'}</button>
      <button class="lp-btn--text" type="button" id="resend-code" disabled>Send ny kode om 60 sek.</button>
    </div>
  </form>`;
  const back = $('#shell-back');
  if (back)
    back.onclick = (event) => {
      event.preventDefault();
      details();
    };
  let seconds = 60;
  const timer = setInterval(() => {
    const button = $('#resend-code');
    if (!button) return clearInterval(timer);
    seconds--;
    button.textContent = seconds > 0 ? `Send ny kode om ${seconds} sek.` : 'Send ny kode';
    button.disabled = seconds > 0;
    if (seconds <= 0) clearInterval(timer);
  }, 1000);
  $('#resend-code').onclick = async () => {
    const button = $('#resend-code');
    button.disabled = true;
    try {
      await sendCode(email, create, onVerified, registering);
    } catch (resendError) {
      $('#verify-email').insertAdjacentHTML('beforeend', errorHtml(errorMessage(resendError)));
      button.disabled = false;
    }
  };
  formAction('#verify-email', async (form) => {
    if (currentUser?.email?.toLowerCase() === email.toLowerCase()) return onVerified();
    const { data, error: verifyError } = await client.auth.verifyOtp({ email, token: field(form, 'token'), type: 'email' });
    if (verifyError) throw new Error('Koden er forkert eller udløbet. Tjek den, eller bed om en ny.');
    currentUser = data.user;
    await onVerified();
  });
}

// Min side: the participant's registration.
function receipt(r, { nameProblem = '', detailsProblem = '' } = {}) {
  const cancelled = r.status === 'cancelled';
  const first = r.full_name.split(' ')[0];
  document.title = 'Min side – Lykke Padel';
  setHeader({ loggedIn: true });
  main.innerHTML = `
  <section class="lp-band-brown">
    <div class="lp-wrap lp-hero">
      <div class="lp-heading">
        <p class="lp-eyebrow">Min side</p>
        <h1 class="lp-display lp-display--band">Hej ${esc(first)}</h1>
        <p class="lp-lead">${cancelled ? 'Din tilmelding er annulleret. Kontakt LykkeLiga, hvis det er en fejl.' : 'Du er tilmeldt Lykke Padel den 2. april 2027 i Pakhus77, Aarhus.'}</p>
      </div>
      <dl class="lp-stats">
        <div><dt>Deltagelse</dt><dd>${LABELS[r.kind]}</dd></div>
        <div><dt>Status</dt><dd>${cancelled ? 'Annulleret' : 'Bekræftet'}</dd></div>
        <div><dt>Reference</dt><dd>${esc(r.id.slice(0, 8).toUpperCase())}</dd></div>
      </dl>
    </div>
  </section>
  <section class="lp-wrap lp-section lp-mybids-section" id="dine-bud" aria-label="Dine bud" hidden></section>
  <div class="lp-wrap lp-section lp-split" style="gap: 56px">
    <section style="flex: 999 1 520px; display: flex; flex-direction: column; gap: 24px">
      <h2 class="lp-display lp-display--s">${cancelled ? 'Hvad nu?' : r.kind === 'individual' ? 'Find din makker' : 'I er klar'}</h2>
      <p class="lp-text">${cancelled ? 'Tilmeldingen giver ikke længere adgang til at byde.' : r.kind === 'individual' ? 'Du er tilmeldt Charity Turnering og kan byde på både padelmakkere og charity-produkter i Lykke Auktion. Vinder du ikke en makker, matcher vi dig med en makker på dit niveau.' : 'I spiller sammen som fast makkerpar hele turneringen. I kan byde på charity-produkterne i Lykke Auktion, men ikke på padelmakkere.'}</p>
      <div class="lp-actions">
        <a class="lp-btn lp-btn--primary lp-btn--large" href="/auktion">${cancelled ? 'Se auktionen' : 'Gå til Lykke Auktion'}</a>
        <a class="lp-btn lp-btn--secondary lp-btn--large" href="/forsidetest#program">Program for dagen</a>
      </div>
      <p class="lp-help">Du kan altid komme tilbage via lykkepadel.dk/deltager. På en ny enhed får du en ny kode på mail. Vi sender endnu ikke en kvitteringsmail.</p>
      <div><button class="lp-btn--text" type="button" id="event-logout">Log ud</button></div>
    </section>
    ${summary(
      [
        ['Navn', esc(r.full_name)],
        ...(r.partner_name ? [['Makker', esc(r.partner_name)]] : []),
        ['Mail', esc(r.email)],
        ['Telefon', esc(r.phone)],
        ['Betalt', `${money(r.amount_due)}${r.discount_code ? ' (rabatkode)' : ''}`],
        ...(r.shirt_size ? [['T-shirt', esc(r.partner_shirt_size ? `${r.shirt_size} / makker ${r.partner_shirt_size}` : r.shirt_size)]] : []),
      ],
      contactNote(!cancelled),
    )}
    <div id="player-details-slot" style="flex: 1 1 100%; display: flex"></div>
    <div id="display-name-slot" style="flex: 1 1 100%; display: flex"></div>
  </div>`;
  setupContactEdit(r);
  playerDetailsSection(r, detailsProblem);
  displayNameSection(r, nameProblem);
  loadMyBids();
  $('#event-logout').onclick = () => location.assign('/deltager?logout=1');
  window.scrollTo(0, 0);
}
