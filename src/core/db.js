// طبقة IndexedDB — كل الكتابات المالية والمخزنية تتم في معاملة ذرّية واحدة (all-or-nothing)
export const STORES = ['meta', 'products', 'categories', 'suppliers', 'customers', 'invoices', 'returns', 'purchases', 'payments', 'expenses', 'moves', 'batches', 'offers', 'holds', 'users', 'shifts', 'audit', 'counts', 'backups'];
// مخازن البيانات التي تدخل في النسخة الاحتياطية (backups نفسها مستثناة)
export const DATA_STORES = STORES.filter(s => s !== 'backups');
const KEY = s => s === 'meta' ? 'k' : 'id';
export const DB_VERSION = 1;

let _db = null, _name = 'kashier-pro';
// الوضع السحابي (Supabase): كل المخازن عدا 'backups' (لقطات هذا الجهاز) تُقرأ وتُكتب عبر المحرك السحابي بنفس الواجهة
let R = null; const viaRemote = s => R && s !== 'backups';
export const setRemote = r => { R = r; r?.setEmitter(ch => emit(ch, true)); };
export const isRemote = () => !!R;
export const remote = () => R;
export const refresh = () => R ? R.pull().catch(() => false) : Promise.resolve(false);
const listeners = new Set();
let bc = null; const TAB = Math.random().toString(36).slice(2);

export const onCommit = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const norm = ch => { ch.put ||= {}; ch.del ||= {}; return ch; };

export function open(name = 'kashier-pro') {
  _name = name;
  return new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('المتصفح لا يدعم IndexedDB'));
    const rq = indexedDB.open(name, DB_VERSION);
    rq.onupgradeneeded = () => { const d = rq.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: KEY(s) }); };
    rq.onsuccess = () => {
      _db = rq.result;
      _db.onversionchange = () => { _db.close(); location.reload(); };
      try { bc = new BroadcastChannel('kp-' + name); bc.onmessage = e => { if (e.data?.tab !== TAB) for (const f of listeners) f(e.data.ch, true); }; } catch { }
      res(_db);
    };
    rq.onerror = () => rej(rq.error || new Error('تعذر فتح قاعدة البيانات'));
    rq.onblocked = () => rej(new Error('قاعدة البيانات مقفلة من نافذة أخرى — أغلق النوافذ الأخرى وأعد المحاولة'));
  });
}
export const dbName = () => _name;
const need = () => { if (!_db) throw new Error('قاعدة البيانات غير مفتوحة'); return _db; };

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const getAll = store => viaRemote(store) ? Promise.resolve(R.getAll(store)) : reqP(need().transaction(store).objectStore(store).getAll());
export const get = (store, key) => viaRemote(store) ? Promise.resolve(R.get(store, key)) : reqP(need().transaction(store).objectStore(store).get(key));

function applyTo(tx, ch) {
  for (const [s, recs] of Object.entries(ch.put)) { const os = tx.objectStore(s); for (const r of recs) os.put(r); }
  for (const [s, ids] of Object.entries(ch.del)) { const os = tx.objectStore(s); for (const id of ids) os.delete(id); }
  if (ch.clear) for (const s of ch.clear) tx.objectStore(s).clear();
}
const touched = ch => [...new Set([...Object.keys(ch.put), ...Object.keys(ch.del), ...(ch.clear || [])])];
function emit(ch, noBc = false) {
  for (const f of listeners) f(ch, false);
  if (!noBc) try { bc?.postMessage({ tab: TAB, ch: slim(ch) }); } catch { }
}
// نبث للنوافذ الأخرى أسماء المخازن فقط (تعيد قراءتها) لتجنب نسخ بيانات ضخمة
const slim = ch => ({ put: Object.fromEntries(Object.keys(ch.put).map(k => [k, []])), del: {}, reload: touched(ch) });

// كتابة ذرّية: ch = { put:{store:[rec]}, del:{store:[id]}, clear:[store] }
export async function commit(ch) {
  if (!R) return localCommit(ch);
  norm(ch);
  const loc = { put: {}, del: {} }, rem = { put: {}, del: {}, clear: [] };
  for (const [s, v] of Object.entries(ch.put)) (s === 'backups' ? loc.put : rem.put)[s] = v;
  for (const [s, v] of Object.entries(ch.del)) (s === 'backups' ? loc.del : rem.del)[s] = v;
  rem.clear = (ch.clear || []).filter(s => s !== 'backups'); const lc = (ch.clear || []).filter(s => s === 'backups'); if (lc.length) loc.clear = lc;
  if (touched(loc).length) await localCommit(loc);
  if (touched(rem).length) await R.commit(rem);
  return ch;
}
function localCommit(ch) {
  norm(ch);
  const names = touched(ch);
  if (!names.length) return Promise.resolve(ch);
  return new Promise((resolve, reject) => {
    const tx = need().transaction(names, 'readwrite');
    tx.oncomplete = () => { emit(ch); resolve(ch); };
    tx.onerror = () => reject(tx.error || new Error('فشلت عملية الحفظ'));
    tx.onabort = () => reject(tx.error || new Error('أُلغيت عملية الحفظ'));
    try { applyTo(tx, ch); } catch (e) { try { tx.abort(); } catch { } reject(e); }
  });
}

