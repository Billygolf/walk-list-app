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

let packs = {}, results = {}, cands = {}, scans = [], filter = '', flash = '', draft = null, prevHash = '#/', curHash = '';

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
    const v = `${k} ${n}`, c = cands[v];
    return `<option value="${v}" ${v === cur ? 'selected' : ''}>${k.toUpperCase()} ${n}${c ? ` · ${esc(c.name)}` : ''}</option>`; }).join('')}</optgroup>`;
  // The picked district's candidate sits right under the menu, with a button to add or change the name and photo.
  let who = '';
  if (cur) {
    const [k, n] = cur.split(' '), c = cands[cur];
    who = `<a class="cand solo ${c ? '' : 'empty'}" href="#/c/${k}/${n}">${face(c)}<span class="cwho"><small>${k.toUpperCase()} ${n} · our candidate</small>
      <b>${c ? esc(c.name) : 'No candidate yet'}</b>${c?.incumbent ? '<small>Incumbent</small>' : ''}</span><span class="pill">${c ? 'Edit' : 'Add name &amp; photo'}</span></a>`;
  }
  return `<label class="distpick"><span class="sr">Filter by district</span><select id="dist"><option value="">All districts</option>
    ${group('cd', 'Congress')}${group('sd', 'Oregon Senate')}${group('hd', 'Oregon House')}
    <optgroup label="Candidates"><option value="edit">Add or change candidate names and photos…</option></optgroup></select></label>${who}`;
}
const districts = (pk) => (pk?.cd ? `CD ${pk.cd} · HD ${pk.hd} · SD ${pk.sd}` : '');

// ---------- candidates we support: one per district, saved on this phone ----------
const DKEYS = ['cd', 'hd', 'sd'];
const candKey = (k, n) => `${k} ${n}`;
const candsOf = (pk) => (pk?.cd ? DKEYS.map((k) => ({ k, n: pk[k], c: cands[candKey(k, pk[k])] })) : []);
const initials = (name) => (name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const face = (c, cls = '') => (c?.photo ? `<img class="face ${cls}" src="${c.photo}" alt="">`
  : `<span class="face none ${cls}" aria-hidden="true">${esc(initials(c?.name)) || '+'}</span>`);
// The precinct's three candidates as tappable cards. `always` shows empty "Add" slots too.
function candStrip(pk, always) {
  const list = candsOf(pk);
  if (!list.length || (!always && !list.some((x) => x.c))) return '';
  return `<div class="cands">${list.map(({ k, n, c }) => `<a class="cand ${c ? '' : 'empty'}" href="#/c/${k}/${n}">${face(c)}
    <span class="cwho"><small>${k.toUpperCase()} ${n}</small><b>${c ? esc(c.name) : 'Add candidate'}</b>${c?.incumbent ? '<small>Incumbent</small>' : ''}</span></a>`).join('')}</div>`;
}
// Saves candidates that came in a file. Newer edits win, so loading an old file never undoes a change.
// A photo always fills a missing one, though: phone and computer clocks can disagree by minutes,
// and a name typed on the phone must not block the photo added at HQ.
async function mergeCands(inc) {
  const put = [];
  for (const [k, v] of Object.entries(inc || {})) {
    if (!/^(cd|hd|sd) \d+$/.test(k) || !v?.name) continue;
    const photo = /^data:image\/(jpeg|png|webp);base64,/.test(v.photo || '') ? v.photo : '';
    const old = cands[k];
    let c;
    if (!old || (old.at || '') < (v.at || '')) c = { name: String(v.name).slice(0, 80), incumbent: !!v.incumbent, photo, at: v.at || new Date().toISOString() };
    else if (photo && !old.photo) c = { ...old, photo };
    else continue;
    cands[k] = c; put.push([k, c]);
  }
  if (put.length) await db.putMany('cands', put);
  return put.length;
}
// Shrinks a photo to a small square JPEG so it stores, shares and prints quickly.
async function shrinkPhoto(file, side = 320) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('not a picture this phone can open')); img.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2, sy = Math.max(0, (img.naturalHeight - s) * 0.25);   // faces sit near the top
    const c = document.createElement('canvas');
    c.width = c.height = Math.min(side, s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, sx, sy, s, s, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

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
    <div class="actions"><a class="btn" href="#/scan">${ICON.cam}Scan sheets</a><a class="btn tonal" href="#/load">Lists &amp; export</a><a class="btn tonal hqbtn" href="#/hq">HQ</a></div>
    ${titles.length ? `<label class="search"><span class="sr">Search turfs</span><input id="q" type="search" placeholder="Precinct (420), street, or district (HD 37)" value="${esc(filter)}"></label>${districtMenu(titles)}` : ''}</header>
    <main>${body}</main>`;
}

