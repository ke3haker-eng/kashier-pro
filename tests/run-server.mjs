// اختبار الخادم المرجعي (server/server.mjs) فعلياً: الملفات الساكنة، الحماية، واجهة النسخ، ثم عميل المزامنة من داخل التطبيق في Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = []; const T = async (t, fn) => { try { const n = await fn(); res.push([t, true, n || '']); console.log('✔', t, n ? '— ' + n : ''); } catch (e) { res.push([t, false, e.message]); console.log('✘', t, '—', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-srv-')), PORT = 18700 + Math.floor(Math.random() * 200), KEY = 'test-key-' + Math.random().toString(36).slice(2);
const srv = spawn('node', [path.join(SRC, 'server/server.mjs')], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KASHIER_DATA: DATA, KASHIER_KEY: KEY, KASHIER_KEEP: '3' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => out += d);
for (let i = 0; i < 40 && !/يعمل/.test(out); i++) await sleep(100);
const B = `http://127.0.0.1:${PORT}`, H = { Authorization: 'Bearer ' + KEY };
const mini = (n = 1) => ({ app: 'kashier-pro', format: 1, schema: 1, exportedAt: new Date().toISOString(), counts: { products: n, invoices: 0 }, checksum: 'x', data: { products: Array.from({ length: n }, (_, i) => ({ id: 'p' + i })), meta: [] } });

