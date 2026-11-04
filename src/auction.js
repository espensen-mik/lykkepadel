import { createClient } from '@supabase/supabase-js';
import { initialLots } from './demo.js';
import { enhanceSelects } from './select.js';
import { packages,registrationKey,validateRegistration,readRegistration,canTestBid } from './registration.js';

const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK',maximumFractionDigits:0}).format(value);
const date=value=>new Intl.DateTimeFormat('da-DK',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Copenhagen'}).format(new Date(value));
let demo=new URLSearchParams(location.search).get('demo')==='1';
const adminPage=/^\/(admin|administration)\/?$/.test(location.pathname);
// Keep the registered OAuth return URL compatible; show the short address after return.
if(location.pathname.startsWith('/administration'))history.replaceState(null,'','/admin'+location.search+location.hash);
const main=$('#main'), dialog=$('#modal');
const pickerObserver=new MutationObserver(()=>enhanceSelects());
pickerObserver.observe(main,{childList:true,subtree:true});
pickerObserver.observe($('#modal-content'),{childList:true,subtree:true});
let client,user,profile,isAdmin=false,lots=[],sort='soon',adminTab='lots',polling=false,toastTimer;
let registration=readRegistration(sessionStorage);
let demoLoggedIn=canTestBid(registration);
const registrationPage=/^\/tilmelding\/?$/.test(location.pathname);
const registrationLink=()=>'/tilmelding';
let demoProfiles=[];
function readDemo(){try{return JSON.parse(sessionStorage.getItem('lykke-auction-demo'))||initialLots();}catch{return initialLots();}}
function saveDemo(){sessionStorage.setItem('lykke-auction-demo',JSON.stringify(lots));}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function safeImage(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:'/images/lykke-padel.svg';}catch{return '/images/lykke-padel.svg';}}
const closed=lot=>new Date(lot.ends_at).getTime()<=Date.now();
const minimum=lot=>lot.bid_count?lot.current_bid+500:lot.starting_price;
function countdown(value){const ms=Math.max(0,new Date(value).getTime()-Date.now());if(!ms)return 'Auktionen er slut';const s=Math.floor(ms/1000);return `${Math.floor(s/86400)}d ${String(Math.floor(s/3600)%24).padStart(2,'0')}t ${String(Math.floor(s/60)%60).padStart(2,'0')}m ${String(s%60).padStart(2,'0')}s`;}
function link(id){return `/auktion${demo?'?demo=1':''}${id?'#spiller/'+encodeURIComponent(id):''}`;}
function modal(html){$('#modal-content').innerHTML=html;if(!dialog.open)dialog.showModal();}
function errorHtml(message){return `<p class="error" role="alert">${esc(message)}</p>`;}
function messageError(error){return error?.message||'Noget gik galt. Prøv igen.';}
function field(form,name){return new FormData(form).get(name)?.toString().trim()||'';}
function useForm(form,task){form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;form.querySelector('.error')?.remove();try{await task(form);}catch(error){form.insertAdjacentHTML('beforeend',errorHtml(messageError(error)));}finally{button.disabled=false;}});}
$('#modal .close').onclick=()=>dialog.close();
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});

