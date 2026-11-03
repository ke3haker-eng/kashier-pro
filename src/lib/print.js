// الفواتير والطباعة: A4 وحراري 58/80mm، معاينة، PDF (عبر الطباعة)، مشاركة، وإعادة طباعة.
import { html, raw, fmt, fmtQty, fmtDateTime, fmtDate, str, esc } from '../core/util.js';
import { settings } from '../core/store.js';
import { PAY_LABEL } from '../core/calc.js';
import { modal, toast, seg, icon, money, priceFmt } from '../ui/components.js';
import { UNITS } from '../core/util.js';

const m_ = n => fmt(n) + (settings().cur ? ' ' + settings().cur : '');
const head = (w, S, title) => html`${S.invoice.showLogo && S.logo ? html`<img class="logo" src="${S.logo}" alt="">` : ''}<h1>${S.name || 'كاشير الدكان'}</h1>${S.address ? html`<div class="sub">${S.address}</div>` : ''}${S.phone ? html`<div class="sub">هاتف: <span class="num">${S.phone}</span></div>` : ''}${S.taxNo ? html`<div class="sub">الرقم الضريبي: <span class="num">${S.taxNo}</span></div>` : ''}${title ? html`<div class="c bold" style="margin-top:4px">${title}</div>` : ''}`;

