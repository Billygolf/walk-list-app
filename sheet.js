// Printable scan sheets for one turf.
import { G, RESULTS, fiducials, paginate, pageCode, nice } from './layout.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function qrSvg(text) {
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

export function sheetHtml(pack, turf) {
  const pages = paginate(turf);
  const firstOfMap = new Set();
  const seen = new Set();
  for (const r of turf.rows) if (r.knock && r.map && !seen.has(r.map)) { seen.add(r.map); firstOfMap.add(r.n); }

  return pages.map((items, pi) => {
    const p = pi + 1;
    const code = pageCode(pack.title, turf.id, p);
    const maps = items.filter((it) => it.kind === 'door' && firstOfMap.has(it.row.n)).map((it) => it.row.map);
    const qrs = maps.map((k) => {
      const m = turf.maps[k - 1];
      return m ? `<div class="sh-leg">${qrSvg(m.url)}<span>${esc(m.label)}</span></div>` : '';
    }).join('') || '<span class="sh-nomap">Keep going with the last map from the previous page.</span>';
    const fids = fiducials().map(([x, y]) =>
      `<b class="sh-fid" style="left:${x - G.FID / 2}in;top:${y - G.FID / 2}in"></b>`).join('');
    const heads = RESULTS.map((n, i) =>
      `<span class="sh-bh" style="left:${G.BOX_X[i] - G.LEFT - 0.225}in">${esc(n)}</span>`).join('');
    const rows = items.map((it) => {
      const top = it.y - G.ROW / 2;
      if (it.kind === 'st') return `<div class="sh-row sh-st" style="top:${top}in"><span>${esc(nice(it.label))}</span></div>`;
      const r = it.row, door = it.kind === 'door';
      const boxes = door ? G.BOX_X.map((x) => `<i style="left:${x - G.LEFT - G.BOX / 2}in"></i>`).join('') : '';
      const tag = door && firstOfMap.has(r.n) ? `<b class="sh-map">Map ${r.map}</b>` : '';
      return `<div class="sh-row ${door ? '' : 'sh-skip'}" style="top:${top}in">
        <span class="sh-seq">${door ? r.n : '·'}</span><span class="sh-ad">${tag}${esc(nice(r.addr))}</span>
        <span class="sh-nm">${esc(r.name)}</span><span class="sh-ti">${esc(r.tier)}</span>${boxes}<span class="sh-note"></span></div>`;
    }).join('');
    return `<div class="sh-page">${fids}
      <div class="sh-hd"><div class="sh-eb">${esc(pack.title)} · Turf ${turf.id.slice(1)} of ${pack.turfCount || pack.turfs.length} · Page ${p} of ${pages.length}</div>
      <div class="sh-h2">${esc(nice(turf.name))}</div><div class="sh-sign">Canvasser ____________________ &nbsp; Date __________</div></div>
      <div class="sh-pq">${qrSvg(code)}</div><div class="sh-pid">${esc(code.slice(4))}</div>
      <div class="sh-maps">${qrs}</div>
      <div class="sh-th" style="top:${G.TOP - 0.42}in"><span class="sh-seq">#</span><span class="sh-ad">Address</span><span class="sh-nm">Voter</span><span class="sh-ti">Tier</span>${heads}<span class="sh-note">Notes</span></div>
      ${rows}
      <div class="sh-foot">Mark a box with a check or X. A door can have more than one. Keep the black corner squares clear.</div></div>`;
  }).join('');
}
