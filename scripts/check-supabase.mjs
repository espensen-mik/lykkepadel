import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Deployment environment variables take precedence over local configuration.
let local = {};
try {
  local = parseEnv(await readFile(new URL('../.env.local', import.meta.url), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

try {
  const url = process.env.SUPABASE_URL || local.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || local.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Angiv SUPABASE_URL og SUPABASE_PUBLISHABLE_KEY i .env.local eller miljøvariabler.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co')) {
    throw new Error('SUPABASE_URL skal være en HTTPS-adresse på supabase.co.');
  }
  if (!key.startsWith('sb_publishable_')) throw new Error('Brug en publishable key, ikke en secret- eller service-role-nøgle.');
  const response = await fetch(new URL('/auth/v1/settings', endpoint), {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Supabase afviste forbindelsestjekket (HTTP ${response.status}).`);
  await response.json();
  console.log(`Supabase-forbindelse OK: ${endpoint.hostname}`);
  console.log('Projektets Auth API svarer med den angivne nøgle. Ingen data er oprettet eller ændret.');
} catch (error) {
  console.error(`Forbindelsestjek fejlede: ${error.message}`);
  process.exitCode = 1;
}