function packView(p) {
  if (!packs[p]) return notFound();
  const n = packDoors(p), d = packDone(p);
  return `<header class="top"><nav class="bar-nav"><a href="#/" class="back">${ICON.back}Turfs</a></nav>
    <h1 class="h-sm">${esc(p)}</h1>${districts(packs[p]) ? `<div class="dist">${districts(packs[p])}</div>` : ''}<div class="sub">${packs[p].turfs.length} turfs · ${d} of ${n} doors done</div>${candStrip(packs[p], true)}</header>
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
    <div class="sub">${d} of ${doors.length} doors done · ${t.maps.length} maps</div>${candStrip(packs[p])}</header>
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
    ${districts(packs[p]) ? `<div class="dist">${districts(packs[p])}</div>` : ''}${candStrip(packs[p])}</header>
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
    <span class="muted">Print at 100% (actual size) on Letter paper.</span></div><div class="sheets">${sheetHtml(packs[p], t, candsOf(packs[p]))}</div>`;
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
    <section class="card"><div class="card-title">HQ</div><p class="sub">Running things from a computer? See progress by district and precinct, send precincts to volunteers, and load their results.</p>
    <a class="btn tonal" href="#/hq">Open HQ</a></section>
    <section class="card"><div class="card-title">Candidates</div><p class="sub">${Object.keys(cands).length ? `${Object.keys(cands).length} of ${allDistricts().length} districts have a candidate.` : 'Add the name and photo of the candidate we support in each district.'} They show on precincts, turfs, doors and printed sheets.</p>
    <a class="btn tonal" href="#/c">Edit candidates</a></section>
    <section class="card"><div class="card-title">Export results</div><p class="sub">${nres} doors have results. Download them as a spreadsheet (CSV).</p>
    <button class="btn" id="export" ${nres ? '' : 'disabled'}>Download results</button></section>
    <section class="card"><div class="card-title">Import results</div><p class="sub">Add results a volunteer sent you (their “Download results” spreadsheet). Newer results win.</p>
    <label class="btn tonal">Choose results files<input id="resfiles" type="file" multiple hidden></label></section>
    <section class="card"><div class="card-title">Loaded lists</div>
    ${titles.sort(natural).map((p) => `<div class="packrow"><span>${esc(p)} <small class="muted">${packs[p].turfs.length} turfs</small></span><button class="link danger" data-del="${esc(p)}">Remove</button></div>`).join('') || '<p class="muted">None yet.</p>'}</section>`;
}

// Every district among the loaded precincts, plus any that already have a candidate.
function allDistricts() {
  const seen = new Set(Object.keys(cands));
  for (const pk of Object.values(packs)) for (const k of DKEYS) if (pk[k]) seen.add(candKey(k, pk[k]));
  return [...seen].map((s) => { const [k, n] = s.split(' '); return { k, n: +n }; });
}

function candsView() {
  const all = allDistricts();
  const group = (k) => {
    const rows = all.filter((x) => x.k === k).sort((a, b) => a.n - b.n).map(({ n }) => {
      const c = cands[candKey(k, n)];
      return `<a class="prow" href="#/c/${k}/${n}">${face(c, 'sm')}<div class="who"><span>${c ? esc(c.name) : '<span class="muted">Add candidate</span>'}</span>
        <small>${k.toUpperCase()} ${n}${c?.incumbent ? ' · Incumbent' : ''}</small></div><span class="chev">›</span></a>`;
    }).join('');
    return rows ? `<h3 class="street">${DIST_NAME[k]}s</h3><div class="group">${rows}</div>` : '';
  };
  const n = Object.keys(cands).length;
  return `<header class="top"><nav class="bar-nav"><a href="#/load" class="back">${ICON.back}Lists</a>${n ? '<button class="link" id="sharecands">Share</button>' : ''}</nav>
    <h1 class="h-sm">Candidates</h1><div class="sub">The candidate we support in each district. Saved on this phone. Share sends them to volunteers, and they also go along with every turf you share.</div></header>
    <main>${all.length ? DKEYS.map(group).join('') : '<p class="empty">Load walk lists first. Their districts show up here.</p>'}</main>`;
}

function candEdit(k, n) {
  if (!DIST_NAME[k] || !(+n > 0)) return notFound();
  const key = candKey(k, +n), c = cands[key];
  if (draft?.key !== key) draft = { key, photo: c?.photo || '' };
  return `<header class="top"><nav class="bar-nav"><a href="${esc(/^#\/c\//.test(prevHash) ? '#/c' : prevHash)}" class="back">${ICON.back}Back</a></nav>
    <h1 class="h-sm">${DIST_NAME[k]} ${+n}</h1><div class="sub">The candidate we support here.</div></header>
    <div class="candedit"><span id="candface">${face(draft.photo ? { photo: draft.photo } : c, 'lg')}</span>
    <div class="photobtns"><label class="btn tonal">${ICON.cam}Take photo<input id="candcam" type="file" accept="image/*" capture="user" hidden></label>
    <label class="btn ghost">Choose photo<input id="candfile" type="file" accept="image/*" hidden></label>
    <button class="link danger" id="candnophoto" ${draft.photo ? '' : 'hidden'}>Remove photo</button></div></div>
    <label class="label" for="candname">Name</label><input id="candname" class="field" type="text" autocomplete="off" maxlength="80" value="${esc(c?.name)}" placeholder="Full name">
    <label class="check"><input id="candinc" type="checkbox" ${c?.incumbent ? 'checked' : ''}> Incumbent</label>
    <div class="foot"><button class="btn wide" id="candsave">Save</button>
    ${c ? '<button class="link danger wide" id="canddel">Remove this candidate</button>' : ''}</div>`;
}

// ---------- HQ: a big-screen overview for whoever runs the campaign ----------
let hqKind = 'hd', hqDist = '';
function packStats(p) {
  const st = { doors: 0, done: 0, talked: 0, voted: 0 };
  for (const t of packs[p].turfs) for (const r of doorsOf(t)) {
    st.doors++;
    const v = resOf(p, t.id, r.n)?.res;
    if (v?.length) { st.done++; if (v.includes('Talked')) st.talked++; if (v.includes('Voted')) st.voted++; }
  }
  return st;
}
const addStats = (a, b) => ({ doors: a.doors + b.doors, done: a.done + b.done, talked: a.talked + b.talked, voted: a.voted + b.voted });
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const statCells = (st) => `<td class="num-c">${st.doors}</td><td class="num-c">${st.done}</td>
  <td><div class="hqbar"><div style="width:${pct(st.done, st.doors)}%"></div></div><small>${pct(st.done, st.doors)}%</small></td>
  <td class="num-c">${st.talked}</td><td class="num-c">${st.voted}</td>`;
const statHead = '<th class="num-c">Doors</th><th class="num-c">Done</th><th>Progress</th><th class="num-c">Talked</th><th class="num-c">Voted</th>';

function hqView() {
  const titles = Object.keys(packs).sort(natural);
  const stats = Object.fromEntries(titles.map((p) => [p, packStats(p)]));
  const total = titles.reduce((a, p) => addStats(a, stats[p]), { doors: 0, done: 0, talked: 0, voted: 0 });
  const hasDist = titles.some((p) => packs[p].cd);
  const groups = {};
  for (const p of titles) { const n = packs[p][hqKind]; if (n) (groups[n] ||= []).push(p); }
  const nums = Object.keys(groups).map(Number).sort((a, b) => a - b);
  if (hqDist && !groups[hqDist]) hqDist = '';
  const distRows = nums.map((n) => {
    const st = groups[n].reduce((a, p) => addStats(a, stats[p]), { doors: 0, done: 0, talked: 0, voted: 0 });
    const c = cands[candKey(hqKind, n)];
    return `<tr class="${+hqDist === n ? 'sel' : ''}"><td><button class="link" data-hqdist="${n}">${hqKind.toUpperCase()} ${n}</button></td>
      <td><a class="hqcand" href="#/c/${hqKind}/${n}">${face(c, 'xs')}<span>${c ? esc(c.name) : '<span class="muted">Add candidate</span>'}</span></a></td>
      <td class="num-c">${groups[n].length}</td>${statCells(st)}
      <td class="act"><button class="btn tonal sm" data-senddist="${n}">Send file</button></td></tr>`;
  }).join('');
  const shown = hqDist ? groups[hqDist] : titles;
  const packRows = shown.map((p) => `<tr><td><a href="#/k/${enc(p)}">${esc(p)}</a></td><td class="muted">${districts(packs[p])}</td>
    <td class="num-c">${packs[p].turfs.length}</td>${statCells(stats[p])}
    <td class="act"><button class="btn tonal sm" data-sendpack="${esc(p)}">Send file</button></td></tr>`).join('');
  const note = flash ? `<p class="flash" role="status">${esc(flash)}</p>` : '';
  flash = '';
  return `${note}<header class="top"><nav class="bar-nav"><a href="#/" class="back">${ICON.back}Turfs</a></nav>
    <h1 class="h-sm">HQ</h1><div class="sub">Progress across every precinct on this computer. Send precincts out as files, and load the results spreadsheets volunteers send back.</div></header>
    <label class="drop" id="drop"><input id="hqfiles" type="file" multiple hidden>
      <b>Drop files here, or click to choose</b><span>Walk list files, candidate files, and volunteers’ results spreadsheets (.csv). Newer results win.</span></label>
    <div class="tiles"><div><b>${titles.length}</b><span>Precincts</span></div><div><b>${total.doors}</b><span>Doors</span></div>
      <div><b>${total.done}</b><span>Doors done · ${pct(total.done, total.doors)}%</span></div><div><b>${total.talked}</b><span>Talked</span></div><div><b>${total.voted}</b><span>Voted</span></div></div>
    ${hasDist ? `<section class="card hqcard"><div class="hqhead"><div class="card-title">By district</div>
      <div class="seg">${['cd', 'sd', 'hd'].map((k) => `<button class="${k === hqKind ? 'on' : ''}" data-hqkind="${k}">${{ cd: 'Congress', sd: 'Senate', hd: 'House' }[k]}</button>`).join('')}</div></div>
      <div class="tablewrap"><table class="hqt"><thead><tr><th>District</th><th>Our candidate</th><th class="num-c">Precincts</th>${statHead}<th></th></tr></thead><tbody>${distRows}</tbody></table></div></section>` : ''}
    <section class="card hqcard"><div class="hqhead"><div class="card-title">${hqDist ? `Precincts in ${hqKind.toUpperCase()} ${hqDist}` : 'All precincts'}</div>
      ${hqDist ? '<button class="link" data-hqdist="">Show all</button>' : ''}</div>
      ${titles.length ? `<div class="tablewrap"><table class="hqt"><thead><tr><th>Precinct</th><th>Districts</th><th class="num-c">Turfs</th>${statHead}<th></th></tr></thead><tbody>${packRows}</tbody></table></div>`
        : '<p class="muted">No walk lists yet. Drop list files above.</p>'}</section>
    <div class="row2"><button class="btn" id="export" ${Object.keys(results).length ? '' : 'disabled'}>Download all results</button><a class="btn tonal" href="#/c">Edit candidates</a></div>`;
}

const notFound = () => `<header class="top"><a href="#/" class="back">${ICON.back}Turfs</a><h1 class="h-sm">Not found</h1><p class="sub">That turf isn’t loaded on this phone.</p></header>`;

// ---------- routing ----------

function render() {
  if (location.hash !== curHash) { prevHash = curHash || '#/'; curHash = location.hash; if (!/^#\/c\//.test(curHash)) draft = null; }
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [v, a, b, c] = parts;
  document.body.classList.toggle('printing', v === 'p');
  $('#app').innerHTML = v === 'k' ? packView(a) : v === 't' ? turfView(a, b) : v === 'd' ? doorView(a, b, c) : v === 'p' ? printView(a, b)
    : v === 'scan' ? scanView() : v === 'load' ? loadView() : v === 'hq' ? hqView() : v === 'c' ? (a ? candEdit(a, b) : candsView()) : home();
  if (v !== 'scan' && v !== 'p') window.scrollTo(0, 0);
  document.body.classList.toggle('hq', v === 'hq');
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
  } else if (el.id === 'candsave') {
    const [, k, n] = location.hash.replace(/^#\//, '').split('/');
    const name = $('#candname').value.trim();
    if (!name) { $('#candname').focus(); return; }
    const key = candKey(k, +n), c = { name, incumbent: $('#candinc').checked, photo: draft?.photo || '', at: new Date().toISOString() };
    try { await db.put('cands', key, c); } catch (err) { alert(`This phone would not save it (${err.message}).`); return; }
    cands[key] = c; draft = null;
    location.hash = /^#\/c\//.test(prevHash) ? '#/c' : prevHash;
  } else if (el.id === 'canddel') {
    const [, k, n] = location.hash.replace(/^#\//, '').split('/');
    if (!confirm('Remove this candidate from this phone?')) return;
    delete cands[candKey(k, +n)]; draft = null;
    await db.del('cands', candKey(k, +n));
    location.hash = /^#\/c\//.test(prevHash) ? '#/c' : prevHash;
  } else if (el.id === 'candnophoto') {
    draft.photo = ''; $('#candface').innerHTML = face({ name: $('#candname').value }, 'lg'); el.hidden = true;
  } else if (el.id === 'sharecands') shareCands();
  else if (el.dataset.hqkind) { hqKind = el.dataset.hqkind; hqDist = ''; render(); }
  else if (el.dataset.hqdist !== undefined) { hqDist = el.dataset.hqdist; render(); }
  else if (el.dataset.sendpack) packFile([el.dataset.sendpack], `${el.dataset.sendpack}.json`, `Walk list: ${el.dataset.sendpack}`);
  else if (el.dataset.senddist) {
    const k = hqKind, n = +el.dataset.senddist, ts = Object.keys(packs).filter((p) => packs[p][k] === n).sort(natural);
    packFile(ts, `${k.toUpperCase()} ${n}.json`, `Walk lists for ${DIST_NAME[k]} ${n} (${ts.length} precincts)`);
  }
  else if (el.id === 'export') exportCsv();
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
  if (inp.id === 'dist' && inp.value === 'edit') { location.hash = '#/c'; return; }
  if (inp.id === 'dist') { filter = inp.value ? inp.value.toUpperCase() : ''; render(); return; }
  if (inp.id === 'candcam' || inp.id === 'candfile') {
    const f = inp.files[0]; inp.value = '';
    if (!f || !draft) return;
    try { draft.photo = await shrinkPhoto(f); } catch (err) { alert(`Could not use that photo: ${err.message}`); return; }
    $('#candface').innerHTML = face({ photo: draft.photo }, 'lg');
    $('#candnophoto').hidden = false;
    return;
  }
  if (inp.id === 'packs' || inp.id === 'resfiles' || inp.id === 'hqfiles') {
    const files = [...inp.files];
    inp.value = '';
    await loadFiles(files);
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

// Loads walk list files, candidate files and results spreadsheets, whichever they are.
async function loadFiles(files) {
  const added = [];
  let candsIn = 0, resIn = 0;
  for (const f of files) {
    let text;
    try { text = await readText(f); } catch (err) { alert(`Could not open ${f.name}: ${err.message}`); continue; }
    if (!/^\s*[{[]/.test(text)) {   // a results spreadsheet
      try { resIn += await importCsv(text); } catch (err) { alert(`Could not read ${f.name}: ${err.message}`); }
      continue;
    }
    try {
      let d;
      try { d = JSON.parse(text); } catch { d = null; }
      const list = d?.packs || [d];
      const good = list.filter((x) => x && x.v === 1 && x.title && Array.isArray(x.turfs));
      candsIn += d?.candidates ? await mergeCands(d.candidates) : 0;
      if (!good.length) { if (!d?.candidates) alert(`${f.name} is not a walk list file.`); continue; }
      for (const x of good) { packs[x.title] = mergePack(packs[x.title], x); added.push(x.title); }
      await db.putMany('packs', good.map((x) => [x.title, packs[x.title]]));
    } catch (err) { alert(`Loaded ${f.name}, but this device would not save it, so it will be gone after you close the app. (${err.message})`); }
  }
  const parts = [];
  if (added.length) parts.push(added.length > 3 ? `${added.length} precincts` : added.join(', '));
  if (candsIn) parts.push(`${candsIn} candidate${candsIn === 1 ? '' : 's'}`);
  if (resIn || (!parts.length && files.length)) parts.push(`${resIn} door result${resIn === 1 ? '' : 's'}`);
  if (!parts.length) return render();
  flash = `Loaded ${parts.join(' and ')}`;
  if (location.hash.startsWith('#/hq')) render();
  else { filter = ''; if (location.hash === '#/' || location.hash === '') render(); else location.hash = '#/'; }
}

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
  const cs = Object.fromEntries(candsOf(pack).filter((x) => x.c).map((x) => [candKey(x.k, x.n), x.c]));
  if (Object.keys(cs).length) out.candidates = cs;
  const name = `${p} Turf ${tid.slice(1)}.json`;
  await shareFile(new File([JSON.stringify(out)], name, { type: 'application/json' }),
    `Walk list: ${p} Turf ${tid.slice(1)}. Open ${location.origin}${location.pathname} and load this file under Lists & export.`);
}

// Whole precincts for a volunteer or team lead, with their candidates.
function packFile(titles, name, text) {
  const ps = titles.map((t) => packs[t]);
  const cs = {};
  for (const pk of ps) for (const x of candsOf(pk)) if (x.c) cs[candKey(x.k, x.n)] = x.c;
  const out = ps.length === 1 ? { ...ps[0] } : { v: 1, packs: ps };
  if (Object.keys(cs).length) out.candidates = cs;
  return shareFile(new File([JSON.stringify(out)], name, { type: 'application/json' }),
    `${text}. Open ${location.origin}${location.pathname} and load this file under Lists & export.`);
}

// All candidates in one file. Volunteers load it under Lists & export, like a list file.
function shareCands() {
  const name = 'Candidates.json';
  return shareFile(new File([JSON.stringify({ v: 1, candidates: cands })], name, { type: 'application/json' }),
    `Our candidates. Open ${location.origin}${location.pathname} and load this file under Lists & export.`);
}

async function shareFile(file, text) {
  const name = file.name;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name, text }); return; }
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

// Drag files onto the HQ screen (or anywhere) to load them.
addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); $('#drop')?.classList.add('over'); } });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#drop')?.classList.remove('over'); });
addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  $('#drop')?.classList.remove('over');
  loadFiles([...e.dataTransfer.files]);
});

// ---------- start ----------

(async () => {
  [packs, results, cands] = await Promise.all([db.getAll('packs'), db.getAll('results'), db.getAll('cands')]);
  addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
    // A new version took over: reload once so this phone runs it now, not on the next visit.
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !draft && !scans.length && !location.hash.startsWith('#/scan')) location.reload(); });
  }
})();
