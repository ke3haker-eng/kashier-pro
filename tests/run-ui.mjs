// اختبارات الواجهة الشاملة (End-to-End) على Chrome حقيقي ببيانات فارغة — بالنقر والكتابة الفعلية.
// السيناريوهات 1–17 هي نفسها المطلوبة في ملف المتطلبات (البند 22)، ثم اختبارات إضافية (E1…).
// التشغيل: node tests/run-ui.mjs      (يحتاج google-chrome و Node 22)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'غير متطابق'}: المتوقع ${JSON.stringify(b)} والفعلي ${JSON.stringify(a)}`); };
const near = (a, b, m) => { if (Math.abs(a - b) > 0.005) throw new Error(`${m || 'غير متطابق'}: المتوقع ${b} والفعلي ${a}`); };
const numOf = t => { const m = String(t).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : NaN; };

// ---------- نسخة معزولة من المشروع (لا نلمس الأصل) + توليد قائمة الكاش المسبق ----------
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-ui-root-'));
fs.cpSync(SRC, ROOT, { recursive: true, filter: s => !/[\\/](node_modules|data|\.git)([\\/]|$)/.test(s) });
execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { stdio: 'pipe' });

async function T(id, title, fn, p) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, title, ok: true, note: note || '', ms: Date.now() - t0 }); console.log(`✔ ${String(id).padEnd(3)} ${title}${note ? ' — ' + note : ''}`); }
  catch (e) {
    results.push({ id, title, ok: false, note: e.message, ms: Date.now() - t0 }); console.log(`✘ ${String(id).padEnd(3)} ${title} — ${e.message}`);
    try { if (p) await p.shot(`${SHOTS}/FAIL-${id}.png`); } catch { }
  }
  if (process.env.DEBUG && p) { try { console.log('   [debug] منتجات:', JSON.stringify(await p.eval(`K.store.list('products').map(x=>[x.name,x.barcode,x.price,x.stock])`))); } catch { } }
  if (process.env.STOP && String(id) === process.env.STOP) { await p?.close(); process.exit(0); }
}

const KINIT = `(async()=>{window.K={store:await import('/src/core/store.js'),ops:await import('/src/core/ops.js'),util:await import('/src/core/util.js'),an:await import('/src/core/analytics.js'),bk:await import('/src/core/backup.js'),auth:await import('/src/core/auth.js'),db:await import('/src/core/db.js')};return 1})()`;
async function boot(p, hash = '') { await p.goto('/index.html' + hash); await p.waitFor(`document.querySelector('.app')||document.querySelector('.login .keypad')`, 40000); await p.eval(KINIT); }

// ================= المتصفح الرئيسي: سطح المكتب، بيانات حقيقية فارغة =================
const p = await launch({ width: 1366, height: 800, root: ROOT });
const go = async r => { await p.eval(`location.hash='#/${r}'`); await sleep(500); };
const waitModal = async () => { await p.waitFor(`document.querySelector('.ov')`, 6000); await sleep(120); };
const waitNoModal = () => p.waitFor(`!document.querySelector('.ov')`, 8000);
const ev = e => p.eval(e);
const prod = name => ev(`K.store.list('products').find(p=>p.name===${JSON.stringify(name)})||null`);
const cartLS = () => ev(`JSON.parse(localStorage.getItem('kp_cart_kashier-pro')||'{"lines":[]}')`);
const cartTotal = async () => numOf(await ev(`document.querySelector('.cart-f .total-bar .tv')?.textContent||'NaN'`));
const today = () => ev(`K.util.todayKey()`);
const state = {};