// ---------- فاتورة بيع ----------
export function invoiceHTML(inv, paper = settings().invoice.paper || '80') {
  const S = settings(), a4 = paper === 'a4', w = a4 ? 'a4' : 'w' + paper;
  const qtyT = l => fmtQty(l.qty) + ' ' + (UNITS[l.unit] || '');
  const items = a4
    ? html`<table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th class="e">الإجمالي</th></tr></thead><tbody>${inv.items.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.name}${l.offer ? html` <small>(${l.offer.label})</small>` : ''}${l.note ? html`<br><small>${l.note}</small>` : ''}</td><td>${qtyT(l)}</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt((l.offerDisc || 0) + (l.manualDisc || 0))}</td><td class="e num">${fmt(l.total)}</td></tr>`)}</tbody></table>`
    : html`${inv.items.map(l => html`<div style="margin-bottom:3px"><div>${l.name}</div><div class="kv2"><span class="num">${qtyT(l)} × ${priceFmt(l.price)}</span><b class="num">${fmt(l.gross)}</b></div>${(l.offerDisc || 0) > 0 ? html`<div class="kv2"><small>${l.offer?.label || 'خصم عرض'}</small><small class="num">-${fmt(l.offerDisc)}</small></div>` : ''}${(l.manualDisc || 0) > 0 ? html`<div class="kv2"><small>خصم</small><small class="num">-${fmt(l.manualDisc)}</small></div>` : ''}${l.note ? html`<small>${l.note}</small>` : ''}</div>`)}`;
  const t = html`<hr>
    <div class="kv2"><span>المجموع</span><span class="num">${m_(inv.subtotal)}</span></div>
    ${inv.offerDisc > 0 ? html`<div class="kv2"><span>خصم العروض</span><span class="num">-${m_(inv.offerDisc)}</span></div>` : ''}
    ${inv.lineDisc > 0 ? html`<div class="kv2"><span>خصم على الأصناف</span><span class="num">-${m_(inv.lineDisc)}</span></div>` : ''}
    ${inv.invDisc > 0 ? html`<div class="kv2"><span>خصم على الفاتورة</span><span class="num">-${m_(inv.invDisc)}</span></div>` : ''}
    ${inv.tax > 0 ? html`<div class="kv2"><span>${S.tax.label || 'الضريبة'} ${fmt(inv.taxRate)}%${inv.taxInclusive ? ' (شاملة)' : ''}</span><span class="num">${m_(inv.tax)}</span></div>` : ''}
    <table><tr class="tot"><td>الإجمالي</td><td class="e num">${m_(inv.total)}</td></tr></table>
    ${(inv.payments || []).map(p => html`<div class="kv2"><span>${PAY_LABEL[p.method]}</span><span class="num">${m_(p.amount)}</span></div>`)}
    ${inv.due > 0 ? html`<div class="kv2 bold"><span>آجل (دين)</span><span class="num">${m_(inv.due)}</span></div>` : ''}
    ${inv.method === 'cash' || (inv.change > 0) ? html`<div class="kv2"><span>المستلم</span><span class="num">${m_(inv.received)}</span></div><div class="kv2"><span>الباقي</span><span class="num">${m_(inv.change)}</span></div>` : ''}
    ${(inv.later || []).map(p => html`<div class="kv2"><small>سداد دين ${fmtDate(p.t)}</small><small class="num">${m_(p.amount)}</small></div>`)}
    ${inv.returnedTotal > 0 ? html`<div class="kv2"><span>مرتجعات</span><span class="num">-${m_(inv.returnedTotal)}</span></div>` : ''}`;
  return html`<div class="rcpt ${w}">${head(w, S, 'فاتورة مبيعات')}${inv.status === 'void' ? html`<div class="void">فاتورة ملغاة</div>` : ''}<hr>
    <div class="kv2"><span>رقم الفاتورة</span><b class="num">${inv.no}</b></div><div class="kv2"><span>التاريخ</span><span class="num">${fmtDateTime(inv.t)}</span></div>
    ${inv.userName ? html`<div class="kv2"><span>الموظف</span><span>${inv.userName}</span></div>` : ''}${inv.customerName ? html`<div class="kv2"><span>الزبون</span><span>${inv.customerName}</span></div>` : ''}
    <hr>${items}${t}<hr><div class="c">${S.invoice.footer || ''}</div><div class="c" style="font-size:.8em;margin-top:4px">${inv.legacy ? 'فاتورة مرحّلة من النسخة القديمة' : ''}</div></div>`;
}

// ---------- إيصال مرتجع ----------
export function returnHTML(r, paper = settings().invoice.paper || '80') {
  const S = settings(), w = paper === 'a4' ? 'a4' : 'w' + paper;
  return html`<div class="rcpt ${w}">${head(w, S, 'إيصال مرتجع')}<hr><div class="kv2"><span>رقم المرتجع</span><b class="num">${r.no}</b></div><div class="kv2"><span>على الفاتورة</span><span class="num">${r.invoiceNo}</span></div><div class="kv2"><span>التاريخ</span><span class="num">${fmtDateTime(r.t)}</span></div><div class="kv2"><span>الموظف</span><span>${r.userName}</span></div><div class="kv2"><span>السبب</span><span>${r.reason}</span></div><hr>
    ${r.items.map(l => html`<div class="kv2"><span>${l.name} × <span class="num">${fmtQty(l.qty)}</span></span><span class="num">${fmt(l.refund)}</span></div>`)}<hr>
    <table><tr class="tot"><td>المبلغ المسترد</td><td class="e num">${m_(r.refund)}</td></tr></table>
    ${r.debtCut > 0 ? html`<div class="kv2"><span>خُصم من دين الفاتورة</span><span class="num">${m_(r.debtCut)}</span></div>` : ''}${r.cashOut > 0 ? html`<div class="kv2"><span>المدفوع للزبون (${PAY_LABEL[r.method]})</span><span class="num">${m_(r.cashOut)}</span></div>` : ''}<hr><div class="c">${S.invoice.footer || ''}</div></div>`;
}

// مستند جدولي عام (كشف حساب، تقارير، وردية): {title, subtitle, cols:[{label,get,num}], rows, summary:[[k,v]]}
export function tableDoc({ title, subtitle = '', cols, rows, summary = [], paper = 'a4' }) {
  const S = settings();
  return html`<div class="rcpt ${paper === 'a4' ? 'a4' : 'w' + paper}" style="${raw(paper === 'a4' ? 'width:100%;max-width:190mm' : '')}">${head('', S, '')}<h1 style="margin-top:8px">${title}</h1>${subtitle ? html`<div class="sub">${subtitle}</div>` : ''}<div class="sub">تاريخ الطباعة: ${fmtDateTime(Date.now())}</div><hr>
    ${summary.length ? html`${summary.map(([k, v]) => html`<div class="kv2"><span>${k}</span><b class="num">${v}</b></div>`)}<hr>` : ''}
    <table><thead><tr>${cols.map(c => html`<th class="${c.num ? 'e' : ''}">${c.label}</th>`)}</tr></thead><tbody>${rows.map(r => html`<tr>${cols.map(c => html`<td class="${c.num ? 'e num' : ''}">${c.get(r)}</td>`)}</tr>`)}</tbody></table></div>`;
}

// ---------- الطباعة ----------
const PAGE = { '58': '@page{size:58mm auto;margin:2mm}', '80': '@page{size:80mm auto;margin:2mm}', a4: '@page{size:A4;margin:12mm}' };
export function printHTML(content, paper = '80') {
  let root = document.getElementById('print-root'); if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.append(root); }
  let st = document.getElementById('print-page'); if (!st) { st = document.createElement('style'); st.id = 'print-page'; document.head.append(st); }
  st.textContent = PAGE[paper] || PAGE.a4; root.innerHTML = str(content);
  const clear = () => { root.innerHTML = ''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  const imgs = [...root.querySelectorAll('img')].filter(i => !i.complete);
  Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 50));
}
export const printInvoice = (inv, paper) => printHTML(invoiceHTML(inv, paper || settings().invoice.paper), paper || settings().invoice.paper);

// ---------- نص للمشاركة ----------
export function receiptText(inv) {
  const S = settings(); const L = [];
  L.push(`*${S.name || 'كاشير الدكان'}*`, `فاتورة رقم: ${inv.no}`, `التاريخ: ${fmtDateTime(inv.t)}`); if (inv.customerName) L.push(`الزبون: ${inv.customerName}`); L.push('------------------');
  for (const l of inv.items) L.push(`${l.name}  ${fmtQty(l.qty)}${UNITS[l.unit] ? ' ' + UNITS[l.unit] : ''} × ${priceFmt(l.price)} = ${fmt(l.gross)}`);
  L.push('------------------'); if (inv.discount > 0) L.push(`الخصم: ${m_(inv.discount)}`); if (inv.tax > 0) L.push(`الضريبة: ${m_(inv.tax)}`); L.push(`*الإجمالي: ${m_(inv.total)}*`);
  for (const p of inv.payments || []) L.push(`${PAY_LABEL[p.method]}: ${m_(p.amount)}`); if (inv.due > 0) L.push(`آجل: ${m_(inv.due)}`); if (S.invoice.footer) L.push('', S.invoice.footer);
  return L.join('\n');
}
export async function shareInvoice(inv) {
  const text = receiptText(inv);
  try { if (navigator.share) { await navigator.share({ title: 'فاتورة ' + inv.no, text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('تم نسخ نص الفاتورة — الصقه في واتساب أو أي تطبيق', 'ok'); } catch { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); }
}

// ---------- معاينة ----------
export function previewInvoice(inv, { onClose } = {}) {
  let paper = (() => { try { return localStorage.getItem('kp_paper') || settings().invoice.paper; } catch { return settings().invoice.paper; } })() || '80';
  const m = modal({ title: 'معاينة الفاتورة ' + inv.no, size: 'lg', body: '', footer: html`<button class="btn primary" data-pr>${icon('print', 18)} طباعة</button><button class="btn" data-pdf>${icon('download', 18)} حفظ PDF</button><button class="btn" data-sh>${icon('share', 18)} مشاركة</button>`, onClose });
  const draw = () => m.setBody(html`<div class="row" style="justify-content:center">${seg([['58', 'حراري 58mm'], ['80', 'حراري 80mm'], ['a4', 'A4']], paper, 'data-paper')}</div><div class="preview-paper">${invoiceHTML(inv, paper)}</div>`);
  draw();
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-paper]'); if (b) { paper = b.dataset.paper; try { localStorage.setItem('kp_paper', paper); } catch { } draw(); } });
  m.el.querySelector('[data-pr]').onclick = () => printInvoice(inv, paper);
  m.el.querySelector('[data-pdf]').onclick = () => { toast('في نافذة الطباعة اختر الوجهة "حفظ كـ PDF"', 'info', 4000); printInvoice(inv, paper === '58' || paper === '80' ? 'a4' : paper); };
  m.el.querySelector('[data-sh]').onclick = () => shareInvoice(inv);
  return m;
}
export function previewDoc(contentFn, title = 'معاينة') {
  const m = modal({ title, size: 'lg', body: html`<div class="preview-paper">${contentFn('a4')}</div>`, footer: html`<button class="btn primary" data-pr>${icon('print', 18)} طباعة / PDF</button>` });
  m.el.querySelector('[data-pr]').onclick = () => { toast('للحفظ كملف اختر الوجهة "حفظ كـ PDF"', 'info', 3500); printHTML(contentFn('a4'), 'a4'); };
  return m;
}
