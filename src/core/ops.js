// العمليات التجارية: كل دالة تتحقق من المدخلات والصلاحيات ثم تكتب كل التغييرات المرتبطة بها
// (فاتورة + مخزون + حركات + عميل + تدقيق ...) في معاملة IndexedDB واحدة: إما تنجح كلها أو تفشل كلها.
import * as db from './db.js';
import * as store from './store.js';
import { get, list, settings } from './store.js';
import { calcCart, settle, paymentLines, pickOffer, unitRefund } from './calc.js';
import { uid, nowISO, r2, r3, num, latinDigits, todayKey, pad, sortBy, fmt, deepMerge, dayKey } from './util.js';
import { can, who, current, hashPin } from './auth.js';

const E = (m, code) => { const e = new Error(m); if (code) e.code = code; return e; };
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const need = (perm, msg) => { if (!can(perm)) throw E(msg || 'ليست لديك صلاحية تنفيذ هذه العملية', 'NO_PERM'); };

// مسودة تغييرات: تحتفظ بنسخ عمل من السجلات المعدّلة ولا تلمس الذاكرة إلا بعد نجاح الكتابة
class Draft {
  constructor() { this.ch = { put: {}, del: {} }; this.w = new Map(); }
  edit(s, id) { const k = s + '/' + id; if (!this.w.has(k)) { const o = get(s, id); if (!o) throw E('سجل غير موجود (' + s + ')'); this.w.set(k, [s, structuredClone(o)]); } return this.w.get(k)[1]; }
  put(s, rec) { (this.ch.put[s] ||= []).push(rec); return rec; }
  del(s, id) { (this.ch.del[s] ||= []).push(id); this.w.delete(s + '/' + id); }
  audit(action, entity, ref, detail) { this.put('audit', { id: uid(), t: nowISO(), ...who(), action, entity, ref: ref || '', detail: detail || '' }); }
  done() { for (const [s, rec] of this.w.values()) { if (!(this.ch.del[s] || []).includes(rec.id)) (this.ch.put[s] ||= []).push(rec); } return this.ch; }
}
// عند التعارض مع جهاز آخر (الوضع السحابي) تُحدَّث البيانات وتُعاد العملية على الأحدث بدل إظهار خطأ للمستخدم
const run = async (fn) => {
  for (let i = 0; ; i++) {
    const d = new Draft(); const result = await fn(d);
    try { await db.commit(d.done()); return result; }
    catch (e) { if (e.code === 'CONFLICT' && i < 3) { await db.refresh(); continue; } throw e; }
  }
};

// ---------- المخزون الأساسي ----------
function move(d, p, delta, type, o = {}) {
  const before = p.stock; p.stock = r3(p.stock + delta);
  d.put('moves', { id: uid(), t: nowISO(), pid: p.id, pname: p.name, type, qty: r3(delta), before, after: p.stock, reason: o.reason || '', ref: o.ref || '', refNo: o.refNo || '', ...who() });
}
function deductBatches(d, pid, qty) {
  let left = qty; const used = [];
  const bs = sortBy(list('batches').filter(b => b.pid === pid && b.qty > 0), b => b.expiry || '9999-99-99');
  for (const b0 of bs) { if (left <= 0) break; const b = d.edit('batches', b0.id); const take = Math.min(b.qty, left); b.qty = r3(b.qty - take); left = r3(left - take); used.push({ bid: b.id, q: take }); }
  return used;
}
function restoreBatches(d, used) { for (const u of used || []) { if (get('batches', u.bid)) { const b = d.edit('batches', u.bid); b.qty = r3(b.qty + u.q); } } }
const ctx = () => ({ getProduct: id => get('products', id), offerFor: pid => pickOffer(list('offers'), pid, todayKey()), tax: settings().tax });
export const cartCtx = ctx;

// ---------- المنتجات ----------
const UNIT_OK = ['pc', 'kg', 'g'];
export function cleanProduct(data, cur, o = {}) {
  const S = settings();
  const name = String(data.name ?? cur?.name ?? '').trim(); if (!name) throw E('اسم المنتج مطلوب');
  if (name.length > 150) throw E('اسم المنتج طويل جداً');
  const price = num(data.price ?? cur?.price); if (!isFinite(price) || price < 0) throw E('سعر البيع غير صحيح');
  const rawCost = data.cost === undefined ? (cur ? cur.cost : null) : data.cost;
  const cost = rawCost === '' || rawCost == null ? null : num(rawCost); if (cost != null && (!isFinite(cost) || cost < 0)) throw E('سعر الشراء غير صحيح');
  const unit = UNIT_OK.includes(data.unit) ? data.unit : (cur?.unit || 'pc');
  const barcode = latinDigits(String(data.barcode ?? cur?.barcode ?? '')).trim();
  const code = latinDigits(String(data.code ?? cur?.code ?? '')).trim();
  const other = (bc) => { const x = store.byBarcode(bc); return x && x.id !== cur?.id ? x : null; };
  if (barcode) { const x = other(barcode); if (x || o.usedBc?.has(barcode)) throw E('الباركود مسجّل لمنتج آخر' + (x ? ': ' + x.name : '')); }
  if (code) { const x = store.byCode(code); if ((x && x.id !== cur?.id) || o.usedCode?.has(code)) throw E('الكود الداخلي مستخدم لمنتج آخر'); }
  const stockIn = data.stock === undefined ? cur?.stock ?? 0 : num(data.stock);
  if (!isFinite(stockIn) || (stockIn < 0 && !S.stock.allowNegative)) throw E('الكمية لا يمكن أن تكون سالبة');
  const minRaw = data.min === undefined ? cur?.min : data.min;
  const min = minRaw === '' || minRaw == null ? null : num(minRaw); if (min != null && (!isFinite(min) || min < 0)) throw E('الحد الأدنى غير صحيح');
  const expiry = data.expiry === undefined ? (cur?.expiry || '') : String(data.expiry || ''); if (expiry && !isDate(expiry)) throw E('تاريخ انتهاء الصلاحية غير صحيح');
  const cat = data.cat === undefined ? (cur?.cat || '') : (data.cat && (get('categories', data.cat) || o.newCats?.has(data.cat)) ? data.cat : '');
  const supplierId = data.supplierId === undefined ? (cur?.supplierId || '') : (data.supplierId && get('suppliers', data.supplierId) ? data.supplierId : '');
  const img = data.img === undefined ? (cur?.img ?? null) : data.img;
  if (img && String(img).length > 400000) throw E('حجم صورة المنتج كبير جداً');
  return { name, price: Math.round(price * 1000) / 1000, cost: cost == null ? null : Math.round(cost * 1000) / 1000, unit, barcode, code, stock: r3(stockIn), min, expiry, cat, supplierId, desc: String(data.desc ?? cur?.desc ?? '').trim().slice(0, 500), hideOnline: data.online === undefined ? !!cur?.hideOnline : !data.online, img: img || null, track: data.track === undefined ? (cur ? cur.track !== false : true) : !!data.track, active: data.active === undefined ? (cur ? cur.active !== false : true) : !!data.active };
}
export const productUsage = pid => {
  for (const i of list('invoices')) if (i.items.some(l => l.pid === pid)) return 'الفواتير';
  for (const p of list('purchases')) if (p.items.some(l => l.pid === pid)) return 'فواتير الشراء';
  for (const r of list('returns')) if (r.items.some(l => l.pid === pid)) return 'المرتجعات';
  return '';
};

