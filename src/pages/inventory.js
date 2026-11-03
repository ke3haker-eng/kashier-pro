// إدارة المخزون: الكميات، المنخفضة والنافدة، الصلاحية، سجل الحركات، الجرد.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { inventory, expiryList } from '../core/analytics.js';
import { html, raw, icon, money, toast, modal, formModal, confirmBox, pageHead, table, paginate, pager, badge, thumb, emptyState, statCard, tabs, mny, kv } from '../ui/components.js';
import { fmt, fmtQty, num, r2, sortBy, UNITS, todayKey, fmtDateTime, fmtDate, debounce, esc, latinDigits } from '../core/util.js';
import { exportTable, exportBar } from '../lib/export.js';

const st = { tab: 'stock', q: '', page: 1, mtype: '', mq: '', exp: 'all', counts: {}, countQ: '' };
let root;
export const MOVE_LABEL = { initial: 'رصيد افتتاحي', receive: 'إضافة مخزون', purchase: 'شراء', sale: 'بيع', return: 'مرتجع', void: 'إلغاء فاتورة', adjust_add: 'تعديل (زيادة)', adjust_sub: 'تعديل (نقص)', count: 'جرد' };
const unit = p => UNITS[p.unit] || '';
const canAdj = () => auth.can('inventory.adjust');

export function adjustDialog(pid, mode0 = 'add') {
  const p = store.get('products', pid); if (!p) return;
  return formModal({ title: 'تعديل مخزون: ' + p.name, size: 'sm', intro: html`<div class="muted" style="margin-bottom:8px">الكمية الحالية: <b class="num">${p.track ? fmtQty(p.stock) + ' ' + unit(p) : 'غير متتبعة'}</b></div>`,
    fields: [{ name: 'mode', label: 'نوع التعديل', type: 'select', options: [['add', 'إضافة كمية (استلام)'], ['sub', 'خصم كمية'], ['set', 'ضبط الكمية إلى رقم محدد']], value: mode0, span: 2 }, { name: 'qty', label: 'الكمية', type: 'number', autofocus: true, required: true, span: 2 }, { name: 'reason', label: 'السبب / الملاحظة', span: 2, placeholder: 'مثال: تالف، استلام بضاعة، جرد...' }, { name: 'expiry', label: 'تاريخ انتهاء الدفعة المضافة (اختياري)', type: 'date', span: 2 }, ...(p.track ? [] : [{ name: 'enableTrack', label: 'تفعيل تتبع المخزون لهذا المنتج', type: 'checkbox', value: true, span: 2 }])],
    submit: 'تنفيذ', onSubmit: async v => { await ops.adjustStock({ pid, mode: v.mode, qty: v.qty, reason: v.reason, expiry: v.mode === 'add' ? v.expiry : '', enableTrack: !!v.enableTrack }); toast('تم تعديل المخزون'); } }).done;
}

const filterStock = (state) => {
  let r = store.searchProducts(st.q, { all: true, limit: 0 }).filter(p => p.active !== false);
  if (state === 'low') r = r.filter(p => store.stockState(p) === 'low'); else if (state === 'out') r = r.filter(p => store.stockState(p) === 'out'); else if (state === 'stock') r = r.filter(p => p.track); else if (state === 'untracked') r = r.filter(p => !p.track);
  return r;
};

function stockTable(rows, canCost) {
  const pg = paginate(rows, st.page);
  const cols = [{ key: 'i', label: '', render: p => thumb(p, 38), cls: 'nolabel' }, { key: 'n', label: 'المنتج', render: p => html`<b>${p.name}</b><div class="small muted">${store.catName(p.cat)} ${p.barcode ? '· ' + p.barcode : ''}</div>` },
    { key: 'q', label: 'الكمية', align: 'center', render: p => p.track ? html`<b class="num ${store.stockState(p) === 'out' ? 'bad' : store.stockState(p) === 'low' ? 'warn' : ''}">${fmtQty(p.stock)}</b> <span class="small muted">${unit(p)}</span>` : badge('بدون تتبع') },
    { key: 'm', label: 'الحد الأدنى', align: 'center', render: p => p.track ? html`<span class="num">${fmtQty(store.minOf(p))}</span>` : '—' },
    ...(canCost ? [{ key: 'v', label: 'قيمة المخزون (تكلفة)', align: 'end', render: p => p.track && p.stock > 0 ? (p.cost == null ? html`<span class="muted small">بلا تكلفة</span>` : mny(r2(p.stock * p.cost))) : '—' }] : []),
    { key: 's', label: 'الحالة', render: p => { const s = store.stockState(p); return s === 'untracked' ? '' : s === 'out' ? badge('نفد', 'bad') : s === 'low' ? badge('منخفض', 'warn') : badge('متوفر', 'ok'); } },
    { key: 'a', label: '', cls: 'nolabel', align: 'end', render: p => canAdj() ? html`<div class="row gap4" style="justify-content:flex-end"><button class="btn sm soft" data-adj="${p.id}" data-mode="add">${icon('plus', 14)} إضافة</button><button class="btn sm" data-adj="${p.id}" data-mode="sub">${icon('minus', 14)} خصم</button><button class="btn sm icon ghost" data-adj="${p.id}" data-mode="set" title="ضبط الكمية">${icon('edit', 14)}</button></div>` : '' }];
  return html`${table({ cols, rows: pg.items, empty: 'لا توجد منتجات في هذه القائمة' })}${pager(pg)}`;
}

