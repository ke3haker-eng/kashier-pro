// الفواتير: بحث وتصفية، تفاصيل، معاينة وطباعة (A4/58/80)، PDF، مشاركة، إلغاء، تصدير.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { invoiceProfit, PAY_LABEL } from '../core/calc.js';
import { html, raw, icon, money, priceFmt, toast, modal, confirmBox, promptBox, pageHead, table, paginate, pager, badge, emptyState, statCard, mny, kv } from '../ui/components.js';
import { fmt, fmtQty, fmtDateTime, fmtDate, fmtTime, todayKey, addDays, dayKey, norm, latinDigits, debounce, sortBy, r2, sum, UNITS } from '../core/util.js';
import { previewInvoice, printInvoice } from '../lib/print.js';
import { exportTable, exportBar } from '../lib/export.js';
import { requireApproval } from '../ui/components.js';

const st = { q: '', from: '', to: '', status: 'all', method: '', page: 1 };
let root;
const statusBadge = i => i.status === 'void' ? badge('ملغاة', 'bad') : i.legacy ? badge('قديمة', '') : i.due > 0 ? badge('آجل ' + fmt(i.due), 'warn') : i.returnedTotal > 0 ? badge('مرتجع جزئي', 'info') : badge('مكتملة', 'ok');

function filtered() {
  let r = store.list('invoices').slice().sort((a, b) => b.t.localeCompare(a.t));
  if (st.from) r = r.filter(i => dayKey(i.t) >= st.from); if (st.to) r = r.filter(i => dayKey(i.t) <= st.to);
  if (st.status === 'void') r = r.filter(i => i.status === 'void'); else if (st.status === 'due') r = r.filter(i => i.status !== 'void' && i.due > 0); else if (st.status === 'returned') r = r.filter(i => i.returnedTotal > 0); else if (st.status === 'done') r = r.filter(i => i.status !== 'void');
  if (st.method) r = r.filter(i => i.method === st.method || (i.payments || []).some(p => p.method === st.method));
  if (st.q) { const q = norm(st.q); r = r.filter(i => norm(i.no + ' ' + (i.customerName || '') + ' ' + (i.userName || '') + ' ' + i.total + ' ' + i.items.map(l => l.name).join(' ')).includes(q)); }
  return r;
}
const spec = () => ({ name: 'invoices', title: 'قائمة الفواتير', cols: [{ label: 'رقم الفاتورة', get: i => i.no }, { label: 'التاريخ', get: i => fmtDateTime(i.t) }, { label: 'الزبون', get: i => i.customerName }, { label: 'الموظف', get: i => i.userName }, { label: 'طريقة الدفع', get: i => PAY_LABEL[i.method] }, { label: 'الخصم', get: i => i.discount, num: true }, { label: 'الضريبة', get: i => i.tax, num: true }, { label: 'الإجمالي', get: i => i.total, num: true }, { label: 'الآجل', get: i => i.due, num: true }, { label: 'الحالة', get: i => i.status === 'void' ? 'ملغاة' : i.legacy ? 'قديمة' : 'مكتملة' }], rows: filtered() });