function productDraft(d, data, id, o = {}) {
  const cur = id ? get('products', id) : null; if (id && !cur) throw E('المنتج غير موجود');
  const f = cleanProduct(data, cur, o);
  if (cur && f.unit !== cur.unit && productUsage(id)) throw E('لا يمكن تغيير وحدة البيع لمنتج مرتبط بعمليات سابقة');
  const t = nowISO();
  if (!cur) {
    const p = { id: uid(), ...f, stock: 0, createdAt: t, updatedAt: t };
    d.put('products', p);
    if (f.stock !== 0) { const w = { ...p, stock: 0 }; if (f.track) move(d, w, f.stock, 'initial', { reason: 'رصيد افتتاحي' }); else w.stock = f.stock; p.stock = w.stock; if (f.track && f.expiry && f.stock > 0) d.put('batches', { id: uid(), pid: p.id, qty: f.stock, expiry: f.expiry, cost: f.cost, t, note: 'رصيد افتتاحي' }); }
    d.audit('product.create', 'product', p.id, p.name);
    return p;
  }
  const p = d.edit('products', id); const oldPrice = p.price, oldStock = p.stock;
  Object.assign(p, f, { stock: oldStock, updatedAt: t });
  if (f.track && f.stock !== oldStock) { move(d, p, r3(f.stock - oldStock), f.stock > oldStock ? 'adjust_add' : 'adjust_sub', { reason: o.reason || 'تعديل من بطاقة المنتج' }); if (f.stock < oldStock) deductBatches(d, id, r3(oldStock - f.stock)); }
  else if (!f.track) p.stock = f.stock;
  d.audit('product.update', 'product', id, p.name + (oldPrice !== p.price ? ` (السعر ${fmt(oldPrice)}→${fmt(p.price)})` : ''));
  return p;
}
export async function saveProduct(data, id = null) { need('products.edit'); return run(d => productDraft(d, data, id)); }

export async function importProducts(rows, { update = true } = {}) {
  need('products.edit');
  const res = { added: 0, updated: 0, skipped: 0, errors: [] };
  const d = new Draft(); const usedBc = new Set(), usedCode = new Set(), newCats = new Set(); const catByName = new Map(list('categories').map(c => [c.name.trim(), c]));
  const ensureCat = nm => { nm = String(nm || '').trim(); if (!nm) return ''; let c = catByName.get(nm); if (!c) { c = { id: uid(), name: nm, color: '' }; catByName.set(nm, c); newCats.add(c.id); d.put('categories', c); } return c.id; };
  rows.forEach((r, i) => {
    try {
      const bc = latinDigits(String(r.barcode ?? '')).trim(); const ex = bc ? store.byBarcode(bc) : null;
      const data = { ...r }; if ('catName' in r) { data.cat = ensureCat(r.catName); delete data.catName; }
      if (ex && !usedBc.has(bc)) { if (!update) { res.skipped++; return; } const clean = {}; for (const k of Object.keys(data)) if (data[k] !== '' && data[k] != null) clean[k] = data[k]; productDraft(d, clean, ex.id, { usedBc, usedCode, newCats, reason: 'تعديل عبر استيراد ملف' }); res.updated++; }
      else { productDraft(d, data, null, { usedBc, usedCode, newCats, reason: 'تعديل عبر استيراد ملف' }); res.added++; }
      if (bc) usedBc.add(bc); if (data.code) usedCode.add(String(data.code));
    } catch (e) { res.errors.push({ row: i + 1, msg: e.message }); }
  });
  d.audit('product.import', 'product', '', `إضافة ${res.added} / تحديث ${res.updated}`);
  await db.commit(d.done()); return res;
}