async function loadIdentity(){
 if(demo){isAdmin=adminPage;return;}
 const {data:{user:current},error}=await client.auth.getUser();
 if(error){user=null;profile=null;isAdmin=false;return;}
 user=current;
 if(!user)return;
 const [{data:rows,error:profileError},{data:admin,error:adminError}]=await Promise.all([
  client.from('auction_profiles').select('*').eq('user_id',user.id),client.rpc('auction_is_admin')]);
 if(profileError)throw profileError;if(adminError)throw adminError;
 profile=rows[0]||null;isAdmin=admin===true;
}
async function fetchLots(){
 if(demo)return;
 const {data,error}=await client.from('auction_lots').select('*').order('created_at',{ascending:true});
 if(error)throw error;lots=data||[];
}
function accountLabel(){
 $('#account').hidden=adminPage&&!isAdmin;
 $('#account').innerHTML=(adminPage?'Min profil':'Tilmeld dig')+' <span aria-hidden="true">↗</span>';
}
async function googleLogin(){
 const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/administration',queryParams:{hd:'lykkeliga.dk',prompt:'select_account'}}});
 if(error)throw error;
}
function showAdminLogin(){
 modal(`<p class="eyebrow">Kun for LykkeLiga</p><h2>Velkommen på holdet.</h2><p>Brug din Google-konto på <strong>@lykkeliga.dk</strong>. Din konto skal også være tildelt administratoradgang.</p><form id="google-form"><button class="primary" type="submit">Log ind med Google ↗</button></form>${user?`<p class="help">Du er logget ind som ${esc(user.email)}, men denne session har ikke administratoradgang.</p><button class="secondary" id="admin-logout">Log ud</button>`:''}`);
 useForm($('#google-form'),async()=>googleLogin());
 $('#admin-logout')?.addEventListener('click',async()=>{await client.auth.signOut();user=profile=null;isAdmin=false;dialog.close();await refresh();});
}
function showAccount(signup=false){
 if(adminPage&&!demo&&!isAdmin){showAdminLogin();return;}

 if(demo){location.href=registrationLink();return;}
 if(user){
  modal(`<p class="eyebrow">Din profil</p><h2>${esc(profile?.full_name||'Velkommen')}</h2><p>${esc(user.email)}</p><p>${profile?(profile.approved?'Du er godkendt til at byde.':'Din profil afventer personlig godkendelse fra LykkeLiga.'):'Udfyld dine kontaktoplysninger, før du kan blive godkendt.'}</p>${!profile?'<button class="primary" id="complete-profile">Udfyld profil →</button>':''}<button class="secondary" id="logout">Log ud</button>`);
  $('#complete-profile')?.addEventListener('click',showProfileForm);
  $('#logout').onclick=async()=>{await client.auth.signOut();user=profile=null;isAdmin=false;dialog.close();await refresh();};return;
 }
 modal(`<p class="eyebrow">Din plads på banen</p><h2>${signup?'Opret din profil':'Velkommen tilbage'}</h2><p>${signup?'Bekræft din mailadresse, og få din profil godkendt, før du byder.':'Log ind for at byde på din kommende makker.'}</p><form id="auth-form"><label>Mailadresse<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>Adgangskode<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" minlength="10" required maxlength="128"></label><button class="primary" type="submit">${signup?'Opret profil':'Log ind'} ↗</button></form><p class="form-switch"><button class="text-button" id="switch-auth">${signup?'Har du en profil? Log ind':'Ny på holdet? Opret profil'}</button></p>${!signup?'<button class="text-button" id="forgot-password">Glemt adgangskode?</button>':''}`);
 $('#switch-auth').onclick=()=>showAccount(!signup);
 $('#forgot-password')?.addEventListener('click',showResetForm);
 useForm($('#auth-form'),async form=>{
  const email=field(form,'email'),password=field(form,'password');
  if(signup){
   const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/auktion'}});if(error)throw error;
   if(data.session){await loadIdentity();showProfileForm();}else modal('<p class="eyebrow">Tjek din indbakke</p><h2>Bekræft din mail</h2><p>Hvis adressen kan oprettes, modtager du et link. Bekræft din mail, og log derefter ind for at udfylde din profil. Tjek også spam.</p>');
  }else{
   const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;
   await loadIdentity();dialog.close();await refresh();if(!profile&&!isAdmin)showProfileForm();
  }
 });
}
function showResetForm(){
 modal('<h2>Ny adgangskode</h2><p>Vi sender et link til din mailadresse.</p><form id="reset-form"><label>Mailadresse<input type="email" name="email" autocomplete="email" required></label><button type="submit" class="primary">Send link →</button></form>');
 useForm($('#reset-form'),async form=>{const {error}=await client.auth.resetPasswordForEmail(field(form,'email'),{redirectTo:location.origin+'/auktion'});if(error)throw error;modal('<h2>Tjek din indbakke</h2><p>Hvis adressen findes hos os, modtager du et link til at ændre din adgangskode.</p>');});
}
function showNewPassword(){
 modal('<h2>Vælg adgangskode</h2><form id="password-form"><label>Ny adgangskode<input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><button class="primary" type="submit">Gem adgangskode →</button></form>');
 useForm($('#password-form'),async form=>{const {error}=await client.auth.updateUser({password:field(form,'password')});if(error)throw error;dialog.close();toast('Din adgangskode er opdateret.');});
}
function showProfileForm(){
 modal(`<p class="eyebrow">Før du byder</p><h2>Lad os lære dig at kende</h2><form id="profile-form"><label>Fuldt navn<input name="name" autocomplete="name" minlength="2" maxlength="120" required></label><label>Mobilnummer<input name="phone" type="tel" autocomplete="tel" minlength="6" maxlength="30" required></label><label>Faktureringsadresse<textarea name="address" autocomplete="street-address" minlength="5" maxlength="500" required></textarea></label><label class="check-label"><input name="terms" type="checkbox" required><span>Jeg accepterer testvilkårene (preview-v1): Dette er en testauktion uden betaling. Mine kontaktoplysninger bruges til at behandle min profil. Min mail skal bekræftes, og LykkeLiga skal godkende mig før testbud. Mobilnummeret er selvoplyst og ikke identitetsverificeret.</span></label><button class="primary" type="submit">Send til godkendelse →</button></form>`);
 useForm($('#profile-form'),async form=>{const {error}=await client.rpc('register_bidder',{p_name:field(form,'name'),p_phone:field(form,'phone'),p_address:field(form,'address')});if(error)throw error;await loadIdentity();dialog.close();await refresh();toast('Din profil afventer godkendelse.');});
}
$('#account').onclick=()=>{if(adminPage)showAccount();else location.href=registrationLink();};

