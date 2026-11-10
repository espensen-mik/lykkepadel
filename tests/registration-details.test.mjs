import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Charity Turnering: T-shirt sizes, company and consent (database/registration-details.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 4 }, (_, i) => `00000000-0000-0000-0000-0000000000${60 + i}`);
const [admin, solo, pair, nobody] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'registration-details.sql']) {
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
const register = (user, kind) =>
  as(user, () => db.query(`select public.complete_event_registration($1,'Test Deltager','12345678','Testvej 1, 8000 Aarhus',$2,'Rabat','registration-test-v1')`, [kind, kind === 'pair' ? 'Test Makker' : '']));
const set = (user, ...args) => as(user, () => db.query('select public.set_registration_details($1,$2,$3,$4,$5) as r', args)).then((r) => r.rows[0].r);

test('new registrations have no size and no consent', async () => {
  await register(solo, 'individual');
  await register(pair, 'pair');
  const row = (await db.query('select shirt_size, publish_consent from public.event_registrations where user_id=$1', [solo])).rows[0];
  assert.deepEqual(row, { shirt_size: null, publish_consent: false });
});

test('an individual saves size, company and consent', async () => {
  const r = await set(solo, 'L', 'XL', '  NORMAL A/S ', null, true);
  assert.deepEqual([r.shirt_size, r.partner_shirt_size, r.company, r.publish_consent], ['L', null, 'NORMAL A/S', true]);
  await assert.rejects(set(solo, 'XXXXL', null, null, null, false), /T-shirt-størrelse/);
});

test('a pair must choose a size for the partner too', async () => {
  await assert.rejects(set(pair, 'M', null, 'Firma', null, false), /makker/);
  const r = await set(pair, 'M', 'S', 'Firma', '', false);
  assert.deepEqual([r.shirt_size, r.partner_shirt_size, r.partner_company, r.publish_consent], ['M', 'S', null, false]);
});

test('only participants with a registration can save details', async () => {
  await assert.rejects(set(nobody, 'M', null, null, null, false), /ingen aktiv tilmelding/);
  await assert.rejects(set(null, 'M', null, null, null, false), /permission denied/);
});
