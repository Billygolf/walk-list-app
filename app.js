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

let packs = {}, results = {}, scans = [], filter = '', flash = '';

const chips = (res) => (res || []).map((r) => `<span class="chip ${CLS[r]}">${esc(r)}</span>`).join('');
const resOf = (pack, turf, n) => results[db.resultKey(pack, turf, n)];
const doorsOf = (turf) => turf.rows.filter((r) => r.knock);
const doneCount = (pack, turf) => doorsOf(turf).filter((r) => resOf(pack, turf.id, r.n)?.res?.length).length;
const getTurf = (p, t) => packs[p]?.turfs.find((x) => x.id === t);
// "CD 1 · HD 27 · SD 14" for a precinct, or '' if its list file predates districts.
const DIST_RE = /^\s*(cd|hd|sd)\s*(\d+)\s*$/i;
const DIST_NAME = { cd: 'Congressional District', sd: 'Oregon Senate District', hd: 'Oregon House District' };
// A menu of every district among the loaded precincts; picking one fills the search box ("HD 37").
function districtMenu(titles) {
  const sets = { cd: new Set(), sd: new Set(), hd: new Set() };
  for (const p of titles) for (const k in sets) if (packs[p][k]) sets[k].add(packs[p][k]);
  if (!sets.cd.size) return '';
  const cur = (DIST_RE.exec(filter) || []).slice(1, 3).join(' ').toLowerCase();
  const group = (k, label) => `<optgroup label="${label}">${[...sets[k]].sort((a, b) => a - b).map((n) => {
    const v = `${k} ${n}`; return `<option value="${v}" ${v === cur ? 'selected' : ''}>${k.toUpperCase()} ${n}</option>`; }).join('')}</optgroup>`;
  return `<label class="distpick"><span class="sr">Filter by district</span><select id="dist"><option value="">All districts</option>
    ${group('cd', 'Congress')}${group('sd', 'Oregon Senate')}${group('hd', 'Oregon House')}</select></label>`;
}
const districts = (pk) => (pk?.cd ? `CD ${pk.cd} · HD ${pk.hd} · SD ${pk.sd}` : '');

async function saveResult(pack, turf, n, res, note, src) {
  const v = { res, note: note || '', at: new Date().toISOString(), src };
  results[db.resultKey(pack, turf, n)] = v;
  await db.put('results', db.resultKey(pack, turf, n), v);
}

// ---------- views ----------

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const packDoors = (p) => packs[p].turfs.reduce((n, t) => n + doorsOf(t).length, 0);
const packDone = (p) => packs[p].turfs.reduce((n, t) => n + doneCount(p, t), 0);

function turfCard(p, t) {
  const n = doorsOf(t).length, d = doneCount(p, t);
  return `<a class="card" href="#/t/${enc(p)}/${t.id}">
    <div class="eyebrow"><span>${esc(p)} · Turf ${t.id.slice(1)}</span><span>${packs[p].mode === 'walking' ? 'Walking' : 'Driving'}</span></div>
    <div class="card-title">${esc(tc(t.name))}</div>
    <div class="bar"><div style="width:${n ? (100 * d) / n : 0}%"></div></div>
    <div class="card-foot"><span>${d} of ${n} doors done</span></div></a>`;
}

function packRow(p) {
  const n = packDoors(p), d = packDone(p);
  return `<a class="prow" href="#/k/${enc(p)}"><div class="who"><span>${esc(p)}</span>
    <small>${packs[p].turfs.length} turf${packs[p].turfs.length === 1 ? '' : 's'} · ${d ? `${d} of ${n} doors done` : `${n} doors`}</small></div>
    ${d ? `<div class="mini"><div style="width:${(100 * d) / n}%"></div></div>` : ''}<span class="chev">›</span></a>`;
}

