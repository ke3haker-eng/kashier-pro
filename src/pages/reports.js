// التقارير: مبيعات، أرباح، مشتريات، مخزون، مرتجعات، مصروفات، أكثر/أقل مبيعاً، أعلى ربحاً، طرق الدفع — بفترة مخصصة وتصدير Excel/CSV/PDF.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { summary, series, productStats, categoryStats, inventory, salesIn, returnsIn, expensesIn, purchasesIn } from '../core/analytics.js';
import { PAY_LABEL } from '../core/calc.js';
import { EXPENSE_CATS } from '../core/ops.js';
import { html, raw, icon, money, pageHead, statCard, table, badge, emptyState, seg, tabs, kv } from '../ui/components.js';
import { barChart, lineChart, donut, hbars } from '../ui/charts.js';
import { fmt, fmtQty, r2, sum, todayKey, addDays, weekStartKey, dayKey, dowName, shortDay, monthName, sortBy, fmtDateTime, UNITS } from '../core/util.js';
import { exportTable, exportBar } from '../lib/export.js';

const st = { preset: 'month', from: '', to: '', tab: 'summary', gran: 'day', prod: 'top', sortTop: 'qty' };
let root;
const PRESETS = [['today', 'اليوم'], ['yesterday', 'أمس'], ['week', 'هذا الأسبوع'], ['month', 'هذا الشهر'], ['last30', 'آخر 30 يوم'], ['lastmonth', 'الشهر الماضي'], ['year', 'هذه السنة'], ['custom', 'فترة مخصصة']];
function range() {
  const t = todayKey();
  switch (st.preset) {
    case 'today': return [t, t]; case 'yesterday': return [addDays(t, -1), addDays(t, -1)]; case 'week': return [weekStartKey(t), t]; case 'month': return [t.slice(0, 8) + '01', t];
    case 'last30': return [addDays(t, -29), t]; case 'year': return [t.slice(0, 5) + '01-01', t];
    case 'lastmonth': { const f = addDays(t.slice(0, 8) + '01', -1); return [f.slice(0, 8) + '01', f]; }
    default: return [st.from || t.slice(0, 8) + '01', st.to || t];
  }
}
const label = (key, g) => g === 'day' ? dowName(key) + ' ' + shortDay(key) : g === 'week' ? 'أسبوع ' + shortDay(key) : monthName(key + '-01') + ' ' + key.slice(0, 4);
const canCost = () => auth.can('products.cost');

