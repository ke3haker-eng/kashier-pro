// لوحة التحكم: كل الأرقام محسوبة من البيانات الفعلية في قاعدة البيانات.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import * as db from '../core/db.js';
import * as sw from '../core/storewatch.js';
import { summary, series, productStats, inventory, alerts, salesIn } from '../core/analytics.js';
import { html, raw, icon, money, pageHead, statCard, table, badge, emptyState, seg, mny } from '../ui/components.js';
import { barChart, lineChart, donut, hbars } from '../ui/charts.js';
import { fmt, fmtQty, todayKey, addDays, dowName, shortDay, monthName, weekStartKey, fmtTime, fmtDate, r2, UNITS, groupBy, sum } from '../core/util.js';
import { PAY_LABEL } from '../core/calc.js';
import { previewInvoice } from '../lib/print.js';
import { enterDemo } from '../core/demo.js';

let root, period = 'week';
const pctChange = (a, b) => b > 0 ? (a - b) / b * 100 : (a > 0 ? 100 : 0);
const chg = (a, b) => { const p = pctChange(a, b); return { text: (p >= 0 ? '▲ ' : '▼ ') + fmt(Math.abs(p)) + '% عن أمس', kind: p >= 0 ? 'ok' : 'bad' }; };

function draw() {
  const t = todayKey(), y = addDays(t, -1), S = store.settings(), canProfit = auth.can('reports.view');
  const td = summary(t, t), yd = summary(y, y), inv = inventory();
  let from, unit, labels;
  if (period === 'week') { from = addDays(t, -6); unit = 'day'; } else if (period === 'month') { from = addDays(t, -29); unit = 'day'; } else { from = addDays(t, -83); unit = 'week'; }
  const ser = series(from, t, unit);
  const pts = ser.map(s => ({ label: unit === 'day' ? (period === 'week' ? dowName(s.key) : shortDay(s.key)) : shortDay(s.key), value: s.sales, value2: s.profit }));
  const top = productStats(addDays(t, -29), t).filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const recent = store.list('invoices').slice().sort((a, b) => b.t.localeCompare(a.t)).slice(0, 6);
  const al = alerts(), lowList = [...inv.out, ...inv.low].slice(0, 4);
  const mon = summary(t.slice(0, 8) + '01', t);
  const noData = !store.count('products') && !store.count('invoices');
  const pay = Object.entries(td.byMethod).filter(([k, v]) => v > 0 && k !== 'credit').map(([k, v]) => ({ label: PAY_LABEL[k], value: v }));

  root.innerHTML = html`
  ${pageHead('مرحباً بك في لوحة التحكم 👋', html`${auth.can('pos.sell') ? html`<a class="btn primary" href="#/pos">${icon('pos', 18)} فتح نقطة البيع</a>` : ''}`, (S.name ? S.name + ' — ' : '') + new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
  <div id="storeBanner">${storeBanner()}</div>
  ${noData ? html`<div class="card mb" style="border:2px dashed var(--b);text-align:center;box-shadow:none"><h3>ابدأ باستخدام النظام</h3><p class="muted" style="margin:6px 0 12px;line-height:1.9">لا توجد بيانات بعد. أضف منتجاتك، أو استورد قائمة من Excel، أو جرّب النظام ببيانات وهمية في وضع منفصل لا يلمس بياناتك الحقيقية.</p><div class="row wrap" style="justify-content:center">${auth.can('products.edit') ? html`<a class="btn primary" href="#/products?new=1">${icon('plus', 16)} إضافة أول منتج</a><a class="btn" href="#/products">${icon('upload', 16)} استيراد من Excel</a>` : ''}<button class="btn soft" data-demo>${icon('zap', 16)} تجربة النظام (وضع Demo)</button></div></div>` : ''}
  <div class="stats mb">
    ${statCard({ label: 'مبيعات اليوم', value: money(td.sales), icon: 'cart', tone: 'y', sub: chg(td.sales, yd.sales).text, subKind: chg(td.sales, yd.sales).kind })}
    ${canProfit ? statCard({ label: 'الربح الإجمالي اليوم', value: money(td.grossProfit), icon: 'dollar', tone: 'b', sub: td.unknownCostLines ? `${td.unknownCostLines} بند بلا تكلفة` : (td.revenueNet > 0 ? 'هامش ' + fmt(td.margin) + '%' : ''), subKind: td.unknownCostLines ? 'warn' : '' }) : statCard({ label: 'متوسط الفاتورة', value: money(td.avgInvoice), icon: 'dollar', tone: 'b' })}
    ${statCard({ label: 'عدد الفواتير اليوم', value: td.invoices, icon: 'receipt', tone: 'p', sub: chg(td.invoices, yd.invoices).text, subKind: chg(td.invoices, yd.invoices).kind })}
    ${statCard({ label: 'مخزون منخفض / نافد', value: inv.low.length + ' / ' + inv.out.length, icon: 'alert', tone: 'o', sub: al.length ? 'اضغط لعرض التنبيهات' : 'كل شيء على ما يرام' })}
  </div>
  <div class="stats mb">
    ${statCard({ label: 'عدد المنتجات', value: inv.total, icon: 'box', tone: 'plain' })}
    ${auth.can('products.cost') ? statCard({ label: 'قيمة المخزون (تكلفة)', value: money(inv.costValue), icon: 'layers', tone: 'plain', sub: inv.unknownCost ? inv.unknownCost + ' منتج بلا تكلفة' : '', subKind: 'warn' }) : statCard({ label: 'قيمة المخزون (بيع)', value: money(inv.retailValue), icon: 'layers', tone: 'plain' })}
    ${canProfit ? statCard({ label: 'صافي ربح الشهر', value: money(mon.netProfit), icon: 'trendUp', tone: 'plain', sub: `مبيعات: ${money(mon.sales)} · مصروفات: ${money(mon.expenses)}` }) : statCard({ label: 'مبيعات الشهر', value: money(mon.sales), icon: 'trendUp', tone: 'plain' })}
    ${statCard({ label: 'مرتجعات اليوم', value: money(td.returns), icon: 'undo', tone: 'plain', sub: td.returnsCount + ' عملية' })}
  </div>
  <div class="grid g-main mb">
    <div class="card"><div class="card-h"><h3>${icon('chart', 18)} المبيعات${canProfit ? ' والأرباح' : ''}</h3>${seg([['week', 'أسبوعي'], ['month', 'شهري'], ['quarter', '12 أسبوعاً']], period, 'data-period')}</div>
      ${ser.some(s => s.sales > 0) ? (period === 'week' || unit === 'week' ? barChart(pts.map(p => ({ ...p, value2: canProfit ? p.value2 : 0 })), { two: canProfit }) : lineChart(pts)) : emptyState('chart', 'لا توجد مبيعات في هذه الفترة')}
      ${canProfit && (period === 'week' || unit === 'week') ? html`<div class="row small muted" style="margin-top:8px;gap:14px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--chart1)"></i> المبيعات</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--chart3)"></i> الربح الإجمالي</span></div>` : ''}</div>
    <div class="col"><div class="card"><div class="card-h"><h3>${icon('receipt', 18)} آخر الفواتير</h3>${auth.can('invoices.view') ? html`<a class="small" href="#/invoices">عرض الكل ‹</a>` : ''}</div>
      ${recent.length ? html`<div>${recent.map(i => html`<div class="list-item" ${auth.can('invoices.view') ? raw(`data-inv="${i.id}" style="cursor:pointer"`) : ''}><div class="grow"><b class="num">${i.no}</b> ${i.status === 'void' ? badge('ملغاة', 'bad') : ''}<div class="small muted">${fmtDate(i.t)} ${fmtTime(i.t)} · ${PAY_LABEL[i.method]}</div></div><b class="num">${money(i.total)}</b></div>`)}</div>` : emptyState('receipt', 'لا توجد فواتير بعد')}</div></div>
  </div>
  <div class="grid g3 mb">
    <div class="card"><div class="card-h"><h3>${icon('star', 18)} الأكثر مبيعاً (30 يوماً)</h3></div>${top.length ? hbars(top.map(x => ({ label: x.name, value: x.qty, sub: money(x.revenue) })), { fmtv: v => fmt(v) }) : emptyState('star', 'لا توجد بيانات كافية')}</div>
    <div class="card"><div class="card-h"><h3>${icon('wallet', 18)} طرق الدفع اليوم</h3></div>${pay.length ? donut(pay, { center: html`<span class="num">${money(td.sales)}</span>`, sub: 'اليوم' }) : emptyState('wallet', 'لا توجد مبيعات اليوم')}</div>
    <div class="card" style="${raw(al.length ? 'background:linear-gradient(135deg,var(--badb),var(--card))' : '')}"><div class="card-h"><h3>${icon('alert', 18)} تنبيهات مهمة</h3></div>${al.length ? html`<div>${al.map(a => html`<a class="list-item" href="${a.route}" style="text-decoration:none;color:inherit"><span class="${a.kind}">${icon(a.icon, 22)}</span><span class="grow">${a.text}</span>${icon('chevL', 16)}</a>`)}</div>${lowList.length ? html`<div class="small muted" style="margin-top:8px">أمثلة: ${lowList.map(p => p.name).join('، ')}</div>` : ''}` : emptyState('check', 'لا توجد تنبيهات')}</div>
  </div>`.toString();
}

// شريط تنبيه الطلبات الجديدة والرسائل غير المقروءة من المتجر الإلكتروني (يتحدّث وحده دون إعادة رسم اللوحة)
const storeBanner = () => {
  const d = sw.state; if (!db.isRemote() || !auth.can('pos.sell') || !(d.orders || d.unread)) return '';
  return html`<a class="card mb" href="#/orders${d.orders ? '' : '?tab=chat'}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--t);border:1px solid var(--bad);background:color-mix(in srgb,var(--bad) 8%,var(--card))">${icon('chat', 24)}<div style="flex:1;min-width:0"><b>${d.orders ? d.orders + ' طلب جديد من المتجر الإلكتروني' : ''}${d.orders && d.unread ? ' · ' : ''}${d.unread ? d.unread + ' رسالة غير مقروءة' : ''}</b><div class="small muted">اضغط للمراجعة</div></div></a>`;
};
window.addEventListener('kp-store', () => { const el = root?.querySelector('#storeBanner'); if (el) el.innerHTML = storeBanner().toString(); });

let bound = new WeakSet();
export default {
  render(view) {
    root = view; draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', e => {
      const p = e.target.closest('[data-period]'); if (p) { period = p.dataset.period; draw(); return; }
      if (e.target.closest('[data-demo]')) { if (confirm('سيُفتح وضع تجربة منفصل ببيانات وهمية، ولن تتأثر بياناتك الحقيقية. متابعة؟')) enterDemo(); return; }
      const i = e.target.closest('[data-inv]'); if (i) { const inv = store.get('invoices', i.dataset.inv); if (inv) previewInvoice(inv); }
    });
  },
  onChange(names) { if (root) draw(); },
  destroy() { root = null; },
};
