// Header and footer shared by all mails: the Lykke Padel logo on top, LykkeLiga and NORMAL at the bottom.
// Mail programs don't show SVG, so PNG copies of the logos are served from the live site.
const IMAGES = 'https://www.lykkepadel.dk/images/brand/mail';

export const mailHeader = `<tr><td style="background:#2b1513;padding:24px 32px"><img src="${IMAGES}/lykkepadel-wide-creme.png" width="223" height="24" alt="Lykke Padel" style="display:block;border:0;height:24px;width:223px"></td></tr>`;

export function mailFooter(line) {
  const label = 'font:bold 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#e9dcc4;padding-bottom:8px';
  return `<tr><td style="background:#2b1513;padding:24px 32px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:32px;vertical-align:bottom"><div style="${label}">Arrangeret af</div><a href="https://lykkeliga.dk/"><img src="${IMAGES}/lykkeliga-creme.png" width="95" height="36" alt="LykkeLiga" style="display:block;border:0;height:36px;width:95px"></a></td>
<td style="vertical-align:bottom"><div style="${label}">Powered by</div><img src="${IMAGES}/normal-creme.png" width="76" height="36" alt="NORMAL" style="display:block;border:0;height:36px;width:76px"></td>
</tr></table>
<p style="margin:16px 0 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#e9dcc4">${line}</p>
</td></tr>`;
}
