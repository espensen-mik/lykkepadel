import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// The editable program (database/program.sql).
const db = new PGlite();
after(() => db.close());
const [admin, guest] = ['00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000062'];

await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for (const id of [admin, guest]) await db.query('insert into auth.users values($1,$2,now(),false)', [id, `${id}@example.test`]);
for (const file of ['auction-setup.sql', 'program.sql']) await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8'));
await db.query('insert into auction_private.admins values($1)', [admin]);

async function as(user, fn) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'};select set_config('request.jwt.claim.sub','${user || ''}',false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const save = (user, v = {}) => {
  const x = { id: null, track: 'showkamp', starts: '20.15', ends: '', title: 'Prisoverrækkelse', text: 'På centercourt.', onShowkamp: true, ...v };
  return as(user, () => db.query('select public.save_program_item($1,$2,$3,$4,$5,$6,$7) as r', [x.id, x.track, x.starts, x.ends, x.title, x.text, x.onShowkamp])).then((r) => r.rows[0].r);
};
const list = () => as(null, () => db.query('select track, starts_at::text as t, title from public.program_items order by starts_at')).then((r) => r.rows);

test('everyone can read the program, which starts as it is on the site', async () => {
  const rows = await list();
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], { track: 'turnering', t: '12:30:00', title: 'Turneringen begynder' });
  assert.equal(rows.filter((r) => r.track === 'showkamp').length, 3);
});

test('only admins can change it, and nobody can write directly', async () => {
  await assert.rejects(save(guest), /Kun administratorer/);
  await assert.rejects(save(null), /permission denied/);
  await assert.rejects(as(admin, () => db.query("insert into public.program_items(track,starts_at,title) values('showkamp','10:00','x')")), /permission denied/);
});

test('an admin adds, edits and deletes items; times are checked', async () => {
  const item = await save(admin);
  assert.equal(item.starts_at, '20:15:00');
  const edited = await save(admin, { id: item.id, track: 'turnering', starts: '13:00', ends: '14.30', title: 'Frokost', text: '' });
  assert.deepEqual([edited.track, edited.starts_at, edited.ends_at, edited.description], ['turnering', '13:00:00', '14:30:00', null]);
  await assert.rejects(save(admin, { starts: '25.00' }), /fx 16.30/);
  await assert.rejects(save(admin, { starts: '' }), /starttiden/);
  await assert.rejects(save(admin, { starts: '16.00', ends: '15.00' }), /efter starttiden/);
  await assert.rejects(save(admin, { track: 'fest' }), /Vælg/);
  await assert.rejects(save(admin, { title: ' ' }), /titel/);
  await as(admin, () => db.query('select public.delete_program_item($1)', [item.id]));
  assert.equal((await list()).length, 6);
  await assert.rejects(as(admin, () => db.query('select public.delete_program_item($1)', [item.id])), /findes ikke/);
});
