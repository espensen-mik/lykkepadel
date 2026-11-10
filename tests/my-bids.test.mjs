import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Min side: a bidder sees their own bids and whether they lead (database/my-bids.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-0000-0000-0000000000${40 + i}`);
const [admin, anna, bo] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'my-bids.sql']) {
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
const save = (name, status = 'live') =>
  as(admin, () => db.query("select public.save_auction_lot(null,$1,'Oplevelse','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,$2,'item',null) as id", [name, status])).then((r) => r.rows[0].id);
const bid = (user, lot, amount) => as(user, () => db.query('select public.place_auction_bid($1,$2,gen_random_uuid())', [lot, amount]));
const mine = (user) => as(user, () => db.query('select public.my_auction_bids() as b')).then((r) => r.rows[0].b);

test('a bidder sees each lot once with their highest bid and whether they lead', async () => {
  for (const user of [anna, bo]) await as(user, () => db.query("select public.register_auction_bidder('Test Person','12345678','Testvej 1, 8000 Aarhus',$1)", [`Navn ${user.slice(-2)}`]));
  const kurv = await save('Kurv');
  const bold = await save('Bold');
  await save('Ingen bud');
  await bid(anna, kurv, 500);
  await bid(bo, kurv, 1000);
  await bid(anna, kurv, 1500);
  await bid(anna, bold, 500);
  await bid(bo, bold, 1000);

  const rows = await mine(anna);
  assert.deepEqual(rows.map((r) => [r.name, r.my_bid, r.my_bid_count, r.current_bid, r.leading, r.ended]).sort(), [
    ['Bold', 500, 1, 1000, false, false],
    ['Kurv', 1500, 2, 1500, true, false],
  ]);
  assert.equal(JSON.stringify(rows).includes(bo), false);
  assert.equal((await mine(bo)).find((r) => r.name === 'Bold').leading, true);
});

test('drafted lots are hidden and nobody else can read the list', async () => {
  const id = (await db.query("select id from public.auction_lots where name='Bold'")).rows[0].id;
  await db.query("update public.auction_lots set status='draft' where id=$1", [id]);
  assert.deepEqual((await mine(anna)).map((r) => r.name), ['Kurv']);
  await assert.rejects(as(null, () => db.query('select public.my_auction_bids()')), /permission denied/);
});
