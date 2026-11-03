// الموردون: بياناتهم، الرصيد المستحق، سجل التعاملات (فواتير ودفعات)، تسديد دفعات، كشف حساب.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { supplierBalances } from '../core/analytics.js';
import { html, raw, icon, money, toast, modal, formModal, confirmBox, pageHead, table, paginate, pager, badge, emptyState, statCard, avatar, kv, tabs } from '../ui/components.js';
import { fmt, fmtDateTime, fmtDate, norm, debounce, sortBy, r2, sum } from '../core/util.js';
import { exportTable, exportBar } from '../lib/export.js';
import { previewDoc, tableDoc } from '../lib/print.js';

const st = { q: '', filter: 'all', page: 1 };
let root;
const METHOD = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', transfer: 'تحويل بنكي' };

export function supplierForm(id) {
  return new Promise(res => {
    const s = id ? store.get('suppliers', id) : {}; let saved = null;
    formModal({ title: id ? 'تعديل مورد' : 'مورد جديد', size: 'sm', fields: [{ name: 'name', label: 'اسم المورد', required: true, autofocus: true, span: 2 }, { name: 'phone', label: 'رقم الهاتف', attrs: 'inputmode="tel"', span: 2 }, { name: 'address', label: 'العنوان', span: 2 }, { name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 2, span: 2 }], values: s, onSubmit: async v => { const r = await ops.saveSupplier({ ...v, id }); saved = r.id; toast(id ? 'تم التعديل' : 'تمت إضافة المورد'); } }).done.then(() => res(saved));
  });
}
export function payDialog(supplierId, purchaseId = null) {
  const s = store.get('suppliers', supplierId), pend = store.list('purchases').filter(p => p.supplierId === supplierId && p.status === 'approved' && p.due > 0 && (!purchaseId || p.id === purchaseId)), debt = r2(sum(pend, p => p.due));
  return formModal({ title: 'تسديد دفعة للمورد ' + s.name, size: 'sm', intro: html`<div class="change-box" style="background:var(--warnb);color:#b45309;margin-bottom:10px">المستحق: ${money(debt)}</div><div class="muted small mb">تُوزَّع الدفعة تلقائياً على الفواتير الأقدم أولاً.</div>`, fields: [{ name: 'amount', label: 'المبلغ', type: 'number', value: debt || '', required: true, autofocus: true, span: 2 }, { name: 'method', label: 'طريقة الدفع', type: 'select', options: Object.entries(METHOD), span: 2 }, { name: 'note', label: 'ملاحظة', span: 2 }], submit: 'تسجيل الدفعة', onSubmit: async v => { await ops.paySupplier(supplierId, v.amount, v.method, v.note, purchaseId); toast('تم تسجيل الدفعة'); } }).done;
}
export function supplierStatement(id) {
  const ev = [];
  for (const p of store.list('purchases')) if (p.supplierId === id && p.status === 'approved') ev.push({ t: p.approvedAt || p.createdAt, ref: p.no, note: 'فاتورة شراء', debit: p.total, credit: 0 });
  for (const p of store.list('payments')) if (p.kind === 'supplier' && p.partyId === id) ev.push({ t: p.t, ref: '', note: 'دفعة — ' + (METHOD[p.method] || p.method) + (p.note ? ' — ' + p.note : ''), debit: 0, credit: p.amount });
  ev.sort((a, b) => a.t.localeCompare(b.t)); let bal = 0; for (const e of ev) { bal = r2(bal + e.debit - e.credit); e.bal = bal; } return ev;
}
const stSpec = s => ({ name: 'supplier-' + s.name, title: 'كشف حساب مورد: ' + s.name, subtitle: s.phone || '', summary: [['المستحق للمورد', money(store.supplierBalance(s.id))]], cols: [{ label: 'التاريخ', get: e => fmtDateTime(e.t) }, { label: 'المرجع', get: e => e.ref }, { label: 'البيان', get: e => e.note }, { label: 'فواتير (علينا)', get: e => e.debit || '', num: true }, { label: 'دفعات (لنا)', get: e => e.credit || '', num: true }, { label: 'الرصيد', get: e => e.bal, num: true }], rows: supplierStatement(s.id) });

