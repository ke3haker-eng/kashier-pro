// نقطة البيع — مصمَّمة للسرعة: حقل بحث/باركود دائم التركيز، إضافة بنقرة، إنهاء الفاتورة بـ F8 ثم Enter.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import * as db from '../core/db.js';
import { calcCart, PAY_LABEL, offerDiscount, offerLabel } from '../core/calc.js';
import { html, raw, icon, money, priceFmt, toast, modal, formModal, confirmBox, promptBox, pickFrom, requireApproval, seg, chips, thumb, avatar, emptyState, field, kv, btnBusy, mny } from '../ui/components.js';
import { fmt, fmtQty, num, r2, r3, esc, debounce, latinDigits, isWeighed, UNITS, hue, initial, todayKey } from '../core/util.js';
import { openScanner, closeScanner, feedback, pauseScanner, flashScan } from '../lib/scanner.js';
import { printInvoice, previewInvoice, shareInvoice } from '../lib/print.js';
import { myShift, openShiftDialog } from '../ui/shift.js';

let cart = { lines: [], invDisc: null, customerId: '', note: '' };
let state, root, cleanup = [];
const key = () => 'kp_cart_' + db.dbName();
function loadCart() { try { const c = JSON.parse(localStorage.getItem(key())); if (c && Array.isArray(c.lines)) { c.lines = c.lines.filter(l => store.get('products', l.pid) && l.qty > 0); return { invDisc: null, customerId: '', note: '', ...c }; } } catch { } return { lines: [], invDisc: null, customerId: '', note: '' }; }
const saveCart = () => { try { localStorage.setItem(key(), JSON.stringify(cart)); } catch { } };
const calc = () => calcCart(cart, ops.cartCtx());
const qtyLabel = (p, q) => p.unit === 'kg' ? (q < 1 ? fmtQty(q * 1000) + ' جم' : fmtQty(q) + ' كجم') : p.unit === 'g' ? fmtQty(q) + ' جم' : fmtQty(q);
const shortUnit = u => u === 'kg' ? '/كجم' : u === 'g' ? '/جم' : '';

// ---------- شبكة المنتجات ----------
function offerBadge(p) {
  const o = ops.cartCtx().offerFor(p.id); if (!o) return { price: p.price, tag: '' };
  if (o.type === 'bogo') return { price: p.price, tag: `${o.buy || 1}+${o.get || 1}` };
  const d = offerDiscount(o, p.price, 1, p.unit); return { price: r2(p.price - d), old: p.price, tag: o.type === 'pct' ? '-' + fmt(o.value) + '%' : 'عرض' };
}
function drawGrid() {
  const S = store.settings(), g = root.querySelector('#pg'); if (!g) return;
  const list = store.searchProducts(state.q, { cat: state.cat, limit: state.limit + 1 }), more = list.length > state.limit, shown = list.slice(0, state.limit);
  g.className = 'pgrid' + (state.view === 'list' ? ' list' : '');
  if (!shown.length) { g.innerHTML = emptyState('search', state.q ? 'لا توجد منتجات مطابقة — اضغط Enter لإضافة منتج جديد بهذا الباركود إن لم يكن مسجّلاً' : 'لا توجد منتجات بعد. أضف منتجاتك من قسم المنتجات.', !state.q && auth.can('products.edit') ? html`<a class="btn primary" href="#/products?new=1">${icon('plus', 16)} إضافة منتج</a>` : '').toString(); return; }
  g.innerHTML = shown.map(p => {
    const st = store.stockState(p), ob = offerBadge(p), out = st === 'out' && !S.stock.allowNegative;
    const tag = out ? html`<span class="tag off">نفد</span>` : ob.tag ? html`<span class="tag" style="background:var(--bad)">${ob.tag}</span>` : st === 'low' ? html`<span class="tag">منخفض</span>` : '';
    const pi = S.pos.images && p.img ? html`<img src="${p.img}" alt="" loading="lazy">` : html`<span style="background:hsl(${hue(p.name)} 45% 42%);width:100%;height:100%;display:flex;align-items:center;justify-content:center">${initial(p.name)}</span>`;
    return html`<button type="button" class="pcard ${out ? 'out' : ''}" data-pid="${p.id}">${tag}<div class="pi">${pi}</div><div class="pn">${p.name}</div><div class="pp">${ob.old ? html`<s class="num">${priceFmt(ob.old)}</s>` : ''}<span class="num">${priceFmt(ob.price)}</span> <small class="muted">${shortUnit(p.unit)}</small></div></button>`;
  }).join('') + (more ? html`<button type="button" class="btn block" data-more style="grid-column:1/-1">عرض المزيد</button>`.toString() : '');
}

