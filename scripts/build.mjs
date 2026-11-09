import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

// The landing page (index.html + style.css) is copied as it is. All other pages
// use the design system (src/lp.css) and share header and footer partials.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'style.css']) await cp(file, `dist/${file}`);
await cp('public', 'dist', { recursive: true });
await cp('src/lp.css', 'dist/lp.css');

const header = await readFile('src/partials/header.html', 'utf8');
const footer = await readFile('src/partials/footer.html', 'utf8');

function withLayout(html, current) {
  const nav = header.replace(/ data-nav="([^"]+)"/g, (_, name) => (name === current ? ' aria-current="page"' : ''));
  return html.replace('<!-- header -->', nav).replace('<!-- footer -->', footer);
}

// route → [template, menu item marked as current]
const pages = {
  auktion: ['src/auction.html', 'auktion'],
  tilmelding: ['src/auction.html', ''],
  deltager: ['src/auction.html', 'deltager'],
  admin: ['src/auction.html', ''],
  administration: ['src/auction.html', ''],
  'om-dagen': ['src/om-dagen.html', 'om-dagen'],
  sagen: ['src/sagen.html', 'sagen'],
};
for (const [route, [template, current]] of Object.entries(pages)) {
  await mkdir(`dist/${route}`, { recursive: true });
  await writeFile(`dist/${route}/index.html`, withLayout(await readFile(template, 'utf8'), current));
}

await build({
  entryPoints: ['src/auction.js'],
  outfile: 'dist/auction.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
});
console.log('Sider er bygget i dist/');
