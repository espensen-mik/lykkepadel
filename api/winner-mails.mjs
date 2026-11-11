import { winnerMail, SENDER, REPLY_TO } from '../src/winner-mail.js';

// Sends winner mails through Resend. The caller's own Supabase session decides access:
// the winner list and the "mailed" mark are admin-only database functions.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

export default async function handler(req, res, { fetch: send = fetch, pause = wait } = {}) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Brug POST.' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const resend = process.env.RESEND_API_KEY;
  if (!url || !key || !resend) return reply(res, 503, { error: 'Mailafsendelse er ikke sat op (RESEND_API_KEY mangler i Vercel).' });
  const token = /^Bearer ([\w.-]+)$/.exec(req.headers?.authorization || '')?.[1];
  if (!token) return reply(res, 401, { error: 'Log ind som administrator.' });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return reply(res, 400, { error: 'Ugyldig forespørgsel.' });
  }
  const lots = Array.isArray(body.lots) ? body.lots.filter((id) => UUID.test(id)) : [];
  const request = UUID.test(body.request || '') ? body.request : null;
  if (!lots.length || lots.length > 100 || !request) return reply(res, 400, { error: 'Vælg mindst én vinder.' });

  const supabase = (path, payload) =>
    send(new URL(path, url), {
      method: payload ? 'POST' : 'GET',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });

  const list = await supabase('/rest/v1/rpc/auction_winners', {});
  if (!list.ok) return reply(res, 403, { error: 'Kun administratorer kan sende vindermails.' });
  const winners = await list.json();

  // A test sends the first chosen mail to the admin's own address and marks nothing.
  let testTo = null;
  if (body.test) {
    const me = await supabase('/auth/v1/user');
    testTo = me.ok ? (await me.json()).email : null;
    if (!testTo) return reply(res, 401, { error: 'Kunne ikke finde din mailadresse.' });
  }

  const sent = [];
  const failed = [];
  for (const id of body.test ? lots.slice(0, 1) : lots) {
    const winner = winners.find((w) => w.id === id);
    if (!winner) {
      failed.push({ id, error: 'Auktionen er ikke afsluttet med en vinder.' });
      continue;
    }
    const mail = winnerMail(winner);
    const response = await send('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend}`,
        'Content-Type': 'application/json',
        // The same click never sends the same mail twice.
        'Idempotency-Key': `winner-${id}-${request}${testTo ? '-test' : ''}`,
      },
      body: JSON.stringify({
        from: SENDER,
        to: [testTo || winner.email],
        reply_to: REPLY_TO,
        subject: testTo ? `[Test] ${mail.subject}` : mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      failed.push({ id, error: `Resend afviste mailen${detail.message ? `: ${detail.message}` : ''}.` });
    } else if (!testTo) {
      const marked = await supabase('/rest/v1/rpc/mark_auction_winner_mail', { p_lot: id, p_email: winner.email });
      if (marked.ok) sent.push(id);
      else failed.push({ id, error: 'Mailen er sendt, men kunne ikke markeres som sendt.' });
    } else sent.push(id);
    // Resend allows a few requests per second.
    await pause(600);
  }
  return reply(res, failed.length && !sent.length ? 502 : 200, { sent, failed, test: Boolean(testTo), to: testTo });
}
