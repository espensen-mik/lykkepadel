// Ticket scanner for volunteers at /scan. They log in with the day code from admin on their own phones.
// The camera reads QR codes in the page: with the browser's own reader where it has one (Android Chrome),
// otherwise with jsQR (iPhone). Links from the phone's camera app (/scan#CODE) and typed codes also work.
import jsQR from 'jsqr';
const main = document.getElementById('main');
const KEY = 'lykke-scan-code';
const TICKET = /([0-9A-F]{4}-[0-9A-F]{4})\s*$/i;
let api;
let dayCode = read();
let last = { code: '', at: 0 };
let stream = null;
let wakeLock = null;

function read() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}
function store(value) {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage the volunteer types the code again next time.
  }
}
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const time = (value) => new Date(value).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' });

async function connect() {
  const response = await fetch('/api/auction-config?context=participant');
  if (!response.ok) throw new Error('Scanneren er ikke åben.');
  const { url, key } = await response.json();
  api = async (name, args) => {
    const result = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await result.json().catch(() => null);
    if (!result.ok) {
      const error = new Error(/PGRST202|could not find/i.test(`${data?.code} ${data?.message}`) ? 'Scanneren er ikke sat op endnu.' : data?.message || 'Ingen forbindelse. Prøv igen.');
      error.expired = /forkert eller udløbet/.test(data?.message || '');
      throw error;
    }
    return data;
  };
}

// The ticket code from a scanned link (/scan#AB12-CD34 or /admin#billet/AB12-CD34) or typed by hand.
const ticketFrom = (text) => TICKET.exec(decodeURIComponent(text || '').trim())?.[1]?.toUpperCase() || '';

function login(message = '') {
  stopCamera();
  main.innerHTML = `
    <div class="scan__top"><img src="/images/brand/lykkepadel-wide-creme.svg" alt="Lykke Padel"></div>
    <h1>Billetscanner</h1>
    <p class="muted">Skriv dagens kode fra arrangøren. Koden gemmes på telefonen, til den udløber.</p>
    ${message ? `<p class="error" role="alert">${esc(message)}</p>` : ''}
    <form id="login">
      <label for="day-code">Dagens kode</label>
      <input id="day-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" maxlength="20" required>
      <button type="submit">Start scanneren</button>
    </form>`;
  const form = document.getElementById('login');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    form.querySelector('.error')?.remove();
    const code = form.elements.code.value.trim();
    try {
      const status = await api('scan_status', { p_scan_code: code });
      dayCode = code;
      store(code);
      scanner(status);
    } catch (error) {
      form.insertAdjacentHTML('beforeend', `<p class="error" role="alert">${esc(error.message)}</p>`);
      button.disabled = false;
    }
  };
}

function scanner(status) {
  const camera = Boolean(navigator.mediaDevices?.getUserMedia);
  main.innerHTML = `
    <div class="scan__top"><img src="/images/brand/lykkepadel-wide-creme.svg" alt="Lykke Padel"><button class="secondary" type="button" id="logout">Log ud</button></div>
    <div><p class="count" id="count"></p><p class="muted">Koden virker til kl. ${time(status.valid_until)}.</p></div>
    <div class="result idle" id="result" aria-live="assertive"><strong>Klar</strong>${camera ? 'Tryk på Start kamera, og hold QR-koden inden for rammen.' : 'Scan QR-koden med telefonens kamera-app, og tryk på linket.'}</div>
    ${camera
      ? `<div class="camera" id="camera" hidden><video id="video" playsinline muted></video></div>
         <button type="button" id="camera-toggle">Start kamera</button>`
      : `<p class="help">Denne browser giver ikke adgang til kameraet. Åbn <strong>kamera-appen</strong>, peg på billettens QR-kode, og tryk på linket, der dukker op. Billetten tjekkes så ind her. Du kan også taste koden herunder.</p>`}
    <form id="manual">
      <label for="ticket-code">Billetkode</label>
      <div class="row"><input id="ticket-code" name="ticket" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="AB12-CD34" maxlength="9"><button type="submit">Tjek ind</button></div>
    </form>`;
  showCount(status);
  document.getElementById('logout').onclick = () => {
    dayCode = '';
    store('');
    login();
  };
  const form = document.getElementById('manual');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const code = ticketFrom(form.elements.ticket.value) || form.elements.ticket.value.trim().toUpperCase();
    form.elements.ticket.value = '';
    if (code) await check(code);
  };
  if (camera) document.getElementById('camera-toggle').onclick = () => (stream ? stopCamera() : startCamera());
}