function movesTab() {
  let r = store.list('moves').slice().sort((a, b) => b.t.localeCompare(a.t));
  if (st.mtype) r = r.filter(m => m.type === st.mtype);
  if (st.mq) { const q = latinDigits(st.mq).toLowerCase(); r = r.filter(m => (m.pname + ' ' + m.refNo + ' ' + m.reason + ' ' + m.userName).toLowerCase().includes(q)); }
  const pg = paginate(r, st.page, 30);
  return { rows: r, html: html`<div class="toolbar"><input class="inp grow" id="mq" placeholder="بحث باسم المنتج أو رقم الفاتورة أو السبب" value="${st.mq}"><select class="inp" id="mtype" style="width:auto"><option value="">كل الحركات</option>${Object.entries(MOVE_LABEL).map(([k, l]) => html`<option value="${k}" ${st.mtype === k ? raw('selected') : ''}>${l}</option>`)}</select>${exportBar()}</div><div class="card" style="padding:8px">${table({ cols: [{ key: 't', label: 'التاريخ', render: m => html`<span class="num small">${fmtDateTime(m.t)}</span>` }, { key: 'p', label: 'المنتج', render: m => html`<b>${m.pname}</b>` }, { key: 'ty', label: 'الحركة', render: m => badge(MOVE_LABEL[m.type] || m.type, m.qty > 0 ? 'ok' : 'bad') }, { key: 'q', label: 'الكمية', align: 'center', render: m => html`<b class="num ${m.qty > 0 ? 'ok' : 'bad'}" dir="ltr">${m.qty > 0 ? '+' : ''}${fmtQty(m.qty)}</b>` }, { key: 'b', label: 'قبل ← بعد', align: 'center', render: m => html`<span class="num small">${fmtQty(m.before)} ← ${fmtQty(m.after)}</span>` }, { key: 'r', label: 'السبب / المرجع', render: m => html`${m.refNo ? html`<span class="num">${m.refNo}</span> ` : ''}<span class="muted small">${m.reason}</span>` }, { key: 'u', label: 'المستخدم', render: m => m.userName || '' }], rows: pg.items, empty: 'لا توجد حركات مخزون' })}${pager(pg)}</div>` };
}
const movesSpec = rows => ({ name: 'stock-moves', title: 'سجل حركات المخزون', cols: [{ label: 'التاريخ', get: m => fmtDateTime(m.t) }, { label: 'المنتج', get: m => m.pname }, { label: 'الحركة', get: m => MOVE_LABEL[m.type] || m.type }, { label: 'الكمية', get: m => m.qty, num: true }, { label: 'قبل', get: m => m.before, num: true }, { label: 'بعد', get: m => m.after, num: true }, { label: 'المرجع', get: m => m.refNo }, { label: 'السبب', get: m => m.reason }, { label: 'المستخدم', get: m => m.userName }], rows });

