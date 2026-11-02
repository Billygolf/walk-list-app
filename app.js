import { RESULTS, nice as tc } from './layout.js';
import { sheetHtml } from './sheet.js';
import { readSheet } from './scan.js';
import * as db from './db.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const enc = encodeURIComponent;
const CLS = { 'Talked': 'r-talk', 'Not home': 'r-nh', 'Left lit': 'r-lit', 'Voted': 'r-vote' };
const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  nav: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-8-8 18-2-8z"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
};

let packs = {}, results = {}, scans = [], filter = '';

const chips = (res) => (res || []).map((r) => `<span class="chip ${CLS[r]}">${esc(r)}</span>`).join('');
const resOf = (pack, turf, n) => results[db.resultKey(pack, turf, n)];
const doorsOf = (turf) => turf.rows.filter((r) => r.knock);
const doneCount = (pack, turf) => doorsOf(turf).filter((r) => resOf(pack, turf.id, r.n)?.res?.length).length;
const getTurf = (p, t) => packs[p]?.turfs.find((x) => x.id === t);

async function saveResult(pack, turf, n, res, note, src) {
  const v = { res, note: note || '', at: new Date().toISOString(), src };
  results[db.resultKey(pack, turf, n)] = v;
  await db.put('results', db.resultKey(pack, turf, n), v);
}

// ---------- views ----------

function home() {
  const titles = Object.keys(packs).sort();
  const f = filter.toLowerCase();
  const cards = titles.flatMap((p) => packs[p].turfs.map((t) => ({ p, t }))).filter(({ p, t }) => !f || `${p} ${t.name}`.toLowerCase().includes(f))
    .map(({ p, t }) => {
      const n = doorsOf(t).length, d = doneCount(p, t);
      return `<a class="card" href="#/t/${enc(p)}/${t.id}">
        <div class="eyebrow"><span>${esc(p)} · Turf ${t.id.slice(1)}</span><span>${packs[p].mode === 'walking' ? 'Walking' : 'Driving'}</span></div>
        <div class="card-title">${esc(tc(t.name))}</div>
        <div class="bar"><div style="width:${n ? (100 * d) / n : 0}%"></div></div>
        <div class="card-foot"><span>${d} of ${n} doors done</span></div></a>`;
    }).join('');
  return `<header class="top"><h1>My turfs</h1>
    <div class="actions"><a class="btn" href="#/scan">${ICON.cam}Scan sheets</a><a class="btn tonal" href="#/load">Lists &amp; export</a></div>
    ${titles.length ? `<label class="search"><span class="sr">Search turfs</span><input id="q" type="search" placeholder="Search precinct or street" value="${esc(filter)}"></label>` : ''}</header>
    <main class="stack">${cards || (titles.length ? '<p class="empty">No turfs match.</p>' : `<div class="empty"><p>No walk lists loaded yet.</p><a class="btn" href="#/load">Load walk lists</a></div>`)}</main>`;
}

function turfView(p, tid) {
  const t = getTurf(p, tid);
  if (!t) return notFound();
  const doors = doorsOf(t), d = doneCount(p, t);
  const next = doors.find((r) => !resOf(p, tid, r.n)?.res?.length);
  const leg = next ? t.maps[next.map - 1] : null;
  let street = null, list = '';
  for (const r of t.rows) {
    if (r.street !== street) { street = r.street; list += `<h3 class="street">${esc(tc(street))}</h3>`; }
    if (!r.knock) { list += `<div class="door skip"><span class="num">·</span><div class="who"><span>${esc(tc(r.addr))}</span><small>${esc(r.name)} · pass, don’t knock</small></div></div>`; continue; }
    const res = resOf(p, tid, r.n);
    list += `<a class="door ${res?.res?.length ? 'done' : ''} ${next && r.n === next.n ? 'cur' : ''}" href="#/d/${enc(p)}/${tid}/${r.n}">
      <span class="num">${r.n}</span><div class="who"><span>${esc(tc(r.addr))}</span><small>${esc(r.name)} · ${esc(r.tier)}${res?.note ? ' · ' + esc(res.note) : ''}</small></div>${chips(res?.res)}</a>`;
  }
  return `<header class="top"><nav class="bar-nav"><a href="#/" class="back">${ICON.back}Turfs</a><a href="#/p/${enc(p)}/${tid}" class="link">${ICON.print}Print</a></nav>
    <div class="eyebrow"><span>${esc(p)} · Turf ${tid.slice(1)}</span></div><h1 class="h-sm">${esc(tc(t.name))}</h1>
    <div class="sub">${d} of ${doors.length} doors done · ${t.maps.length} maps</div></header>
    ${leg ? `<a class="navbtn" href="${esc(leg.url)}" target="_blank" rel="noopener">${ICON.nav}<span><b>Navigate · Map ${next.map}</b><small>${esc(leg.label.replace(/^Map \d+ · /, ''))} · opens Google Maps</small></span></a>` : (doors.length ? '<p class="alldone">Every door on this turf has a result.</p>' : '')}
    <main class="list">${list}</main>`;
}

