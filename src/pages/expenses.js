// المصروفات: إيجار، كهرباء، أجور، نقل، أخرى — تُخصم من صافي الربح وتدخل في حساب نقدية الوردية عند الدفع نقداً.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { EXPENSE_CATS } from '../core/ops.js';
import { html, raw, icon, money, toast, formModal, confirmBox, pageHead, table, paginate, pager, badge, emptyState, statCard, mny } from '../ui/components.js';
import { donut } from '../ui/charts.js';
import { fmt, todayKey, addDays, norm, debounce, sortBy, r2, sum, fmtDate } from '../core/util.js';
import { exportTable, exportBar } from '../lib/export.js';

const st = { from: todayKey().slice(0, 8) + '01', to: todayKey(), cat: '', q: '', page: 1 };
let root;
const METHOD = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', transfer: 'تحويل بنكي' };
const ICONS = { rent: 'store', electricity: 'zap', wages: 'users', transport: 'truck', other: 'wallet' };

export function expenseForm(id) {
  const e = id ? store.get('expenses', id) : { date: todayKey(), category: 'other', method: 'cash' };
  return formModal({ title: id ? 'تعديل مصروف' : 'مصروف جديد', size: 'sm', fields: [{ name: 'category', label: 'النوع', type: 'select', options: Object.entries(EXPENSE_CATS), span: 2 }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, autofocus: true, span: 2 }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'method', label: 'طريقة الدفع', type: 'select', options: Object.entries(METHOD) }, { name: 'note', label: 'ملاحظة / البيان', span: 2 }], values: e, onSubmit: async v => { await ops.saveExpense({ ...v, id }); toast(id ? 'تم التعديل' : 'تم تسجيل المصروف'); } }).done;
}
function rows() { const q = norm(st.q); return sortBy(store.list('expenses').filter(e => (!st.from || e.date >= st.from) && (!st.to || e.date <= st.to) && (!st.cat || e.category === st.cat) && (!q || norm(e.note + ' ' + EXPENSE_CATS[e.category]).includes(q))), e => e.date + e.createdAt, -1); }
const spec = () => ({ name: 'expenses', title: 'تقرير المصروفات', subtitle: `${st.from} → ${st.to}`, cols: [{ label: 'التاريخ', get: e => e.date }, { label: 'النوع', get: e => EXPENSE_CATS[e.category] }, { label: 'البيان', get: e => e.note }, { label: 'طريقة الدفع', get: e => METHOD[e.method] }, { label: 'المسجِّل', get: e => e.userName }, { label: 'المبلغ', get: e => e.amount, num: true }], rows: rows() });

