export const registrationKey='lykke-event-registration-v1';
export const packages={individual:{name:'Individuel deltagelse',price:10000,seats:1},pair:{name:'Deltagelse som par',price:25000,seats:2}};
export function validateRegistration(value){
 if(!packages[value?.type])throw new Error('Vælg individuel deltagelse eller et par.');
 if(!value.name?.trim()||value.name.trim().length>120)throw new Error('Udfyld dit navn (højst 120 tegn).');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email||'')||value.email.length>254)throw new Error('Udfyld en gyldig mailadresse.');
 if(!/^[+\d ()-]{6,30}$/.test(value.phone||''))throw new Error('Udfyld et gyldigt mobilnummer.');
 if(value.type==='pair'&&(!value.partner?.trim()||value.partner.trim().length>120))throw new Error('Udfyld din makkers navn (højst 120 tegn).');
 return {type:value.type,name:value.name.trim(),email:value.email.trim(),phone:value.phone.trim(),partner:value.type==='pair'?value.partner.trim():''};
}
export function readRegistration(storage){try{const value=JSON.parse(storage.getItem(registrationKey));if(value?.test!==true)return null;return {...validateRegistration(value),test:true};}catch{return null;}}
export function canTestBid(registration){return registration?.test===true&&registration.type==='individual';}