function doorView(p, tid, n) {
  const t = getTurf(p, tid);
  const doors = t ? doorsOf(t) : [];
  const i = doors.findIndex((r) => r.n === +n);
  if (i < 0) return notFound();
  const r = doors[i], res = resOf(p, tid, r.n) || { res: [], note: '' };
  const leg = t.maps[r.map - 1];
  const q = enc(`${r.addr}, ${packs[p].area || 'Washington County, OR'}`);
  return `<header class="top"><nav class="bar-nav"><a href="#/t/${enc(p)}/${tid}" class="back">${ICON.back}Turf ${tid.slice(1)}</a><span class="muted">Door ${r.n} of ${doors.length}</span></nav>
    <h1 class="h-sm">${esc(tc(r.addr))}</h1><div class="sub big">${esc(r.name)} <span class="chip r-tier">${esc(r.tier)}</span></div>
    <div class="sub">Household of ${esc(r.hh)}${leg ? ' · ' + esc(leg.label) : ''}</div></header>
    <div class="row2"><a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${q}">${ICON.nav}Directions</a>
    ${r.phone ? `<a class="btn ghost" href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${ICON.phone}Call</a>` : '<span class="btn ghost off">No phone</span>'}</div>
    <h2 class="label">What happened? Tap all that apply</h2>
    <div class="grid2" id="res">${RESULTS.map((x) => `<button type="button" class="res ${CLS[x]}" aria-pressed="${res.res.includes(x)}" data-r="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <label class="label" for="note">Note</label><textarea id="note" rows="3">${esc(res.note)}</textarea>
    <div class="foot"><button class="btn wide" id="save" data-next="${doors[i + 1] ? doors[i + 1].n : ''}">${doors[i + 1] ? 'Save · next door' : 'Save · back to list'}</button>
    <p class="muted center">Saved on this phone. Nothing is sent anywhere.</p></div>`;
}

function printView(p, tid) {
  const t = getTurf(p, tid);
  if (!t) return notFound();
  return `<div class="print-bar"><a href="#/t/${enc(p)}/${tid}" class="back">${ICON.back}Back</a><button class="btn" id="doprint">${ICON.print}Print</button>
    <span class="muted">Print at 100% (actual size) on Letter paper.</span></div><div class="sheets">${sheetHtml(packs[p], t)}</div>`;
}

function scanView() {
  const cards = scans.map((s, si) => {
    if (s.busy) return `<div class="card"><div class="card-title">Reading ${esc(s.name)}…</div></div>`;
    if (!s.ok) return `<div class="card warn"><div class="card-title">${esc(s.name)}</div><p>${esc(s.error)}</p></div>`;
    const unsure = s.doors.filter((d) => d.unsure.length).length;
    const rows = s.doors.map((d, di) => `<div class="scanrow ${d.unsure.length ? 'unsure' : ''}"><span class="num">${d.n}</span>
      <div class="who"><span>${esc(tc(d.addr))}</span>${d.unsure.length ? `<small>Not sure about ${esc(d.unsure.join(', '))}. Check the sheet and tap to fix.</small>` : ''}</div>
      <div class="toggles">${RESULTS.map((x) => `<button type="button" class="tg ${CLS[x]}" aria-pressed="${d.marked.includes(x)}" data-s="${si}" data-d="${di}" data-r="${esc(x)}" title="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`).join('');
    return `<div class="card scan"><div class="scanhead">${s.thumb ? `<img src="${s.thumb}" alt="Photo of the sheet">` : ''}<div>
      <div class="eyebrow"><span>${esc(s.pack)} · Turf ${s.turf.slice(1)}</span></div><div class="card-title">Page ${s.page} of ${s.pages}</div>
      <div class="sub">${s.doors.length} doors read${unsure ? ` · <b class="warnt">${unsure} need a look</b>` : ''}</div></div></div>
      ${rows}<button class="btn wide" data-save="${si}" ${s.saved ? 'disabled' : ''}>${s.saved ? 'Saved' : 'Save this page'}</button></div>`;
  }).join('');
  return `<header class="top"><nav class="bar-nav"><a href="#/" class="back">${ICON.back}Turfs</a></nav><h1 class="h-sm">Scan sheets</h1>
    <div class="sub">Take a photo of each filled-in page, flat and with all four black corners showing. Or pick scans from your files.</div></header>
    <div class="row2"><label class="btn">${ICON.cam}Take photo<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
    <label class="btn tonal">Choose files<input id="files" type="file" accept="image/*" multiple hidden></label></div>
    <main class="stack">${cards}</main>`;
}