// كتابة ذرّية مع عدّادات (أرقام الفواتير) تُقرأ وتُحدَّث داخل نفس المعاملة => لا تكرار للأرقام أبداً
// build(counters) تعيد { ch, result } ويمكنها رمي خطأ لإلغاء كل شيء
export function atomic(stores, build) {
  if (R) return R.atomic(build);
  return new Promise((resolve, reject) => {
    const names = [...new Set([...stores, 'meta'])];
    const tx = need().transaction(names, 'readwrite');
    let out, err = null;
    tx.oncomplete = () => { emit(out.ch); resolve(out); };
    tx.onerror = () => reject(err || tx.error || new Error('فشلت عملية الحفظ'));
    tx.onabort = () => reject(err || tx.error || new Error('أُلغيت عملية الحفظ'));
    const rq = tx.objectStore('meta').get('counters');
    rq.onsuccess = () => {
      try {
        const counters = { ...(rq.result?.v || {}) };
        out = build(counters); norm(out.ch);
        (out.ch.put.meta ||= []).push({ k: 'counters', v: counters });
        applyTo(tx, out.ch);
      } catch (e) { err = e; try { tx.abort(); } catch { } }
    };
  });
}

// استبدال كامل لكل البيانات في معاملة واحدة (للاستعادة والترحيل)
export async function replaceAll(data) {
  if (R) { await R.replaceAll(data); emit({ put: Object.fromEntries(DATA_STORES.map(s => [s, []])), del: {}, reload: DATA_STORES }, true); return; }
  return new Promise((resolve, reject) => {
    const tx = need().transaction(DATA_STORES, 'readwrite');
    tx.oncomplete = () => { const ch = { put: {}, del: {}, reload: DATA_STORES }; for (const s of DATA_STORES) ch.put[s] = data[s] || []; emit({ put: Object.fromEntries(DATA_STORES.map(s => [s, []])), del: {}, reload: DATA_STORES }); resolve(); };
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('أُلغيت الاستعادة'));
    for (const s of DATA_STORES) { const os = tx.objectStore(s); os.clear(); for (const r of (data[s] || [])) os.put(r); }
  });
}

export async function exportAll() { if (R) return R.exportAll(); const o = {}; for (const s of DATA_STORES) o[s] = await getAll(s); return o; }

export async function deleteDatabase(name = _name) {
  try { _db?.close(); } catch { } _db = null;
  return new Promise((res, rej) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res(); });
}
export async function persist() { try { return await navigator.storage?.persist?.(); } catch { return false; } }
export async function usage() { try { const e = await navigator.storage?.estimate?.(); return e || null; } catch { return null; } }

// قراءة قاعدة محلية أخرى (للقراءة فقط) دون المساس بها: تُستخدم لرفع بيانات الوضع المحلي إلى السحابة. تعيد null إن لم توجد.
export async function readLocalDb(name = 'kashier-pro') {
  if (!('indexedDB' in globalThis)) return null;
  try { const all = await indexedDB.databases?.(); if (all && !all.some(d => d.name === name)) return null; } catch { }
  return new Promise(resolve => {
    const rq = indexedDB.open(name);
    rq.onupgradeneeded = () => { try { rq.transaction.abort(); } catch { } };      // لا تُنشئ قاعدة غير موجودة
    rq.onerror = () => resolve(null); rq.onblocked = () => resolve(null);
    rq.onsuccess = async () => {
      const d = rq.result;
      try {
        const out = {};
        for (const s of DATA_STORES) out[s] = d.objectStoreNames.contains(s) ? await new Promise((ok, no) => { const r = d.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }) : [];
        d.close(); resolve(out);
      } catch { try { d.close(); } catch { } resolve(null); }
    };
  });
}
export const localSummary = d => d ? { products: d.products.length, invoices: d.invoices.length, customers: d.customers.length, suppliers: d.suppliers.length } : null;