export async function deleteProduct(id) {
  need('products.delete');
  const p = get('products', id); if (!p) throw E('المنتج غير موجود');
  const u = productUsage(id); if (u) throw E(`لا يمكن حذف "${p.name}" لأنه مرتبط بعمليات في ${u}. يمكنك أرشفته بدلاً من ذلك.`, 'IN_USE');
  return run(d => { d.del('products', id); for (const b of list('batches')) if (b.pid === id) d.del('batches', b.id); for (const o of list('offers')) if (o.pid === id) d.del('offers', o.id); for (const m of list('moves')) if (m.pid === id) d.del('moves', m.id); d.audit('product.delete', 'product', id, p.name); });
}
export async function archiveProduct(id, archived = true) { need('products.edit'); return run(d => { const p = d.edit('products', id); p.active = !archived; d.audit(archived ? 'product.archive' : 'product.restore', 'product', id, p.name); }); }

// ---------- التصنيفات والعروض ----------
export async function saveCategory({ id, name, color }) {
  need('products.edit'); name = String(name || '').trim(); if (!name) throw E('اسم التصنيف مطلوب');
  if (list('categories').some(c => c.name === name && c.id !== id)) throw E('التصنيف موجود مسبقاً');
  return run(d => { const c = id ? d.edit('categories', id) : d.put('categories', { id: uid(), name, color: '' }); c.name = name; if (color !== undefined) c.color = color; d.audit('category.save', 'category', c.id, name); return c; });
}
export async function deleteCategory(id) {
  need('products.edit');
  return run(d => { for (const p of list('products')) if (p.cat === id) d.edit('products', p.id).cat = ''; d.del('categories', id); d.audit('category.delete', 'category', id, get('categories', id)?.name); });
}
export async function saveOffer(data) {
  need('products.edit');
  const p = get('products', data.pid); if (!p) throw E('اختر المنتج');
  if (!['pct', 'fixed', 'bogo'].includes(data.type)) throw E('نوع العرض غير صحيح');
  const value = num(data.value || 0), buy = Math.max(1, Math.floor(num(data.buy || 1))), gt = Math.max(1, Math.floor(num(data.get || 1)));
  if (data.type === 'pct' && !(value > 0 && value <= 100)) throw E('نسبة الخصم يجب أن تكون بين 0 و100');
  if (data.type === 'fixed' && !(value > 0 && value < p.price)) throw E('قيمة الخصم يجب أن تكون أقل من سعر المنتج');
  if (data.type === 'bogo' && p.unit !== 'pc') throw E('عرض (اشترِ واحداً واحصل على آخر) متاح للمنتجات بالقطعة فقط');
  if (data.start && !isDate(data.start) || data.end && !isDate(data.end)) throw E('تاريخ غير صحيح');
  if (data.start && data.end && data.end < data.start) throw E('تاريخ نهاية العرض قبل بدايته');
  return run(d => { const o = data.id ? d.edit('offers', data.id) : d.put('offers', { id: uid(), createdAt: nowISO() }); Object.assign(o, { pid: p.id, type: data.type, value: data.type === 'bogo' ? 0 : value, buy, get: gt, start: data.start || '', end: data.end || '', active: data.active !== false, name: String(data.name || '').trim() }); d.audit('offer.save', 'offer', o.id, p.name); return o; });
}
export async function deleteOffer(id) { need('products.edit'); return run(d => { d.del('offers', id); d.audit('offer.delete', 'offer', id, ''); }); }

// ---------- تعديل المخزون والجرد ----------
export const ADJ_REASONS_SUB = ['تالف', 'منتهي الصلاحية', 'فقد / سرقة', 'استخدام داخلي', 'خطأ في الإدخال', 'أخرى'];
export async function adjustStock({ pid, mode, qty, reason = '', expiry = '', enableTrack = false }) {
  need('inventory.adjust');
  const q = num(qty); if (!isFinite(q) || q < 0 || (mode !== 'set' && q === 0)) throw E('أدخل كمية صحيحة');
  if (!['add', 'sub', 'set'].includes(mode)) throw E('نوع التعديل غير صحيح');
  if (mode !== 'add' && !String(reason).trim()) throw E('سبب التعديل مطلوب');
  if (expiry && !isDate(expiry)) throw E('تاريخ الصلاحية غير صحيح');
  return run(d => {
    const p = d.edit('products', pid);
    if (!p.track) { if (!enableTrack) throw E('هذا المنتج غير مُتتبّع المخزون — فعّل التتبع أولاً', 'UNTRACKED'); p.track = true; p.stock = 0; }
    const delta = mode === 'add' ? q : mode === 'sub' ? -q : r3(q - p.stock);
    if (delta === 0) return p;
    if (p.stock + delta < 0 && !settings().stock.allowNegative) throw E(`الكمية المتوفرة من "${p.name}" هي ${p.stock} فقط`);
    const type = mode === 'add' ? 'receive' : mode === 'sub' ? 'adjust_sub' : (delta > 0 ? 'adjust_add' : 'adjust_sub');
    move(d, p, delta, type, { reason: String(reason).trim() || (mode === 'add' ? 'إضافة مخزون' : '') });
    if (delta > 0 && expiry) d.put('batches', { id: uid(), pid, qty: delta, expiry, cost: p.cost, t: nowISO(), note: reason || 'إضافة مخزون' });
    if (delta < 0) deductBatches(d, pid, -delta);
    p.updatedAt = nowISO(); d.audit('stock.adjust', 'product', pid, `${p.name}: ${delta > 0 ? '+' : ''}${delta} (${reason || type})`);
    return p;
  });
}
export async function stockCount(items, note = '') {
  need('inventory.adjust');
  if (!items.length) throw E('لا توجد بنود للجرد');
  return run(d => {
    const rec = { id: uid(), t: nowISO(), ...who(), note: String(note || '').trim(), items: [] };
    for (const it of items) {
      const c = num(it.counted); if (!isFinite(c) || c < 0) throw E('كمية الجرد غير صحيحة');
      const p = d.edit('products', it.pid); if (!p.track) continue;
      const diff = r3(c - p.stock);
      rec.items.push({ pid: p.id, name: p.name, unit: p.unit, system: p.stock, counted: r3(c), diff, costDiff: r2(diff * (p.cost || 0)) });
      if (diff !== 0) { move(d, p, diff, 'count', { reason: 'جرد' + (rec.note ? ': ' + rec.note : ''), ref: rec.id }); if (diff < 0) deductBatches(d, p.id, -diff); }
    }
    d.put('counts', rec); d.audit('stock.count', 'count', rec.id, `${rec.items.length} صنف، ${rec.items.filter(i => i.diff).length} فرق`);
    return rec;
  });
}