export function invoiceDetail(id) {
  const i = store.get('invoices', id); if (!i) return;
  const canCost = auth.can('products.cost'), profit = invoiceProfit(i);
  const rets = store.list('returns').filter(r => r.invoiceId === id);
  const m = modal({ title: html`فاتورة <span class="num">${i.no}</span> ${statusBadge(i)}`, size: 'lg', body: html`
    <div class="grid g2 keep"><div class="card flat">${kv('التاريخ', fmtDateTime(i.t))}${kv('الموظف', i.userName || '—')}${kv('الزبون', i.customerName || 'زبون عادي')}${kv('طريقة الدفع', PAY_LABEL[i.method])}${i.approvedBy ? kv('وافق على الخصم', i.approvedBy) : ''}${i.note ? kv('ملاحظة', i.note) : ''}</div>
    <div class="card flat">${kv('المجموع', money(i.subtotal))}${i.discount > 0 ? kv('الخصومات', '−' + money(i.discount)) : ''}${i.tax > 0 ? kv(`الضريبة ${fmt(i.taxRate)}%${i.taxInclusive ? ' (شاملة)' : ''}`, money(i.tax)) : ''}${kv('الإجمالي', money(i.total), 'big')}${(i.payments || []).map(p => kv(PAY_LABEL[p.method], money(p.amount)))}${i.change > 0 ? kv('الباقي المدفوع للزبون', money(i.change)) : ''}${i.due > 0 ? kv('المتبقي (دين)', html`<span class="bad">${money(i.due)}</span>`) : ''}${(i.later || []).map(p => kv('سداد ' + fmtDate(p.t), money(p.amount)))}${canCost && profit != null ? kv('ربح الفاتورة', html`<span class="${profit >= 0 ? 'ok' : 'bad'}">${money(profit)}</span>`) : ''}</div></div>
    <div class="card flat" style="padding:6px">${table({ cols: [{ key: 'n', label: 'الصنف', render: l => html`<b>${l.name}</b>${l.offer ? html`<div class="small bad">${l.offer.label}</div>` : ''}${l.note ? html`<div class="small muted">${l.note}</div>` : ''}` }, { key: 'q', label: 'الكمية', align: 'center', render: l => html`<span class="num">${fmtQty(l.qty)}</span> <span class="small muted">${UNITS[l.unit] || ''}</span>${l.returned ? html`<div class="small warn">مرتجع: ${fmtQty(l.returned)}</div>` : ''}` }, { key: 'p', label: 'السعر', align: 'end', render: l => html`<span class="num">${priceFmt(l.price)}</span>` }, { key: 'd', label: 'الخصم', align: 'end', render: l => html`<span class="num">${fmt(l.offerDisc + l.manualDisc + (l.alloc || 0))}</span>` }, { key: 't', label: 'الصافي', align: 'end', render: l => html`<b class="num">${fmt(l.net)}</b>` }], rows: i.items, stack: false })}</div>
    ${rets.length ? html`<div class="card flat"><b>المرتجعات على هذه الفاتورة</b>${rets.map(r => html`<div class="kv"><span><span class="num">${r.no}</span> — ${fmtDateTime(r.t)} — ${r.reason}</span><b class="num">${money(r.refund)}</b></div>`)}</div>` : ''}
    ${i.void ? html`<div class="form-err">ملغاة بتاريخ ${fmtDateTime(i.void.t)} بواسطة ${i.void.userName} — السبب: ${i.void.reason}</div>` : ''}`,
    footer: html`<button class="btn primary" data-prev>${icon('print', 16)} معاينة وطباعة</button>${i.status !== 'void' && !i.legacy && auth.can('returns.create') ? html`<button class="btn" data-ret>${icon('undo', 16)} مرتجع</button>` : ''}${i.status !== 'void' && auth.can('invoices.void') && !i.returnedTotal && !(i.later || []).length ? html`<button class="btn danger" data-void>إلغاء الفاتورة</button>` : ''}${(i.legacy || i.status === 'void') && auth.can('invoices.void') ? html`<button class="btn danger" data-del>حذف</button>` : ''}` });
  const q = s => m.el.querySelector(s);
  q('[data-prev]').onclick = () => previewInvoice(i);
  q('[data-ret]') && (q('[data-ret]').onclick = () => { m.close(); location.hash = '#/returns?inv=' + id; });
  q('[data-void]') && (q('[data-void]').onclick = async () => { const why = await promptBox({ title: 'إلغاء الفاتورة ' + i.no, label: 'سبب الإلغاء (إلزامي)', ok: 'إلغاء الفاتورة' }); if (!why) return; try { await ops.voidInvoice(id, why); toast('تم إلغاء الفاتورة وإعادة المخزون'); m.close(); } catch (e) { toast(e.message, 'err'); } });
  q('[data-del]') && (q('[data-del]').onclick = async () => { if (await confirmBox({ title: 'حذف الفاتورة', message: 'حذف هذه الفاتورة من السجل نهائياً؟', danger: true, ok: 'حذف' })) { try { await ops.deleteInvoice(id); toast('تم الحذف'); m.close(); } catch (e) { toast(e.message, 'err'); } } });
}

