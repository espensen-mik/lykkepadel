import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Admins correct participant details (database/admin-edit-registration.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-0000-0000-0000000000${95 + i}`);
const [admin, single, pair] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'registration-details.sql', 'admin-edit-registration.sql']) {
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
  as(user, () => db.query("select public.complete_event_registration($1,'Test Deltager','12345678','Testvej 1, 8000 Aarhus',$2,'Rabat','registration-test-v1') as r", [kind, kind === 'pair' ? 'Test Makker' : ''])).then((r) => r.rows[0].r.id);
const singleId = await register(single, 'individual');
const pairId = await register(pair, 'pair');
const edit = (user, id, v = {}) => {
  const x = { name: 'Rettet Navn', phone: '87654321', address: 'Ny Vej 2, 8000 Aarhus', partner: 'Ny Makker', shirt: 'L', partnerShirt: 'S', company: 'Firma', partnerCompany: 'Andet Firma', publish: true, ...v };
  return as(user, () => db.query('select public.admin_update_registration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [id, x.name, x.phone, x.address, x.partner, x.shirt, x.partnerShirt, x.company, x.partnerCompany, x.publish])).then((r) => r.rows[0].r);
};

test('only admins can edit', async () => {
  await assert.rejects(edit(single, singleId), /Kun administratorer/);
  await assert.rejects(as(null, () => db.query("select public.admin_update_registration($1,'a','b','c','d','M',null,null,null,false)", [singleId])), /permission denied/);
});

test('an admin corrects the size and contact details, and the bidder profile follows', async () => {
  const r = await edit(admin, singleId);
  assert.equal(r.shirt_size, 'L');
  assert.equal(r.full_name, 'Rettet Navn');
  assert.equal(r.partner_name, null, 'individual registrations have no partner');
  assert.equal(r.partner_shirt_size, null);
  assert.equal(r.email, 'user1@example.test', 'the mail is unchanged');
  const profile = (await db.query('select full_name, phone, billing_address from public.auction_profiles where user_id=$1', [single])).rows[0];
  assert.deepEqual(profile, { full_name: 'Rettet Navn', phone: '87654321', billing_address: 'Ny Vej 2, 8000 Aarhus' });
});

test('pairs keep partner details; sizes are checked; sizes may be left empty', async () => {
  const r = await edit(admin, pairId);
  assert.deepEqual([r.partner_name, r.partner_shirt_size, r.partner_company], ['Ny Makker', 'S', 'Andet Firma']);
  await assert.rejects(edit(admin, pairId, { shirt: 'XXXL' }), /T-shirt/);
  await assert.rejects(edit(admin, pairId, { partner: '' }), /makkerens navn/);
  await assert.rejects(edit(admin, pairId, { phone: 'abc' }), /korrekt/);
  assert.equal((await edit(admin, pairId, { shirt: null })).shirt_size, null);
});
