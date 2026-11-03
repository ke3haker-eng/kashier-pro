// المرتجعات: البحث عن الفاتورة الأصلية، تحديد المنتج والكمية والسبب وحالة المنتج، المبلغ المسترد، وسجل كامل.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { unitRefund, REASONS_RETURN, PAY_LABEL } from '../core/calc.js';
import { html, raw, icon, money, priceFmt, toast, modal, pageHead, table, paginate, pager, badge, emptyState, tabs, kv, mny, btnBusy } from '../ui/components.js';
import { fmt, fmtQty, num, r2, r3, fmtDateTime, fmtDate, norm, latinDigits, debounce, UNITS, sum } from '../core/util.js';
import { previewDoc, returnHTML, printHTML } from '../lib/print.js';
import { exportTable, exportBar } from '../lib/export.js';
import { invoiceDetail } from './invoices.js';

const st = { tab: 'new', q: '', invId: '', rows: {}, reason: REASONS_RETURN[0], method: 'cash', amount: '', note: '', page: 1 };
let root;

const candidates = () => {
  const q = norm(st.q);
  return store.list('invoices').filter(i => i.status !== 'void' && !i.legacy && i.items.some(l => (l.returned || 0) < l.qty)).filter(i => !q || norm(i.no + ' ' + (i.customerName || '') + ' ' + i.total + ' ' + i.items.map(l => l.name).join(' ')).includes(q)).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 12);
};
function computed(inv) { let t = 0; for (const [idx, r] of Object.entries(st.rows)) { const q = num(r.qty); if (q > 0) t += unitRefund(inv, inv.items[idx]) * q; } return r2(t); }

function newTab() {
  const inv = st.invId ? store.get('invoices', st.invId) : null;
  if (!inv) {
    const c = candidates();
    return html`<div class="card"><div class="card-h"><h3>1) ابحث عن الفاتورة الأصلية</h3></div><div class="input-ic">${icon('search', 18)}<input class="inp" id="q" placeholder="رقم الفاتورة (مثال INV-000012) أو اسم الزبون أو اسم الصنف" value="${st.q}" autocomplete="off" autofocus></div>
      <div style="margin-top:10px">${c.length ? c.map(i => html`<div class="list-item" data-pick="${i.id}" style="cursor:pointer"><div class="grow"><b class="num">${i.no}</b> <span class="muted small">${fmtDateTime(i.t)}</span><div class="small muted ell">${i.customerName ? i.customerName + ' — ' : ''}${i.items.map(l => l.name).slice(0, 3).join('، ')}</div></div><b class="num">${money(i.total)}</b>${icon('chevL', 16)}</div>`) : emptyState('receipt', st.q ? 'لا توجد فواتير مطابقة قابلة للإرجاع' : 'لا توجد فواتير قابلة للإرجاع بعد')}</div></div>`;
  }
  const total = computed(inv), ref = st.amount !== '' && isFinite(num(st.amount)) ? r2(num(st.amount)) : total;
  return html`<div class="card"><div class="card-h"><h3>فاتورة <span class="num">${inv.no}</span></h3><button class="btn sm ghost" data-back>تغيير الفاتورة</button></div><div class="muted small mb">${fmtDateTime(inv.t)} ${inv.customerName ? '— ' + inv.customerName : ''} — الإجمالي ${money(inv.total)}${inv.due > 0 ? html` — <span class="bad">متبقي دين ${money(inv.due)}</span>` : ''}</div>
    ${table({ cols: [{ key: 'n', label: 'الصنف', render: (l, i) => html`<b>${l.name}</b><div class="small muted">سعر الوحدة بعد الخصم: <span class="num">${fmt(unitRefund(inv, l))}</span></div>` }, { key: 'q', label: 'المباع', align: 'center', render: l => html`<span class="num">${fmtQty(l.qty)}</span>` }, { key: 'r', label: 'سبق إرجاعه', align: 'center', render: l => html`<span class="num">${fmtQty(l.returned || 0)}</span>` }, { key: 'x', label: 'كمية المرتجع', align: 'center', render: (l, i) => { const left = r3(l.qty - (l.returned || 0)); return left <= 0 ? badge('أُرجع بالكامل', '') : html`<div class="row gap4" style="justify-content:center"><input class="inp num" data-rq="${i}" inputmode="decimal" value="${st.rows[i]?.qty ?? ''}" placeholder="0" style="width:80px;text-align:center;min-height:38px"><button class="btn sm soft" data-all="${i}" title="إرجاع المتبقي بالكامل">الكل (${fmtQty(left)})</button></div>`; } }, { key: 'c', label: 'حالة المنتج', render: (l, i) => r3(l.qty - (l.returned || 0)) <= 0 ? '' : html`<select class="inp" data-rc="${i}" style="min-height:38px;width:auto"><option value="good" ${(st.rows[i]?.condition || 'good') === 'good' ? raw('selected') : ''}>سليم (يعود للمخزون)</option><option value="damaged" ${st.rows[i]?.condition === 'damaged' ? raw('selected') : ''}>تالف (لا يعود)</option><option value="expired" ${st.rows[i]?.condition === 'expired' ? raw('selected') : ''}>منتهي (لا يعود)</option></select>` }, { key: 'a', label: 'المبلغ', align: 'end', render: (l, i) => html`<b class="num">${fmt(unitRefund(inv, l) * (num(st.rows[i]?.qty) > 0 ? num(st.rows[i].qty) : 0))}</b>` }], rows: inv.items, stack: false })}</div>
    <div class="grid g2 mt"><div class="card"><div class="form-grid"><div class="field req span2"><label>سبب الإرجاع</label><select class="inp" id="reason">${REASONS_RETURN.map(r => html`<option ${st.reason === r ? raw('selected') : ''}>${r}</option>`)}</select></div><div class="field span2"><label>ملاحظات</label><input class="inp" id="note" value="${st.note}"></div></div></div>
    <div class="card"><div class="kv"><span>المبلغ المحسوب</span><b class="num">${money(total)}</b></div><div class="field" style="margin:8px 0"><label>المبلغ المسترد فعلياً (يمكن تقليله)</label><input class="inp num big-in" id="amt" inputmode="decimal" value="${st.amount !== '' ? st.amount : total || ''}" placeholder="0"></div>${inv.due > 0 ? html`<div class="small muted">سيُخصم أولاً من الدين المتبقي على الفاتورة (${money(inv.due)}) ولا يُدفع نقداً.</div>` : html`<div class="field"><label>طريقة الاسترداد</label><select class="inp" id="rm">${['cash', 'card', 'wallet'].map(k => html`<option value="${k}" ${st.method === k ? raw('selected') : ''}>${PAY_LABEL[k]}</option>`)}</select></div>`}<div class="form-err" id="rerr" hidden style="margin-top:8px"></div><button class="btn danger lg block" style="margin-top:10px" data-do ${total > 0 ? '' : raw('disabled')}>${icon('undo', 18)} تنفيذ المرتجع</button></div></div>`;
}