// ---------- البيع ----------
export async function completeSale({ cart, payments, customerId = '', note = '', approvedBy = null }) {
  need('pos.sell', 'ليست لديك صلاحية البيع');
  const S = settings(), u = current();
  const shift = store.currentShift(u.id);
  if (S.pos.requireShift && !shift) throw E('افتح الوردية أولاً قبل البيع', 'NO_SHIFT');
  const c = calcCart(cart, ctx());
  if (!c.count) throw E('الفاتورة فارغة');
  if (c.count !== (cart.lines || []).length) throw E('بعض المنتجات في السلة لم تعد موجودة — أعد تحديث السلة');
  for (const l of c.lines) { if (!(l.qty > 0)) throw E('كمية غير صحيحة للمنتج ' + l.name); if (l.net < 0) throw E('إجمالي بند سالب'); }
  if (c.manualDisc > 0) {
    need('pos.discount', 'ليست لديك صلاحية تطبيق خصومات');
    if (c.manualPct > S.pos.maxDiscPct + 1e-9 && !can('pos.bigDiscount') && !approvedBy) throw E(`الخصم (${fmt(c.manualPct)}%) يتجاوز الحد المسموح (${S.pos.maxDiscPct}%) ويحتاج موافقة المدير`, 'NEED_APPROVAL');
  }
  if (!S.stock.allowNegative) for (const l of c.lines) { const p = get('products', l.pid); if (p.track && p.stock + 1e-9 < l.qty) throw E(`الكمية المتوفرة من "${p.name}" هي ${p.stock} فقط`, 'STOCK'); }
  const st = settle(c.total, payments);
  const cust = customerId ? get('customers', customerId) : null;
  if (customerId && !cust) throw E('الزبون غير موجود');
  if (st.credit > 0) {
    need('pos.credit', 'ليست لديك صلاحية البيع الآجل');
    if (!cust) throw E('اختر الزبون لتسجيل الدين عليه', 'NEED_CUSTOMER');
    if (cust.creditLimit > 0 && store.customerBalance(cust.id) + st.credit > cust.creditLimit + 1e-9) throw E(`تجاوز سقف دين الزبون (${fmt(cust.creditLimit)})`);
  }
  const { result } = await db.atomic(['invoices', 'products', 'moves', 'batches', 'audit'], counters => {
    const d = new Draft(); const n = (counters.invoice || 0) + 1; counters.invoice = n;
    const no = S.invoice.prefix + pad(n, S.invoice.pad);
    const items = c.lines.map(l => ({ ...l, returned: 0, batches: [] }));
    const id = uid(), t = nowISO();
    for (const it of items) {
      const p = d.edit('products', it.pid);
      if (p.track && !S.stock.allowNegative && p.stock + 1e-9 < it.qty) throw E(`الكمية المتوفرة من "${p.name}" هي ${p.stock} فقط`, 'STOCK');
      if (p.track) { it.batches = deductBatches(d, p.id, it.qty); move(d, p, -it.qty, 'sale', { ref: id, refNo: no }); }
    }
    const pays = paymentLines(st); const kinds = pays.length + (st.credit > 0 ? 1 : 0);
    const inv = { id, no, t, ...who(), shiftId: shift?.id || '', customerId: cust?.id || '', customerName: cust?.name || '', items, subtotal: c.subtotal, offerDisc: c.offerDisc, lineDisc: c.lineDisc, invDisc: c.invDisc, discount: c.discount, taxable: c.taxable, tax: c.tax, taxRate: c.taxRate, taxInclusive: c.taxInclusive, total: c.total, net: c.net, payments: pays, received: st.received, change: st.change, due: st.credit, paid: r2(c.total - st.credit), method: kinds > 1 ? 'mixed' : st.credit > 0 ? 'credit' : (pays[0]?.method || 'cash'), note: String(note || '').trim(), status: 'done', returnedTotal: 0, later: [], approvedBy: approvedBy?.name || '' };
    d.put('invoices', inv); d.audit('sale.create', 'invoice', id, `${no} — ${fmt(c.total)}`);
    return { ch: d.done(), result: inv };
  });
  return result;
}

