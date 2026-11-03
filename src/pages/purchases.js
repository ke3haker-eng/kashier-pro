// المشتريات: فواتير شراء (مسودة/معتمدة)، خصم، مدفوع ومتبقي، دفعات جزئية، تحديث المخزون وسعر الشراء تلقائياً عند الاعتماد.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { html, raw, icon, money, priceFmt, toast, modal, confirmBox, pageHead, table, paginate, pager, badge, emptyState, statCard, field, pickFrom, kv, btnBusy, tabs } from '../ui/components.js';
import { fmt, fmtQty, num, r2, r3, todayKey, fmtDate, fmtDateTime, norm, latinDigits, debounce, sortBy, sum, UNITS, esc } from '../core/util.js';
import { openScanner, closeScanner, feedback } from '../lib/scanner.js';
import { exportTable, exportBar } from '../lib/export.js';
import { supplierForm, payDialog } from './suppliers.js';
import { productForm } from './products.js';
import { previewDoc, tableDoc } from '../lib/print.js';

const st = { q: '', status: 'all', page: 1, mode: 'list', ed: null };
let root;
const blank = (supplierId = '') => ({ id: null, supplierId, date: todayKey(), items: [], discount: '', paid: '', method: 'cash', note: '' });
const METHOD = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', transfer: 'تحويل بنكي' };
const totals = ed => { const sub = r2(sum(ed.items, i => (num(i.qty) || 0) * (num(i.cost) || 0))), disc = Math.max(0, num(ed.discount) || 0), total = r2(sub - disc), paid = Math.max(0, num(ed.paid) || 0); return { sub, disc, total, paid, due: r2(total - paid) }; };
const DRAFT_KEY = () => 'kp_pdraft';
const saveDraftLocal = () => { try { if (st.ed && !st.ed.id) localStorage.setItem(DRAFT_KEY(), JSON.stringify(st.ed)); } catch { } };

function listView() {
  const q = norm(st.q); let r = store.list('purchases').slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  if (st.status !== 'all') r = r.filter(p => st.status === 'due' ? p.status === 'approved' && p.due > 0 : p.status === st.status);
  if (q) r = r.filter(p => norm(p.no + ' ' + p.supplierName + ' ' + p.items.map(i => i.name).join(' ')).includes(q));
  const pg = paginate(r, st.page), ap = store.list('purchases').filter(p => p.status === 'approved');
  return html`${pageHead('المشتريات', html`${auth.can('purchases.manage') ? html`<button class="btn primary" data-new>${icon('plus', 18)} فاتورة شراء</button>` : ''}${exportBar()}`, 'فواتير الشراء من الموردين')}
  <div class="grid g3 mb">${statCard({ label: 'مشتريات هذا الشهر', value: money(sum(ap.filter(p => p.date.slice(0, 7) === todayKey().slice(0, 7)), p => p.total)), icon: 'cart', tone: 'b' })}${statCard({ label: 'مستحق للموردين', value: money(sum(ap, p => p.due)), icon: 'wallet', tone: 'o' })}${statCard({ label: 'مسودات', value: store.list('purchases').filter(p => p.status === 'draft').length, icon: 'edit', tone: 'p' })}</div>
  <div class="toolbar"><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="q" placeholder="بحث برقم الفاتورة أو المورد أو الصنف" value="${st.q}" autocomplete="off"></div><select class="inp" id="s" style="width:auto">${[['all', 'كل الفواتير'], ['approved', 'معتمدة'], ['draft', 'مسودات'], ['due', 'عليها مستحق']].map(([v, l]) => html`<option value="${v}" ${st.status === v ? raw('selected') : ''}>${l}</option>`)}</select></div>
  <div class="card" style="padding:8px">${table({ cols: [{ key: 'no', label: 'الفاتورة', render: p => html`<b class="num">${p.no}</b>` }, { key: 'd', label: 'التاريخ', render: p => html`<span class="num">${p.date}</span>` }, { key: 's', label: 'المورد', render: p => p.supplierName }, { key: 'i', label: 'الأصناف', align: 'center', render: p => html`<span class="num">${p.items.length}</span>` }, { key: 't', label: 'الإجمالي', align: 'end', render: p => html`<b class="num">${money(p.total)}</b>` }, { key: 'p', label: 'المدفوع', align: 'end', render: p => html`<span class="num">${money(p.paid)}</span>` }, { key: 'du', label: 'المتبقي', align: 'end', render: p => p.status === 'approved' && p.due > 0 ? html`<b class="num bad">${money(p.due)}</b>` : html`<span class="muted">—</span>` }, { key: 'st', label: 'الحالة', render: p => p.status === 'draft' ? badge('مسودة', 'warn') : p.due > 0 ? ((p.paid || 0) > 0 ? badge('جزئي', 'info') : badge('غير مدفوعة', 'warn')) : badge('مسدّدة', 'ok') }], rows: pg.items, empty: 'لا توجد فواتير شراء', rowAttr: p => `data-row data-id="${p.id}"` })}${pager(pg)}</div>`;
}
const spec = () => ({ name: 'purchases', title: 'فواتير الشراء', cols: [{ label: 'الفاتورة', get: p => p.no }, { label: 'التاريخ', get: p => p.date }, { label: 'المورد', get: p => p.supplierName }, { label: 'الحالة', get: p => p.status === 'draft' ? 'مسودة' : 'معتمدة' }, { label: 'الإجمالي', get: p => p.total, num: true }, { label: 'المدفوع', get: p => p.paid, num: true }, { label: 'المتبقي', get: p => p.due, num: true }], rows: store.list('purchases').slice().sort((a, b) => b.date.localeCompare(a.date)) });