function tabSummary(from, to) {
  const s = summary(from, to), ser = series(from, to, (new Date(to) - new Date(from)) / 864e5 > 62 ? 'week' : 'day');
  const rows = [['إجمالي المبيعات (شامل الضريبة)', s.sales, ''], ['− الخصومات المطبّقة (مشمولة أعلاه)', s.discounts, 'info'], ['− الضريبة المحصّلة', s.tax, ''], ['− المرتجعات', s.returns, 'bad'], ['= صافي الإيرادات (بدون ضريبة، بعد المرتجعات)', s.revenueNet, 'big'], ['− تكلفة البضاعة المباعة', s.cogs, ''], ['= الربح الإجمالي', s.grossProfit, 'big'], ['− المصروفات', s.expenses, ''], ['= صافي الربح', s.netProfit, 'big']];
  const spec = { name: 'summary', title: 'ملخص الأداء المالي', subtitle: `${from} → ${to}`, cols: [{ label: 'البند', get: r => r[0] }, { label: 'القيمة', get: r => r[1], num: true }], rows };
  return {
    spec, html: html`<div class="stats mb">${statCard({ label: 'إجمالي المبيعات', value: money(s.sales), icon: 'cart', tone: 'y', sub: s.invoices + ' فاتورة' })}${statCard({ label: 'الربح الإجمالي', value: money(s.grossProfit), icon: 'dollar', tone: 'b', sub: 'هامش ' + fmt(s.margin) + '%' })}${statCard({ label: 'المصروفات', value: money(s.expenses), icon: 'wallet', tone: 'o' })}${statCard({ label: 'صافي الربح', value: money(s.netProfit), icon: 'trendUp', tone: s.netProfit >= 0 ? 'g' : 'r' })}</div>
    ${s.unknownCostLines || s.legacyCount ? html`<div class="form-err mb" style="font-weight:500;background:var(--warnb);color:#b45309">${s.unknownCostLines ? `⚠ ${s.unknownCostLines} بند مباع بلا سعر شراء مسجّل — تكلفته محتسبة صفراً فيظهر الربح أعلى من الحقيقي. أضف أسعار الشراء من المنتجات.` : ''} ${s.legacyCount ? `ℹ ${s.legacyCount} فاتورة قديمة مرحّلة (${money(s.legacySales)}) محتسبة في المبيعات فقط ومستثناة من الربح لعدم توفر التكلفة.` : ''}</div>` : ''}
    <div class="grid g-main"><div class="card"><div class="card-h"><h3>قائمة الدخل</h3></div>${rows.map(([k, v, c]) => html`<div class="kv ${c === 'big' ? 'big' : ''}"><span>${k}</span><b class="num ${v < 0 ? 'bad' : ''}">${money(v)}</b></div>`)}<div class="muted small" style="margin-top:8px;line-height:1.8">إجمالي المبيعات ≠ الربح: الربح = الإيرادات بعد الضريبة والمرتجعات − تكلفة البضاعة − المصروفات.</div></div>
    <div class="card"><div class="card-h"><h3>المبيعات خلال الفترة</h3></div>${ser.some(x => x.sales) ? (ser.length <= 14 ? barChart(ser.map(x => ({ label: shortDay(x.key), value: x.sales, value2: x.profit })), { two: true }) : lineChart(ser.map(x => ({ label: shortDay(x.key), value: x.sales })))) : emptyState('chart', 'لا توجد مبيعات')}</div></div>`
  };
}
function tabSales(from, to) {
  const ser = series(from, to, st.gran).filter(x => x.count || x.returns || x.sales).reverse();
  const spec = { name: 'sales', title: 'تقرير المبيعات', subtitle: `${from} → ${to}`, cols: [{ label: 'الفترة', get: x => label(x.key, st.gran) }, { label: 'عدد الفواتير', get: x => x.count, num: true }, { label: 'المبيعات', get: x => x.sales, num: true }, { label: 'المرتجعات', get: x => x.returns, num: true }, ...(canCost() ? [{ label: 'الربح الإجمالي', get: x => x.profit, num: true }] : [])], rows: ser };
  const all = series(from, to, st.gran);
  return { spec, html: html`<div class="toolbar">${seg([['day', 'يومي'], ['week', 'أسبوعي'], ['month', 'شهري']], st.gran, 'data-gran')}</div><div class="card mb"><div class="card-h"><h3>المبيعات ${canCost() ? 'والأرباح' : ''}</h3></div>${all.some(x => x.sales) ? (all.length <= 16 ? barChart(all.map(x => ({ label: st.gran === 'month' ? monthName(x.key + '-01') : shortDay(x.key), value: x.sales, value2: x.profit })), { two: canCost() }) : lineChart(all.map(x => ({ label: shortDay(x.key), value: x.sales })))) : emptyState('chart', 'لا توجد مبيعات في الفترة')}</div>
    <div class="card" style="padding:8px">${table({ cols: [{ key: 'k', label: 'الفترة', render: x => html`<b>${label(x.key, st.gran)}</b>` }, { key: 'c', label: 'الفواتير', align: 'center', render: x => html`<span class="num">${x.count}</span>` }, { key: 's', label: 'المبيعات', align: 'end', render: x => html`<b class="num">${money(x.sales)}</b>` }, { key: 'r', label: 'المرتجعات', align: 'end', render: x => x.returns ? html`<span class="num bad">${money(x.returns)}</span>` : '—' }, ...(canCost() ? [{ key: 'p', label: 'الربح الإجمالي', align: 'end', render: x => html`<span class="num ${x.profit < 0 ? 'bad' : 'ok'}">${money(x.profit)}</span>` }] : [])], rows: ser, empty: 'لا توجد بيانات', foot: ser.length ? html`<tr><td>الإجمالي</td><td class="center num">${sum(ser, x => x.count)}</td><td class="end num">${money(sum(ser, x => x.sales))}</td><td class="end num">${money(sum(ser, x => x.returns))}</td>${canCost() ? html`<td class="end num">${money(sum(ser, x => x.profit))}</td>` : ''}</tr>` : '' })}</div>` };
}
function tabProfit(from, to) {
  const ps = sortBy(productStats(from, to).filter(x => !x.legacy), x => x.profit, -1), cs = sortBy(categoryStats(from, to), c => c.profit, -1), s = summary(from, to);
  const spec = { name: 'profit-by-product', title: 'الأرباح حسب المنتجات', subtitle: `${from} → ${to}`, cols: [{ label: 'المنتج', get: x => x.name }, { label: 'الكمية', get: x => x.qty, num: true }, { label: 'الإيراد', get: x => x.revenue, num: true }, { label: 'التكلفة', get: x => x.cost, num: true }, { label: 'الربح', get: x => x.profit, num: true }, { label: 'الهامش %', get: x => x.revenue > 0 ? r2(x.profit / x.revenue * 100) : 0, num: true }], rows: ps };
  return { spec, html: html`<div class="stats mb">${statCard({ label: 'صافي الإيرادات', value: money(s.revenueNet), icon: 'cart', tone: 'b' })}${statCard({ label: 'تكلفة البضاعة المباعة', value: money(s.cogs), icon: 'box', tone: 'o' })}${statCard({ label: 'الربح الإجمالي', value: money(s.grossProfit), icon: 'dollar', tone: 'g' })}${statCard({ label: 'صافي الربح', value: money(s.netProfit), icon: 'trendUp', tone: s.netProfit >= 0 ? 'plain' : 'r', sub: 'بعد المصروفات ' + money(s.expenses) })}</div>
    <div class="grid g2 mb"><div class="card"><div class="card-h"><h3>الأرباح حسب التصنيف</h3></div>${cs.some(c => c.profit > 0) ? donut(cs.filter(c => c.profit > 0).map(c => ({ label: c.name, value: c.profit })), { center: html`<span class="num">${money(sum(cs, c => c.profit))}</span>`, sub: 'ربح' }) : emptyState('layers', 'لا توجد بيانات')}</div>
    <div class="card" style="padding:8px"><div class="card-h" style="padding:8px"><h3>حسب التصنيف</h3></div>${table({ cols: [{ key: 'n', label: 'التصنيف', render: c => html`<b>${c.name}</b>` }, { key: 'r', label: 'الإيراد', align: 'end', render: c => html`<span class="num">${money(c.revenue)}</span>` }, { key: 'p', label: 'الربح', align: 'end', render: c => html`<b class="num ${c.profit < 0 ? 'bad' : ''}">${money(c.profit)}</b>` }], rows: cs, stack: false, empty: 'لا توجد بيانات' })}</div></div>
    <div class="card" style="padding:8px"><div class="card-h" style="padding:8px"><h3>حسب المنتج</h3></div>${table({ cols: [{ key: 'n', label: 'المنتج', render: x => html`<b>${x.name}</b>` }, { key: 'q', label: 'الكمية', align: 'center', render: x => html`<span class="num">${fmtQty(x.qty)}</span>` }, { key: 'r', label: 'الإيراد', align: 'end', render: x => html`<span class="num">${money(x.revenue)}</span>` }, { key: 'c', label: 'التكلفة', align: 'end', render: x => html`<span class="num">${money(x.cost)}</span>` }, { key: 'p', label: 'الربح', align: 'end', render: x => html`<b class="num ${x.profit < 0 ? 'bad' : 'ok'}">${money(x.profit)}</b>` }, { key: 'm', label: 'الهامش', align: 'end', render: x => html`<span class="num">${x.revenue > 0 ? fmt(x.profit / x.revenue * 100) + '%' : '—'}</span>` }], rows: ps.slice(0, 100), empty: 'لا توجد مبيعات' })}</div>` };
}
function tabProducts(from, to) {
  const stats = productStats(from, to); const byId = new Map(stats.filter(x => x.pid).map(x => [x.pid, x]));
  let rows;
  if (st.prod === 'top') rows = sortBy(stats.filter(x => x.qty > 0), x => st.sortTop === 'revenue' ? x.revenue : x.qty, -1).slice(0, 50);
  else if (st.prod === 'low') rows = sortBy(store.list('products').filter(p => p.active !== false).map(p => byId.get(p.id) || { pid: p.id, name: p.name, unit: p.unit, qty: 0, revenue: 0, profit: 0, cost: 0 }), x => x.qty, 1).slice(0, 50);
  else rows = sortBy(stats.filter(x => !x.legacy && x.qty > 0), x => x.profit, -1).slice(0, 50);
  const spec = { name: 'products-' + st.prod, title: { top: 'المنتجات الأكثر مبيعاً', low: 'المنتجات الأقل مبيعاً', profit: 'المنتجات الأعلى ربحاً' }[st.prod], subtitle: `${from} → ${to}`, cols: [{ label: 'المنتج', get: x => x.name }, { label: 'الكمية المباعة', get: x => x.qty, num: true }, { label: 'الإيراد', get: x => x.revenue, num: true }, ...(canCost() ? [{ label: 'الربح', get: x => x.profit, num: true }] : [])], rows };
  return { spec, html: html`<div class="toolbar">${seg([['top', 'الأكثر مبيعاً'], ['low', 'الأقل مبيعاً'], ...(canCost() ? [['profit', 'الأعلى ربحاً']] : [])], st.prod, 'data-prod')}${st.prod === 'top' ? seg([['qty', 'بالكمية'], ['revenue', 'بالإيراد']], st.sortTop, 'data-sorttop') : ''}</div>
    <div class="grid g-main"><div class="card" style="padding:8px">${table({ cols: [{ key: 'i', label: '#', render: (x, i) => html`<span class="num muted">${i + 1}</span>` }, { key: 'n', label: 'المنتج', render: x => html`<b>${x.name}</b>` }, { key: 'q', label: 'الكمية', align: 'center', render: x => html`<span class="num">${fmtQty(x.qty)}</span> <span class="small muted">${UNITS[x.unit] || ''}</span>` }, { key: 'r', label: 'الإيراد', align: 'end', render: x => html`<span class="num">${money(x.revenue)}</span>` }, ...(canCost() ? [{ key: 'p', label: 'الربح', align: 'end', render: x => x.legacy ? '—' : html`<span class="num ${x.profit < 0 ? 'bad' : ''}">${money(x.profit)}</span>` }] : [])], rows, empty: 'لا توجد بيانات في هذه الفترة' })}</div>
    <div class="card"><div class="card-h"><h3>أفضل 8</h3></div>${rows.length ? hbars(rows.slice(0, 8).map(x => ({ label: x.name, value: st.prod === 'profit' ? x.profit : st.prod === 'top' && st.sortTop === 'revenue' ? x.revenue : x.qty })), { fmtv: v => fmt(v) }) : emptyState('star', 'لا توجد بيانات')}</div></div>` };
}
function tabPurchases(from, to) {
  const ps = sortBy(purchasesIn(from, to), p => p.date, -1), by = new Map(); for (const p of ps) { const x = by.get(p.supplierName) || { name: p.supplierName, total: 0, paid: 0, due: 0, n: 0 }; x.total = r2(x.total + p.total); x.paid = r2(x.paid + p.paid); x.due = r2(x.due + p.due); x.n++; by.set(p.supplierName, x); }
  const spec = { name: 'purchases-report', title: 'تقرير المشتريات', subtitle: `${from} → ${to}`, cols: [{ label: 'الفاتورة', get: p => p.no }, { label: 'التاريخ', get: p => p.date }, { label: 'المورد', get: p => p.supplierName }, { label: 'الإجمالي', get: p => p.total, num: true }, { label: 'المدفوع', get: p => p.paid, num: true }, { label: 'المتبقي', get: p => p.due, num: true }], rows: ps };
  return { spec, html: html`<div class="grid g3 mb">${statCard({ label: 'إجمالي المشتريات', value: money(sum(ps, p => p.total)), icon: 'cart', tone: 'b', sub: ps.length + ' فاتورة' })}${statCard({ label: 'المدفوع', value: money(sum(ps, p => p.paid)), icon: 'check', tone: 'g' })}${statCard({ label: 'المتبقي للموردين', value: money(sum(ps, p => p.due)), icon: 'wallet', tone: 'o' })}</div>
    <div class="grid g-main"><div class="card" style="padding:8px">${table({ cols: [{ key: 'no', label: 'الفاتورة', render: p => html`<b class="num">${p.no}</b>` }, { key: 'd', label: 'التاريخ', render: p => html`<span class="num">${p.date}</span>` }, { key: 's', label: 'المورد', render: p => p.supplierName }, { key: 't', label: 'الإجمالي', align: 'end', render: p => html`<b class="num">${money(p.total)}</b>` }, { key: 'du', label: 'المتبقي', align: 'end', render: p => p.due > 0 ? html`<span class="num bad">${money(p.due)}</span>` : '—' }], rows: ps, empty: 'لا توجد مشتريات' })}</div><div class="card"><div class="card-h"><h3>حسب المورد</h3></div>${by.size ? hbars([...by.values()].sort((a, b) => b.total - a.total).map(x => ({ label: x.name, value: x.total, sub: `${x.n} فاتورة` })), { fmtv: v => money(v) }) : emptyState('truck', 'لا توجد بيانات')}</div></div>` };
}
function tabInventory() {
  const inv = inventory(), ps = sortBy(store.list('products').filter(p => p.active !== false && p.track), p => (p.stock > 0 && p.cost != null ? p.stock * p.cost : 0), -1);
  const spec = { name: 'inventory-valuation', title: 'تقرير قيمة المخزون', subtitle: 'بتاريخ ' + todayKey(), cols: [{ label: 'المنتج', get: p => p.name }, { label: 'التصنيف', get: p => store.catName(p.cat) }, { label: 'الكمية', get: p => p.stock, num: true }, { label: 'التكلفة', get: p => p.cost ?? '', num: true }, { label: 'قيمة التكلفة', get: p => p.cost != null && p.stock > 0 ? r2(p.stock * p.cost) : '', num: true }, { label: 'قيمة البيع', get: p => p.stock > 0 ? r2(p.stock * p.price) : '', num: true }], rows: ps };
  return { spec, html: html`<div class="stats mb">${statCard({ label: 'قيمة المخزون (تكلفة)', value: money(inv.costValue), icon: 'dollar', tone: 'g', sub: inv.unknownCost ? inv.unknownCost + ' منتج بلا تكلفة' : '', subKind: 'warn' })}${statCard({ label: 'قيمة المخزون (بيع)', value: money(inv.retailValue), icon: 'cart', tone: 'b' })}${statCard({ label: 'الربح المتوقع', value: money(r2(inv.retailValue - inv.costValue)), icon: 'trendUp', tone: 'y' })}${statCard({ label: 'منخفض / نافد', value: inv.low.length + ' / ' + inv.out.length, icon: 'alert', tone: 'o' })}</div>
    <div class="card" style="padding:8px">${table({ cols: [{ key: 'n', label: 'المنتج', render: p => html`<b>${p.name}</b><div class="small muted">${store.catName(p.cat)}</div>` }, { key: 'q', label: 'الكمية', align: 'center', render: p => html`<span class="num ${store.stockState(p) !== 'ok' ? 'bad' : ''}">${fmtQty(p.stock)}</span>` }, { key: 'c', label: 'التكلفة', align: 'end', render: p => p.cost == null ? html`<span class="muted">—</span>` : html`<span class="num">${fmt(p.cost)}</span>` }, { key: 'v', label: 'قيمة التكلفة', align: 'end', render: p => p.cost != null && p.stock > 0 ? html`<b class="num">${money(p.stock * p.cost)}</b>` : '—' }, { key: 'r', label: 'قيمة البيع', align: 'end', render: p => p.stock > 0 ? html`<span class="num">${money(p.stock * p.price)}</span>` : '—' }], rows: ps.slice(0, 200), empty: 'لا توجد منتجات متتبعة' })}${ps.length > 200 ? html`<div class="muted small center" style="padding:8px">يعرض أول 200 — صدّر التقرير للقائمة الكاملة</div>` : ''}</div>` };
}
function tabReturns(from, to) {
  const rs = sortBy(returnsIn(from, to), r => r.t, -1), byReason = new Map(); for (const r of rs) byReason.set(r.reason, r2((byReason.get(r.reason) || 0) + r.refund));
  const spec = { name: 'returns-report', title: 'تقرير المرتجعات', subtitle: `${from} → ${to}`, cols: [{ label: 'المرتجع', get: r => r.no }, { label: 'الفاتورة', get: r => r.invoiceNo }, { label: 'التاريخ', get: r => fmtDateTime(r.t) }, { label: 'الأصناف', get: r => r.items.map(l => l.name + ' ×' + l.qty).join('، ') }, { label: 'السبب', get: r => r.reason }, { label: 'المبلغ', get: r => r.refund, num: true }], rows: rs };
  return { spec, html: html`<div class="grid g3 mb">${statCard({ label: 'عدد المرتجعات', value: rs.length, icon: 'undo', tone: 'p' })}${statCard({ label: 'إجمالي المبالغ المستردة', value: money(sum(rs, r => r.refund)), icon: 'wallet', tone: 'r' })}${statCard({ label: 'قيمة تكلفة التالف (غير عائد للمخزون)', value: money(r2(sum(rs, r => sum(r.items.filter(l => !l.restock), l => l.cost * l.qty)))), icon: 'alert', tone: 'o' })}</div>
    <div class="grid g-main"><div class="card" style="padding:8px">${table({ cols: [{ key: 'no', label: 'المرتجع', render: r => html`<b class="num">${r.no}</b><div class="small muted num">${r.invoiceNo}</div>` }, { key: 't', label: 'التاريخ', render: r => html`<span class="num small">${fmtDateTime(r.t)}</span>` }, { key: 'i', label: 'الأصناف', render: r => html`<span class="small">${r.items.map(l => l.name + ' ×' + fmtQty(l.qty)).join('، ')}</span>` }, { key: 's', label: 'السبب', render: r => r.reason }, { key: 'a', label: 'المبلغ', align: 'end', render: r => html`<b class="num bad">${money(r.refund)}</b>` }], rows: rs, empty: 'لا توجد مرتجعات في هذه الفترة' })}</div><div class="card"><div class="card-h"><h3>حسب السبب</h3></div>${byReason.size ? donut([...byReason].map(([label, value]) => ({ label, value }))) : emptyState('undo', 'لا توجد بيانات')}</div></div>` };
}
function tabExpenses(from, to) {
  const es = sortBy(expensesIn(from, to), e => e.date, -1), byCat = Object.entries(EXPENSE_CATS).map(([k, l]) => ({ label: l, value: r2(sum(es.filter(e => e.category === k), e => e.amount)) })).filter(x => x.value > 0);
  const spec = { name: 'expenses-report', title: 'تقرير المصروفات', subtitle: `${from} → ${to}`, cols: [{ label: 'التاريخ', get: e => e.date }, { label: 'النوع', get: e => EXPENSE_CATS[e.category] }, { label: 'البيان', get: e => e.note }, { label: 'المبلغ', get: e => e.amount, num: true }], rows: es };
  return { spec, html: html`<div class="grid g-main"><div class="card" style="padding:8px">${table({ cols: [{ key: 'd', label: 'التاريخ', render: e => html`<span class="num">${e.date}</span>` }, { key: 'c', label: 'النوع', render: e => html`<b>${EXPENSE_CATS[e.category]}</b>` }, { key: 'n', label: 'البيان', render: e => e.note || '—' }, { key: 'a', label: 'المبلغ', align: 'end', render: e => html`<b class="num">${money(e.amount)}</b>` }], rows: es, empty: 'لا توجد مصروفات', foot: es.length ? html`<tr><td colspan="3">الإجمالي</td><td class="end num">${money(sum(es, e => e.amount))}</td></tr>` : '' })}</div><div class="card"><div class="card-h"><h3>حسب النوع</h3></div>${byCat.length ? donut(byCat, { center: html`<span class="num">${money(sum(es, e => e.amount))}</span>`, sub: 'إجمالي' }) : emptyState('wallet', 'لا توجد بيانات')}</div></div>` };
}
function tabPay(from, to) {
  const s = summary(from, to), items = [['cash', 'نقدي'], ['card', 'بطاقة'], ['wallet', 'محفظة إلكترونية'], ['credit', 'آجل (ديون مسجلة)']].map(([k, l]) => ({ k, label: l, value: s.byMethod[k] || 0 }));
  const spec = { name: 'payments-report', title: 'تقرير طرق الدفع', subtitle: `${from} → ${to}`, cols: [{ label: 'طريقة الدفع', get: x => x.label }, { label: 'المبلغ', get: x => x.value, num: true }, { label: 'النسبة %', get: x => s.sales > 0 ? r2(x.value / s.sales * 100) : 0, num: true }], rows: items };
  return { spec, html: html`<div class="grid g2"><div class="card"><div class="card-h"><h3>توزيع المبيعات حسب طريقة الدفع</h3></div>${items.some(x => x.value > 0) ? donut(items.filter(x => x.value > 0), { center: html`<span class="num">${money(s.sales)}</span>`, sub: 'المبيعات' }) : emptyState('wallet', 'لا توجد بيانات')}</div>
    <div class="card">${items.map(x => html`<div class="kv"><span>${x.label}</span><b class="num">${money(x.value)}</b></div>`)}<div class="muted small" style="margin-top:8px;line-height:1.8">النقدي صافٍ بعد الباقي المدفوع للزبائن. الآجل يشمل الديون المسجلة على الفواتير (المسدّد منها لاحقاً يظهر ضمن طرق السداد في قسم الزبائن).</div></div></div>` };
}

