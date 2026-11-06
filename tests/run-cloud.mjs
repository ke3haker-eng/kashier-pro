// اختبار الوضع السحابي (Supabase) من الواجهة إلى القاعدة: متصفحان حقيقيان (جهازان) ← HTTP ← بوابة محاكاة ← PostgreSQL 16 حقيقي بسكيمتنا.
// يغطي: الدخول والتسجيل وإنشاء المتجر والانضمام برمز، حفظ البيانات في القاعدة (لا في المتصفح)، المزامنة بين جهازين،
// بيع آخر قطعة من جهازين معاً، تعارض عدّاد الفواتير، انقطاع الاتصال وضياع الاستجابة، انتهاء الجلسة، صلاحيات الموظف على الخادم،
// نقل البيانات المحلية إلى السحابة والعودة، أخطاء الإعداد (مفتاح خاطئ/سكيمتا غير منفَّذة).
// حدود صريحة: الخادم بوابة محاكاة وليس Supabase نفسها، والمتصفح headless Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';
import { startMock } from './mock-supabase.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots'; fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [];
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''}: المتوقع ${JSON.stringify(b)} والفعلي ${JSON.stringify(a)}`); };
let shotP = null;
const T = async (id, t, fn) => { const t0 = Date.now(); try { const n = await fn(); res.push([id, t, true, n || '', Date.now() - t0]); console.log('✔', id, t, n ? '— ' + n : ''); } catch (e) { res.push([id, t, false, e.message, Date.now() - t0]); console.log('✘', id, t, '—', e.message); try { await shotP?.shot(`${SHOTS}/FAIL-cloud-${id}.png`); } catch { } } };

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-cloud-root-'));
fs.cpSync(SRC, ROOT, { recursive: true, filter: s => !/[\\/](node_modules|data|\.git)([\\/]|$)/.test(s) });
execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { stdio: 'pipe' });

const KINIT = `(async()=>{window.K={store:await import('/src/core/store.js'),ops:await import('/src/core/ops.js'),db:await import('/src/core/db.js'),sb:await import('/src/lib/supabase.js'),bk:await import('/src/core/backup.js')}})()`;
const mock = await startMock();
const num = sql => +mock.admin(sql);
const q1 = sql => mock.admin(sql);
const shopOf = email => q1(`select shop_id from kp_members where email='${email}'`);
const docs = (shop, store) => num(`select count(*) from kp_docs where shop_id='${shop}' and store='${store}' and not deleted`);
const sellExpr = (pid, qty = 1) => `(async()=>{try{const t=await K.ops.completeSale({cart:{lines:[{pid:'${pid}',qty:${qty},disc:null}],invDisc:null,customerId:'',note:''},payments:[{method:'cash',amount:1000}]});return {ok:t.no}}catch(e){return {err:e.message,code:e.code}}})()`;
const prodExpr = (name, price, stock, bc, unit = 'pc') => `K.ops.saveProduct({name:${JSON.stringify(name)},price:${price},cost:${price * 0.6},stock:${stock},unit:'${unit}',barcode:'${bc}'}).then(p=>p.id)`;

async function primeCloud(p) {            // يضبط الوضع السحابي ومفتاح المشروع قبل أول تحميل (جهاز جديد)
  await p.goto('/manifest.json');
  await p.eval(`localStorage.setItem('kp_backend','supabase');localStorage.setItem('kp_sb_cfg',${JSON.stringify(JSON.stringify({ url: mock.url, key: mock.anonKey }))});localStorage.setItem('kp_poll_ms','700')`);
}
const appReady = (p, ms = 40000) => p.waitFor(`document.querySelector('.app')`, ms);
async function signUp(p, email, pw = 'secret123') {
  await p.goto('/index.html'); await p.waitFor(`document.querySelector('#g_email')`, 30000);
  await p.fill('#g_email', email); await p.fill('#g_password', pw); await p.click('[data-up]'); await p.waitFor(`document.querySelector('[data-new]')`, 15000);
}

let A, B, C, D;
try {
  A = await launch({ root: ROOT }); B = await launch({ root: ROOT }); shotP = A;
  let shop1, pMilk, pBread, pWater, pJuice, pLast, codeA, userB;

  await T('C1', 'الجهاز A: شاشة الدخول ترفض كلمة مرور خاطئة وكلمة مرور قصيرة، ثم تسجيل مالك وإنشاء المتجر', async () => {
    await primeCloud(A); await A.goto('/index.html'); await A.waitFor(`document.querySelector('#g_email')`, 30000);
    await A.fill('#g_email', 'owner@shop.test'); await A.fill('#g_password', 'whatever1'); await A.click('[data-in]');
    await A.waitFor(`/البريد أو كلمة المرور غير صحيحة/.test(document.querySelector('.form-err')?.innerText||'')`, 10000);
    await A.fill('#g_password', '123'); await A.click('[data-up]'); await A.waitFor(`/8 أحرف/.test(document.querySelector('.form-err')?.innerText||'')`);
    await A.fill('#g_password', 'secret123'); await A.click('[data-up]'); await A.waitFor(`document.querySelector('[data-new]')`, 15000);
    await A.fill('#g_shop', 'سوبر الأمل'); await A.click('[data-new] button'); await appReady(A);
    shop1 = shopOf('owner@shop.test'); assert(shop1, 'لم يُنشأ المتجر في القاعدة');
    eq([q1(`select role from kp_members where email='owner@shop.test'`), q1(`select name from kp_shops where id='${shop1}'`)], ['owner', 'سوبر الأمل']);
    const lbl = await A.eval(`document.getElementById('netlbl').textContent`); assert(/متصل بالسحابة/.test(lbl), 'حالة الاتصال: ' + lbl);
    return 'حساب مالك + متجر في القاعدة، والشريط يعرض: ' + lbl;
  });

  await T('C2', 'البيانات تُحفظ في القاعدة (لا في المتصفح): إضافة منتجات ثم إعادة تحميل الصفحة', async () => {
    await A.eval(KINIT);
    pMilk = await A.eval(prodExpr('حليب المراعي', 5, 10, '6281000000011')); pBread = await A.eval(prodExpr('خبز', 2, 20, '6281000000012'));
    pWater = await A.eval(prodExpr('مياه', 1, 30, '6281000000013')); pJuice = await A.eval(prodExpr('عصير', 3, 30, '6281000000014'));
    eq(docs(shop1, 'products'), 4, 'المنتجات في القاعدة');
    await A.goto('/index.html'); await appReady(A); await A.eval(KINIT);
    eq(await A.eval(`K.store.count('products')`), 4, 'بعد إعادة التحميل');
    const dbs = await A.eval(`indexedDB.databases().then(l=>l.map(d=>d.name).sort())`);
    assert(!dbs.includes('kashier-pro'), 'أُنشئت قاعدة المتصفح المحلية للمنتجات: ' + dbs); return 'المنتجات الأربعة في Supabase والمتصفح لا يحتفظ ببياناتها (قواعد المتصفح: ' + dbs.join('، ') + ')';
  });

  await T('C3', 'بيع حقيقي من شاشة نقطة البيع (باركود ← دفع نقدي) يُحفظ في القاعدة ويخصم المخزون', async () => {
    await A.eval(`location.hash='#/pos'`); await A.waitFor(`document.querySelector('#q')`);
    await A.click('#q'); await A.type('6281000000011'); await A.enter(); await sleep(300);
    await A.click('[data-a="pay"]'); await A.waitFor(`document.querySelector('.ov')`); await sleep(200); await A.fill('#rcv', '10'); await sleep(150);
    await A.click('.ov [data-ok]'); await A.waitFor(`document.querySelector('.ov .success')`, 15000);
    await A.click('.ov [data-new]'); await sleep(300);
    eq(docs(shop1, 'invoices'), 1, 'فواتير القاعدة'); eq(q1(`select data->>'no' from kp_docs where shop_id='${shop1}' and store='invoices'`), 'INV-000001');
    eq(+q1(`select data->>'stock' from kp_docs where shop_id='${shop1}' and id='${pMilk}'`), 9, 'مخزون الحليب في القاعدة'); eq(docs(shop1, 'moves') >= 5, true, 'حركات المخزون'); return 'INV-000001 والمخزون 10→9 في القاعدة';
  });

  await T('C4', 'الجهاز B: تسجيل موظف والانضمام برمز المالك؛ يرى بيانات المتجر؛ الخادم يمنعه من كتابة المستخدمين', async () => {
    codeA = await A.eval(`K.sb.rpc('kp_me').then(m=>m.join_code)`); assert(codeA?.length === 20, 'رمز الانضمام');
    await primeCloud(B); await signUp(B, 'staff@shop.test');
    await B.fill('#g_code', 'WRONG-CODE'); await B.click('[data-join] button'); await B.waitFor(`/رمز الانضمام غير صحيح/.test(document.querySelector('.form-err')?.innerText||'')`);
    await B.fill('#g_code', codeA.toLowerCase().replace(/(.{4})/g, '$1-')); await B.click('[data-join] button'); await appReady(B);
    await B.eval(KINIT);
    eq([await B.eval(`K.store.count('products')`), await B.eval(`K.store.count('invoices')`)], [4, 1], 'بيانات المتجر على الجهاز B');
    eq(q1(`select role from kp_members where email='staff@shop.test'`), 'staff');
    assert(await B.eval(`!document.querySelector('#nav [data-r="settings"]')`), 'الموظف يرى الإعدادات');
    const r = await B.eval(`K.sb.rpc('kp_commit',{p_ops:{put:{users:[{id:'x',base:null,d:{id:'x',name:'x'}}]}}}).then(()=>'مسموح!',e=>e.code)`); eq(r, 'KP_FORBIDDEN', 'كتابة users من موظف');
    userB = await B.eval(`K.sb.session().user.id`); return 'موظف: يرى 4 منتجات وفاتورة، لا يرى الإعدادات، والخادم يرفض كتابة المستخدمين';
  });

  await T('C5', 'المزامنة الحيّة: بيع على A يظهر على B خلال ثوانٍ دون إعادة تحميل', async () => {
    const r = await A.eval(sellExpr(pMilk)); assert(r.ok, 'البيع فشل: ' + JSON.stringify(r)); eq(r.ok, 'INV-000002');
    await B.waitFor(`K.store.count('invoices')===2`, 10000); eq(await B.eval(`K.store.get('products','${pMilk}').stock`), 8, 'مخزون الحليب على B');
    return 'وصل البيع إلى B وتحدّث المخزون 9→8';
  });

  await T('C6', 'بيع آخر قطعة من جهازين في نفس اللحظة: ينجح واحد فقط، والآخر يُرفض برسالة المخزون (لا مخزون سالب ولا تكرار)', async () => {
    pLast = await A.eval(prodExpr('آخر قطعة', 7, 1, '6281000000015')); await B.waitFor(`K.store.get('products','${pLast}')`, 10000);
    const [ra, rb] = await Promise.all([A.eval(sellExpr(pLast)), B.eval(sellExpr(pLast))]);
    const oks = [ra, rb].filter(r => r.ok), bad = [ra, rb].filter(r => r.err);
    eq([oks.length, bad.length], [1, 1], 'نتائج: ' + JSON.stringify([ra, rb])); assert(/الكمية المتوفرة/.test(bad[0].err) && bad[0].code === 'STOCK', 'رسالة الرفض: ' + JSON.stringify(bad[0]));
    eq(+q1(`select data->>'stock' from kp_docs where shop_id='${shop1}' and id='${pLast}'`), 0, 'المخزون في القاعدة');
    await A.waitFor(`K.store.get('products','${pLast}').stock===0`, 8000); await B.waitFor(`K.store.get('products','${pLast}').stock===0`, 8000);
    return 'الفائز ' + oks[0].ok + '، والخاسر: «' + bad[0].err + '»';
  });

  await T('C7', 'عدّاد الفواتير تحت ضغط: 10 مبيعات متزامنة من جهازين (5 لكل جهاز) — كلها تنجح بأرقام فريدة متتالية', async () => {
    const before = docs(shop1, 'invoices'); const out = [];
    for (let i = 0; i < 5; i++) out.push(...await Promise.all([A.eval(sellExpr(pWater)), B.eval(sellExpr(pJuice))]));
    const bad = out.filter(r => !r.ok); eq(bad.length, 0, 'فشل بعضها: ' + JSON.stringify(bad)); eq(docs(shop1, 'invoices'), before + 10, 'عدد الفواتير');
    const nos = q1(`select string_agg(data->>'no', ',' order by data->>'no') from kp_docs where shop_id='${shop1}' and store='invoices'`).split(',');
    eq(new Set(nos).size, nos.length, 'أرقام فواتير مكررة'); eq(nos, nos.map((_, i) => 'INV-' + String(i + 1).padStart(6, '0')), 'الأرقام غير متتالية');
    eq([+q1(`select data->>'stock' from kp_docs where shop_id='${shop1}' and id='${pWater}'`), +q1(`select data->>'stock' from kp_docs where shop_id='${shop1}' and id='${pJuice}'`)], [25, 25], 'المخزون');
    return nos.length + ' فاتورة متتالية بلا تكرار (مع إعادة المحاولة التلقائية عند التعارض)';
  });

  await T('C8', 'ضياع الاستجابة بعد وصول العملية للخادم: إعادة الإرسال التلقائية لا تُنتج فاتورة مكررة', async () => {
    await A.eval(`K.db.refresh()`);   // آخر عملية على B قد لا تكون وصلت A بعد؛ نبدأ من بيانات محدّثة حتى يكون عدّ الطلبات حتمياً
    const before = docs(shop1, 'invoices'), c0 = mock.count('kp_commit'); mock.dropOnce.add('kp_commit');
    const r = await A.eval(sellExpr(pWater)); assert(r.ok, 'فشل: ' + JSON.stringify(r));
    eq(docs(shop1, 'invoices'), before + 1, 'فاتورة واحدة فقط'); eq(mock.count('kp_commit') - c0, 2, 'عدد طلبات الحفظ (الأول ضاع ردّه ثم أُعيد) — ' + JSON.stringify(mock.log.filter(l => l.fn === 'kp_commit').slice(c0).map(l => [l.status, !!l.dropped, l.ms]))); eq(+q1(`select data->>'stock' from kp_docs where shop_id='${shop1}' and id='${pWater}'`), 24, 'المخزون خُصم مرة واحدة');
    return 'طلبان للخادم، فاتورة واحدة ' + r.ok + '، والمخزون 25→24';
  });

  await T('C9', 'انقطاع الاتصال أثناء البيع: يظهر خطأ واضح وشارة «غير متصل»، وعند عودة الاتصال تُؤكَّد العملية تلقائياً مرة واحدة', async () => {
    const before = docs(shop1, 'invoices'); mock.offline = true;
    const r = await A.eval(sellExpr(pJuice)); eq(r.code, 'UNSURE', 'نتيجة: ' + JSON.stringify(r)); assert(/انقطع الاتصال/.test(r.err), r.err);
    assert(await A.eval(`!!localStorage.getItem('kp_pending_op')`), 'العملية المعلّقة لم تُحفظ'); await sleep(1500);
    const lbl = await A.eval(`document.getElementById('netlbl').textContent`); assert(/غير متصل بالسحابة/.test(lbl), 'الشارة: ' + lbl);
    eq(docs(shop1, 'invoices'), before, 'لا شيء حُفظ أثناء الانقطاع');
    mock.offline = false;
    await A.waitFor(`!localStorage.getItem('kp_pending_op')`, 15000); eq(docs(shop1, 'invoices'), before + 1, 'العملية المعلّقة نُفِّذت مرة واحدة');
    await A.waitFor(`/متصل بالسحابة/.test(document.getElementById('netlbl').textContent)`, 8000); await B.waitFor(`K.store.count('invoices')===${before + 1}`, 10000);
    return 'الخطأ: «' + r.err.slice(0, 60) + '…» ثم تأكّدت العملية بعد عودة الاتصال وظهرت على B';
  });

  await T('C10', 'انتهاء الجلسة: رمز منتهٍ (401) وتجديد تلقائي ثم إكمال البيع', async () => {
    const t0 = mock.log.filter(l => l.path === '/auth/v1/token').length; mock.expireTokens();
    const r = await A.eval(sellExpr(pBread)); assert(r.ok, JSON.stringify(r));
    assert(mock.log.filter(l => l.path === '/auth/v1/token').length > t0, 'لم يحدث تجديد للرمز');
    await A.eval(`(()=>{const s=JSON.parse(localStorage.kp_sb_session);s.expires_at=1;localStorage.kp_sb_session=JSON.stringify(s)})()`);   // انتهاء محلي قبل الإرسال
    const r2 = await A.eval(sellExpr(pBread)); assert(r2.ok, JSON.stringify(r2)); return 'تجديد بعد 401 وتجديد استباقي عند قرب الانتهاء — البيع نجح في الحالتين';
  });

  await T('C11', 'تفضيلات الجهاز (المظهر) لا تُشارَك ولا تُكتب في القاعدة', async () => {
    const c0 = mock.count('kp_commit'); await B.eval(`K.ops.saveSettings({theme:'dark'})`);
    eq(await B.eval(`K.store.settings().theme`), 'dark'); eq(await A.eval(`K.store.settings().theme`), 'auto', 'المظهر على A تغيّر');
    eq(mock.count('kp_commit'), c0, 'كُتب شيء في القاعدة'); assert(/dark/.test(await B.eval(`localStorage.kp_devprefs||''`))); return 'محفوظ في جهاز B فقط';
  });

  await T('C12', 'الاستعادة من نسخة احتياطية (مالك) تُحدِّث الجهاز الآخر', async () => {
    const bkp = await A.eval(`K.bk.buildBackup().then(b=>{window.__b=b;return b.counts.products})`); eq(bkp, 5, 'منتجات النسخة');
    await A.eval(prodExpr('منتج مؤقت', 1, 1, '6281000000099')); await B.waitFor(`K.store.count('products')===6`, 10000);
    await A.eval(`K.bk.restoreBackup(window.__b)`); eq(docs(shop1, 'products'), 5, 'القاعدة بعد الاستعادة');
    await B.waitFor(`K.store.count('products')===5`, 10000); await A.waitFor(`K.store.count('products')===5`, 5000);
    eq(await B.eval(`K.store.list('products').some(p=>p.name==='منتج مؤقت')`), false); return 'المنتج المؤقت اختفى من القاعدة ومن الجهازين';
  });

  await T('C13', 'إزالة موظف: يفقد الوصول فوراً ويُرفض حفظه', async () => {
    await A.eval(`K.sb.rpc('kp_remove_member',{p_user:'${userB}'})`);
    const r = await B.eval(`K.ops.saveCustomer({name:'زبون'}).then(()=>'تم',e=>e.message)`); assert(/غير مرتبط بمتجر/.test(r), 'الرد: ' + r); eq(docs(shop1, 'customers'), 0, 'كُتب زبون من حساب مُزال'); return 'الرد: ' + r;
  });

  await T('C14', 'نقل البيانات المحلية إلى السحابة من الإعدادات (جهاز جديد C): محلي ← حساب جديد ← متجر ← رفع ← العودة للمحلي', async () => {
    const before1 = [docs(shop1, 'products'), docs(shop1, 'invoices')];
    C = await launch({ root: ROOT }); shotP = C;
    await C.goto('/index.html'); await appReady(C); await C.eval(KINIT);
    await C.eval(prodExpr('بن', 40, 8, '6281000000021')); await C.eval(prodExpr('سكر', 15, 50, '6281000000022')); const p3 = await C.eval(prodExpr('أرز', 12, 30, '6281000000023'));
    await C.eval(`K.ops.saveCustomer({name:'أبو أحمد'})`); const sale = await C.eval(sellExpr(p3, 2)); eq(sale.ok, 'INV-000001', 'بيع محلي');
    await C.eval(`localStorage.setItem('kp_poll_ms','700')`);
    await C.eval(`location.hash='#/settings'`); await C.waitFor(`document.querySelector('[data-tab="cloud"]')`); await C.click('[data-tab="cloud"]');
    await C.waitFor(`document.querySelector('#cl_url')`); await C.fill('#cl_url', mock.url); await C.fill('#cl_key', mock.anonKey); await C.click('[data-cl-test]');
    await C.waitFor(`!document.querySelector('[data-cl-go]')?.disabled`, 10000); await C.click('[data-cl-go]'); await C.waitFor(`document.querySelector('.ov [data-ok]')`); await C.click('.ov [data-ok]');
    await C.waitFor(`document.querySelector('#g_email')`, 30000);
    await signUp(C, 'owner2@other.test'); await C.fill('#g_shop', 'متجر ثانٍ'); await C.click('[data-new] button'); await appReady(C);
    const shop2 = shopOf('owner2@other.test'); assert(shop2 && shop2 !== shop1, 'متجر ثانٍ');
    await C.waitFor(`/نقل بياناتك المحلية/.test(document.querySelector('.ov')?.innerText||'')`, 15000); await C.click('.ov [data-ok]');
    await sleep(800); await C.eval(KINIT); await C.waitFor(`K.store.count('products')===3`, 15000);
    eq([docs(shop2, 'products'), docs(shop2, 'invoices'), docs(shop2, 'customers')], [3, 1, 1], 'القاعدة بعد الرفع'); eq([docs(shop1, 'products'), docs(shop1, 'invoices')], before1, 'المتجر الأول تأثّر!');
    const nextNo = await C.eval(sellExpr(await C.eval(`K.store.list('products')[0].id`))); eq(nextNo.ok, 'INV-000002', 'العدّاد انتقل مع البيانات');
    const local = await C.eval(`K.db.readLocalDb('kashier-pro').then(d=>d&&[d.products.length,d.invoices.length])`); eq(local, [3, 1], 'القاعدة المحلية لم تُمَسّ');
    await C.eval(`location.hash='#/settings'`); await C.waitFor(`document.querySelector('[data-tab="cloud"]')`); await C.click('[data-tab="cloud"]'); await C.waitFor(`document.querySelector('[data-cl-local]')`);
    assert(await C.eval(`/${'رمز الانضمام'}/.test(document.body.innerText)`), 'لوحة المالك'); await C.click('[data-cl-local]'); await C.waitFor(`document.querySelector('.ov [data-ok]')`); await C.click('.ov [data-ok]');
    await appReady(C, 30000); await C.eval(KINIT); eq([await C.eval(`K.db.isRemote()`), await C.eval(`K.store.count('products')`), await C.eval(`K.store.count('invoices')`)], [false, 3, 1], 'بعد العودة للمحلي');
    return 'رُفع 3 منتجات وفاتورة وزبون، المتجر الأول لم يتأثر، والعدّاد استمر INV-000002، والعودة للمحلي أعادت البيانات القديمة';
  });

  await T('C15', 'أخطاء الإعداد: مفتاح خاطئ، مفتاح سرّي مرفوض، وسكيمتا غير منفَّذة تعطي رسالة واضحة', async () => {
    D = await launch({ root: ROOT }); shotP = D;
    await D.goto('/manifest.json'); await D.eval(`localStorage.setItem('kp_backend','supabase');localStorage.setItem('kp_sb_cfg',${JSON.stringify(JSON.stringify({ url: mock.url, key: 'wrong-key-' + 'y'.repeat(30) }))})`);
    await D.goto('/index.html'); await D.waitFor(`document.querySelector('#g_email')`, 30000); await D.fill('#g_email', 'owner@shop.test'); await D.fill('#g_password', 'secret123'); await D.click('[data-in]');
    await D.waitFor(`/مفتاح Supabase العام غير صحيح/.test(document.querySelector('.form-err')?.innerText||'')`, 10000);
    await D.eval(`localStorage.setItem('kp_sb_cfg',${JSON.stringify(JSON.stringify({ url: mock.url, key: mock.anonKey }))})`);
    const saved = mock.FN.kp_me; delete mock.FN.kp_me;
    await D.goto('/index.html'); await D.waitFor(`document.querySelector('#g_email')`, 30000); await D.fill('#g_email', 'owner@shop.test'); await D.fill('#g_password', 'secret123'); await D.click('[data-in]');
    await D.waitFor(`/schema\\.sql/.test(document.querySelector('.form-err')?.innerText||'')`, 15000); mock.FN.kp_me = saved;
    const k = await D.eval(`import('/src/lib/supabase.js').then(s=>[s.looksSecret('sb_secret_'+'a'.repeat(30)), s.looksSecret('h.'+btoa(JSON.stringify({role:'service_role'})).replace(/=+$/,'')+'.s'), s.looksSecret('h.'+btoa(JSON.stringify({role:'anon'})).replace(/=+$/,'')+'.s'), s.looksSecret('sb_publishable_'+'b'.repeat(30))])`);
    eq(k, [true, true, false, false], 'كشف المفاتيح السرّية'); return 'مفتاح خاطئ ← «مفتاح Supabase العام غير صحيح»، سكيمتا ناقصة ← رسالة schema.sql، ومفاتيح service_role/secret تُكتشف';
  });
} catch (e) { res.push(['خطأ عام', 'تشغيل الاختبارات', false, e.message, 0]); console.log('FATAL', e.stack || e.message); }
finally { for (const p of [A, B, C, D]) { try { await p?.close(); } catch { } } try { await mock.stop(); } catch { } fs.rmSync(ROOT, { recursive: true, force: true }); }

const bad = res.filter(r => !r[2]).length; console.log(`\n${bad ? '✘' : '✔'} ${res.length - bad}/${res.length} اختبار سحابي`);
fs.writeFileSync(path.join(SRC, 'docs', 'test-results-cloud.md'), ['# نتائج اختبار الوضع السحابي (Supabase)', '', `تاريخ التشغيل: ${new Date().toISOString()}`, '', 'التجهيز: متصفحان حقيقيان (جهازان) ← بوابة محاكاة لواجهتي GoTrue وPostgREST ← **PostgreSQL 16 حقيقي** عليه `supabase/schema.sql`.', '**لم يُختبر على مشروع Supabase حقيقي** (لا أملك حساباً)، فالطبقة الوحيدة غير المُختبرة هي خدمات Supabase نفسها (أنت أول من يجربها: انظر docs/SUPABASE.md).', '', '| # | الاختبار | النتيجة | ملاحظات |', '|---|---|---|---|', ...res.map(r => `| ${r[0]} | ${r[1]} | ${r[2] ? '✅' : '❌'} | ${String(r[3]).replace(/\|/g, '/')} |`), '', `**${res.length - bad} نجح، ${bad} فشل**`].join('\n'));
process.exit(bad ? 1 : 0);
