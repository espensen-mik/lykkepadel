import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Orders made before database/ticket-order-numbers.sql runs get numbers too, oldest first.
const db = new PGlite();
after(() => db.close());
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
const run = async (file) => db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
await run('auction-setup.sql');
await run('tickets.sql');
const order = (email) => db.query("select public.create_ticket_order(1,'Anna Hansen',$1,'','','','','tickets-v1') as r", [email]).then((r) => r.rows[0].r.id);

test('existing orders are numbered by age, new ones continue the series', async () => {
  const first = await order('a@example.test');
  const second = await order('b@example.test');
  await db.exec("update auction_private.ticket_settings set test_mode=false");
  const real = await order('c@example.test');
  await db.query("update public.ticket_orders set created_at=now()-interval '1 hour' where id=$1", [first]);
  await run('ticket-order-numbers.sql');
  const no = async (id) => (await db.query('select order_no from public.ticket_orders where id=$1', [id])).rows[0].order_no;
  assert.deepEqual([await no(first), await no(second), await no(real)], ['LPT00001', 'LPT00002', 'LP00001']);
  assert.equal(await no(await order('d@example.test')), 'LP00002');
});
