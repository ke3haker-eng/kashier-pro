// تجميعات التقارير والأرباح — كلها محسوبة من البيانات الفعلية.
// تعريفات صريحة (لا يُحتسب إجمالي المبيعات كربح):
//  إجمالي المبيعات  = مجموع الفواتير النهائية (شامل الضريبة، بعد الخصومات)
//  المرتجعات        = مبالغ الاسترداد
//  صافي الإيرادات    = (مبيعات − ضريبة) − (مرتجعات − ضريبتها)
//  تكلفة البضاعة    = تكلفة المباع − تكلفة المرتجع الصالح الذي عاد للمخزون
//  الربح الإجمالي    = صافي الإيرادات − تكلفة البضاعة
//  صافي الربح       = الربح الإجمالي − المصروفات
import { list, get, settings, minOf, stockState } from './store.js';
import { r2, dayKey, todayKey, addDays, weekStartKey, monthKey, daysBetween, sum, groupBy } from './util.js';

const inRange = (t, from, to) => { const k = dayKey(t); return (!from || k >= from) && (!to || k <= to); };
export const salesIn = (from, to) => list('invoices').filter(i => i.status !== 'void' && inRange(i.t, from, to));
export const returnsIn = (from, to) => list('returns').filter(r => inRange(r.t, from, to));
export const expensesIn = (from, to) => list('expenses').filter(e => (!from || e.date >= from) && (!to || e.date <= to));
export const purchasesIn = (from, to) => list('purchases').filter(p => p.status === 'approved' && (!from || p.date >= from) && (!to || p.date <= to));

export function summary(from, to) {
  const inv = salesIn(from, to), ret = returnsIn(from, to), exp = expensesIn(from, to);
  const real = inv.filter(i => !i.legacy);
  const sales = r2(sum(inv, i => i.total)), discounts = r2(sum(inv, i => i.discount)), tax = r2(sum(inv, i => i.tax));
  const returns = r2(sum(ret, r => r.refund)), retTax = r2(sum(ret, r => r.tax));
  // الربح يستثني الفواتير المرحّلة (بلا تكلفة) كي لا يظهر ربح وهمي
  const revenueNet = r2(sum(real, i => i.net) - sum(ret, r => r.net));
  const cogs = r2(sum(real, i => sum(i.items, l => l.cost * l.qty)) - sum(ret, r => r.restockCost));
  const grossProfit = r2(revenueNet - cogs), expenses = r2(sum(exp, e => e.amount));
  let unknownCostLines = 0; for (const i of real) for (const l of i.items) if (!l.costKnown) unknownCostLines++;
  const byMethod = { cash: 0, card: 0, wallet: 0, credit: 0 };
  for (const i of inv) { for (const p of i.payments || []) byMethod[p.method] = r2((byMethod[p.method] || 0) + p.amount); byMethod.credit = r2(byMethod.credit + (i.due || 0) + sum(i.later || [], x => x.amount)); }
  return { invoices: inv.length, sales, discounts, tax, returns, returnsCount: ret.length, revenueNet, cogs, grossProfit, expenses, netProfit: r2(grossProfit - expenses), avgInvoice: inv.length ? r2(sales / inv.length) : 0, legacyCount: inv.length - real.length, legacySales: r2(sum(inv.filter(i => i.legacy), i => i.total)), unknownCostLines, byMethod, margin: revenueNet > 0 ? grossProfit / revenueNet * 100 : 0, purchases: r2(sum(purchasesIn(from, to), p => p.total)) };
}

