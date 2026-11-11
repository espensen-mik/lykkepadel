import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Remembering sent winner mails (database/winner-mails.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-0000-0000-0000000000${80 + i}`);
const [admin, winner, loser] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `User${i}@Example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'invoice-payments.sql', 'winner-mails.sql']) {
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
for (const [user, name] of [[winner, 'Vinderen'], [loser, 'Taberen']]) {
  await as(user, () => db.query("select public.register_auction_bidder('Test Person','12345678','Testvej 1, 8000 Aarhus',$1)", [name]));
}
const lot = (await as(admin, () => db.query("select public.save_auction_lot(null,'Oplevelse','Oplevelse','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'live','item','Uvurderligt') as id"))).rows[0].id;
await as(loser, () => db.query('select public.place_auction_bid($1,500,gen_random_uuid())', [lot]));
await as(winner, () => db.query('select public.place_auction_bid($1,1000,gen_random_uuid())', [lot]));
const mark = (user, email) => as(user, () => db.query('select public.mark_auction_winner_mail($1,$2)', [lot, email]));
const winners = async () => (await as(admin, () => db.query('select public.auction_winners() as w'))).rows[0].w;

test('nothing can be marked before the auction has ended', async () => {
  await assert.rejects(mark(admin, 'user1@example.test'), /ikke afsluttet/);
  await db.query("update public.auction_lots set ends_at=now()-interval '1 minute' where id=$1", [lot]);
});

test('only the winner address can be marked, and only by admins', async () => {
  await assert.rejects(mark(winner, 'user1@example.test'), /Kun administratorer/);
  await assert.rejects(mark(admin, 'user2@example.test'), /passer ikke/);
  await mark(admin, ' USER1@example.test ');
  const [won] = await winners();
  assert.equal(won.full_name, 'Test Person');
  assert.equal(won.value_text, 'Uvurderligt');
  assert.equal(won.winner_mail_to, 'user1@example.test');
  assert.ok(won.winner_mail_sent_at);
});

test('anon cannot mark mails', async () => {
  await assert.rejects(as(null, () => db.query('select public.mark_auction_winner_mail(gen_random_uuid(),$1)', ['x@example.test'])), /permission denied/);
});
