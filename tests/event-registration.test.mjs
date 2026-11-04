import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const db=new PGlite();after(()=>db.close());
const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'];
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const [i,id] of ids.entries())await db.query('insert into auth.users values($1,$2,$3,false)',[id,`test${i}@example.test`,i===3?null:new Date()]);
await db.exec(await readFile(new URL('../database/auction-setup.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../database/event-registration.sql',import.meta.url),'utf8'));
await db.query('insert into auction_private.admins values($1)',[ids[0]]);
async function as(user,fn){await db.exec(`set role ${user?'authenticated':'anon'};select set_config('request.jwt.claim.sub','${user||''}',false)`);try{return await fn();}finally{await db.exec('reset role');}}
const register=(user,kind='individual',code='Rabat')=>as(user,()=>db.query(`select public.complete_event_registration($1,'Test Deltager','12345678','Testvej 1, 8000 Aarhus',$2,$3,'registration-test-v1') as result`,[kind,kind==='pair'?'Test Makker':'',code]));
let lot;
test('quotes enforce server prices and reject unknown coupons',async()=>{
 const q=await as(null,()=>db.query("select public.event_registration_quote('pair',' rAbAt ') as q"));assert.deepEqual(q.rows[0].q,{base_price:25000,discount_amount:25000,amount_due:0,seats:2});
 assert.equal((await as(null,()=>db.query("select public.event_registration_quote('individual','') as q"))).rows[0].q.amount_due,10000);
 await assert.rejects(as(null,()=>db.query("select public.event_registration_quote('individual','fake')")),/ugyldig/);
});
test('anonymous and unconfirmed identities cannot register; full price cannot bypass payment',async()=>{
 await assert.rejects(register(null),/permission denied/);await assert.rejects(register(ids[3]),/Bekræft/);await assert.rejects(register(ids[1],'individual',''),/Betaling/);
});
test('discount registration is durable, idempotent, and binds identity email on server',async()=>{
 const first=await register(ids[1]);const repeat=await register(ids[1]);assert.deepEqual(first.rows,repeat.rows);assert.equal(first.rows[0].result.email,'test1@example.test');assert.equal(first.rows[0].result.amount_due,0);assert.equal(first.rows[0].result.settlement,'discount');
 assert.equal((await db.query('select count(*)::int as n from public.event_registrations')).rows[0].n,1);
 await assert.rejects(register(ids[1],'pair'),/allerede/);
});
test('owners cannot modify payment or status; registrations are private',async()=>{
 assert.equal((await as(ids[2],()=>db.query('select * from public.event_registrations'))).rows.length,0);
 await assert.rejects(as(null,()=>db.query('select * from public.event_registrations')),/permission denied/);
 await assert.rejects(as(ids[1],()=>db.query("update public.event_registrations set status='confirmed'")),/permission denied/);
 await assert.rejects(as(ids[1],()=>db.query('select * from auction_private.event_settings')),/permission denied/);
});
test('pair consumes two seats but cannot bid even if profile is manually approved',async()=>{
 await register(ids[2],'pair');assert.equal((await db.query("select sum(seats)::int as n from public.event_registrations")).rows[0].n,3);
 lot=(await as(ids[0],()=>db.query("select public.save_auction_lot(null,'Test Makker','Musiker','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'live') as id"))).rows[0].id;
 await as(ids[0],()=>db.query('select public.approve_auction_bidder($1,true)',[ids[2]]));
 await assert.rejects(as(ids[2],()=>db.query('select public.place_auction_bid($1,500,gen_random_uuid())',[lot])),/Individuel deltagelse/);
 assert.equal((await as(ids[2],()=>db.query('select public.event_bid_access() as value'))).rows[0].value,false);
});
test('confirmed individual can bid; a coupon never grants admin access',async()=>{
 await as(ids[1],()=>db.query('select public.place_auction_bid($1,500,gen_random_uuid())',[lot]));
 assert.equal((await as(ids[1],()=>db.query('select public.event_bid_access() as value'))).rows[0].value,true);
 await assert.rejects(as(ids[1],()=>db.query('select public.event_admin_settings(false)')),/Kun administratorer/);
});
test('capacity and coupon activation are enforced at completion, not only at quote',async()=>{
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids[3]]);
 await db.query('update auction_private.event_settings set capacity=3');await assert.rejects(register(ids[3]),/ledige pladser/);
 await db.query('update auction_private.event_settings set capacity=70');await as(ids[0],()=>db.query('select public.event_admin_settings(false)'));await assert.rejects(register(ids[3]),/ugyldig/);
 await as(ids[0],()=>db.query('select public.event_admin_settings(true)'));
});
test('cancellation releases capacity and blocks bidding immediately',async()=>{
 const id=(await db.query('select id from public.event_registrations where user_id=$1',[ids[1]])).rows[0].id;
 await assert.rejects(as(ids[2],()=>db.query('select public.cancel_event_registration($1)',[id])),/Kun administratorer/);
 await as(ids[0],()=>db.query('select public.cancel_event_registration($1)',[id]));
 assert.equal((await as(ids[1],()=>db.query('select public.event_bid_access() as value'))).rows[0].value,false);
 await assert.rejects(as(ids[1],()=>db.query('select public.place_auction_bid($1,1000,gen_random_uuid())',[lot])),/godkendes/);
 await assert.rejects(register(ids[1]),/allerede/);
});
test('public auction reads include live lots but never drafts or contact information',async()=>{
 await as(ids[0],()=>db.query("select public.save_auction_lot(null,'Kladde Makker','Musiker','En god testbeskrivelse','https://example.test/p.jpg',now()+interval '1 day',500,'draft')"));
 assert.equal((await as(null,()=>db.query('select * from public.auction_lots'))).rows.length,1);
 assert.equal((await as(ids[0],()=>db.query('select * from public.event_registrations'))).rows.length,2);
});