export async function voidInvoice(id, reason) {
  need('invoices.void', 'إلغاء الفاتورة يحتاج صلاحية المدير');
  if (!String(reason || '').trim()) throw E('سبب الإلغاء مطلوب');
  const inv = get('invoices', id); if (!inv) throw E('الفاتورة غير موجودة');
  if (inv.status === 'void') throw E('الفاتورة ملغاة مسبقاً');
  if (inv.returnedTotal > 0) throw E('لا يمكن إلغاء فاتورة عليها مرتجعات');
  if ((inv.later || []).length) throw E('لا يمكن إلغاء فاتورة سُدّدت دفعات من دينها');
  return run(d => {
    const i = d.edit('invoices', id);
    for (const it of i.items) { const p = it.pid && get('products', it.pid); if (p && p.track) { const w = d.edit('products', p.id); move(d, w, it.qty, 'void', { reason: 'إلغاء فاتورة ' + i.no, ref: id, refNo: i.no }); restoreBatches(d, it.batches); } }
    const cashRefund = r2((i.payments || []).filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0));
    i.status = 'void'; i.void = { t: nowISO(), ...who(), reason: String(reason).trim(), shiftId: store.currentShift(who().userId)?.id || '', cashRefund };
    d.audit('invoice.void', 'invoice', id, `${i.no}: ${reason}`);
    return i;
  });
}
export async function deleteInvoice(id) {
  need('invoices.void'); const inv = get('invoices', id); if (!inv) throw E('الفاتورة غير موجودة');
  if (!(inv.legacy || inv.status === 'void')) throw E('يمكن حذف الفواتير القديمة أو الملغاة فقط — ألغِ الفاتورة أولاً');
  return run(d => { d.del('invoices', id); d.audit('invoice.delete', 'invoice', id, inv.no); });
}

// ---------- المرتجعات ----------
export async function createReturn({ invoiceId, items, reason, method = 'cash', refundAmount = null, note = '' }) {
  need('returns.create', 'تنفيذ المرتجعات يحتاج صلاحية');
  const inv = get('invoices', invoiceId); if (!inv) throw E('الفاتورة الأصلية غير موجودة');
  if (inv.status === 'void') throw E('الفاتورة ملغاة');
  if (inv.legacy) throw E('لا يمكن إجراء مرتجع على فاتورة مرحّلة من النسخة القديمة (لا تحتوي تفاصيل المنتجات)');
  if (!String(reason || '').trim()) throw E('سبب الإرجاع مطلوب');
  const rows = (items || []).filter(x => num(x.qty) > 0); if (!rows.length) throw E('حدد منتجاً وكمية للإرجاع');
  if (!['cash', 'card', 'wallet'].includes(method)) throw E('طريقة الاسترداد غير صحيحة');
  const { result } = await db.atomic(['returns', 'invoices', 'products', 'moves', 'audit'], counters => {
    const d = new Draft(); const S = settings(); const n = (counters.ret || 0) + 1; counters.ret = n;
    const no = S.invoice.retPrefix + pad(n, S.invoice.pad);
    const i = d.edit('invoices', invoiceId);
    let computed = 0; const lines = [];
    for (const r of rows) {
      const line = i.items[r.idx]; if (!line) throw E('بند غير موجود في الفاتورة');
      const q = r3(num(r.qty)); const left = r3(line.qty - (line.returned || 0));
      if (q > left + 1e-9) throw E(`الكمية المرتجعة من "${line.name}" تتجاوز المتاح (${left})`);
      if (line.unit === 'pc' && !Number.isInteger(q)) throw E('الكمية يجب أن تكون عدداً صحيحاً');
      const cond = ['good', 'damaged', 'expired'].includes(r.condition) ? r.condition : 'good';
      const refund = r2(unitRefund(i, line) * q); computed = r2(computed + refund);
      lines.push({ idx: r.idx, pid: line.pid, name: line.name, unit: line.unit, qty: q, refund, cost: line.cost, condition: cond });
    }
    let total = computed;
    if (refundAmount != null && refundAmount !== '') { const a = r2(num(refundAmount)); if (!isFinite(a) || a < 0 || a > computed + 0.0001) throw E('مبلغ الاسترداد يجب أن يكون بين 0 و' + fmt(computed)); const k = computed > 0 ? a / computed : 0; lines.forEach(l => l.refund = r2(l.refund * k)); total = a; }
    const tax = i.total > 0 ? r2(total * i.tax / i.total) : 0;
    const debtCut = r2(Math.min(i.due || 0, total)); const cashOut = r2(total - debtCut);
    const shift = store.currentShift(who().userId);
    for (const l of lines) {
      const li = i.items[l.idx]; li.returned = r3((li.returned || 0) + l.qty);
      const p = l.pid && get('products', l.pid);
      l.restock = l.condition === 'good' && !!p && p.track;
      if (l.restock) { const w = d.edit('products', p.id); move(d, w, l.qty, 'return', { reason: 'مرتجع ' + no, ref: i.id, refNo: no }); }
    }
    i.returnedTotal = r2((i.returnedTotal || 0) + total); i.due = r2((i.due || 0) - debtCut); // الجزء المسترد من الدين لا يُعدّ دفعاً
    const rec = { id: uid(), no, t: nowISO(), ...who(), shiftId: shift?.id || '', invoiceId: i.id, invoiceNo: i.no, customerId: i.customerId, items: lines, reason: String(reason).trim(), note: String(note || '').trim(), refund: total, tax, net: r2(total - tax), debtCut, cashOut, method, restockCost: r2(lines.filter(l => l.restock).reduce((s, l) => s + l.cost * l.qty, 0)) };
    d.put('returns', rec); d.audit('return.create', 'return', rec.id, `${no} على ${i.no} — ${fmt(total)}`);
    return { ch: d.done(), result: rec };
  });
  return result;
}

// ---------- الموردون والمشتريات ----------
export async function saveSupplier({ id, name, phone = '', address = '', notes = '' }) {
  need('purchases.manage'); name = String(name || '').trim(); if (!name) throw E('اسم المورد مطلوب');
  if (list('suppliers').some(s => s.name === name && s.id !== id)) throw E('المورد موجود مسبقاً');
  return run(d => { const s = id ? d.edit('suppliers', id) : d.put('suppliers', { id: uid(), createdAt: nowISO() }); Object.assign(s, { name, phone: String(phone).trim(), address: String(address).trim(), notes: String(notes).trim() }); d.audit('supplier.save', 'supplier', s.id, name); return s; });
}
export async function deleteSupplier(id) {
  need('purchases.manage'); const s = get('suppliers', id); if (!s) throw E('المورد غير موجود');
  if (list('purchases').some(p => p.supplierId === id)) throw E('لا يمكن حذف مورد لديه فواتير شراء');
  return run(d => { for (const p of list('products')) if (p.supplierId === id) d.edit('products', p.id).supplierId = ''; d.del('suppliers', id); d.audit('supplier.delete', 'supplier', id, s.name); });
}

