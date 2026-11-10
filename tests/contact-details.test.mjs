import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Min side: correcting your own name, phone and billing address (database/contact-details.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-0000-0000-0000000000${80 + i}`);
const [bidder, player, nobody] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'contact-details.sql']) {
  await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
}

async function as(user, fn) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'};select set_config('request.jwt.claim.sub','${user || ''}',false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const update = (user, name, phone, address) => as(user, () => db.query('select public.update_my_contact($1,$2,$3) as r', [name, phone, address])).then((r) => r.rows[0].r);
const row = (table, user) => db.query(`select full_name, phone, billing_address from public.${table} where user_id=$1`, [user]).then((r) => r.rows[0]);

test('a bidder corrects their own profile', async () => {
  await as(bidder, () => db.query("select public.register_auction_bidder('Gammelt Navn','12345678','Testvej 1, 8000 Aarhus','Budgiver')"));
  await update(bidder, ' Nyt Navn ', '87654321', 'Ny vej 2, 8000 Aarhus');
  assert.deepEqual(await row('auction_profiles', bidder), { full_name: 'Nyt Navn', phone: '87654321', billing_address: 'Ny vej 2, 8000 Aarhus' });
});

test('a participant updates both the registration and the bidder profile', async () => {
  await as(player, () => db.query("select public.complete_event_registration('individual','Test Spiller','12345678','Testvej 1, 8000 Aarhus','','Rabat','registration-test-v1')"));
  await update(player, 'Rettet Spiller', '+45 11 22 33 44', 'Firmavej 3, 8000 Aarhus');
  assert.equal((await row('event_registrations', player)).full_name, 'Rettet Spiller');
  assert.equal((await row('auction_profiles', player)).billing_address, 'Firmavej 3, 8000 Aarhus');
});

test('bad input, no profile and anonymous users are rejected', async () => {
  await assert.rejects(update(bidder, 'A', '12345678', 'Testvej 1'), /korrekt/);
  await assert.rejects(update(bidder, 'Navn Navn', 'abc', 'Testvej 1'), /korrekt/);
  await assert.rejects(update(nobody, 'Navn Navn', '12345678', 'Testvej 1'), /Opret en profil/);
  await assert.rejects(as(null, () => db.query("select public.update_my_contact('Navn Navn','12345678','Testvej 1')")), /permission denied/);
});
