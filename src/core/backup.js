// النسخ الاحتياطي والاستعادة: تصدير كامل، تحقق قبل الاستيراد، نسخ تلقائي داخل IndexedDB، واستعادة ذرّية.
import * as db from './db.js';
import * as store from './store.js';
import { uid, nowISO, now, download, dayKey, deepMerge } from './util.js';
import { convertLegacy } from './migrate.js';
import { DEFAULT_SETTINGS } from './store.js';
import { can, who } from './auth.js';

export const APP_ID = 'kashier-pro';
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function buildBackup() {
  const data = await db.exportAll();
  const meta = {}; for (const r of data.meta) meta[r.k] = r.v;
  delete meta.legacy_localstorage; // يبقى في الجهاز فقط (حجمه كبير وغير لازم للنقل)
  if (meta.settings?.sync) meta.settings = { ...meta.settings, sync: { ...meta.settings.sync, key: '' } }; // مفتاح الخادم لا يدخل في ملفات النسخ
  data.meta = Object.entries(meta).map(([k, v]) => ({ k, v }));
  const body = JSON.stringify(data);
  return { app: APP_ID, format: 1, schema: 1, exportedAt: nowISO(), counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), checksum: await sha256(body), data };
}

export async function exportBackupFile() {
  const b = await buildBackup();
  download(`kashier-backup-${dayKey(now())}.json`, JSON.stringify(b), 'application/json');
  await markExport(); return b.counts;
}
async function markExport() { const s = store.settings(); await db.commit({ put: { meta: [{ k: 'settings', v: deepMerge(s, { backup: { lastExportAt: now() } }) }] }, del: {} }); }

// التحقق من ملف النسخة قبل أي استيراد. يرجع { ok, errors, warnings, kind, counts, backup? }
export async function validateBackup(obj) {
  const errors = [], warnings = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['الملف ليس نسخة احتياطية صالحة'], warnings };
  // نسخة التطبيق القديم: { P, H, T }
  if (Array.isArray(obj.P) && !obj.app) {
    const bad = obj.P.filter(p => !p || typeof p.name !== 'string').length;
    if (bad) warnings.push(`${bad} منتج بلا اسم سيتم تجاهله`);
    if (obj.H && !Array.isArray(obj.H)) errors.push('سجل المبيعات القديم غير صالح');
    return { ok: !errors.length, errors, warnings, kind: 'legacy', counts: { products: obj.P.length, invoices: (obj.H || []).length } };
  }
  if (obj.app !== APP_ID) return { ok: false, errors: ['هذا الملف ليس نسخة احتياطية من هذا التطبيق'], warnings };
  if (!obj.schema || obj.schema > 1) errors.push('النسخة أحدث من هذا الإصدار من التطبيق');
  if (!obj.data || typeof obj.data !== 'object') return { ok: false, errors: [...errors, 'بيانات النسخة مفقودة'], warnings };
  for (const s of db.DATA_STORES) {
    const arr = obj.data[s]; if (arr == null) { warnings.push('مخزن غير موجود في النسخة: ' + s); continue; }
    if (!Array.isArray(arr)) { errors.push('مخزن غير صالح: ' + s); continue; }
    const key = s === 'meta' ? 'k' : 'id'; const seen = new Set();
    for (const r of arr) { if (!r || r[key] == null) { errors.push(`سجل بلا معرّف في ${s}`); break; } if (seen.has(r[key])) { errors.push(`معرّف مكرر في ${s}`); break; } seen.add(r[key]); }
  }
  if (!errors.length) {
    for (const p of obj.data.products || []) if (typeof p.name !== 'string' || !(p.price >= 0)) { errors.push('منتج بسعر أو اسم غير صالح'); break; }
    for (const i of obj.data.invoices || []) if (!Array.isArray(i.items) || !isFinite(i.total)) { errors.push('فاتورة غير صالحة: ' + (i.no || i.id)); break; }
    const bcs = new Set(); for (const p of obj.data.products || []) if (p.barcode) { if (bcs.has(p.barcode)) { errors.push('باركود مكرر: ' + p.barcode); break; } bcs.add(p.barcode); }
  }
  if (obj.checksum) { const calc = await sha256(JSON.stringify(obj.data)); if (calc !== obj.checksum) errors.push('فشل التحقق من سلامة الملف (الملف تالف أو معدَّل)'); } else warnings.push('الملف بلا بصمة تحقق');
  return { ok: !errors.length, errors, warnings, kind: 'full', counts: obj.counts || Object.fromEntries(Object.entries(obj.data).map(([k, v]) => [k, v.length])), exportedAt: obj.exportedAt };
}

