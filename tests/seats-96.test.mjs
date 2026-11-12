import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// 70 seats for registrations and 26 for invited players (database/seats-96.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 4 }, (_, i) => `00000000-0000-0000-0000-0000000000${50 + i}`);
const [admin, a, b, c] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'registration-details.sql', 'invoice-payments.sql', 'admin-edit-registration.sql', 'invited-players.sql', 'seats-96.sql']) {
  await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
}
await db.query('insert into auction_private.admins values($1)', [admin]);

async function as(user, fn) {
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const settings = () => as(admin, () => db.query('select public.event_admin_settings() as r')).then((r) => r.rows[0].r);
const invite = (kind = 'individual') =>
  as(admin, () => db.query("select public.admin_add_invited_registration($1,'Inviteret Spiller',null,null,null,$2,null,null,null,null,null,false)", [kind, kind === 'pair' ? 'Makker' : null]));
const register = (user, kind = 'individual') =>
  as(user, () => db.query("select public.complete_event_registration($1,'Test Deltager','12345678','Testvej 1, 8000 Aarhus',$2,'Rabat','registration-test-v1')", [kind, kind === 'pair' ? 'Makker' : '']));

test('the overview has 70 + 26 = 96 seats', async () => {
  const s = await settings();
  assert.deepEqual([s.capacity, s.invited_capacity, s.total_capacity, s.paid_taken, s.invited_taken], [70, 26, 96, 0, 0]);
});

test('invited players do not use the 70 registration seats', async () => {
  await db.query('update auction_private.event_settings set capacity = 2, invited_capacity = 3');
  await invite('pair');
  await register(a, 'pair');
  await assert.rejects(register(b), /ikke flere ledige pladser/);
  const s = await settings();
  assert.deepEqual([s.paid_taken, s.invited_taken, s.seats_taken], [2, 2, 4]);
});

test('invited players stop at their own limit', async () => {
  await invite();
  await assert.rejects(invite(), /ikke flere pladser til inviterede spillere \(3 af 3/);
  await db.query('update auction_private.event_settings set capacity = 70, invited_capacity = 26');
  await invite();
  assert.equal((await settings()).invited_taken, 4);
  await register(c);
  assert.equal((await settings()).paid_taken, 3);
});