// ---------- السلة ----------
function drawCart() {
  const el = root.querySelector('#cart'); if (!el) return;
  const c = calc(), S = store.settings(), cust = cart.customerId ? store.get('customers', cart.customerId) : null;
  const holds = store.count('holds');
  const lines = c.lines.map(l => {
    const p = store.get('products', l.pid), d = l.offerDisc + l.manualDisc, sel = state.sel === l.pid;
    return html`<div class="cl ${sel ? 'sel' : ''}" data-line="${l.pid}">${thumb(p, 46)}<div><div class="nm">${l.name}</div><div class="pr"><span class="num">${priceFmt(l.price)}</span> ${shortUnit(l.unit)} ${l.offer ? html`<span class="off">${l.offer.label}</span>` : ''}${l.manualDisc > 0 ? html`<span class="off">خصم ${fmt(l.manualDisc)}</span>` : ''}</div></div><div class="lt">${d > 0 ? html`<s class="muted small num" style="font-weight:500;display:block">${fmt(l.gross)}</s>` : ''}<span class="num">${fmt(l.total)}</span></div>
      <div class="ctl">${isWeighed(l.unit) ? html`<button class="btn sm" data-a="wt" data-id="${l.pid}">${icon('scale', 16)} ${qtyLabel(p, l.qty)}</button>` : html`<div class="qty"><button data-a="pl" data-id="${l.pid}" aria-label="زيادة">${icon('plus', 16)}</button><b data-a="qe" data-id="${l.pid}" class="num">${fmtQty(l.qty)}</b><button data-a="mi" data-id="${l.pid}" aria-label="تقليل">${icon('minus', 16)}</button></div>`}
      <div class="row gap4"><button class="x" data-a="ld" data-id="${l.pid}" title="خصم على الصنف">${icon('percent', 17)}</button><button class="x" data-a="rm" data-id="${l.pid}" title="حذف (Del)">${icon('trash', 17)}</button></div></div></div>`;
  });
  el.innerHTML = html`<div class="cart-h"><h3>${icon('cart', 20)} الفاتورة الحالية</h3><button class="btn sm ghost" data-a="holds" title="الفواتير المعلّقة (F4)">${icon('hold', 16)} معلّقة${holds ? html` <span class="badge warn">${holds}</span>` : ''}</button><button class="btn icon sm ghost" data-a="clear" title="مسح الفاتورة">${icon('trash', 16)}</button><button class="btn icon sm ghost" data-a="closecart" id="closecart" style="display:none">${icon('x', 16)}</button></div>
    <div class="cart-cust" data-a="cust">${icon('user', 16)}<span class="grow ell">${cust ? html`<b>${cust.name}</b>${store.customerBalance(cust.id) > 0 ? html` <span class="bad small">دين: ${money(store.customerBalance(cust.id))}</span>` : ''}` : 'زبون عادي — اضغط لاختيار زبون (F6)'}</span>${cust ? html`<button class="x btn icon sm ghost" data-a="nocust" aria-label="إزالة الزبون">${icon('x', 14)}</button>` : icon('chevL', 16)}</div>
    <div class="cart-lines" id="cl">${lines.length ? lines : emptyState('cart', 'الفاتورة فارغة', html`<span class="small">امسح باركود أو اضغط على منتج أو اكتب اسمه</span>`)}</div>
    <div class="cart-f">
      ${c.count ? html`<div class="sm-r"><span>المجموع (${c.count} صنف)</span><span class="num">${fmt(c.subtotal)}</span></div>${c.offerDisc > 0 ? html`<div class="sm-r dsc"><span>خصم العروض</span><b class="num">-${fmt(c.offerDisc)}</b></div>` : ''}${c.lineDisc > 0 ? html`<div class="sm-r dsc"><span>خصم الأصناف</span><b class="num">-${fmt(c.lineDisc)}</b></div>` : ''}${c.invDisc > 0 ? html`<div class="sm-r dsc"><span>خصم الفاتورة</span><b class="num">-${fmt(c.invDisc)}</b></div>` : ''}${c.tax > 0 ? html`<div class="sm-r"><span>${S.tax.label} ${fmt(c.taxRate)}%${c.taxInclusive ? ' (شاملة)' : ''}</span><span class="num">${fmt(c.tax)}</span></div>` : ''}` : ''}
      <div class="total-bar"><span>الإجمالي</span><span class="tv num">${money(c.total)}</span></div>
      <div class="cart-act"><button class="btn" data-a="invdisc" ${c.count ? '' : raw('disabled')}>${icon('percent', 16)} خصم</button><button class="btn" data-a="hold" ${c.count ? '' : raw('disabled')}>${icon('hold', 16)} تعليق</button></div>
      <button class="btn ok lg block" data-a="pay" ${c.count ? '' : raw('disabled')}>${icon('check', 22)} إتمام البيع <kbd>F8</kbd></button></div>`.toString();
  const mc = root.querySelector('#minicart'); if (mc) { mc.hidden = !c.count; mc.innerHTML = html`<span class="row">${icon('cart', 20)}<span class="mc-n">${c.count} صنف</span></span><span class="num">${money(c.total)}</span><span>عرض الفاتورة ${icon('chevU', 16)}</span>`.toString(); }
  const cc = el.querySelector('#closecart'); if (cc) cc.style.display = matchMedia('(max-width:1024px)').matches ? '' : 'none';
}

