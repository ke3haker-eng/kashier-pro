// إدارة المنتجات: إضافة/تعديل/حذف محمي/أرشفة، تصنيفات، عروض، استيراد وتصدير Excel/CSV، توليد باركود، ماسح كاميرا.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { html, raw, icon, money, priceFmt, toast, modal, formModal, confirmBox, promptBox, pageHead, table, paginate, pager, badge, thumb, emptyState, field, statCard, tabs, readForm, delegate, mny } from '../ui/components.js';
import { fmt, fmtQty, num, r2, esc, norm, latinDigits, sortBy, UNITS, todayKey, addDays, pickFile, readText, readBuf, download, debounce, fmtDate } from '../core/util.js';
import { offerLabel, offerActive } from '../core/calc.js';
import { openScanner, closeScanner, feedback } from '../lib/scanner.js';
import { pickImage } from '../lib/image.js';
import { exportTable, exportBar } from '../lib/export.js';
import { parseCSV, toCSV } from '../lib/csv.js';
import { makeXLSX, readXLSX } from '../lib/xlsx.js';

const st = { q: '', cat: '', filter: 'all', sort: 'name', dir: 1, page: 1 };
let root;

const UNIT_OPTS = [['pc', 'بالقطعة'], ['kg', 'بالكيلو (السعر لكل كجم)'], ['g', 'بالجرام (السعر لكل جرام)']];
const stockBadge = p => { const s = store.stockState(p); return s === 'untracked' ? badge('بدون تتبع', '') : s === 'out' ? badge('نفد', 'bad') : s === 'low' ? badge('منخفض', 'warn') : badge('متوفر', 'ok'); };
const qtyTxt = p => p.track ? fmtQty(p.stock) + ' ' + (UNITS[p.unit] || '') : '—';

