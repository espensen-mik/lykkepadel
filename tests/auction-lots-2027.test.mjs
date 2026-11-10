import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// The five lots from the test site, created as drafts (database/auction-lots-2027.sql).
const db = new PGlite();
after(() => db.close());
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql']) {
  await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
}
const seed = await readFile(new URL('../database/auction-lots-2027.sql', import.meta.url), 'utf8');

test('the seed creates five drafts and can safely run twice', async () => {
  await db.exec(seed);
  await db.exec(seed);
  const rows = (await db.query('select name, kind, status, starting_price from public.auction_lots order by kind, name')).rows;
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.status === 'draft'));
  assert.deepEqual(rows.map((r) => r.kind), ['item', 'item', 'partner', 'partner', 'partner']);
  assert.equal(rows.find((r) => r.name.startsWith('Personlig')).starting_price, 1000);
});
