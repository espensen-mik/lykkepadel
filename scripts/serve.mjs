import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { parseEnv } from 'node:util';
import configHandler from '../api/auction-config.mjs';
if(!process.argv[2]) await import('./build.mjs');
try {
 const local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
 for(const [key,value] of Object.entries(local))if(process.env[key]===undefined)process.env[key]=value;
} catch(error){if(error.code!=='ENOENT')throw error;}
const root=resolve(process.argv[2]||'dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/api/auction-config'){configHandler(req,res);return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const routes={'/':'index.html','/auktion':'auktion/index.html','/auktion/':'auktion/index.html','/administration':'administration/index.html','/administration/':'administration/index.html'};
  const relative=routes[pathname]||pathname.slice(1);
  if(relative.split('/').some(part=>part.startsWith('.'))){res.writeHead(404).end();return;}
  const file=resolve(root,relative);
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  const data=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404).end('Ikke fundet');}
}).listen(Number(process.env.PORT||5173),'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${process.env.PORT||5173}`));
