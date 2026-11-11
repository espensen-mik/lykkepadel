import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Tickets for Charity Showkamp (database/tickets.sql).
const db = new PGlite();
after(() => db.close());
const admin = '00000000-0000-0000-0000-000000000090';
const other = '00000000-0000-0000-0000-000000000091';

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const id of [admin, other]) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `${id.slice(-2)}@example.test`]);
for (const file of ['auction-setup.sql', 'tickets.sql', 'ticket-order-numbers.sql']) await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
await db.query('insert into auction_private.admins values($1)', [admin]);

async function as(user, fn) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'};select set_config('request.jwt.claim.sub','${user || ''}',false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const one = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const order = (qty = 2, extra = {}) => {
  const v = { name: 'Anna Hansen', email: 'Anna@Example.test', phone: '', company: '', cvr: '', address: '', terms: 'tickets-v1', ...extra };
  return as(null, () => one('select public.create_ticket_order($1,$2,$3,$4,$5,$6,$7,$8)', [qty, v.name, v.email, v.phone, v.company, v.cvr, v.address, v.terms]));
};
const view = (o, token = o.token) => as(null, () => one('select public.ticket_order($1,$2)', [o.id, token]));
const pay = (o) => as(null, () => one('select public.pay_test_ticket_order($1,$2)', [o.id, o.token]));
const setting = (sql) => db.exec(`update auction_private.ticket_settings set ${sql}`);

test('anyone can see price and availability', async () => {
  const info = await as(null, () => one('select public.ticket_info()'));
  assert.deepEqual({ price: info.price, remaining: info.remaining, test: info.test_mode }, { price: 200, remaining: 500, test: true });
});

test('an order is validated, priced on the server and needs the token', async () => {
  await assert.rejects(order(0), /mellem 1 og 10/);
  await assert.rejects(order(11), /mellem 1 og 10/);
  await assert.rejects(order(1, { terms: '' }), /handelsbetingelserne/);
  await assert.rejects(order(1, { email: 'nope' }), /mailadresse/);
  await assert.rejects(order(1, { company: 'Firma ApS', cvr: '123' }), /CVR/);
  const o = await order(3);
  assert.equal(o.amount, 600);
  assert.equal(o.is_test, true);
  await assert.rejects(view(o, 'wrong'), /linket er forkert/);
  const seen = await view(o);
  assert.equal(seen.status, 'pending');
  assert.equal(seen.email, 'anna@example.test');
  assert.deepEqual(seen.tickets, []);
});

test('a test payment issues one unique ticket per person and a test receipt number', async () => {
  const o = await order(3, { company: 'Firma ApS', cvr: '12345678', address: 'Vej 1, 8000 Aarhus' });
  const paid = await pay(o);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.company_cvr, '12345678');
  assert.match(paid.receipt, /^TEST-\d{4}$/);
  assert.equal(paid.tickets.length, 3);
  assert.equal(new Set(paid.tickets.map((t) => t.code)).size, 3);
  assert.ok(paid.tickets.every((t) => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(t.code) && t.is_test));
  // Paying again changes nothing.
  assert.deepEqual((await pay(o)).tickets.map((t) => t.code), paid.tickets.map((t) => t.code));
});

test('the receipt is claimed once and can be released when sending fails', async () => {
  const o = await order(1);
  const claim = (c) => as(null, () => one('select public.claim_ticket_receipt($1,$2,$3)', [o.id, o.token, c]));
  assert.equal(await claim(true), false, 'unpaid orders have no receipt');
  await pay(o);
  assert.equal(await claim(true), true);
  assert.equal(await claim(true), false);
  await claim(false);
  assert.equal(await claim(true), true);
});

test('real orders count against capacity and expire if unpaid', async () => {
  await setting('test_mode=false, capacity=5');
  const o = await order(4);
  assert.equal(o.is_test, false);
  await assert.rejects(order(2, { email: 'b@example.test' }), /ikke flere billetter/);
  await assert.rejects(pay(o), /betalingsvinduet/);
  await db.query("update public.ticket_orders set expires_at=now()-interval '1 second' where id=$1", [o.id]);
  assert.equal((await view(o)).status, 'expired');
  await order(5, { email: 'c@example.test' });
  // Real receipts get their own number series.
  const c = (await db.query("select id from public.ticket_orders where email='c@example.test'")).rows[0].id;
  await db.query('select auction_private.fulfil_ticket_order($1)', [c]);
  assert.match(await one("select auction_private.ticket_order_json($1)->>'receipt'", [c]), /^LP-\d{4}-0001$/);
  await setting('test_mode=true, capacity=500');
});

test('three unpaid orders per mail at most', async () => {
  for (let i = 0; i < 3; i++) await order(1, { email: 'spam@example.test' });
  await assert.rejects(order(1, { email: 'spam@example.test' }), /venter på betaling/);
});

test('only admins see orders, check in and cancel', async () => {
  assert.equal((await as(null, () => db.query('select 1 from public.ticket_orders').catch((e) => e))).message, 'permission denied for table ticket_orders');
  assert.equal((await as(other, () => db.query('select 1 from public.ticket_orders'))).rows.length, 0);
  assert.ok((await as(admin, () => db.query('select 1 from public.ticket_orders'))).rows.length > 0);
  await assert.rejects(as(other, () => db.query("select public.check_in_ticket('X',false)")), /Kun administratorer/);
  await assert.rejects(as(null, () => db.query("select public.check_in_ticket('X',false)")), /permission denied/);
});

test('check-in accepts a real ticket once, warns about test and cancelled tickets', async () => {
  const check = (code, undo = false) => as(admin, () => one('select public.check_in_ticket($1,$2)', [code, undo]));
  assert.equal((await check('NOPE-NOPE')).result, 'unknown');
  const real = (await db.query("select code from public.tickets where not is_test limit 2")).rows.map((r) => r.code);
  const first = await check(real[0].toLowerCase());
  assert.equal(first.result, 'ok');
  assert.equal(first.checked_in, 1);
  assert.equal((await check(real[0])).result, 'used');
  assert.equal((await check(real[0], true)).result, 'undone');
  assert.equal((await check(real[0])).result, 'ok');
  const testCode = (await db.query('select code from public.tickets where is_test limit 1')).rows[0].code;
  assert.equal((await check(testCode)).result, 'test');
  const orderId = (await db.query('select order_id from public.tickets where code=$1', [real[1]])).rows[0].order_id;
  await as(admin, () => db.query('select public.cancel_ticket_order($1)', [orderId]));
  assert.equal((await check(real[1])).result, 'void');
});

test('the admin can fetch the token to resend a receipt; others cannot', async () => {
  const o = await order(1, { email: 'token@example.test' });
  assert.equal(await as(admin, () => one('select public.admin_ticket_token($1)', [o.id])), o.token);
  await assert.rejects(as(other, () => db.query('select public.admin_ticket_token($1)', [o.id])), /Kun administratorer/);
});

test('every order gets a QuickPay-ready order number, with its own series for tests', async () => {
  const rows = (await db.query('select order_no, is_test from public.ticket_orders order by order_no')).rows;
  assert.ok(rows.length > 5);
  assert.equal(new Set(rows.map((r) => r.order_no)).size, rows.length);
  for (const r of rows) {
    assert.match(r.order_no, r.is_test ? /^LPT\d{5}$/ : /^LP\d{5}$/);
    assert.ok(r.order_no.length >= 4 && r.order_no.length <= 20);
  }
  const o = await order(1, { email: 'number@example.test' });
  assert.match((await view(o)).order_no, /^LPT\d{5}$/);
});