function expiryTab() {
  const S = store.settings(); let all = expiryList(S.stock.expiryDays);
  const cnt = { expired: all.filter(x => x.status === 'expired').length, soon: all.filter(x => x.status === 'soon').length, ok: all.filter(x => x.status === 'ok').length };
  if (st.exp !== 'all') all = all.filter(x => x.status === st.exp);
  const loss = r2(all.filter(x => x.status === 'expired').reduce((s, x) => s + (x.lossCost || 0), 0));
  const cols = [{ key: 'n', label: 'المنتج', render: x => html`<b>${x.name}</b><div class="small muted">${x.note}</div>` }, { key: 'q', label: 'الكمية', align: 'center', render: x => x.qty == null ? '—' : html`<span class="num">${fmtQty(x.qty)}</span> <span class="small muted">${UNITS[x.unit] || ''}</span>` }, { key: 'e', label: 'تاريخ الانتهاء', render: x => html`<span class="num">${x.expiry}</span>` }, { key: 'd', label: 'المتبقي', render: x => x.status === 'expired' ? badge('منتهي منذ ' + Math.abs(x.days) + ' يوم', 'bad') : x.status === 'soon' ? badge('بعد ' + x.days + ' يوم', 'warn') : badge('بعد ' + x.days + ' يوم', 'ok') }, { key: 'l', label: 'قيمة التكلفة', align: 'end', render: x => x.lossCost == null ? '—' : mny(x.lossCost) }, { key: 'a', label: '', cls: 'nolabel', align: 'end', render: x => canAdj() && x.status === 'expired' && x.qty > 0 ? html`<button class="btn sm danger" data-dispose="${x.pid}" data-q="${x.qty}" data-b="${x.batchId || ''}">إتلاف الكمية</button>` : '' }];
  return html`<div class="grid g3 mb">${statCard({ label: 'منتهية الصلاحية', value: cnt.expired, icon: 'alert', tone: 'r', sub: loss > 0 ? 'خسارة محتملة: ' + money(loss) : '' })}${statCard({ label: `تنتهي خلال ${S.stock.expiryDays} يوماً`, value: cnt.soon, icon: 'clock', tone: 'o' })}${statCard({ label: 'سليمة', value: cnt.ok, icon: 'check', tone: 'g' })}</div>
    <div class="toolbar">${tabs([['all', 'الكل'], ['expired', 'المنتهية', cnt.expired], ['soon', 'القريبة', cnt.soon], ['ok', 'السليمة', cnt.ok]], st.exp, 'data-exp2')}<span class="muted small">مدة التنبيه المسبق تُضبط من الإعدادات → المخزون.</span><span class="grow"></span>${exportBar()}</div>
    <div class="card" style="padding:8px">${table({ cols, rows: all, empty: 'لا توجد منتجات بتواريخ صلاحية. أضف تاريخ الانتهاء من بطاقة المنتج أو عند استلام فاتورة شراء.' })}</div>`;
}
const expirySpec = () => ({ name: 'expiry', title: 'تقرير الصلاحية', cols: [{ label: 'المنتج', get: x => x.name }, { label: 'الكمية', get: x => x.qty ?? '', num: true }, { label: 'تاريخ الانتهاء', get: x => x.expiry }, { label: 'الأيام المتبقية', get: x => x.days, num: true }, { label: 'الحالة', get: x => ({ expired: 'منتهي', soon: 'قريب', ok: 'سليم' })[x.status] }, { label: 'قيمة التكلفة', get: x => x.lossCost ?? '', num: true }], rows: expiryList(store.settings().stock.expiryDays) });