function home() {
  const titles = Object.keys(packs).sort(natural);
  const f = filter.trim().toLowerCase();
  let body;
  if (!titles.length) body = `<div class="empty"><p>No walk lists loaded yet.</p><a class="btn" href="#/load">Load walk lists</a></div>`;
  else if (DIST_RE.test(f)) {
    const [, k, num] = DIST_RE.exec(f);
    const hits = titles.filter((p) => packs[p][k] === +num);
    const n = hits.reduce((s, p) => s + packDoors(p), 0), d = hits.reduce((s, p) => s + packDone(p), 0);
    body = hits.length ? `<h3 class="street">${DIST_NAME[k]} ${num} · ${hits.length} precinct${hits.length === 1 ? '' : 's'} · ${d ? `${d} of ${n}` : n} doors</h3><div class="group">${hits.map(packRow).join('')}</div>`
      : `<p class="empty">No loaded precincts are in ${k.toUpperCase()} ${num}.${titles.some((p) => packs[p].cd) ? '' : ' Load the newest list file to get districts.'}</p>`;
  } else if (f) {
    const hitPacks = titles.filter((p) => p.toLowerCase().includes(f));
    const hitTurfs = titles.flatMap((p) => packs[p].turfs.filter((t) => tc(t.name).toLowerCase().includes(f)
      || t.rows.some((r) => (r.street || '').toLowerCase().includes(f))).map((t) => ({ p, t }))).slice(0, 40);
    body = (hitPacks.length ? `<div class="group">${hitPacks.slice(0, 40).map(packRow).join('')}</div>` : '')
      + (hitTurfs.length ? `<h3 class="street">Turfs on matching streets</h3><div class="stack">${hitTurfs.map(({ p, t }) => turfCard(p, t)).join('')}</div>` : '')
      || '<p class="empty">Nothing matches.</p>';
  } else {
    const started = titles.filter((p) => packDone(p) > 0);
    body = (started.length ? `<h3 class="street">In progress</h3><div class="group">${started.map(packRow).join('')}</div>` : '')
      + `<h3 class="street">All precincts (${titles.length})</h3><div class="group">${titles.map(packRow).join('')}</div>`;
  }
  const note = flash ? `<p class="flash" role="status">${esc(flash)}</p>` : '';
  flash = '';
  return `${note}<div class="brand"><img src="logo.png" alt="Forests for Oregon"><span>Walk lists</span></div><header class="top"><h1>My turfs</h1>
    <div class="actions"><a class="btn" href="#/scan">${ICON.cam}Scan sheets</a><a class="btn tonal" href="#/load">Lists &amp; export</a></div>
    ${titles.length ? `<label class="search"><span class="sr">Search turfs</span><input id="q" type="search" placeholder="Precinct (420), street, or district (HD 37)" value="${esc(filter)}"></label>${districtMenu(titles)}` : ''}</header>
    <main>${body}</main>`;
}

function packView(p) {
  if (!packs[p]) return notFound();
  const n = packDoors(p), d = packDone(p);
  return `<header class="top"><nav class="bar-nav"><a href="#/" class="back">${ICON.back}Turfs</a></nav>
    <h1 class="h-sm">${esc(p)}</h1>${districts(packs[p]) ? `<div class="dist">${districts(packs[p])}</div>` : ''}<div class="sub">${packs[p].turfs.length} turfs · ${d} of ${n} doors done</div></header>
    <main class="stack">${packs[p].turfs.map((t) => turfCard(p, t)).join('')}</main>`;
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
  return `<header class="top"><nav class="bar-nav"><a href="#/k/${enc(p)}" class="back">${ICON.back}${esc(p.replace('Precinct ', ''))}</a><span class="navr"><button class="link" data-share="${tid}">Share</button><a href="#/p/${enc(p)}/${tid}" class="link">${ICON.print}Print</a></span></nav>
    <div class="eyebrow"><span>${esc(p)} · Turf ${tid.slice(1)}</span><span>${districts(packs[p])}</span></div><h1 class="h-sm">${esc(tc(t.name))}</h1>
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
    <div class="sub">Household of ${esc(r.hh)}${leg ? ' · ' + esc(leg.label) : ''}</div>
    ${districts(packs[p]) ? `<div class="dist">${districts(packs[p])}</div>` : ''}</header>
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
    <section class="card"><div class="card-title">Load walk lists</div><p class="sub">Pick one or more list files, for example “Precinct 303.02.json” or “All precincts.json.gz”.</p>
    <label class="btn">Choose list files<input id="packs" type="file" multiple hidden></label></section>
    <section class="card"><div class="card-title">Export results</div><p class="sub">${nres} doors have results. Download them as a spreadsheet (CSV).</p>
    <button class="btn" id="export" ${nres ? '' : 'disabled'}>Download results</button></section>
    <section class="card"><div class="card-title">Import results</div><p class="sub">Add results a volunteer sent you (their “Download results” spreadsheet). Newer results win.</p>
    <label class="btn tonal">Choose results files<input id="resfiles" type="file" multiple hidden></label></section>
    <section class="card"><div class="card-title">Loaded lists</div>
    ${titles.sort(natural).map((p) => `<div class="packrow"><span>${esc(p)} <small class="muted">${packs[p].turfs.length} turfs</small></span><button class="link danger" data-del="${esc(p)}">Remove</button></div>`).join('') || '<p class="muted">None yet.</p>'}</section>`;
}

const notFound = () => `<header class="top"><a href="#/" class="back">${ICON.back}Turfs</a><h1 class="h-sm">Not found</h1><p class="sub">That turf isn’t loaded on this phone.</p></header>`;

// ---------- routing ----------