// ---------- إضافة منتجات ----------
function canAdd(p, newQty) {
  const S = store.settings();
  if (p.active === false) { toast('المنتج مؤرشف', 'warn'); return false; }
  if (p.track && !S.stock.allowNegative && newQty > p.stock + 1e-9) { toast(p.stock <= 0 ? `"${p.name}" نفد من المخزون` : `المتوفر من "${p.name}" ${qtyLabel(p, p.stock)} فقط`, 'err'); return false; }
  return true;
}
function touch(pid) { state.sel = pid; saveCart(); drawCart(); const l = root.querySelector(`.cl[data-line="${pid}"]`); l?.classList.add('flash'); const g = root.querySelector(`.pcard[data-pid="${pid}"]`); g?.classList.add('flash'); setTimeout(() => { l?.classList.remove('flash'); g?.classList.remove('flash'); }, 520); }
function addProduct(p, qty = null) {
  if (isWeighed(p.unit) && qty == null) return askWeight(p);
  qty = qty ?? 1; const ex = cart.lines.find(l => l.pid === p.id), nq = r3((ex?.qty || 0) + qty);
  if (!canAdd(p, nq)) return false;
  if (ex) ex.qty = nq; else cart.lines.unshift({ pid: p.id, qty, disc: null });
  feedback(); touch(p.id); return true;
}
function askWeight(p, replace = false) {
  const ex = cart.lines.find(l => l.pid === p.id); let unit = p.unit === 'g' ? 'g' : 'g';
  pauseScanner(true);
  const m = modal({ title: p.name, size: 'sm', body: html`<div class="muted">${money(p.price)} ${shortUnit(p.unit)}</div><div class="field"><label>الوزن (${p.unit === 'kg' ? 'بالجرام' : 'بالجرام'})</label><input class="inp big-in" id="wg" inputmode="decimal" autocomplete="off" autofocus value="${replace && ex ? fmtQty(p.unit === 'kg' ? ex.qty * 1000 : ex.qty) : ''}" placeholder="0"></div><div class="quick-amts">${[100, 250, 500, 1000].map(v => html`<button type="button" data-w="${v}">${v >= 1000 ? v / 1000 + ' كجم' : v + ' جم'}</button>`)}</div><div class="change-box" id="wp" style="background:var(--pb);color:var(--p)">0</div><div class="form-err" hidden></div>`, footer: html`<button class="btn primary" data-ok>${icon('check', 18)} تأكيد <kbd>Enter</kbd></button><button class="btn ghost" data-close>إلغاء</button>` });
  const inp = m.el.querySelector('#wg'), pr = m.el.querySelector('#wp'), err = m.el.querySelector('.form-err');
  const grams = () => num(inp.value), qtyOf = g => p.unit === 'kg' ? g / 1000 : g;
  inp.oninput = () => { inp.value = latinDigits(inp.value).replace(/[^\d.]/g, ''); const g = grams(); pr.textContent = money(r2(p.price * (isFinite(g) ? qtyOf(g) : 0))); }; inp.oninput();
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) { inp.value = (replace ? 0 : 0) + +b.dataset.w; inp.oninput(); inp.focus(); } });
  const ok = () => { const g = grams(); if (!(g > 0)) { err.textContent = 'أدخل الوزن'; err.hidden = false; return; } const q = r3(qtyOf(g)); const base = replace ? 0 : (ex?.qty || 0); if (!canAdd(p, r3(base + q))) return; if (ex) ex.qty = r3(base + q); else cart.lines.unshift({ pid: p.id, qty: q, disc: null }); m.close(true); feedback(); touch(p.id); if (state.once) closeScanner(); };
  m.el.querySelector('[data-ok]').onclick = ok; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } };
  m.done.then(() => { pauseScanner(false); focusSearch(); });
}
function handleCode(raw0) {
  const code = latinDigits(raw0).trim(); if (!code) return false;
  const S = store.settings(), sc = S.pos.scale;
  if (sc?.on && code.length === sc.prefix.length + sc.itemLen + sc.valLen + 1 && code.startsWith(sc.prefix)) {
    const item = code.slice(sc.prefix.length, sc.prefix.length + sc.itemLen), grams = +code.slice(sc.prefix.length + sc.itemLen, sc.prefix.length + sc.itemLen + sc.valLen);
    const p = store.byCode(item) || store.byCode(String(+item)) || store.byBarcode(item);
    if (p && isWeighed(p.unit) && grams > 0) { const ok = addProduct(p, r3(p.unit === 'kg' ? grams / 1000 : grams)); if (ok) toast(`${p.name} — ${qtyLabel(p, p.unit === 'kg' ? grams / 1000 : grams)}`, 'ok', 1200); return true; }
  }
  const p = store.byBarcode(code) || store.byCode(code); if (p) { addProduct(p); return true; }
  return false;
}
async function unknownBarcode(code) {
  toast('الباركود غير مسجّل: ' + code, 'err', 3000);
  if (auth.can('products.edit')) { const ok = await confirmBox({ title: 'منتج غير مسجّل', message: html`الباركود <b class="num">${code}</b> غير موجود. هل تريد إضافة منتج جديد به الآن؟`, ok: 'إضافة منتج' }); if (ok) { const { productForm } = await import('./products.js'); const id = await productForm(null, { barcode: code }); if (id) { const p = store.get('products', id); if (p) addProduct(p); } } }
  focusSearch();
}
const focusSearch = () => { const i = root?.querySelector('#q'); if (i && !document.querySelector('.ov') && !document.getElementById('cam')) i.focus(); };

