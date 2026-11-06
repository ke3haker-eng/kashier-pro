/* Service Worker — كاشير الدكان
   VERSION يتغيّر مع كل إصدار (يُحدَّث تلقائياً بواسطة scripts/build.mjs). الكاش القديم يُحذف عند التفعيل.
   - الملفات المحلية: تُخزَّن مسبقاً (precache) لتعمل دون إنترنت، مع تحديث في الخلفية (stale-while-revalidate).
   - التنقل: الشبكة أولاً ثم النسخة المخزّنة.
   - الخطوط/المكتبات الخارجية: تُخزَّن عند أول استخدام. */
const VERSION = 'kp-2.2.0';
const PRECACHE = ["./","css/app.css","css/store.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","manifest.json","src/config.js","src/core/analytics.js","src/core/auth.js","src/core/backup.js","src/core/calc.js","src/core/db.js","src/core/demo.js","src/core/migrate.js","src/core/ops.js","src/core/perms.js","src/core/remote.js","src/core/store.js","src/core/storewatch.js","src/core/util.js","src/lib/csv.js","src/lib/export.js","src/lib/image.js","src/lib/print.js","src/lib/scanner.js","src/lib/supabase.js","src/lib/sync.js","src/lib/xlsx.js","src/main.js","src/pages/customers.js","src/pages/dashboard.js","src/pages/expenses.js","src/pages/inventory.js","src/pages/invoices.js","src/pages/orders.js","src/pages/pos.js","src/pages/products.js","src/pages/purchases.js","src/pages/reports.js","src/pages/returns.js","src/pages/settings-cloud.js","src/pages/settings-shop.js","src/pages/settings.js","src/pages/staff.js","src/pages/suppliers.js","src/store/store.js","src/ui/charts.js","src/ui/cloud.js","src/ui/components.js","src/ui/display-ui.js","src/ui/display.js","src/ui/icons.js","src/ui/routes.js","src/ui/shell.js","src/ui/shift.js","src/version.js","store.html"];
const RUNTIME = 'kp-runtime';
const EXTERNAL = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net']; // الخطوط ومكتبة ZXing فقط

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(PRECACHE.map(async u => { try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r.ok) await c.put(u, r); } catch { } }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // واجهات الخادم (النسخ السحابي) لا تُخزَّن أبداً: بيانات حيّة ومحمية بمفتاح، وتخزينها يُظهر نسخة قديمة
  if (url.pathname.includes('/api/') || req.headers.has('authorization')) return;
  if (url.origin !== location.origin && !EXTERNAL.includes(url.hostname)) return; // لا نعترض إلا الخطوط والمكتبة المعروفة
  if (url.origin === location.origin) {
    if (req.mode === 'navigate' && /\/store\.html$/.test(url.pathname)) return;   // صفحة المشترين مستقلة: تُجلب من الشبكة دائماً ولا تُحفظ مكان index.html
    if (req.mode === 'navigate') {
      e.respondWith((async () => { try { const r = await fetch(req); const c = await caches.open(VERSION); c.put('index.html', r.clone()).catch(() => { }); return r; } catch { return (await caches.match('index.html')) || (await caches.match('./')) || Response.error(); } })());
      return;
    }
    e.respondWith((async () => {
      const c = await caches.open(VERSION), hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()).catch(() => { }); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }
  // خارجي (خطوط، ZXing): كاش أولاً ثم الشبكة مع حفظ
  e.respondWith((async () => {
    const c = await caches.open(RUNTIME), hit = await c.match(req); if (hit) return hit;
    try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()).catch(() => { }); return r; } catch { return hit || Response.error(); }
  })());
});
