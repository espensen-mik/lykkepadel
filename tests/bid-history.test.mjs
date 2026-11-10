import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Display names and the public bid history (database/bid-history.sql).
const db = new PGlite();
after(() => db.close());
const ids = ['00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000014'];
const [admin, alice, bob, outsider] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `bidder${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql']) {
  await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
}
await db.query('insert into auction_private.admins values($1)', [admin]);

async function as(user, fn) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'};select set_config('request.jwt.claim.sub','${user || ''}',false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const register = (user, name) =>
  as(user, () => db.query(`select public.complete_event_registration('individual',$1,'12345678','Testvej 1, 8000 Aarhus','','Rabat','registration-test-v1')`, [name]));
const setName = (user, name) => as(user, () => db.query('select public.set_auction_display_name($1) as name', [name]));
const bid = (user, lot, amount) => as(user, () => db.query('select public.place_auction_bid($1,$2,gen_random_uuid())', [lot, amount]));
const history = (user, lot) => as(user, () => db.query('select public.auction_bid_history($1) as h', [lot])).then((r) => r.rows[0].h);

let live;
let draft;

test('a display name needs a registration and a sensible length', async () => {
  await assert.rejects(setName(alice, 'Smash & Co.'), /Tilmeld dig/);
  await assert.rejects(as(null, () => db.query("select public.set_auction_display_name('Anonym')")), /permission denied/);
  await register(alice, 'Alice Andersen');
  await register(bob, 'Bob Bertelsen');
  await assert.rejects(setName(alice, 'A'), /mellem 2 og 40/);
  await assert.rejects(setName(alice, 'x'.repeat(41)), /mellem 2 og 40/);
  assert.equal((await setName(alice, '  Smash   &  Co.  ')).rows[0].name, 'Smash & Co.');
});

test('two bidders cannot share a display name, but you can keep or change your own', async () => {
  await assert.rejects(setName(bob, 'smash & co.'), /allerede i brug/);
  assert.equal((await setName(alice, 'SMASH & CO.')).rows[0].name, 'SMASH & CO.');
  assert.equal((await setName(bob, 'Bagvæggen')).rows[0].name, 'Bagvæggen');
});

test('public history shows amounts and display names, newest first, without identities', async () => {
  live = (await as(admin, () => db.query("select public.save_auction_lot(null,'Test Makker','Padelspiller','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'live') as id"))).rows[0].id;
  await bid(alice, live, 500);
  await bid(bob, live, 1500);
  const rows = await history(null, live);
  assert.deepEqual(rows.map((r) => [r.display_name, r.amount, r.is_mine]), [['Bagvæggen', 1500, false], ['SMASH & CO.', 500, false]]);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['amount', 'created_at', 'display_name', 'is_mine']);
  assert.equal(JSON.stringify(rows).includes('@example.test'), false);
  assert.equal(JSON.stringify(rows).includes(alice), false);
});

test('a signed-in bidder can recognise their own bids', async () => {
  const rows = await history(alice, live);
  assert.deepEqual(rows.map((r) => r.is_mine), [false, true]);
});

test('bidders without a display name appear anonymously', async () => {
  await db.query('update public.auction_profiles set display_name=null where user_id=$1', [bob]);
  assert.equal((await history(outsider, live))[0].display_name, 'Anonym budgiver');
});

test('history of draft lots is only visible to admins', async () => {
  draft = (await as(admin, () => db.query("select public.save_auction_lot(null,'Kladde Makker','Musiker','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'draft') as id"))).rows[0].id;
  await db.query("insert into auction_private.bids(lot_id,user_id,amount,request_id) values($1,$2,500,gen_random_uuid())", [draft, alice]);
  assert.deepEqual(await history(null, draft), []);
  assert.equal((await history(admin, draft)).length, 1);
});

test('the bids table itself stays private', async () => {
  await assert.rejects(as(null, () => db.query('select * from auction_private.bids')), /permission denied/);
  await assert.rejects(as(alice, () => db.query("update public.auction_profiles set display_name='Hack'")), /permission denied/);
});