try {
  await T('الخادم يعمل ويطبع مفتاح الوصول', async () => { assert(/يعمل/.test(out) && out.includes(KEY), out.slice(0, 200)); });
  await T('GET / يخدم التطبيق (index.html) مع ضغط gzip', async () => {
    const r = await fetch(B + '/', { headers: { 'accept-encoding': 'gzip' } }); assert(r.status === 200 && /text\/html/.test(r.headers.get('content-type')), 'status ' + r.status);
    assert(r.headers.get('content-encoding') === 'gzip', 'لا ضغط'); assert((await r.text()).includes('src/main.js'), 'ليس index.html');
    const j = await fetch(B + '/src/main.js'); assert(/javascript/.test(j.headers.get('content-type')), 'نوع JS'); assert((await fetch(B + '/sw.js')).headers.get('cache-control') === 'no-cache', 'sw.js يجب ألا يُخزَّن');
  });
  await T('حماية الملفات: server/ tests/ data/ package.json والملفات المخفية و..', async () => {
    for (const u of ['/server/server.mjs', '/tests/run-ui.mjs', '/data/key.txt', '/package.json', '/scripts/build.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd', '/src/../server/server.mjs', '/.git/config', '/docs/test-results-ui.md']) { const r = await fetch(B + u); assert(r.status === 404, `${u} → ${r.status}`); }
    return '10 مسارات ممنوعة كلها 404';
  });
  await T('/api/health متاح بلا مفتاح ولا يكشف بيانات', async () => { const j = await (await fetch(B + '/api/health')).json(); assert(j.ok && j.app === 'kashier-pro' && !JSON.stringify(j).includes(KEY), JSON.stringify(j)); });
  await T('رفض الوصول بلا مفتاح أو بمفتاح خاطئ (401)', async () => {
    assert((await fetch(B + '/api/backups')).status === 401, 'بلا مفتاح'); assert((await fetch(B + '/api/backups', { headers: { Authorization: 'Bearer wrong' } })).status === 401, 'خاطئ');
    assert((await fetch(B + '/api/backups', { method: 'POST', body: '{}' })).status === 401, 'POST بلا مفتاح');
  });
  let id1;
  await T('رفع نسخة صالحة ثم سردها واسترجاعها بنفس المحتوى', async () => {
    const r = await fetch(B + '/api/backups', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(mini(2)) }); assert(r.status === 201, 'status ' + r.status); const m = await r.json(); id1 = m.id;
    const l = await (await fetch(B + '/api/backups', { headers: H })).json(); assert(l.items.length === 1 && l.items[0].id === id1 && l.items[0].counts.products === 2, JSON.stringify(l));
    const g = await (await fetch(B + '/api/backups/' + id1, { headers: H })).json(); assert(g.data.products.length === 2, 'محتوى مختلف');
    const latest = await (await fetch(B + '/api/backups/latest', { headers: H })).json(); assert(latest.counts.products === 2, 'latest');
  });
  await T('رفض نسخة غير صالحة (JSON تالف / ليست من كاشير)', async () => {
    assert((await fetch(B + '/api/backups', { method: 'POST', headers: H, body: '{not json' })).status === 400, 'JSON تالف');
    assert((await fetch(B + '/api/backups', { method: 'POST', headers: H, body: JSON.stringify({ app: 'other', data: {} }) })).status === 400, 'تطبيق آخر');
  });
  await T('رفض مسارات تحوي معرّفاً خبيثاً', async () => { for (const id of ['..%2F..%2Fkey', 'a', '../x']) { const r = await fetch(B + '/api/backups/' + id, { headers: H }); assert(r.status === 404, id + ' → ' + r.status); } });
  await T('الاحتفاظ بآخر 3 نسخ فقط (الأقدم تُحذف)', async () => {
    for (let i = 0; i < 4; i++) { await sleep(1100); assert((await fetch(B + '/api/backups', { method: 'POST', headers: H, body: JSON.stringify(mini(3 + i)) })).status === 201); }
    const l = await (await fetch(B + '/api/backups', { headers: H })).json(); assert(l.items.length === 3, 'العدد ' + l.items.length); assert(!fs.existsSync(path.join(DATA, 'backups', id1 + '.json')), 'الملف القديم لم يُحذف');
  });
  await T('حذف نسخة', async () => { const l = await (await fetch(B + '/api/backups', { headers: H })).json(); const d = await fetch(B + '/api/backups/' + l.items[0].id, { method: 'DELETE', headers: H }); assert(d.status === 200); assert((await (await fetch(B + '/api/backups', { headers: H })).json()).items.length === 2); });
  await T('CORS (OPTIONS) يسمح بترويسة Authorization', async () => { const r = await fetch(B + '/api/backups', { method: 'OPTIONS' }); assert(r.status === 204 && /Authorization/.test(r.headers.get('access-control-allow-headers')), 'status ' + r.status); });
  await T('تقييد التخمين: بعد 10 محاولات خاطئة 429', async () => { let last; for (let i = 0; i < 12; i++) last = (await fetch(B + '/api/backups', { headers: { Authorization: 'Bearer bad' + i } })).status; assert(last === 429, 'آخر حالة ' + last); assert((await fetch(B + '/api/backups', { headers: H })).status === 429, 'يجب أن تُحجب حتى المحاولة الصحيحة مؤقتاً'); return 'يُحجب العنوان 10 دقائق'; });
} finally { srv.kill(); }

