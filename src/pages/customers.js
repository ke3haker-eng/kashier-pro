// الزبائن والديون: ملف الزبون، كشف الحساب، تسجيل الدفعات، طباعة وتصدير.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { customerBalances } from '../core/analytics.js';
import { PAY_LABEL } from '../core/calc.js';
import { html, raw, icon, money, toast, modal, formModal, confirmBox, pageHead, table, paginate, pager, badge, emptyState, statCard, avatar, kv, mny, tabs } from '../ui/components.js';
import { fmt, fmtDateTime, fmtDate, norm, debounce, sortBy, r2, sum, latinDigits } from '../core/util.js';
import { exportTable, exportBar } from '../lib/export.js';
import { previewDoc } from '../lib/print.js';
import { tableDoc } from '../lib/print.js';
import { invoiceDetail } from './invoices.js';

const st = { q: '', filter: 'all', page: 1 };
let root;

export function customerForm(id) {
  return new Promise(res => {
    const c = id ? store.get('customers', id) : {}; let saved = null;
    formModal({ title: id ? 'تعديل زبون' : 'زبون جديد', size: 'sm', fields: [{ name: 'name', label: 'اسم الزبون', required: true, autofocus: true, span: 2 }, { name: 'phone', label: 'رقم الهاتف', attrs: 'inputmode="tel"', span: 2 }, { name: 'address', label: 'العنوان', span: 2 }, { name: 'creditLimit', label: 'سقف الدين المسموح (0 = بلا سقف)', type: 'number', span: 2 }, { name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 2, span: 2 }], values: { ...c, creditLimit: c.creditLimit || 0 }, onSubmit: async v => { const r = await ops.saveCustomer({ ...v, id }); saved = r.id; toast(id ? 'تم التعديل' : 'تمت إضافة الزبون'); } }).done.then(() => res(saved));
  });
}
export function payDialog(customerId) {
  const c = store.get('customers', customerId), debt = store.customerBalance(customerId);
  return formModal({ title: 'تسجيل دفعة من ' + c.name, size: 'sm', intro: html`<div class="change-box" style="background:var(--warnb);color:#b45309;margin-bottom:10px">الدين الحالي: ${money(debt)}</div>`, fields: [{ name: 'amount', label: 'المبلغ المدفوع', type: 'number', value: debt || '', required: true, autofocus: true, span: 2 }, { name: 'method', label: 'طريقة الدفع', type: 'select', options: [['cash', 'نقدي'], ['card', 'بطاقة'], ['wallet', 'محفظة إلكترونية']], span: 2 }, { name: 'note', label: 'ملاحظة', span: 2 }], submit: 'تسجيل الدفعة', onSubmit: async v => { await ops.payCustomer(customerId, v.amount, v.method, v.note); toast('تم تسجيل الدفعة'); } }).done;
}

// كشف الحساب: فواتير (مدين) ومرتجعات ودفعات (دائن) مرتبة زمنياً مع رصيد تراكمي
export function statement(customerId) {
  const ev = [];
  for (const i of store.list('invoices')) if (i.customerId === customerId && i.status !== 'void') {
    // الدين الأصلي عند البيع = إجمالي الفاتورة − ما دُفع لحظة البيع (مصفوفة payments تحمل النقد بعد خصم الباقي)
    const origDebt = r2(i.total - sum(i.payments || [], p => p.amount));
    if (origDebt > 0) ev.push({ t: i.t, kind: 'invoice', ref: i.no, id: i.id, debit: origDebt, credit: 0, note: `فاتورة آجلة (إجمالي ${fmt(i.total)})` });
    for (const l of i.later || []) ev.push({ t: l.t, kind: 'pay', ref: i.no, debit: 0, credit: l.amount, note: 'دفعة — ' + PAY_LABEL[l.method] });
  }
  for (const r of store.list('returns')) if (r.customerId === customerId && r.debtCut > 0) ev.push({ t: r.t, kind: 'return', ref: r.no, debit: 0, credit: r.debtCut, note: 'مرتجع على ' + r.invoiceNo });
  ev.sort((a, b) => a.t.localeCompare(b.t)); let bal = 0; for (const e of ev) { bal = r2(bal + e.debit - e.credit); e.bal = bal; }
  return ev;
}
const stmtSpec = c => { const ev = statement(c.id); return { name: 'statement-' + c.name, title: 'كشف حساب: ' + c.name, subtitle: c.phone || '', summary: [['الرصيد المستحق', money(store.customerBalance(c.id))]], cols: [{ label: 'التاريخ', get: e => fmtDateTime(e.t) }, { label: 'المرجع', get: e => e.ref }, { label: 'البيان', get: e => e.note }, { label: 'مدين', get: e => e.debit || '', num: true }, { label: 'دائن', get: e => e.credit || '', num: true }, { label: 'الرصيد', get: e => e.bal, num: true }], rows: ev }; };