// باركود داخلي فريد (EAN-13 بخانة تحقق) للمنتجات التي لا تحمل باركود
export function genBarcode() {
  for (let t = 0; t < 50; t++) { let d = '29' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0'); let s = 0; for (let i = 0; i < 12; i++) s += +d[i] * (i % 2 ? 3 : 1); const bc = d + ((10 - s % 10) % 10); if (!store.byBarcode(bc)) return bc; }
  return String(Date.now());
}

// ---------- نموذج المنتج (يُستعمل أيضاً من نقطة البيع والمشتريات) ----------
export function productForm(id, defaults = {}, { stay = false } = {}) {
  return new Promise(res => {
    const cur = id ? store.get('products', id) : null, canCost = auth.can('products.cost'), S = store.settings();
    const v = cur ? { ...cur } : { unit: 'pc', track: true, stock: '', ...defaults };
    let img = cur?.img ?? defaults.img ?? null, lastId = null;
    const cats = [['', '— بدون تصنيف —'], ...sortBy(store.list('categories'), c => c.name).map(c => [c.id, c.name])];
    const sups = [['', '— بدون مورد —'], ...sortBy(store.list('suppliers'), s => s.name).map(s => [s.id, s.name])];
    const fields = [
      { name: 'name', label: 'اسم المنتج', required: true, autofocus: true, span: 2 },
      { name: 'barcode', label: 'الباركود', placeholder: 'امسح أو اكتب', extra: html`<button type="button" class="btn icon" data-scan title="مسح بالكاميرا">${icon('cam', 18)}</button><button type="button" class="btn icon" data-gen title="توليد باركود داخلي">${icon('barcode', 18)}</button>` },
      { name: 'code', label: 'الكود الداخلي', placeholder: 'اختياري' },
      { name: 'cat', label: 'التصنيف', type: 'select', options: cats },
      { name: 'unit', label: 'وحدة البيع', type: 'select', options: UNIT_OPTS },
      { name: 'price', label: 'سعر البيع', type: 'number', required: true },
      ...(canCost ? [{ name: 'cost', label: 'سعر الشراء (التكلفة)', type: 'number', hint: '<span id="mg"></span>'.replace(/.*/, '') }] : []),
      ...(cur ? [] : [{ name: 'stock', label: 'الكمية الافتتاحية', type: 'number', placeholder: '0' }]),
      { name: 'min', label: 'الحد الأدنى للمخزون', type: 'number', placeholder: 'الافتراضي: ' + S.stock.lowDefault },
      { name: 'expiry', label: 'تاريخ انتهاء الصلاحية', type: 'date' },
      { name: 'supplierId', label: 'المورد', type: 'select', options: sups },
      { name: 'desc', label: 'وصف المنتج', type: 'textarea', span: 2, rows: 2 },
      { name: 'track', label: 'تتبّع كمية المخزون لهذا المنتج', type: 'checkbox', span: 2 },
    ];
    const imgBox = () => html`<div class="row" style="margin-bottom:12px"><div id="imgp">${img ? html`<img class="thumb" style="width:72px;height:72px" src="${img}" alt="">` : html`<div class="thumb" style="width:72px;height:72px;display:flex;align-items:center;justify-content:center;color:var(--t2)">${icon('image', 28)}</div>`}</div><div class="col gap6"><div class="row wrap gap6"><button type="button" class="btn sm" data-img>${icon('image', 16)} اختيار صورة</button><button type="button" class="btn sm" data-imgcam>${icon('cam', 16)} التقاط</button>${img ? html`<button type="button" class="btn sm danger" data-imgrm>إزالة</button>` : ''}</div><div class="hint small muted">تُصغَّر الصورة تلقائياً وتُحفظ داخل التطبيق</div></div></div>`;
    const collect = f => { const d = { ...f }; d.img = img; if (!canCost) delete d.cost; if (cur) delete d.stock; d.track = !!d.track; if (d.stock === '') d.stock = 0; return d; };
    const m = formModal({ title: cur ? 'تعديل منتج' : 'منتج جديد', size: 'lg', fields, values: { ...v, track: v.track !== false }, submit: 'حفظ', intro: imgBox(), extraFooter: cur ? '' : html`<button type="button" class="btn soft" data-another>حفظ وإضافة آخر</button>`,
      onSubmit: async f => { const p = await ops.saveProduct(collect(f), id); lastId = p.id; toast(cur ? 'تم تعديل المنتج' : 'تمت إضافة المنتج'); return p.id; },
      onReady: (mm, form) => {
        const $ = s => form.querySelector(s), setImg = d => { img = d; const box = form.querySelector('#imgp').parentElement; box.outerHTML = imgBox().toString(); };
        mm.el.addEventListener('click', async e => {
          if (e.target.closest('[data-scan]')) openScanner(c => { $('[name=barcode]').value = c; closeScanner(); feedback(); });
          if (e.target.closest('[data-gen]')) $('[name=barcode]').value = genBarcode();
          if (e.target.closest('[data-img]')) { const d = await pickImage(); if (d) setImg(d); }
          if (e.target.closest('[data-imgcam]')) { const d = await pickImage({ capture: true }); if (d) setImg(d); }
          if (e.target.closest('[data-imgrm]')) setImg(null);
          if (e.target.closest('[data-another]')) { const btn = e.target.closest('[data-another]'); btn.disabled = true; const err = mm.el.querySelector('.form-err'); err.hidden = true; try { const f = readForm(form); for (const k of ['price', 'cost', 'stock', 'min']) if (f[k] !== undefined && f[k] !== '') { const n = num(f[k]); if (isFinite(n)) f[k] = n; } if (!String(f.name).trim()) throw new Error('الحقل "اسم المنتج" مطلوب'); const p = await ops.saveProduct(collect(f)); lastId = p.id; toast('تمت إضافة "' + p.name + '" — أضف المنتج التالي'); for (const k of ['name', 'barcode', 'code', 'price', 'cost', 'stock', 'min', 'expiry', 'desc']) { const el = $(`[name=${k}]`); if (el) el.value = ''; } img = null; setImg(null); $('[name=name]').focus(); } catch (er) { err.textContent = er.message; err.hidden = false; } finally { btn.disabled = false; } }
        });
        const mg = () => { const p = num($('[name=price]').value), c = num($('[name=cost]')?.value ?? ''); const el = $('[name=cost]')?.closest('.field')?.querySelector('.hint'); if (!$('[name=cost]')) return; let h = form.querySelector('#mg'); if (!h) { h = document.createElement('div'); h.id = 'mg'; h.className = 'hint'; $('[name=cost]').closest('.field').append(h); } h.textContent = isFinite(p) && isFinite(c) && p > 0 ? `الربح للوحدة: ${fmt(p - c)} — الهامش ${fmt((p - c) / p * 100)}%` : ''; h.style.color = isFinite(p) && isFinite(c) && c > p ? 'var(--bad)' : ''; };
        form.addEventListener('input', mg); mg();
      } });
    m.done.then(r => res(r === true ? lastId : (typeof r === 'string' ? r : lastId)));
  });
}

// ---------- التصنيفات ----------
function categoriesDialog() {
  const draw = () => { const cs = sortBy(store.list('categories'), c => c.name); return html`<form class="row" data-add style="margin-bottom:10px"><input class="inp" name="n" placeholder="اسم تصنيف جديد" autocomplete="off" autofocus><button class="btn primary">${icon('plus', 16)} إضافة</button></form>${cs.length ? cs.map(c => html`<div class="list-item"><div class="grow"><b>${c.name}</b><div class="small muted">${store.list('products').filter(p => p.cat === c.id).length} منتج</div></div><button class="btn sm icon" data-ed="${c.id}">${icon('edit', 14)}</button><button class="btn sm icon danger" data-del="${c.id}">${icon('trash', 14)}</button></div>`) : emptyState('layers', 'لا توجد تصنيفات')}`; };
  const m = modal({ title: 'التصنيفات', body: draw() });
  m.el.addEventListener('submit', async e => { if (!e.target.matches('[data-add]')) return; e.preventDefault(); try { await ops.saveCategory({ name: e.target.n.value }); m.setBody(draw()); m.el.querySelector('[name=n]').focus(); } catch (er) { toast(er.message, 'err'); } });
  m.el.addEventListener('click', async e => {
    const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]');
    try {
      if (ed) { const c = store.get('categories', ed.dataset.ed); const n = await promptBox({ title: 'تعديل التصنيف', label: 'الاسم', value: c.name }); if (n) { await ops.saveCategory({ id: c.id, name: n }); m.setBody(draw()); } }
      if (del) { if (await confirmBox({ title: 'حذف التصنيف', message: 'سيبقى المنتجات بدون تصنيف. متابعة؟', danger: true, ok: 'حذف' })) { await ops.deleteCategory(del.dataset.del); m.setBody(draw()); } }
    } catch (er) { toast(er.message, 'err'); }
  });
}