function listTab() {
  const rs = store.list('returns').slice().sort((a, b) => b.t.localeCompare(a.t)), pg = paginate(rs, st.page);
  return html`<div class="card" style="padding:8px">${table({ cols: [{ key: 'no', label: 'المرتجع', render: r => html`<b class="num">${r.no}</b>` }, { key: 'in', label: 'الفاتورة', render: r => html`<a href="#/invoices?open=${r.invoiceId}" class="num">${r.invoiceNo}</a>` }, { key: 't', label: 'التاريخ', render: r => html`<span class="num small">${fmtDateTime(r.t)}</span>` }, { key: 'i', label: 'الأصناف', render: r => html`<span class="small">${r.items.map(l => l.name + ' ×' + fmtQty(l.qty)).join('، ')}</span>` }, { key: 'rs', label: 'السبب', render: r => r.reason }, { key: 'u', label: 'الموظف', render: r => r.userName }, { key: 'a', label: 'المسترد', align: 'end', render: r => html`<b class="num bad">${money(r.refund)}</b>` }, { key: 'p', label: '', cls: 'nolabel', render: r => html`<button class="btn sm icon ghost" data-rp="${r.id}" title="طباعة">${icon('print', 15)}</button>` }], rows: pg.items, empty: 'لا توجد مرتجعات بعد' })}${pager(pg)}</div>`;
}
const spec = () => ({ name: 'returns', title: 'تقرير المرتجعات', cols: [{ label: 'رقم المرتجع', get: r => r.no }, { label: 'الفاتورة', get: r => r.invoiceNo }, { label: 'التاريخ', get: r => fmtDateTime(r.t) }, { label: 'الأصناف', get: r => r.items.map(l => l.name + ' ×' + l.qty).join('، ') }, { label: 'السبب', get: r => r.reason }, { label: 'الموظف', get: r => r.userName }, { label: 'المبلغ المسترد', get: r => r.refund, num: true }], rows: store.list('returns').slice().sort((a, b) => b.t.localeCompare(a.t)) });

