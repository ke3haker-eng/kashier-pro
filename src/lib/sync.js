// النسخ الاحتياطي السحابي عبر الخادم المرجعي (server/server.mjs).
// ملاحظة صريحة: هذا رفع/استعادة لنسخة كاملة من البيانات (نسخ احتياطي خارج الجهاز) وليس مزامنة لحظية بين عدة أجهزة.
// لا يعمل شيء هنا إلا إذا شغّلت الخادم وأدخلت عنوانه ومفتاحه في الإعدادات → الخادم.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import { buildBackup, validateBackup } from '../core/backup.js';
import { now } from '../core/util.js';

const cfg = () => store.settings().sync;
export const configured = () => !!(cfg().url && cfg().key);
const base = () => cfg().url.trim().replace(/\/+$/, '');

async function call(path, { method = 'GET', body, timeout = 20000 } = {}) {
  if (!cfg().url) throw new Error('عنوان الخادم غير مضبوط');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(base() + path, { method, body, signal: ctl.signal, headers: { Authorization: 'Bearer ' + cfg().key, ...(body ? { 'Content-Type': 'application/json' } : {}) } });
    if (r.status === 401) throw new Error('مفتاح الوصول غير صحيح');
    if (r.status === 413) throw new Error('حجم النسخة أكبر من الحد المسموح في الخادم');
    if (!r.ok) throw new Error('خطأ من الخادم (' + r.status + ')');
    return r;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم');
    if (e instanceof TypeError) throw new Error('تعذّر الوصول إلى الخادم — تحقق من العنوان والاتصال (وأن العنوان https إن كان التطبيق على https)');
    throw e;
  } finally { clearTimeout(timer); }
}

export async function testConnection() {
  const h = await (await call('/api/health')).json();
  if (h.app !== 'kashier-pro') throw new Error('هذا العنوان ليس خادم كاشير');
  await call('/api/backups'); // يتحقق أيضاً من المفتاح
  return h;
}
export async function listRemote() { return (await (await call('/api/backups')).json()).items || []; }
export async function pushBackup() {
  const b = await buildBackup(); const r = await (await call('/api/backups', { method: 'POST', body: JSON.stringify(b), timeout: 120000 })).json();
  await ops.saveSettings({ sync: { lastPush: now() } }); return { ...r, counts: b.counts };
}
// يعيد كائن النسخة بعد التحقق منها؛ الاستعادة نفسها تتم بـ restoreBackup بعد تأكيد المستخدم
export async function pullBackup(id = 'latest') {
  const obj = await (await call('/api/backups/' + encodeURIComponent(id), { timeout: 120000 })).json();
  const v = await validateBackup(obj); if (!v.ok) throw new Error('النسخة من الخادم غير صالحة: ' + v.errors.join('، '));
  return { obj, check: v };
}
export async function deleteRemote(id) { await call('/api/backups/' + encodeURIComponent(id), { method: 'DELETE' }); }

// رفع تلقائي صامت عند فتح التطبيق إن كان مفعّلاً ومضى الفاصل (نفس فاصل النسخ المحلي)
export async function autoPushIfDue() {
  const s = store.settings(); if (!s.sync.enabled || !configured() || !navigator.onLine) return false;
  if (store.count('products') + store.count('invoices') === 0) return false;
  if (now() - (s.sync.lastPush || 0) < (s.backup.intervalH || 24) * 3600e3) return false;
  await pushBackup(); return true;
}
