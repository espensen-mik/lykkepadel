import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
after(() => db.close());
const admin='00000000-0000-0000-0000-000000000001';
const bidder='00000000-0000-0000-0000-000000000002';
const other='00000000-0000-0000-0000-000000000003';
await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
 create table auth.identities(user_id uuid references auth.users(id),provider text,identity_data jsonb);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;
 grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
 insert into auth.users(id,email,email_confirmed_at) values
 ('${admin}','admin@example.test',now()),('${bidder}','bidder@example.test',now()),('${other}','other@example.test',now());
`);
await db.exec(await readFile(new URL('../database/auction-setup.sql',import.meta.url),'utf8'));
await db.exec(`insert into auction_private.admins values('${admin}')`);
async function asUser(user,fn){
 await db.exec(`set role ${user?'authenticated':'anon'}; select set_config('request.jwt.claim.sub','${user||''}',false)`);
 try{return await fn();}finally{await db.exec('reset role');}
}
let lot;
test('admin creates a draft; anonymous clients see nothing and cannot write',async()=>{
 lot=(await asUser(admin,()=>db.query(`select public.save_auction_lot(null,'Testspiller','Musiker','En testbeskrivelse til padel.','https://example.test/photo.jpg',now()+interval '1 day',500,'draft') as id`))).rows[0].id;
 assert.equal((await asUser(null,()=>db.query('select * from public.auction_lots'))).rows.length,0);
 await assert.rejects(asUser(null,()=>db.query(`update public.auction_lots set current_bid=9000`)),/permission denied/);
 await assert.rejects(asUser(bidder,()=>db.query(`select public.approve_auction_bidder('${bidder}',true)`)),/Kun administratorer/);
});
test('registration creates a pending profile; user cannot self-approve or see another profile',async()=>{
 await asUser(bidder,()=>db.query(`select public.register_bidder('Budgiver Test','12345678','Testvej 1, 8000 Aarhus')`));
 await asUser(other,()=>db.query(`select public.register_bidder('Anden Test','87654321','Testvej 2, 8000 Aarhus')`));
 assert.equal((await asUser(bidder,()=>db.query('select * from public.auction_profiles'))).rows.length,1);
 await assert.rejects(asUser(bidder,()=>db.query(`update public.auction_profiles set approved=true`)),/permission denied/);
 await assert.rejects(asUser(bidder,()=>db.query(`select public.place_auction_bid('${lot}',500,'10000000-0000-0000-0000-000000000001')`)),/godkendes/);
});
test('approved bidder sees live lot; bid increments and idempotency are enforced by database',async()=>{
 await asUser(admin,()=>db.query(`select public.approve_auction_bidder('${bidder}',true)`));
 await asUser(admin,()=>db.query(`select public.save_auction_lot('${lot}','Testspiller','Musiker','En testbeskrivelse til padel.','https://example.test/photo.jpg',now()+interval '1 day',500,'live')`));
 assert.equal((await asUser(bidder,()=>db.query('select * from public.auction_lots'))).rows.length,1);
 assert.equal((await asUser(null,()=>db.query('select * from public.auction_lots'))).rows.length,0);
 const request='10000000-0000-0000-0000-000000000002';
 const first=await asUser(bidder,()=>db.query(`select public.place_auction_bid('${lot}',500,'${request}') as result`));
 const repeat=await asUser(bidder,()=>db.query(`select public.place_auction_bid('${lot}',500,'${request}') as result`));
 assert.deepEqual(first.rows,repeat.rows);
 assert.equal((await db.query(`select bid_count from public.auction_lots where id='${lot}'`)).rows[0].bid_count,1);
 for(const amount of [500,750,999,10000001]) await assert.rejects(asUser(bidder,()=>db.query(`select public.place_auction_bid('${lot}',${amount},gen_random_uuid())`)),/Buddet/);
 await asUser(bidder,()=>db.query(`select public.place_auction_bid('${lot}',1000,gen_random_uuid())`));
 await assert.rejects(asUser(admin,()=>db.query(`select public.save_auction_lot('${lot}','Ændret navn','Musiker','En testbeskrivelse til padel.','https://example.test/photo.jpg',now()+interval '1 day',500,'live')`)),/låst/);
});
test('expired lots reject bids and winners are restricted to admin',async()=>{
 await db.query(`update public.auction_lots set ends_at=now()-interval '1 second' where id='${lot}'`);
 await assert.rejects(asUser(bidder,()=>db.query(`select public.place_auction_bid('${lot}',1500,gen_random_uuid())`)),/ikke åben/);
 await assert.rejects(asUser(bidder,()=>db.query('select public.auction_winners()')),/Kun administratorer/);
 const result=await asUser(admin,()=>db.query('select public.auction_winners() as result'));
 assert.equal(result.rows[0].result[0].amount,1000);
 assert.equal(result.rows[0].result[0].email,'bidder@example.test');
});
test('blocking a bidder takes immediate effect; private bid ledger is inaccessible',async()=>{
 await asUser(admin,()=>db.query(`select public.approve_auction_bidder('${bidder}',false)`));
 await assert.rejects(asUser(bidder,()=>db.query(`select public.place_auction_bid('${lot}',1500,gen_random_uuid())`)),/godkendes/);
 await assert.rejects(asUser(bidder,()=>db.query('select * from auction_private.bids')),/permission denied/);
});

test('Google admin migration requires a verified domain identity, OAuth session and explicit admin role',async()=>{
 await db.exec(await readFile(new URL('../database/auction-google-admin.sql',import.meta.url),'utf8'));
 const isAdmin=async()=> (await asUser(admin,()=>db.query('select public.auction_is_admin() as value'))).rows[0].value;
 assert.equal(await isAdmin(),false);
 await db.query(`update auth.users set email='mikael@lykkeliga.dk' where id='${admin}'`);
 await db.query(`insert into auth.identities values('${admin}','google','{"email":"mikael@lykkeliga.dk","email_verified":true}')`);
 await db.exec(`select set_config('request.jwt.claims','{"amr":[{"method":"password"}],"user_metadata":{"role":"admin"}}',false)`);
 assert.equal(await isAdmin(),false);
 await db.exec(`select set_config('request.jwt.claims','{"amr":[{"method":"oauth"}]}',false)`);
 assert.equal(await isAdmin(),true);
 assert.equal((await asUser(other,()=>db.query('select public.auction_is_admin() as value'))).rows[0].value,false);
 await db.query(`update auth.users set email='mikael@lykkeliga.dk.evil.test' where id='${admin}'`);
 assert.equal(await isAdmin(),false);
 await db.query(`update auth.users set email='mikael@lykkeliga.dk' where id='${admin}'`);
 await db.query(`update auth.identities set identity_data='{"email":"mikael@lykkeliga.dk","email_verified":false}' where user_id='${admin}'`);
 assert.equal(await isAdmin(),false);
});
