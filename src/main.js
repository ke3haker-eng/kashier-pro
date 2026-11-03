// نقطة الإقلاع: فتح قاعدة البيانات → ترحيل → تحميل → واجهة. أي فشل يظهر بشاشة واضحة مع سبل الإنقاذ (البيانات القديمة لا تُمسّ).
import * as db from './core/db.js';
import * as store from './core/store.js';
import * as auth from './core/auth.js';
import { runMigrations } from './core/migrate.js';
import { autoBackupIfDue } from './core/backup.js';
import { isDemo, dbNameFor, seedDemo } from './core/demo.js';
import { applyTheme, bootRoute } from './ui/shell.js';
import { toast, html, icon } from './ui/components.js';
import { esc, download } from './core/util.js';
import { readLegacy } from './core/migrate.js';

const root = document.getElementById('root');
const splash = (t, sub = '') => { root.innerHTML = `<div class="login"><div class="box center" style="gap:10px"><div class="skel" style="width:56px;height:56px;margin:0 auto;border-radius:16px"></div><h3>${esc(t)}</h3><div class="muted small">${esc(sub)}</div></div></div>`; };

function fatal(e) {
  console.error(e);
  const legacy = readLegacy();
  root.innerHTML = `<div class="login"><div class="box" style="gap:12px"><h3 class="bad">تعذّر تشغيل التطبيق</h3><div class="form-err">${esc(e.message || e)}</div>
  <div class="muted small" style="line-height:1.9">بياناتك لم تُحذف. جرّب: إعادة تحميل الصفحة، أو إغلاق أي نافذة أخرى للتطبيق، أو فتح التطبيق من متصفح آخر.${legacy ? ' بياناتك القديمة ما زالت محفوظة في المتصفح.' : ''}</div>
  <button class="btn primary" onclick="location.reload()">إعادة المحاولة</button>${legacy ? `<button class="btn" id="dl">تنزيل نسخة من البيانات القديمة</button>` : ''}</div></div>`;
  document.getElementById('dl')?.addEventListener('click', () => { const l = readLegacy(); const o = { P: JSON.parse(l.sh_p || '[]'), H: JSON.parse(l.sh_s || '[]'), T: JSON.parse(l.sh_t || '{}') }; download('shop-backup-legacy.json', JSON.stringify(o), 'application/json'); });
}

async function boot() {
  const demo = isDemo();
  try {
    splash('جاري التحميل...');
    await db.open(dbNameFor());
    await runMigrations({ legacy: !demo });
    await store.load();
    if (demo && store.count('products') === 0) { await seedDemo(m => splash('جاري تجهيز بيانات التجربة', m)); }
    applyTheme(); auth.restoreSession();
    db.persist();
    await bootRoute();
    if (!demo) setTimeout(() => autoBackupIfDue().catch(console.warn).then(() => import('./lib/sync.js')).then(m => m.autoPushIfDue()).catch(console.warn), 4000);
  } catch (e) { fatal(e); }
}

// تسجيل Service Worker وإدارة التحديث
if ('serviceWorker' in navigator) {
  const hadCtl = !!navigator.serviceWorker.controller; let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadCtl || reloading) return; reloading = true;
    if (document.querySelector('.ov')) toast('تم تحديث التطبيق — أعد تحميل الصفحة عند الانتهاء', 'warn', 8000); else { toast('تم تحديث التطبيق، جاري إعادة التحميل...', 'ok', 1500); setTimeout(() => location.reload(), 1200); }
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
}
window.addEventListener('unhandledrejection', e => { console.error(e.reason); });
// زر "تثبيت التطبيق" في الإعدادات يعتمد على هذا الحدث
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__kpInstall = e; });
window.addEventListener('appinstalled', () => { window.__kpInstall = null; });
boot();