// ---------- الإجراءات ----------
const A = {
  pl: id => { const l = cart.lines.find(x => x.pid === id), p = store.get('products', id); if (l && canAdd(p, l.qty + 1)) { l.qty = r3(l.qty + 1); touch(id); } },
  mi: id => { const l = cart.lines.find(x => x.pid === id); if (!l) return; l.qty = r3(l.qty - 1); if (l.qty <= 0) cart.lines = cart.lines.filter(x => x !== l); touch(id); },
  rm: id => { cart.lines = cart.lines.filter(x => x.pid !== id); if (state.sel === id) state.sel = null; saveCart(); drawCart(); focusSearch(); },
  qe: async id => { const l = cart.lines.find(x => x.pid === id), p = store.get('products', id); const v = await promptBox({ title: p.name, label: 'الكمية', value: l.qty, type: 'text', ok: 'تعديل' }); if (v == null) return; const q = num(v); if (!(q >= 0) || !isFinite(q)) return toast('كمية غير صحيحة', 'err'); if (q === 0) return A.rm(id); if (!Number.isInteger(q)) return toast('الكمية يجب أن تكون عدداً صحيحاً', 'err'); if (!canAdd(p, q)) return; l.qty = q; touch(id); },
  wt: id => askWeight(store.get('products', id), true),
  clear: async () => { if (!cart.lines.length) return; if (await confirmBox({ title: 'مسح الفاتورة', message: 'سيتم حذف كل أصناف الفاتورة الحالية.', ok: 'مسح', danger: true })) { resetCart(); } },
  cust: async () => { if (!auth.can('customers.view')) return; const items = store.list('customers').map(c => ({ id: c.id, label: c.name, sub: c.phone, right: store.customerBalance(c.id) > 0 ? 'دين ' + fmt(store.customerBalance(c.id)) : '' })); const id = await pickFrom({ title: 'اختيار الزبون', items, allowNone: 'زبون عادي (بدون حساب)', placeholder: 'ابحث بالاسم أو الهاتف', create: auth.can('customers.manage') ? { label: 'زبون جديد', run: async () => { const { customerForm } = await import('./customers.js'); return customerForm(null); } } : null }); if (id !== null) { cart.customerId = id; saveCart(); drawCart(); } focusSearch(); },
  nocust: () => { cart.customerId = ''; saveCart(); drawCart(); },
  ld: id => discountDialog('line', id),
  invdisc: () => discountDialog('inv'),
  hold: async () => { if (!cart.lines.length) return; const name = await promptBox({ title: 'تعليق الفاتورة', label: 'اسم أو ملاحظة (اختياري)', required: false, ok: 'تعليق' }); if (name === null) return; await ops.saveHold(cart, name); resetCart(); toast('تم تعليق الفاتورة — يمكنك استرجاعها من "معلّقة"', 'ok'); },
  holds: () => holdsDialog(),
  pay: () => checkout(),
  closecart: () => root.querySelector('#cart').classList.remove('open'),
};
function resetCart() { cart = { lines: [], invDisc: null, customerId: '', note: '' }; state.sel = null; saveCart(); drawCart(); focusSearch(); }

function discountDialog(kind, pid) {
  if (!auth.can('pos.discount')) return toast('ليست لديك صلاحية تطبيق خصومات', 'err');
  const cur = kind === 'line' ? cart.lines.find(l => l.pid === pid)?.disc : cart.invDisc, S = store.settings();
  const c = calc(), base = kind === 'line' ? c.lines.find(l => l.pid === pid)?.total : c.taxable + c.invDisc;
  const m = formModal({ title: kind === 'line' ? 'خصم على الصنف' : 'خصم على الفاتورة', size: 'sm', fields: [{ name: 'type', label: 'نوع الخصم', type: 'select', options: [['pct', 'نسبة مئوية %'], ['fixed', 'مبلغ ثابت']], value: cur?.type || 'pct' }, { name: 'value', label: 'قيمة الخصم', type: 'number', value: cur?.value ?? '', autofocus: true, hint: `الحد المسموح دون موافقة: ${S.pos.maxDiscPct}%` }], submit: 'تطبيق', extraFooter: cur ? html`<button class="btn danger" data-rm>إزالة</button>` : '',
    onSubmit: async v => { const val = num(v.value); if (!(val > 0)) throw new Error('أدخل قيمة صحيحة'); if (v.type === 'pct' && val > 100) throw new Error('النسبة لا تتجاوز 100%'); if (v.type === 'fixed' && val > base) throw new Error('الخصم أكبر من قيمة ' + (kind === 'line' ? 'الصنف' : 'الفاتورة')); const d = { type: v.type, value: val }; if (kind === 'line') cart.lines.find(l => l.pid === pid).disc = d; else cart.invDisc = d; saveCart(); drawCart(); } });
  m.el.querySelector('[data-rm]')?.addEventListener('click', () => { if (kind === 'line') cart.lines.find(l => l.pid === pid).disc = null; else cart.invDisc = null; saveCart(); drawCart(); m.close(); });
}