export function supplierDetail(id) {
  const s = store.get('suppliers', id); if (!s) return;
  const draw = () => {
    const bal = store.supplierBalance(id), ps = store.list('purchases').filter(p => p.supplierId === id && p.status === 'approved'), ev = supplierStatement(id).slice().reverse();
    return html`<div class="grid g3 keep mb" style="grid-template-columns:repeat(3,minmax(0,1fr))">${statCard({ label: 'المستحق للمورد', value: money(bal), icon: 'wallet', tone: bal > 0 ? 'o' : 'g' })}${statCard({ label: 'إجمالي المشتريات', value: money(sum(ps, p => p.total)), icon: 'cart', tone: 'b' })}${statCard({ label: 'عدد الفواتير', value: ps.length, icon: 'receipt', tone: 'p' })}</div>
    <div class="card flat">${s.phone ? kv('الهاتف', html`<span class="num">${s.phone}</span>`) : ''}${s.address ? kv('العنوان', s.address) : ''}${s.notes ? kv('ملاحظات', s.notes) : ''}</div><h4>سجل التعاملات</h4>
    <div class="card flat" style="padding:6px;max-height:340px;overflow:auto">${table({ cols: [{ key: 't', label: 'التاريخ', render: e => html`<span class="num small">${fmtDateTime(e.t)}</span>` }, { key: 'r', label: 'المرجع', render: e => html`<span class="num">${e.ref}</span>` }, { key: 'n', label: 'البيان', render: e => e.note }, { key: 'd', label: 'علينا', align: 'end', render: e => e.debit ? html`<b class="num bad">${fmt(e.debit)}</b>` : '' }, { key: 'c', label: 'دفعنا', align: 'end', render: e => e.credit ? html`<b class="num ok">${fmt(e.credit)}</b>` : '' }, { key: 'b', label: 'الرصيد', align: 'end', render: e => html`<span class="num">${fmt(e.bal)}</span>` }], rows: ev, empty: 'لا توجد معاملات', stack: false })}</div>`;
  };
  const m = modal({ title: s.name, size: 'lg', body: draw(), footer: html`${auth.can('purchases.manage') ? html`<button class="btn ok" data-pay>${icon('cash', 16)} تسديد دفعة</button><button class="btn" data-new>${icon('plus', 16)} فاتورة شراء</button>` : ''}<button class="btn" data-st>${icon('print', 16)} كشف الحساب</button><button class="btn" data-xl>${icon('sheet', 16)} Excel</button>${auth.can('purchases.manage') ? html`<button class="btn" data-ed>${icon('edit', 16)} تعديل</button>` : ''}` });
  const q = x => m.el.querySelector(x);
  q('[data-pay]') && (q('[data-pay]').onclick = async () => { if (!store.supplierBalance(id)) return toast('لا يوجد مستحق لهذا المورد', 'warn'); await payDialog(id); m.setBody(draw()); });
  q('[data-new]') && (q('[data-new]').onclick = () => { m.close(); location.hash = '#/purchases?new=1&supplier=' + id; });
  q('[data-st]').onclick = () => previewDoc(p => tableDoc({ ...stSpec(store.get('suppliers', id)), paper: p }), 'كشف حساب ' + s.name);
  q('[data-xl]').onclick = () => exportTable(stSpec(store.get('suppliers', id)), 'xlsx');
  q('[data-ed]') && (q('[data-ed]').onclick = async () => { await supplierForm(id); m.setBody(draw()); });
}