function loadView() {
  const titles = Object.keys(packs).sort();
  const nres = Object.values(results).filter((r) => r.res?.length).length;
  return `<header class="top"><nav class="bar-nav"><a href="#/" class="back">${ICON.back}Turfs</a></nav><h1 class="h-sm">Lists &amp; export</h1></header>
    <section class="card"><div class="card-title">Load walk lists</div><p class="sub">Pick one or more list files (.json), for example “Precinct 303.02.json”.</p>
    <label class="btn">Choose list files<input id="packs" type="file" accept=".json,application/json" multiple hidden></label></section>
    <section class="card"><div class="card-title">Export results</div><p class="sub">${nres} doors have results. Download them as a spreadsheet (CSV).</p>
    <button class="btn" id="export" ${nres ? '' : 'disabled'}>Download results</button></section>
    <section class="card"><div class="card-title">Loaded lists</div>
    ${titles.map((p) => `<div class="packrow"><span>${esc(p)} <small class="muted">${packs[p].turfs.length} turfs</small></span><button class="link danger" data-del="${esc(p)}">Remove</button></div>`).join('') || '<p class="muted">None yet.</p>'}</section>`;
}

const notFound = () => `<header class="top"><a href="#/" class="back">${ICON.back}Turfs</a><h1 class="h-sm">Not found</h1><p class="sub">That turf isn’t loaded on this phone.</p></header>`;

// ---------- routing ----------

function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [v, a, b, c] = parts;
  document.body.classList.toggle('printing', v === 'p');
  $('#app').innerHTML = v === 't' ? turfView(a, b) : v === 'd' ? doorView(a, b, c) : v === 'p' ? printView(a, b)
    : v === 'scan' ? scanView() : v === 'load' ? loadView() : home();
  if (v !== 'scan' && v !== 'p') window.scrollTo(0, 0);
  if (v === 't') document.querySelector('.door.cur')?.scrollIntoView({ block: 'center' });
}

// ---------- events ----------

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.matches('.res')) el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true');
  else if (el.id === 'save') {
    const [, p, t, n] = location.hash.replace(/^#\//, '').split('/').map(decodeURIComponent);
    const res = [...document.querySelectorAll('#res .res[aria-pressed="true"]')].map((b) => b.dataset.r);
    await saveResult(p, t, +n, res, $('#note').value.trim(), 'app');
    location.hash = el.dataset.next ? `#/d/${enc(p)}/${t}/${el.dataset.next}` : `#/t/${enc(p)}/${t}`;
  } else if (el.id === 'doprint') window.print();
  else if (el.matches('.tg')) {
    const d = scans[el.dataset.s].doors[el.dataset.d], r = el.dataset.r;
    d.marked = d.marked.includes(r) ? d.marked.filter((x) => x !== r) : [...d.marked, r];
    d.unsure = d.unsure.filter((x) => x !== r);
    scans[el.dataset.s].saved = false;
    render();
  } else if (el.dataset.save) {
    const s = scans[el.dataset.save];
    for (const d of s.doors) {
      const prev = resOf(s.pack, s.turf, d.n);
      if (!d.marked.length && !prev) continue;        // blank on paper and nothing recorded: leave it
      if (!d.marked.length) continue;                  // blank on paper never wipes a phone result
      await saveResult(s.pack, s.turf, d.n, d.marked, prev?.note || '', 'scan');
    }
    s.saved = true;
    render();
  } else if (el.id === 'export') exportCsv();
  else if (el.dataset.del) {
    if (!confirm(`Remove ${el.dataset.del} from this phone? Its results stay saved.`)) return;
    delete packs[el.dataset.del];
    await db.del('packs', el.dataset.del);
    render();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') {
    filter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos);
  }
});

document.addEventListener('change', async (e) => {
  const inp = e.target;
  if (inp.id === 'packs') {
    const added = [];
    for (const f of inp.files) {
      try {
        const d = JSON.parse(await f.text());
        if (d.v !== 1 || !d.title || !Array.isArray(d.turfs)) throw new Error('not a walk list');
        packs[d.title] = d; await db.put('packs', d.title, d); added.push(d.title);
      } catch { alert(`${f.name} is not a walk list file.`); }
    }
    render();
  } else if (inp.id === 'cam' || inp.id === 'files') {
    for (const f of inp.files) {
      const s = { name: f.name, busy: true };
      scans.unshift(s); render();
      try {
        Object.assign(s, await readSheet(f, packs), { thumb: URL.createObjectURL(f) });
      } catch (err) { Object.assign(s, { ok: false, error: 'Could not read this image: ' + err.message }); }
      s.busy = false; render();
    }
    inp.value = '';
  }
});

function exportCsv() {
  const head = ['List', 'Turf', 'Door', 'Address', 'Voter', 'Tier', 'Phone', ...RESULTS, 'Note', 'Source', 'Recorded'];
  const lines = [head];
  for (const [k, v] of Object.entries(results)) {
    if (!v.res?.length && !v.note) continue;
    const [p, t, n] = k.split('|');
    const r = getTurf(p, t)?.rows.find((x) => x.knock && x.n === +n) || {};
    lines.push([p, t.slice(1), n, r.addr, r.name, r.tier, r.phone, ...RESULTS.map((x) => (v.res.includes(x) ? 'Y' : '')), v.note, v.src, v.at]);
  }
  const csv = lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `walk-list-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ---------- start ----------

(async () => {
  [packs, results] = await Promise.all([db.getAll('packs'), db.getAll('results')]);
  addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
