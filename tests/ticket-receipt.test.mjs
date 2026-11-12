import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/ticket-receipt.mjs';
import { ticketMail } from '../src/ticket-receipt.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(64);
const order = {
  id: ID, status: 'paid', is_test: false, quantity: 2, unit_price: 200, amount: 400, receipt: 'LP-2027-0001', order_no: 'LP00001', paid_at: '2027-03-01T10:00:00Z',
  buyer_name: 'Anna <i>Hansen</i>', email: 'anna@example.test', company_name: 'Firma ApS', company_cvr: '12345678', company_address: 'Vej 1, 8000 Aarhus',
  tickets: [{ code: 'AB12-CD34' }, { code: 'EF56-7890' }],
};
function response() {
  return { statusCode: 0, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
}
let calls;
function fake({ claimed = true, resendOk = true, admin = true, current = order } = {}) {
  calls = [];
  return async (url, init) => {
    const href = String(url);
    calls.push({ href, init, body: init.body ? JSON.parse(init.body) : null });
    if (href.endsWith('/rpc/admin_ticket_token')) return { ok: admin, json: async () => TOKEN };
    if (href.endsWith('/rpc/ticket_order')) return { ok: true, json: async () => current };
    if (href.endsWith('/rpc/claim_ticket_receipt')) return { ok: true, json: async () => (JSON.parse(init.body).p_claim ? claimed : true) };
    if (href.includes('resend.com')) return { ok: resendOk, json: async () => ({}) };
    throw new Error(href);
  };
}
const call = async (body, options, headers = {}) => {
  const res = response();
  await handler({ method: 'POST', headers: { host: 'www.lykkepadel.dk', ...headers }, body }, res, { fetch: options });
  return res;
};
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://demo.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x';
  process.env.Resend_Api_Key = 're_x';
});

test('the mail has the ticket link, codes and a receipt with seller, buyer and no VAT', () => {
  const mail = ticketMail(order, `https://www.lykkepadel.dk/billet#${ID}.${TOKEN}`);
  assert.match(mail.subject, /kvittering LP-2027-0001/);
  assert.match(mail.html, /billet#11111111/);
  assert.match(mail.html, /AB12-CD34, EF56-7890/);
  assert.match(mail.html, /CVR 38523252/);
  assert.match(mail.html, /CVR 12345678/);
  assert.match(mail.html, /2 × billet til Charity Showkamp à 200 kr\./);
  assert.match(mail.text, /ikke momsregistreret/);
  assert.match(mail.html, /Ordre: LP00001/);
  assert.match(mail.text, /Ordre: LP00001/);
  assert.match(mail.html, /Anna &lt;i&gt;Hansen/);
  assert.match(ticketMail({ ...order, is_test: true }, 'x').subject, /^\[TEST\]/);
});

test('the buyer gets the mail once', async () => {
  const res = await call({ order: ID, token: TOKEN }, fake());
  assert.equal(res.body.sent, true);
  const mail = calls.find((c) => c.href.includes('resend.com')).body;
  assert.deepEqual(mail.to, ['anna@example.test']);
  assert.match(mail.html, new RegExp(`https://www.lykkepadel.dk/billet#${ID}.${TOKEN}`));
  const again = await call({ order: ID, token: TOKEN }, fake({ claimed: false }));
  assert.equal(again.body.sent, false);
  assert.ok(!calls.some((c) => c.href.includes('resend.com')));
});

test('a failed send releases the claim so it can be tried again', async () => {
  const res = await call({ order: ID, token: TOKEN }, fake({ resendOk: false }));
  assert.equal(res.statusCode, 502);
  assert.equal(calls.filter((c) => c.href.endsWith('/rpc/claim_ticket_receipt')).at(-1).body.p_claim, false);
});

test('unpaid orders and bad input get no mail', async () => {
  assert.equal((await call({ order: ID, token: TOKEN }, fake({ current: { ...order, status: 'pending' } }))).statusCode, 409);
  assert.equal((await call({ order: 'x', token: TOKEN }, fake())).statusCode, 400);
  assert.equal((await call({ order: ID }, fake())).statusCode, 400);
});

test('an admin can resend with their session; others cannot', async () => {
  const res = await call({ order: ID }, fake(), { authorization: 'Bearer abc.def' });
  assert.equal(res.body.sent, true);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer abc.def');
  const claims = calls.filter((c) => c.href.endsWith('/rpc/claim_ticket_receipt'));
  assert.equal(claims.length, 1, 'the resend is not blocked by an earlier send');
  assert.ok(calls.indexOf(claims[0]) > calls.findIndex((c) => c.href.includes('resend.com')), 'marked as sent only after the mail went out');
  assert.equal(claims[0].body.p_claim, true);
  assert.equal((await call({ order: ID }, fake({ admin: false }), { authorization: 'Bearer abc.def' })).statusCode, 403);
});

test('mail links never point to a foreign host', async () => {
  await call({ order: ID, token: TOKEN }, fake(), { host: 'evil.example' });
  assert.match(calls.find((c) => c.href.includes('resend.com')).body.html, /https:\/\/www\.lykkepadel\.dk\/billet#/);
});