try {
  await boot(p);

  // ---- 0) حالة البداية: لا بيانات وهمية ----
  await T(0, 'أول تشغيل: قاعدة فارغة بلا بيانات وهمية', async () => {
    const c = await ev(`({prod:K.store.count('products'),inv:K.store.count('invoices'),cust:K.store.count('customers'),demo:K.store.settings().demo,mode:localStorage.getItem('kp_mode')})`);
    eq([c.prod, c.inv, c.cust, !!c.demo, c.mode], [0, 0, 0, false, null], 'يجب ألا توجد بيانات');
    await p.waitFor(`/ابدأ|لا توجد|التجربة|فارغ/.test(document.getElementById('view')?.innerText||'')`, 8000).catch(() => { });   // الصفحة تُحمَّل كسولاً بعد ظهور الإطار
    const txt = await ev(`document.getElementById('view').innerText`); assert(/ابدأ|لا توجد|التجربة|فارغ/.test(txt), 'الصفحة الرئيسية لا تعرض حالة البداية: ' + txt.slice(0, 80));
    await p.shot(`${SHOTS}/ui-00-empty-home.png`); return 'لا منتجات ولا فواتير، ووضع التجربة غير مفعّل';
  }, p);

  // ---- 1) إضافة منتج جديد (نموذج حقيقي) ----
  await T(1, 'إضافة منتج جديد من نموذج المنتج', async () => {
    await ev(`K.ops.saveSettings({cur:'ج.م',name:'سوبر ماركت الاختبار'})`);
    await go('products'); await p.click('[data-act="new"]'); await waitModal();
    await p.fill('[name=name]', 'حليب المراعي 1 لتر'); await p.fill('[name=barcode]', '6281000123456'); await p.fill('[name=price]', '5.5'); await p.fill('[name=cost]', '4'); await p.fill('[name=stock]', '50'); await p.fill('[name=min]', '10');
    await p.click('.ov [data-ok]'); await waitNoModal();
    const a = await prod('حليب المراعي 1 لتر'); assert(a, 'لم يُحفظ المنتج');
    eq([a.price, a.cost, a.stock, a.min, a.unit, a.barcode, a.track], [5.5, 4, 50, 10, 'pc', '6281000123456', true], 'بيانات المنتج');
    const mv = await ev(`K.store.list('moves').filter(m=>m.pid===${JSON.stringify(a.id)}).map(m=>[m.type,m.qty,m.after])`); eq(mv, [['initial', 50, 50]], 'حركة الرصيد الافتتاحي');
    // منتج موزون بالكيلو
    await p.click('[data-act="new"]'); await waitModal();
    await p.fill('[name=name]', 'جبنة بيضاء'); await p.fill('[name=unit]', 'kg'); await p.fill('[name=code]', '101'); await p.fill('[name=price]', '40'); await p.fill('[name=cost]', '28'); await p.fill('[name=stock]', '20');
    await p.click('.ov [data-ok]'); await waitNoModal();
    const b = await prod('جبنة بيضاء'); assert(b && b.unit === 'kg' && b.stock === 20, 'المنتج الموزون');
    state.p1 = a.id; state.p2 = b.id; return '2 منتج (بالقطعة وبالكيلو) محفوظان مع حركة رصيد افتتاحي';
  }, p);

  // ---- 2) تسجيل باركود (يدوي/توليد داخلي) + منع التكرار ----
  await T(2, 'تسجيل باركود: توليد داخلي + منع تكرار الباركود', async () => {
    await p.click('[data-act="new"]'); await waitModal();
    await p.fill('[name=name]', 'شيبس بالجبن'); await p.click('.ov [data-gen]'); await sleep(200);
    const gen = await ev(`document.querySelector('.ov [name=barcode]').value`); assert(/^\d{8,13}$/.test(gen), 'لم يُولَّد باركود صالح: ' + gen);
    await p.fill('[name=price]', '2'); await p.fill('[name=cost]', '1.2'); await p.fill('[name=stock]', '3');
    await p.click('.ov [data-ok]'); await waitNoModal();
    const c = await prod('شيبس بالجبن'); assert(c && c.barcode === gen, 'لم يُحفظ الباركود المولَّد'); state.p3 = c.id; state.gen = gen;
    // محاولة تكرار باركود المنتج الأول
    const n0 = await ev(`K.store.count('products')`);
    await p.click('[data-act="new"]'); await waitModal(); await p.fill('[name=name]', 'منتج مكرر'); await p.fill('[name=barcode]', '6281000123456'); await p.fill('[name=price]', '1');
    await p.click('.ov [data-ok]'); await sleep(400);
    const err = await ev(`document.querySelector('.ov .form-err')?.textContent||''`); assert(/باركود|مستخدم|مكرر|موجود/.test(err), 'لم تظهر رسالة منع التكرار: ' + err);
    eq(await ev(`K.store.count('products')`), n0, 'لا يجب إضافة منتج بباركود مكرر'); await p.click('.ov [data-close]'); await waitNoModal();
    return `باركود مولَّد ${gen}، والتكرار مرفوض برسالة: «${err.slice(0, 40)}»`;
  }, p);

  // ---- 3) مسح الباركود وإضافة المنتج للفاتورة (ماسح خارجي = كتابة + Enter) ----
  await T(3, 'مسح الباركود وإضافة المنتج (مع دمج التكرار ورفض غير المسجّل)', async () => {
    await go('pos'); await p.waitFor(`document.querySelector('#q')`);
    await p.click('#q'); await p.type('6281000123456'); await p.enter(); await sleep(250);
    let c = await cartLS(); eq(c.lines.map(l => [l.pid, l.qty]), [[state.p1, 1]], 'السلة بعد المسح الأول');
    await p.type('6281000123456'); await p.enter(); await sleep(250);
    c = await cartLS(); eq(c.lines.map(l => [l.pid, l.qty]), [[state.p1, 2]], 'مسح نفس الباركود يزيد الكمية ولا يكرر السطر');
    await p.type('9999999999999'); await p.enter(); await sleep(400);
    const dlg = await ev(`document.querySelector('.ov')?.innerText||''`); assert(/غير مسجّل|غير موجود/.test(dlg), 'لم يظهر تنبيه الباركود غير المسجّل');
    await p.click('.ov [data-close]'); await waitNoModal(); c = await cartLS(); eq(c.lines.length, 1, 'الباركود غير المسجّل لا يضيف شيئاً');
    return 'سطر واحد بكمية 2 بعد مسحين، وغير المسجّل يعرض خيار إضافة منتج';
  }, p);

  // ---- 4) البيع بالقطعة ----
  await T(4, 'بيع منتج بالقطعة (زيادة/تقليل الكمية)', async () => {
    await p.click(`[data-a="pl"][data-id="${state.p1}"]`); await sleep(150); eq((await cartLS()).lines[0].qty, 3, 'بعد +');
    await p.click(`[data-a="mi"][data-id="${state.p1}"]`); await sleep(150); eq((await cartLS()).lines[0].qty, 2, 'بعد −');
    near(await cartTotal(), 11, 'إجمالي قطعتين × 5.5'); return '2 × 5.5 = 11';
  }, p);

  // ---- 5) البيع بالوزن (جرام) ----
  await T(5, 'بيع منتج بالوزن (إدخال بالجرام)', async () => {
    await p.click(`.pcard[data-pid="${state.p2}"]`); await waitModal();
    await p.fill('#wg', '750'); await sleep(150);
    const pr = numOf(await ev(`document.querySelector('.ov #wp').textContent`)); near(pr, 30, 'سعر 750 جم من 40/كجم');
    await p.click('.ov [data-ok]'); await waitNoModal(); await sleep(200);
    const l = (await cartLS()).lines.find(x => x.pid === state.p2); assert(l, 'لم يُضف الصنف الموزون'); near(l.qty, 0.75, 'الكمية بالكيلو'); near(await cartTotal(), 41, 'الإجمالي = 11 + 30');
    return '750 جم ← 0.75 كجم = 30';
  }, p);

  // ---- 6) حساب الخصم ----
  await T(6, 'حساب الخصم على صنف (10%) وانعكاسه على الإجمالي', async () => {
    await p.click(`[data-a="ld"][data-id="${state.p1}"]`); await waitModal();
    await p.fill('[name=type]', 'pct'); await p.fill('[name=value]', '10'); await p.click('.ov [data-ok]'); await waitNoModal(); await sleep(200);
    near(await cartTotal(), 39.9, 'الإجمالي بعد خصم 10% على سطر الحليب (11 → 9.9)'); return '11 − 1.1 + 30 = 39.9';
  }, p);

  // ---- 7 + 8) إنهاء الفاتورة نقداً وحساب الباقي ----
  await T(7, 'إنهاء الفاتورة نقداً', async () => {
    await p.click('[data-a="pay"]'); await waitModal(); await sleep(200);
    await p.fill('#rcv', '50'); await sleep(200);
    state.changeText = await ev(`document.querySelector('.ov #chg')?.textContent||''`);
    await p.click('.ov [data-ok]'); await p.waitFor(`document.querySelector('.ov .success')`, 8000);
    const inv = await ev(`K.store.list('invoices').slice(-1)[0]`); assert(inv, 'لم تُحفظ الفاتورة'); state.inv1 = inv;
    eq([inv.items.length, inv.status, inv.method], [2, 'done', 'cash'], 'بيانات الفاتورة'); near(inv.total, 39.9, 'إجمالي الفاتورة'); assert(/^INV-0*1$/.test(inv.no), 'رقم الفاتورة: ' + inv.no);
    await p.click('.ov [data-new]'); await waitNoModal(); eq((await cartLS()).lines.length, 0, 'السلة تُفرَّغ بعد البيع');
    return `الفاتورة ${inv.no} بإجمالي ${inv.total}`;
  }, p);
  await T(8, 'حساب الباقي النقدي', async () => {
    const inv = await ev(`K.store.get('invoices', ${JSON.stringify(state.inv1?.id)})`); near(inv.received, 50, 'المستلم'); near(inv.change, 10.1, 'الباقي');
    assert(numOf(state.changeText) === 10.1, 'الباقي المعروض في النافذة: ' + state.changeText); return `المستلم 50 − 39.9 = ${inv.change} (ظهر في الشاشة: ${state.changeText.trim()})`;
  }, p);

  // ---- 9) تحديث المخزون بعد البيع ----
  await T(9, 'تحديث المخزون بعد البيع + حركات المخزون', async () => {
    const a = await prod('حليب المراعي 1 لتر'), b = await prod('جبنة بيضاء'); near(a.stock, 48, 'مخزون الحليب'); near(b.stock, 19.25, 'مخزون الجبنة');
    const mv = await ev(`K.store.list('moves').filter(m=>m.type==='sale').map(m=>[m.pname,m.qty,m.before,m.after]).sort()`);
    eq(mv.length, 2, 'عدد حركات البيع'); const m1 = mv.find(m => m[0] === 'حليب المراعي 1 لتر'); eq(m1.slice(1), [-2, 50, 48], 'حركة الحليب');
    return 'الحليب 50→48 والجبنة 20→19.25 مع سجل حركة لكل منهما';
  }, p);

  // ---- 10) فاتورة شراء وتحديث المخزون (واجهة المشتريات الفعلية) ----
  await T(10, 'تسجيل فاتورة شراء من مورد وتحديث المخزون والتكلفة ورصيد المورد', async () => {
    await go('suppliers'); await p.click('[data-new]'); await waitModal(); await p.fill('[name=name]', 'مورد الألبان'); await p.fill('[name=phone]', '0501234567'); await p.click('.ov [data-ok]'); await waitNoModal();
    const sup = await ev(`K.store.list('suppliers')[0]`); assert(sup && sup.name === 'مورد الألبان', 'لم يُحفظ المورد'); state.sup = sup.id;
    await go('purchases'); await p.click('[data-new]'); await p.waitFor(`document.querySelector('#sup')`);
    await p.fill('#sup', state.sup); await p.click('#padd'); await p.type('6281000123456'); await p.enter(); await p.waitFor(`document.querySelector('[data-f="qty"]')`, 5000);
    await p.fill('[data-f="qty"]', '30'); await p.fill('[data-f="cost"]', '4.5'); await p.fill('#paid', '60'); await sleep(200);
    await p.click('[data-approve]'); await p.waitFor(`K.store.list('purchases').some(x=>x.status==='approved')`, 8000);
    const pu = await ev(`K.store.list('purchases')[0]`); near(pu.total, 135, 'إجمالي الشراء'); near(pu.paid, 60, 'المدفوع'); near(pu.due, 75, 'المتبقي');
    const a = await prod('حليب المراعي 1 لتر'); near(a.stock, 78, 'مخزون الحليب بعد الشراء'); near(a.cost, 4.5, 'تكلفة الحليب (آخر سعر شراء)');
    near(await ev(`K.store.supplierBalance(${JSON.stringify(state.sup)})`), 75, 'رصيد المورد');
    assert(await ev(`K.store.list('moves').some(m=>m.type==='purchase'&&m.qty===30)`), 'حركة الشراء');
    return `فاتورة ${pu.no}: 30 × 4.5 = 135 (مدفوع 60، المتبقي للمورد 75) والمخزون 48→78`;
  }, p);

  // ---- 11) حساب الربح بصورة صحيحة ----
  await T(11, 'حساب الربح: المبيعات ≠ الربح، تكلفة وقت البيع، المصروفات تُخصم', async () => {
    await go('expenses'); await p.click('[data-new]'); await waitModal(); await p.fill('[name=category]', 'rent'); await p.fill('[name=amount]', '3'); await p.fill('[name=note]', 'إيجار تجريبي'); await p.click('.ov [data-ok]'); await waitNoModal();
    const s = await ev(`K.an.summary(K.util.todayKey(), K.util.todayKey())`);
    near(s.sales, 39.9, 'المبيعات'); near(s.cogs, 29, 'تكلفة البضاعة المباعة (بتكلفة وقت البيع 4 و28 — لا تتأثر بسعر الشراء الجديد 4.5)'); near(s.grossProfit, 10.9, 'الربح الإجمالي'); near(s.expenses, 3, 'المصروفات'); near(s.netProfit, 7.9, 'صافي الربح');
    await go('reports'); await sleep(600); const txt = await ev(`document.getElementById('view').innerText`); assert(/39\.9/.test(txt) && /10\.9/.test(txt) && /7\.9/.test(txt), 'التقرير لا يعرض الأرقام الصحيحة');
    return 'مبيعات 39.9 − تكلفة 29 = ربح 10.9 − مصروف 3 = صافي 7.9 (وتظهر في صفحة التقارير)';
  }, p);

  // ---- 12) تنفيذ مرتجع ----
  await T(12, 'تنفيذ مرتجع من فاتورة (استرداد + إعادة للمخزون + أثر على الربح)', async () => {
    await go('returns'); await p.click('#q'); await p.type(state.inv1.no); await sleep(300); await p.click('[data-pick]'); await p.waitFor(`document.querySelector('[data-rq="0"]')`);
    const idx = await ev(`K.store.get('invoices', ${JSON.stringify(state.inv1.id)}).items.findIndex(l=>l.pid===${JSON.stringify(state.p1)})`);
    await p.fill(`[data-rq="${idx}"]`, '1'); await sleep(250); await p.click('[data-do]'); await p.waitFor(`K.store.count('returns')===1`, 8000);
    const r = await ev(`K.store.list('returns')[0]`); near(r.refund, 4.95, 'المبلغ المسترد (5.5 بعد خصم 10%)');
    const a = await prod('حليب المراعي 1 لتر'); near(a.stock, 79, 'المخزون بعد إعادة الوحدة');
    const s = await ev(`K.an.summary(K.util.todayKey(), K.util.todayKey())`); near(s.returns, 4.95, 'المرتجعات'); near(s.revenueNet, 34.95, 'صافي الإيراد'); near(s.cogs, 25, 'التكلفة بعد إرجاع وحدة سليمة'); near(s.netProfit, 6.95, 'صافي الربح بعد المرتجع');
    const inv = await ev(`K.store.get('invoices', ${JSON.stringify(state.inv1.id)})`); assert(inv.items[idx].returned === 1, 'سطر الفاتورة لا يعلّم الكمية المرتجعة');
    await p.shot(`${SHOTS}/ui-12-return.png`); return 'استرداد 4.95، المخزون 78→79، صافي الربح 7.9→6.95';
  }, p);

  // ---- 13) طباعة الفاتورة ----
  await T(13, 'طباعة الفاتورة: معاينة، مقاسات الورق، محتوى الطباعة', async () => {
    await p.eval(`location.hash='#/invoices?open=${state.inv1.id}'`); await waitModal(); await p.waitFor(`document.querySelector('.ov [data-prev]')`);
    await p.click('.ov [data-prev]'); await sleep(300);
    const prev = await ev(`document.querySelector('.ov:last-of-type .rcpt')?.innerText||''`);
    for (const t of [state.inv1.no, 'سوبر ماركت الاختبار', 'حليب المراعي 1 لتر', 'جبنة بيضاء', '39.9', '50', '10.1']) assert(prev.includes(t), 'المعاينة لا تحوي: ' + t);
    await p.shot(`${SHOTS}/ui-13-preview-80.png`);
    for (const paper of ['58', 'a4']) { await p.click(`.ov:last-of-type [data-paper="${paper}"]`); await sleep(150); const cls = await ev(`document.querySelector('.ov:last-of-type .rcpt').className`); assert(cls.includes(paper === 'a4' ? 'a4' : 'w58'), 'مقاس الورق لم يتغير: ' + cls); }
    await ev(`window.__pr=null;window.print=()=>{window.__pr=document.getElementById('print-root').innerHTML;window.__pg=document.getElementById('print-page').textContent}`);
    await p.click('.ov:last-of-type [data-pr]'); await p.waitFor(`window.__pr`, 5000);
    const printed = await ev(`window.__pr`), pg = await ev(`window.__pg`); assert(printed.includes(state.inv1.no) && printed.includes('39.9'), 'محتوى الطباعة ناقص'); assert(/@page/.test(pg), 'لا توجد قاعدة @page');
    return 'المعاينة (80/58/A4) وحاوية الطباعة تحوي رقم الفاتورة والأصناف والإجمالي والمستلم والباقي، مع @page للورق المختار';
  }, p);
  await ev(`document.querySelectorAll('.ov').forEach(o=>o.remove())`);

  // ---- 14) تصدير واستيراد نسخة احتياطية (تنزيل ملف فعلي + اختيار ملف فعلي) ----
  const DL = path.join(os.tmpdir(), 'kp-dl-' + Date.now());
  await T(14, 'تصدير نسخة احتياطية، مسح كل البيانات، ثم استيراد النسخة من الملف', async () => {
    await p.downloads(DL); await go('settings'); await p.click('[data-tab="backup"]'); await p.waitFor(`document.querySelector('[data-export]')`);
    const before = await ev(`Object.fromEntries(['products','invoices','purchases','suppliers','expenses','returns','moves'].map(n=>[n,K.store.count(n)]))`);
    await p.click('[data-export]'); await p.waitFor(`1`, 1000); let file; for (let i = 0; i < 50 && !file; i++) { await sleep(150); file = fs.existsSync(DL) && fs.readdirSync(DL).find(f => /^kashier-backup-.*\.json$/.test(f)); }
    assert(file, 'لم يُنزَّل ملف النسخة'); const full = path.join(DL, file), obj = JSON.parse(fs.readFileSync(full, 'utf8'));
    eq([obj.app, obj.format, typeof obj.checksum], ['kashier-pro', 1, 'string'], 'ترويسة النسخة'); eq(obj.counts.products, before.products, 'عدد المنتجات في الملف'); eq(obj.counts.invoices, 1);
    // مسح كل البيانات عبر زر منطقة الخطر
    await p.click('[data-reset]'); await waitModal(); await p.fill('[name=c]', 'مسح'); await p.click('.ov [data-ok]'); await waitNoModal(); await p.waitFor(`K.store.count('products')===0`, 8000);
    eq(await ev(`K.store.count('invoices')`), 0, 'الفواتير بعد المسح');
    // استيراد الملف عبر نافذة اختيار الملف الحقيقية
    await go('settings'); await p.click('[data-tab="backup"]'); await p.waitFor(`document.querySelector('[data-import]')`);
    await p.chooseFile(() => p.click('[data-import]'), full); await waitModal(); await sleep(600);
    const txt = await ev(`document.querySelector('.ov').innerText`); assert(/سليم/.test(txt), 'النسخة لم تُقبل: ' + txt.slice(0, 120));
    await p.click('.ov [data-ok]'); await p.waitFor(`K.store.count('products')===3`, 10000); await sleep(300);
    const after = await ev(`Object.fromEntries(['products','invoices','purchases','suppliers','expenses','returns','moves'].map(n=>[n,K.store.count(n)]))`); eq(after, before, 'الأعداد بعد الاستعادة');
    const a = await prod('حليب المراعي 1 لتر'); near(a.stock, 79, 'مخزون الحليب بعد الاستعادة'); near(a.cost, 4.5);
    const s = await ev(`K.an.summary(K.util.todayKey(), K.util.todayKey())`); near(s.netProfit, 6.95, 'صافي الربح بعد الاستعادة');
    assert((await ev(`K.bk.listSnapshots()`)).some(x => x.label === 'قبل المسح') && (await ev(`K.bk.listSnapshots()`)).some(x => x.label === 'قبل الاستعادة'), 'لقطات الأمان غير موجودة');
    state.backupFile = full; return `الملف ${file}: مُسحت البيانات ثم استُعيدت كاملة (${Object.entries(after).map(([k, v]) => k + '=' + v).join('، ')}) مع لقطتي أمان تلقائيتين`;
  }, p);
  await T('E8', 'رفض ملف نسخة تالف (فشل بصمة التحقق) دون تغيير البيانات', async () => {
    const obj = JSON.parse(fs.readFileSync(state.backupFile, 'utf8')); obj.data.products[0].price = 999; const bad = path.join(DL, 'bad.json'); fs.writeFileSync(bad, JSON.stringify(obj));
    await go('settings'); await p.click('[data-tab="backup"]'); await p.waitFor(`document.querySelector('[data-import]')`);
    await p.chooseFile(() => p.click('[data-import]'), bad); await waitModal(); await sleep(500);
    const txt = await ev(`document.querySelector('.ov').innerText`); assert(/تالف|سلامة/.test(txt), 'لم يُرفض الملف التالف: ' + txt.slice(0, 100)); assert(!(await ev(`!!document.querySelector('.ov [data-ok]')`)), 'زر الاستعادة يجب ألا يظهر');
    await p.click('.ov [data-close]'); await waitNoModal(); return 'الملف المعدَّل يدوياً مرفوض ولا يظهر زر الاستعادة';
  }, p);

  // ================= اختبارات إضافية على نفس البيانات =================
  await T('E1', 'منع بيع كمية أكبر من المخزون (مخزون سالب غير مسموح)', async () => {
    await go('pos'); await p.waitFor(`document.querySelector('#q')`);
    for (let i = 0; i < 4; i++) { await p.click(`.pcard[data-pid="${state.p3}"]`); await sleep(120); }
    eq((await cartLS()).lines.find(l => l.pid === state.p3).qty, 3, 'الكمية لا تتجاوز المتوفر (3)'); await p.click('[data-a="clear"]'); await waitModal(); await p.click('.ov [data-ok]'); await waitNoModal(); eq((await cartLS()).lines.length, 0, 'مسح الفاتورة');
    return 'الإضافة الرابعة رُفضت (المتوفر 3)';
  }, p);
  await T('E2', 'تعليق الفاتورة واستئنافها', async () => {
    await p.click('#q'); await p.type('6281000123456'); await p.enter(); await sleep(200); await p.click('[data-a="hold"]'); await waitModal(); await p.fill('[name=v]', 'زبون ينتظر'); await p.click('.ov [data-ok]'); await waitNoModal(); await sleep(250);
    eq((await cartLS()).lines.length, 0, 'السلة فارغة بعد التعليق'); eq(await ev(`K.store.count('holds')`), 1, 'فاتورة معلّقة واحدة');
    await p.click('[data-a="holds"]'); await waitModal(); await p.click('.ov [data-res]'); await waitNoModal(); await sleep(250);
    eq((await cartLS()).lines.map(l => l.pid), [state.p1], 'استعادة السطر'); eq(await ev(`K.store.count('holds')`), 0, 'حُذف التعليق بعد الاستئناف');
    await p.click('[data-a="clear"]'); await waitModal(); await p.click('.ov [data-ok]'); await waitNoModal(); return 'عُلّقت ثم استُؤنفت بنفس الأصناف';
  }, p);
  await T('E3', 'باركود الميزان (رمز الصنف + الوزن بالجرام)', async () => {
    await ev(`K.ops.saveSettings({pos:{scale:{on:true,prefix:'2',itemLen:5,valLen:5}}})`); await sleep(200);
    await p.click('#q'); await p.type('200101005000'); await p.enter(); await sleep(300);
    const l = (await cartLS()).lines.find(x => x.pid === state.p2); assert(l, 'لم يُضف الصنف'); near(l.qty, 0.5, 'الوزن 500 جم'); await p.click('[data-a="clear"]'); await waitModal(); await p.click('.ov [data-ok]'); await waitNoModal();
    await ev(`K.ops.saveSettings({pos:{scale:{on:false}}})`); return '200101005000 ← الصنف 101 بوزن 500 جم';
  }, p);
  await T('E4', 'حماية الحذف: منتج مرتبط بعمليات لا يُحذف (يُؤرشف)', async () => {
    const msg = await ev(`(async()=>{try{await K.ops.deleteProduct(${JSON.stringify(state.p1)});return 'deleted'}catch(e){return e.message}})()`); assert(/لا يمكن حذف/.test(msg), 'سُمح بالحذف: ' + msg);
    assert(await prod('حليب المراعي 1 لتر'), 'المنتج اختفى'); return msg.slice(0, 60);
  }, p);

  await T('E9', 'أزرار الشريط العلوي: المظهر (نقرة = خطوة واحدة) والتنبيهات، ولا يتأثر المظهر بالنقر العشوائي', async () => {
    await go('home'); const t0 = await ev(`K.store.settings().theme`); assert(t0 === 'auto', 'المظهر الابتدائي: ' + t0);
    await p.click('#h1'); await p.click('#view'); await p.click('.brand'); await sleep(300); eq(await ev(`K.store.settings().theme`), 'auto', 'النقر العشوائي غيّر المظهر');
    const seq = []; for (let i = 0; i < 3; i++) { await p.click('#themebtn'); await sleep(350); seq.push(await ev(`K.store.settings().theme`)); } eq(seq, ['light', 'dark', 'auto'], 'دورة المظهر');
    await p.click('[data-bell]'); await p.waitFor(`document.querySelector('.popover')`, 3000); await p.click('#h1'); await sleep(200);
    return 'auto → light → dark → auto بنقرة لكل خطوة، وزر التنبيهات يفتح القائمة';
  }, p);

  // ---- الصلاحيات + تسجيل الدخول + خصم يتجاوز الحد بموافقة المدير ----
  await T('E5', 'الموظفون وتسجيل الدخول والصلاحيات وموافقة المدير على الخصم الكبير', async () => {
    await go('staff'); await p.click('[data-new]'); await waitModal(); await p.fill('[name=name]', 'أحمد المدير'); await p.fill('[name=role]', 'manager'); await p.fill('[name=pin]', '1234'); await p.click('.ov [data-ok]'); await waitNoModal();
    await p.click('[data-new]'); await waitModal(); await p.fill('[name=name]', 'سارة الكاشير'); await p.fill('[name=role]', 'cashier'); await p.fill('[name=pin]', '5678'); await p.click('.ov [data-ok]'); await waitNoModal();
    eq(await ev(`K.store.list('users').map(u=>u.role).sort()`), ['cashier', 'manager'], 'المستخدمون');
    assert(!(await ev(`JSON.stringify(K.store.list('users')).includes('1234')||JSON.stringify(K.store.list('users')).includes('5678')`)), 'الرقم السري محفوظ نصاً!');
    await p.click('[data-enable]'); await waitModal(); await p.fill('[name=pin]', '9999'); await p.click('.ov [data-ok]'); await sleep(700);
    assert(/غير صحيح/.test(await ev(`document.querySelector('.ov .form-err')?.textContent||''`)), 'قُبل رقم سري خاطئ');
    await p.fill('[name=pin]', '1234'); await p.click('.ov [data-ok]'); await waitNoModal(); await p.waitFor(`K.store.settings().auth.enabled===true`, 5000);
    // تسجيل الخروج وإعادة التحميل ثم دخول الكاشير عبر لوحة الأرقام
    await ev(`K.auth.logout()`); await boot(p);
    assert(await ev(`!!document.querySelector('.login .keypad')`), 'لم تظهر شاشة الدخول');
    const sara = await ev(`K.store.list('users').find(u=>u.role==='cashier').id`);
    await p.click(`[data-u="${sara}"]`); for (const d of '9999') await p.click(`[data-k="${d}"]`); await p.click('[data-k="ok"]'); await sleep(600);
    assert(await ev(`!!document.querySelector('.login .form-err')`), 'قُبل رقم سري خاطئ للكاشير');
    await p.click(`[data-u="${sara}"]`); for (const d of '5678') await p.click(`[data-k="${d}"]`); await p.click('[data-k="ok"]'); await p.waitFor(`document.querySelector('.app')`, 8000);
    const nav = await ev(`[...document.querySelectorAll('#nav a')].map(a=>a.dataset.r)`); assert(nav.includes('pos') && !nav.some(r => ['reports', 'settings', 'expenses', 'purchases', 'suppliers'].includes(r)), 'قائمة الكاشير تحوي أقساماً غير مسموحة: ' + nav);
    await go('staff'); await sleep(400); eq(await ev(`[...document.querySelectorAll('#view .tabs button')].map(b=>b.dataset.tab)`), ['shifts'], 'الكاشير يرى تبويب الورديات فقط في صفحة الموظفين');
    await p.eval(`location.hash='#/reports'`); await sleep(500); assert(/ليست لديك صلاحية/.test(await ev(`document.getElementById('view').innerText`)), 'الكاشير دخل صفحة التقارير');
    await ev(`(async()=>{window.K.ops=await import('/src/core/ops.js')})()`);
    const denied = await ev(`(async()=>{try{await K.ops.saveExpense({amount:5,category:'other'});return 'allowed'}catch(e){return e.message}})()`); assert(denied !== 'allowed', 'الكاشير سجّل مصروفاً عبر الدالة مباشرة (الصلاحية لا تُفرض في الطبقة الأساسية)');
    // خصم 20% على الفاتورة (الحد 10%) ← يحتاج موافقة المدير
    await go('pos'); await p.waitFor(`document.querySelector('#q')`); await p.click('#q'); await p.type('6281000123456'); await p.enter(); await sleep(200);
    await p.click('[data-a="invdisc"]'); await waitModal(); await p.fill('[name=type]', 'pct'); await p.fill('[name=value]', '20'); await p.click('.ov [data-ok]'); await waitNoModal(); await sleep(200);
    await p.click('[data-a="pay"]'); await waitModal(); assert(/موافقة المدير/.test(await ev(`document.querySelector('.ov').innerText`)), 'لم تُطلب موافقة المدير');
    await p.fill('[name=pin]', '5678'); await p.click('.ov [data-ok]'); await sleep(700); assert(/غير صحيح|لا يملك/.test(await ev(`document.querySelector('.ov .form-err')?.textContent||''`)), 'رقم الكاشير نفسه قُبل كموافقة');
    await p.fill('[name=pin]', '1234'); await p.click('.ov [data-ok]'); await sleep(500); await p.waitFor(`document.querySelector('#rcv')`, 5000);
    await p.click('.ov [data-ok]'); await p.waitFor(`document.querySelector('.ov .success')`, 8000);
    const inv = await ev(`K.store.list('invoices').slice(-1)[0]`); near(inv.discount, 1.1, 'الخصم 20% من 5.5'); near(inv.total, 4.4, 'الإجمالي'); eq(inv.userName, 'سارة الكاشير', 'اسم الموظف على الفاتورة');
    assert(JSON.stringify(inv).includes('أحمد المدير'), 'الفاتورة لا تسجّل من وافق على الخصم'); await p.click('.ov [data-new]'); await waitNoModal();
    const au = await ev(`K.store.list('audit').filter(a=>a.action==='sale.create').slice(-1)[0]?.userName`); eq(au, 'سارة الكاشير', 'سجل العمليات');
    state.sara = sara; return 'الكاشير لا يرى التقارير/الإعدادات، وخصم 20% يحتاج PIN المدير (رقم الكاشير مرفوض)، والفاتورة تسجّل الموافِق، والـPIN مخزَّن مشفّراً';
  }, p);

  // ---- الورديات: نقدية متوقعة مقابل فعلية ----
  await T('E6', 'الوردية: إلزام الفتح قبل البيع، رصيد البداية، بيع نقدي، إغلاق بعدّ فعلي وحساب الفرق', async () => { let stg = 'start'; try {
    await ev(`K.ops.saveSettings({pos:{requireShift:true}})`); const n0 = await ev(`K.store.count('invoices')`);
    await go('pos'); await p.waitFor(`document.querySelector('#q')`); await p.click('#q'); await p.type('6281000123456'); await p.enter(); await sleep(200);
    stg = 'pay1'; await p.click('[data-a="pay"]'); await waitModal(); assert(/فتح وردية/.test(await ev(`document.querySelector('.ov').innerText`)), 'لم يُطلب فتح الوردية قبل البيع');
    eq(await ev(`K.store.count('invoices')`), n0, 'لا بيع قبل فتح الوردية');
    stg = 'open'; await p.fill('[name=cash]', '100'); await p.click('.ov [data-ok]'); await waitNoModal();
    const sh = await ev(`K.store.currentShift()`); assert(sh && sh.userName === 'سارة الكاشير' && sh.openingCash === 100, 'الوردية');
    stg = 'pay2'; await p.click('[data-a="pay"]'); await waitModal(); await p.click('.ov [data-ok]'); await p.waitFor(`document.querySelector('.ov .success')`, 8000); await p.click('.ov [data-new]'); await waitNoModal();
    const inv = await ev(`K.store.list('invoices').slice(-1)[0]`); eq(inv.shiftId, sh.id, 'الفاتورة مرتبطة بالوردية');
    stg = 'menu'; await p.click('[data-shift]'); await waitModal(); stg = 'cl'; await p.click('.ov [data-cl]'); await waitModal(); stg = 'close'; await sleep(200);
    const exp = numOf(await ev(`[...document.querySelectorAll('.ov .kv.big b')].map(b=>b.textContent)[0]`)); near(exp, 100 + inv.total, 'النقدية المتوقعة = رصيد البداية + نقد المبيعات');
    await p.fill('#counted', String(exp - 2)); await sleep(150); assert(/عجز/.test(await ev(`document.querySelector('.ov #diff').textContent`)), 'لم يظهر العجز');
    await p.click('.ov [data-ok]'); await p.waitFor(`K.store.list('shifts').some(s=>s.status==='closed')`, 6000);
    const cl = await ev(`K.store.list('shifts').find(s=>s.status==='closed')`); near(cl.diff, -2, 'الفرق'); near(cl.expected, exp);
    await ev(`document.querySelectorAll('.ov').forEach(o=>o.remove())`); return `البيع قبل فتح الوردية مرفوض؛ متوقع ${exp}، فعلي ${exp - 2}، عجز 2 — مسجّل في الوردية`;
    } catch (e) { throw new Error('[' + stg + '] ' + e.message); }
  }, p);
  await ev(`K.ops.saveSettings({auth:{enabled:false},pos:{requireShift:false}})`); await ev(`K.auth.logout()`);
  await boot(p);

  // ---- 17) الأحجام: موبايل / تابلت / كمبيوتر ----
  await T(17, 'العرض على الموبايل والتابلت والكمبيوتر: لا تمرير أفقي، التنقل المناسب لكل حجم', async () => {
    const R = ['home', 'pos', 'products', 'inventory', 'purchases', 'suppliers', 'customers', 'invoices', 'returns', 'expenses', 'reports', 'staff', 'settings'], out = [];
    for (const [name, w, h, mob] of [['mobile', 390, 844, true], ['tablet', 820, 1180, true], ['desktop', 1366, 800, false]]) {
      await p.viewport(w, h, mob); await sleep(300);
      for (const r of R) {
        await go(r); await sleep(450); const i = await ev(`({ov:document.documentElement.scrollWidth-document.documentElement.clientWidth, bnav:getComputedStyle(document.getElementById('bnav')).display, side:getComputedStyle(document.getElementById('side')).display, len:document.getElementById('view').innerText.length, err:/تعذّر تحميل هذه الصفحة/.test(document.getElementById('view').innerText)})`);
        assert(!i.err && i.len > 30, `${name}/${r}: الصفحة فارغة أو بها خطأ`); assert(i.ov <= 1, `${name}/${r}: تمرير أفقي ${i.ov}px`);
        if (['home', 'pos', 'products', 'reports', 'settings'].includes(r)) await p.shot(`${SHOTS}/ui-17-${name}-${r}.png`);
        if (name === 'mobile') assert(i.bnav !== 'none' && i.side === 'none', 'الموبايل يجب أن يعرض الشريط السفلي ويخفي الجانبي'); if (name === 'desktop') assert(i.side !== 'none' && i.bnav === 'none', 'الكمبيوتر يجب أن يعرض الشريط الجانبي');
      }
      out.push(name + ':' + R.length);
    }
    // سلة الموبايل: شريط السلة المصغّر ينفتح
    await p.viewport(390, 844, true); await go('pos'); await p.waitFor(`document.querySelector('#q')`); await p.click(`.pcard[data-pid="${state.p1}"]`); await sleep(300);
    assert(await ev(`!document.getElementById('minicart').hidden`), 'شريط السلة المصغّر لا يظهر'); await p.click('#minicart'); await sleep(300); assert(await ev(`document.getElementById('cart').classList.contains('open')`), 'السلة لا تنفتح'); await p.shot(`${SHOTS}/ui-17-mobile-cart.png`);
    await p.click('[data-a="clear"]'); await waitModal(); await p.click('.ov [data-ok]'); await waitNoModal(); await p.viewport(1366, 800, false);
    return '13 صفحة × 3 أحجام بلا تمرير أفقي أو أخطاء (' + out.join('، ') + ')';
  }, p);

  // ---- 15) تحديث التطبيق دون فقدان البيانات (Service Worker جديد) ----
  let beforeUpd;
  await T(15, 'تحديث التطبيق (إصدار Service Worker جديد) دون فقدان أي بيانات', async () => {
    await go('home'); await p.waitFor(`navigator.serviceWorker.controller`, 20000);
    const reg = await ev(`(async()=>{const r=await navigator.serviceWorker.getRegistration();return {active:!!r.active,keys:await caches.keys()}})()`); assert(reg.active && reg.keys.some(k => k === 'kp-2.2.0'), 'SW الإصدار الأول غير مفعّل: ' + JSON.stringify(reg));
    beforeUpd = await ev(`Object.fromEntries(K.db.DATA_STORES.map(n=>[n,K.store.count(n)==null?0:K.store.count(n)]))`).catch(() => null);
    beforeUpd = await ev(`(async()=>Object.fromEntries(await Promise.all(K.db.DATA_STORES.map(async n=>[n,(await K.db.getAll(n)).length]))))()`);
    const sum0 = await ev(`(async()=>JSON.stringify((await K.db.getAll('products')).map(p=>[p.id,p.stock,p.price,p.cost]).sort())+JSON.stringify((await K.db.getAll('invoices')).map(i=>[i.id,i.total]).sort()))()`);
    // نصدر نسخة جديدة: نغيّر VERSION في sw.js (كما يفعل scripts/build.mjs)
    const swp = path.join(ROOT, 'sw.js'); fs.writeFileSync(swp, fs.readFileSync(swp, 'utf8').replace("'kp-2.2.0'", "'kp-2.2.1'"));
    await ev(`navigator.serviceWorker.getRegistration().then(r=>r.update())`);
    await p.waitFor(`caches.keys().then(k=>k.includes('kp-2.2.1')&&!k.includes('kp-2.2.0'))`, 25000);
    await sleep(2500); // إعادة التحميل التلقائية بعد controllerchange
    await p.waitFor(`document.querySelector('.app')`, 20000); await p.eval(KINIT);
    const keys = await ev(`caches.keys()`); assert(!keys.includes('kp-2.2.0') && keys.includes('kp-2.2.1'), 'الكاش القديم لم يُحذف: ' + keys);
    const after = await ev(`(async()=>Object.fromEntries(await Promise.all(K.db.DATA_STORES.map(async n=>[n,(await K.db.getAll(n)).length]))))()`); eq(after, beforeUpd, 'عدد السجلات بعد التحديث');
    const sum1 = await ev(`(async()=>JSON.stringify((await K.db.getAll('products')).map(p=>[p.id,p.stock,p.price,p.cost]).sort())+JSON.stringify((await K.db.getAll('invoices')).map(i=>[i.id,i.total]).sort()))()`); eq(sum1, sum0, 'محتوى المنتجات والفواتير');
    const pre = await ev(`(async()=>{const c=await caches.open('kp-2.2.1');return (await c.keys()).length})()`); assert(pre > 40, 'الكاش المسبق للإصدار الجديد ناقص: ' + pre);
    return `kp-2.2.0 → kp-2.2.1: حُذف الكاش القديم، ${pre} ملفاً في الكاش الجديد، وكل السجلات والأرصدة كما هي`;
  }, p);

  // ---- 16) العمل دون إنترنت ----
  await T(16, 'العمل دون إنترنت: إيقاف الخادم ثم إعادة فتح التطبيق وإجراء عملية بيع', async () => {
    await p.stopServer(); await sleep(300);
    const net = await ev(`fetch('/__no_such_file__?'+Date.now(),{cache:'no-store'}).then(()=>'online',()=>'offline')`); eq(net, 'offline', 'الخادم لا يزال يستجيب');
    await p.goto('/index.html#/pos'); await p.waitFor(`document.querySelector('.app')`, 30000); await p.eval(KINIT);
    const n = await ev(`K.store.count('products')`); eq(n, 3, 'المنتجات بعد إعادة الفتح دون إنترنت'); const inv0 = await ev(`K.store.count('invoices')`);
    await p.waitFor(`document.querySelector('#q')`); await p.click('#q'); await p.type('6281000123456'); await p.enter(); await sleep(250); await p.click('[data-a="pay"]'); await waitModal(); await p.click('.ov [data-ok]'); await p.waitFor(`document.querySelector('.ov .success')`, 8000);
    eq(await ev(`K.store.count('invoices')`), inv0 + 1, 'عملية البيع دون إنترنت'); await p.click('.ov [data-new]'); await waitNoModal();
    for (const r of ['products', 'invoices', 'reports', 'settings']) { await go(r); await sleep(500); assert(!/تعذّر تحميل/.test(await ev(`document.getElementById('view').innerText`)), 'الصفحة ' + r + ' لم تُحمَّل دون إنترنت'); }
    await p.shot(`${SHOTS}/ui-16-offline.png`); return 'الصفحات تُحمَّل من الكاش، والبيع يُسجَّل محلياً دون خادم';
  }, p);
} catch (e) { console.log('FATAL', e.message); results.push({ id: 'FATAL', title: 'خطأ عام', ok: false, note: e.message }); }
finally { await p.close(); }