// يجهّز بيانات المخازن من أي نوع نسخة (جديدة أو قديمة)
function toStores(obj, kind) {
  if (kind === 'legacy') {
    const c = convertLegacy({ P: obj.P, H: obj.H || [], T: obj.T || {} });
    const o = Object.fromEntries(db.DATA_STORES.map(s => [s, []]));
    o.products = c.products; o.invoices = c.invoices;
    o.meta = [{ k: 'settings', v: c.settings }, { k: 'counters', v: {} }, { k: 'schema', v: { v: 1 } }];
    return o;
  }
  const o = Object.fromEntries(db.DATA_STORES.map(s => [s, obj.data[s] || []]));
  const keys = new Set(o.meta.map(m => m.k)); if (!keys.has('schema')) o.meta.push({ k: 'schema', v: { v: 1 } }); if (!keys.has('counters')) o.meta.push({ k: 'counters', v: {} });
  return o;
}

// استعادة كاملة (استبدال). تُنشأ لقطة أمان تلقائية للبيانات الحالية قبل الاستبدال.
export async function restoreBackup(obj) {
  if (!can('backup.manage')) throw new Error('الاستعادة تحتاج صلاحية المدير');
  const v = await validateBackup(obj); if (!v.ok) throw new Error(v.errors.join('، '));
  await snapshot('قبل الاستعادة'); // نسخة أمان
  const keepLegacy = (await db.get('meta', 'legacy_localstorage')); const data = toStores(obj, v.kind);
  if (keepLegacy) data.meta.push(keepLegacy);
  { // إعدادات الاتصال بالخادم وتسجيل الدخول تخصّ هذا الجهاز: لا تُستبدل بما في الملف
    const cur = store.settings(), sm = data.meta.find(m => m.k === 'settings');
    if (sm) sm.v = { ...sm.v, sync: { ...(sm.v.sync || {}), enabled: cur.sync.enabled, url: cur.sync.url, key: cur.sync.key } };
  }
  await db.replaceAll(data); await store.reloadAll();
  return v.counts;
}

// ---------- لقطات تلقائية داخل IndexedDB ----------
export async function snapshot(label = 'تلقائية') {
  const b = await buildBackup(); const json = JSON.stringify(b);
  const rec = { id: uid(), t: nowISO(), label, size: json.length, counts: b.counts, json };
  await db.commit({ put: { backups: [rec] }, del: {} });
  await prune(); return rec.id;
}
async function prune() {
  const keep = Math.max(1, store.settings().backup.keep || 7);
  const all = (await db.getAll('backups')).sort((a, b) => b.t.localeCompare(a.t));
  const auto = all.filter(x => x.label !== 'قبل الاستعادة' && x.label !== 'قبل المسح'); const safety = all.filter(x => !auto.includes(x));
  const del = [...auto.slice(keep), ...safety.slice(3)].map(x => x.id);
  if (del.length) await db.commit({ put: {}, del: { backups: del } });
}
export async function listSnapshots() { return (await db.getAll('backups')).map(({ json, ...r }) => r).sort((a, b) => b.t.localeCompare(a.t)); }
export async function restoreSnapshot(id) { const r = await db.get('backups', id); if (!r) throw new Error('اللقطة غير موجودة'); return restoreBackup(JSON.parse(r.json)); }
export async function downloadSnapshot(id) { const r = await db.get('backups', id); if (!r) throw new Error('اللقطة غير موجودة'); download(`kashier-snapshot-${dayKey(r.t)}.json`, r.json, 'application/json'); }
export async function deleteSnapshot(id) { await db.commit({ put: {}, del: { backups: [id] } }); }

// يُستدعى عند فتح التطبيق وبشكل دوري: ينشئ لقطة إن مضى الفاصل المحدد
export async function autoBackupIfDue() {
  const b = store.settings().backup; if (!b.auto) return false;
  const last = (await listSnapshots()).find(s => s.label === 'تلقائية');
  const due = !last || now() - Date.parse(last.t) > (b.intervalH || 24) * 3600e3;
  if (!due || store.count('products') + store.count('invoices') === 0) return false;
  await snapshot('تلقائية'); return true;
}

// ---------- عمليات خطرة (تأخذ لقطة أمان أولاً) ----------
export async function clearSalesHistory() {
  if (!can('backup.manage')) throw new Error('هذه العملية تحتاج صلاحية المدير');
  await snapshot('قبل المسح');
  await db.commit({ put: {}, del: {}, clear: ['invoices', 'returns', 'payments', 'moves', 'shifts', 'counts', 'holds'] });
  const c = { ...store.S.counters }; delete c.invoice; delete c.ret; await db.commit({ put: { meta: [{ k: 'counters', v: c }] }, del: {} });
}
export async function resetAllData() {
  if (!can('backup.manage')) throw new Error('هذه العملية تحتاج صلاحية المدير');
  await snapshot('قبل المسح');
  const keepLegacy = await db.get('meta', 'legacy_localstorage');
  const data = Object.fromEntries(db.DATA_STORES.map(s => [s, []]));
  data.meta = [{ k: 'schema', v: { v: 1 } }, { k: 'counters', v: {} }, { k: 'settings', v: deepMerge(structuredClone(DEFAULT_SETTINGS), { name: store.settings().name, cur: store.settings().cur, theme: store.settings().theme }) }];
  if (keepLegacy) data.meta.push(keepLegacy);
  await db.replaceAll(data); await store.reloadAll();
}