export function customerDetail(id) {
  const c = store.get('customers', id); if (!c) return;
  const draw = () => {
    const bal = store.customerBalance(id), invs = store.list('invoices').filter(i => i.customerId === id && i.status !== 'void').sort((a, b) => b.t.localeCompare(a.t)), ev = statement(id).slice().reverse();
    const total = sum(invs, i => i.total);
    return html`<div class="grid g3 keep mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">${statCard({ label: 'الدين الحالي', value: money(bal), icon: 'wallet', tone: bal > 0 ? 'o' : 'g' })}${statCard({ label: 'إجمالي مشترياته', value: money(total), icon: 'cart', tone: 'b' })}${statCard({ label: 'عدد الفواتير', value: invs.length, icon: 'receipt', tone: 'p' })}</div>
      <div class="card flat">${c.phone ? kv('الهاتف', html`<span class="num">${c.phone}</span>`) : ''}${c.address ? kv('العنوان', c.address) : ''}${c.creditLimit > 0 ? kv('سقف الدين', money(c.creditLimit)) : ''}${c.notes ? kv('ملاحظات', c.notes) : ''}</div>
      <h4>كشف الحساب</h4><div class="card flat" style="padding:6px;max-height:300px;overflow:auto">${table({ cols: [{ key: 't', label: 'التاريخ', render: e => html`<span class="num small">${fmtDateTime(e.t)}</span>` }, { key: 'r', label: 'المرجع', render: e => e.kind === 'invoice' ? html`<a href="#" data-inv="${e.id}" class="num">${e.ref}</a>` : html`<span class="num">${e.ref}</span>` }, { key: 'n', label: 'البيان', render: e => e.note }, { key: 'd', label: 'مدين', align: 'end', render: e => e.debit ? html`<b class="num bad">${fmt(e.debit)}</b>` : '' }, { key: 'c', label: 'دائن', align: 'end', render: e => e.credit ? html`<b class="num ok">${fmt(e.credit)}</b>` : '' }, { key: 'b', label: 'الرصيد', align: 'end', render: e => html`<span class="num">${fmt(e.bal)}</span>` }], rows: ev, empty: 'لا توجد معاملات آجلة', stack: false })}</div>
      <h4>آخر الفواتير</h4><div class="card flat" style="padding:6px">${table({ cols: [{ key: 'no', label: 'الفاتورة', render: i => html`<a href="#" data-inv="${i.id}" class="num">${i.no}</a>` }, { key: 't', label: 'التاريخ', render: i => html`<span class="num small">${fmtDateTime(i.t)}</span>` }, { key: 'p', label: 'الدفع', render: i => PAY_LABEL[i.method] }, { key: 'tt', label: 'الإجمالي', align: 'end', render: i => html`<span class="num">${money(i.total)}</span>` }, { key: 'du', label: 'المتبقي', align: 'end', render: i => i.due > 0 ? html`<b class="num bad">${money(i.due)}</b>` : html`<span class="muted">—</span>` }], rows: invs.slice(0, 8), stack: false, empty: 'لا توجد فواتير' })}</div>`;
  };
  const m = modal({ title: c.name, size: 'lg', body: draw(), footer: html`${store.customerBalance(id) > 0 && auth.can('customers.manage') ? html`<button class="btn ok" data-pay>${icon('cash', 16)} تسجيل دفعة</button>` : ''}<button class="btn" data-st>${icon('print', 16)} طباعة كشف الحساب</button><button class="btn" data-xl>${icon('sheet', 16)} Excel</button>${auth.can('customers.manage') ? html`<button class="btn" data-ed>${icon('edit', 16)} تعديل</button>` : ''}` });
  const q = s => m.el.querySelector(s);
  q('[data-pay]') && (q('[data-pay]').onclick = async () => { await payDialog(id); m.setBody(draw()); if (!store.customerBalance(id)) q('[data-pay]')?.remove(); });
  q('[data-st]').onclick = () => previewDoc(p => tableDoc({ ...stmtSpec(store.get('customers', id)), paper: p }), 'كشف حساب ' + c.name);
  q('[data-xl]').onclick = () => exportTable(stmtSpec(store.get('customers', id)), 'xlsx');
  q('[data-ed]') && (q('[data-ed]').onclick = async () => { await customerForm(id); m.setBody(draw()); });
  m.el.addEventListener('click', e => { const a = e.target.closest('[data-inv]'); if (a) { e.preventDefault(); invoiceDetail(a.dataset.inv); } });
}

