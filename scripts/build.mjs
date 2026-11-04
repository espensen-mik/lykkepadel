import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'style.css']) await cp(file, `dist/${file}`);
await cp('public', 'dist', { recursive: true });
for(const route of ['auktion','tilmelding','deltager','admin','administration']){
 await mkdir(`dist/${route}`,{recursive:true});
 await cp('src/auction.html',`dist/${route}/index.html`);
}
await cp('src/auction.css','dist/auction.css');
await mkdir('dist/forsidetest',{recursive:true});
await cp('src/front-test.html','dist/forsidetest/index.html');
await cp('src/front-test.css','dist/front-test.css');
await build({entryPoints:['src/front-test.js'],outfile:'dist/front-test.js',bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true});
await build({entryPoints:['src/auction.js'],outfile:'dist/auction.js',bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true});
console.log('Forside og auktionssider er bygget i dist/');