function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [v, a, b, c] = parts;
  document.body.classList.toggle('printing', v === 'p');
  $('#app').innerHTML = v === 'k' ? packView(a) : v === 't' ? turfView(a, b) : v === 'd' ? doorView(a, b, c) : v === 'p' ? printView(a, b)
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
  else if (el.dataset.share) shareTurf(location.hash.replace(/^#\//, '').split('/').map(decodeURIComponent)[1], el.dataset.share);
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
  if (inp.id === 'dist') { filter = inp.value ? inp.value.toUpperCase() : ''; render(); return; }
  if (inp.id === 'packs') {
    const added = [];
    for (const f of inp.files) {
      try {
        let d;
        try { d = JSON.parse(await readText(f)); } catch { d = null; }
        const list = d?.packs || [d];
        const good = list.filter((x) => x && x.v === 1 && x.title && Array.isArray(x.turfs));
        if (!good.length) { alert(`${f.name} is not a walk list file.`); continue; }
        for (const x of good) { packs[x.title] = mergePack(packs[x.title], x); added.push(x.title); }
        await db.putMany('packs', good.map((x) => [x.title, packs[x.title]]));
      } catch (err) { alert(`Loaded ${f.name}, but this phone would not save it, so it will be gone after you close the app. (${err.message})`); }
    }
    inp.value = '';
    if (added.length) {
      flash = added.length > 3 ? `Loaded ${added.length} precincts` : `Loaded ${added.join(', ')}`;
      filter = '';
      location.hash = '#/';   // the hashchange handler shows My turfs with the message
    } else render();
  } else if (inp.id === 'resfiles') {
    let n = 0;
    for (const f of inp.files) {
      try { n += await importCsv(await f.text()); } catch (err) { alert(`Could not read ${f.name}: ${err.message}`); }
    }
    inp.value = '';
    flash = `Imported ${n} door result${n === 1 ? '' : 's'}`;
    location.hash = '#/';
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

// A shared one-turf file must not wipe the other turfs of a precinct already on this phone.
function mergePack(old, inc) {
  if (!old) return inc;
  const byId = new Map(old.turfs.map((t) => [t.id, t]));
  for (const t of inc.turfs) byId.set(t.id, t);
  const turfs = [...byId.values()].sort((a, b) => natural(a.id, b.id));
  return { ...old, ...inc, turfs, turfCount: Math.max(old.turfCount || old.turfs.length, inc.turfCount || inc.turfs.length, turfs.length) };
}

// A file with just one turf, for a volunteer. Turf numbers stay the same so their sheets and results match yours.
async function shareTurf(p, tid) {
  const pack = packs[p], t = getTurf(p, tid);
  const out = { v: 1, title: pack.title, mode: pack.mode, area: pack.area, cd: pack.cd, hd: pack.hd, sd: pack.sd, turfCount: pack.turfCount || pack.turfs.length, turfs: [t] };
  const name = `${p} Turf ${tid.slice(1)}.json`;
  const file = new File([JSON.stringify(out)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name, text: `Walk list: ${p} Turf ${tid.slice(1)}. Open ${location.origin}${location.pathname} and load this file under Lists & export.` }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

async function importCsv(text) {
  const [head, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  const col = (n) => head.indexOf(n);
  if (col('List') < 0 || col('Turf') < 0 || col('Door') < 0) throw new Error('not a results spreadsheet from this app');
  const put = [];
  for (const r of rows) {
    const key = db.resultKey(r[col('List')], 'T' + r[col('Turf')], +r[col('Door')]);
    const v = { res: RESULTS.filter((x) => (r[col(x)] || '').trim().toUpperCase() === 'Y'), note: r[col('Note')] || '',
      at: r[col('Recorded')] || new Date().toISOString(), src: 'import' };
    const old = results[key];
    if (old && old.at >= v.at) continue;
    results[key] = v; put.push([key, v]);
  }
  if (put.length) await db.putMany('results', put);
  return put.length;
}

// Reads a list file, unpacking it first if it is gzip-compressed (.json.gz).
async function readText(f) {
  const head = new Uint8Array(await f.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return f.text();
  return new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

function exportCsv() {
  const head = ['List', 'Turf', 'Door', 'Address', 'Voter', 'Tier', 'Phone', 'CD', 'HD', 'SD', ...RESULTS, 'Note', 'Source', 'Recorded'];
  const lines = [head];
  for (const [k, v] of Object.entries(results)) {
    if (!v.res?.length && !v.note) continue;
    const [p, t, n] = k.split('|');
    const r = getTurf(p, t)?.rows.find((x) => x.knock && x.n === +n) || {};
    const pk = packs[p] || {};
    lines.push([p, t.slice(1), n, r.addr, r.name, r.tier, r.phone, pk.cd, pk.hd, pk.sd, ...RESULTS.map((x) => (v.res.includes(x) ? 'Y' : '')), v.note, v.src, v.at]);
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
