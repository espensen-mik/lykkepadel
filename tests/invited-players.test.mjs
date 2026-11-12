import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Invited players and the public list of latest players (database/invited-players.sql).
const db = new PGlite();
after(() => db.close());
const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-0000-0000-0000000000${70 + i}`);
const [admin, payer, quiet] = ids;

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const [i, id] of ids.entries()) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `user${i}@example.test`]);
for (const file of ['auction-setup.sql', 'event-registration.sql', 'bid-history.sql', 'auction-items.sql', 'registration-details.sql', 'invoice-payments.sql', 'admin-edit-registration.sql', 'invited-players.sql']) {
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
const invite = (user, v = {}) => {
  const x = { kind: 'individual', name: 'Torben Mouritsen', title: 'Stifter af NORMAL', email: '', phone: '', partner: null, partnerTitle: null, shirt: 'L', partnerShirt: null, company: 'NORMAL', partnerCompany: null, publish: true, ...v };
  return as(user, () => db.query('select public.admin_add_invited_registration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r', [x.kind, x.name, x.title, x.email, x.phone, x.partner, x.partnerTitle, x.shirt, x.partnerShirt, x.company, x.partnerCompany, x.publish])).then((r) => r.rows[0].r);
};
const latest = () => as(null, () => db.query('select public.latest_players() as r')).then((r) => r.rows[0].r);
const seats = () => as(admin, () => db.query('select public.event_admin_settings() as r')).then((r) => r.rows[0].r.seats_taken);

test('only admins can sign up invited players', async () => {
  await assert.rejects(invite(payer), /Kun administratorer/);
  await assert.rejects(as(null, () => db.query("select public.admin_add_invited_registration('individual','A',null,null,null,null,null,null,null,null,null,false)")), /permission denied/);
});

test('an invited player has no login, costs nothing and takes a seat', async () => {
  const before = await seats();
  const r = await invite(admin);
  assert.equal(r.user_id, null);
  assert.equal(r.settlement, 'invited');
  assert.equal(r.amount_due, 0);
  assert.equal(r.email, null);
  assert.equal(r.public_title, 'Stifter af NORMAL');
  assert.equal(await seats(), before + 1);
});

test('invited pairs need a partner; mail and phone are checked when given', async () => {
  await assert.rejects(invite(admin, { kind: 'pair' }), /makkerens navn/);
  await assert.rejects(invite(admin, { email: 'ikke-en-mail' }), /Mailadressen/);
  await assert.rejects(invite(admin, { phone: 'abc' }), /Telefonnummeret/);
  await assert.rejects(invite(admin, { shirt: 'XXXL' }), /T-shirt/);
  const r = await invite(admin, { kind: 'pair', name: 'Anna Spiller', partner: 'Bo Spiller', partnerTitle: 'Landsholdsspiller', email: 'Anna@Example.test', publish: false });
  assert.deepEqual([r.seats, r.partner_name, r.partner_public_title, r.email], [2, 'Bo Spiller', 'Landsholdsspiller', 'anna@example.test']);
});

test('paying registrations still need a login', async () => {
  await assert.rejects(db.query(`insert into public.event_registrations(kind,seats,full_name,email,phone,billing_address,base_price,discount_amount,amount_due,settlement,terms_version)
    values('individual',1,'Uden Login','a@b.dk','12345678','Vej 1, 8000',10000,0,10000,'invoice','registration-test-v1')`), /account_check/);
});

test('latest players: only consenting confirmed players, newest first, title or company', async () => {
  await as(payer, () => db.query("select public.complete_event_registration('individual','Betalende Spiller','12345678','Testvej 1, 8000 Aarhus','','Rabat','registration-test-v1')"));
  await as(payer, () => db.query("select public.set_registration_details('M',null,'Firma A/S',null,true)"));
  await as(quiet, () => db.query("select public.complete_event_registration('individual','Stille Spiller','12345678','Testvej 1, 8000 Aarhus','','Rabat','registration-test-v1')"));
  await invite(admin, { name: 'Rikke Nielsen', title: 'Stifter af LykkeLiga', company: null });
  const list = await latest();
  assert.deepEqual(list.map((p) => p.name), ['Rikke Nielsen', 'Betalende Spiller', 'Torben Mouritsen']);
  assert.equal(list[1].title, 'Firma A/S', 'company is used when there is no title');
  assert.deepEqual(Object.keys(list[0]).sort(), ['name', 'title'], 'nothing else is public');
});

test('admins edit invited players: title, mail and optional phone; the list follows', async () => {
  const id = (await db.query("select id from public.event_registrations where full_name='Rikke Nielsen'")).rows[0].id;
  const edit = (v = {}) => {
    const x = { name: 'Rikke Nielsen', phone: '', address: '', partner: null, shirt: 'S', partnerShirt: null, company: '', partnerCompany: null, publish: true, title: 'Stifter af LykkeLiga', partnerTitle: null, email: 'rikke@example.test', ...v };
    return as(admin, () => db.query('select public.admin_update_registration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as r', [id, x.name, x.phone, x.address, x.partner, x.shirt, x.partnerShirt, x.company, x.partnerCompany, x.publish, x.title, x.partnerTitle, x.email])).then((r) => r.rows[0].r);
  };
  const r = await edit();
  assert.deepEqual([r.email, r.phone, r.billing_address], ['rikke@example.test', null, null]);
  await assert.rejects(edit({ email: 'nej' }), /Mailadressen/);
  await edit({ publish: false });
  assert.ok(!(await latest()).some((p) => p.name === 'Rikke Nielsen'), 'hidden once unticked');
});

test('paying participants keep their login mail and required details', async () => {
  const id = (await db.query("select id from public.event_registrations where full_name='Betalende Spiller'")).rows[0].id;
  const run = (phone, email) => as(admin, () => db.query("select public.admin_update_registration($1,'Betalende Spiller',$2,'Testvej 1, 8000 Aarhus',null,'M',null,'Firma A/S',null,true,'Direktør',null,$3) as r", [id, phone, email])).then((r) => r.rows[0].r);
  await assert.rejects(run('', 'x@y.dk'), /korrekt/);
  const r = await run('12345678', 'ny@mail.dk');
  assert.equal(r.email, 'user1@example.test');
  assert.equal(r.public_title, 'Direktør');
});
