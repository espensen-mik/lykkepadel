import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Start time, trash and image bucket (database/auction-admin-tools.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-0000-0000-0000000000${40 + i}`);
const [admin, guest, other] = ids;

// Stand-ins for Supabase Auth and Storage.
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'auction-admin-tools.sql']) {
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
const save = (user, { id = null, starts = null, ends = "now()+interval '2 days'", status = 'live' } = {}) =>
  as(user, () =>
    db.query(
      `select public.save_auction_lot($1,'Testlot','Oplevelse','En god testbeskrivelse','https://example.test/p.jpg',${starts},${ends},500,$2,'item',null) as id`,
      [id, status],
    ),
  ).then((r) => r.rows[0].id);
const bid = (user, lot, amount) => as(user, () => db.query('select public.place_auction_bid($1,$2,gen_random_uuid())', [lot, amount]));
const statusOf = async (lot) => (await db.query('select status from public.auction_lots where id=$1', [lot])).rows[0]?.status;

await as(guest, () => db.query("select public.register_auction_bidder('Gæst Hansen','12345678','Testvej 1, 8000 Aarhus','Gæsten')"));
await as(other, () => db.query("select public.register_auction_bidder('Anden Hansen','12345678','Testvej 1, 8000 Aarhus','Den anden')"));

test('only admins save, and the start must come before the end', async () => {
  await assert.rejects(save(guest), /Kun administratorer/);
  await assert.rejects(save(admin, { starts: "now()+interval '3 days'" }), /før sluttidspunktet/);
  await assert.rejects(save(admin, { status: 'trashed' }), /kladde eller live/);
  const lot = await save(admin, { starts: "now()+interval '1 day'" });
  assert.ok((await db.query('select starts_at from public.auction_lots where id=$1', [lot])).rows[0].starts_at);
});

test('no bids before the start time, bids after it', async () => {
  const later = await save(admin, { starts: "now()+interval '1 hour'" });
  await assert.rejects(bid(guest, later, 500), /ikke startet/);
  const open = await save(admin, { starts: "now()-interval '1 hour'" });
  await bid(guest, open, 500);
  const immediate = await save(admin);
  await bid(guest, immediate, 500);
});

test('the older save function still works and keeps the start time', async () => {
  const lot = await save(admin, { starts: "now()+interval '1 hour'" });
  await as(admin, () =>
    db.query("select public.save_auction_lot($1,'Nyt navn','Oplevelse','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '2 days',500,'draft','item',null)", [lot]),
  );
  const row = (await db.query('select name, starts_at from public.auction_lots where id=$1', [lot])).rows[0];
  assert.equal(row.name, 'Nyt navn');
  assert.ok(row.starts_at);
});

test('trash hides a lot from the public and restores it as a draft', async () => {
  await db.exec('update auction_private.settings set is_open=true');
  const lot = await save(admin);
  const visible = async () => (await as(null, () => db.query('select id from public.auction_lots where id=$1', [lot]))).rows.length;
  assert.equal(await visible(), 1);
  await assert.rejects(as(guest, () => db.query('select public.trash_auction_lot($1,true)', [lot])), /Kun administratorer/);
  await as(admin, () => db.query('select public.trash_auction_lot($1,true)', [lot]));
  assert.equal(await statusOf(lot), 'trashed');
  assert.equal(await visible(), 0);
  await assert.rejects(bid(guest, lot, 500), /ikke åben/);
  await assert.rejects(save(admin, { id: lot }), /Gendan auktionen/);
  await assert.rejects(as(admin, () => db.query('select public.trash_auction_lot($1,true)', [lot])), /allerede/);
  await as(admin, () => db.query('select public.trash_auction_lot($1,false)', [lot]));
  assert.equal(await statusOf(lot), 'draft');
});

test('delete only works from the trash and never on lots with bids', async () => {
  const empty = await save(admin);
  await assert.rejects(as(admin, () => db.query('select public.delete_auction_lot($1)', [empty])), /papirkurven først/);
  await as(admin, () => db.query('select public.trash_auction_lot($1,true)', [empty]));
  await assert.rejects(as(guest, () => db.query('select public.delete_auction_lot($1)', [empty])), /Kun administratorer/);
  await as(admin, () => db.query('select public.delete_auction_lot($1)', [empty]));
  assert.equal(await statusOf(empty), undefined);

  const withBids = await save(admin);
  await bid(other, withBids, 500);
  await as(admin, () => db.query('select public.trash_auction_lot($1,true)', [withBids]));
  await assert.rejects(as(admin, () => db.query('select public.delete_auction_lot($1)', [withBids])), /med bud kan ikke slettes/);
  assert.equal(await statusOf(withBids), 'trashed');
});

test('anon cannot call the new functions', async () => {
  await assert.rejects(as(null, () => db.query('select public.trash_auction_lot(gen_random_uuid(),true)')), /permission denied/);
  await assert.rejects(as(null, () => db.query('select public.delete_auction_lot(gen_random_uuid())')), /permission denied/);
});

test('only admins can upload to the image bucket', async () => {
  const bucket = (await db.query("select public, allowed_mime_types from storage.buckets where id='auction-images'")).rows[0];
  assert.equal(bucket.public, true);
  await as(admin, () => db.query("insert into storage.objects(bucket_id,name) values('auction-images','lots/a.jpg')"));
  await assert.rejects(as(guest, () => db.query("insert into storage.objects(bucket_id,name) values('auction-images','lots/b.jpg')")), /row-level security/);
  await assert.rejects(as(admin, () => db.query("insert into storage.objects(bucket_id,name) values('other','x.jpg')")), /row-level security/);
  const deleted = await as(guest, () => db.query("delete from storage.objects where bucket_id='auction-images' returning id"));
  assert.equal(deleted.rows.length, 0);
  const removed = await as(admin, () => db.query("delete from storage.objects where name='lots/a.jpg' returning id"));
  assert.equal(removed.rows.length, 1);
});
