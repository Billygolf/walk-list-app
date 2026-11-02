// Page layout shared by printing and scanning. Both sides must agree on it,
// so a scanned page can be matched back to its doors without storing anything extra.

export const RESULTS = ['Talked', 'Not home', 'Left lit', 'Voted'];

// Letter page, measured in inches from the top-left corner.
export const G = {
  W: 8.5, H: 11,
  FID: 0.28, INSET: 0.35,          // black corner squares
  TOP: 2.55, ROW: 0.4, BOTTOM: 10.35,
  LEFT: 0.6,                       // rows start here
  BOX_X: [4.75, 5.2, 5.65, 6.1],   // box centers, one per result
  BOX: 0.22,
};
G.PER = Math.floor((G.BOTTOM - G.TOP) / G.ROW + 1e-9);

// Centers of the four corner squares, in inches.
export function fiducials() {
  const a = G.INSET + G.FID / 2, bx = G.W - a, by = G.H - a;
  return [[a, a], [bx, a], [a, by], [bx, by]];
}

// Split a turf into printed pages. Each item gets its row center (y, inches).
export function paginate(turf) {
  const items = [];
  let street = null;
  for (const r of turf.rows) {
    if (r.street !== street) { street = r.street; items.push({ kind: 'st', label: street }); }
    items.push({ kind: r.knock ? 'door' : 'skip', row: r });
  }
  const pages = [];
  let cur = [];
  for (const it of items) {
    // never leave a street name alone at the bottom of a page
    if (cur.length === G.PER || (it.kind === 'st' && cur.length === G.PER - 1)) { pages.push(cur); cur = []; }
    cur.push({ ...it, y: G.TOP + cur.length * G.ROW + G.ROW / 2 });
  }
  if (cur.length) pages.push(cur);
  return pages;
}

export function pageCode(packKey, turfId, page) { return `WL1|${packKey}|${turfId}|P${page}`; }

export function parsePageCode(s) {
  const m = /^WL1\|(.+)\|(T\d+)\|P(\d+)$/.exec(s || '');
  return m ? { pack: m[1], turf: m[2], page: +m[3] } : null;
}

// "SW ROSEDALE RD", "5800 Se 82Nd Ave" -> "SW Rosedale Rd", "5800 SE 82nd Ave"
export function nice(s) {
  return String(s ?? '').toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (_, a, c) => a + c.toUpperCase())
    .replace(/\b(Nw|Sw|Ne|Se|Ii|Iii|Iv)\b/g, (w) => w.toUpperCase());
}
