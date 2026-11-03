// الحالة في الذاكرة: كل البيانات تُحمّل مرة واحدة من IndexedDB لتكون الواجهة (خاصة شاشة البيع) فورية.
// أي كتابة تمر عبر db.commit ثم تنعكس هنا تلقائياً.
import * as db from './db.js';
import { norm, deepMerge, uid } from './util.js';

export const NAMES = ['products', 'categories', 'suppliers', 'customers', 'invoices', 'returns', 'purchases', 'payments', 'expenses', 'moves', 'batches', 'offers', 'holds', 'users', 'shifts', 'audit', 'counts'];

export const DEFAULT_SETTINGS = {
  name: '', phone: '', address: '', logo: null, taxNo: '', cur: '',
  theme: 'auto', vib: 1, snd: 1, once: 0,
  tax: { on: false, rate: 15, inclusive: true, label: 'ضريبة القيمة المضافة' },
  invoice: { prefix: 'INV-', pad: 6, footer: 'شكراً لزيارتكم', showLogo: true, paper: '80', autoPrint: false, copies: 1, retPrefix: 'RET-', purPrefix: 'PUR-' },
  stock: { allowNegative: false, lowDefault: 5, expiryDays: 30 },
  pos: { requireShift: false, maxDiscPct: 10, defaultPay: 'cash', grid: true, images: true, scale: { on: false, prefix: '2', itemLen: 5, valLen: 5 } },
  cost: { method: 'last' },
  backup: { auto: true, keep: 7, intervalH: 24, lastAt: 0, lastExportAt: 0 },
  auth: { enabled: false, lockMin: 0 },
  roles: {},
  sync: { enabled: false, url: '', key: '' },
  demo: false,
};

const state = { m: {}, settings: structuredClone(DEFAULT_SETTINGS), counters: {}, loaded: false };
export const S = state;
const lists = {}, subs = new Set();
let idx = { text: new Map(), bc: new Map(), code: new Map() };

export const on = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = names => { for (const f of [...subs]) { try { f(names); } catch (e) { console.error(e); } } };

export const settings = () => state.settings;
export const list = name => lists[name] ||= [...state.m[name].values()];
export const get = (name, id) => state.m[name].get(id);
export const count = name => state.m[name].size;

function indexProduct(p) {
  idx.text.set(p.id, norm([p.name, p.barcode, p.code].filter(Boolean).join(' ')));
  if (p.barcode) idx.bc.set(String(p.barcode), p);
  if (p.code) idx.code.set(String(p.code), p);
}
function unindexProduct(p) {
  idx.text.delete(p.id);
  if (p.barcode && idx.bc.get(String(p.barcode))?.id === p.id) idx.bc.delete(String(p.barcode));
  if (p.code && idx.code.get(String(p.code))?.id === p.id) idx.code.delete(String(p.code));
}
function reindexAll() { idx = { text: new Map(), bc: new Map(), code: new Map() }; for (const p of state.m.products.values()) indexProduct(p); }

export async function load() {
  for (const n of NAMES) { state.m[n] = new Map((await db.getAll(n)).map(r => [r.id, r])); lists[n] = null; }
  const metas = await db.getAll('meta');
  const mm = Object.fromEntries(metas.map(r => [r.k, r.v]));
  state.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), mm.settings || {});
  state.counters = mm.counters || {};
  state.meta = mm;
  reindexAll();
  state.loaded = true;
}

async function reload(names) {
  for (const n of names) {
    if (n === 'meta') { const metas = await db.getAll('meta'); const mm = Object.fromEntries(metas.map(r => [r.k, r.v])); state.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), mm.settings || {}); state.counters = mm.counters || {}; state.meta = mm; continue; }
    if (!state.m[n]) continue;
    state.m[n] = new Map((await db.getAll(n)).map(r => [r.id, r])); lists[n] = null;
  }
  if (names.includes('products')) reindexAll();
}

// تطبيق تغييرات تمت كتابتها بنجاح في IndexedDB على الذاكرة
db.onCommit(async (ch, remote) => {
  if (remote) { await reload(ch.reload || []); emit(new Set(ch.reload || [])); return; }
  const touched = new Set();
  for (const [n, recs] of Object.entries(ch.put || {})) {
    touched.add(n);
    if (n === 'meta') { for (const r of recs) { state.meta ||= {}; state.meta[r.k] = r.v; if (r.k === 'settings') state.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), r.v); if (r.k === 'counters') state.counters = r.v; } continue; }
    const m = state.m[n]; if (!m) continue;
    for (const r of recs) { if (n === 'products') { const o = m.get(r.id); if (o) unindexProduct(o); indexProduct(r); } m.set(r.id, r); }
    lists[n] = null;
  }
  for (const [n, ids] of Object.entries(ch.del || {})) {
    touched.add(n); const m = state.m[n]; if (!m) continue;
    for (const id of ids) { if (n === 'products') { const o = m.get(id); if (o) unindexProduct(o); } m.delete(id); }
    lists[n] = null;
  }
  for (const n of ch.clear || []) { touched.add(n); if (state.m[n]) { state.m[n] = new Map(); lists[n] = null; } if (n === 'products') reindexAll(); }
  emit(touched);
});

export const reloadAll = async () => { await reload([...NAMES, 'meta']); emit(new Set([...NAMES, 'meta'])); };

// ---------- بحث المنتجات (سريع ومتسامح مع الهمزات والتشكيل) ----------
export const byBarcode = bc => idx.bc.get(String(bc).trim());
export const byCode = c => idx.code.get(String(c).trim());
export function searchProducts(q, { cat = '', limit = 60, all = false, sort = 'name' } = {}) {
  const terms = norm(q).split(' ').filter(Boolean);
  const out = [];
  for (const p of list('products')) {
    if (!all && p.active === false) continue;
    if (cat && p.cat !== cat) continue;
    if (terms.length) { const t = idx.text.get(p.id) || ''; let ok = true; for (const w of terms) if (!t.includes(w)) { ok = false; break; } if (!ok) continue; }
    out.push(p);
  }
  if (terms.length) {
    const q0 = terms.join(' ');
    const score = p => { const n = norm(p.name); return (p.barcode === q || p.code === q ? 0 : n === q0 ? 1 : n.startsWith(q0) ? 2 : 3); };
    out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'ar'));
  } else if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return limit ? out.slice(0, limit) : out;
}

// ---------- مشتقات شائعة ----------
export const minOf = p => (p.min == null || p.min === '' ? state.settings.stock.lowDefault : +p.min);
// حالة المخزون: untracked | out | low | ok
export function stockState(p) {
  if (!p.track) return 'untracked';
  if (p.stock <= 0) return 'out';
  if (p.stock <= minOf(p)) return 'low';
  return 'ok';
}
export const catName = id => get('categories', id)?.name || '';
export const supplierName = id => get('suppliers', id)?.name || '';
export const customerBalance = id => { let s = 0; for (const i of list('invoices')) if (i.customerId === id && i.status !== 'void') s += i.due || 0; return Math.round(s * 100) / 100; };
export const supplierBalance = id => { let s = 0; for (const p of list('purchases')) if (p.supplierId === id && p.status === 'approved') s += p.due || 0; return Math.round(s * 100) / 100; };
export const currentShift = userId => list('shifts').find(s => s.status === 'open' && (!userId || s.userId === userId)) || null;
export { uid };