async function holdsDialog() {
  const draw = () => { const hs = store.list('holds').slice().sort((a, b) => b.t.localeCompare(a.t)); return hs.length ? html`${hs.map(h => { const c = calcCart(h.cart, ops.cartCtx()); return html`<div class="list-item"><div class="grow"><b>${h.name || 'فاتورة معلّقة'}</b><div class="small muted">${new Date(h.t).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })} — ${h.userName || ''} — ${c.count} صنف</div></div><b class="num p">${money(c.total)}</b><button class="btn sm primary" data-res="${h.id}">استرجاع</button><button class="btn sm icon danger" data-del="${h.id}">${icon('trash', 14)}</button></div>`; })}` : emptyState('hold', 'لا توجد فواتير معلّقة'); };
  const m = modal({ title: 'الفواتير المعلّقة', body: draw() });
  m.el.addEventListener('click', async e => {
    const r = e.target.closest('[data-res]'), d = e.target.closest('[data-del]');
    if (r) { const h = store.get('holds', r.dataset.res); if (!h) return; if (cart.lines.length) await ops.saveHold(cart, 'تلقائي: قبل الاسترجاع'); cart = { lines: [], invDisc: null, customerId: '', note: '', ...structuredClone(h.cart) }; cart.lines = cart.lines.filter(l => store.get('products', l.pid)); await ops.deleteHold(h.id); saveCart(); drawCart(); m.close(); toast('تم استرجاع الفاتورة'); }
    if (d) { if (await confirmBox({ title: 'حذف', message: 'حذف الفاتورة المعلّقة نهائياً؟', danger: true, ok: 'حذف' })) { await ops.deleteHold(d.dataset.del); m.setBody(draw()); drawCart(); } }
  });
  m.done.then(focusSearch);
}

// ---------- الدفع ----------
async function checkout() {
  if (!cart.lines.length) return; const S = store.settings(), c = calc();
  if (S.pos.requireShift && !myShift()) { toast('افتح الوردية أولاً', 'warn'); return openShiftDialog().then(() => drawShiftBanner()); }
  let approvedBy = null;
  if (c.manualDisc > 0 && c.manualPct > S.pos.maxDiscPct + 1e-9 && !auth.can('pos.bigDiscount')) { approvedBy = await requireApproval('pos.bigDiscount', `الخصم ${fmt(c.manualPct)}% يتجاوز الحد المسموح (${S.pos.maxDiscPct}%).`); if (!approvedBy) return; }
  payDialog(c, approvedBy);
}
const roundUps = t => { const out = [r2(t)]; for (const s of [5, 10, 20, 50, 100, 200, 500, 1000]) { const v = Math.ceil(t / s) * s; if (v > t && !out.includes(v)) out.push(v); if (out.length >= 5) break; } return out; };