function cleanPurchaseItems(items) {
  const m = new Map();
  for (const it of items || []) {
    const p = get('products', it.pid); if (!p) throw E('منتج غير موجود في الفاتورة');
    const qty = r3(num(it.qty)), cost = num(it.cost);
    if (!(qty > 0)) throw E('كمية غير صحيحة للمنتج ' + p.name); if (!isFinite(cost) || cost < 0) throw E('سعر شراء غير صحيح للمنتج ' + p.name);
    if (it.expiry && !isDate(it.expiry)) throw E('تاريخ صلاحية غير صحيح للمنتج ' + p.name);
    const key = p.id + '|' + (it.expiry || '') + '|' + cost;
    if (m.has(key)) m.get(key).qty = r3(m.get(key).qty + qty); else m.set(key, { pid: p.id, name: p.name, unit: p.unit, qty, cost, expiry: it.expiry || '', total: 0 });
  }
  const out = [...m.values()]; out.forEach(i => i.total = r2(i.qty * i.cost)); if (!out.length) throw E('أضف منتجاً واحداً على الأقل'); return out;
}
function applyPurchase(d, pur, { enableTrack }) {
  const S = settings();
  for (const it of pur.items) {
    const p = d.edit('products', it.pid);
    if (!p.track && enableTrack) { p.track = true; p.stock = 0; }
    const oldStock = p.track ? Math.max(0, p.stock) : 0;
    if (S.cost.method === 'avg' && p.cost != null && oldStock > 0) p.cost = Math.round((oldStock * p.cost + it.qty * it.cost) / (oldStock + it.qty) * 1000) / 1000; else p.cost = it.cost;
    if (p.track) { move(d, p, it.qty, 'purchase', { reason: 'فاتورة شراء ' + pur.no, ref: pur.id, refNo: pur.no }); if (it.expiry) d.put('batches', { id: uid(), pid: p.id, qty: it.qty, expiry: it.expiry, cost: it.cost, purchaseId: pur.id, t: nowISO(), note: pur.no }); }
    p.updatedAt = nowISO();
  }
}
function payRec(d, kind, party, amount, method, note, extra = {}) {
  const sh = store.currentShift(who().userId);
  return d.put('payments', { id: uid(), t: nowISO(), kind, partyId: party.id, partyName: party.name, amount: r2(amount), method, note: String(note || '').trim(), ...who(), shiftId: sh?.id || '', ...extra });
}
const PAY_METHODS = ['cash', 'card', 'wallet', 'transfer'];
// data: {id?, supplierId, date:'YYYY-MM-DD', items:[{pid,qty,cost,expiry}], discount, paid, method, note, status:'draft'|'approved', enableTrack}
export async function savePurchase(data) {
  need('purchases.manage');
  const sup = get('suppliers', data.supplierId); if (!sup) throw E('اختر المورد');
  const date = data.date || todayKey(); if (!isDate(date)) throw E('تاريخ الشراء غير صحيح');
  const items = cleanPurchaseItems(data.items);
  const subtotal = r2(items.reduce((s, i) => s + i.total, 0));
  const discount = r2(num(data.discount || 0)); if (!(discount >= 0) || discount > subtotal) throw E('الخصم غير صحيح');
  const total = r2(subtotal - discount);
  const approve = data.status === 'approved';
  const paid = approve ? r2(num(data.paid || 0)) : 0; if (!(paid >= 0) || paid > total + 0.0001) throw E('المبلغ المدفوع يتجاوز إجمالي الفاتورة');
  const method = PAY_METHODS.includes(data.method) ? data.method : 'cash';
  if (data.id) { const ex = get('purchases', data.id); if (!ex) throw E('الفاتورة غير موجودة'); if (ex.status === 'approved') throw E('لا يمكن تعديل فاتورة شراء معتمدة'); }
  const { result } = await db.atomic(['purchases', 'products', 'moves', 'batches', 'payments', 'audit'], counters => {
    const d = new Draft(); const S = settings();
    let pur;
    if (data.id) pur = d.edit('purchases', data.id); else { const n = (counters.purchase || 0) + 1; counters.purchase = n; pur = d.put('purchases', { id: uid(), no: S.invoice.purPrefix + pad(n, S.invoice.pad), createdAt: nowISO(), ...who() }); }
    Object.assign(pur, { supplierId: sup.id, supplierName: sup.name, date, items, subtotal, discount, total, note: String(data.note || '').trim(), status: approve ? 'approved' : 'draft', paid: 0, due: approve ? total : 0 });
    if (approve) {
      applyPurchase(d, pur, { enableTrack: !!data.enableTrack });
      if (paid > 0) { payRec(d, 'supplier', sup, paid, method, 'دفعة عند اعتماد ' + pur.no, { ref: pur.id, refNo: pur.no, alloc: [{ ref: pur.id, amount: paid }] }); pur.paid = paid; pur.due = r2(total - paid); }
      pur.approvedAt = nowISO(); d.audit('purchase.approve', 'purchase', pur.id, `${pur.no} — ${fmt(total)}`);
    } else d.audit('purchase.draft', 'purchase', pur.id, pur.no);
    return { ch: d.done(), result: pur };
  });
  return result;
}
export async function approvePurchase(id, { paid = 0, method = 'cash', enableTrack = false } = {}) {
  need('purchases.manage'); const p = get('purchases', id); if (!p) throw E('الفاتورة غير موجودة'); if (p.status === 'approved') throw E('الفاتورة معتمدة مسبقاً');
  return savePurchase({ id, supplierId: p.supplierId, date: p.date, items: p.items, discount: p.discount, note: p.note, status: 'approved', paid, method, enableTrack });
}
export async function deletePurchaseDraft(id) { need('purchases.manage'); const p = get('purchases', id); if (!p) throw E('الفاتورة غير موجودة'); if (p.status !== 'draft') throw E('لا يمكن حذف فاتورة معتمدة'); return run(d => { d.del('purchases', id); d.audit('purchase.delete', 'purchase', id, p.no); }); }