function draw() {
  const all = filtered(), pg = paginate(all, st.page), canCost = auth.can('products.cost');
  const valid = all.filter(i => i.status !== 'void');
  root.innerHTML = html`${pageHead('الفواتير', exportBar(), `${store.count('invoices')} فاتورة`)}
  <div class="toolbar"><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="q" placeholder="بحث برقم الفاتورة أو الزبون أو الصنف أو المبلغ" value="${st.q}" autocomplete="off"></div>
    <input class="inp" type="date" id="from" value="${st.from}" style="width:auto" title="من تاريخ"><input class="inp" type="date" id="to" value="${st.to}" style="width:auto" title="إلى تاريخ">
    <select class="inp" id="status" style="width:auto">${[['all', 'كل الحالات'], ['done', 'سارية'], ['due', 'آجلة (عليها دين)'], ['returned', 'عليها مرتجع'], ['void', 'ملغاة']].map(([v, l]) => html`<option value="${v}" ${st.status === v ? raw('selected') : ''}>${l}</option>`)}</select>
    <select class="inp" id="method" style="width:auto"><option value="">كل طرق الدفع</option>${['cash', 'card', 'wallet', 'credit'].map(k => html`<option value="${k}" ${st.method === k ? raw('selected') : ''}>${PAY_LABEL[k]}</option>`)}</select>${st.q || st.from || st.to || st.status !== 'all' || st.method ? html`<button class="btn ghost" data-clear>مسح الفلاتر</button>` : ''}</div>
  <div class="grid g3 mb">${statCard({ label: 'عدد النتائج', value: valid.length, icon: 'receipt', tone: 'b' })}${statCard({ label: 'إجمالي المبيعات', value: money(sum(valid, i => i.total)), icon: 'cart', tone: 'y' })}${statCard({ label: 'إجمالي الديون الآجلة', value: money(sum(valid, i => i.due)), icon: 'users', tone: 'o' })}</div>
  <div class="card" style="padding:8px">${table({ cols: [{ key: 'no', label: 'الفاتورة', render: i => html`<b class="num">${i.no}</b>` }, { key: 't', label: 'التاريخ', render: i => html`<span class="num small">${fmtDateTime(i.t)}</span>` }, { key: 'c', label: 'الزبون', render: i => i.customerName || html`<span class="muted">—</span>` }, { key: 'u', label: 'الموظف', render: i => i.userName || '' }, { key: 'm', label: 'الدفع', render: i => badge(PAY_LABEL[i.method], 'p') }, { key: 'tot', label: 'الإجمالي', align: 'end', render: i => html`<b class="num ${i.status === 'void' ? 'muted' : ''}" style="${raw(i.status === 'void' ? 'text-decoration:line-through' : '')}">${money(i.total)}</b>` }, ...(canCost ? [{ key: 'pr', label: 'الربح', align: 'end', render: i => { const p = invoiceProfit(i); return p == null ? html`<span class="muted">—</span>` : html`<span class="num ${p < 0 ? 'bad' : ''}">${fmt(p)}</span>`; } }] : []), { key: 's', label: 'الحالة', render: statusBadge }], rows: pg.items, empty: 'لا توجد فواتير مطابقة', rowAttr: i => `data-row data-id="${i.id}"` })}${pager(pg)}</div>`.toString();
}

let bound = new WeakSet();
export default {
  render(view, ctx) {
    root = view; st.page = 1; draw(); const open = ctx.params.get('open'); if (open) { history.replaceState(null, '', '#/invoices'); invoiceDetail(open); }
    if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', e => {
      const r = e.target.closest('tr[data-row]'); if (r) return invoiceDetail(r.dataset.id);
      const pg = e.target.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
      const ex = e.target.closest('[data-exp]'); if (ex) return exportTable(spec(), ex.dataset.exp);
      if (e.target.closest('[data-clear]')) { Object.assign(st, { q: '', from: '', to: '', status: 'all', method: '', page: 1 }); draw(); }
    });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'q') { st.q = e.target.value; st.page = 1; const p = e.target.selectionStart; draw(); const i = root.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); } }, 150));
    view.addEventListener('change', e => { const id = e.target.id; if (['from', 'to', 'status', 'method'].includes(id)) { st[id] = e.target.value; st.page = 1; draw(); } });
  },
  onChange(names) { if (root && (names.has('invoices') || names.has('returns'))) { if (document.activeElement?.id === 'q') return; draw(); } },
  destroy() { root = null; },
};
