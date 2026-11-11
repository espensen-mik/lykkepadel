import { ticketMail } from '../src/ticket-receipt.js';
import { SENDER, REPLY_TO } from '../src/winner-mail.js';

// Sends the ticket mail with the receipt through Resend.
// The buyer's page calls it with the order token right after payment; it is sent once.
// An admin can resend it with their own session (no token needed).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Links in the mail point to this site; unknown hosts fall back to the live address.
function siteUrl(host) {
  return /^(www\.)?lykkepadel\.dk$|^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || '')
    ? `${host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'}://${host}`
    : 'https://www.lykkepadel.dk';
}

export default async function handler(req, res, { fetch: send = fetch } = {}) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Brug POST.' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const resend = process.env.RESEND_API_KEY || process.env.Resend_Api_Key;
  if (!url || !key || !resend) return reply(res, 503, { error: 'Mailafsendelse er ikke sat op.' });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return reply(res, 400, { error: 'Ugyldig forespørgsel.' });
  }
  if (!UUID.test(body.order || '')) return reply(res, 400, { error: 'Ugyldig ordre.' });
  const bearer = /^Bearer ([\w.-]+)$/.exec(req.headers?.authorization || '')?.[1];
  const rpc = (name, args, auth) =>
    send(new URL(`/rest/v1/rpc/${name}`, url), {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(args),
    });

  // An admin resend fetches the token with the admin's session; the buyer brings it.
  let token = typeof body.token === 'string' && /^[0-9a-f]{64}$/.test(body.token) ? body.token : null;
  const resendByAdmin = !token && Boolean(bearer);
  if (resendByAdmin) {
    const result = await rpc('admin_ticket_token', { p_id: body.order }, bearer);
    token = result.ok ? await result.json() : null;
    if (!token) return reply(res, 403, { error: 'Kun administratorer kan sende kvitteringen igen.' });
  }
  if (!token) return reply(res, 400, { error: 'Ugyldig ordre.' });

  const found = await rpc('ticket_order', { p_id: body.order, p_token: token });
  if (!found.ok) return reply(res, 404, { error: 'Ordren findes ikke.' });
  const order = await found.json();
  if (order.status !== 'paid') return reply(res, 409, { error: 'Ordren er ikke betalt.' });

  if (!resendByAdmin) {
    const claim = await rpc('claim_ticket_receipt', { p_id: body.order, p_token: token, p_claim: true });
    if (!claim.ok || !(await claim.json())) return reply(res, 200, { sent: false, reason: 'already-sent' });
  }

  const mail = ticketMail(order, `${siteUrl(req.headers?.host)}/billet#${order.id}.${token}`);
  const sent = await send('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json', 'Idempotency-Key': `ticket-${order.id}-${resendByAdmin ? Date.now() : 'first'}` },
    body: JSON.stringify({ from: SENDER, to: [order.email], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!sent.ok) {
    if (!resendByAdmin) await rpc('claim_ticket_receipt', { p_id: body.order, p_token: token, p_claim: false });
    return reply(res, 502, { error: 'Mailen kunne ikke sendes. Prøv igen om lidt.' });
  }
  return reply(res, 200, { sent: true, to: order.email });
}