function allocate(d, kind, items, amount, store_) {
  let left = r2(amount); const alloc = [];
  for (const it of items) { if (left <= 0) break; const x = d.edit(store_, it.id); const a = r2(Math.min(x.due, left)); x.due = r2(x.due - a); left = r2(left - a); alloc.push({ ref: x.id, no: x.no, amount: a }); if (store_ === 'purchases') x.paid = r2(x.paid + a); else { x.paid = r2((x.paid || 0) + a); } }
  return alloc;
}
export async function paySupplier(supplierId, amount, method = 'cash', note = '', purchaseId = null) {
  need('purchases.manage'); const sup = get('suppliers', supplierId); if (!sup) throw E('المورد غير موجود');
  const a = r2(num(amount)); if (!(a > 0)) throw E('أدخل مبلغاً صحيحاً'); if (!PAY_METHODS.includes(method)) throw E('طريقة دفع غير صحيحة');
  let pend = sortBy(list('purchases').filter(p => p.supplierId === supplierId && p.status === 'approved' && p.due > 0), p => p.date + p.createdAt);
  if (purchaseId) pend = pend.filter(p => p.id === purchaseId);
  const debt = r2(pend.reduce((s, p) => s + p.due, 0)); if (a > debt + 0.0001) throw E('المبلغ يتجاوز المستحق للمورد (' + fmt(debt) + ')');
  return run(d => { const alloc = allocate(d, 'supplier', pend, a, 'purchases'); const rec = payRec(d, 'supplier', sup, a, method, note, { alloc }); d.audit('supplier.pay', 'supplier', supplierId, `${sup.name}: ${fmt(a)}`); return rec; });
}

// ---------- الزبائن والديون ----------
export async function saveCustomer({ id, name, phone = '', address = '', notes = '', creditLimit = 0 }) {
  need('customers.manage'); name = String(name || '').trim(); if (!name) throw E('اسم الزبون مطلوب');
  const lim = num(creditLimit || 0); if (!(lim >= 0)) throw E('سقف الدين غير صحيح');
  return run(d => { const c = id ? d.edit('customers', id) : d.put('customers', { id: uid(), createdAt: nowISO() }); Object.assign(c, { name, phone: String(phone).trim(), address: String(address).trim(), notes: String(notes).trim(), creditLimit: lim }); d.audit('customer.save', 'customer', c.id, name); return c; });
}
export async function deleteCustomer(id) {
  need('customers.manage'); const c = get('customers', id); if (!c) throw E('الزبون غير موجود');
  if (list('invoices').some(i => i.customerId === id)) throw E('لا يمكن حذف زبون لديه فواتير');
  return run(d => { d.del('customers', id); d.audit('customer.delete', 'customer', id, c.name); });
}
export async function payCustomer(customerId, amount, method = 'cash', note = '') {
  need('customers.manage'); const c = get('customers', customerId); if (!c) throw E('الزبون غير موجود');
  const a = r2(num(amount)); if (!(a > 0)) throw E('أدخل مبلغاً صحيحاً'); if (!['cash', 'card', 'wallet'].includes(method)) throw E('طريقة دفع غير صحيحة');
  const pend = sortBy(list('invoices').filter(i => i.customerId === customerId && i.status !== 'void' && i.due > 0), i => i.t);
  const debt = r2(pend.reduce((s, i) => s + i.due, 0)); if (a > debt + 0.0001) throw E('المبلغ يتجاوز دين الزبون (' + fmt(debt) + ')');
  return run(d => {
    let left = a; const alloc = []; const rec = { id: uid() };
    for (const it of pend) { if (left <= 0) break; const i = d.edit('invoices', it.id); const x = r2(Math.min(i.due, left)); i.due = r2(i.due - x); i.paid = r2(i.paid + x); (i.later ||= []).push({ pid: rec.id, t: nowISO(), amount: x, method }); left = r2(left - x); alloc.push({ ref: i.id, no: i.no, amount: x }); }
    const sh = store.currentShift(who().userId);
    d.put('payments', Object.assign(rec, { t: nowISO(), kind: 'customer', partyId: c.id, partyName: c.name, amount: a, method, note: String(note || '').trim(), ...who(), shiftId: sh?.id || '', alloc }));
    d.audit('customer.pay', 'customer', customerId, `${c.name}: ${fmt(a)}`); return rec;
  });
}

