import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Paying by invoice and marking payments (database/invoice-payments.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-0000000000${70 + i}`);
const [admin, invoiced, coupon, pair, guest, early] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
const run = async (file) => db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql']) await run(file);
await db.query('insert into auction_private.admins values($1)', [admin]);

async function as(user, fn) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'};select set_config('request.jwt.claim.sub','${user || ''}',false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const register = (user, kind, code) =>
  as(user, () => db.query("select public.complete_event_registration($1,'Test Deltager','12345678','Testvej 1, 8000 Aarhus',$2,$3,'registration-test-v1') as r", [kind, kind === 'pair' ? 'Test Makker' : '', code])).then((r) => r.rows[0].r);

// A registration made before the file runs keeps working afterwards.
const before = await register(early, 'individual', 'Rabat');
await run('invoice-payments.sql');

test('without a code the registration is invoiced at full price', async () => {
  const r = await register(invoiced, 'individual', '');
  assert.equal(r.settlement, 'invoice');
  assert.equal(r.amount_due, 10000);
  assert.equal(r.discount_code, null);
  const p = await register(pair, 'pair', '');
  assert.equal(p.amount_due, 25000);
});

test('a valid code still makes it free, and old registrations are untouched', async () => {
  const r = await register(coupon, 'individual', 'Rabat');
  assert.equal(r.settlement, 'discount');
  assert.equal(r.amount_due, 0);
  const old = (await db.query('select settlement, amount_due from public.event_registrations where id=$1', [before.id])).rows[0];
  assert.deepEqual(old, { settlement: 'discount', amount_due: 0 });
});

test('invoiced individual participants can bid on padel partners before paying', async () => {
  const lot = (await as(admin, () => db.query("select public.save_auction_lot(null,'Makker','Padelspiller','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'live','partner',null) as id"))).rows[0].id;
  assert.equal((await as(invoiced, () => db.query('select public.event_bid_access() as a'))).rows[0].a, true);
  await as(invoiced, () => db.query('select public.place_auction_bid($1,500,gen_random_uuid())', [lot]));
  await assert.rejects(as(pair, () => db.query('select public.place_auction_bid($1,1000,gen_random_uuid())', [lot])), /individuelle deltagere/);
});

test('admins mark registrations as invoiced and paid', async () => {
  const id = (await db.query('select id from public.event_registrations where user_id=$1', [invoiced])).rows[0].id;
  const mark = (user, sent, paid) => as(user, () => db.query('select public.set_registration_payment($1,$2,$3)', [id, sent, paid]));
  await assert.rejects(mark(invoiced, true, null), /Kun administratorer/);
  await mark(admin, true, null);
  let row = (await db.query('select invoice_sent_at, paid_at from public.event_registrations where id=$1', [id])).rows[0];
  assert.ok(row.invoice_sent_at);
  assert.equal(row.paid_at, null);
  await mark(admin, null, true);
  row = (await db.query('select invoice_sent_at, paid_at from public.event_registrations where id=$1', [id])).rows[0];
  assert.ok(row.invoice_sent_at && row.paid_at);
  await mark(admin, null, false);
  assert.equal((await db.query('select paid_at from public.event_registrations where id=$1', [id])).rows[0].paid_at, null);
  const free = (await db.query('select id from public.event_registrations where user_id=$1', [coupon])).rows[0].id;
  await assert.rejects(as(admin, () => db.query('select public.set_registration_payment($1,true,null)', [free])), /skal ikke faktureres/);
});

test('admins mark won auctions as invoiced and paid, and the winner list shows it', async () => {
  await as(guest, () => db.query("select public.register_auction_bidder('Gæst Hansen','12345678','Testvej 1, 8000 Aarhus','Gæsten')"));
  const lot = (await as(admin, () => db.query("select public.save_auction_lot(null,'Oplevelse','Oplevelse','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'live','item',null) as id"))).rows[0].id;
  await assert.rejects(as(admin, () => db.query('select public.set_auction_lot_payment($1,true,null)', [lot])), /ikke afsluttet/);
  await as(guest, () => db.query('select public.place_auction_bid($1,1500,gen_random_uuid())', [lot]));
  await db.query("update public.auction_lots set ends_at=now()-interval '1 minute' where id=$1", [lot]);
  await as(admin, () => db.query('select public.set_auction_lot_payment($1,true,true)', [lot]));
  await assert.rejects(as(guest, () => db.query('select public.set_auction_lot_payment($1,false,false)', [lot])), /Kun administratorer/);
  const winners = (await as(admin, () => db.query('select public.auction_winners() as w'))).rows[0].w;
  const won = winners.find((w) => w.id === lot);
  assert.equal(won.amount, 1500);
  assert.ok(won.invoice_sent_at && won.paid_at);
});

test('anon cannot mark payments', async () => {
  await assert.rejects(as(null, () => db.query('select public.set_registration_payment(gen_random_uuid(),true,true)')), /permission denied/);
  await assert.rejects(as(null, () => db.query('select public.set_auction_lot_payment(gen_random_uuid(),true,true)')), /permission denied/);
});
