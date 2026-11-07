// اختبار المتجر الإلكتروني من الواجهة إلى القاعدة: متصفح للبائع (سطح مكتب) وآخر للمشتري (جوال) ← HTTP ← بوابة محاكاة ← PostgreSQL 16 حقيقي.
// يغطي: نشر المتجر، ما يراه الزائر وما لا يراه (ولا يُحمَّل عنده أي كود إداري)، السلة والطلب وإشعار الدفع، وصول الطلب للبائع بالشارة والتنبيه،
// تغيير الحالة ووصوله للمشتري، إرسال الطلب لنقطة البيع كفاتورة معلّقة، المحادثة بالاتجاهين (نص وصورة)، إخفاء منتج، إيقاف المتجر، إعدادات الخط والواجهة.
// حدود صريحة: البوابة محاكاة لـ Supabase (وليست Supabase نفسها)، والمتصفح headless Chrome.
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
const T = async (id, t, fn) => { const t0 = Date.now(); try { const n = await fn(); res.push([id, t, true, n || '', Date.now() - t0]); console.log('✔', id, t, n ? '— ' + n : ''); } catch (e) { res.push([id, t, false, e.message, Date.now() - t0]); console.log('✘', id, t, '—', e.message); try { await S?.shot?.(path.join(SHOTS, `store-fail-${id}-buyer.png`)); await A?.shot?.(path.join(SHOTS, `store-fail-${id}-admin.png`)); } catch { } } };

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-store-root-'));
fs.cpSync(SRC, ROOT, { recursive: true, filter: s => !/[\\/](node_modules|data|\.git)([\\/]|$)/.test(s) });
execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { stdio: 'pipe' });
const KINIT = `(async()=>{window.K={store:await import('/src/core/store.js'),ops:await import('/src/core/ops.js'),db:await import('/src/core/db.js'),sb:await import('/src/lib/supabase.js'),disp:await import('/src/ui/display.js')}})()`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const mock = await startMock();
const q1 = sql => mock.admin(sql), num = sql => +mock.admin(sql);
const prodExpr = (name, price, stock, bc, extra = {}) => `K.ops.saveProduct(${JSON.stringify({ name, price, cost: price * 0.6, stock, unit: 'pc', barcode: bc, ...extra })}).then(p=>p.id)`;
const SHOP = 'amal-shop', STORE = `/store.html?s=${SHOP}&u=${encodeURIComponent(mock.url)}&k=${encodeURIComponent(mock.anonKey)}`;
const appReady = (p, ms = 40000) => p.waitFor(`document.querySelector('.app')`, ms);

