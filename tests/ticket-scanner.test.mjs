import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// The volunteer scanner (database/ticket-scanner.sql).
const db = new PGlite();
after(() => db.close());
const admin = '00000000-0000-0000-0000-000000000099';
const other = '00000000-0000-0000-0000-000000000098';
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const id of [admin, other]) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `${id.slice(-2)}@example.test`]);
for (const file of ['auction-setup.sql', 'tickets.sql', 'ticket-order-numbers.sql', 'ticket-scanner.sql', 'ticket-scanner-digits.sql']) await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
await db.query('insert into auction_private.admins values($1)', [admin]);

async function as(user, fn) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'};select set_config('request.jwt.claim.sub','${user || ''}',false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const one = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
// One real order with two tickets, one test ticket.
await db.exec('update auction_private.ticket_settings set test_mode=false');
const real = await one("select public.create_ticket_order(2,'Anna Marie Hansen','anna@example.test','','','','','tickets-v1')");
await db.query('select auction_private.fulfil_ticket_order($1)', [real.id]);
await db.exec('update auction_private.ticket_settings set test_mode=true');
const fake = await one("select public.create_ticket_order(1,'Test Person','t@example.test','','','','','tickets-v1')");
await db.query('select auction_private.fulfil_ticket_order($1)', [fake.id]);
const [first, second] = (await db.query('select code from public.tickets where order_id=$1 order by code', [real.id])).rows.map((r) => r.code);
const testCode = await one('select code from public.tickets where order_id=$1', [fake.id]);
const scan = (dayCode, ticket, undo = false) => as(null, () => one('select public.scan_ticket($1,$2,$3)', [dayCode, ticket, undo]));
let day;

test('only admins create, see and stop the day code', async () => {
  await assert.rejects(as(other, () => db.query('select public.new_scan_code(12)')), /Kun administratorer/);
  await assert.rejects(as(null, () => db.query('select public.new_scan_code(12)')), /permission denied/);
  await assert.rejects(as(admin, () => db.query('select public.new_scan_code(100)')), /1 og 72/);
  day = (await as(admin, () => one('select public.new_scan_code(12)'))).code;
  assert.match(day, /^\d{4}-\d{4}-\d{4}$/);
  assert.equal((await as(admin, () => one('select public.scan_code_status()'))).active, true);
  assert.notEqual(await one('select scan_code_hash from auction_private.ticket_settings'), day, 'only the hash is stored');
});

test('without the right code nothing happens', async () => {
  await assert.rejects(scan('0000-0000-0000', first), /forkert eller udløbet/);
  await assert.rejects(as(null, () => db.query('select public.scan_status($1)', ['nope'])), /forkert eller udløbet/);
  assert.equal(await one('select checked_in_at from public.tickets where code=$1', [first]), null);
});

test('volunteers check tickets in once and see only the first name', async () => {
  const status = await as(null, () => one('select public.scan_status($1)', [day.toLowerCase().replace(/-/g, ' ')]));
  assert.deepEqual([Number(status.checked_in), Number(status.sold)], [0, 2]);
  const ok = await scan(day, first.toLowerCase());
  assert.equal(ok.result, 'ok');
  assert.equal(ok.first_name, 'Anna');
  assert.equal(ok.buyer_name, undefined);
  assert.equal(Number(ok.checked_in), 1);
  assert.equal((await scan(day, first)).result, 'used');
  assert.equal((await scan(day, first, true)).result, 'undone');
  assert.equal((await scan(day, first)).result, 'ok');
  assert.equal((await scan(day, testCode)).result, 'test');
  assert.equal((await scan(day, 'NOPE-NOPE')).result, 'unknown');
  await as(admin, () => db.query('select public.cancel_ticket_order($1)', [real.id]));
  assert.equal((await scan(day, second)).result, 'void');
});

test('an expired or stopped code stops working', async () => {
  await db.exec("update auction_private.ticket_settings set scan_valid_until=now()-interval '1 minute'");
  await assert.rejects(scan(day, first), /udløbet/);
  const next = (await as(admin, () => one('select public.new_scan_code(1)'))).code;
  await assert.rejects(scan(day, first), /forkert/, 'the old code no longer works');
  await scan(next, first);
  await as(admin, () => db.query('select public.stop_scan_code()'));
  await assert.rejects(scan(next, first), /forkert eller udløbet/);
  assert.equal((await as(admin, () => one('select public.scan_code_status()'))).active, false);
});
