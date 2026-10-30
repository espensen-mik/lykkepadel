import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'style.css']) await cp(file, `dist/${file}`);
await cp('public', 'dist', { recursive: true });
console.log('Forsiden er bygget i dist/');