// ---------- المصروفات ----------
export const EXPENSE_CATS = { rent: 'إيجار', electricity: 'كهرباء', wages: 'أجور', transport: 'نقل', other: 'مصاريف أخرى' };
export async function saveExpense({ id, date, category, amount, note = '', method = 'cash' }) {
  need('expenses.manage'); const a = r2(num(amount)); if (!(a > 0)) throw E('أدخل مبلغاً صحيحاً');
  if (!(category in EXPENSE_CATS)) throw E('اختر نوع المصروف'); date = date || todayKey(); if (!isDate(date)) throw E('تاريخ غير صحيح');
  if (!['cash', 'card', 'wallet', 'transfer'].includes(method)) throw E('طريقة دفع غير صحيحة');
  return run(d => { const e = id ? d.edit('expenses', id) : d.put('expenses', { id: uid(), createdAt: nowISO(), ...who(), shiftId: store.currentShift(who().userId)?.id || '' }); Object.assign(e, { date, category, amount: a, note: String(note).trim(), method }); d.audit('expense.save', 'expense', e.id, `${EXPENSE_CATS[category]} ${fmt(a)}`); return e; });
}
export async function deleteExpense(id) { need('expenses.manage'); const e = get('expenses', id); return run(d => { d.del('expenses', id); d.audit('expense.delete', 'expense', id, e ? `${EXPENSE_CATS[e.category]} ${fmt(e.amount)}` : ''); }); }

// ---------- الورديات ----------
export async function openShift(openingCash = 0) {
  need('shift.manage'); const a = r2(num(openingCash || 0)); if (!(a >= 0)) throw E('رصيد بداية الوردية غير صحيح');
  const w = who(); if (store.currentShift(w.userId)) throw E('لديك وردية مفتوحة بالفعل');
  return run(d => { const s = d.put('shifts', { id: uid(), ...w, openedAt: nowISO(), openingCash: a, status: 'open' }); d.audit('shift.open', 'shift', s.id, 'رصيد البداية ' + fmt(a)); return s; });
}
export async function closeShift(shiftId, countedCash, note = '', summary) {
  need('shift.manage'); const s = get('shifts', shiftId); if (!s || s.status !== 'open') throw E('الوردية غير مفتوحة');
  if (s.userId !== who().userId && !can('users.manage')) throw E('لا يمكنك إغلاق وردية موظف آخر');
  const c = r2(num(countedCash)); if (!(c >= 0)) throw E('أدخل النقدية الفعلية');
  return run(d => { const x = d.edit('shifts', shiftId); Object.assign(x, { status: 'closed', closedAt: nowISO(), counted: c, expected: summary.expectedCash, diff: r2(c - summary.expectedCash), note: String(note).trim(), summary }); d.audit('shift.close', 'shift', shiftId, `الفرق ${fmt(c - summary.expectedCash)}`); return x; });
}

// ---------- التعليق ----------
export async function saveHold(cart, name = '') { const rec = { id: uid(), t: nowISO(), name: String(name).trim(), ...who(), cart: structuredClone(cart) }; await db.commit({ put: { holds: [rec] }, del: {} }); return rec; }
export async function deleteHold(id) { await db.commit({ put: {}, del: { holds: [id] } }); }

// ---------- المستخدمون ----------
export async function saveUser({ id, name, role, pin, active = true }) {
  need('users.manage'); name = String(name || '').trim(); if (!name) throw E('اسم الموظف مطلوب');
  if (!['manager', 'cashier', 'stock', 'accountant'].includes(role)) throw E('الدور غير صحيح');
  if (!id && !pin) throw E('الرقم السري مطلوب'); if (pin && !/^\d{4,8}$/.test(latinDigits(pin))) throw E('الرقم السري يجب أن يكون من 4 إلى 8 أرقام');
  if (list('users').some(u => u.name === name && u.id !== id)) throw E('الاسم مستخدم لموظف آخر');
  const others = list('users').filter(u => u.id !== id && u.active !== false && u.role === 'manager');
  if (!others.length && !(role === 'manager' && active)) throw E('يجب أن يبقى مدير واحد فعّال على الأقل');
  const ph = pin ? await hashPin(latinDigits(pin)) : null;
  return run(d => { const u = id ? d.edit('users', id) : d.put('users', { id: uid(), createdAt: nowISO() }); Object.assign(u, { name, role, active: !!active }); if (ph) u.pin = ph; d.audit('user.save', 'user', u.id, `${name} (${role})`); return u; });
}
export async function deleteUser(id) {
  need('users.manage'); const u = get('users', id); if (!u) return;
  if (list('users').filter(x => x.id !== id && x.active !== false && x.role === 'manager').length === 0) throw E('يجب أن يبقى مدير واحد فعّال على الأقل');
  return run(d => { d.del('users', id); d.audit('user.delete', 'user', id, u.name); });
}

// ---------- الإعدادات ----------
export async function saveSettings(patch) {
  if (db.isRemote()) { const dev = Object.fromEntries(Object.entries(patch).filter(([k]) => store.DEV_KEYS.includes(k))); if (Object.keys(dev).length) { store.setDevPrefs(dev); patch = Object.fromEntries(Object.entries(patch).filter(([k]) => !(k in dev))); if (!Object.keys(patch).length) return settings(); } }
  const cur = settings(); const next = deepMerge(cur, patch);
  if (db.isRemote()) for (const k of store.DEV_KEYS) { const sh = store.S.meta?.settings?.[k]; if (sh !== undefined) next[k] = sh; else delete next[k]; }
  if (next.tax.rate < 0 || next.tax.rate > 100) throw E('نسبة الضريبة يجب أن تكون بين 0 و100');
  if (next.pos.maxDiscPct < 0 || next.pos.maxDiscPct > 100) throw E('حد الخصم غير صحيح');
  if (next.stock.lowDefault < 0) throw E('الحد الأدنى الافتراضي غير صحيح');
  await db.commit({ put: { meta: [{ k: 'settings', v: next }] }, del: {} });
  return next;
}
export async function logAudit(action, entity, ref, detail) { const d = new Draft(); d.audit(action, entity, ref, detail); await db.commit(d.done()); }
