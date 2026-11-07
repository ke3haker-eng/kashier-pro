// مولّد باركود QR (ISO/IEC 18004) بلا مكتبات: وضع البايتات (UTF-8)، الإصدارات 1–40، مستويات التصحيح L/M/Q/H، واختيار القناع تلقائياً.
// الناتج حتمي: نفس النص ونفس المستوى يعطيان نفس الصورة دائماً (لذلك يبقى الباركود ثابتاً ما دام الرابط ثابتاً).
// الخوارزمية معروفة ومنشورة (بنية جداول التصحيح مأخوذة من المواصفة)، ويتحقق اختبار tests/run-qr.mjs من فك الترميز بقارئ مستقل.

const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
const LEVEL = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = [1, 0, 3, 2];   // L, M, Q, H

const bit = (x, i) => ((x >>> i) & 1) !== 0;

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
  return r;
}
const dataWords = (ver, lv) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[lv][ver] * NUM_BLOCKS[lv][ver];

// حقل غالوا GF(256) بكثير الحدود 0x11D
function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
function rsDivisor(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gmul(root, 2); }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); }
  return r;
}

function alignPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, r = [6];
  for (let pos = ver * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

function encodeData(bytes, ver, lv) {
  const cap = dataWords(ver, lv) * 8, bits = [], put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const out = new Array(bits.length / 8).fill(0); bits.forEach((b, i) => { out[i >>> 3] |= b << (7 - (i & 7)); });
  return out;
}
function interleave(data, ver, lv) {
  const nb = NUM_BLOCKS[lv][ver], el = ECC_PER_BLOCK[lv][ver], raw = Math.floor(rawModules(ver) / 8), ns = nb - raw % nb, sl = Math.floor(raw / nb);
  const blocks = [], div = rsDivisor(el);
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + sl - el + (i < ns ? 0 : 1)); k += dat.length;
    const ecc = rsRemainder(dat, div); if (i < ns) dat.push(0); blocks.push(dat.concat(ecc));
  }
  const res = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sl - el || j >= ns) res.push(b[i]); });
  return res;
}

export function qrMatrix(text, level = 'M') {
  const lv = LEVEL[level]; if (lv === undefined) throw new Error('مستوى تصحيح غير معروف');
  const bytes = [...new TextEncoder().encode(String(text))];
  let ver = 1;
  for (; ; ver++) {
    if (ver > 40) throw new Error('النص طويل جداً للباركود');
    if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= dataWords(ver, lv) * 8) break;
  }
  const size = ver * 4 + 17, M = Array.from({ length: size }, () => new Array(size).fill(false)), F = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (x, y, v) => { M[y][x] = v; F[y][x] = true; };
  // أنماط التوقيت
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  // أنماط الزوايا
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // أنماط المحاذاة
  const ap = alignPositions(ver), na = ap.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = mask => {
    const d = (FORMAT_BITS[lv] << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(bits, i)); setF(8, 7, bit(bits, 6)); setF(8, 8, bit(bits, 7)); setF(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(bits, i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const bits = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const b = bit(bits, i), a = size - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, b); setF(c, a, b); }
  }
  // وضع البيانات بالتعرّج
  const all = interleave(encodeData(bytes, ver, lv), ver, lv);
  for (let i = 0, right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!F[y][x] && i < all.length * 8) { M[y][x] = bit(all[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
  const applyMask = mask => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, x * y % 2 + x * y % 3 === 0, (x * y % 2 + x * y % 3) % 2 === 0, ((x + y) % 2 + x * y % 3) % 2 === 0][mask];
      if (!F[y][x] && inv) M[y][x] = !M[y][x];
    }
  };
  const penalty = () => {
    let p = 0;
    const lines = []; for (let y = 0; y < size; y++) lines.push(M[y].map(v => v ? 1 : 0).join('')); for (let x = 0; x < size; x++) lines.push(M.map(r => r[x] ? 1 : 0).join(''));
    for (const L of lines) {
      for (const m of L.matchAll(/0{5,}|1{5,}/g)) p += 3 + (m[0].length - 5);
      for (let i = 0; i + 11 <= L.length; i++) { const w = L.substr(i, 11); if (w === '10111010000' || w === '00001011101') p += 40; }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
    let dark = 0; for (const r of M) for (const v of r) if (v) dark++;
    p += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const p = penalty(); if (p < bestP) { best = m; bestP = p; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return { size, version: ver, level, mask: best, get: (x, y) => M[y][x] };
}

// SVG متجهي (مع هامش هادئ 4 وحدات حسب المواصفة). الخلفية بيضاء والوحدات سوداء ليقرأه أي ماسح حتى في الوضع الليلي.
export function qrSvg(text, { level = 'M', margin = 4, fg = '#000', bg = '#fff' } = {}) {
  const q = qrMatrix(text, level), n = q.size + margin * 2; let d = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
    if (!q.get(x, y)) continue; let w = 1; while (x + w < q.size && q.get(x + w, y)) w++;
    d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`; x += w - 1;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="باركود رابط المتجر"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}

// صورة PNG بحجم صحيح لكل وحدة (تُرسم بالـ canvas في المتصفح).
export function qrPng(text, { level = 'M', margin = 4, size = 1024 } = {}) {
  const q = qrMatrix(text, level), n = q.size + margin * 2, sc = Math.max(2, Math.floor(size / n)), px = n * sc;
  const cv = document.createElement('canvas'); cv.width = cv.height = px; const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.fillStyle = '#000';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) g.fillRect((x + margin) * sc, (y + margin) * sc, sc, sc);
  return new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('تعذّر إنشاء الصورة')), 'image/png'));
}

export function download(blobOrText, name, type = 'image/png') {
  const b = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type }), u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}
