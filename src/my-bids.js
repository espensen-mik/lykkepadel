import { esc, money } from './ui.js';
import { countdownShort } from './countdown.js';

// Min side: "Dine bud" – the lots the user has bid on and how they stand.
const KIND = { partner: 'Padelmakker', item: 'Charity-produkt' };

function status(row) {
  if (row.ended) return row.leading ? ['lead', 'Vundet'] : ['quiet', 'Ikke vundet'];
  return row.leading ? ['lead', 'Du fører'] : ['outbid', 'Overbudt'];
}

export function myBidsHtml(rows) {
  const head = `<div class="lp-heading" style="gap: 12px"><p class="lp-eyebrow">Lykke Auktion</p><h2 class="lp-display lp-display--m">Dine bud</h2></div>`;
  if (!rows.length)
    return `${head}<div class="lp-notice">Du har ikke budt på noget endnu. <a href="/auktion">Se auktionerne</a></div>`;
  const items = rows
    .map((row) => {
      const [tone, label] = status(row);
      const href = `/auktion#spiller/${encodeURIComponent(row.lot_id)}`;
      const action = row.ended
        ? `<a class="lp-btn lp-btn--secondary lp-btn--small" href="${href}">Se auktion</a>`
        : row.leading
          ? `<a class="lp-btn lp-btn--secondary lp-btn--small" href="${href}">Se auktion</a>`
          : `<a class="lp-btn lp-btn--primary lp-btn--small" href="${href}">Byd igen</a>`;
      return `<li class="lp-mybid">
        <a class="lp-mybid__media" href="${href}" tabindex="-1" aria-hidden="true"><img src="${esc(row.image_url)}" alt="" width="88" height="88" loading="lazy"></a>
        <div class="lp-mybid__main">
          <p class="lp-mybid__kind">${KIND[row.kind] || KIND.partner} · ${row.ended ? 'Afsluttet' : `Slutter om ${countdownShort(row.ends_at)}`}</p>
          <a class="lp-mybid__name" href="${href}">${esc(row.name)}</a>
        </div>
        <dl class="lp-mybid__numbers">
          <div><dt>Dit bud</dt><dd>${money(row.my_bid)}</dd></div>
          <div><dt>${row.ended ? 'Slutpris' : 'Aktuelt'}</dt><dd>${money(row.current_bid)}</dd></div>
        </dl>
        <span class="lp-pill lp-pill--${tone}">${label}</span>
        <div class="lp-mybid__action">${action}</div>
      </li>`;
    })
    .join('');
  return `${head}<ul class="lp-mybids">${items}</ul>`;
}

// Loads the list into the slot and shows it. Stays hidden if the database function isn't there yet.
export async function mountMyBids(client, slot) {
  if (!slot) return;
  const { data, error } = await client.rpc('my_auction_bids');
  if (error) {
    if (!/PGRST202|could not find/i.test(`${error.code} ${error.message}`)) console.warn('Dine bud kunne ikke hentes', error);
    return;
  }
  slot.innerHTML = myBidsHtml(Array.isArray(data) ? data : []);
  slot.hidden = false;
}