function card(lot,i){return `<article class="card" style="--i:${i}"><a class="card-link" href="${link(lot.id)}" aria-label="Se auktionen med ${esc(lot.name)}"><div class="portrait"><img src="${esc(safeImage(lot.image_url))}" alt="Portræt til eksempelprofilen ${esc(lot.name)}" loading="${i<3?'eager':'lazy'}"><span class="lot-number">MAKKER / ${String(i+1).padStart(2,'0')}</span>${demo?'<span class="example-label">Fiktiv eksempelprofil</span>':''}</div><div class="card-body"><div class="card-heading"><h2>${esc(lot.name)}</h2><span class="category">${esc(lot.category)}</span></div><p class="card-description">${esc(lot.description)}</p><div class="bid-row"><div><span class="caption">${lot.bid_count?'Seneste bud':'Startpris'}</span><span class="price">${money(lot.current_bid||lot.starting_price)}</span></div><span class="bid-link">${closed(lot)?'Se resultat':'Se & byd'} ↗</span></div><span class="countdown ${closed(lot)?'ended':''}" data-ends="${esc(lot.ends_at)}">${countdown(lot.ends_at)}</span><p class="card-note">${lot.bid_count} bud · ${date(lot.ends_at)}</p></div></a></article>`;}
function listing(){
 let visible=lots.filter(l=>l.status==='live');
 if(sort==='soon')visible.sort((a,b)=>new Date(a.ends_at)-new Date(b.ends_at));
 if(sort==='highest')visible.sort((a,b)=>b.current_bid-a.current_bid);
 if(sort==='lowest')visible.sort((a,b)=>(a.current_bid||a.starting_price)-(b.current_bid||b.starting_price));
 main.innerHTML=`<section class="hero"><div><p class="eyebrow">Lykke Padel / Makkerauktion</p><h1>Godt selskab.<span>En bedre sag.</span></h1></div><p class="hero-copy">Find din lykkemakker.<br>Byd på en plads ved siden af en helt særlig spiller — og spil for mere lykke.<small>2. april 2027 · Pakhus 77, Aarhus<br>Makkerauktion for individuelle deltagere.<br>Deltagelse: 10.000 kr. · Vinderbud betales oveni med faktura.</small></p></section><section class="auctions" aria-label="Spillerauktioner"><div class="toolbar"><p><span class="live-dot"></span>${visible.length} ${visible.length===1?'makker':'makkere'} på banen</p><label class="sr-only" for="sort">Sortér auktioner</label><select id="sort"><option value="soon">Udløber først</option><option value="highest">Højeste bud</option><option value="lowest">Laveste bud</option></select></div>${visible.length?`<div class="grid">${visible.map(card).join('')}</div>`:`<div class="empty"><p>${user?'Ingen auktioner at vise endnu. Din profil kan afvente godkendelse, eller auktionerne ligger som kladder.':'Auktionerne er ikke åbnet endnu. Tilmeld dig individuelt for at prøve testauktionen.'}</p><button class="secondary" id="empty-login">Tilmeld dig →</button></div>`}</section><section class="manifesto"><h2>Din makker. Vores fællesskab.</h2><p>Padel, spilleglæde og en god sag.<br>Det er Lykke Padel.</p></section>`;
 $('#sort').value=sort;$('#sort').onchange=event=>{sort=event.target.value;listing();};$('#empty-login')?.addEventListener('click',()=>{location.href=registrationLink();});
}
function detail(id){
 const lot=lots.find(l=>l.id===id);if(!lot){main.innerHTML=`<div class="empty"><h1>Ingen auktion her</h1><p>Auktionen er ikke tilgængelig for din profil.</p><a class="secondary" href="${link()}">Tilbage til alle makkere →</a></div>`;return;}
 main.innerHTML=`<section class="detail"><a class="back" href="${link()}">← Alle lykkemakkere</a><div class="detail-grid"><div class="portrait"><img src="${esc(safeImage(lot.image_url))}" alt="Portræt af ${esc(lot.name)}">${demo?'<span class="example-label">Fiktiv eksempelprofil · Stockfoto</span>':''}</div><div class="detail-content"><p class="eyebrow">Din kommende makker / ${esc(lot.category)}</p><h1>${esc(lot.name)}</h1><p class="detail-description">${esc(lot.description)}</p><div class="detail-meta">2. april 2027 · Pakhus 77, Aarhus<br><span data-ends="${esc(lot.ends_at)}">${countdown(lot.ends_at)}</span><br><span class="help">Slutter ${date(lot.ends_at)} · Dansk tid</span></div><div class="bid-panel"><span class="caption">${lot.bid_count?'Seneste bud':'Startpris'} · ${lot.bid_count} bud</span><div class="detail-price">${money(lot.current_bid||lot.starting_price)}</div>${closed(lot)?'<p class="help">Auktionen er afsluttet. Der kan ikke afgives flere bud.</p>':`<form id="bid-form"><label for="amount" class="caption" style="margin-top:20px">Dit bud i kroner</label><div class="bid-controls"><button class="step" type="button" id="minus" aria-label="Sænk bud med 500 kroner">−</button><input id="amount" name="amount" type="number" min="${minimum(lot)}" max="10000000" step="500" value="${minimum(lot)}" required><button class="step" type="button" id="plus" aria-label="Hæv bud med 500 kroner">+</button></div><button class="primary" type="submit">${demo&&demoLoggedIn?'Giv dit testbud':'Tilmeld dig for at byde'} ↗</button></form><p class="help">Mindst ${money(minimum(lot))} Bud hæves i trin på 500 kr.<br>Du bekræfter beløbet, inden buddet afgives.</p>`}</div><p class="help detail-note">${demo?'Dette er en lokal demonstration. Profiler og bud er fiktive; der sendes ingen faktura.':'Testversion (preview-v1). Ingen betaling eller faktura udsendes fra denne test. Før den offentlige auktion offentliggøres de endelige vilkår og den præcise makkeroplevelse.'}</p></div></div></section>`;
 if(!closed(lot)){
  $('#minus').onclick=()=>$('#amount').value=Math.max(minimum(lot),Number($('#amount').value)-500);
  $('#plus').onclick=()=>$('#amount').value=Math.min(10000000,Number($('#amount').value)+500);
  $('#bid-form').onsubmit=event=>{event.preventDefault();if(!demo){modal('<h2>Vi gør klar til auktionen</h2><p>Adgang til den færdige auktion kræver betalt individuel deltagelse. Tilmeldingen kan indtil videre prøves uden betaling.</p><a class="primary" href="/tilmelding">Prøv tilmeldingen →</a>');return;}if(!demoLoggedIn){if(registration?.type==='pair'){modal('<h2>I spiller som par.</h2><p>Makkerauktionen er for individuelle deltagere. Jeres tilmelding omfatter allerede et makkerpar.</p><a class="secondary" href="/tilmelding">Prøv individuel tilmelding →</a>');}else location.href=registrationLink();return;}if(!demo&&!profile?.approved){toast('Din profil skal godkendes af LykkeLiga, før du kan byde.');if(!profile)showProfileForm();return;}confirmBid(lot,Number($('#amount').value));};
 }
}
function confirmBid(lot,amount){
 if(!Number.isSafeInteger(amount)||amount<minimum(lot)||amount%500!==0){toast(`Dit bud skal være mindst ${money(minimum(lot))} og i trin på 500 kr.`);return;}
 const request=crypto.randomUUID();
 modal(`<p class="eyebrow">${demo?'Testbud':'Bekræft dit bud'}</p><h2>Dig & ${esc(lot.name.split(' ')[0])}?</h2><p>Du byder <strong>${money(amount)}</strong> på at blive makker med ${esc(lot.name)}.</p><p class="help">Dette er en testauktion uden betaling. I den færdige auktion betales vinderbeløbet med faktura.</p><form id="confirm-form"><button class="primary" type="submit">Bekræft ${money(amount)} ↗</button></form>`);
 useForm($('#confirm-form'),async()=>{
  if(demo){if(!canTestBid(readRegistration(sessionStorage)))throw new Error('Individuel testtilmelding kræves for at byde.');if(closed(lot)||amount<minimum(lot))throw new Error('Auktionen er udløbet, eller buddet er blevet overbudt.');lot.current_bid=amount;lot.bid_count++;saveDemo();}
  else{const {error}=await client.rpc('place_auction_bid',{p_lot:lot.id,p_amount:amount,p_request:request});if(error){await fetchLots();detail(lot.id);throw error;}await fetchLots();}
  dialog.close();detail(lot.id);toast(`${demo?'Testbud':'Bud'} på ${money(amount)} er registreret.`);
 });
}
async function adminView(){
 if(!demo&&!isAdmin){main.innerHTML='<div class="empty"><p class="eyebrow">Kun for arrangører</p><h1>Administration</h1><p>Brug din Google-konto på @lykkeliga.dk. Kun udpegede administratorer har adgang.</p><button class="secondary" id="admin-login">Log ind med Google →</button></div>';$('#admin-login').onclick=showAdminLogin;return;}
 main.innerHTML=`<section class="admin"><div class="admin-head"><div><p class="eyebrow">Lykke Padel / Administration</p><h1>Bag om banen.</h1></div><button class="secondary" id="new-lot">Ny auktion +</button></div><p class="help">${demo?'Lokal testadministration. Ændringer gemmes kun i denne browsers session.':'Testmiljø. Auktioner med bud er låst for redigering. Start- og sluttider vises i dansk tid.'}</p><div class="tabs"><button data-tab="lots">Auktioner</button><button data-tab="people">Budgivere</button><button data-tab="winners">Vindere</button></div><div id="admin-body"></div><p class="admin-demo-link"><a href="${link()}">Se makkerauktionen →</a>${demo?' · <button class="text-button" id="reset-demo">Nulstil testdata</button>':''}</p></section>`;
 $('#new-lot').onclick=()=>editLot();
 document.querySelectorAll('[data-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.tab===adminTab);button.onclick=()=>{adminTab=button.dataset.tab;adminView();};});
 $('#reset-demo')?.addEventListener('click',()=>{lots=initialLots();saveDemo();demoProfiles=[];adminView();toast('Testdata er nulstillet.');});
 if(adminTab==='lots')$('#admin-body').innerHTML=`<div class="admin-list">${lots.length?lots.map(l=>`<article class="admin-row"><img src="${esc(safeImage(l.image_url))}" alt=""><div><h2>${esc(l.name)}</h2><p>${esc(l.category)} · ${date(l.ends_at)}</p></div><span class="status">${l.status==='draft'?'Kladde':closed(l)?'Afsluttet':'Publiceret'}</span><span class="price">${money(l.current_bid||l.starting_price)}<span class="caption">${l.bid_count} bud</span></span><button class="secondary" data-edit="${esc(l.id)}">${l.bid_count?'Se detaljer':'Redigér'}</button></article>`).join(''):'<p class="help">Ingen auktioner endnu. Opret den første ovenfor.</p>'}</div>`;
 document.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>editLot(lots.find(l=>l.id===button.dataset.edit)));
 if(adminTab==='people'){
  let people=demo?demoProfiles:[];
  if(!demo){const {data,error}=await client.from('auction_profiles').select('*').order('created_at',{ascending:false});if(error){$('#admin-body').innerHTML=errorHtml(error.message);return;}people=data;}
  $('#admin-body').innerHTML=people.length?people.map(p=>`<article class="admin-row person-row"><div><h2>${esc(p.full_name)}</h2><p>${esc(p.phone)} · ${esc(p.billing_address)}</p></div><span class="status">${p.approved?'Godkendt':'Afventer'}</span><button class="secondary" data-approve="${esc(p.user_id)}" data-approved="${p.approved}">${p.approved?'Blokér':'Godkend'}</button></article>`).join(''):'<div class="empty"><p>Ingen tilmeldte budgivere endnu.</p></div>';
  document.querySelectorAll('[data-approve]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const {error}=await client.rpc('approve_auction_bidder',{p_user:button.dataset.approve,p_approved:button.dataset.approved!=='true'});if(error)throw error;await adminView();toast('Budgiverens status er opdateret.');}catch(error){toast(error.message);button.disabled=false;}});
 }
 if(adminTab==='winners'){
  let winners=[];
  if(!demo){const {data,error}=await client.rpc('auction_winners');if(error){$('#admin-body').innerHTML=errorHtml(error.message);return;}winners=data;}
  $('#admin-body').innerHTML=winners.length?`<p class="help">Fakturagrundlag fra afsluttede auktioner. Faktura oprettes manuelt i jeres fakturasystem.</p><button id="export" class="secondary">Download fakturagrundlag ↓</button>`+winners.map(w=>`<article class="winner"><h2>${esc(w.name)} · ${money(w.amount)}</h2><p>${esc(w.full_name)} · ${esc(w.email)}<br>${esc(w.phone)}<br>${esc(w.billing_address)}</p></article>`).join(''):'<div class="empty"><p>Vindere vises her, når auktionerne er afsluttet med mindst ét bud.</p></div>';
  $('#export')?.addEventListener('click',()=>{const keys=['name','amount','full_name','email','phone','billing_address'];const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"' $&").replaceAll('"','""')+'"';const csv='\uFEFF'+[keys.join(';'),...winners.map(w=>keys.map(k=>cell(w[k])).join(';'))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='lykke-padel-fakturagrundlag.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 }
}
function localDate(value){const d=new Date(value);const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);return parts.replace(' ','T');}
// Convert Copenhagen wall-clock input to an instant, independent of browser timezone.
function danishInstant(value){const dateValue=new Date(value+'Z');let result=dateValue.getTime();for(let i=0;i<3;i++){const shown=localDate(new Date(result));result+=dateValue.getTime()-new Date(shown+'Z').getTime();}if(localDate(new Date(result))!==value)throw new Error('Dette klokkeslæt findes ikke i dansk tid. Vælg et andet tidspunkt.');return new Date(result).toISOString();}
function editLot(lot){
 if(lot?.bid_count){modal(`<h2>${esc(lot.name)}</h2><p>${esc(lot.description)}</p><p>${lot.bid_count} bud · ${money(lot.current_bid)}<br>Udløb: ${date(lot.ends_at)}</p><p class="help">Auktionen har bud og er låst. Kontakt arrangøren ved fejl; budhistorikken må ikke ændres vilkårligt.</p>`);return;}
 modal(`<p class="eyebrow">Administration</p><h2>${lot?'Redigér makker':'En ny makker'}</h2><form id="lot-form"><label>Navn<input name="name" value="${esc(lot?.name||'')}" minlength="2" maxlength="100" required></label><label>Kategori<input name="category" value="${esc(lot?.category||'')}" placeholder="Fx musiker eller padelspiller" maxlength="60" required></label><label>Billede (HTTPS-adresse)<input name="image" type="url" pattern="https://.*" value="${esc(lot?.image_url||'')}" required></label><label>Beskrivelse<textarea name="description" minlength="10" maxlength="3000" required>${esc(lot?.description||'')}</textarea></label><div class="form-pair"><label>Startpris i kr.<input name="start" type="number" min="500" max="10000000" step="500" value="${lot?.starting_price||500}" required></label><label>Status<select name="status"><option value="draft">Kladde</option><option value="live" ${lot?.status==='live'?'selected':''}>Publiceret</option></select></label></div><label>Udløber — dansk tid<input name="ends" type="datetime-local" value="${localDate(lot?.ends_at||new Date(Date.now()+7*86400000))}" required></label><p class="help">Mindste budstigning er 500 kr. En publiceret auktion kan ses af godkendte testbudgivere. Klargør navn, billede og beskrivelse før publicering.</p><button class="primary" type="submit">Gem auktion →</button></form>`);
 useForm($('#lot-form'),async form=>{
  const ends=danishInstant(field(form,'ends'));if(new Date(ends)<=new Date())throw new Error('Sluttidspunktet skal ligge i fremtiden.');
  const values={p_id:lot?.id||null,p_name:field(form,'name'),p_category:field(form,'category'),p_description:field(form,'description'),p_image:field(form,'image'),p_ends:ends,p_start:Number(field(form,'start')),p_status:field(form,'status')};
  if(demo){const next={id:lot?.id||crypto.randomUUID(),name:values.p_name,category:values.p_category,description:values.p_description,image_url:values.p_image,ends_at:ends,starting_price:values.p_start,status:values.p_status,current_bid:0,bid_count:0};if(lot)lots[lots.findIndex(l=>l.id===lot.id)]=next;else lots.push(next);saveDemo();}
  else{const {error}=await client.rpc('save_auction_lot',values);if(error)throw error;await fetchLots();}
  dialog.close();await adminView();toast('Auktionen er gemt.');
 });
}
async function render(){accountLabel();if(registrationPage){registrationView();return;}if(adminPage){await adminView();return;}const id=location.hash.startsWith('#spiller/')?decodeURIComponent(location.hash.slice(9)):null;if(id)detail(id);else listing();}
async function refresh(){if(!demo){await loadIdentity();await fetchLots();}await render();}
window.addEventListener('hashchange',()=>{window.scrollTo(0,0);render().catch(error=>toast(error.message));});
setInterval(()=>{document.querySelectorAll('[data-ends]').forEach(el=>el.textContent=countdown(el.dataset.ends));const bidForm=$('#bid-form');if(bidForm){const id=location.hash.slice(9);if(lots.find(l=>l.id===id&&closed(l)))detail(id);}},1000);
setInterval(async()=>{if(demo||!client||document.hidden||polling||dialog.open||adminPage)return;polling=true;try{const old=JSON.stringify(lots);await fetchLots();if(old!==JSON.stringify(lots))await render();}catch{toast('Kunne ikke opdatere bud. Din forbindelse kontrolleres igen om lidt.');}finally{polling=false;}},10000);
async function start(){
 if(registrationPage){$('#preview-banner').textContent='TESTTILMELDING · INGEN BETALING · INGEN PLADS RESERVERES';$('#preview-banner').hidden=false;accountLabel();registrationView();return;}
 if(demo){$('#preview-banner').hidden=false;lots=readDemo();await render();return;}
 const response=await fetch('/api/auction-config'+(adminPage?'?context=admin':''));
 if(response.status===404&&!adminPage){demo=true;$('#preview-banner').hidden=false;lots=readDemo();await render();return;}
 if(!response.ok){main.innerHTML='<div class="empty"><p class="eyebrow">Vi gør klar til første serv</p><h1>Auktionen er ikke åben endnu.</h1><p>Den offentlige forside er klar. Makkerauktionen kommer senere.</p><a href="/" class="secondary">Til forsiden →</a></div>';$('#account').hidden=true;return;}
 const config=await response.json();client=createClient(config.url,config.key);
 if(adminPage){const authError=new URLSearchParams(location.hash.slice(1)).get('error_description')||new URLSearchParams(location.search).get('error_description');if(authError){history.replaceState(null,'','/admin');toast('Google-login kunne ikke gennemføres. Prøv igen eller kontakt arrangøren.');}}
 $('#preview-banner').textContent='TESTMILJØ · EKSEMPELPROFILER · INGEN BETALING ELLER FAKTURERING';$('#preview-banner').hidden=false;
 client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')setTimeout(showNewPassword,0);});
 await client.auth.getSession();await refresh();
}
start().catch(error=>{main.innerHTML=`<div class="empty"><h1>Vi mangler forbindelsen.</h1><p>Auktionen kunne ikke indlæses. Forsiden er stadig tilgængelig.</p>${errorHtml(messageError(error))}<button class="secondary" id="retry">Prøv igen →</button></div>`;$('#retry').onclick=()=>location.reload();});

function registrationView(step=1,draft={type:'individual'}){
 document.title='Tilmelding — Lykke Padel';
 const chosen=packages[draft.type]||packages.individual;
 const inclusions='<p>Mad & forplejning · T-shirt · Præmier · Goodiebag · Showkamp om aftenen</p>';
 const steps=`<ol class="registration-steps" aria-label="Tilmeldingens trin">${['Vælg deltagelse','Dine oplysninger','Bekræft'].map((text,i)=>`<li ${step===i+1?'aria-current="step"':''}><span>${i+1}</span>${text}</li>`).join('')}</ol>`;
 main.innerHTML=`<section class="registration"><a class="back" href="/auktion">← Til makkerauktionen</a><div class="registration-heading"><p class="eyebrow">2. april 2027 / Pakhus 77, Aarhus</p><h1>En plads på banen.<br>En forskel for andre.</h1><p>Omkring 70 spillere. Én fælles sag. Vær med til en dag med padel, fællesskab og mere lykke.</p></div>${steps}<div id="registration-content"></div></section>`;
 const content=$('#registration-content');
 if(step===1){
  content.innerHTML=`<form id="package-form"><fieldset class="package-options"><legend class="sr-only">Hvordan vil du deltage?</legend>${Object.entries(packages).map(([key,p])=>`<label class="package-option"><input type="radio" name="type" value="${key}" ${draft.type===key?'checked':''} required><span class="package-inner"><span class="eyebrow">${p.seats===1?'1 deltager':'2 deltagere · ét par'}</span><strong>${p.name}</strong><span class="package-price">${money(p.price)}</span><span class="package-description">${key==='individual'?'Vi sammensætter dig med en makker. Du kan også byde på en kendt eller professionel spiller i makkerauktionen.':'I tilmelder jer som et fast makkerpar og spiller sammen. Makkerauktionen er for individuelle deltagere.'}</span><span class="package-choice">Vælg ${key==='individual'?'individuel':'par'} <span aria-hidden="true">→</span></span></span></label>`).join('')}</fieldset><div class="included"><h2>Hele oplevelsen er med.</h2>${inclusions}<p class="help">Tilmeldingsbeløbet er arrangementets primære charitybidrag. Et eventuelt vinderbud på en makker kommer oveni.</p></div><div class="registration-actions"><p class="help">Du prøver tilmeldingen. Der opkræves ingen betaling, og der reserveres ingen plads.</p><button class="primary" type="submit">Fortsæt →</button></div></form>`;
  $('#package-form').onsubmit=e=>{e.preventDefault();registrationView(2,{...draft,type:field(e.currentTarget,'type')});window.scrollTo(0,0);};
 }else if(step===2){
  content.innerHTML=`<div class="registration-layout"><form id="event-registration-form"><h2>Hvem kommer på banen?</h2><p class="help">Brug gerne fiktive oplysninger i testen. De gemmes kun i denne browsers session.</p><label>Dit fulde navn<input name="name" autocomplete="name" maxlength="120" value="${esc(draft.name||'')}" required></label><div class="form-pair"><label>Mailadresse<input name="email" type="email" autocomplete="email" maxlength="254" value="${esc(draft.email||'')}" required></label><label>Mobilnummer<input name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(draft.phone||'')}" required></label></div>${draft.type==='pair'?`<label>Din makkers fulde navn<input name="partner" maxlength="120" value="${esc(draft.partner||'')}" required></label>`:''}<p class="help">T-shirtstørrelse og særlige kostbehov indsamler vi senere.</p><div class="registration-actions"><button type="button" class="text-button" id="package-back">← Vælg deltagelse</button><button class="primary" type="submit">Se din tilmelding →</button></div></form><aside class="registration-summary"><p class="eyebrow">Din deltagelse</p><h2>${chosen.name}</h2><p>${chosen.seats} ${chosen.seats===1?'deltager':'deltagere'}</p><strong class="package-price">${money(chosen.price)}</strong><p class="help">Pris ved den endelige tilmelding.<br>Du betaler 0 kr. i testen.</p>${inclusions}</aside></div>`;
  $('#package-back').onclick=()=>{const form=$('#event-registration-form');registrationView(1,{...draft,...Object.fromEntries(new FormData(form))});};
  useForm($('#event-registration-form'),async form=>{const next=validateRegistration({...Object.fromEntries(new FormData(form)),type:draft.type});registrationView(3,next);window.scrollTo(0,0);});
 }else{
  content.innerHTML=`<div class="registration-layout"><form id="registration-confirm"><h2>Det bliver en god dag.</h2><p>Gennemse din testtilmelding, inden du bekræfter.</p><dl class="registration-details"><div><dt>Deltagelse</dt><dd>${chosen.name} · ${chosen.seats} ${chosen.seats===1?'deltager':'deltagere'}</dd></div><div><dt>Navn</dt><dd>${esc(draft.name)}</dd></div>${draft.type==='pair'?`<div><dt>Makker</dt><dd>${esc(draft.partner)}</dd></div>`:''}<div><dt>Mailadresse</dt><dd>${esc(draft.email)}</dd></div><div><dt>Mobilnummer</dt><dd>${esc(draft.phone)}</dd></div><div><dt>Pris ved rigtig tilmelding</dt><dd>${money(chosen.price)}</dd></div><div><dt>Til betaling i dag</dt><dd>0 kr. · test</dd></div></dl><label class="check-label"><input type="checkbox" name="test" required><span>Jeg forstår, at dette er en test. Oplysningerne gemmes kun i browserens session. Der sendes ingen mail, reserveres ingen plads og opkræves ingen betaling.</span></label><div class="registration-actions"><button class="text-button" type="button" id="details-back">← Ret oplysninger</button><button class="primary" type="submit">Bekræft testtilmelding →</button></div></form><aside class="registration-summary"><p class="eyebrow">Og så?</p><h2>${draft.type==='individual'?'Find din lykkemakker.':'Jeres makkerpar er klar.'}</h2><p>${draft.type==='individual'?'Efter testtilmeldingen kan du prøve at byde på en makker. I den endelige løsning får du først adgang, når de 10.000 kr. er betalt.':'I spiller som par. Tilmelding som par giver ikke adgang til at byde på en anden makker.'}</p><p class="help">En individuel deltager, der ikke vinder en auktion, får en makker sammensat af os. Vinderbud faktureres efter auktionens afslutning.</p></aside></div>`;
  $('#details-back').onclick=()=>registrationView(2,draft);
  useForm($('#registration-confirm'),async()=>{
   const checked=validateRegistration(draft);
   sessionStorage.setItem(registrationKey,JSON.stringify({...checked,test:true}));registration={...checked,test:true};demoLoggedIn=canTestBid(registration);
   main.innerHTML=`<section class="registration registration-success"><p class="eyebrow">Testtilmelding gennemført</p><h1>${draft.type==='individual'?'Du er klar til et testbud.':'Jeres testpar er klar.'}</h1><p>${esc(draft.name)}${draft.type==='pair'?' & '+esc(draft.partner):''} · ${chosen.name}</p><p>Tak fordi du prøver flowet. Der er ikke reserveret en plads eller sendt en mail. Du har ikke betalt noget.</p>${draft.type==='individual'?'<a class="primary" href="/auktion?demo=1">Prøv makkerauktionen →</a>':'<a class="secondary" href="/auktion">Se makkerauktionen →</a>'}<p class="help">${draft.type==='individual'?'I den endelige løsning kræves betalt individuel deltagelse for at byde.':'Makkerauktionen er kun for individuelle deltagere.'}</p><button class="text-button" id="registration-reset">Nulstil testtilmelding</button></section>`;
   $('#registration-reset').onclick=()=>{sessionStorage.removeItem(registrationKey);registration=null;demoLoggedIn=false;registrationView();};window.scrollTo(0,0);
  });
 }
}