// سلسلة زمنية: unit = 'day' | 'week' | 'month' — كل نقطة {key,label,sales,profit,count}
export function series(from, to, unit = 'day') {
  const keyOf = unit === 'day' ? (k => k) : unit === 'week' ? weekStartKey : (k => k.slice(0, 7));
  const m = new Map(); let k = from;
  while (k <= to) { m.set(keyOf(k), { key: keyOf(k), sales: 0, profit: 0, count: 0, returns: 0, expenses: 0 }); k = addDays(k, 1); if (m.size > 800) break; }
  for (const i of salesIn(from, to)) { const x = m.get(keyOf(dayKey(i.t))); if (!x) continue; x.sales = r2(x.sales + i.total); x.count++; if (!i.legacy) x.profit = r2(x.profit + i.net - sum(i.items, l => l.cost * l.qty)); }
  for (const r of returnsIn(from, to)) { const x = m.get(keyOf(dayKey(r.t))); if (!x) continue; x.returns = r2(x.returns + r.refund); x.profit = r2(x.profit - r.net + r.restockCost); }
  for (const e of expensesIn(from, to)) { const x = m.get(keyOf(e.date)); if (x) x.expenses = r2(x.expenses + e.amount); }
  return [...m.values()];
}

// ترتيب المنتجات: by = 'qty' | 'revenue' | 'profit'
export function productStats(from, to) {
  const m = new Map();
  for (const i of salesIn(from, to)) for (const l of i.items) {
    const k = l.pid || ('legacy:' + l.name); const x = m.get(k) || { pid: l.pid, name: l.name, unit: l.unit, qty: 0, revenue: 0, profit: 0, cost: 0, legacy: !l.pid };
    const rq = l.returned || 0; // المرتجع يخصم من الكمية والإيراد
    x.qty = r2(x.qty + l.qty - rq); const unitNet = l.qty ? l.net / l.qty : 0; x.revenue = r2(x.revenue + l.net - unitNet * rq);
    if (!i.legacy) { x.cost = r2(x.cost + l.cost * (l.qty - rq)); x.profit = r2(x.profit + (l.net - unitNet * rq) - l.cost * (l.qty - rq)); }
    m.set(k, x);
  }
  return [...m.values()];
}
export function categoryStats(from, to) {
  const m = new Map();
  for (const s of productStats(from, to)) { const p = s.pid && get('products', s.pid); const c = p?.cat ? (get('categories', p.cat)?.name || 'بدون تصنيف') : 'بدون تصنيف'; const x = m.get(c) || { name: c, qty: 0, revenue: 0, profit: 0 }; x.qty = r2(x.qty + s.qty); x.revenue = r2(x.revenue + s.revenue); x.profit = r2(x.profit + s.profit); m.set(c, x); }
  return [...m.values()];
}

// ---------- المخزون ----------
export function inventory() {
  let costValue = 0, retailValue = 0, unknownCost = 0, low = [], out = [], tracked = 0;
  for (const p of list('products')) {
    if (p.active === false || !p.track) continue; tracked++;
    const st = stockState(p);
    if (p.stock > 0) { retailValue += p.stock * p.price; if (p.cost == null) unknownCost++; else costValue += p.stock * p.cost; }
    if (st === 'out') out.push(p); else if (st === 'low') low.push(p);
  }
  return { costValue: r2(costValue), retailValue: r2(retailValue), unknownCost, low, out, tracked, total: list('products').filter(p => p.active !== false).length, noCost: list('products').filter(p => p.active !== false && (p.cost == null)).length };
}