// ================= ترحيل بيانات التطبيق القديم (متصفح مستقل ببيانات localStorage قديمة) =================
const q = await launch({ width: 1366, height: 800, root: ROOT });
await T('E7', 'ترحيل بيانات التطبيق القديم من localStorage دون فقدان (ومفاتيح القديم تبقى)', async () => {
  await q.goto('/manifest.json');
  const old = { P: [{ id: 'a1', name: 'سكر 1 كجم', bc: '6281111111111', price: 6.5, u: 'pc' }, { id: 'a2', name: 'بصل', bc: '', price: 3, u: 'kg' }, { id: 'a3', name: 'رز', bc: '6281111111111', price: 9, u: 'pc' }], H: [{ id: 'h1', t: '2025-01-05T10:00:00.000Z', items: [{ name: 'سكر 1 كجم', total: 6.5, d: '' }, { name: 'بصل', total: 4.5, d: '1500 جم' }], total: 11 }], T: { name: 'دكان أبو أحمد', cur: 'ر.ي', theme: 'dark', vib: 1, snd: 0, once: 1 }, C: [{ id: 'a1', qty: 2 }, { id: 'a2', g: 500 }] };
  await q.eval(`localStorage.setItem('sh_p',${JSON.stringify(JSON.stringify(old.P))});localStorage.setItem('sh_s',${JSON.stringify(JSON.stringify(old.H))});localStorage.setItem('sh_t',${JSON.stringify(JSON.stringify(old.T))});localStorage.setItem('sh_c',${JSON.stringify(JSON.stringify(old.C))})`);
  await boot(q);
  const r = await q.eval(`(async()=>({prods:K.store.list('products').map(p=>[p.id,p.name,p.barcode,p.price,p.unit,p.track]),inv:K.store.list('invoices').map(i=>[i.no,i.total,i.legacy,i.items.length]),S:[K.store.settings().name,K.store.settings().cur,K.store.settings().theme,K.store.settings().snd,K.store.settings().once],cart:JSON.parse(localStorage.getItem('kp_cart_kashier-pro')||'null'),keys:['sh_p','sh_s','sh_t','sh_c'].map(k=>localStorage.getItem(k)!==null),raw:!!(await K.db.get('meta','legacy_localstorage'))}))()`);
  eq(r.prods.length, 3, 'عدد المنتجات'); eq(r.prods.map(x => x[1]), ['سكر 1 كجم', 'بصل', 'رز'], 'أسماء المنتجات'); eq(r.prods[1].slice(3, 5), [3, 'kg'], 'وحدة البصل'); eq(r.prods.map(x => x[2]), ['6281111111111', '', ''], 'الباركود المكرر يُفرغ بدل أن يكسر الترحيل'); assert(r.prods.every(x => x[5] === false), 'المنتجات القديمة يجب ألا تتتبّع المخزون');
  eq(r.inv, [['OLD-00001', 11, true, 2]], 'سجل المبيعات القديم'); eq(r.S, ['دكان أبو أحمد', 'ر.ي', 'dark', 0, 1], 'الإعدادات'); eq(r.cart?.lines?.map(l => [l.pid, l.qty]), [['a1', 2], ['a2', 0.5]], 'السلة المحفوظة (جرام→كجم)');
  eq(r.keys, [true, true, true, true], 'مفاتيح التطبيق القديم تبقى كما هي'); assert(r.raw, 'النسخة الخام للأمان');
  // لا تتكرر عند إعادة التحميل (idempotent)
  await boot(q); eq(await q.eval(`[K.store.count('products'),K.store.count('invoices')]`), [3, 1], 'الترحيل يتكرر عند إعادة الفتح!');
  // بيع فعلي بعد الترحيل لا يؤثر على سجل القديم ولا يحسب ربحاً وهمياً له
  const s = await q.eval(`K.an.summary('2025-01-01','2025-01-31')`); eq([s.invoices, s.sales, s.grossProfit, s.legacyCount], [1, 11, 0, 1], 'الفاتورة القديمة لا تُنتج ربحاً وهمياً');
  await q.shot(`${SHOTS}/ui-E7-migrated.png`); return '3 منتجات، فاتورة قديمة OLD-00001، الإعدادات والسلة، المكرر من الباركود، المفاتيح القديمة محفوظة، ولا ترحيل مكرر';
}, q);
await q.close();

// ================= الملخص =================
const pass = results.filter(r => r.ok).length, fail = results.length - pass;
const order = x => (typeof x.id === 'number' ? x.id : 100 + results.indexOf(x));
const md = ['# نتائج الاختبارات (الواجهة — Chrome حقيقي)', '', `تاريخ التشغيل: ${new Date().toISOString()}`, '', '| # | السيناريو | النتيجة | ملاحظات |', '|---|---|---|---|', ...results.slice().sort((a, b) => order(a) - order(b)).map(r => `| ${r.id} | ${r.title} | ${r.ok ? '✅ نجح' : '❌ فشل'} | ${String(r.note).replace(/\|/g, '/')} |`), '', `**الإجمالي: ${pass} نجح، ${fail} فشل من ${results.length}**`].join('\n');
fs.mkdirSync(path.join(SRC, 'docs'), { recursive: true }); fs.writeFileSync(path.join(SRC, 'docs', 'test-results-ui.md'), md);
console.log(`\n${fail ? '✘' : '✔'} ${pass}/${results.length} اختباراً نجحت${fail ? '، ' + fail + ' فشلت' : ''}`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