function draw() {
  const all = rows(), pg = paginate(all, st.page), total = sum(all, e => e.amount), canM = auth.can('expenses.manage');
  const byCat = Object.entries(EXPENSE_CATS).map(([k, l]) => ({ label: l, value: r2(sum(all.filter(e => e.category === k), e => e.amount)) })).filter(x => x.value > 0);
  root.innerHTML = html`${pageHead('المصروفات', html`${canM ? html`<button class="btn primary" data-new>${icon('plus', 18)} مصروف جديد</button>` : ''}${exportBar()}`, 'المصروفات التشغيلية تُخصم من الربح الإجمالي للوصول إلى صافي الربح')}
  <div class="toolbar"><input class="inp" type="date" id="from" value="${st.from}" style="width:auto"><input class="inp" type="date" id="to" value="${st.to}" style="width:auto"><select class="inp" id="cat" style="width:auto"><option value="">كل الأنواع</option>${Object.entries(EXPENSE_CATS).map(([k, l]) => html`<option value="${k}" ${st.cat === k ? raw('selected') : ''}>${l}</option>`)}</select><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="q" placeholder="بحث في البيان" value="${st.q}" autocomplete="off"></div>
    <div class="seg">${[['شهر', 'm'], ['30 يوم', '30'], ['سنة', 'y']].map(([l, k]) => html`<button data-range="${k}">${l}</button>`)}</div></div>
  <div class="grid g-main mb"><div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">${statCard({ label: 'إجمالي المصروفات', value: money(total), icon: 'wallet', tone: 'r', sub: all.length + ' عملية' })}${Object.entries(EXPENSE_CATS).slice(0, 3).map(([k, l], i) => statCard({ label: l, value: money(sum(all.filter(e => e.category === k), e => e.amount)), icon: ICONS[k], tone: ['y', 'b', 'p'][i] }))}</div>
    <div class="card"><div class="card-h"><h3>توزيع المصروفات</h3></div>${byCat.length ? donut(byCat, { center: html`<span class="num">${money(total)}</span>`, sub: 'الإجمالي' }) : emptyState('wallet', 'لا توجد مصروفات')}</div></div>
  <div class="card" style="padding:8px">${table({ cols: [{ key: 'd', label: 'التاريخ', render: e => html`<span class="num">${e.date}</span>` }, { key: 'c', label: 'النوع', render: e => html`<span class="row gap6">${icon(ICONS[e.category], 18)} <b>${EXPENSE_CATS[e.category]}</b></span>` }, { key: 'n', label: 'البيان', render: e => e.note || html`<span class="muted">—</span>` }, { key: 'm', label: 'الدفع', render: e => badge(METHOD[e.method], 'p') }, { key: 'u', label: 'المسجِّل', render: e => e.userName || '' }, { key: 'a', label: 'المبلغ', align: 'end', render: e => html`<b class="num bad">${money(e.amount)}</b>` }, { key: 'x', label: '', cls: 'nolabel', align: 'end', render: e => canM ? html`<div class="row gap4" style="justify-content:flex-end"><button class="btn sm icon ghost" data-ed="${e.id}">${icon('edit', 14)}</button><button class="btn sm icon ghost" data-del="${e.id}">${icon('trash', 14)}</button></div>` : '' }], rows: pg.items, empty: 'لا توجد مصروفات في هذه الفترة', foot: pg.items.length ? html`<tr><td colspan="5">إجمالي الفترة</td><td class="end num">${money(total)}</td><td></td></tr>` : '' })}${pager(pg)}</div>`.toString();
}

let bound = new WeakSet();
export default {
  render(view) {
    root = view; st.page = 1; draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', async e => {
      const T = e.target; try {
        const pg = T.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
        const ex = T.closest('[data-exp]'); if (ex) return exportTable(spec(), ex.dataset.exp);
        const rg = T.closest('[data-range]'); if (rg) { const t = todayKey(); st.to = t; st.from = rg.dataset.range === 'm' ? t.slice(0, 8) + '01' : rg.dataset.range === '30' ? addDays(t, -29) : t.slice(0, 5) + '01-01'; st.page = 1; draw(); return; }
        if (T.closest('[data-new]')) return void await expenseForm(null);
        const ed = T.closest('[data-ed]'); if (ed) return void await expenseForm(ed.dataset.ed);
        const dl = T.closest('[data-del]'); if (dl) { if (await confirmBox({ title: 'حذف المصروف', message: 'حذف هذا المصروف؟', danger: true, ok: 'حذف' })) { await ops.deleteExpense(dl.dataset.del); toast('تم الحذف'); } }
      } catch (er) { toast(er.message, 'err'); }
    });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'q') { st.q = e.target.value; st.page = 1; const p = e.target.selectionStart; draw(); const i = root.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); } }, 150));
    view.addEventListener('change', e => { const id = e.target.id; if (id === 'from' || id === 'to') st[id] = e.target.value; else if (id === 'cat') st.cat = e.target.value; else return; st.page = 1; draw(); });
  },
  onChange(names) { if (root && names.has('expenses')) { if (document.activeElement?.id === 'q') return; draw(); } },
  destroy() { root = null; },
};