// ---------- العروض ----------
function offerForm(id) {
  const o = id ? store.get('offers', id) : { type: 'pct', value: '', buy: 1, get: 1, start: '', end: '', active: true };
  const prods = sortBy(store.list('products').filter(p => p.active !== false), p => p.name).map(p => [p.id, p.name + ' — ' + priceFmt(p.price)]);
  return formModal({ title: id ? 'تعديل عرض' : 'عرض جديد', fields: [{ name: 'pid', label: 'المنتج', type: 'select', options: [['', '— اختر المنتج —'], ...prods], value: o.pid || '', span: 2, required: true }, { name: 'type', label: 'نوع العرض', type: 'select', options: [['pct', 'خصم بنسبة مئوية %'], ['fixed', 'خصم بمبلغ ثابت للوحدة'], ['bogo', 'اشترِ كمية واحصل على مجاناً']], value: o.type }, { name: 'value', label: 'قيمة الخصم', type: 'number', value: o.value }, { name: 'buy', label: 'اشترِ (كمية)', type: 'number', value: o.buy }, { name: 'get', label: 'احصل مجاناً (كمية)', type: 'number', value: o.get }, { name: 'start', label: 'يبدأ في', type: 'date', value: o.start }, { name: 'end', label: 'ينتهي في', type: 'date', value: o.end, hint: 'اتركه فارغاً لعرض بلا نهاية' }, { name: 'active', label: 'العرض مفعّل', type: 'checkbox', value: o.active !== false }], submit: 'حفظ العرض', onSubmit: async v => { await ops.saveOffer({ ...v, id }); toast('تم حفظ العرض'); } }).done;
}
function offersDialog() {
  const draw = () => { const os = store.list('offers').slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); const t = todayKey(); return html`<div class="row" style="margin-bottom:10px"><button class="btn primary" data-new>${icon('plus', 16)} عرض جديد</button></div>${os.length ? os.map(o => { const p = store.get('products', o.pid); const on = offerActive(o, t); return html`<div class="list-item"><div class="grow"><b>${p?.name || '—'}</b><div class="small muted">${offerLabel(o)}${o.end ? ' — حتى ' + o.end : ''}${o.start && o.start > t ? ' — يبدأ ' + o.start : ''}</div></div>${on ? badge('ساري', 'ok') : badge(o.active === false ? 'متوقف' : 'منتهي/لم يبدأ', 'warn')}<button class="btn sm icon" data-ed="${o.id}">${icon('edit', 14)}</button><button class="btn sm icon danger" data-del="${o.id}">${icon('trash', 14)}</button></div>`; }) : emptyState('gift', 'لا توجد عروض')}`; };
  const m = modal({ title: 'العروض والخصومات على المنتجات', size: 'lg', body: draw() });
  m.el.addEventListener('click', async e => {
    try {
      if (e.target.closest('[data-new]')) { await offerForm(null); m.setBody(draw()); }
      const ed = e.target.closest('[data-ed]'); if (ed) { await offerForm(ed.dataset.ed); m.setBody(draw()); }
      const del = e.target.closest('[data-del]'); if (del && await confirmBox({ title: 'حذف العرض', message: 'حذف هذا العرض؟', danger: true, ok: 'حذف' })) { await ops.deleteOffer(del.dataset.del); m.setBody(draw()); }
    } catch (er) { toast(er.message, 'err'); }
  });
}

