// Seller, event and receipt text for tickets. Used by the ticket page and the receipt mail.

export const SELLER = {
  name: 'LykkeLiga',
  address: 'Ølgodvej 7, 9220 Aalborg Øst',
  cvr: '38523252',
  email: 'signe@lykkeliga.dk',
};
export const EVENT = { name: 'Charity Showkamp', date: '2. april 2027', doors: 'kl. 16.00', place: 'Pakhus77, Aarhus' };
export const receiptNote = 'LykkeLiga er ikke momsregistreret, og der er ingen moms i beløbet.';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kr = (value) => `${new Intl.NumberFormat('da-DK').format(value)} kr.`;
const day = (value) =>
  new Date(value).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen' });

// The mail with the ticket link and the receipt. `link` is the buyer's private ticket page.
export function ticketMail(order, link) {
  const test = order.is_test;
  const count = order.quantity === 1 ? '1 billet' : `${order.quantity} billetter`;
  const subject = `${test ? '[TEST] ' : ''}Dine billetter til ${EVENT.name} · kvittering ${order.receipt}`;
  const codes = order.tickets.map((t) => t.code);
  const buyer = [order.buyer_name, order.email, ...(order.company_name ? [order.company_name, `CVR ${order.company_cvr}`, order.company_address] : [])];
  const seller = [SELLER.name, SELLER.address, `CVR ${SELLER.cvr}`, SELLER.email];
  const line = `${order.quantity} × billet til ${EVENT.name} à ${kr(order.unit_price)}`;
  const payment = test ? 'Testbetaling – intet beløb er trukket' : 'Betalt med kort/MobilePay';

  const text = [
    `Hej ${order.buyer_name}`,
    `Tak for dit køb af ${count} til ${EVENT.name} den ${EVENT.date} i ${EVENT.place}. Dørene åbner ${EVENT.doors}.`,
    ...(test ? ['Dette er et testkøb. Der er ikke trukket penge, og billetterne giver ikke adgang.'] : []),
    `Se og vis dine billetter her:\n${link}`,
    `Billetkoder: ${codes.join(', ')}`,
    `KVITTERING ${order.receipt}\nDato: ${day(order.paid_at)}\n\nSælger:\n${seller.join('\n')}\n\nKøber:\n${buyer.join('\n')}\n\n${line}: ${kr(order.amount)}\nI alt: ${kr(order.amount)}\n${payment}\n${receiptNote}`,
    `Spørgsmål? Svar på denne mail eller skriv til ${SELLER.email}.`,
    'Lykke Padel · LykkeLiga og NORMAL',
  ].join('\n\n');

  const p = (value) => `<p style="margin:0 0 16px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#3a1c18">${value}</p>`;
  const cell = 'font:15px/1.5 Arial,Helvetica,sans-serif;color:#3a1c18;vertical-align:top;padding:4px 0';
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3ead2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ead2"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffce0;border-radius:12px;overflow:hidden">
<tr><td style="background:#2b1513;padding:24px 32px;font:bold 22px/1.2 Arial,Helvetica,sans-serif;letter-spacing:1px;color:#fffce0">LYKKE PADEL</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 8px;font:bold 13px/1.4 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#c42a1c">${esc(EVENT.name)}</p>
<h1 style="margin:0 0 24px;font:bold 28px/1.2 Arial,Helvetica,sans-serif;color:#2b1513">${test ? 'Testkøb: ' : ''}Tak for dit køb</h1>
${p(`Hej ${esc(order.buyer_name)}`)}
${p(`Du har købt ${count} til ${esc(EVENT.name)} den ${EVENT.date} i ${esc(EVENT.place)}. Dørene åbner ${EVENT.doors}.`)}
${test ? `<p style="margin:0 0 16px;padding:12px 16px;background:#ffe3df;border-radius:8px;font:bold 15px/1.5 Arial,Helvetica,sans-serif;color:#c42a1c">Dette er et testkøb. Der er ikke trukket penge, og billetterne giver ikke adgang.</p>` : ''}
<p style="margin:8px 0 24px"><a href="${esc(link)}" style="display:inline-block;padding:14px 24px;background:#d42f20;border-radius:999px;color:#fffce0;font:bold 16px Arial,Helvetica,sans-serif;text-decoration:none">Se dine billetter</a></p>
${p(`Vis billetterne på din telefon ved indgangen. Hver billet har sin egen QR-kode og kan bruges én gang. Billetkoder: <strong>${codes.map(esc).join(', ')}</strong>`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0;padding:20px;background:#f3ead2;border-radius:8px">
<tr><td colspan="2" style="font:bold 18px/1.3 Arial,Helvetica,sans-serif;color:#2b1513;padding-bottom:12px">Kvittering ${esc(order.receipt)}</td></tr>
<tr><td style="${cell};width:50%;padding-right:12px"><strong>Sælger</strong><br>${seller.map(esc).join('<br>')}</td><td style="${cell}"><strong>Køber</strong><br>${buyer.map(esc).join('<br>')}</td></tr>
<tr><td colspan="2" style="${cell};padding-top:12px">Dato: ${day(order.paid_at)}</td></tr>
<tr><td style="${cell};border-top:1px solid #e9dcc4;padding-top:10px">${esc(line)}</td><td align="right" style="${cell};border-top:1px solid #e9dcc4;padding-top:10px">${kr(order.amount)}</td></tr>
<tr><td style="${cell};font-weight:bold">I alt</td><td align="right" style="${cell};font-weight:bold">${kr(order.amount)}</td></tr>
<tr><td colspan="2" style="${cell};padding-top:10px;color:#6b4a44">${esc(payment)}. ${esc(receiptNote)}</td></tr>
</table>
<p style="margin:24px 0 0;font:15px/1.55 Arial,Helvetica,sans-serif;color:#3a1c18">Spørgsmål? Svar på denne mail eller skriv til ${esc(SELLER.email)}.</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e9dcc4;font:13px/1.5 Arial,Helvetica,sans-serif;color:#6b4a44">Lykke Padel · ${EVENT.date} · ${esc(EVENT.place)}<br>Arrangeret af LykkeLiga, powered by NORMAL</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
