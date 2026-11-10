// Curated example profiles. Research sources: docs/MAKKERE-KILDER.md.
export const examplePlayers = [
 {name:'Emil Lilleøre',category:'Padelspiller',image_url:'/images/Makker/lilleøre.jpeg',instagram:'emil_lilleore',description:'Dansk padelspiller og danmarksmester i 2026 sammen med Malthe Nielsen. Emil har også repræsenteret Danmark på seniorlandsholdet og spiller turneringer på den internationale FIP-tour.'},
 {name:'Emil Okkels',category:'Padelspiller',image_url:'/images/Makker/emil_okkels.webp',instagram:'0kkels',description:'En profil i dansk elitepadel med landsholdserfaring og internationale FIP-turneringer på CV’et. I 2026 spillede Emil sig til DM-sølv sammen med Oscar Sebber.'},
 {name:'Stig Tøfting',category:'Fodboldprofil',image_url:'/images/Makker/stig_tøfting.webp',instagram:'stigtoftingofficial',description:'Du kender ham som Tøffe. Den tidligere landsholdsspiller har spillet for blandt andre AGF, Hamburger SV og Bolton. I dag er han kendt som fodboldkommentator — og padel er også blandt hans interesser.'}
];
// Example charity products for the demo auction.
export const exampleItems = [
 {name:'LykkeLiga ShowKamp på din virksomhed',category:'Oplevelse',image_url:'/images/brand/spillere2_16_9.jpg',value_text:'Uvurderligt',
  description:'En helt unik mulighed for at se lykkelig håndbold i verdensklasse ude på din egen virksomhed. 10 af vores allerstørste stjerner møder op og viser, hvor lykkeskabet skal stå, når de spiller en showkamp på jeres parkeringsplads, i jeres reception eller på direktørens kontor. LykkeLiga medbringer mål og dommer og giver jeres virksomhed et eksklusivt skud lykke i arbejdsdagen.'},
];

export function initialLots() {
 const partners=examplePlayers.map((player,i)=>({...player,kind:'partner',id:`demo-${i+1}`,
  ends_at:new Date(Date.now()+(3+i)*86400000+7200000).toISOString(),starting_price:500,
  current_bid:[3500,5000,2000][i],bid_count:[7,10,4][i],status:'live'}));
 const items=exampleItems.map((item,i)=>({...item,kind:'item',id:`demo-${partners.length+i+1}`,
  ends_at:new Date(Date.now()+2*86400000+3600000).toISOString(),starting_price:5000,
  current_bid:12000,bid_count:5,status:'live'}));
 return [...items,...partners];
}

// Example bid history for the demo auction. Names are invented.
const demoNames = ['Smash & Co.', 'Bagvæggen', 'Lykkelig Lars', 'Team Netkant', 'En hemmelig beundrer', 'Volley-Vibeke'];
export function demoHistory(lot) {
  if (Array.isArray(lot.history)) return lot.history;
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < lot.bid_count; i++) {
    rows.push({
      amount: lot.current_bid - i * 500,
      created_at: new Date(now - (i + 1) * 5.5 * 3600000).toISOString(),
      display_name: demoNames[(i + lot.name.length) % demoNames.length],
      is_mine: false,
    });
  }
  return rows.filter((row) => row.amount >= lot.starting_price);
}