const showCount = (status) => {
  const el = document.getElementById('count');
  if (el) el.textContent = `${status.checked_in} af ${status.sold} tjekket ind`;
};

const VIEWS = {
  ok: ['ok', 'Velkommen'],
  used: ['bad', 'Allerede brugt'],
  void: ['bad', 'Annulleret'],
  test: ['warn', 'Testbillet'],
  unknown: ['bad', 'Ukendt billet'],
  undone: ['warn', 'Fortrudt'],
};

async function check(code, undo = false) {
  const box = document.getElementById('result');
  try {
    const r = await api('scan_ticket', { p_scan_code: dayCode, p_ticket: code, p_undo: undo });
    const [cls, title] = VIEWS[r.result] || VIEWS.unknown;
    const detail = {
      ok: `${esc(r.first_name)} · ${r.checked_in} af ${r.quantity} fra ordren er inde`,
      used: `Tjekket ind kl. ${time(r.checked_in_at)} · ${esc(r.first_name)}`,
      void: 'Billetten er annulleret og giver ikke adgang.',
      test: 'Testkøb – giver ikke adgang.',
      unknown: 'Koden findes ikke. Tjek, at den er rigtig.',
      undone: `${esc(r.code)} kan scannes igen.`,
    }[r.result];
    box.className = `result ${cls}`;
    box.innerHTML = `<strong>${title}</strong><span>${esc(r.code)}</span><span>${detail}</span>${r.result === 'ok' ? '<button type="button" id="undo">Fortryd</button>' : ''}`;
    document.getElementById('undo')?.addEventListener('click', () => check(r.code, true));
    navigator.vibrate?.(r.result === 'ok' ? 80 : [80, 60, 80, 60, 200]);
    showCount(await api('scan_status', { p_scan_code: dayCode }));
  } catch (error) {
    if (error.expired) return login('Koden er udløbet eller slået fra. Få en ny kode af arrangøren.');
    box.className = 'result bad';
    box.innerHTML = `<strong>Fejl</strong><span>${esc(error.message)}</span>`;
  }
}

async function startCamera() {
  const button = document.getElementById('camera-toggle');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    document.getElementById('result').innerHTML = '<strong>Intet kamera</strong>Giv siden adgang til kameraet i browserens indstillinger, eller tast koden.';
    return;
  }
  const video = document.getElementById('video');
  video.srcObject = stream;
  await video.play();
  document.getElementById('camera').hidden = false;
  button.textContent = 'Stop kamera';
  wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
  const read = reader(video);
  const loop = async () => {
    if (!stream) return;
    try {
      const code = ticketFrom(await read());
      // The same ticket stays in front of the camera for a moment; check it in once.
      if (code && (code !== last.code || Date.now() - last.at > 5000)) {
        last = { code, at: Date.now() };
        await check(code);
      }
    } catch {
      // A frame that cannot be read is skipped.
    }
    setTimeout(loop, 250);
  };
  loop();
}

// Returns a function that reads the QR code in the current video frame, or null.
function reader(video) {
  if ('BarcodeDetector' in window) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    return async () => (await detector.detect(video))[0]?.rawValue || null;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async () => {
    if (!video.videoWidth) return null;
    // A smaller frame is read faster and is plenty for a ticket held up to the camera.
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data || null;
  };
}

function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  const camera = document.getElementById('camera');
  if (camera) camera.hidden = true;
  const button = document.getElementById('camera-toggle');
  if (button) button.textContent = 'Start kamera';
}

// A ticket opened from the phone's camera app: /scan#AB12-CD34.
async function fromLink() {
  const code = ticketFrom(location.hash.slice(1));
  if (!code) return;
  history.replaceState(null, '', '/scan');
  await check(code);
}

async function start() {
  try {
    await connect();
  } catch (error) {
    main.innerHTML = `<h1>Billetscanner</h1><p class="error">${esc(error.message)}</p>`;
    return;
  }
  if (!dayCode) {
    login(ticketFrom(location.hash.slice(1)) ? 'Log ind med dagens kode. Scan derefter billetten igen.' : '');
    return;
  }
  try {
    scanner(await api('scan_status', { p_scan_code: dayCode }));
    await fromLink();
  } catch (error) {
    if (error.expired) {
      store('');
      dayCode = '';
      return login('Koden er udløbet eller slået fra. Få en ny kode af arrangøren.');
    }
    main.innerHTML = `<h1>Billetscanner</h1><p class="error">${esc(error.message)}</p>`;
  }
}

window.addEventListener('hashchange', () => dayCode && fromLink());
start();