function countTab() {
  const tracked = store.searchProducts(st.countQ, { all: true, limit: 0 }).filter(p => p.track && p.active !== false), entered = Object.keys(st.counts).filter(k => st.counts[k] !== '');
  const rows = tracked.slice(0, 200);
  const diffs = entered.map(id => { const p = store.get('products', id); const c = num(st.counts[id]); return p && isFinite(c) ? { p, c, d: r2(c - p.stock) } : null; }).filter(Boolean);
  const hist = store.list('counts').slice().sort((a, b) => b.t.localeCompare(a.t)).slice(0, 8);
  return html`<div class="muted mb" style="line-height:1.8">اكتب الكمية الفعلية التي عددتها لكل منتج (اترك الخانة فارغة للمنتجات التي لم تجردها). سيظهر الفرق مباشرة، وعند الاعتماد تُضبط الكميات وتُسجَّل حركات "جرد".</div>
  <div class="toolbar"><input class="inp grow" id="cq" placeholder="بحث عن منتج للجرد" value="${st.countQ}"><span class="badge info">${entered.length} صنف مُدخل</span><span class="badge ${diffs.filter(d => d.d).length ? 'warn' : 'ok'}">${diffs.filter(d => d.d).length} فرق</span>${canAdj() ? html`<button class="btn primary" data-countok ${entered.length ? '' : raw('disabled')}>${icon('check', 16)} اعتماد الجرد</button><button class="btn ghost" data-countclr ${entered.length ? '' : raw('disabled')}>مسح الإدخال</button>` : ''}</div>
  <div class="card" style="padding:8px">${table({ cols: [{ key: 'n', label: 'المنتج', render: p => html`<b>${p.name}</b>` }, { key: 's', label: 'الكمية المسجلة', align: 'center', render: p => html`<span class="num">${fmtQty(p.stock)}</span> <span class="small muted">${unit(p)}</span>` }, { key: 'c', label: 'الكمية الفعلية', align: 'center', render: p => html`<input class="inp num" data-cnt="${p.id}" inputmode="decimal" value="${st.counts[p.id] ?? ''}" style="width:110px;text-align:center;min-height:38px" placeholder="—">` }, { key: 'd', label: 'الفرق', align: 'center', render: p => { const c = num(st.counts[p.id] ?? ''); if (st.counts[p.id] == null || st.counts[p.id] === '' || !isFinite(c)) return ''; const d = r2(c - p.stock); return d === 0 ? badge('مطابق', 'ok') : html`<b class="num ${d > 0 ? 'ok' : 'bad'}" dir="ltr">${d > 0 ? '+' : ''}${fmtQty(d)}</b>`; } }], rows, empty: 'لا توجد منتجات متتبعة للجرد' })}${tracked.length > 200 ? html`<div class="muted small center" style="padding:8px">يعرض أول 200 منتج — استخدم البحث</div>` : ''}</div>
  ${hist.length ? html`<h3 style="margin:18px 0 8px">عمليات الجرد السابقة</h3><div class="card" style="padding:8px">${table({ cols: [{ key: 't', label: 'التاريخ', render: c => html`<span class="num">${fmtDateTime(c.t)}</span>` }, { key: 'u', label: 'المستخدم', render: c => c.userName }, { key: 'n', label: 'أصناف', align: 'center', render: c => c.items.length }, { key: 'f', label: 'فروقات', align: 'center', render: c => c.items.filter(i => i.diff).length }, { key: 'v', label: 'قيمة الفرق (تكلفة)', align: 'end', render: c => { const v = r2(c.items.reduce((s, i) => s + i.costDiff, 0)); return html`<b class="num ${v < 0 ? 'bad' : v > 0 ? 'ok' : ''}">${fmt(v)}</b>`; } }, { key: 'o', label: 'ملاحظة', render: c => c.note || '' }], rows: hist })}</div>` : ''}`;
}

function draw() {
  const inv = inventory(), canCost = auth.can('products.cost');
  const ex = expiryList(); const nExp = ex.filter(x => x.status !== 'ok').length;
  const rows = ['stock', 'low', 'out', 'untracked'].includes(st.tab) ? filterStock(st.tab) : [];
  let body = '';
  if (['stock', 'low', 'out', 'untracked'].includes(st.tab)) body = html`<div class="toolbar"><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="sq" placeholder="بحث بالاسم أو الباركود" value="${st.q}" autocomplete="off"></div>${exportBar()}</div><div class="card" style="padding:8px">${stockTable(rows, canCost)}</div>`;
  else if (st.tab === 'expiry') body = expiryTab(); else if (st.tab === 'moves') body = movesTab().html; else body = countTab();
  root.innerHTML = html`${pageHead('المخزون', '', 'تتبع الكميات والصلاحية والحركات')}
    <div class="stats mb">${statCard({ label: 'المنتجات المتتبعة', value: inv.tracked, icon: 'box', tone: 'b' })}${canCost ? statCard({ label: 'قيمة المخزون (تكلفة)', value: money(inv.costValue), icon: 'dollar', tone: 'g', sub: inv.unknownCost ? `${inv.unknownCost} منتج بلا سعر شراء غير محتسب` : 'قيمة البيع: ' + money(inv.retailValue), subKind: inv.unknownCost ? 'warn' : '' }) : statCard({ label: 'قيمة البيع', value: money(inv.retailValue), icon: 'dollar', tone: 'g' })}${statCard({ label: 'منخفضة المخزون', value: inv.low.length, icon: 'alert', tone: 'o' })}${statCard({ label: 'نافدة', value: inv.out.length, icon: 'alert', tone: 'r' })}</div>
    ${tabs([['stock', 'الكميات'], ['low', 'منخفضة', inv.low.length], ['out', 'نافدة', inv.out.length], ['expiry', 'الصلاحية', nExp || null], ['moves', 'سجل الحركات'], ['count', 'الجرد'], ['untracked', 'غير متتبعة']], st.tab, 'data-tab')}${body}`.toString();
}

