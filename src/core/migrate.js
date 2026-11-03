// ترحيل البيانات الآمن. القاعدة الذهبية: لا نحذف ولا نعدّل مفاتيح localStorage القديمة أبداً؛
// ننسخها كما هي إلى مخزن meta (legacy_localstorage) ثم نحوّلها ونكتب كل شيء في معاملة واحدة.
// إذا فشل التحويل لأي سبب لا يُسجَّل رقم الإصدار، وتبقى البيانات القديمة سليمة ويُعاد المحاولة في التشغيل التالي.
import * as db from './db.js';
import { uid, pad, r2 } from './util.js';
import { DEFAULT_SETTINGS } from './store.js';
import { deepMerge } from './util.js';

export const SCHEMA_VERSION = 1;
const LEGACY_KEYS = ['sh_p', 'sh_c', 'sh_s', 'sh_t'];
const parse = s => { try { return JSON.parse(s); } catch { return null; } };

export function readLegacy(ls = globalThis.localStorage) {
  const raw = {}; let any = false;
  for (const k of LEGACY_KEYS) { try { const v = ls.getItem(k); if (v != null) { raw[k] = v; any = true; } } catch { } }
  return any ? raw : null;
}

// يحوّل بيانات النسخة القديمة {P: منتجات, H: سجل, T: إعدادات, C: سلة} إلى هيكل قاعدة البيانات الجديدة
export function convertLegacy({ P = [], H = [], T = {}, C = [] }, prefix = DEFAULT_SETTINGS.invoice.prefix) {
  const t0 = new Date().toISOString(); const usedBc = new Set(); const out = { products: [], invoices: [], settings: null, cart: null };
  const pmap = new Map();
  for (const o of Array.isArray(P) ? P : []) {
    if (!o || !String(o.name || '').trim()) continue;
    let bc = String(o.bc ?? '').trim(); if (bc && usedBc.has(bc)) bc = ''; if (bc) usedBc.add(bc);
    const price = Number(o.price); const unit = o.u === 'kg' ? 'kg' : 'pc';
    const p = { id: String(o.id || uid()), name: String(o.name).trim(), barcode: bc, code: '', cat: '', cost: null, price: isFinite(price) && price >= 0 ? price : 0, unit,
      track: false, // المنتجات القديمة بلا مخزون: لا نتتبع الكمية حتى لا يتوقف البيع، ويفعّلها المستخدم لاحقاً
      stock: 0, min: null, expiry: '', supplierId: '', desc: '', img: null, active: true, createdAt: t0, updatedAt: t0 };
    pmap.set(p.id, p); out.products.push(p);
  }
  let n = 0;
  for (const s of Array.isArray(H) ? H : []) {
    if (!s || !Array.isArray(s.items)) continue; n++;
    const total = r2(Number(s.total) || 0); const t = s.t && !isNaN(Date.parse(s.t)) ? s.t : t0;
    const items = s.items.map(i => { const tt = r2(Number(i.total) || 0); return { pid: null, name: String(i.name ?? ''), unit: 'pc', qty: 1, price: tt, gross: tt, offerDisc: 0, offer: null, disc: null, manualDisc: 0, total: tt, alloc: 0, net: tt, cost: 0, costKnown: false, note: String(i.d ?? ''), returned: 0, batches: [] }; });
    out.invoices.push({ id: String(s.id || uid()), no: 'OLD-' + pad(n, 5), t, userId: 'owner', userName: 'المدير', shiftId: '', customerId: '', customerName: '', items, subtotal: total, offerDisc: 0, lineDisc: 0, invDisc: 0, discount: 0, taxable: total, tax: 0, taxRate: 0, taxInclusive: false, total, net: total, payments: [{ method: 'cash', amount: total }], received: total, change: 0, due: 0, paid: total, method: 'cash', note: 'مرحّلة من النسخة القديمة', status: 'done', returnedTotal: 0, later: [], legacy: true });
  }
  const t = T && typeof T === 'object' ? T : {};
  out.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), { name: String(t.name || ''), cur: String(t.cur || ''), theme: ['auto', 'light', 'dark'].includes(t.theme) ? t.theme : 'auto', vib: t.vib === 0 ? 0 : 1, snd: t.snd === 0 ? 0 : 1, once: t.once ? 1 : 0 });
  const lines = [];
  for (const l of Array.isArray(C) ? C : []) { const p = pmap.get(l?.id); if (!p) continue; const qty = p.unit === 'kg' ? (Number(l.g) || 0) / 1000 : Number(l.qty) || 0; if (qty > 0) lines.push({ pid: p.id, qty, disc: null }); }
  out.cart = lines.length ? { lines, invDisc: null, customerId: '', note: '' } : null;
  return out;
}

const steps = [
  // الإصدار 1: الترحيل الأولي من localStorage (لا يُجرى أبداً في قاعدة وضع التجربة)
  async (opts) => {
    const raw = opts.legacy === false ? null : readLegacy();
    const existing = (await db.get('meta', 'schema'))?.v;
    if (existing) return;
    const meta = [{ k: 'counters', v: {} }];
    const put = { meta, products: [], invoices: [] };
    if (raw) {
      const conv = convertLegacy({ P: parse(raw.sh_p) || [], H: parse(raw.sh_s) || [], T: parse(raw.sh_t) || {}, C: parse(raw.sh_c) || [] });
      meta.push({ k: 'legacy_localstorage', v: { savedAt: new Date().toISOString(), raw } }); // نسخة خام كاملة للأمان
      meta.push({ k: 'settings', v: conv.settings });
      if (conv.cart) { try { localStorage.setItem('kp_cart_' + db.dbName(), JSON.stringify(conv.cart)); } catch { } }
      put.products = conv.products; put.invoices = conv.invoices;
      meta.push({ k: 'migration', v: { from: 'localStorage-v2', at: new Date().toISOString(), products: conv.products.length, invoices: conv.invoices.length } });
    }
    meta.push({ k: 'schema', v: { v: 1 } });
    await db.commit({ put, del: {} }); // معاملة واحدة: إما كل شيء أو لا شيء
  },
];

export async function runMigrations(opts = {}) {
  const cur = (await db.get('meta', 'schema'))?.v || 0;
  if (cur > SCHEMA_VERSION) throw new Error('قاعدة البيانات أحدث من هذا الإصدار من التطبيق — حدّث التطبيق أولاً');
  for (let v = cur; v < SCHEMA_VERSION; v++) await steps[v](opts);
  return (await db.get('meta', 'migration'))?.v || null;
}
