import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Deleting cancelled registrations and bidders (database/delete-people.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-0000-0000-0000000000${60 + i}`);
const [admin, cancelled, confirmed, quiet, bidder] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'delete-people.sql']) {
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
const register = (user) =>
  as(user, () => db.query("select public.complete_event_registration('individual','Test Deltager','12345678','Testvej 1, 8000 Aarhus','','Rabat','registration-test-v1') as r")).then((r) => r.rows[0].r.id);
const profileOnly = (user, name) => as(user, () => db.query("select public.register_auction_bidder('Gæst Hansen','12345678','Testvej 1, 8000 Aarhus',$1)", [name]));
const count = async (sql, arg) => Number((await db.query(sql, [arg])).rows[0].n);
const profiles = (user) => count('select count(*) n from public.auction_profiles where user_id=$1', user);
const registrations = (id) => count('select count(*) n from public.event_registrations where id=$1', id);

const cancelledId = await register(cancelled);
await as(admin, () => db.query('select public.cancel_event_registration($1)', [cancelledId]));
const confirmedId = await register(confirmed);
await profileOnly(quiet, 'Den stille');
await profileOnly(bidder, 'Budgiveren');
const lot = (await as(admin, () => db.query("select public.save_auction_lot(null,'Testlot','Oplevelse','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'live','item',null) as id"))).rows[0].id;
await as(bidder, () => db.query('select public.place_auction_bid($1,500,gen_random_uuid())', [lot]));

test('only cancelled registrations can be deleted, and only by admins', async () => {
  await assert.rejects(as(confirmed, () => db.query('select public.delete_event_registration($1)', [cancelledId])), /Kun administratorer/);
  await assert.rejects(as(admin, () => db.query('select public.delete_event_registration($1)', [confirmedId])), /Annuller tilmeldingen/);
  await as(admin, () => db.query('select public.delete_event_registration($1)', [cancelledId]));
  assert.equal(await registrations(cancelledId), 0);
  assert.equal(await registrations(confirmedId), 1);
  // The bidder profile is separate and stays.
  assert.equal(await profiles(cancelled), 1);
});

test('bidders without bids can be deleted; bids and confirmed participants protect them', async () => {
  await assert.rejects(as(quiet, () => db.query('select public.delete_auction_bidder($1)', [quiet])), /Kun administratorer/);
  await assert.rejects(as(admin, () => db.query('select public.delete_auction_bidder($1)', [bidder])), /med bud kan ikke slettes/);
  await assert.rejects(as(admin, () => db.query('select public.delete_auction_bidder($1)', [confirmed])), /tilmeldt turneringen/);
  await as(admin, () => db.query('select public.delete_auction_bidder($1)', [quiet]));
  await as(admin, () => db.query('select public.delete_auction_bidder($1)', [cancelled]));
  assert.equal(await profiles(quiet), 0);
  assert.equal(await profiles(cancelled), 0);
  assert.equal(await profiles(bidder), 1);
  const audit = await count("select count(*) n from auction_private.audit where action=$1", 'delete_bidder');
  assert.equal(audit, 2);
});

test('a deleted bidder can make a new profile', async () => {
  await profileOnly(quiet, 'Den stille igen');
  assert.equal(await profiles(quiet), 1);
});

test('anon cannot call the delete functions', async () => {
  await assert.rejects(as(null, () => db.query('select public.delete_event_registration(gen_random_uuid())')), /permission denied/);
  await assert.rejects(as(null, () => db.query('select public.delete_auction_bidder(gen_random_uuid())')), /permission denied/);
});