const specFor = () => {
  if (st.tab === 'expiry') return expirySpec(); if (st.tab === 'moves') return movesSpec(movesTab().rows);
  const canCost = auth.can('products.cost');
  return { name: 'inventory-' + st.tab, title: 'تقرير المخزون', cols: [{ label: 'المنتج', get: p => p.name }, { label: 'الباركود', get: p => p.barcode }, { label: 'التصنيف', get: p => store.catName(p.cat) }, { label: 'الكمية', get: p => p.track ? p.stock : '', num: true }, { label: 'الحد الأدنى', get: p => p.track ? store.minOf(p) : '', num: true }, ...(canCost ? [{ label: 'التكلفة', get: p => p.cost ?? '', num: true }, { label: 'قيمة المخزون', get: p => p.track && p.cost != null ? r2(Math.max(0, p.stock) * p.cost) : '', num: true }] : []), { label: 'سعر البيع', get: p => p.price, num: true }], rows: filterStock(st.tab) };
};

let bound = new WeakSet();
export default {
  render(view, ctx) {
    root = view; const t = ctx.params.get('tab'); if (t) st.tab = t; else if (!bound.has(view)) st.tab = st.tab || 'stock'; st.page = 1;
    draw();
    if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', async e => {
      const T = e.target, tb = T.closest('[data-tab]'); if (tb) { st.tab = tb.dataset.tab; st.page = 1; st.q = ''; draw(); return; }
      const t2 = T.closest('[data-exp2]'); if (t2) { st.exp = t2.dataset.exp2; draw(); return; }
      const pg = T.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
      const ex = T.closest('[data-exp]'); if (ex) return exportTable(specFor(), ex.dataset.exp);
      try {
        const a = T.closest('[data-adj]'); if (a) return void await adjustDialog(a.dataset.adj, a.dataset.mode);
        const d = T.closest('[data-dispose]'); if (d) { const p = store.get('products', d.dataset.dispose); if (await confirmBox({ title: 'إتلاف الكمية المنتهية', message: html`خصم <b>${fmtQty(+d.dataset.q)}</b> من "${p.name}" بسبب انتهاء الصلاحية؟`, danger: true, ok: 'إتلاف' })) { await ops.adjustStock({ pid: p.id, mode: 'sub', qty: +d.dataset.q, reason: 'منتهي الصلاحية' }); toast('تم خصم الكمية المنتهية'); } return; }
        if (T.closest('[data-countclr]')) { st.counts = {}; draw(); return; }
        if (T.closest('[data-countok]')) { const items = Object.entries(st.counts).filter(([, v]) => v !== '' && v != null).map(([pid, v]) => ({ pid, counted: v })); const note = await (await import('../ui/components.js')).promptBox({ title: 'اعتماد الجرد', label: 'ملاحظة على الجرد (اختياري)', required: false, ok: 'اعتماد' }); if (note === null) return; const rec = await ops.stockCount(items, note); st.counts = {}; toast(`تم اعتماد الجرد — ${rec.items.filter(i => i.diff).length} فرق`); draw(); }
      } catch (er) { toast(er.message, 'err'); }
    });
    const dq = debounce(e => { const id = e.target.id; if (id === 'sq' || id === 'mq' || id === 'cq') { if (id === 'sq') st.q = e.target.value; if (id === 'mq') st.mq = e.target.value; if (id === 'cq') st.countQ = e.target.value; st.page = 1; const pos = e.target.selectionStart; draw(); const i = root.querySelector('#' + id); i?.focus(); i?.setSelectionRange(pos, pos); } }, 150);
    view.addEventListener('input', e => { if (e.target.dataset.cnt) { st.counts[e.target.dataset.cnt] = latinDigits(e.target.value); const row = e.target.closest('tr'); const p = store.get('products', e.target.dataset.cnt); const c = num(st.counts[e.target.dataset.cnt]); const cell = row.querySelector('td:last-child'); if (cell) cell.innerHTML = isFinite(c) && st.counts[e.target.dataset.cnt] !== '' ? (r2(c - p.stock) === 0 ? badge('مطابق', 'ok') : html`<b class="num ${c > p.stock ? 'ok' : 'bad'}" dir="ltr">${c > p.stock ? '+' : ''}${fmtQty(r2(c - p.stock))}</b>`).toString() : ''; return; } dq(e); });
    view.addEventListener('change', e => { if (e.target.id === 'mtype') { st.mtype = e.target.value; st.page = 1; draw(); } });
  },
  onChange(names) { if (root && st.tab !== 'count' && (names.has('products') || names.has('moves') || names.has('batches') || names.has('meta'))) { const a = document.activeElement; if (a && a.tagName === 'INPUT') return; draw(); } },
  destroy() { root = null; },
};