function payDialog(c, approvedBy) {
  const S = store.settings(), total = c.total, cust = cart.customerId ? store.get('customers', cart.customerId) : null;
  let mode = S.pos.defaultPay || 'cash'; if (mode === 'credit' && !cust) mode = 'cash';
  const methods = [['cash', 'نقدي', 'cash'], ['card', 'بطاقة', 'card'], ['wallet', 'محفظة', 'wallet'], ['credit', 'آجل', 'users'], ['mixed', 'مختلط', 'layers']];
  const m = modal({ title: 'إتمام البيع', size: '', persistent: false, body: '', footer: html`<button class="btn ok lg" data-ok style="flex:2">${icon('check', 20)} تأكيد وإتمام البيع <kbd>Enter</kbd></button><button class="btn ghost" data-close>رجوع</button>` });
  const draw = () => {
    m.setBody(html`<div class="total-bar"><span>المطلوب</span><span class="tv num">${money(total)}</span></div>
      ${cust ? html`<div class="muted small">الزبون: <b>${cust.name}</b></div>` : ''}
      <div class="pay-q" style="grid-template-columns:repeat(5,1fr)">${methods.map(([k, l, i]) => html`<button type="button" data-mode="${k}" class="${k === mode ? 'on' : ''}">${icon(i, 20)}${l}</button>`)}</div>
      <div id="pb">${modeBody()}</div><div class="form-err" id="perr" hidden></div>`);
    m.el.querySelector('#rcv, #cr_now')?.focus(); m.el.querySelector('#rcv, #cr_now')?.select(); upd();
  };
  const modeBody = () => {
    if (mode === 'cash') return html`<div class="field"><label>المبلغ المستلم</label><input class="inp big-in" id="rcv" inputmode="decimal" value="${total}" autocomplete="off"></div><div class="quick-amts">${roundUps(total).map(v => html`<button type="button" data-q="${v}">${v === r2(total) ? 'المبلغ بالضبط' : fmt(v)}</button>`)}</div><div id="chg" class="change-box">0</div>`;
    if (mode === 'card' || mode === 'wallet') return html`<div class="change-box" style="background:var(--infob);color:var(--info)">سيتم تحصيل ${money(total)} عبر ${PAY_LABEL[mode]}</div><div class="muted small">تأكد من نجاح العملية على جهاز البطاقة/المحفظة قبل التأكيد.</div>`;
    if (mode === 'credit') return cust ? html`<div class="change-box" style="background:var(--warnb);color:#b45309">سيُسجَّل على ${cust.name} ديناً</div><div class="field"><label>دفعة نقدية الآن (اختياري)</label><input class="inp big-in" id="cr_now" inputmode="decimal" value="0" autocomplete="off"></div><div id="chg" class="muted center"></div><div class="small muted">الدين الحالي: ${money(store.customerBalance(cust.id))}${cust.creditLimit > 0 ? ' — السقف: ' + money(cust.creditLimit) : ''}</div>` : html`<div class="empty">اختر الزبون أولاً لتسجيل الدين عليه<br><button class="btn primary" data-pickc style="margin-top:8px">${icon('user', 16)} اختيار زبون</button></div>`;
    return html`<div class="form-grid"><div class="field"><label>بطاقة</label><input class="inp" id="m_card" inputmode="decimal" placeholder="0" autocomplete="off"></div><div class="field"><label>محفظة إلكترونية</label><input class="inp" id="m_wallet" inputmode="decimal" placeholder="0" autocomplete="off"></div>${cust ? html`<div class="field"><label>آجل (دين)</label><input class="inp" id="m_credit" inputmode="decimal" placeholder="0" autocomplete="off"></div>` : ''}<div class="field"><label>النقد المستلم</label><input class="inp" id="rcv" inputmode="decimal" autocomplete="off"></div></div><div id="chg" class="change-box">0</div>`;
  };
  const val = id => { const n = num(m.el.querySelector(id)?.value || ''); return isFinite(n) && n > 0 ? r2(n) : 0; };
  const payments = () => {
    if (mode === 'cash') return [{ method: 'cash', amount: val('#rcv') }];
    if (mode === 'card' || mode === 'wallet') return [{ method: mode, amount: total }];
    if (mode === 'credit') { const now = Math.min(val('#cr_now'), total); return [...(now > 0 ? [{ method: 'cash', amount: now }] : []), { method: 'credit', amount: r2(total - now) }]; }
    return [{ method: 'card', amount: val('#m_card') }, { method: 'wallet', amount: val('#m_wallet') }, { method: 'credit', amount: val('#m_credit') }, { method: 'cash', amount: val('#rcv') }];
  };
  const upd = () => {
    const chg = m.el.querySelector('#chg'), okb = m.el.querySelector('[data-ok]'); let good = true;
    if (mode === 'cash') { const d = r2(val('#rcv') - total); good = d >= 0; chg.className = 'change-box' + (good ? '' : ' bad'); chg.textContent = good ? 'الباقي: ' + money(d) : 'ناقص: ' + money(-d); }
    else if (mode === 'mixed') { const o = r2(val('#m_card') + val('#m_wallet') + val('#m_credit')), need = r2(total - o), d = r2(val('#rcv') - need); good = need >= 0 && d >= 0; chg.className = 'change-box' + (good ? '' : ' bad'); chg.textContent = need < 0 ? 'المبالغ تتجاوز الإجمالي' : need === 0 && d >= 0 ? 'لا نقد مطلوب' : (d >= 0 ? `المطلوب نقداً ${money(need)} — الباقي ${money(d)}` : `المطلوب نقداً ${money(need)} — ناقص ${money(-d)}`); }
    else if (mode === 'credit') { if (!cust) good = false; else { const now = Math.min(val('#cr_now'), total); if (chg) chg.textContent = `الآجل: ${money(total - now)}`; } }
    okb.disabled = !good; okb.classList.toggle('dis', !good);
  };
  let busy = false;
  const confirm = async () => {
    if (busy) return; busy = true; const okb = m.el.querySelector('[data-ok]'), err = m.el.querySelector('#perr'); err.hidden = true; okb.classList.add('spin');
    try {
      let inv; try { inv = await ops.completeSale({ cart, payments: payments(), customerId: cart.customerId, note: cart.note, approvedBy }); }
      catch (e) { if (e.code === 'NEED_APPROVAL') { const a = await requireApproval('pos.bigDiscount', e.message); if (!a) throw e; approvedBy = a; inv = await ops.completeSale({ cart, payments: payments(), customerId: cart.customerId, note: cart.note, approvedBy }); } else throw e; }
      m.close(true); resetCart(); afterSale(inv);
    } catch (e) { err.textContent = e.message; err.hidden = false; if (e.code === 'NO_SHIFT') openShiftDialog(); if (e.code === 'STOCK') drawGrid(); } finally { busy = false; okb.classList.remove('spin'); }
  };
  m.el.addEventListener('click', e => { const md = e.target.closest('[data-mode]'); if (md) { mode = md.dataset.mode; draw(); return; } const q = e.target.closest('[data-q]'); if (q) { const i = m.el.querySelector('#rcv'); i.value = q.dataset.q; upd(); i.focus(); } if (e.target.closest('[data-pickc]')) { A.cust().then(() => { if (cart.customerId) { m.close(); payDialog(calc(), approvedBy); } }); } if (e.target.closest('[data-ok]')) confirm(); });
  m.el.addEventListener('input', e => { if (e.target.tagName === 'INPUT') { e.target.value = latinDigits(e.target.value).replace(/[^\d.]/g, ''); upd(); } });
  m.el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (!m.el.querySelector('[data-ok]').disabled) confirm(); } const n = { F1: 'cash', F2: 'card', F3: 'wallet' }[e.key]; if (n) { e.preventDefault(); mode = n; draw(); } });
  draw(); m.done.then(focusSearch);
}