const TABS = [['summary', 'الملخص', tabSummary], ['sales', 'المبيعات', tabSales], ['profit', 'الأرباح', tabProfit], ['products', 'المنتجات', tabProducts], ['purchases', 'المشتريات', tabPurchases], ['inventory', 'المخزون', tabInventory], ['returns', 'المرتجعات', tabReturns], ['expenses', 'المصروفات', tabExpenses], ['pay', 'طرق الدفع', tabPay]];
let cur;
function draw() {
  const [from, to] = range(); const visible = TABS.filter(t => canCost() || !['profit'].includes(t[0]));
  if (!visible.find(t => t[0] === st.tab)) st.tab = 'summary';
  const def = visible.find(t => t[0] === st.tab); cur = def[2](from, to);
  root.innerHTML = html`${pageHead('التقارير', exportBar(), `الفترة: ${from} ← ${to}`)}
  <div class="card mb" style="padding:10px"><div class="chips">${PRESETS.map(([k, l]) => html`<button class="chip ${st.preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`)}</div>${st.preset === 'custom' ? html`<div class="row wrap" style="margin-top:8px"><div class="field"><label>من</label><input class="inp" type="date" id="from" value="${from}"></div><div class="field"><label>إلى</label><input class="inp" type="date" id="to" value="${to}"></div></div>` : ''}</div>
  ${tabs(visible.map(t => [t[0], t[1]]), st.tab)}${cur.html}`.toString();
}

let bound = new WeakSet();
export default {
  render(view) {
    root = view; draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', e => {
      const T = e.target; const set = (k, v) => { st[k] = v; draw(); };
      const pr = T.closest('[data-preset]'); if (pr) { if (pr.dataset.preset === 'custom') { const [f, t] = range(); st.from = f; st.to = t; } return set('preset', pr.dataset.preset); }
      const tb = T.closest('[data-tab]'); if (tb) return set('tab', tb.dataset.tab);
      const g = T.closest('[data-gran]'); if (g) return set('gran', g.dataset.gran); const p = T.closest('[data-prod]'); if (p) return set('prod', p.dataset.prod); const s = T.closest('[data-sorttop]'); if (s) return set('sortTop', s.dataset.sorttop);
      const ex = T.closest('[data-exp]'); if (ex && cur) exportTable(cur.spec, ex.dataset.exp);
    });
    view.addEventListener('change', e => { if (e.target.id === 'from' || e.target.id === 'to') { st[e.target.id] = e.target.value; if (st.from && st.to && st.from > st.to) [st.from, st.to] = [st.to, st.from]; draw(); } });
  },
  onChange() { if (root && !document.querySelector('.ov')) draw(); },
  destroy() { root = null; },
};