// ---------- الاستيراد ----------
const COLS = [['name', 'اسم المنتج', ['اسم المنتج', 'الاسم', 'المنتج', 'name', 'product', 'item']], ['barcode', 'الباركود', ['الباركود', 'باركود', 'barcode', 'ean', 'upc']], ['code', 'الكود الداخلي', ['الكود', 'الكود الداخلي', 'كود', 'code', 'sku']], ['catName', 'التصنيف', ['التصنيف', 'الفئة', 'category']], ['unit', 'الوحدة', ['الوحدة', 'وحدة البيع', 'unit']], ['cost', 'سعر الشراء', ['سعر الشراء', 'التكلفة', 'cost']], ['price', 'سعر البيع', ['سعر البيع', 'السعر', 'price']], ['stock', 'الكمية', ['الكمية', 'المخزون', 'الرصيد', 'stock', 'qty', 'quantity']], ['min', 'الحد الأدنى', ['الحد الأدنى', 'حد الطلب', 'min']], ['expiry', 'تاريخ الانتهاء', ['تاريخ الانتهاء', 'تاريخ انتهاء الصلاحية', 'الصلاحية', 'expiry']], ['supplier', 'المورد', ['المورد', 'supplier']], ['desc', 'الوصف', ['الوصف', 'وصف المنتج', 'description', 'desc']]];
const UNIT_MAP = { 'قطعة': 'pc', 'حبة': 'pc', 'pc': 'pc', 'piece': 'pc', 'كجم': 'kg', 'كيلو': 'kg', 'كغ': 'kg', 'kg': 'kg', 'جرام': 'g', 'جم': 'g', 'غرام': 'g', 'g': 'g' };
const isoDate = v => { if (v === '' || v == null) return ''; if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); } const s = latinDigits(String(v)).trim(); let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return s; };
export function mapRows(matrix) {
  if (!matrix.length) throw new Error('الملف فارغ');
  const head = matrix[0].map(h => norm(String(h ?? '')));
  const idx = {}; for (const [k, , names] of COLS) { const i = head.findIndex(h => names.some(n => norm(n) === h)); if (i >= 0) idx[k] = i; }
  if (idx.name == null) throw new Error('لم يُعثر على عمود "اسم المنتج" في الصف الأول. حمّل القالب لمعرفة الأعمدة المطلوبة.');
  const supByName = new Map(store.list('suppliers').map(s => [norm(s.name), s.id]));
  const rows = [], warn = [];
  matrix.slice(1).forEach((r, ri) => {
    if (!r || r.every(c => c === '' || c == null)) return; const o = {}; const g = k => idx[k] == null ? undefined : r[idx[k]];
    o.name = String(g('name') ?? '').trim();
    for (const k of ['barcode', 'code']) { let x = g(k); if (x !== undefined && x !== '') { if (typeof x === 'number') x = Number.isInteger(x) ? x.toFixed(0) : String(x); o[k] = latinDigits(String(x)).trim(); } }
    for (const k of ['price', 'cost', 'stock', 'min']) { const x = g(k); if (x !== undefined && x !== '') o[k] = typeof x === 'number' ? x : x; }
    if (g('unit') !== undefined && g('unit') !== '') { const u = UNIT_MAP[norm(String(g('unit')))]; if (u) o.unit = u; else warn.push(`صف ${ri + 2}: وحدة غير معروفة "${g('unit')}" (استُخدمت القطعة)`); }
    if (g('catName') !== undefined && String(g('catName')).trim()) o.catName = String(g('catName')).trim();
    if (g('expiry') !== undefined && g('expiry') !== '') o.expiry = isoDate(g('expiry'));
    if (g('supplier') !== undefined && String(g('supplier')).trim()) { const sid = supByName.get(norm(String(g('supplier')))); if (sid) o.supplierId = sid; else warn.push(`صف ${ri + 2}: المورد "${g('supplier')}" غير موجود (تجاهله)`); }
    if (g('desc') !== undefined && g('desc') !== '') o.desc = String(g('desc'));
    rows.push(o);
  });
  if (!rows.length) throw new Error('لا توجد صفوف بيانات في الملف'); return { rows, warn, mapped: Object.keys(idx) };
}
function templateBlob() { return makeXLSX([{ name: 'المنتجات', rows: [COLS.map(c => c[1]), ['حليب طازج 1 لتر', '6281000000011', 'P001', 'ألبان', 'قطعة', 4.2, 5.5, 50, 10, '2026-12-31', '', 'حليب كامل الدسم'], ['جبنة بيضاء', '6281000000028', 'P002', 'ألبان', 'كجم', 22, 30, 12.5, 3, '', '', '']] }]); }
async function importDialog() {
  const m = modal({ title: 'استيراد المنتجات من Excel / CSV', size: 'lg', body: html`<div class="muted" style="line-height:1.9">الصف الأول يجب أن يحتوي أسماء الأعمدة (مثل: اسم المنتج، الباركود، التصنيف، سعر الشراء، سعر البيع، الكمية...). عمود <b>اسم المنتج</b> فقط إلزامي. المنتج الذي باركوده موجود يُحدَّث، وغيره يُضاف. التصنيفات الجديدة تُنشأ تلقائياً.</div><div class="row wrap"><button class="btn" data-tpl>${icon('download', 16)} تحميل قالب Excel</button><button class="btn primary" data-pick>${icon('upload', 16)} اختيار ملف</button></div><div id="imp"></div>`, size: 'lg' });
  const out = m.el.querySelector('#imp');
  m.el.querySelector('[data-tpl]').onclick = () => download('products-template.xlsx', templateBlob());
  m.el.querySelector('[data-pick]').onclick = async () => {
    const f = await pickFile('.xlsx,.csv,.txt'); if (!f) return; out.innerHTML = '<div class="skel" style="height:80px"></div>';
    try {
      let matrix; if (/\.xlsx$/i.test(f.name)) { const sheets = await readXLSX(await readBuf(f)); matrix = (sheets.find(s => s.rows.length) || {}).rows; } else matrix = parseCSV(await readText(f));
      const { rows, warn, mapped } = mapRows(matrix || []);
      const exist = rows.filter(r => r.barcode && store.byBarcode(r.barcode)).length;
      out.innerHTML = html`<div class="card flat" style="margin-top:10px">${statCard({ label: 'صفوف جاهزة', value: rows.length, icon: 'list', tone: 'plain' })}<div class="small muted" style="margin-top:8px">أعمدة تم التعرف عليها: ${COLS.filter(c => mapped.includes(c[0])).map(c => c[1]).join('، ')}</div><div class="small" style="margin-top:6px">سيتم تحديث <b>${exist}</b> منتج موجود وإضافة <b>${rows.length - exist}</b> جديد (تقريباً).</div>${warn.length ? html`<div class="form-err" style="margin-top:8px;font-weight:500">${warn.slice(0, 6).map(w => html`<div>${w}</div>`)}${warn.length > 6 ? `و${warn.length - 6} تنبيهات أخرى` : ''}</div>` : ''}<div class="tbl-wrap" style="max-height:200px;margin-top:8px"><table class="tbl"><thead><tr><th>الاسم</th><th>الباركود</th><th>سعر البيع</th><th>الكمية</th></tr></thead><tbody>${rows.slice(0, 8).map(r => html`<tr><td>${r.name}</td><td class="num">${r.barcode || ''}</td><td class="num">${r.price ?? ''}</td><td class="num">${r.stock ?? ''}</td></tr>`)}</tbody></table></div><div class="row" style="margin-top:10px"><label class="row small"><input type="checkbox" id="upd" checked> تحديث المنتجات الموجودة (حسب الباركود)</label></div><button class="btn primary block" style="margin-top:10px" data-go>${icon('check', 16)} استيراد ${rows.length} صف</button></div>`.toString();
      out.querySelector('[data-go]').onclick = async e => { const b = e.target.closest('button'); b.disabled = true; b.classList.add('spin'); try { const r = await ops.importProducts(rows, { update: out.querySelector('#upd').checked }); showResult(r); } catch (er) { toast(er.message, 'err'); b.disabled = false; b.classList.remove('spin'); } };
    } catch (er) { out.innerHTML = `<div class="form-err" style="margin-top:10px">${esc(er.message)}</div>`; }
  };
  const showResult = r => { out.innerHTML = html`<div class="card flat" style="margin-top:10px"><h3 class="ok">اكتمل الاستيراد</h3>${kvs(r)}${r.errors.length ? html`<div class="form-err" style="margin-top:8px;font-weight:500;max-height:160px;overflow:auto">${r.errors.map(e => html`<div>صف ${e.row}: ${e.msg}</div>`)}</div>` : ''}</div>`.toString(); };
  const kvs = r => html`<div class="kv"><span>أُضيف</span><b>${r.added}</b></div><div class="kv"><span>حُدّث</span><b>${r.updated}</b></div><div class="kv"><span>تُخطّي</span><b>${r.skipped}</b></div><div class="kv"><span>أخطاء (لم تُستورد)</span><b class="${r.errors.length ? 'bad' : ''}">${r.errors.length}</b></div>`;
}