// ---- عميل المزامنة داخل التطبيق (Chrome) مع خادم ثانٍ نظيف (لتفادي حجب 429 أعلاه) ----
const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-srv2-')), PORT2 = PORT + 1;
const srv2 = spawn('node', [path.join(SRC, 'server/server.mjs')], { env: { ...process.env, PORT: String(PORT2), HOST: '127.0.0.1', KASHIER_DATA: DATA2, KASHIER_KEY: KEY }, stdio: 'ignore' });
await sleep(900);
const p = await launch({ width: 1366, height: 800, root: SRC });
try {
  await T('التطبيق من الخادم نفسه: اختبار اتصال، رفع، سرد، استعادة، ورفض مفتاح خاطئ', async () => {
    await p.eval(`void 0`); await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT2}/index.html` }); await sleep(2500); await p.waitFor(`document.querySelector('.app')`, 30000); await sleep(5000); // يمرّ مؤقّت الرفع التلقائي عند الإقلاع (4 ث) قبل تفعيل المزامنة
    await p.eval(`(async()=>{window.K={store:await import('/src/core/store.js'),ops:await import('/src/core/ops.js'),sync:await import('/src/lib/sync.js'),bk:await import('/src/core/backup.js')}})()`);
    await p.eval(`(async()=>{await K.ops.saveProduct({name:'منتج سحابي',price:3,cost:2,stock:7,barcode:'111222333'});await K.ops.saveSettings({sync:{enabled:true,url:'http://127.0.0.1:${PORT2}',key:'wrong'}})})()`);
    const bad = await p.eval(`K.sync.testConnection().then(()=>'ok',e=>e.message)`); assert(/مفتاح الوصول غير صحيح/.test(bad), 'مفتاح خاطئ: ' + bad);
    await p.eval(`K.ops.saveSettings({sync:{key:${JSON.stringify(KEY)}}})`);
    const t = await p.eval(`K.sync.testConnection().then(h=>h.app,e=>e.message)`); assert(t === 'kashier-pro', 'الاختبار: ' + t);
    const pushed = await p.eval(`K.sync.pushBackup().then(r=>r.counts.products,e=>e.message)`); assert(pushed === 1, 'الرفع: ' + pushed);
    assert((await p.eval(`K.store.settings().sync.lastPush`)) > 0, 'لم يُسجَّل وقت آخر رفع');
    // غيّر البيانات ثم استعد من الخادم
    await p.eval(`K.ops.saveProduct({name:'منتج جديد بعد الرفع',price:1,stock:1})`); assert((await p.eval(`K.store.count('products')`)) === 2);
    const list = await p.eval(`K.sync.listRemote()`); assert(list.length === 1, 'سرد النسخ: ' + JSON.stringify(list));
    const r = await p.eval(`(async()=>{const {obj,check}=await K.sync.pullBackup('latest');await K.bk.restoreBackup(obj);return [K.store.count('products'),K.store.list('products')[0].name,K.store.settings().sync.key===${JSON.stringify(KEY)}]})()`);
    assert(r[0] === 1 && r[1] === 'منتج سحابي', 'الاستعادة: ' + JSON.stringify(r)); assert(r[2] === true, 'مفتاح الخادم يجب أن يبقى بعد الاستعادة (إعداد خاص بالجهاز)');
    const file = fs.readdirSync(path.join(DATA2, 'backups')).find(f => /\.json$/.test(f) && !/meta/.test(f)); assert(!fs.readFileSync(path.join(DATA2, 'backups', file), 'utf8').includes(KEY), 'مفتاح الخادم تسرّب داخل ملف النسخة!');
    return 'الرفع والاستعادة عبر الخادم يعملان، والمفتاح لا يدخل في ملف النسخة ولا يُستبدل عند الاستعادة';
  });
  await T('الرفع التلقائي عند الفتح يحترم الفاصل الزمني', async () => {
    await p.eval(`K.ops.saveSettings({sync:{lastPush:Date.now()}})`); assert((await p.eval(`K.sync.autoPushIfDue()`)) === false, 'رُفعت نسخة قبل مرور الفاصل');
    await p.eval(`K.ops.saveSettings({sync:{lastPush:Date.now()-30*3600e3}})`); assert((await p.eval(`K.sync.autoPushIfDue()`)) === true, 'لم تُرفع نسخة بعد مرور 30 ساعة');
  });
} finally { await p.close(); srv2.kill(); }
const bad = res.filter(r => !r[1]).length; console.log(`\n${bad ? '✘' : '✔'} ${res.length - bad}/${res.length} اختبار خادم`);
const md = ['# نتائج اختبار الخادم', '', '| الاختبار | النتيجة | ملاحظات |', '|---|---|---|', ...res.map(r => `| ${r[0]} | ${r[1] ? '✅' : '❌'} | ${String(r[2]).replace(/\|/g, '/')} |`), '', `**${res.length - bad} نجح، ${bad} فشل**`].join('\n');
fs.writeFileSync(path.join(SRC, 'docs', 'test-results-server.md'), md); process.exit(bad ? 1 : 0);
