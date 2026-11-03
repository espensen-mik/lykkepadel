export const photos = [
'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=1000&q=85',
'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=85',
'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1000&q=85',
'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1000&q=85',
'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1000&q=85',
'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1000&q=85'];
const names=['Oscar Holm','Alma Vester','Emil Lund','Clara Storm','August Friis','Sofie Berg'];
const categories=['Musiker','Padelspiller','Komiker','Musiker','Sportsprofil','Padelspiller'];
const bios=[
'Fra scenen til centercourt. Oscar tager sin energi og spilleglæde med på banen — og du bliver hans makker. Glæd dig til en oplevelse med højt humør og plads til både gode dueller og skæve slag.',
'En makker med overblik, overskud og et skarpt netspil. Alma hjælper dig ind i kampen, så I sammen kan spille for mere lykke. Her er fællesskabet mindst lige så vigtigt som resultatet.',
'God timing er ikke kun noget, man bruger på en scene. Emil er klar på sjove dueller, et smil mellem boldene og en helt særlig dag som dit makkerpar.',
'Clara bytter mikrofonen ud med et padelbat for en dag. Byd på en plads ved hendes side og vær med til at give en god sag endnu mere medvind.',
'Konkurrencegen og fællesskab går hånd i hånd. August er klar til at spille sammen med dig og gøre hver eneste bold til en del af en større oplevelse.',
'Sofie elsker spillets tempo og glæden ved at få sin makker til at lykkes. Kom med på banen til en dag med gode råd, stærke dueller og masser af spilleglæde.'
];
export function initialLots() {
 return names.map((name,i)=>({id:`demo-${i+1}`,name,category:categories[i],description:bios[i],image_url:photos[i],
 ends_at:new Date(Date.now()+(3+i)*86400000+7200000).toISOString(),starting_price:500,
 current_bid:[3500,5000,2000,4500,1500,3000][i],bid_count:[7,10,4,9,3,6][i],status:'live'}));
}