// ---------- التصدير ----------
function exportSpec() {
  const canCost = auth.can('products.cost');
  return { name: 'products', title: 'قائمة المنتجات', cols: [{ label: 'اسم المنتج', get: p => p.name }, { label: 'الباركود', get: p => p.barcode }, { label: 'الكود الداخلي', get: p => p.code }, { label: 'التصنيف', get: p => store.catName(p.cat) }, { label: 'الوحدة', get: p => UNITS[p.unit] }, ...(canCost ? [{ label: 'سعر الشراء', get: p => p.cost ?? '', num: true }] : []), { label: 'سعر البيع', get: p => p.price, num: true }, { label: 'الكمية', get: p => p.track ? p.stock : '', num: true }, { label: 'الحد الأدنى', get: p => p.min ?? '', num: true }, { label: 'تاريخ الانتهاء', get: p => p.expiry }, { label: 'المورد', get: p => store.supplierName(p.supplierId) }, { label: 'الوصف', get: p => p.desc }], rows: filtered() };
}

// ---------- القائمة ----------
function filtered() {
  let r = store.searchProducts(st.q, { cat: st.cat, all: true, limit: 0 });
  if (st.filter === 'archived') r = r.filter(p => p.active === false); else if (st.filter !== 'all') r = r.filter(p => p.active !== false);
  if (st.filter === 'low') r = r.filter(p => store.stockState(p) === 'low'); if (st.filter === 'out') r = r.filter(p => store.stockState(p) === 'out'); if (st.filter === 'nocost') r = r.filter(p => p.cost == null);
  const key = { name: p => p.name, price: p => p.price, stock: p => p.track ? p.stock : -1, cat: p => store.catName(p.cat), cost: p => p.cost ?? -1 }[st.sort] || (p => p.name);
  return sortBy(r, key, st.dir);
}
async function del(id) {
  const p = store.get('products', id);
  try { if (!(await confirmBox({ title: 'حذف المنتج', message: html`حذف "<b>${p.name}</b>" نهائياً؟`, danger: true, ok: 'حذف' }))) return; await ops.deleteProduct(id); toast('تم الحذف'); }
  catch (e) { if (e.code === 'IN_USE') { if (await confirmBox({ title: 'لا يمكن الحذف', message: e.message, ok: 'أرشفة المنتج' })) { await ops.archiveProduct(id); toast('تمت الأرشفة'); } } else toast(e.message, 'err'); }
}
function draw() {
  const canEdit = auth.can('products.edit'), canCost = auth.can('products.cost'), all = filtered(), pg = paginate(all, st.page);
  const cats = store.list('categories'), cnt = f => store.list('products').filter(f).length;
  const cols = [
    { key: 'img', label: '', render: p => thumb(p, 40), cls: 'nolabel' },
    { key: 'name', label: 'المنتج', sort: true, render: p => html`<b>${p.name}</b>${p.active === false ? html` ${badge('مؤرشف', '')}` : ''}${p.expiry && p.expiry < todayKey() ? html` ${badge('منتهي', 'bad')}` : ''}<div class="small muted">${store.catName(p.cat)}</div>` },
    { key: 'barcode', label: 'الباركود', render: p => html`<span class="num small">${p.barcode || '—'}</span>` },
    ...(canCost ? [{ key: 'cost', label: 'التكلفة', sort: true, align: 'end', render: p => p.cost == null ? html`<span class="muted">—</span>` : mny(p.cost) }] : []),
    { key: 'price', label: 'سعر البيع', sort: true, align: 'end', render: p => html`<b class="num">${priceFmt(p.price)}</b><span class="small muted">${p.unit === 'kg' ? ' /كجم' : p.unit === 'g' ? ' /جم' : ''}</span>${canCost && p.cost != null && p.price > 0 ? html`<div class="small ${p.price < p.cost ? 'bad' : 'muted'}">هامش ${fmt((p.price - p.cost) / p.price * 100)}%</div>` : ''}` },
    { key: 'stock', label: 'الكمية', sort: true, align: 'center', render: p => html`<span class="num">${qtyTxt(p)}</span> ${stockBadge(p)}` },
    { key: 'act', label: 'إجراءات', align: 'end', cls: 'nolabel', render: p => canEdit || auth.can('products.delete') ? html`<div class="row gap4" style="justify-content:flex-end">${canEdit ? html`<button class="btn sm icon" data-act="edit" data-id="${p.id}" title="تعديل">${icon('edit', 15)}</button><button class="btn sm icon" data-act="arch" data-id="${p.id}" title="${p.active === false ? 'استعادة' : 'أرشفة'}">${icon(p.active === false ? 'refresh' : 'layers', 15)}</button>` : ''}${auth.can('products.delete') ? html`<button class="btn sm icon danger" data-act="del" data-id="${p.id}" title="حذف">${icon('trash', 15)}</button>` : ''}</div>` : '' },
  ];
  root.innerHTML = html`${pageHead('المنتجات', html`${canEdit ? html`<button class="btn primary" data-act="new">${icon('plus', 18)} إضافة منتج</button><button class="btn" data-act="import">${icon('upload', 16)} استيراد</button><button class="btn" data-act="cats">${icon('layers', 16)} التصنيفات</button><button class="btn" data-act="offers">${icon('gift', 16)} العروض</button>` : ''}${exportBar()}`, `${store.count('products')} منتج مسجّل`)}
    <div class="toolbar"><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="sq" placeholder="بحث بالاسم أو الباركود أو الكود" value="${st.q}" autocomplete="off"></div>
      <select class="inp" id="scat" style="width:auto"><option value="">كل التصنيفات</option>${cats.map(c => html`<option value="${c.id}" ${st.cat === c.id ? raw('selected') : ''}>${c.name}</option>`)}</select>
      <select class="inp" id="sfil" style="width:auto">${[['all', 'كل المنتجات'], ['low', 'منخفضة المخزون'], ['out', 'نافدة'], ['archived', 'مؤرشفة'], ...(canCost ? [['nocost', 'بدون سعر شراء']] : [])].map(([v, l]) => html`<option value="${v}" ${st.filter === v ? raw('selected') : ''}>${l}</option>`)}</select></div>
    <div class="card" style="padding:8px">${table({ cols, rows: pg.items, empty: st.q || st.cat || st.filter !== 'all' ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات بعد — ابدأ بإضافة منتج أو استيراد قائمة من Excel', rowAttr: p => `data-row data-id="${p.id}"`, sortKey: st.sort, sortDir: st.dir })}${pager(pg)}</div>`.toString();
  const q = root.querySelector('#sq'); if (document.activeElement?.id === 'sq') { /* keep */ }
}

