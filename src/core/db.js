// طبقة IndexedDB — كل الكتابات المالية والمخزنية تتم في معاملة ذرّية واحدة (all-or-nothing)
export const STORES = ['meta', 'products', 'categories', 'suppliers', 'customers', 'invoices', 'returns', 'purchases', 'payments', 'expenses', 'moves', 'batches', 'offers', 'holds', 'users', 'shifts', 'audit', 'counts', 'backups'];
// مخازن البيانات التي تدخل في النسخة الاحتياطية (backups نفسها مستثناة)
export const DATA_STORES = STORES.filter(s => s !== 'backups');
const KEY = s => s === 'meta' ? 'k' : 'id';
export const DB_VERSION = 1;

let _db = null, _name = 'kashier-pro';
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
export const getAll = store => reqP(need().transaction(store).objectStore(store).getAll());
export const get = (store, key) => reqP(need().transaction(store).objectStore(store).get(key));

function applyTo(tx, ch) {
  for (const [s, recs] of Object.entries(ch.put)) { const os = tx.objectStore(s); for (const r of recs) os.put(r); }
  for (const [s, ids] of Object.entries(ch.del)) { const os = tx.objectStore(s); for (const id of ids) os.delete(id); }
  if (ch.clear) for (const s of ch.clear) tx.objectStore(s).clear();
}
const touched = ch => [...new Set([...Object.keys(ch.put), ...Object.keys(ch.del), ...(ch.clear || [])])];
function emit(ch) {
  for (const f of listeners) f(ch, false);
  try { bc?.postMessage({ tab: TAB, ch: slim(ch) }); } catch { }
}
// نبث للنوافذ الأخرى أسماء المخازن فقط (تعيد قراءتها) لتجنب نسخ بيانات ضخمة
const slim = ch => ({ put: Object.fromEntries(Object.keys(ch.put).map(k => [k, []])), del: {}, reload: touched(ch) });

// كتابة ذرّية: ch = { put:{store:[rec]}, del:{store:[id]}, clear:[store] }
export function commit(ch) {
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
export function replaceAll(data) {
  return new Promise((resolve, reject) => {
    const tx = need().transaction(DATA_STORES, 'readwrite');
    tx.oncomplete = () => { const ch = { put: {}, del: {}, reload: DATA_STORES }; for (const s of DATA_STORES) ch.put[s] = data[s] || []; emit({ put: Object.fromEntries(DATA_STORES.map(s => [s, []])), del: {}, reload: DATA_STORES }); resolve(); };
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('أُلغيت الاستعادة'));
    for (const s of DATA_STORES) { const os = tx.objectStore(s); os.clear(); for (const r of (data[s] || [])) os.put(r); }
  });
}

export async function exportAll() { const o = {}; for (const s of DATA_STORES) o[s] = await getAll(s); return o; }

export async function deleteDatabase(name = _name) {
  try { _db?.close(); } catch { } _db = null;
  return new Promise((res, rej) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res(); });
}
export async function persist() { try { return await navigator.storage?.persist?.(); } catch { return false; } }
export async function usage() { try { const e = await navigator.storage?.estimate?.(); return e || null; } catch { return null; } }