let A, S, M, shop, ids = {}, order;
try {
  A = await launch({ root: ROOT }); S = await launch({ root: ROOT, width: 412, height: 860, mobile: true });
  await A.goto('/manifest.json');
  await A.eval(`localStorage.setItem('kp_backend','supabase');localStorage.setItem('kp_sb_cfg',${JSON.stringify(JSON.stringify({ url: mock.url, key: mock.anonKey }))});localStorage.setItem('kp_poll_ms','700')`);

  await T('S1', 'البائع: إنشاء المتجر والمنتجات والعرض، وتفعيل المتجر الإلكتروني من الإعدادات (النشر يحفظ الرابط في القاعدة)', async () => {
    await A.goto('/index.html'); await A.waitFor(`document.querySelector('#g_email')`, 30000);
    await A.fill('#g_email', 'owner@shop.test'); await A.fill('#g_password', 'secret123'); await A.click('[data-up]'); await A.waitFor(`document.querySelector('[data-new]')`, 15000);
    await A.fill('#g_shop', 'سوبر الأمل'); await A.click('[data-new] button'); await appReady(A); await A.eval(KINIT);
    shop = q1(`select shop_id from kp_members where email='owner@shop.test'`);
    ids.cat = await A.eval(`K.ops.saveCategory ? K.ops.saveCategory({name:'ألبان',color:'#0ea5e9'}).then(c=>c?.id||'') : ''`);
    ids.milk = await A.eval(prodExpr('حليب المراعي', 10, 50, '6281000000011', { img: PNG, desc: 'حليب طازج كامل الدسم' }));
    ids.cheese = await A.eval(prodExpr('جبنة شيدر', 20, 3, '6281000000012'));
    ids.rice = await A.eval(prodExpr('أرز بسمتي', 40, 100, '6281000000013', { unit: 'kg' }));
    ids.secret = await A.eval(prodExpr('منتج داخلي', 5, 9, '6281000000014', { online: false }));
    await A.eval(`K.ops.saveSettings({name:'سوبر الأمل',phone:'0112223344',cur:'ر.س',store:{title:'متجر الأمل الإلكتروني',about:'أفضل الأسعار',whatsapp:'966501234567',hours:'يومياً 8ص – 11م',notice:'لا توصيل يوم الجمعة',delivery:{pickup:true,home:true,fee:10,free_over:100,min:25,areas:'المركز'},pay:{cash:true,transfer:true,instructions:'حوّل على آيبان SA123 باسم الأمل'}}})`);
    await A.eval(`location.hash='#/settings?tab=shop'`); await A.waitFor(`document.querySelector('#shop_slug')`, 15000);
    await A.fill('#shop_slug', SHOP); await A.click('[data-shop-pub="1"]'); await A.waitFor(`/منشور ✓/.test(document.body.innerText)`, 15000);
    eq(q1(`select slug||':'||store_on from kp_shops where id='${shop}'`), `${SHOP}:true`);
    const link = await A.eval(`document.querySelector('[data-shop-copy]')?.dataset.shopCopy||''`); assert(/store\.html\?s=amal-shop&u=/.test(link), 'رابط المشترين: ' + link);
    return 'slug محفوظ والمتجر منشور، والرابط يتضمن الإعداد لأن config.js فارغ';
  });

  await T('S2', 'المشتري (جوال): يرى المتجر ومنتجاته المسموحة فقط؛ لا يظهر المخفي ولا التكلفة ولا كود إداري، والبحث والتصنيف يعملان', async () => {
    await S.goto(STORE); await S.waitFor(`document.querySelector('.pc')`, 20000);
    const t = await S.eval(`document.body.innerText`); assert(/متجر الأمل الإلكتروني/.test(t) && /أفضل الأسعار/.test(t) && /لا توصيل يوم الجمعة/.test(t), 'بيانات المتجر');
    assert(/حليب المراعي/.test(t) && /جبنة شيدر/.test(t) && /أرز بسمتي/.test(t), 'المنتجات'); assert(!/منتج داخلي/.test(t), 'منتج مخفي ظهر للمشتري');
    const html = await S.eval(`document.documentElement.outerHTML`); for (const bad of ['"cost"', 'supplierId', '6281000000011']) assert(!html.includes(bad), 'تسريب في الصفحة: ' + bad);
    const loaded = await S.eval(`performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname).filter(p=>/\\/src\\//.test(p))`);
    assert(loaded.every(p => /store\.js|supabase\.js|image\.js|config\.js/.test(p)), 'حُمّلت ملفات إدارية عند المشتري: ' + loaded); 
    await S.fill('#q', 'جبنه'); await sleep(250); eq(await S.eval(`document.querySelectorAll('.pc').length`), 1, 'بحث "جبنه" يطابق "جبنة" (تطبيع الهمزة/التاء المربوطة)');
    await S.fill('#q', ''); await sleep(150);
    await S.waitFor(`document.querySelector('.pc[data-p="${ids.milk}"] .im img')`, 8000);
    return 'يرى 3 منتجات من 4، لا تسريب، حُمّلت ' + loaded.length + ' ملفات فقط (store/supabase/image/config)، الصورة تُجلب عند الظهور';
  });

  await T('S3', 'السلة: كميات بالقطعة والكيلو، حد أدنى للطلب، توصيل مجاني فوق مبلغ، حفظ السلة عند إعادة التحميل', async () => {
    await S.click(`[data-q="${ids.cheese}:1"]`); await sleep(150); await S.click('[data-cart]'); await S.waitFor(`document.querySelector('.ov .err')`, 5000);
    assert(/الحد الأدنى للطلب/.test(await S.eval(`document.querySelector('.ov').innerText`)), 'رسالة الحد الأدنى'); assert(await S.eval(`document.querySelector('#send').disabled`), 'زر الإرسال يجب أن يُعطَّل تحت الحد الأدنى');
    await S.click('.ov [data-x]'); await sleep(150); await S.click(`[data-q="${ids.rice}:0.5"]`); await sleep(150); await S.click('[data-cart]'); await S.waitFor(`document.querySelector('#send')`);
    assert(!(await S.eval(`!!document.querySelector('.ov .err:not(#cerr)')`)), 'الحد الأدنى تحقق (40 ≥ 25)'); assert(/0\.5 كجم/.test(await S.eval(`document.querySelector('.ov').innerText`)), 'كمية الأرز بالكيلو');
    await S.click('.ov input[value="home"]'); await sleep(200); let t = await S.eval(`document.querySelector('.ov').innerText`); assert(/التوصيل/.test(t) && !/مجاني\s*\n?\s*الإجمالي/.test(t), 'رسوم التوصيل'); eq(await S.eval(`[...document.querySelectorAll('.ov .sumr b')].map(b=>b.innerText).pop()`), '50 ر.س', 'الإجمالي مع التوصيل 40+10');
    for (let i = 0; i < 4; i++) { await S.click(`.ov [data-q="${ids.rice}:0.5"]`); await sleep(120); }
    t = await S.eval(`document.querySelector('.ov').innerText`); assert(/مجاني/.test(t), 'التوصيل مجاني فوق 100'); eq(await S.eval(`[...document.querySelectorAll('.ov .sumr b')].map(b=>b.innerText).pop()`), '120 ر.س');
    await S.goto(STORE); await S.waitFor(`document.querySelector('.cb')`, 15000); assert(/2/.test(await S.eval(`document.querySelector('.cb').innerText`)), 'السلة محفوظة بعد إعادة التحميل');
    await S.eval(`localStorage.removeItem('kp_cart_${SHOP}')`); await S.goto(STORE); await S.waitFor(`document.querySelector('.pc')`); eq(await S.eval(`!!document.querySelector('.cb')`), false);
    return 'حد أدنى + توصيل (40→50) + مجاني (120) + حفظ السلة';
  });

  await T('S4', 'الطلب: بيانات المشتري + دفع بالتحويل مع صورة إشعار؛ يُحفظ في القاعدة بمجموع محسوب على الخادم والإشعار والمحادثة', async () => {
    await S.eval(`window.__kpPickFile=async()=>new File([await (await fetch(${JSON.stringify(PNG)})).blob()],'p.png',{type:'image/png'})`);
    await S.click(`[data-q="${ids.milk}:1"]`); await sleep(120); await S.click(`.pc[data-p="${ids.milk}"] [data-q="${ids.milk}:1"]`); await S.click(`[data-q="${ids.cheese}:1"]`); await S.click(`[data-q="${ids.rice}:0.5"]`); await sleep(150);
    await S.click('[data-cart]'); await S.waitFor(`document.querySelector('#send')`);
    await S.fill('.ov [name=name]', 'خالد المشتري'); await S.fill('.ov [name=phone]', '0501234567'); await S.click('.ov input[value="transfer"]'); await sleep(200);
    assert(/آيبان SA123/.test(await S.eval(`document.querySelector('.ov').innerText`)), 'تعليمات التحويل تظهر'); await S.click('.ov [data-proof]'); await S.waitFor(`document.querySelector('.ov img.proof')`, 8000);
    await S.fill('.ov [name=note]', 'اتصلوا قبل الوصول'); await S.click('#send'); await S.waitFor(`/تم استلام طلبك/.test(document.querySelector('.ov')?.innerText||'')`, 15000);
    const done = await S.eval(`document.querySelector('.ov').innerText`); assert(/رقم\s*1/.test(done), 'رقم الطلب: ' + done);
    eq(q1(`select no||'|'||name||'|'||phone||'|'||delivery||'|'||pay||'|'||total||'|'||status||'|'||(proof is not null) from kp_orders where shop_id='${shop}'`), '1|خالد المشتري|0501234567|pickup|transfer|60.00|new|true', 'الطلب في القاعدة');
    eq(q1(`select unread_shop||'|'||name from kp_threads where shop_id='${shop}'`), '1|خالد المشتري', 'المحادثة أُنشئت');
    await S.shot(path.join(SHOTS, 'store-buyer-done.png')); await S.click('.ov [data-x]'); return 'طلب #1 = 60 (محسوب على الخادم) + إشعار دفع + ملاحظة';
  });

  await T('S5', 'البائع: يصله تنبيه وشارة بالطلب الجديد، يعرض الطلب وإشعار الدفع، ويؤكده مع رسالة للمشتري', async () => {
    await A.waitFor(`[...document.querySelectorAll('[data-cnt=orders]')].some(e=>!e.hidden&&+e.textContent>=1)`, 25000);
    await A.eval(`location.hash='#/orders'`); await A.waitFor(`document.querySelector('[data-o]')`, 15000);
    assert(/خالد المشتري/.test(await A.eval(`document.querySelector('[data-o]').innerText`)) && /إشعار دفع/.test(await A.eval(`document.querySelector('[data-o]').innerText`)), 'بطاقة الطلب');
    await A.click('[data-o]'); await A.waitFor(`document.querySelector('.ov [data-proof]')`); const mt = await A.eval(`document.querySelector('.ov').innerText`);
    assert(/حليب المراعي/.test(mt) && /جبنة شيدر/.test(mt) && /أرز بسمتي/.test(mt) && /اتصلوا قبل الوصول/.test(mt) && /الدفع بالتحويل/.test(mt), 'تفاصيل الطلب');
    await A.click('.ov [data-proof]'); await A.waitFor(`document.querySelector('#proofbox img')?.src?.startsWith('data:image')`, 10000);
    await A.fill('#snote', 'سيجهز خلال ساعة'); await A.click('.ov [data-st="confirmed"]'); await sleep(800);
    eq(q1(`select status||'|'||shop_note from kp_orders where shop_id='${shop}'`), 'confirmed|سيجهز خلال ساعة'); return 'تنبيه وشارة + عرض الإشعار + تأكيد الطلب';
  });

  await T('S6', 'المشتري: يرى الحالة الجديدة وملاحظة البائع في «طلباتي» ورسالة النظام في المحادثة', async () => {
    await S.click('[data-orders]'); await S.waitFor(`/تم التأكيد/.test(document.querySelector('.ov')?.innerText||'')`, 10000);
    const t = await S.eval(`document.querySelector('.ov').innerText`); assert(/سيجهز خلال ساعة/.test(t) && /تم إرسال إشعار الدفع/.test(t), 'تفاصيل «طلباتي»: ' + t); await S.click('.ov [data-x]');
    await S.click('[data-chat]'); await S.waitFor(`/تم تأكيد طلبك/.test(document.querySelector('#chat')?.innerText||'')`, 12000); await S.click('.ov [data-x]'); return 'الحالة + الملاحظة + إشعار الدفع + رسالة النظام';
  });

  await T('S7', 'البائع: «إرسال إلى نقطة البيع» ينشئ فاتورة معلّقة بالمنتجات والكميات وزبوناً بنفس الجوال', async () => {
    await A.click('[data-o]'); await A.waitFor(`document.querySelector('.ov [data-pos]')`); await A.click('.ov [data-pos]'); await sleep(1200);
    eq(await A.eval(`K.store.count('holds')`), 1, 'فواتير معلّقة'); const h = await A.eval(`K.store.list('holds')[0]`);
    eq(h.cart.lines.map(l => l.qty).sort(), [0.5, 1, 2], 'كميات الأسطر'); assert(/طلب أونلاين #1/.test(h.name) && /0501234567/.test(h.cart.note), 'اسم/ملاحظة الفاتورة المعلّقة');
    assert(h.cart.customerId && (await A.eval(`K.store.get('customers','${h.cart.customerId}')?.phone`)) === '0501234567', 'الزبون');
    eq(q1(`select hold_id from kp_orders where shop_id='${shop}'`), h.id, 'ربط الطلب بالمعلّقة'); return 'فاتورة معلّقة بـ 3 أسطر + زبون جديد + ربط';
  });

  await T('S8', 'المحادثة: رسالة من المشتري تصل البائع (شارة + محادثة)، ورد البائع والصورة يصلان المشتري وهو في المحادثة', async () => {
    await S.click('[data-chat]'); await S.waitFor(`document.querySelector('#msg')`); await S.click('#msg'); await S.type('هل الحليب طازج اليوم؟'); await S.click('[data-chat-send]');
    await S.waitFor(`/هل الحليب طازج/.test(document.querySelector('#chat')?.innerText||'')`, 10000); eq(q1(`select unread_shop from kp_threads where shop_id='${shop}'`), '2', 'غير مقروء (الطلب + الرسالة)');
    await A.eval(`location.hash='#/orders'`); await A.waitFor(`document.querySelector('[data-tab=chat]')`); await A.click('[data-tab=chat]'); await A.waitFor(`document.querySelector('[data-t]')`, 10000);
    assert(/خالد المشتري/.test(await A.eval(`document.querySelector('[data-t]').innerText`)), 'المحادثة في القائمة'); await A.click('[data-t]'); await A.waitFor(`/هل الحليب طازج/.test(document.querySelector('#cb')?.innerText||'')`, 10000);
    await A.click('#msg'); await A.type('نعم طازج وصل صباحاً'); await A.click('[data-send]');
    await S.waitFor(`/نعم طازج وصل صباحاً/.test(document.querySelector('#chat')?.innerText||'')`, 15000);
    await S.eval(`window.__kpPickFile=async()=>new File([await (await fetch(${JSON.stringify(PNG)})).blob()],'q.png',{type:'image/png'})`); await S.click('[data-chat-img]');
    await A.waitFor(`document.querySelector('#cb img[data-mi]')?.src?.startsWith('data:image')`, 15000);
    eq(q1(`select unread_shop from kp_threads where shop_id='${shop}'`), '0', 'قراءة البائع صفّرت العدّاد'); await S.shot(path.join(SHOTS, 'store-buyer-chat.png')); await S.click('.ov [data-x]');
    return 'نص ذهاباً وإياباً + صورة من المشتري للبائع';
  });

  await T('S12', 'المشتري: زر الوضع الليلي/النهاري يبدّل يدوياً، ويُحفظ بعد إعادة التحميل، ويغيّر الألوان فعلاً', async () => {
    await S.goto(STORE); await S.waitFor(`document.querySelector('[data-theme-btn]')`, 15000);
    const bg = () => S.eval(`getComputedStyle(document.body).backgroundColor`), th = () => S.eval(`document.documentElement.getAttribute('data-theme')`);
    const light = await bg(), lbl0 = await S.eval(`document.querySelector('[data-theme-btn]').getAttribute('aria-label')`); eq(await th(), null, 'الافتراضي يتبع الجهاز');
    await S.click('[data-theme-btn]'); eq(await th(), 'dark'); const dark = await bg(); assert(dark !== light, 'الخلفية يجب أن تتغيّر'); const lbl1 = await S.eval(`document.querySelector('[data-theme-btn]').getAttribute('aria-label')`); assert(lbl0 !== lbl1, 'تسمية الزر تتبدّل');
    await S.shot(path.join(SHOTS, 'store-buyer-dark.png'));
    await S.goto(STORE); await S.waitFor(`document.querySelector('[data-theme-btn]')`, 15000); eq(await th(), 'dark', 'يُحفظ بعد إعادة التحميل'); eq(await bg(), dark, 'نفس الخلفية الليلية بعد التحميل');
    await S.click('[data-theme-btn]'); eq(await th(), 'light'); eq(await bg(), light, 'عودة للنهاري');
    await S.goto(STORE); await S.waitFor(`document.querySelector('[data-theme-btn]')`, 15000); eq(await th(), 'light', 'اختيار النهاري يُحفظ أيضاً');
    await S.eval(`localStorage.removeItem('kp_store_theme')`); return 'تبديل يدوي ليلي ↔ نهاري، محفوظ بعد التحميل، وألوان مختلفة فعلاً';
  });

  await T('S13', 'البائع: الطلب الجديد والرسائل غير المقروءة تظهر في عدّاد الجرس وقائمته، وعلى بطاقة «الطلبات» داخل «المزيد»، وفي شريط الرئيسية', async () => {
    const buyer = q1(`select buyer from kp_threads where shop_id='${shop}' limit 1`);
    q1(`insert into kp_orders(shop_id,no,buyer,name,phone,delivery,pay,items,subtotal,fee,total) values ('${shop}',99,'${buyer}','عميل التنبيه','0551230000','pickup','cash','[]'::jsonb,10,0,10)`);
    q1(`update kp_threads set unread_shop=3 where shop_id='${shop}'`);
    await A.waitFor(`(()=>{const b=document.getElementById('bellcnt');return b&&!b.hidden&&+b.textContent>=4})()`, 25000);
    await A.eval(`document.querySelector('[data-bell]').click()`); await A.waitFor(`document.querySelector('.popover')`);
    const pt = await A.eval(`document.querySelector('.popover').innerText`); assert(/1 طلب جديد من المتجر الإلكتروني/.test(pt) && /3 رسالة غير مقروءة/.test(pt), 'قائمة الجرس: ' + pt);
    assert(await A.eval(`!!document.querySelector('.popover a[href="#/orders"]')&&!!document.querySelector('.popover a[href="#/orders?tab=chat"]')`), 'روابط الجرس'); await A.eval(`document.querySelector('.popover').remove()`);
    try {
    await A.viewport(412, 860, true); await sleep(400);
    await A.eval(`document.querySelector('[data-more]').click()`); await A.waitFor(`document.querySelector('.ov [data-cnt=orders]')`, 8000);
    assert(await A.eval(`(()=>{const e=document.querySelector('.ov [data-cnt=orders]');return !e.hidden&&+e.textContent===4})()`), 'شارة بطاقة الطلبات داخل المزيد = 4');
    assert(await A.eval(`(()=>{const e=document.querySelector('[data-cnt=orders-more]');return e&&!e.hidden&&+e.textContent===4})()`), 'شارة زر المزيد');
    await A.shot(path.join(SHOTS, 'store-admin-more-badge.png')); await A.click('.ov [data-close]');
    await A.eval(`location.hash='#/'`); await A.waitFor(`document.querySelector('#storeBanner a')`, 8000); const bt = await A.eval(`document.querySelector('#storeBanner').innerText`);
    assert(/1 طلب جديد/.test(bt) && /3 رسالة غير مقروءة/.test(bt), 'شريط الرئيسية: ' + bt); await A.shot(path.join(SHOTS, 'store-admin-home-banner.png'));
    await A.eval(`location.hash='#/orders?tab=chat'`); await A.waitFor(`document.querySelector('[data-t]')`, 10000);
    } finally { await A.viewport(1366, 800, false); }
    q1(`delete from kp_orders where shop_id='${shop}' and no=99`); q1(`update kp_threads set unread_shop=0 where shop_id='${shop}'`);
    await A.waitFor(`(()=>{const b=[...document.querySelectorAll('[data-cnt=orders]')];return b.length&&b.every(e=>e.hidden)})()`, 25000);
    return 'جرس (4) + قائمة + بطاقة المزيد + شريط الرئيسية + رابط الرسائل يفتح تبويب المحادثات، وتختفي الشارات عند المعالجة';
  });

  await T('S14', 'الباركود: يظهر مع الرابط ويُنزَّل PNG/SVG ويُفكّ إلى الرابط نفسه، ثابت للرابط ويتغيّر بتغيّره؛ وتفريغ المحادثات للمالك بتأكيد ولا يمسّ الطلبات', async () => {
    await A.eval(`location.hash='#/settings?tab=shop'`); await A.waitFor(`document.querySelector('[data-qr-png]')`, 15000);
    const link = await A.eval(`document.querySelector('[data-qr-png]').dataset.qrPng`); assert(link.includes('store.html?s=' + SHOP), 'رابط الباركود: ' + link);
    const path0 = () => A.eval(`document.querySelector('[data-qr-png]').closest('.card').querySelector('svg[role=img] path').getAttribute('d')`); const d0 = await path0(); assert(d0.length > 200, 'مسار الباركود');
    await A.eval(`window.__dl=[];const oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){const n=this.download;fetch(this.href).then(r=>r.blob()).then(b=>new Promise(ok=>{const f=new FileReader();f.onload=()=>ok({name:n,type:b.type,size:b.size,url:f.result});f.readAsDataURL(b)})).then(x=>window.__dl.push(x));return}return oc.call(this)}`);
    await A.click('[data-qr-png]'); await A.waitFor(`window.__dl.length>=1`, 10000); await A.click('[data-qr-svg]'); await A.waitFor(`window.__dl.length>=2`, 10000);
    const dl = await A.eval(`window.__dl`); eq([dl[0].name, dl[0].type, dl[1].name, dl[1].type], ['qr-' + SHOP + '.png', 'image/png', 'qr-' + SHOP + '.svg', 'image/svg+xml'], 'التنزيلان'); assert(dl[0].size > 1500 && /^data:image\/png;base64,iVBORw0KGgo/.test(dl[0].url), 'ملف PNG صالح');
    const svgTxt = Buffer.from(dl[1].url.split(',')[1], 'base64').toString(); assert(/^<svg/.test(svgTxt) && svgTxt.includes('<path d="M'), 'ملف SVG صالح');
    const f = path.join(ROOT, 'qr-dl.png'); fs.writeFileSync(f, Buffer.from(dl[0].url.split(',')[1], 'base64')); let dec = '';
    try { dec = execFileSync('python3', ['-I', '-c', 'import sys,cv2\nimg=cv2.imread(sys.argv[1],cv2.IMREAD_GRAYSCALE)\nprint(cv2.QRCodeDetector().detectAndDecode(img)[0])', f], { encoding: 'utf8' }).trim(); } catch { dec = null; }
    if (dec !== null) eq(dec, link, 'فكّ ملف PNG المُنزَّل بقارئ مستقل يعيد رابط المتجر'); const decoded = dec !== null;
    await A.eval(`location.hash='#/'`); await sleep(300); await A.eval(`location.hash='#/settings?tab=shop'`); await A.waitFor(`document.querySelector('[data-qr-png]')`, 10000); eq(await path0(), d0, 'ثابت بعد إعادة الفتح');
    await A.fill('#shop_slug', 'amal-shop-2'); await A.click('[data-shop-pub="1"]'); await A.waitFor(`document.querySelector('[data-qr-png]')?.dataset.qrPng.includes('amal-shop-2')`, 10000); assert(await path0() !== d0, 'يتغيّر مع الرابط');
    await A.fill('#shop_slug', SHOP); await A.click('[data-shop-pub="1"]'); await A.waitFor(`document.querySelector('[data-qr-png]')?.dataset.qrPng.includes('s=${SHOP}&')`, 10000); eq(await path0(), d0, 'يعود كما كان عند عودة الرابط');
    await A.eval(`document.querySelector('[data-qr-png]').closest('.card').scrollIntoView({block:'center'})`); await A.shot(path.join(SHOTS, 'store-admin-qr.png'));
    try { await A.viewport(412, 860, true); await sleep(300); await A.eval(`document.querySelector('[data-qr-png]').closest('.card').scrollIntoView({block:'center'})`); await sleep(200); await A.shot(path.join(SHOTS, 'store-admin-qr-mobile.png')); eq(await A.eval(`document.documentElement.scrollWidth<=innerWidth+1`), true, 'لا تمرير أفقي في بطاقة الباركود على الجوال'); } finally { await A.viewport(1366, 800, false); }
    // ---- تفريغ المحادثات ----
    await A.waitFor(`document.querySelector('[data-chat-purge="0"]')`, 8000); const msgs0 = num(`select count(*) from kp_msgs where shop_id='${shop}'`), ord0 = num(`select count(*) from kp_orders where shop_id='${shop}'`); assert(msgs0 > 0, 'رسائل للاختبار');
    assert(await A.eval(`document.querySelector('[data-chat-purge="30"]').disabled`) && !(await A.eval(`document.querySelector('[data-chat-purge="0"]').disabled`)), 'زر الأقدم معطّل (لا قديم) وزر الكل مفعّل');
    assert(/vacuum full public\.kp_msgs;/.test(await A.eval(`document.body.innerText`)), 'أمر VACUUM ظاهر');
    await A.click('[data-chat-purge="0"]'); await A.waitFor(`document.querySelector('.ov [data-ok]')`); assert(/نهائياً/.test(await A.eval(`document.querySelector('.ov').innerText`)), 'نص التأكيد'); await A.click('.ov [data-close]'); await sleep(400);
    eq(num(`select count(*) from kp_msgs where shop_id='${shop}'`), msgs0, 'الإلغاء لا يحذف');
    await A.click('[data-chat-purge="0"]'); await A.waitFor(`document.querySelector('.ov [data-ok]')`); await A.click('.ov [data-ok]');
    await A.waitFor(`document.querySelector('[data-chat-purge="0"]')?.disabled===true`, 10000);
    eq([num(`select count(*) from kp_msgs where shop_id='${shop}'`), num(`select count(*) from kp_threads where shop_id='${shop}'`), num(`select count(*) from kp_orders where shop_id='${shop}'`)], [0, 0, ord0], 'بعد التفريغ: لا رسائل ولا محادثات، والطلبات كما هي');
    await A.shot(path.join(SHOTS, 'store-admin-qr-purge.png')); return `باركود ثابت ${decoded ? 'ومفكوك بقارئ مستقل' : '(فكّ القارئ المستقل مُتخطّى: OpenCV غير متوفر)'} + تنزيل PNG وSVG، وتفريغ ${msgs0} رسالة والطلبات سليمة`;
  });

  await T('S9', 'إخفاء منتج يزيله من المتجر فوراً، وإيقاف المتجر يعرض للزائر «غير متاح»', async () => {
    await A.eval(`K.ops.saveProduct({online:false},'${ids.cheese}')`); await sleep(500);
    await S.goto(STORE); await S.waitFor(`document.querySelector('.pc')`); const t = await S.eval(`document.body.innerText`); assert(!/جبنة شيدر/.test(t) && /حليب المراعي/.test(t), 'جبنة يجب أن تختفي');
    await S.shot(path.join(SHOTS, 'store-buyer-home.png'));
    await A.eval(`location.hash='#/settings?tab=shop'`); await A.waitFor(`document.querySelector('[data-shop-pub="0"]')`, 10000); await A.click('[data-shop-pub="0"]'); await A.waitFor(`document.querySelector('.ov [data-ok]')`); await A.click('.ov [data-ok]'); await sleep(800);
    eq(q1(`select store_on from kp_shops where id='${shop}'`), 'f'); await S.goto(STORE); await S.waitFor(`/غير متاح/.test(document.body.innerText)`, 12000); return 'الإخفاء والإيقاف يعملان';
  });

  await T('S11', 'الجوال للبائع: كل الصفحات الرئيسية بلا تمرير أفقي، وصفحة الطلبات والمحادثات تظهر بشكل مقروء (لقطات للمراجعة)', async () => {
    M = await launch({ root: ROOT, width: 412, height: 860, mobile: true }); await M.goto('/manifest.json');
    await M.eval(`localStorage.setItem('kp_backend','supabase');localStorage.setItem('kp_sb_cfg',${JSON.stringify(JSON.stringify({ url: mock.url, key: mock.anonKey }))})`);
    await M.goto('/index.html'); await M.waitFor(`document.querySelector('#g_email')`, 30000); await M.fill('#g_email', 'owner@shop.test'); await M.fill('#g_password', 'secret123'); await M.click('[data-in]'); await appReady(M);
    const wide = [];
    for (const r of ['home', 'pos', 'products', 'inventory', 'purchases', 'customers', 'invoices', 'orders', 'reports', 'settings']) {
      await M.eval(`location.hash='#/${r}'`); await sleep(1400); const ov = await M.eval(`document.documentElement.scrollWidth - window.innerWidth`); if (ov > 2) wide.push(r + ':' + ov);
      if (['orders', 'products', 'settings', 'home'].includes(r)) await M.shot(path.join(SHOTS, `store-admin-mobile-${r}.png`));
    }
    eq(wide, [], 'صفحات فيها تمرير أفقي'); await M.eval(`location.hash='#/orders'`); await sleep(800); await M.click('[data-o]'); await M.waitFor(`document.querySelector('.ov [data-st], .ov [data-pos]')`); await M.shot(path.join(SHOTS, 'store-admin-mobile-order.png'));
    await M.close(); M = null; return 'لا تمرير أفقي في 10 صفحات على عرض 412px';
  });

  await T('S10', 'إعدادات الخط والواجهة: تكبير/تصغير وكثافة تُطبَّق فوراً وتبقى بعد إعادة التحميل (لهذا الجهاز فقط)', async () => {
    const fs0 = await A.eval(`parseFloat(getComputedStyle(document.documentElement).fontSize)`);
    await A.eval(`K.disp.setDisplay({fs:120,ui:110,dens:'roomy'})`); eq([await A.eval(`parseFloat(getComputedStyle(document.documentElement).fontSize)`), await A.eval(`document.documentElement.dataset.dens`), await A.eval(`getComputedStyle(document.documentElement).getPropertyValue('--tf')`)], [fs0 * 1.1, 'roomy', '1.2']);
    await A.goto('/index.html'); await appReady(A); eq(await A.eval(`document.documentElement.dataset.dens`), 'roomy', 'بعد إعادة التحميل');
    await A.click('[data-display]'); await A.waitFor(`document.querySelector('.ov [data-reset]')`); await A.click('.ov [data-reset]'); await sleep(200); eq(await A.eval(`parseFloat(getComputedStyle(document.documentElement).fontSize)`), fs0, 'إعادة الضبط'); return 'خط 120% + واجهة 110% + كثافة، يبقى بعد التحميل، وإعادة الضبط تعيده';
  });
} catch (e) { res.push(['FATAL', 'خطأ عام', false, e.message, 0]); console.log('FATAL', e.stack); }
finally { try { await A?.close?.(); await S?.close?.(); await M?.close?.(); } catch { } try { await mock.stop(); } catch { } }
const bad = res.filter(r => !r[2]).length; console.log(`\n${bad ? '✘' : '✔'} ${res.length - bad}/${res.length} اختبار متجر`);
fs.writeFileSync(path.join(SRC, 'docs', 'test-results-store.md'), ['# نتائج اختبار المتجر الإلكتروني (واجهة المشترين + الطلبات + المحادثة)', '', `تاريخ التشغيل: ${new Date().toISOString()}`, '', 'التجهيز: متصفح للبائع (سطح مكتب) + متصفح للمشتري (جوال 412px) + متصفح ثالث لجوال البائع ← بوابة محاكاة لواجهة Supabase ← PostgreSQL 16 حقيقي بسكيمتنا. البوابة ليست Supabase نفسها، والمتصفح headless Chrome.', '', '| # | الاختبار | النتيجة | التفاصيل | الزمن (ms) |', '|---|---|---|---|---|', ...res.map(r => `| ${r[0]} | ${r[1]} | ${r[2] ? '✔' : '✘'} | ${String(r[3]).replace(/\|/g, '/').replace(/\n/g, ' ')} | ${r[4]} |`), '', `**الإجمالي: ${res.length - bad}/${res.length}**`].join('\n') + '\n');
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