function afterSale(inv) {
  const S = store.settings(); if (S.invoice.autoPrint) { for (let i = 0; i < (S.invoice.copies || 1); i++) printInvoice(inv); }
  const m = modal({ title: '', size: 'sm', body: html`<div class="success"><div class="tick">${icon('check', 38)}</div><h3>تمت عملية البيع</h3><div class="muted">فاتورة <b class="num">${inv.no}</b></div>${inv.change > 0 ? html`<div class="muted">الباقي للزبون</div><div class="change-box" style="font-size:2.2rem;width:100%">${money(inv.change)}</div>` : html`<div class="change-box" style="width:100%">${money(inv.total)}</div>`}${inv.due > 0 ? html`<div class="badge warn">آجل: ${money(inv.due)}</div>` : ''}</div>`, footer: html`<button class="btn primary lg" data-new autofocus>بيع جديد <kbd>Enter</kbd></button><button class="btn" data-print>${icon('print', 16)} طباعة</button><button class="btn" data-prev>${icon('eye', 16)} معاينة</button>` });
  m.el.querySelector('[data-new]').onclick = () => m.close(); m.el.querySelector('[data-print]').onclick = () => printInvoice(inv); m.el.querySelector('[data-prev]').onclick = () => previewInvoice(inv);
  const t = setTimeout(() => m.close(), 12000); m.done.then(() => { clearTimeout(t); focusSearch(); });
}

function drawShiftBanner() { const b = root.querySelector('#shiftbanner'); if (!b) return; const need = store.settings().pos.requireShift && !myShift(); b.hidden = !need; }

