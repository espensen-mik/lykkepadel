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

export function setTestbar(text) {
  const bar = $('#testbar');
  if (!bar) return;
  bar.textContent = text;
  bar.hidden = !text;
}

// Header links change with the visitor's state.
export function setHeader({ loginText, loginHref, onLogin, showSignup = true } = {}) {
  const login = $('#header-login');
  const signup = $('#header-signup');
  if (login) {
    if (loginText) login.textContent = loginText;
    if (loginHref) login.href = loginHref;
    login.onclick = onLogin
      ? (event) => {
          event.preventDefault();
          onLogin();
        }
      : null;
  }
  if (signup) signup.hidden = !showSignup;
}