function draw() {
  root.innerHTML = html`${pageHead('المرتجعات', st.tab === 'list' ? exportBar() : '', 'إرجاع منتجات من فاتورة سابقة')}${tabs([['new', 'مرتجع جديد'], ['list', 'سجل المرتجعات', store.count('returns')]], st.tab)}${st.tab === 'new' ? newTab() : listTab()}`.toString();
}
const keepFocus = fn => { const a = document.activeElement, id = a?.id, pos = a?.selectionStart; fn(); if (id) { const e = root.querySelector('#' + id); if (e) { e.focus(); try { e.setSelectionRange(pos, pos); } catch { } } } else if (a?.dataset?.rq != null) { const e = root.querySelector(`[data-rq="${a.dataset.rq}"]`); e?.focus(); try { e?.setSelectionRange(pos, pos); } catch { } } };

let bound = new WeakSet();
export default {
  render(view, ctx) {
    root = view; const inv = ctx.params.get('inv'); if (inv && store.get('invoices', inv)) { Object.assign(st, { tab: 'new', invId: inv, rows: {}, amount: '' }); history.replaceState(null, '', '#/returns'); } else if (!bound.has(view)) { st.invId = ''; st.rows = {}; st.amount = ''; }
    draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', async e => {
      const T = e.target, tb = T.closest('[data-tab]'); if (tb) { st.tab = tb.dataset.tab; st.page = 1; draw(); return; }
      const pk = T.closest('[data-pick]'); if (pk) { st.invId = pk.dataset.pick; st.rows = {}; st.amount = ''; draw(); return; }
      if (T.closest('[data-back]')) { st.invId = ''; st.rows = {}; st.amount = ''; draw(); return; }
      const al = T.closest('[data-all]'); if (al) { const inv = store.get('invoices', st.invId), i = al.dataset.all; st.rows[i] = { ...(st.rows[i] || {}), qty: r3(inv.items[i].qty - (inv.items[i].returned || 0)) }; st.amount = ''; draw(); return; }
      const pg = T.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
      const ex = T.closest('[data-exp]'); if (ex) return exportTable(spec(), ex.dataset.exp);
      const rp = T.closest('[data-rp]'); if (rp) { const r = store.get('returns', rp.dataset.rp); previewDoc(p => returnHTML(r, p === 'a4' ? 'a4' : '80'), 'إيصال مرتجع ' + r.no); return; }
      if (T.closest('[data-do]')) {
        const btn = T.closest('[data-do]'), err = root.querySelector('#rerr'); err.hidden = true;
        await btnBusy(btn, async () => {
          try { const inv = store.get('invoices', st.invId); const items = Object.entries(st.rows).filter(([, r]) => num(r.qty) > 0).map(([idx, r]) => ({ idx: +idx, qty: num(r.qty), condition: r.condition || 'good' })); const rec = await ops.createReturn({ invoiceId: st.invId, items, reason: st.reason, method: st.method, refundAmount: st.amount === '' ? null : st.amount, note: st.note }); toast('تم تنفيذ المرتجع ' + rec.no); st.invId = ''; st.rows = {}; st.amount = ''; st.note = ''; st.q = ''; draw(); previewDoc(p => returnHTML(rec, p === 'a4' ? 'a4' : '80'), 'إيصال مرتجع ' + rec.no); }
          catch (er) { err.textContent = er.message; err.hidden = false; }
        });
      }
    });
    view.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'q') { st.q = t.value; keepFocus(() => { const c = root.querySelector('.card'); draw(); }); return; }
      if (t.dataset.rq != null) { t.value = latinDigits(t.value).replace(/[^\d.]/g, ''); const i = t.dataset.rq, inv = store.get('invoices', st.invId), left = r3(inv.items[i].qty - (inv.items[i].returned || 0)); if (num(t.value) > left) t.value = left; st.rows[i] = { ...(st.rows[i] || {}), qty: t.value }; st.amount = ''; keepFocus(draw); return; }
      if (t.id === 'amt') { t.value = latinDigits(t.value).replace(/[^\d.]/g, ''); st.amount = t.value; return; }
      if (t.id === 'note') st.note = t.value;
    });
    view.addEventListener('change', e => { const t = e.target; if (t.dataset.rc != null) { st.rows[t.dataset.rc] = { ...(st.rows[t.dataset.rc] || {}), condition: t.value }; } if (t.id === 'reason') st.reason = t.value; if (t.id === 'rm') st.method = t.value; });
  },
  onChange(names) { if (root && st.tab === 'list' && names.has('returns')) draw(); },
  destroy() { root = null; },
};
