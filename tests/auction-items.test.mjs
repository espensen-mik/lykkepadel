import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Lykke Auktion: charity products and padel partners (database/auction-items.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-0000000000${20 + i}`);
const [admin, guest, pair, player, unconfirmed, blocked] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,$3,false)', [id, `user${i}@example.test`, id === unconfirmed ? null : new Date()]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql']) {
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
const bidder = (user, display) =>
  as(user, () => db.query("select public.register_auction_bidder('Gæst Hansen','12345678','Testvej 1, 8000 Aarhus',$1) as r", [display]));
const register = (user, kind) =>
  as(user, () => db.query(`select public.complete_event_registration($1,'Test Deltager','12345678','Testvej 1, 8000 Aarhus',$2,'Rabat','registration-test-v1')`, [kind, kind === 'pair' ? 'Test Makker' : '']));
const save = (kind, value) =>
  as(admin, () => db.query("select public.save_auction_lot(null,'Testlot','Oplevelse','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'live',$1,$2) as id", [kind, value])).then((r) => r.rows[0].id);
const bid = (user, lot, amount) => as(user, () => db.query('select public.place_auction_bid($1,$2,gen_random_uuid())', [lot, amount]));

let item;
let partner;

test('admins save charity products and partners with kind and value', async () => {
  item = await save('item', ' Uvurderligt ');
  partner = await save('partner', null);
  const rows = (await db.query('select id,kind,value_text from public.auction_lots order by created_at')).rows;
  assert.deepEqual(rows.map((r) => [r.kind, r.value_text]), [['item', 'Uvurderligt'], ['partner', null]]);
  await assert.rejects(save('car', null), /padelmakker eller charity-produkt/);
});

test('the old save function still works and saves a partner', async () => {
  const id = (await as(admin, () => db.query("select public.save_auction_lot(null,'Gammel','Padelspiller','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'draft') as id"))).rows[0].id;
  assert.equal((await db.query('select kind from public.auction_lots where id=$1', [id])).rows[0].kind, 'partner');
});

test('anyone with a confirmed mail can create a free bidder profile', async () => {
  await assert.rejects(as(null, () => db.query("select public.register_auction_bidder('A B','12345678','Testvej 1','Navn')")), /permission denied/);
  await assert.rejects(bidder(unconfirmed, 'Uden Mail'), /Bekræft/);
  assert.equal((await bidder(guest, 'Smash & Co.')).rows[0].r.display_name, 'Smash & Co.');
  await assert.rejects(bidder(blocked, 'smash & co.'), /allerede i brug/);
});

test('a guest can bid on charity products but not on padel partners', async () => {
  await bid(guest, item, 500);
  await assert.rejects(bid(guest, partner, 500), /Kun individuelle deltagere/);
});

test('pairs can bid on products, only individual players on partners', async () => {
  await register(pair, 'pair');
  await register(player, 'individual');
  await bid(pair, item, 1000);
  await assert.rejects(bid(pair, partner, 500), /Kun individuelle deltagere/);
  await bid(player, partner, 500);
  await bid(player, item, 1500);
});

test('a blocked profile cannot bid on anything', async () => {
  await bidder(blocked, 'Blokeret Bent');
  await as(admin, () => db.query('select public.approve_auction_bidder($1,false)', [blocked]));
  await assert.rejects(bid(blocked, item, 2000), /blokeret|Opret en profil/);
});

test('without a profile there is no bidding', async () => {
  await assert.rejects(bid(ids[4], item, 2000), /Opret en profil/);
});

test('history shows bids on both kinds with display names only', async () => {
  const h = (await as(null, () => db.query('select public.auction_bid_history($1) as h', [item]))).rows[0].h;
  assert.deepEqual(h.map((r) => r.amount), [1500, 1000, 500]);
  assert.equal(JSON.stringify(h).includes('@example.test'), false);
});