function editorView() {
  const ed = st.ed, t = totals(ed), sups = sortBy(store.list('suppliers'), s => s.name);
  const untracked = ed.items.filter(i => store.get('products', i.pid) && !store.get('products', i.pid).track);
  return html`${pageHead(ed.id ? 'تعديل مسودة شراء' : 'فاتورة شراء جديدة', html`<button class="btn ghost" data-cancel>${icon('x', 16)} إلغاء</button>`, 'أضف الأصناف المستلمة وأسعار شرائها — يُحدَّث المخزون عند الاعتماد')}
  <div class="grid g-main"><div class="col">
    <div class="card"><div class="form-grid"><div class="field req"><label>المورد</label><div class="row"><select class="inp" id="sup">${[['', '— اختر المورد —'], ...sups.map(s => [s.id, s.name])].map(([v, l]) => html`<option value="${v}" ${ed.supplierId === v ? raw('selected') : ''}>${l}</option>`)}</select><button class="btn icon" data-newsup title="مورد جديد">${icon('plus', 18)}</button></div></div><div class="field req"><label>تاريخ الشراء</label><input class="inp" type="date" id="date" value="${ed.date}"></div></div></div>
    <div class="card"><div class="card-h"><h3>الأصناف</h3></div><div class="row mb"><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="padd" placeholder="امسح الباركود أو اكتب اسم المنتج ثم Enter" autocomplete="off"></div><button class="btn icon" data-cam title="مسح بالكاميرا">${icon('cam', 18)}</button><button class="btn" data-pick>${icon('list', 16)} اختيار</button><button class="btn soft" data-newprod>${icon('plus', 16)} منتج جديد</button></div>
    ${ed.items.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الصنف</th><th style="width:100px">الكمية</th><th style="width:110px">سعر الشراء</th><th style="width:150px">انتهاء الصلاحية</th><th class="end">الإجمالي</th><th></th></tr></thead><tbody>${ed.items.map((it, i) => { const p = store.get('products', it.pid); return html`<tr><td><b>${p?.name || it.name}</b><div class="small muted">${p ? 'التكلفة الحالية: ' + (p.cost == null ? '—' : fmt(p.cost)) + ' · المخزون: ' + (p.track ? fmtQty(p.stock) : 'غير متتبع') : ''}</div></td><td><input class="inp num" data-f="qty" data-i="${i}" inputmode="decimal" value="${it.qty}" style="min-height:38px"></td><td><input class="inp num" data-f="cost" data-i="${i}" inputmode="decimal" value="${it.cost}" style="min-height:38px">${p && p.cost != null && num(it.cost) > p.cost * 1.0001 ? html`<div class="small warn">▲ أعلى من آخر سعر</div>` : ''}</td><td><input class="inp" type="date" data-f="expiry" data-i="${i}" value="${it.expiry || ''}" style="min-height:38px"></td><td class="end"><b class="num" data-lt="${i}">${fmt((num(it.qty) || 0) * (num(it.cost) || 0))}</b></td><td><button class="btn sm icon ghost" data-rm="${i}">${icon('trash', 14)}</button></td></tr>`; })}</tbody></table></div>` : emptyState('box', 'لم تُضف أصناف بعد')}
    ${untracked.length ? html`<div class="form-err" style="margin-top:10px;font-weight:500">${untracked.length} منتج غير مُتتبّع المخزون (${untracked.map(i => i.name).join('، ')}) — سيتم تفعيل تتبع المخزون لها عند الاعتماد.</div>` : ''}</div>
    <div class="card"><div class="field"><label>ملاحظات</label><textarea class="inp" id="note" rows="2">${ed.note}</textarea></div></div></div>
  <div class="col"><div class="card" id="tot">${totalsBox(t)}</div>
    <div class="card"><div class="form-grid"><div class="field"><label>خصم على الفاتورة</label><input class="inp num" id="disc" inputmode="decimal" value="${ed.discount}" placeholder="0"></div><div class="field"><label>المبلغ المدفوع الآن</label><input class="inp num" id="paid" inputmode="decimal" value="${ed.paid}" placeholder="0"></div><div class="field span2"><label>طريقة الدفع</label><select class="inp" id="method">${Object.entries(METHOD).map(([k, v]) => html`<option value="${k}" ${ed.method === k ? raw('selected') : ''}>${v}</option>`)}</select></div></div>
    <div class="form-err" id="perr" hidden style="margin-top:10px"></div>
    <button class="btn ok lg block" style="margin-top:12px" data-approve>${icon('check', 20)} اعتماد الفاتورة وتحديث المخزون</button><button class="btn block" style="margin-top:8px" data-draft>${icon('edit', 16)} حفظ كمسودة</button></div></div></div>`;
}
const totalsBox = t => html`${kv('مجموع الأصناف', money(t.sub))}${t.disc > 0 ? kv('الخصم', '−' + money(t.disc)) : ''}${kv('الإجمالي', money(t.total), 'big')}${kv('المدفوع', money(t.paid))}${kv('المتبقي للمورد', html`<span class="${t.due > 0 ? 'bad' : t.due < 0 ? 'warn' : 'ok'}">${money(t.due)}</span>`)}`;

function detail(id) {
  const p = store.get('purchases', id); if (!p) return;
  const pays = store.list('payments').filter(x => x.kind === 'supplier' && x.alloc?.some(a => a.ref === id));
  const m = modal({ title: html`فاتورة شراء <span class="num">${p.no}</span> ${p.status === 'draft' ? badge('مسودة', 'warn') : p.due > 0 ? ((p.paid || 0) > 0 ? badge('جزئي', 'info') : badge('غير مدفوعة', 'warn')) : badge('مسدّدة', 'ok')}`, size: 'lg', body: html`<div class="grid g2 keep"><div class="card flat">${kv('المورد', p.supplierName)}${kv('التاريخ', p.date)}${kv('أنشأها', p.userName || '—')}${p.note ? kv('ملاحظة', p.note) : ''}</div><div class="card flat">${kv('مجموع الأصناف', money(p.subtotal))}${p.discount > 0 ? kv('الخصم', '−' + money(p.discount)) : ''}${kv('الإجمالي', money(p.total), 'big')}${kv('المدفوع', money(p.paid))}${kv('المتبقي', html`<span class="${p.due > 0 ? 'bad' : ''}">${money(p.due)}</span>`)}</div></div>
    <div class="card flat" style="padding:6px">${table({ cols: [{ key: 'n', label: 'الصنف', render: i => html`<b>${i.name}</b>` }, { key: 'q', label: 'الكمية', align: 'center', render: i => html`<span class="num">${fmtQty(i.qty)}</span> <span class="small muted">${UNITS[i.unit] || ''}</span>` }, { key: 'c', label: 'سعر الشراء', align: 'end', render: i => html`<span class="num">${priceFmt(i.cost)}</span>` }, { key: 'e', label: 'الصلاحية', render: i => i.expiry || '—' }, { key: 't', label: 'الإجمالي', align: 'end', render: i => html`<b class="num">${fmt(i.total)}</b>` }], rows: p.items, stack: false })}</div>
    ${pays.length ? html`<div class="card flat"><b>الدفعات</b>${pays.map(x => html`<div class="kv"><span>${fmtDateTime(x.t)} — ${METHOD[x.method] || x.method}${x.note ? ' — ' + x.note : ''}</span><b class="num">${money(x.alloc.find(a => a.ref === id).amount)}</b></div>`)}</div>` : ''}`,
    footer: html`${p.status === 'draft' && auth.can('purchases.manage') ? html`<button class="btn primary" data-edit>${icon('edit', 16)} تعديل / اعتماد</button><button class="btn danger" data-del>حذف المسودة</button>` : ''}${p.status === 'approved' && p.due > 0 && auth.can('purchases.manage') ? html`<button class="btn ok" data-pay>${icon('cash', 16)} تسديد دفعة</button>` : ''}<button class="btn" data-print>${icon('print', 16)} طباعة</button>` });
  const q = s => m.el.querySelector(s);
  q('[data-edit]') && (q('[data-edit]').onclick = () => { m.close(); st.ed = { id: p.id, supplierId: p.supplierId, date: p.date, items: p.items.map(i => ({ pid: i.pid, name: i.name, qty: i.qty, cost: i.cost, expiry: i.expiry })), discount: p.discount || '', paid: '', method: 'cash', note: p.note }; st.mode = 'edit'; draw(); });
  q('[data-del]') && (q('[data-del]').onclick = async () => { if (await confirmBox({ title: 'حذف المسودة', message: 'حذف مسودة الشراء؟', danger: true, ok: 'حذف' })) { await ops.deletePurchaseDraft(id); m.close(); toast('تم الحذف'); } });
  q('[data-pay]') && (q('[data-pay]').onclick = async () => { await payDialog(p.supplierId, id); m.close(); detail(id); });
  q('[data-print]').onclick = () => previewDoc(pp => tableDoc({ title: 'فاتورة شراء ' + p.no, subtitle: `${p.supplierName} — ${p.date}`, summary: [['الإجمالي', money(p.total)], ['المدفوع', money(p.paid)], ['المتبقي', money(p.due)]], cols: [{ label: 'الصنف', get: i => i.name }, { label: 'الكمية', get: i => fmtQty(i.qty), num: true }, { label: 'سعر الشراء', get: i => priceFmt(i.cost), num: true }, { label: 'الإجمالي', get: i => fmt(i.total), num: true }], rows: p.items, paper: pp }), 'فاتورة شراء');
}

function draw() { root.innerHTML = (st.mode === 'edit' ? editorView() : listView()).toString(); }
function addItem(p) {
  const ex = st.ed.items.find(i => i.pid === p.id && !i.expiry);
  if (ex) ex.qty = r3((num(ex.qty) || 0) + 1); else st.ed.items.push({ pid: p.id, name: p.name, qty: 1, cost: p.cost ?? '', expiry: '' });
  saveDraftLocal(); feedback(); draw(); const idx = st.ed.items.findIndex(i => i.pid === p.id); const f = root.querySelector(`[data-f=qty][data-i="${idx}"]`); f?.focus(); f?.select();
}
function addByCode(v) {
  const code = latinDigits(v).trim(); if (!code) return false; const p = store.byBarcode(code) || store.byCode(code); if (p) { addItem(p); return true; }
  const found = store.searchProducts(code, { limit: 2, all: false }); if (found.length === 1) { addItem(found[0]); return true; } return found.length > 1 ? 'many' : false;
}
async function pickProduct(q = '') {
  const items = store.searchProducts(q, { limit: 0 }).map(p => ({ id: p.id, label: p.name, sub: p.barcode, right: p.cost != null ? 'تكلفة ' + fmt(p.cost) : '' }));
  const id = await pickFrom({ title: 'اختيار منتج', items, placeholder: 'بحث بالاسم أو الباركود' }); if (id) addItem(store.get('products', id));
}
function readForm() { const g = id => root.querySelector('#' + id); st.ed.supplierId = g('sup').value; st.ed.date = g('date').value; st.ed.note = g('note').value; st.ed.discount = g('disc').value; st.ed.paid = g('paid').value; st.ed.method = g('method').value; }
async function submit(approve, btn) {
  const err = root.querySelector('#perr'); err.hidden = true; readForm();
  await btnBusy(btn, async () => {
    try {
      const ed = st.ed; const enableTrack = ed.items.some(i => !store.get('products', i.pid)?.track);
      const r = await ops.savePurchase({ id: ed.id, supplierId: ed.supplierId, date: ed.date, items: ed.items.map(i => ({ pid: i.pid, qty: i.qty, cost: i.cost, expiry: i.expiry })), discount: ed.discount, paid: ed.paid, method: ed.method, note: ed.note, status: approve ? 'approved' : 'draft', enableTrack });
      toast(approve ? `تم اعتماد الفاتورة ${r.no} وتحديث المخزون` : 'تم حفظ المسودة'); try { localStorage.removeItem(DRAFT_KEY()); } catch { } st.mode = 'list'; st.ed = null; draw(); if (approve) detail(r.id);
    } catch (e) { err.textContent = e.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
  });
}

let bound = new WeakSet();
export default {
  async render(view, ctx) {
    root = view; if (ctx.params.get('new') === '1') { let d = null; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY())); } catch { } st.ed = ctx.params.get('supplier') ? blank(ctx.params.get('supplier')) : (d && d.items?.length ? d : blank()); st.mode = 'edit'; history.replaceState(null, '', '#/purchases'); } else if (!bound.has(view)) { st.mode = 'list'; st.ed = null; }
    st.page = 1; draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', async e => {
      const T = e.target; try {
        const pg = T.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
        const ex = T.closest('[data-exp]'); if (ex) return exportTable(spec(), ex.dataset.exp);
        if (T.closest('[data-new]')) { let d = null; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY())); } catch { } if (d?.items?.length && await confirmBox({ title: 'مسودة غير محفوظة', message: 'وُجدت فاتورة شراء لم تكتمل. هل تريد متابعتها؟', ok: 'متابعة', cancel: 'فاتورة جديدة' })) st.ed = d; else { st.ed = blank(); try { localStorage.removeItem(DRAFT_KEY()); } catch { } } st.mode = 'edit'; draw(); return; }
        const row = T.closest('tr[data-row]'); if (row) return detail(row.dataset.id);
        if (st.mode !== 'edit') return;
        if (T.closest('[data-cancel]')) { if (st.ed.items.length && !(await confirmBox({ title: 'إلغاء', message: 'سيتم تجاهل التغييرات غير المحفوظة. متابعة؟', danger: true, ok: 'تجاهل' }))) return; try { localStorage.removeItem(DRAFT_KEY()); } catch { } st.mode = 'list'; st.ed = null; draw(); return; }
        if (T.closest('[data-newsup]')) { readForm(); const id = await supplierForm(null); if (id) { st.ed.supplierId = id; draw(); } return; }
        if (T.closest('[data-pick]')) { readForm(); return void await pickProduct(root.querySelector('#padd').value); }
        if (T.closest('[data-newprod]')) { readForm(); const id = await productForm(null, {}); if (id) addItem(store.get('products', id)); return; }
        if (T.closest('[data-cam]')) { readForm(); return void openScanner(code => { const r = addByCode(code); if (r === true) { closeScanner(); } else toast('غير مسجّل: ' + code, 'err'); }); }
        const rm = T.closest('[data-rm]'); if (rm) { readForm(); st.ed.items.splice(+rm.dataset.rm, 1); saveDraftLocal(); draw(); return; }
        if (T.closest('[data-approve]')) return void await submit(true, T.closest('[data-approve]'));
        if (T.closest('[data-draft]')) return void await submit(false, T.closest('[data-draft]'));
      } catch (er) { toast(er.message, 'err'); }
    });
    view.addEventListener('keydown', e => { if (e.target.id === 'padd' && e.key === 'Enter') { e.preventDefault(); const r = addByCode(e.target.value); if (r === true) { /* redrawn */ } else if (r === 'many') { readForm(); pickProduct(e.target.value); } else if (e.target.value.trim()) toast('المنتج غير موجود — استخدم "منتج جديد"', 'warn'); } });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'q' && st.mode === 'list') { st.q = e.target.value; st.page = 1; const p = e.target.selectionStart; draw(); const i = root.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); } }, 150));
    view.addEventListener('input', e => {
      if (st.mode !== 'edit') return; const t = e.target;
      if (t.dataset.f) { const it = st.ed.items[+t.dataset.i]; if (t.dataset.f !== 'expiry') t.value = latinDigits(t.value).replace(/[^\d.]/g, ''); it[t.dataset.f] = t.value; const lt = root.querySelector(`[data-lt="${t.dataset.i}"]`); if (lt) lt.textContent = fmt((num(it.qty) || 0) * (num(it.cost) || 0)); }
      else if (t.id === 'disc' || t.id === 'paid') t.value = latinDigits(t.value).replace(/[^\d.]/g, '');
      else return;
      readForm(); root.querySelector('#tot').innerHTML = totalsBox(totals(st.ed)).toString(); saveDraftLocal();
    });
    view.addEventListener('change', e => { if (st.mode === 'edit' && ['sup', 'date', 'method'].includes(e.target.id)) { readForm(); saveDraftLocal(); } if (e.target.id === 's') { st.status = e.target.value; st.page = 1; draw(); } });
  },
  onChange(names) { if (root && st.mode === 'list' && (names.has('purchases') || names.has('payments') || names.has('suppliers'))) { if (document.activeElement?.id === 'q') return; draw(); } },
  destroy() { root = null; closeScanner(); },
};
