// واجهة المشترين: متجر إلكتروني خفيف (بلا أي كود إداري). يتصل بدوال kp_store_* في Supabase بدور anon فقط.
// لا يحمل هذا الملف أي سر: المفتاح العام + slug المتجر + مفتاح سري عشوائي يولّده متصفح المشتري ويبقى عنده.
import * as sb from '../lib/supabase.js';
import { shrink } from '../lib/image.js';

const app = document.getElementById('app');
const P = new URLSearchParams(location.search);
const slug = (P.get('s') || '').trim().toLowerCase();
const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* التخزين محجوب: يعمل المتجر بلا حفظ */ } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/[\u064B-\u065F\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const STATUS = { new: 'قيد المراجعة', confirmed: 'تم التأكيد', preparing: 'قيد التجهيز', ready: 'جاهز', done: 'تم التسليم', rejected: 'مرفوض', cancelled: 'ملغي' };
const UNIT = { pc: '', kg: '/كجم', g: '/جرام' }, STEP = { pc: 1, kg: 0.5, g: 100 }, UL = { pc: '', kg: ' كجم', g: ' جم' };

// ---- هوية المشتري (سرّية، على هذا المتصفح فقط) ----
const KEY = (() => { let k = rd('kp_bk_' + slug, null); if (!k || k.length < 24) { const a = new Uint8Array(24); crypto.getRandomValues(a); k = 'b' + [...a].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 40); wr('kp_bk_' + slug, k); } return k; })();
const S = { info: null, prods: [], q: '', cat: '', shown: 40, cart: rd('kp_cart_' + slug, {}), imgs: {}, buyer: rd('kp_buyer_' + slug, {}), orders: [], msgs: [], lastMsg: 0, unseen: 0, chatOpen: false };
const money = n => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + (S.info?.cur ? ' ' + S.info.cur : '');
const call = (fn, a = {}, o) => sb.anonRpc(fn, { p_slug: slug, ...a }, o);
const errMsg = e => e.kp === 'KP_STOCK' ? `الكمية المتوفرة من "${e.detail}" لا تكفي — خفّض الكمية` : e.kp === 'KP_MIN' ? `الحد الأدنى للطلب ${money(+e.detail || 0)}` : (e.message || 'حدث خطأ');
const saveCart = () => wr('kp_cart_' + slug, S.cart);
const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 2600); };
const ic = { moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>', sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>', search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>', cart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21.6 8H6"/></svg>', chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12Z"/></svg>', box: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 8-9-5-9 5 9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8"/></svg>', x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>', img: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>' };

// ---- حجم الخط (لهذا الجهاز) ----
const FS = [90, 100, 115, 130]; let fsI = Math.max(0, FS.indexOf(rd('kp_store_fs', 100)));
const applyFs = () => { document.documentElement.style.fontSize = (16 * FS[fsI] / 100) + 'px'; };
applyFs();

// ---- الوضع الليلي/النهاري (يدوي، لهذا المتصفح). الافتراضي: يتبع إعداد الجهاز ----
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
const syncThemeColor = () => { const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', isDark() ? '#0b1320' : '#0f766e'); };
const toggleTheme = () => { const t = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', t); wr('kp_store_theme', t); syncThemeColor(); const b = document.querySelector('[data-theme-btn]'); if (b) { b.innerHTML = isDark() ? ic.sun : ic.moon; b.setAttribute('aria-label', isDark() ? 'الوضع النهاري' : 'الوضع الليلي'); b.title = isDark() ? 'الوضع النهاري' : 'الوضع الليلي'; } };
syncThemeColor();

// ---- تشغيل ----
async function boot() {
  const u = P.get('u'), k = P.get('k');
  if (u && k && /^(https:\/\/[^\s/]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/i.test(u.replace(/\/+$/, '')) && !sb.looksSecret(k)) sb.setRuntimeConfig({ url: u, key: k });
  if (!slug) return fail('رابط المتجر غير كامل', 'افتح الرابط الذي أرسله لك البائع (يحتوي على اسم المتجر).');
  if (!sb.config().ok) return fail('المتجر غير مُهيّأ بعد', 'لم يُضبط ربط قاعدة البيانات لهذا الموقع. أخبر صاحب المتجر.');
  try {
    S.info = await call('kp_store_info');
    document.title = S.info.title || S.info.name || 'المتجر';
    S.prods = await call('kp_store_products');
  } catch (e) { return fail(e.code === 'NETWORK' || e.code === 'TIMEOUT' ? 'تعذّر الاتصال' : 'تعذّر فتح المتجر', errMsg(e), true); }
  for (const id of Object.keys(S.cart)) if (!S.prods.some(p => p.id === id && p.st !== 'out')) delete S.cart[id]; saveCart();
  draw(); bindGlobal(); watchChat();
}
function fail(t, m, retry) { app.innerHTML = `<div class="boot"><h2>${esc(t)}</h2><p style="max-width:22rem;text-align:center">${esc(m)}</p>${retry ? '<button class="btn primary" onclick="location.reload()">إعادة المحاولة</button>' : ''}</div>`; }

// ---- الصفحة الرئيسية ----
const cats = () => S.info.categories.filter(c => S.prods.some(p => p.cat === c.id));
const filtered = () => { const t = norm(S.q); return S.prods.filter(p => (!S.cat || p.cat === S.cat) && (!t || norm(p.name + ' ' + p.desc).includes(t))); };
const cartCount = () => Object.keys(S.cart).length, cartTotal = () => Object.entries(S.cart).reduce((s, [id, q]) => s + q * (S.prods.find(p => p.id === id)?.price || 0), 0);
function draw() {
  const i = S.info, wa = i.whatsapp;
  app.innerHTML = `<header class="hd"><div class="logo">${i.logo ? `<img src="${esc(i.logo)}" alt="">` : esc((i.name || 'م')[0])}</div><h1 class="grow">${esc(i.name)}</h1>
    <button class="ib" data-theme-btn aria-label="${isDark() ? 'الوضع النهاري' : 'الوضع الليلي'}" title="${isDark() ? 'الوضع النهاري' : 'الوضع الليلي'}">${isDark() ? ic.sun : ic.moon}</button><button class="ib" data-fs aria-label="حجم الخط"><span>Aa</span></button><button class="ib" data-orders aria-label="طلباتي">${ic.box}</button>
    <button class="ib" data-chat aria-label="محادثة المتجر">${ic.chat}<i class="n" id="unread" ${S.unseen ? '' : 'hidden'}>${S.unseen}</i></button></header>
  <div class="wrapx"><section class="hero"><h2>${esc(i.title || i.name)}</h2>${i.about ? `<p>${esc(i.about)}</p>` : ''}
    <div class="chips-i">${i.hours ? `<span class="ci">🕘 ${esc(i.hours)}</span>` : ''}${i.address ? `<span class="ci">📍 ${esc(i.address)}</span>` : ''}${i.phone ? `<a class="ci" href="tel:${esc(i.phone)}">📞 <span class="num">${esc(i.phone)}</span></a>` : ''}${wa ? `<a class="ci" target="_blank" rel="noopener" href="https://wa.me/${esc(wa)}">واتساب</a>` : ''}
      ${i.delivery.min ? `<span class="ci">الحد الأدنى للطلب ${money(i.delivery.min)}</span>` : ''}${i.delivery.home && i.delivery.fee ? `<span class="ci">التوصيل ${money(i.delivery.fee)}${i.delivery.free_over ? ` (مجاني فوق ${money(i.delivery.free_over)})` : ''}</span>` : ''}</div>
    ${i.notice ? `<div class="note">${esc(i.notice)}</div>` : ''}
    <details class="how"><summary>كيف أطلب؟</summary><ol><li>اختر منتجاتك من القائمة واضغط «أضف» (يمكنك تعديل الكمية).</li><li>افتح السلة، واكتب اسمك ورقمك، واختر الاستلام من المتجر أو التوصيل.</li><li>اختر طريقة الدفع. عند «التحويل» حوّل المبلغ ثم أرفق صورة إشعار الدفع (الآن أو لاحقاً من «طلباتي»).</li><li>تابع حالة طلبك من زر الصندوق، وتحدث معنا من زر المحادثة لأي استفسار.</li></ol></details></section>
  <div class="bar"><div class="sr"><input id="q" type="search" placeholder="ابحث عن منتج..." value="${esc(S.q)}" autocomplete="off">${ic.search}</div>
    <div class="cats"><button class="cat ${S.cat ? '' : 'on'}" data-cat="">الكل</button>${cats().map(c => `<button class="cat ${S.cat === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div></div>
  <main id="grid"></main>
  <footer class="ft">${esc(i.name)}${i.address ? ' — ' + esc(i.address) : ''}${i.hours ? '<br>' + esc(i.hours) : ''}</footer></div>
  <div id="cartbar"></div>`;
  drawGrid(); drawCartBar();
}
function drawGrid() {
  const list = filtered(), g = document.getElementById('grid'); if (!g) return;
  if (!S.prods.length) { g.innerHTML = '<div class="empty">لا توجد منتجات معروضة حالياً.</div>'; return; }
  if (!list.length) { g.innerHTML = '<div class="empty">لا توجد منتجات مطابقة لبحثك.</div>'; return; }
  const part = list.slice(0, S.shown);
  g.innerHTML = `<div class="grid">${part.map(card).join('')}</div>${list.length > S.shown ? `<button class="more" data-more>عرض المزيد (${list.length - S.shown})</button>` : ''}`;
  lazyImgs();
}
const imgHtml = p => S.imgs[p.id] ? `<img src="${S.imgs[p.id]}" alt="${esc(p.name)}">` : esc([...p.name][0] || '');
function card(p) {
  const q = S.cart[p.id], out = p.st === 'out', st = STEP[p.unit] || 1;
  return `<article class="pc ${out ? 'out' : ''}" data-p="${esc(p.id)}"><div class="im" data-open="${esc(p.id)}" data-img="${p.img && !S.imgs[p.id] ? 1 : ''}" style="${S.imgs[p.id] ? '' : `background:hsl(${hue(p.name)} 42% 42%)`}">${imgHtml(p)}</div>
    ${out ? '<span class="tag out">نفد</span>' : p.tag ? `<span class="tag">${esc(p.tag)}</span>` : p.st === 'low' ? '<span class="tag low">آخر القطع</span>' : ''}
    <div class="bd"><h3 data-open="${esc(p.id)}">${esc(p.name)}</h3><div class="pr">${p.old ? `<s class="num">${money(p.old)}</s>` : ''}<span class="num">${money(p.price)}</span><small>${UNIT[p.unit] || ''}</small></div>
    ${out ? '<button class="addb" disabled>غير متوفر</button>' : q ? `<div class="qs"><button data-q="${esc(p.id)}:${-st}" aria-label="أنقص">−</button><b class="num">${q}${UL[p.unit] || ''}</b><button data-q="${esc(p.id)}:${st}" aria-label="زِد">+</button></div>` : `<button class="addb" data-q="${esc(p.id)}:${st}">أضف إلى السلة</button>`}</div></article>`;
}
function drawCartBar() {
  const el = document.getElementById('cartbar'); if (!el) return; const n = cartCount();
  el.innerHTML = n ? `<button class="cb" data-cart><span>${ic.cart} عرض السلة <span class="c num">${n}</span></span><span class="num">${money(cartTotal())}</span></button>` : '';
}
// صور المنتجات تُجلب عند الظهور على الشاشة فقط، على دفعات صغيرة
let io, imgQueue = new Set(), imgTimer;
function lazyImgs() {
  io?.disconnect(); io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { const id = e.target.dataset.open; if (e.target.dataset.img && !S.imgs[id]) imgQueue.add(id); io.unobserve(e.target); } clearTimeout(imgTimer); imgTimer = setTimeout(fetchImgs, 120); }, { rootMargin: '300px' });
  document.querySelectorAll('.im[data-img="1"]').forEach(e => io.observe(e));
}
async function fetchImgs() {
  const ids = [...imgQueue].slice(0, 12); ids.forEach(i => imgQueue.delete(i)); if (!ids.length) return;
  try {
    const m = await call('kp_store_images', { p_ids: '{' + ids.map(i => '"' + i.replace(/(["\\])/g, '\\$1') + '"').join(',') + '}' });
    for (const [id, d] of Object.entries(m || {})) { S.imgs[id] = d; document.querySelectorAll(`.pc[data-p="${CSS.escape(id)}"] .im`).forEach(el => { el.innerHTML = `<img src="${d}" alt="">`; el.style.background = ''; el.dataset.img = ''; }); }
  } catch { /* تبقى الأحرف بدل الصور */ }
  if (imgQueue.size) imgTimer = setTimeout(fetchImgs, 150);
}

// ---- السلة ----
function setQty(id, d) {
  const p = S.prods.find(x => x.id === id); if (!p) return;
  const st = STEP[p.unit] || 1, q = Math.round(((S.cart[id] || 0) + d) * 1000) / 1000;
  if (q <= 0) delete S.cart[id]; else S.cart[id] = Math.min(q, 9999);
  saveCart(); const el = document.querySelector(`.pc[data-p="${CSS.escape(id)}"]`); if (el) el.outerHTML = card(p); lazyImgs(); drawCartBar(); if (sheetKind === 'cart') drawCart();
}
let sheet = null, sheetKind = '';
function openSheet(kind, title, body, foot = '') {
  closeSheet(); sheetKind = kind;
  sheet = document.createElement('div'); sheet.className = 'ov';
  sheet.innerHTML = `<div class="sh" role="dialog" aria-modal="true"><div class="sh-h"><h3>${esc(title)}</h3><button class="ib" data-x aria-label="إغلاق">${ic.x}</button></div><div class="sh-b">${body}</div>${foot ? `<div class="sh-f">${foot}</div>` : ''}</div>`;
  sheet.addEventListener('mousedown', e => { if (e.target === sheet) closeSheet(); }); document.body.append(sheet); return sheet;
}
function closeSheet() { sheet?.remove(); sheet = null; if (sheetKind === 'chat') S.chatOpen = false; sheetKind = ''; }
function openProduct(id) {
  const p = S.prods.find(x => x.id === id); if (!p) return; const out = p.st === 'out';
  openSheet('prod', p.name, `<div class="pc" style="box-shadow:none;border:0"><div class="im" style="aspect-ratio:1.4;border-radius:.9rem;${S.imgs[id] ? '' : `background:hsl(${hue(p.name)} 42% 42%)`}">${imgHtml(p)}</div></div>
    <div class="pr" style="font-size:1.2rem">${p.old ? `<s class="num">${money(p.old)}</s>` : ''}<span class="num">${money(p.price)}</span><small>${UNIT[p.unit] || ''}</small> ${p.tag ? `<span class="st rejected">${esc(p.tag)}</span>` : ''}</div>
    ${p.desc ? `<p class="muted" style="white-space:pre-wrap">${esc(p.desc)}</p>` : ''}${p.st === 'low' ? '<div class="note">آخر القطع المتوفرة</div>' : ''}`,
    out ? '<button class="btn block" disabled>غير متوفر حالياً</button>' : `<button class="btn primary block" data-q="${esc(id)}:${STEP[p.unit] || 1}" data-x>أضف إلى السلة</button>`);
  if (p.img && !S.imgs[id]) { imgQueue.add(id); fetchImgs().then(() => { if (sheetKind === 'prod' && S.imgs[id]) sheet.querySelector('.im').innerHTML = `<img src="${S.imgs[id]}" alt="">`; }); }
}
const delivery = () => sheet?.querySelector('input[name=dv]:checked')?.value || (S.info.delivery.pickup ? 'pickup' : 'home');
let proofData = null;
function openCart() {
  proofData = null;
  openSheet('cart', 'سلة المشتريات', '<div id="cartbody"></div>', '<button class="btn primary block" id="send">إرسال الطلب</button>'); drawCart();
}
function drawCart() {
  const el = sheet?.querySelector('#cartbody'); if (!el) return; const i = S.info, d = i.delivery, B = S.buyer;
  const lines = Object.entries(S.cart).map(([id, q]) => ({ p: S.prods.find(p => p.id === id), q })).filter(l => l.p);
  if (!lines.length) { el.innerHTML = '<div class="empty">السلة فارغة. اختر منتجاتك من القائمة.</div>'; sheet.querySelector('#send').disabled = true; return; }
  const keep = { name: el.querySelector('[name=name]')?.value ?? B.name, phone: el.querySelector('[name=phone]')?.value ?? B.phone, address: el.querySelector('[name=address]')?.value ?? B.address, note: el.querySelector('[name=note]')?.value ?? '' };
  const dv = el.querySelector('input[name=dv]:checked')?.value || (d.pickup ? 'pickup' : 'home'), py = el.querySelector('input[name=py]:checked')?.value || (i.pay.cash ? 'cash' : 'transfer');
  const sub = lines.reduce((s, l) => s + l.q * l.p.price, 0), fee = dv === 'home' ? (d.free_over && sub >= d.free_over ? 0 : d.fee) : 0, below = d.min && sub < d.min;
  el.innerHTML = `<div>${lines.map(({ p, q }) => `<div class="cl"><div class="th" style="${S.imgs[p.id] ? '' : `background:hsl(${hue(p.name)} 42% 42%)`}">${imgHtml(p)}</div><div class="grow"><div class="nm">${esc(p.name)}</div><div class="muted small num">${money(p.price)}${UNIT[p.unit] || ''}</div></div>
      <div class="qs"><button data-q="${esc(p.id)}:${-(STEP[p.unit] || 1)}">−</button><b class="num">${q}${UL[p.unit] || ''}</b><button data-q="${esc(p.id)}:${STEP[p.unit] || 1}">+</button></div></div>`).join('')}</div>
    <div class="col" style="gap:.4rem"><div class="sumr"><span>المجموع</span><b class="num">${money(sub)}</b></div>${dv === 'home' ? `<div class="sumr"><span>التوصيل</span><b class="num">${fee ? money(fee) : 'مجاني'}</b></div>` : ''}<div class="sumr t"><span>الإجمالي</span><b class="num">${money(sub + fee)}</b></div>
      ${below ? `<div class="err">الحد الأدنى للطلب ${money(d.min)} — أضف منتجات بقيمة ${money(d.min - sub)}</div>` : ''}</div>
    <div class="fld"><label>الاسم *</label><input name="name" value="${esc(keep.name || '')}" autocomplete="name"></div>
    <div class="fld"><label>رقم الجوال *</label><input name="phone" type="tel" inputmode="tel" value="${esc(keep.phone || '')}" autocomplete="tel" dir="ltr" style="text-align:right"></div>
    <div class="fld"><label>طريقة الاستلام</label><div class="opt">${d.pickup ? `<label><input type="radio" name="dv" value="pickup" ${dv === 'pickup' ? 'checked' : ''}><span>استلام من المتجر<small>بدون رسوم</small></span></label>` : ''}${d.home ? `<label><input type="radio" name="dv" value="home" ${dv === 'home' ? 'checked' : ''}><span>توصيل للمنزل<small>${d.fee ? money(d.fee) : 'مجاني'}</small></span></label>` : ''}</div></div>
    ${dv === 'home' ? `<div class="fld"><label>عنوان التوصيل *</label><textarea name="address" placeholder="المدينة، الحي، الشارع، علامة مميزة">${esc(keep.address || '')}</textarea>${d.areas ? `<span class="muted small">مناطق التوصيل: ${esc(d.areas)}</span>` : ''}</div>` : ''}
    <div class="fld"><label>طريقة الدفع</label><div class="opt">${i.pay.cash ? `<label><input type="radio" name="py" value="cash" ${py === 'cash' ? 'checked' : ''}><span>عند الاستلام<small>نقداً</small></span></label>` : ''}${i.pay.transfer ? `<label><input type="radio" name="py" value="transfer" ${py === 'transfer' ? 'checked' : ''}><span>تحويل<small>أرسل إشعار الدفع</small></span></label>` : ''}</div></div>
    ${py === 'transfer' ? `<div class="box">${esc(i.pay.instructions || 'حوّل المبلغ الإجمالي ثم أرفق صورة إشعار الدفع.')}</div><div class="row wrap"><button class="btn" data-proof>${ic.img} ${proofData ? 'تغيير صورة الإشعار' : 'إرفاق صورة إشعار الدفع'}</button>${proofData ? '<span class="st done">تم اختيار الصورة ✓</span>' : '<span class="muted small">يمكنك إرسالها لاحقاً من «طلباتي»</span>'}</div>${proofData ? `<img class="proof" src="${proofData}" alt="إشعار الدفع">` : ''}` : ''}
    <div class="fld"><label>ملاحظات للبائع (اختياري)</label><textarea name="note">${esc(keep.note || '')}</textarea></div><div class="err" id="cerr" hidden></div>`;
  sheet.querySelector('#send').disabled = !!below;
}
async function sendOrder(btn) {
  const el = sheet.querySelector('#cartbody'), v = n => (el.querySelector(`[name=${n}]`)?.value || '').trim(), err = m => { const e = el.querySelector('#cerr'); e.textContent = m; e.hidden = !m; if (m) e.scrollIntoView({ block: 'center' }); };
  const dv = el.querySelector('input[name=dv]:checked')?.value, py = el.querySelector('input[name=py]:checked')?.value;
  if (v('name').length < 2) return err('اكتب اسمك'); if (v('phone').replace(/\D/g, '').length < 7) return err('اكتب رقم جوال صحيح'); if (!dv || !py) return err('اختر طريقة الاستلام والدفع');
  if (dv === 'home' && v('address').length < 4) return err('اكتب عنوان التوصيل');
  err(''); btn.disabled = true; btn.textContent = 'جاري الإرسال...';
  try {
    const r = await call('kp_store_order', { p_key: KEY, p_data: { name: v('name'), phone: v('phone'), address: dv === 'home' ? v('address') : '', note: v('note'), delivery: dv, pay: py, items: Object.entries(S.cart).map(([id, qty]) => ({ id, qty })), proof: py === 'transfer' ? proofData : null } }, { timeout: 45000 });
    S.buyer = { name: v('name'), phone: v('phone'), address: v('address') || S.buyer.address }; wr('kp_buyer_' + slug, S.buyer); wr('kp_thread_' + slug, 1);
    S.cart = {}; saveCart(); drawGrid(); drawCartBar(); watchChat(true);
    openSheet('done', 'تم استلام طلبك ✓', `<div class="col" style="align-items:center;text-align:center"><div style="font-size:2.6rem">🎉</div><h3>طلبك رقم <span class="num">${r.no}</span></h3><div class="pr num" style="font-size:1.3rem">${money(r.total)}</div><p class="muted">سنراجع طلبك ونتواصل معك قريباً. يمكنك متابعة حالته من «طلباتي» أو التحدث معنا.</p></div>
      ${py === 'transfer' && !proofData ? `<div class="box">${esc(S.info.pay.instructions || '')}</div><button class="btn primary block" data-proof-for="${r.id}">${ic.img} إرسال صورة إشعار الدفع الآن</button>` : ''}`, `<button class="btn block" data-orders>طلباتي</button><button class="btn primary block" data-chat>تحدث مع المتجر</button>`);
  } catch (e) { err(errMsg(e)); btn.disabled = false; btn.textContent = 'إرسال الطلب'; if (e.kp === 'KP_GONE') { try { S.prods = await call('kp_store_products'); for (const id of Object.keys(S.cart)) if (!S.prods.some(p => p.id === id && p.st !== 'out')) delete S.cart[id]; saveCart(); draw(); drawCart(); } catch { } } }
}
async function pickProof() { const f = await pickFile(); if (!f) return null; try { return await shrink(f, 1200, 0.72); } catch { toast('تعذّر قراءة الصورة'); return null; } }
const pickFile = () => window.__kpPickFile ? window.__kpPickFile() : new Promise(res => {   // __kpPickFile: نقطة اختبار آلي فقط
   const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => res(i.files[0] || null); i.oncancel = () => res(null); i.click(); });

// ---- طلباتي ----
async function openOrders() {
  openSheet('orders', 'طلباتي', '<div class="empty">جاري التحميل...</div>');
  try { S.orders = await call('kp_store_orders', { p_key: KEY }); } catch (e) { sheet.querySelector('.sh-b').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; return; }
  const b = sheet?.querySelector('.sh-b'); if (!b || sheetKind !== 'orders') return;
  b.innerHTML = S.orders.length ? S.orders.map(o => `<div class="oc"><div class="row between"><b>طلب رقم <span class="num">${o.no}</span></b><span class="st ${o.status}">${STATUS[o.status]}</span></div>
    <div class="muted small">${new Date(o.at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })} · ${o.delivery === 'home' ? 'توصيل' : 'استلام من المتجر'} · ${o.pay === 'transfer' ? 'تحويل' : 'عند الاستلام'}</div>
    <div class="small">${o.items.map(i => `${esc(i.name)} × <span class="num">${i.qty}</span>`).join('، ')}</div><div class="row between"><b class="num">${money(o.total)}</b>${o.fee ? `<span class="muted small">يشمل توصيل ${money(o.fee)}</span>` : ''}</div>
    ${o.shop_note ? `<div class="box">${esc(o.shop_note)}</div>` : ''}
    ${o.pay === 'transfer' ? `<div class="row wrap">${o.proof ? '<span class="st done">تم إرسال إشعار الدفع ✓</span>' : '<span class="st rejected">لم يُرسل إشعار الدفع بعد</span>'}${['new', 'confirmed', 'preparing', 'ready'].includes(o.status) ? `<button class="btn sm" data-proof-for="${o.id}">${o.proof ? 'استبدال الإشعار' : 'إرسال إشعار الدفع'}</button>` : ''}</div>` : ''}</div>`).join('') : '<div class="empty">لا توجد طلبات بعد.</div>';
}
async function sendProof(orderId, btn) {
  const d = await pickProof(); if (!d) return; if (btn) btn.disabled = true;
  try { await call('kp_store_order_proof', { p_key: KEY, p_order: orderId, p_proof: d }, { timeout: 45000 }); toast('تم إرسال إشعار الدفع ✓'); if (sheetKind === 'orders') openOrders(); else if (btn) { btn.textContent = 'تم الإرسال ✓'; } }
  catch (e) { toast(errMsg(e)); if (btn) btn.disabled = false; }
}

// ---- المحادثة ----
const bubble = m => m.kind === 'system' ? `<div class="bub sys">${esc(m.body)}</div>` : `<div class="bub ${m.from === 'buyer' ? 'me' : 'sh'}">${m.img ? `<img data-mi="${m.id}" alt="صورة" style="min-height:4rem;background:rgba(0,0,0,.08)">` : ''}${m.body ? esc(m.body) : ''}<time>${new Date(m.at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</time></div>`;
function openChat() {
  const i = S.info, B = S.buyer, wa = i.whatsapp, need = !(B.name && B.phone);
  openSheet('chat', 'تواصل مع المتجر', `<div class="row wrap">${wa ? `<a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent('مرحباً، لدي استفسار عن متجركم')}">واتساب</a>` : ''}${i.phone ? `<a class="btn sm" href="tel:${esc(i.phone)}">اتصال</a>` : ''}${i.hours ? `<span class="muted small">🕘 ${esc(i.hours)}</span>` : ''}</div>
    <div class="chat" id="chat"></div>
    ${need ? `<div class="col" id="who"><div class="muted small">لنتمكن من الرد عليك، اكتب اسمك ورقمك (مرة واحدة):</div><div class="fld"><input name="cname" placeholder="الاسم" autocomplete="name"></div><div class="fld"><input name="cphone" type="tel" inputmode="tel" placeholder="رقم الجوال" dir="ltr" style="text-align:right"></div></div>` : ''}
    <div class="comp"><button class="ib" data-chat-img aria-label="إرفاق صورة">${ic.img}</button><textarea id="msg" rows="1" placeholder="اكتب رسالتك..."></textarea><button class="btn primary" data-chat-send>إرسال</button></div><div class="err" id="cerr" hidden></div>`);
  S.chatOpen = true; S.unseen = 0; updateBadge(); drawChat(true); watchChat(true);
}
function drawChat(scroll) {
  const c = sheet?.querySelector('#chat'); if (!c || sheetKind !== 'chat') return;
  c.innerHTML = S.msgs.length ? S.msgs.map(bubble).join('') : '<div class="empty" style="padding:1.5rem">اكتب سؤالك وسنرد عليك هنا. يمكنك أيضاً إرفاق صورة.</div>';
  if (scroll) c.scrollTop = c.scrollHeight; c.querySelectorAll('img[data-mi]').forEach(loadMsgImg);
}
const miCache = {};
async function loadMsgImg(el) { const id = el.dataset.mi; if (!miCache[id]) { try { miCache[id] = (await call('kp_store_msg_img', { p_key: KEY, p_id: +id })).img; } catch { return; } } if (miCache[id]) { el.src = miCache[id]; el.style.minHeight = ''; } }
async function sendMsg(img) {
  const ta = sheet.querySelector('#msg'), body = (ta?.value || '').trim(), who = sheet.querySelector('#who'); const err = m => { const e = sheet.querySelector('#cerr'); e.textContent = m; e.hidden = !m; };
  if (!body && !img) return; if (who) { const n = who.querySelector('[name=cname]').value.trim(), ph = who.querySelector('[name=cphone]').value.trim(); if (n.length < 2 || ph.replace(/\D/g, '').length < 7) return err('اكتب اسمك ورقم جوالك أولاً'); S.buyer = { ...S.buyer, name: n, phone: ph }; wr('kp_buyer_' + slug, S.buyer); }
  err('');
  try { await call('kp_store_chat_send', { p_key: KEY, p_name: S.buyer.name || '', p_phone: S.buyer.phone || '', p_body: body, p_img: img || null }, { timeout: 45000 }); if (ta) ta.value = ''; sheet.querySelector('#who')?.remove(); wr('kp_thread_' + slug, 1); await pollChat(); watchChat(true); }
  catch (e) { err(errMsg(e)); }
}
function updateBadge() { const b = document.getElementById('unread'); if (b) { b.hidden = !S.unseen; b.textContent = S.unseen; } }
async function pollChat() {
  try {
    const r = await call('kp_store_chat_get', { p_key: KEY, p_after: S.lastMsg }); const add = r.msgs || []; if (!add.length) return;
    S.msgs.push(...add); S.lastMsg = add[add.length - 1].id;
    if (S.chatOpen) drawChat(true); else { S.unseen += add.filter(m => m.from === 'shop').length; updateBadge(); }
  } catch { /* تعاود المحاولة في الدورة التالية */ }
}
let chatTimer;
function watchChat(force) {
  clearTimeout(chatTimer); if (!force && !rd('kp_thread_' + slug, 0)) return;
  const loop = async () => { if (!document.hidden) await pollChat(); chatTimer = setTimeout(loop, S.chatOpen ? 4000 : 20000); }; loop();
}

// ---- الأحداث ----
function bindGlobal() {
  document.addEventListener('click', async e => {
    const t = e.target, q = s => t.closest(s);
    if (q('[data-x]') && !q('[data-q]')) return closeSheet();
    if (q('[data-fs]')) { fsI = (fsI + 1) % FS.length; wr('kp_store_fs', FS[fsI]); applyFs(); return toast('حجم الخط ' + FS[fsI] + '%'); }
    const cat = q('[data-cat]'); if (cat) { S.cat = cat.dataset.cat; S.shown = 40; draw(); return; }
    const qq = q('[data-q]'); if (qq) { const [id, d] = qq.dataset.q.split(':'); setQty(id, +d); if (q('[data-x]')) closeSheet(); return; }
    const op = q('[data-open]'); if (op) return openProduct(op.dataset.open);
    if (q('[data-more]')) { S.shown += 40; return drawGrid(); }
    if (q('[data-theme-btn]')) return toggleTheme();
    if (q('[data-cart]')) return openCart();
    if (q('[data-orders]')) return openOrders();
    if (q('[data-chat]')) return openChat();
    if (q('#send')) return sendOrder(q('#send'));
    if (q('[data-proof]')) { const d = await pickProof(); if (d) { proofData = d; drawCart(); } return; }
    const pf = q('[data-proof-for]'); if (pf) return sendProof(pf.dataset.proofFor, pf);
    if (q('[data-chat-send]')) return sendMsg();
    if (q('[data-chat-img]')) { const d = await pickProof(); if (d) sendMsg(d); return; }
  });
  document.addEventListener('change', e => { if (sheetKind === 'cart' && (e.target.name === 'dv' || e.target.name === 'py')) drawCart(); });
  document.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; S.shown = 40; drawGrid(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'msg') { e.preventDefault(); sendMsg(); } });
}
boot();
