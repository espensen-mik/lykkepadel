// The mail a winner gets after Lykke Auktion. Used by /api/winner-mails and by the preview in admin.

export const SENDER = 'Lykke Padel <padel@forms.lykkeliga.dk>';
export const REPLY_TO = 'signe@lykkeliga.dk';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kr = (value) => `${new Intl.NumberFormat('da-DK').format(value)} kr.`;

export function winnerMail(w) {
  const partner = w.kind === 'partner';
  const subject = partner ? `Tillykke! Du skal spille padel med ${w.name}` : `Tillykke! Du har vundet ${w.name}`;
  const prize = partner
    ? `Du skal spille sammen med ${w.name} i Charity Turnering den 2. april 2027 i Pakhus77, Aarhus. Vi kontakter dig før dagen med det praktiske.`
    : 'Vi kontakter dig om, hvordan og hvornår du får din gevinst.';
  const paragraphs = [
    `Kære ${w.full_name}`,
    partner
      ? `Du har vundet auktionen om at blive makker med ${w.name} i Lykke Auktion med et bud på ${kr(w.amount)}`
      : `Du har vundet "${w.name}" i Lykke Auktion med et bud på ${kr(w.amount)}`,
    prize,
    `Du får en faktura fra LykkeLiga på ${kr(w.amount)} med betaling inden 10 dage. Den sendes til den faktureringsadresse, du har oplyst:`,
  ];
  const after = [
    'Pengene går ubeskåret til LykkeLiga – et fællesskab for børn og unge med funktionsnedsættelser.',
    `Er adressen forkert, eller har du spørgsmål, så svar på denne mail eller skriv til ${REPLY_TO}.`,
    'Tak, fordi du bød for lykke!',
  ];

  const text = [...paragraphs, w.billing_address, ...after, 'Lykke Padel · LykkeLiga og NORMAL'].join('\n\n');

  const p = (value) => `<p style="margin:0 0 16px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#3a1c18">${esc(value)}</p>`;
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3ead2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ead2"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffce0;border-radius:12px;overflow:hidden">
<tr><td style="background:#2b1513;padding:24px 32px;font:bold 22px/1.2 Arial,Helvetica,sans-serif;letter-spacing:1px;color:#fffce0">LYKKE PADEL</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 8px;font:bold 13px/1.4 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#c42a1c">Lykke Auktion</p>
<h1 style="margin:0 0 24px;font:bold 28px/1.2 Arial,Helvetica,sans-serif;color:#2b1513">Tillykke, du har vundet!</h1>
${paragraphs.map(p).join('\n')}
<p style="margin:0 0 24px;padding:14px 16px;background:#f3ead2;border-radius:8px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#3a1c18;white-space:pre-line">${esc(w.billing_address)}</p>
${after.map(p).join('\n')}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e9dcc4;font:13px/1.5 Arial,Helvetica,sans-serif;color:#6b4a44">Lykke Padel · 2. april 2027 · Pakhus77, Aarhus<br>Arrangeret af LykkeLiga, powered by NORMAL</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text };
}
