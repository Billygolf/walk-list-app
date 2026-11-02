// Read a photo or scan of a printed sheet: find the corner squares, read the page code,
// then measure ink inside each result box.
import { G, RESULTS, fiducials, paginate, parsePageCode } from './layout.js';

const MARKED = 0.08, UNSURE = 0.03;   // share of dark pixels inside a box

async function loadGray(file, maxSide = 2000) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return { g, w, h };
}

// 1 where a pixel is clearly darker than its neighborhood (handles shadows and uneven light).
function binarize({ g, w, h }) {
  const win = Math.max(15, Math.round(Math.max(w, h) / 40)) | 1, r = win >> 1, C = 15;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      b[y * w + x] = g[y * w + x] < sum / ((x1 - x0) * (y1 - y0)) - C ? 1 : 0;
    }
  }
  return b;
}

// Solid dark squares: candidates for the corner marks.
function squares(b, w, h) {
  const lab = new Int32Array(w * h), out = [], stack = new Int32Array(w * h);
  let id = 0;
  for (let p = 0; p < b.length; p++) {
    if (!b[p] || lab[p]) continue;
    id++;
    let sp = 0, area = 0, minx = w, maxx = 0, miny = h, maxy = 0;
    stack[sp++] = p; lab[p] = id;
    while (sp) {
      const q = stack[--sp], x = q % w, y = (q / w) | 0;
      area++;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && b[q - 1] && !lab[q - 1]) { lab[q - 1] = id; stack[sp++] = q - 1; }
      if (x < w - 1 && b[q + 1] && !lab[q + 1]) { lab[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && b[q - w] && !lab[q - w]) { lab[q - w] = id; stack[sp++] = q - w; }
      if (y < h - 1 && b[q + w] && !lab[q + w]) { lab[q + w] = id; stack[sp++] = q + w; }
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (area < 0.0001 * w * h || area > 0.01 * w * h) continue;
    if (bw / bh < 0.7 || bw / bh > 1.4 || area / (bw * bh) < 0.8) continue;
    out.push({ x: (minx + maxx) / 2, y: (miny + maxy) / 2, area });
  }
  const big = Math.max(0, ...out.map((c) => c.area));
  return out.filter((c) => c.area > big * 0.3);
}

// Homography taking page inches (u, v) to image pixels (x, y), from 4 point pairs.
function homography(src, dst) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  const m = B.map((v, i) => v / A[i][i]);
  return (u, v) => {
    const z = m[6] * u + m[7] * v + 1;
    return [(m[0] * u + m[1] * v + m[2]) / z, (m[3] * u + m[4] * v + m[5]) / z];
  };
}

function readCode(img, map) {
  const ppi = 160, x0 = 5.5, y0 = 0.1, cw = Math.round(2.8 * ppi), ch = Math.round(1.6 * ppi);
  const rgba = new Uint8ClampedArray(cw * ch * 4);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const [x, y] = map(x0 + i / ppi, y0 + j / ppi);
    const xi = Math.round(x), yi = Math.round(y);
    const v = xi >= 0 && yi >= 0 && xi < img.w && yi < img.h ? img.g[yi * img.w + xi] : 255;
    const o = (j * cw + i) * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
  }
  const r = window.jsQR(rgba, cw, ch, { inversionAttempts: 'dontInvert' });
  return r ? r.data : null;
}

function inkAt(b, img, map, u, v, half) {
  let ink = 0, n = 0;
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
    const [x, y] = map(u + (i / 6) * half, v + (j / 6) * half);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= img.w || yi >= img.h) continue;
    n++; ink += b[yi * img.w + xi];
  }
  return n ? ink / n : 0;
}

// packs: { [title]: pack }. Returns { ok, code, pack, turf, page, doors[] } or { ok:false, error }.
export async function readSheet(file, packs) {
  const img = await loadGray(file);
  const b = binarize(img);
  const cand = squares(b, img.w, img.h);
  if (cand.length < 4) return { ok: false, error: 'Could not find the four black corner squares. Fit the whole page in the photo.' };
  const near = ([cx, cy]) => cand.reduce((best, c) => ((c.x - cx) ** 2 + (c.y - cy) ** 2 < (best.x - cx) ** 2 + (best.y - cy) ** 2 ? c : best));
  // image corners clockwise from top-left
  const ring = [[0, 0], [img.w, 0], [img.w, img.h], [0, img.h]].map(near).map((c) => [c.x, c.y]);
  if (new Set(ring.map(String)).size < 4) return { ok: false, error: 'Could not find the four black corner squares. Fit the whole page in the photo.' };
  const [tl, tr, bl, br] = fiducials();
  const pageRing = [tl, tr, br, bl];
  let map = null, code = null;
  for (let k = 0; k < 4 && !code; k++) {   // try each way the page could be turned
    const m = homography(pageRing, [0, 1, 2, 3].map((i) => ring[(i + k) % 4]));
    const c = readCode(img, m);
    if (c) { code = c; map = m; }
  }
  const pc = parsePageCode(code);
  if (!pc) return { ok: false, error: code ? 'This page is not one of the app’s sheets.' : 'Found the page but could not read the code in the top right corner. Try a sharper photo.' };
  const pack = packs[pc.pack];
  const turf = pack?.turfs.find((t) => t.id === pc.turf);
  if (!turf) return { ok: false, error: `This sheet is for ${pc.pack} ${pc.turf}, which is not loaded in the app.` };
  const items = paginate(turf)[pc.page - 1];
  if (!items) return { ok: false, error: 'Page number on the sheet does not match the list.' };
  const half = G.BOX * 0.3;
  const doors = items.filter((it) => it.kind === 'door').map((it) => {
    const ink = G.BOX_X.map((x) => inkAt(b, img, map, x, it.y, half));
    return { n: it.row.n, addr: it.row.addr, name: it.row.name, ink,
      marked: RESULTS.filter((_, i) => ink[i] > MARKED), unsure: RESULTS.filter((_, i) => ink[i] > UNSURE && ink[i] <= MARKED) };
  });
  return { ok: true, code, pack: pc.pack, turf: pc.turf, page: pc.page, pages: paginate(turf).length, turfName: turf.name, doors };
}