// ---------- الصفحة ----------
export default {
  viewClass: 'pos-view',
  destroy() { cleanup.forEach(f => f()); cleanup = []; closeScanner(); saveCart(); root = null; },
  async render(view) {
    if (root === view && view.querySelector('#pg')) { drawGrid(); drawCart(); return; }
    this.destroy?.(); root = view; const S = store.settings();
    cart = loadCart(); state = { q: '', cat: '', limit: 60, sel: null, view: (() => { try { return localStorage.getItem('kp_posview') || (S.pos.grid ? 'grid' : 'list'); } catch { return 'grid'; } })(), once: !!S.once };
    const cats = store.list('categories').slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    view.innerHTML = html`<div class="pos"><section class="pos-l"><div id="shiftbanner" class="demo-bar" style="border-radius:12px;margin-bottom:8px" hidden>الوردية غير مفتوحة — لا يمكن البيع قبل فتحها <button data-a2="shift">فتح الوردية</button></div>
      <div class="pos-bar"><div class="input-ic">${icon('search', 18)}<input id="q" class="inp" placeholder="ابحث بالاسم أو امسح / اكتب الباركود ثم Enter (F2)" enterkeyhint="search" autocomplete="off" autofocus></div>
        <button class="btn icon" data-a2="cam" title="مسح بالكاميرا" style="width:48px;height:48px">${icon('cam', 22)}</button><button class="btn icon" data-a2="view" title="تغيير العرض" style="width:48px;height:48px">${icon(state.view === 'grid' ? 'list' : 'grid', 20)}</button><button class="btn icon hide-s" data-a2="keys" title="الاختصارات" style="width:48px;height:48px">${icon('keyboard', 20)}</button></div>
      <div class="pos-cats">${chips([['', 'الكل'], ...cats.map(c => [c.id, c.name])], '', 'data-cat')}</div><div class="pgrid" id="pg"></div></section>
      <aside class="cart" id="cart"></aside></div><div class="mini-cart" id="minicart" data-a2="opencart" hidden></div>`.toString();
    drawGrid(); drawCart(); drawShiftBanner();
    const q = view.querySelector('#q');
    const search = debounce(() => { state.q = q.value; state.limit = 60; drawGrid(); }, 60); q.addEventListener('input', search);
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const v = q.value.trim(); if (!v) return; search.cancel(); if (handleCode(v)) { q.value = ''; state.q = ''; drawGrid(); return; }
        const found = store.searchProducts(v, { limit: 3 }); if (found.length === 1) { addProduct(found[0]); q.value = ''; state.q = ''; drawGrid(); } else if (!found.length && /^\d{4,}$/.test(latinDigits(v))) { q.select(); unknownBarcode(latinDigits(v)); } else { state.q = v; drawGrid(); } }
      if (e.key === 'Escape') { q.value = ''; state.q = ''; drawGrid(); }
    });
    // الأحداث
    view.addEventListener('click', e => {
      const pc = e.target.closest('.pcard[data-pid]'); if (pc) { const p = store.get('products', pc.dataset.pid); if (p) addProduct(p); focusSearch(); return; }
      if (e.target.closest('[data-more]')) { state.limit += 60; drawGrid(); return; }
      const ct = e.target.closest('[data-cat]'); if (ct) { state.cat = ct.dataset.cat; view.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('on', b === ct)); state.limit = 60; drawGrid(); focusSearch(); return; }
      const a2 = e.target.closest('[data-a2]'); if (a2) { const k = a2.dataset.a2; if (k === 'cam') openScanner(code => { if (handleCode(code)) { flashScan('✓ ' + (store.byBarcode(code) || store.byCode(code))?.name); if (state.once) closeScanner(); } else flashScan('غير مسجّل: ' + code); }); else if (k === 'view') { state.view = state.view === 'grid' ? 'list' : 'grid'; try { localStorage.setItem('kp_posview', state.view); } catch { } a2.innerHTML = icon(state.view === 'grid' ? 'list' : 'grid', 20).toString(); drawGrid(); } else if (k === 'keys') showKeys(); else if (k === 'shift') openShiftDialog().then(drawShiftBanner); else if (k === 'opencart') { root.querySelector('#cart').classList.add('open'); drawCart(); } return; }
      const act = e.target.closest('[data-a]'); if (act) { const f = A[act.dataset.a]; if (f) { e.stopPropagation(); Promise.resolve(f(act.dataset.id, act)).catch(er => { console.error(er); toast(er.message, 'err'); }); } return; }
      const ln = e.target.closest('.cl[data-line]'); if (ln) { state.sel = ln.dataset.line; view.querySelectorAll('.cl').forEach(x => x.classList.toggle('sel', x === ln)); }
    });
    // اختصارات لوحة المفاتيح + التقاط مدخلات قارئ الباركود حتى لو لم يكن الحقل مفعّلاً
    const onKey = e => {
      if (!root || document.querySelector('.ov') || document.getElementById('cam')) return;
      const tag = e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const F = { F2: () => q.focus(), F4: () => A.holds(), F6: () => A.cust(), F8: () => checkout(), F9: () => A.invdisc(), End: () => checkout() };
      if (F[e.key]) { e.preventDefault(); F[e.key](); return; }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (!typing) {
        if (e.key === 'Delete' && state.sel) { A.rm(state.sel); return; }
        if ((e.key === '+' || e.key === '=') && state.sel && !isWeighed(store.get('products', state.sel)?.unit)) { A.pl(state.sel); e.preventDefault(); return; }
        if ((e.key === '-' || e.key === '_') && state.sel && !isWeighed(store.get('products', state.sel)?.unit)) { A.mi(state.sel); e.preventDefault(); return; }
        if (e.key.length === 1 && /[\w؀-ۿ]/.test(e.key)) { q.focus(); }
      }
    };
    document.addEventListener('keydown', onKey); cleanup.push(() => document.removeEventListener('keydown', onKey));
    setTimeout(() => !matchMedia('(pointer:coarse)').matches && q.focus(), 50);
  },
  // تحديث خفيف عند تغيّر البيانات دون فقدان حالة البحث أو السلة
  onChange(names) { if (!root) return; if (names.has('products') || names.has('offers') || names.has('categories') || names.has('meta')) { cart.lines = cart.lines.filter(l => store.get('products', l.pid)); drawGrid(); } drawCart(); drawShiftBanner(); },
};

function showKeys() {
  const rows = [['F2', 'التركيز على البحث / الباركود'], ['Enter', 'إضافة المنتج المطابق (باركود أو اسم)'], ['F8 أو End', 'إتمام البيع'], ['Enter (في نافذة الدفع)', 'تأكيد البيع'], ['F1 / F2 / F3 (في نافذة الدفع)', 'نقدي / بطاقة / محفظة'], ['F4', 'الفواتير المعلّقة'], ['F6', 'اختيار الزبون'], ['F9', 'خصم على الفاتورة'], ['+ / −', 'زيادة / تقليل كمية الصنف المحدد'], ['Delete', 'حذف الصنف المحدد'], ['Esc', 'مسح البحث / إغلاق النافذة']];
  modal({ title: 'اختصارات لوحة المفاتيح', body: html`<div>${rows.map(([k, d]) => html`<div class="kv"><span><kbd>${k}</kbd></span><b style="font-weight:600">${d}</b></div>`)}</div><div class="muted small">قارئ الباركود الخارجي يعمل مباشرة: يكتب الرقم ثم Enter فيُضاف المنتج تلقائياً.</div>` });
}
