// Shared helpers for the auction, registration and admin pages.

export const $ = (selector) => document.querySelector(selector);

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const money = (value) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(value);

export const date = (value) =>
  new Intl.DateTimeFormat('da-DK', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(value));

export const errorMessage = (error) => error?.message || 'Noget gik galt. Prøv igen.';

export const errorHtml = (message) => `<p class="lp-error" role="alert">${esc(message)}</p>`;

let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

const dialog = () => $('#modal');

export function modal(html) {
  $('#modal-content').innerHTML = html;
  if (!dialog().open) dialog().showModal();
}

export function closeModal() {
  if (dialog().open) dialog().close();
}

export function setupModal() {
  $('#modal .lp-dialog__close').onclick = closeModal;
  dialog().addEventListener('click', (event) => {
    if (event.target !== dialog()) return;
    const r = dialog().getBoundingClientRect();
    const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    if (outside) closeModal();
  });
}

export const field = (form, name) => new FormData(form).get(name)?.toString().trim() || '';

// Disable the submit button while the task runs and show errors at the bottom of the form.
export function useForm(form, task) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    if (button.disabled) return;
    button.disabled = true;
    form.querySelector('.lp-error')?.remove();
    try {
      await task(form);
    } catch (error) {
      form.insertAdjacentHTML('beforeend', errorHtml(errorMessage(error)));
    } finally {
      button.disabled = false;
    }
  });
}

// Header links change with the visitor's state.
// The account button in the header: "Log ind" when logged out, "Min side" plus "Log ud" when logged in.
// The Supabase user id of a stored session, without loading Supabase.
export function sessionUserId() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const session = JSON.parse(localStorage.getItem(key));
        if (session?.refresh_token) return session.user?.id || 'unknown';
      }
    }
  } catch {
    // Storage blocked: treat as logged out.
  }
  return null;
}

// Remembers which user is an admin, so every page can show the Admin button.
// It only changes the header; /admin always checks the role in the database.
const ADMIN_KEY = 'lykke-admin';
export function rememberAdmin(userId) {
  try {
    if (userId) localStorage.setItem(ADMIN_KEY, userId);
    else localStorage.removeItem(ADMIN_KEY);
  } catch {}
}
function rememberedAdmin() {
  try {
    const id = localStorage.getItem(ADMIN_KEY);
    return Boolean(id) && id === sessionUserId();
  } catch {
    return false;
  }
}

const ICON_PERSON = '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const ICON_ADMIN = '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

export function setHeader({ loggedIn = false, admin = loggedIn && rememberedAdmin(), text, href, onClick, onLogout, logout = loggedIn } = {}) {
  const button = $('#header-login');
  if (!button) return;
  const logoutButton = $('#header-logout');
  if (logoutButton) {
    logoutButton.hidden = !logout;
    logoutButton.onclick = onLogout
      ? (event) => {
          event.preventDefault();
          onLogout();
        }
      : null;
  }
  button.classList.toggle('is-logged-in', loggedIn);
  button.classList.toggle('is-admin', admin);
  const icon = button.querySelector('.lp-account__icon');
  if (icon) icon.innerHTML = admin ? ICON_ADMIN : ICON_PERSON;
  button.querySelector('.lp-account__label').textContent = text || (admin ? 'Admin' : loggedIn ? 'Min side' : 'Log ind');
  button.href = href || (admin ? '/admin' : '/deltager');
  button.onclick = onClick
    ? (event) => {
        event.preventDefault();
        onClick();
      }
    : null;
}

// Downloads rows as a semicolon-separated CSV that opens in Danish Excel.
export function downloadCsv(filename, header, rows) {
  // Neutralise leading spreadsheet formula characters.
  const cell = (v) => '"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "' $&").replaceAll('"', '""') + '"';
  const csv = '\ufeff' + [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
