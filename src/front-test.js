import {createClient} from '@supabase/supabase-js';
import {initialLots} from './demo.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK',maximumFractionDigits:0}).format(v);
const date=v=>new Intl.DateTimeFormat('da-DK',{timeZone:'Europe/Copenhagen',dateStyle:'medium',timeStyle:'short'}).format(new Date(v));
const safeImage=v=>{try{const url=new URL(v);return url.protocol==='https:'?url.href:'/images/lykke-padel.svg';}catch{return '/images/lykke-padel.svg';}};
function render(lots,demo=false,failed=false){
 document.querySelector('#front-lots-note').textContent=demo?(failed?'Auktionerne kunne ikke hentes. Her vises tre fiktive eksempelprofiler med stockfotos.':'Spillerne er endnu ikke publiceret. Her viser vi tre fiktive eksempelprofiler med stockfotos for at demonstrere layoutet.'):'Et udsnit af makkerauktionen. Du kan se alle makkere og afgive bud på auktionssiden, når du er tilmeldt individuelt.';
 document.querySelector('#front-lots').innerHTML=lots.map((lot,i)=>{
  const ended=new Date(lot.ends_at)<=new Date();const href=`/auktion${demo?'?demo=1':''}#spiller/${encodeURIComponent(lot.id)}`;
  return `<article class="card"><a class="card-link" href="${esc(href)}" aria-label="Se ${demo?'eksempelprofilen':'auktionen med'} ${esc(lot.name)}"><div class="portrait"><img src="${esc(safeImage(lot.image_url))}" alt="${demo?'Stockfoto til eksempelprofilen':'Portræt af'} ${esc(lot.name)}" loading="lazy"><span class="lot-number">MAKKER / ${String(i+1).padStart(2,'0')}</span>${demo?'<span class="example-label">Fiktiv eksempelprofil</span>':''}</div><div class="card-body"><div class="card-heading"><h3>${esc(lot.name)}</h3><span class="category">${esc(lot.category)}</span></div><p class="card-description">${esc(lot.description)}</p><div class="bid-row"><div><span class="caption">${demo?'Eksempel på bud':lot.bid_count?'Seneste bud':'Startpris'}</span><span class="price">${money(lot.current_bid||lot.starting_price)}</span></div><span class="bid-link">${demo?'Se eksempel':ended?'Se resultat':'Se auktion'} ↗</span></div><p class="card-note">${demo?'Ingen rigtig auktion eller betaling':`${lot.bid_count} bud · Slutter ${date(lot.ends_at)}`}</p></div></a></article>`;
 }).join('');
}
async function load(){
 const response=await fetch('/api/auction-config?context=participant');
 if(response.status===404){render(initialLots().slice(0,3),true);return;}
 if(!response.ok)throw new Error('Configuration unavailable');
 const {url,key}=await response.json();
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data,error}=await client.from('auction_lots').select('id,name,category,description,image_url,starting_price,current_bid,bid_count,ends_at').eq('status','live').order('ends_at',{ascending:true}).limit(3);
 if(error)throw error;
 render(data.length?data:initialLots().slice(0,3),!data.length);
}
load().catch(()=>render(initialLots().slice(0,3),true,true));
