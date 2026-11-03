import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/auction-config.mjs';
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(v){this.body=v}};}
test('configuration is disabled by default and never returns a key',()=>{
 delete process.env.AUCTIONS_ENABLED;const r=response();handler({method:'GET'},r);assert.equal(r.statusCode,404);assert.deepEqual(JSON.parse(r.body),{enabled:false});
});
test('configuration requires a publishable key and rejects secret keys',()=>{
 process.env.AUCTIONS_ENABLED='true';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_secret_bad';const r=response();handler({method:'GET'},r);assert.equal(r.statusCode,503);assert.ok(!r.body.includes('sb_secret'));
});
test('configuration returns only the explicitly public key',()=>{
 process.env.AUCTIONS_ENABLED='true';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';const r=response();handler({method:'GET'},r);assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).key,'sb_publishable_test');assert.equal(r.headers['Cache-Control'],'no-store');
});
test('admin login can be enabled without enabling connected public auctions',()=>{
 process.env.AUCTIONS_ENABLED='false';process.env.ADMIN_AUTH_ENABLED='true';
 const auction=response();handler({method:'GET',url:'/api/auction-config'},auction);assert.equal(auction.statusCode,404);
 const admin=response();handler({method:'GET',url:'/api/auction-config?context=admin'},admin);assert.equal(admin.statusCode,200);
});