function rows() {
  const bals = supplierBalances(), q = norm(st.q);
  let r = store.list('suppliers').map(s => ({ ...s, bal: bals.get(s.id) || 0, count: store.list('purchases').filter(p => p.supplierId === s.id && p.status === 'approved').length, total: sum(store.list('purchases').filter(p => p.supplierId === s.id && p.status === 'approved'), p => p.total) }));
  if (q) r = r.filter(s => norm(s.name + ' ' + (s.phone || '')).includes(q)); if (st.filter === 'debt') r = r.filter(s => s.bal > 0);
  return sortBy(r, s => st.filter === 'debt' ? -s.bal : s.name);
}
const spec = () => ({ name: 'suppliers', title: 'الموردون', cols: [{ label: 'الاسم', get: s => s.name }, { label: 'الهاتف', get: s => s.phone }, { label: 'العنوان', get: s => s.address }, { label: 'عدد الفواتير', get: s => s.count, num: true }, { label: 'إجمالي المشتريات', get: s => s.total, num: true }, { label: 'المستحق', get: s => s.bal, num: true }], rows: rows() });
function draw() {
  const all = rows(), pg = paginate(all, st.page), canM = auth.can('purchases.manage'), tot = sum([...supplierBalances().values()], x => x);
  root.innerHTML = html`${pageHead('الموردون', html`${canM ? html`<button class="btn primary" data-new>${icon('plus', 18)} مورد جديد</button>` : ''}${exportBar()}`, `${store.count('suppliers')} مورد`)}
  <div class="grid g3 mb">${statCard({ label: 'عدد الموردين', value: store.count('suppliers'), icon: 'truck', tone: 'b' })}${statCard({ label: 'إجمالي المستحق للموردين', value: money(tot), icon: 'wallet', tone: 'o' })}${statCard({ label: 'موردون لهم مستحقات', value: [...supplierBalances().values()].filter(v => v > 0).length, icon: 'alert', tone: 'r' })}</div>
  <div class="toolbar"><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="q" placeholder="بحث بالاسم أو الهاتف" value="${st.q}" autocomplete="off"></div><select class="inp" id="f" style="width:auto"><option value="all" ${st.filter === 'all' ? raw('selected') : ''}>كل الموردين</option><option value="debt" ${st.filter === 'debt' ? raw('selected') : ''}>لهم مستحقات</option></select></div>
  <div class="card" style="padding:8px">${table({ cols: [{ key: 'a', label: '', render: s => avatar(s.name, 40), cls: 'nolabel' }, { key: 'n', label: 'المورد', render: s => html`<b>${s.name}</b><div class="small muted num">${s.phone || ''}</div>` }, { key: 'c', label: 'الفواتير', align: 'center', render: s => html`<span class="num">${s.count}</span>` }, { key: 't', label: 'إجمالي المشتريات', align: 'end', render: s => html`<span class="num">${money(s.total)}</span>` }, { key: 'b', label: 'المستحق', align: 'end', render: s => s.bal > 0 ? html`<b class="num bad">${money(s.bal)}</b>` : badge('مسدّد', 'ok') }, { key: 'x', label: '', cls: 'nolabel', align: 'end', render: s => canM ? html`<div class="row gap4" style="justify-content:flex-end">${s.bal > 0 ? html`<button class="btn sm ok" data-pay="${s.id}">دفعة</button>` : ''}<button class="btn sm icon ghost" data-del="${s.id}">${icon('trash', 14)}</button></div>` : '' }], rows: pg.items, empty: 'لا يوجد موردون بعد', rowAttr: s => `data-row data-id="${s.id}"` })}${pager(pg)}</div>`.toString();
}

let bound = new WeakSet();
export default {
  render(view) {
    root = view; st.page = 1; draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', async e => {
      const T = e.target; try {
        const pg = T.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
        const ex = T.closest('[data-exp]'); if (ex) return exportTable(spec(), ex.dataset.exp);
        if (T.closest('[data-new]')) return void await supplierForm(null);
        const py = T.closest('[data-pay]'); if (py) return void await payDialog(py.dataset.pay);
        const dl = T.closest('[data-del]'); if (dl) { if (await confirmBox({ title: 'حذف المورد', message: 'حذف هذا المورد؟ (لا يمكن حذف مورد لديه فواتير)', danger: true, ok: 'حذف' })) { await ops.deleteSupplier(dl.dataset.del); toast('تم الحذف'); } return; }
        const r = T.closest('tr[data-row]'); if (r) supplierDetail(r.dataset.id);
      } catch (er) { toast(er.message, 'err'); }
    });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'q') { st.q = e.target.value; st.page = 1; const p = e.target.selectionStart; draw(); const i = root.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); } }, 150));
    view.addEventListener('change', e => { if (e.target.id === 'f') { st.filter = e.target.value; st.page = 1; draw(); } });
  },
  onChange(names) { if (root && (names.has('suppliers') || names.has('purchases') || names.has('payments'))) { if (document.activeElement?.id === 'q') return; draw(); } },
  destroy() { root = null; },
};
