import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/winner-mails.mjs';
import { winnerMail } from '../src/winner-mail.js';

const LOT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const winner = { id: LOT, name: 'Personlig video-hyldest', kind: 'item', amount: 12500, full_name: 'Anna <b>Hansen</b>', email: 'anna@example.test', billing_address: 'Testvej 1\n8000 Aarhus' };

function response() {
  return { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
}
let calls;
function fake({ admin = true, resendOk = true } = {}) {
  calls = [];
  return async (url, init) => {
    const href = String(url);
    calls.push({ href, init });
    if (href.endsWith('/rpc/auction_winners')) return { ok: admin, json: async () => [winner] };
    if (href.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'admin@lykkeliga.dk' }) };
    if (href.includes('resend.com')) return { ok: resendOk, json: async () => ({ message: 'nope' }) };
    if (href.endsWith('/rpc/mark_auction_winner_mail')) return { ok: true, json: async () => null };
    throw new Error('unexpected ' + href);
  };
}
const call = async (body, options, auth = 'Bearer abc.def') => {
  const res = response();
  await handler({ method: 'POST', headers: { authorization: auth }, body }, res, { fetch: options, pause: async () => {} });
  return res;
};

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://demo.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x';
  process.env.RESEND_API_KEY = 're_x';
});

test('the mail names the prize and amount and escapes the winner data', () => {
  const mail = winnerMail(winner);
  assert.match(mail.subject, /Personlig video-hyldest/);
  assert.match(mail.html, /12\.500 kr\./);
  assert.match(mail.html, /Anna &lt;b&gt;Hansen&lt;\/b&gt;/);
  assert.doesNotMatch(mail.html, /<b>Hansen/);
  assert.match(winnerMail({ ...winner, kind: 'partner', name: 'Emil' }).subject, /spille padel med Emil/);
});

test('needs a key, a login and a request id', async () => {
  delete process.env.RESEND_API_KEY;
  assert.equal((await call({ lots: [LOT], request: REQUEST }, fake())).statusCode, 503);
  process.env.RESEND_API_KEY = 're_x';
  assert.equal((await call({ lots: [LOT], request: REQUEST }, fake(), '')).statusCode, 401);
  assert.equal((await call({ lots: [LOT] }, fake())).statusCode, 400);
});

test('non-admins are refused before anything is sent', async () => {
  const res = await call({ lots: [LOT], request: REQUEST }, fake({ admin: false }));
  assert.equal(res.statusCode, 403);
  assert.ok(!calls.some((c) => c.href.includes('resend.com')));
});

test('sends to the winner, marks it, and skips lots without a winner', async () => {
  const res = await call({ lots: [LOT, OTHER], request: REQUEST }, fake());
  assert.deepEqual(res.body.sent, [LOT]);
  assert.equal(res.body.failed[0].id, OTHER);
  const mail = calls.find((c) => c.href.includes('resend.com'));
  const payload = JSON.parse(mail.init.body);
  assert.deepEqual(payload.to, ['anna@example.test']);
  assert.equal(payload.reply_to, 'signe@lykkeliga.dk');
  assert.equal(mail.init.headers['Idempotency-Key'], `winner-${LOT}-${REQUEST}`);
  const mark = calls.find((c) => c.href.endsWith('/rpc/mark_auction_winner_mail'));
  assert.deepEqual(JSON.parse(mark.init.body), { p_lot: LOT, p_email: 'anna@example.test' });
  assert.equal(mark.init.headers.Authorization, 'Bearer abc.def');
});

test('a test mail goes to the admin and marks nothing', async () => {
  const res = await call({ lots: [LOT], request: REQUEST, test: true }, fake());
  assert.equal(res.body.to, 'admin@lykkeliga.dk');
  const payload = JSON.parse(calls.find((c) => c.href.includes('resend.com')).init.body);
  assert.deepEqual(payload.to, ['admin@lykkeliga.dk']);
  assert.match(payload.subject, /^\[Test\]/);
  assert.ok(!calls.some((c) => c.href.endsWith('/rpc/mark_auction_winner_mail')));
});

test('a refused mail is reported and not marked', async () => {
  const res = await call({ lots: [LOT], request: REQUEST }, fake({ resendOk: false }));
  assert.equal(res.statusCode, 502);
  assert.match(res.body.failed[0].error, /Resend afviste/);
  assert.ok(!calls.some((c) => c.href.endsWith('/rpc/mark_auction_winner_mail')));
});