function rows() {
  const bals = customerBalances(), q = norm(st.q);
  let r = store.list('customers').map(c => ({ ...c, bal: bals.get(c.id) || 0, count: store.list('invoices').filter(i => i.customerId === c.id && i.status !== 'void').length }));
  if (q) r = r.filter(c => norm(c.name + ' ' + (c.phone || '')).includes(q)); if (st.filter === 'debt') r = r.filter(c => c.bal > 0);
  return sortBy(r, c => st.filter === 'debt' ? -c.bal : c.name);
}
const spec = () => ({ name: 'customers', title: 'الزبائن', cols: [{ label: 'الاسم', get: c => c.name }, { label: 'الهاتف', get: c => c.phone }, { label: 'عدد الفواتير', get: c => c.count, num: true }, { label: 'الدين المستحق', get: c => c.bal, num: true }, { label: 'سقف الدين', get: c => c.creditLimit || '', num: true }], rows: rows() });
function draw() {
  const all = rows(), pg = paginate(all, st.page), totalDebt = sum(all, c => c.bal), canM = auth.can('customers.manage');
  root.innerHTML = html`${pageHead('الزبائن', html`${canM ? html`<button class="btn primary" data-new>${icon('plus', 18)} زبون جديد</button>` : ''}${exportBar()}`, `${store.count('customers')} زبون`)}
  <div class="grid g3 mb">${statCard({ label: 'عدد الزبائن', value: store.count('customers'), icon: 'users', tone: 'b' })}${statCard({ label: 'إجمالي الديون المستحقة', value: money(sum(customerBalances().values ? [...customerBalances().values()] : [], x => x)), icon: 'wallet', tone: 'o' })}${statCard({ label: 'زبائن عليهم دين', value: [...customerBalances().values()].filter(v => v > 0).length, icon: 'alert', tone: 'r' })}</div>
  <div class="toolbar"><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="q" placeholder="بحث بالاسم أو الهاتف" value="${st.q}" autocomplete="off"></div><select class="inp" id="f" style="width:auto"><option value="all" ${st.filter === 'all' ? raw('selected') : ''}>كل الزبائن</option><option value="debt" ${st.filter === 'debt' ? raw('selected') : ''}>عليهم دين فقط</option></select></div>
  <div class="card" style="padding:8px">${table({ cols: [{ key: 'a', label: '', render: c => avatar(c.name, 40), cls: 'nolabel' }, { key: 'n', label: 'الزبون', render: c => html`<b>${c.name}</b><div class="small muted num">${c.phone || ''}</div>` }, { key: 'c', label: 'الفواتير', align: 'center', render: c => html`<span class="num">${c.count}</span>` }, { key: 'l', label: 'السقف', align: 'center', render: c => c.creditLimit > 0 ? html`<span class="num">${fmt(c.creditLimit)}</span>` : html`<span class="muted">—</span>` }, { key: 'b', label: 'الدين المستحق', align: 'end', render: c => c.bal > 0 ? html`<b class="num bad">${money(c.bal)}</b>` : badge('لا دين', 'ok') }, { key: 'x', label: '', cls: 'nolabel', align: 'end', render: c => html`<div class="row gap4" style="justify-content:flex-end">${c.bal > 0 && canM ? html`<button class="btn sm ok" data-pay="${c.id}">دفعة</button>` : ''}${canM ? html`<button class="btn sm icon ghost" data-del="${c.id}" title="حذف">${icon('trash', 14)}</button>` : ''}</div>` }], rows: pg.items, empty: 'لا يوجد زبائن بعد', rowAttr: c => `data-row data-id="${c.id}"` })}${pager(pg)}</div>`.toString();
}

let bound = new WeakSet();
export default {
  render(view) {
    root = view; st.page = 1; draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', async e => {
      const T = e.target; try {
        const pg = T.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
        const ex = T.closest('[data-exp]'); if (ex) return exportTable(spec(), ex.dataset.exp);
        if (T.closest('[data-new]')) return void await customerForm(null);
        const py = T.closest('[data-pay]'); if (py) return void await payDialog(py.dataset.pay);
        const dl = T.closest('[data-del]'); if (dl) { if (await confirmBox({ title: 'حذف الزبون', message: 'حذف هذا الزبون؟ (لا يمكن حذف زبون له فواتير)', danger: true, ok: 'حذف' })) { await ops.deleteCustomer(dl.dataset.del); toast('تم الحذف'); } return; }
        const r = T.closest('tr[data-row]'); if (r) customerDetail(r.dataset.id);
      } catch (er) { toast(er.message, 'err'); }
    });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'q') { st.q = e.target.value; st.page = 1; const p = e.target.selectionStart; draw(); const i = root.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); } }, 150));
    view.addEventListener('change', e => { if (e.target.id === 'f') { st.filter = e.target.value; st.page = 1; draw(); } });
  },
  onChange(names) { if (root && (names.has('customers') || names.has('invoices') || names.has('returns'))) { if (document.activeElement?.id === 'q') return; draw(); } },
  destroy() { root = null; },
};
