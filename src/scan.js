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

// Twelve digit boxes in three groups (1234-5678-9012). Typing moves on, backspace moves back,
// and pasting the whole code fills all boxes.
function login(message = '') {
  stopCamera();
  main.classList.remove('scan--app');
  const group = (start) => Array.from({ length: 4 }, (_, i) => `<input class="digit" inputmode="numeric" pattern="[0-9]*" autocomplete="${start + i === 0 ? 'one-time-code' : 'off'}" aria-label="Ciffer ${start + i + 1} af 12">`).join('');
  main.innerHTML = `
    <div class="scan__top"><img src="/images/brand/lykkepadel-wide-creme.svg" alt="Lykke Padel"></div>
    <h1>Billetscanner</h1>
    <p class="muted">Skriv dagens kode fra arrangøren – 12 cifre. Koden gemmes på telefonen, til den udløber.</p>
    ${message ? `<p class="error" role="alert">${esc(message)}</p>` : ''}
    <form id="login">
      <span class="label" id="code-label">Dagens kode</span>
      <div class="digits" role="group" aria-labelledby="code-label">${group(0)}<span class="dash" aria-hidden="true">–</span>${group(4)}<span class="dash" aria-hidden="true">–</span>${group(8)}</div>
      <button type="submit">Start scanneren</button>
    </form>`;
  const form = document.getElementById('login');
  const boxes = [...form.querySelectorAll('.digit')];
  const fill = (digits, from = 0) => {
    digits.split('').slice(0, 12 - from).forEach((d, i) => (boxes[from + i].value = d));
    const next = boxes.find((box) => !box.value) || boxes[11];
    next.focus();
    if (boxes.every((box) => box.value)) form.requestSubmit();
  };
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      const digits = box.value.replace(/\D/g, '');
      box.value = '';
      if (digits) fill(digits, i);
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].value = '';
        boxes[i - 1].focus();
        event.preventDefault();
      }
      if (event.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
      if (event.key === 'ArrowRight' && i < 11) boxes[i + 1].focus();
    });
    box.addEventListener('paste', (event) => {
      event.preventDefault();
      fill((event.clipboardData?.getData('text') || '').replace(/\D/g, ''), i);
    });
    box.addEventListener('focus', () => box.select());
  });
  boxes[0].focus();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    form.querySelector('.error')?.remove();
    const code = boxes.map((box) => box.value).join('');
    if (code.length < 12) {
      form.insertAdjacentHTML('beforeend', '<p class="error" role="alert">Skriv alle 12 cifre.</p>');
      boxes.find((box) => !box.value)?.focus();
      return;
    }
    button.disabled = true;
    try {
      const status = await api('scan_status', { p_scan_code: code });
      dayCode = code;
      store(code);
      scanner(status);
    } catch (error) {
      form.insertAdjacentHTML('beforeend', `<p class="error" role="alert">${esc(error.message)}</p>`);
      button.disabled = false;
      boxes.forEach((box) => (box.value = ''));
      boxes[0].focus();
    }
  };
}

function scanner(status) {
  const camera = Boolean(navigator.mediaDevices?.getUserMedia);
  main.classList.add('scan--app');
  main.innerHTML = `
    <div class="scan__top"><div><p class="count" id="count"></p><p class="muted">Koden virker til kl. ${time(status.valid_until)}</p></div><button class="secondary" type="button" id="logout">Log ud</button></div>
    <div class="result idle" id="result" aria-live="assertive"><strong>Klar</strong><span>${camera ? 'Tryk på Start kamera, og hold QR-koden i rammen.' : 'Scan QR-koden med kamera-appen, og tryk på linket.'}</span></div>
    ${camera
      ? `<div class="camera" id="camera" hidden><video id="video" playsinline muted></video></div>
         <button type="button" id="camera-toggle">Start kamera</button>`
      : `<p class="help">Browseren giver ikke adgang til kameraet. Scan QR-koden med <strong>kamera-appen</strong>, og tryk på linket. Eller tast koden herunder.</p>`}
    <form id="manual">
      <div class="row"><input id="ticket-code" name="ticket" aria-label="Billetkode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Billetkode" maxlength="9"><button type="submit">Tjek ind</button></div>
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