// ---------- الصلاحية ----------
// مدخلات الصلاحية: الدفعات (batches) + تاريخ المنتج نفسه إذا لا توجد دفعات
export function expiryList(days = settings().stock.expiryDays) {
  const today = todayKey(), limit = addDays(today, days), out = [];
  const withBatch = new Set();
  for (const b of list('batches')) { if (b.qty <= 0 || !b.expiry) continue; const p = get('products', b.pid); if (!p || p.active === false) continue; withBatch.add(b.pid); out.push({ pid: p.id, name: p.name, unit: p.unit, qty: b.qty, expiry: b.expiry, cost: b.cost, batchId: b.id, note: b.note || '' }); }
  for (const p of list('products')) { if (p.active === false || !p.expiry || withBatch.has(p.id) || (p.track && p.stock <= 0)) continue; out.push({ pid: p.id, name: p.name, unit: p.unit, qty: p.track ? p.stock : null, expiry: p.expiry, cost: p.cost, batchId: null, note: 'تاريخ المنتج' }); }
  for (const x of out) { x.days = daysBetween(today, x.expiry); x.status = x.expiry < today ? 'expired' : x.expiry <= limit ? 'soon' : 'ok'; x.lossCost = x.qty != null && x.cost != null ? r2(x.qty * x.cost) : null; }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

// ---------- الديون ----------
export function customerBalances() { const m = new Map(); for (const i of list('invoices')) if (i.status !== 'void' && i.customerId && i.due > 0) m.set(i.customerId, r2((m.get(i.customerId) || 0) + i.due)); return m; }
export function supplierBalances() { const m = new Map(); for (const p of list('purchases')) if (p.status === 'approved' && p.due > 0) m.set(p.supplierId, r2((m.get(p.supplierId) || 0) + p.due)); return m; }

// ---------- الوردية ----------
// النقدية المتوقعة = رصيد البداية + نقد المبيعات (بعد الباقي) + دفعات الديون النقدية − استردادات نقدية − مصروفات نقدية − دفعات موردين نقدية − إلغاءات نقدية
export function shiftSummary(shift, until = null) {
  const id = shift.id, inShift = x => x.shiftId === id;
  const inv = list('invoices').filter(i => inShift(i) && i.status !== 'void');
  const voided = list('invoices').filter(i => i.status === 'void' && i.void?.shiftId === id);
  const allInv = list('invoices').filter(inShift); // تشمل الملغاة لاحقاً: نقدها دخل الدرج ثم خرج بالإلغاء إن كان في وردية أخرى
  const cashIn = r2(sum(allInv, i => sum((i.payments || []).filter(p => p.method === 'cash'), p => p.amount)));
  const rets = list('returns').filter(inShift), pays = list('payments').filter(inShift), exps = list('expenses').filter(e => e.shiftId === id);
  const custCash = r2(sum(pays.filter(p => p.kind === 'customer' && p.method === 'cash'), p => p.amount));
  const supCash = r2(sum(pays.filter(p => p.kind === 'supplier' && p.method === 'cash'), p => p.amount));
  const retCash = r2(sum(rets.filter(r => r.method === 'cash'), r => r.cashOut));
  const expCash = r2(sum(exps.filter(e => e.method === 'cash'), e => e.amount));
  const voidCash = r2(sum(voided, i => i.void.cashRefund));
  const by = m => r2(sum(inv, i => sum((i.payments || []).filter(p => p.method === m), p => p.amount)));
  const expectedCash = r2((shift.openingCash || 0) + cashIn + custCash - retCash - expCash - supCash - voidCash);
  return { salesCount: inv.length, salesTotal: r2(sum(inv, i => i.total)), cashSales: by('cash'), cardSales: by('card'), walletSales: by('wallet'), creditSales: r2(sum(inv, i => i.due)), discounts: r2(sum(inv, i => i.discount)), returnsCount: rets.length, returnsTotal: r2(sum(rets, r => r.refund)), retCash, expCash, supCash, custCash, voidCash, cashIn, expectedCash };
}

// ---------- التنبيهات ----------
export function alerts() {
  const inv = inventory(), ex = expiryList(); const a = [];
  if (inv.out.length) a.push({ kind: 'bad', icon: 'alert', text: `${inv.out.length} منتج نفد من المخزون`, route: '#/inventory?tab=out' });
  if (inv.low.length) a.push({ kind: 'warn', icon: 'alert', text: `${inv.low.length} منتج منخفض المخزون`, route: '#/inventory?tab=low' });
  const exp = ex.filter(x => x.status === 'expired').length, soon = ex.filter(x => x.status === 'soon').length;
  if (exp) a.push({ kind: 'bad', icon: 'clock', text: `${exp} صنف منتهي الصلاحية`, route: '#/inventory?tab=expiry' });
  if (soon) a.push({ kind: 'warn', icon: 'clock', text: `${soon} صنف يقترب من انتهاء الصلاحية`, route: '#/inventory?tab=expiry' });
  return a;
}