export default {
  async render(view, ctx) {
    root = view; Object.assign(st, { page: 1 }); draw(); bind(view, ctx);
    if (ctx.params.get('new') === '1' && auth.can('products.edit')) { history.replaceState(null, '', '#/products'); productForm(null); }
  },
  onChange(names) { if (root && (names.has('products') || names.has('categories') || names.has('offers') || names.has('suppliers'))) { const f = document.activeElement?.id, v = f === 'sq' ? document.activeElement.value : null; draw(); if (v != null) { const i = root.querySelector('#sq'); i.focus(); i.setSelectionRange(v.length, v.length); } } },
  destroy() { root = null; },
};

let bound = new WeakSet();
function bind(view) {
  if (bound.has(view)) return; bound.add(view);
  view.addEventListener('input', debounce(e => { if (e.target.id === 'sq') { st.q = e.target.value; st.page = 1; const pos = e.target.selectionStart; draw(); const i = root.querySelector('#sq'); i.focus(); i.setSelectionRange(pos, pos); } }, 120));
  view.addEventListener('change', e => { if (e.target.id === 'scat') { st.cat = e.target.value; st.page = 1; draw(); } if (e.target.id === 'sfil') { st.filter = e.target.value; st.page = 1; draw(); } });
  view.addEventListener('click', async e => {
    const t = e.target;
    const pg = t.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); window.scrollTo(0, 0); return; }
    const so = t.closest('[data-sort]'); if (so) { const k = so.dataset.sort; if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = 1; } draw(); return; }
    const ex = t.closest('[data-exp]'); if (ex) { exportTable(exportSpec(), ex.dataset.exp); return; }
    const a = t.closest('[data-act]'); const id = a?.dataset.id || t.closest('tr[data-row]')?.dataset.id;
    try {
      if (a) { e.stopPropagation(); const k = a.dataset.act; if (k === 'new') await productForm(null); else if (k === 'edit') await productForm(id); else if (k === 'del') await del(id); else if (k === 'arch') { const p = store.get('products', id); await ops.archiveProduct(id, p.active !== false); toast(p.active !== false ? 'تمت الأرشفة' : 'تمت الاستعادة'); } else if (k === 'import') importDialog(); else if (k === 'cats') categoriesDialog(); else if (k === 'offers') offersDialog(); return; }
      if (t.closest('tr[data-row]') && auth.can('products.edit')) await productForm(id);
    } catch (er) { toast(er.message, 'err'); }
  });
}
