// نوافذ فتح وإغلاق الوردية + تقرير الوردية (تُستخدم من الشريط العلوي ومن نقطة البيع ومن صفحة الموظفين)
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { shiftSummary } from '../core/analytics.js';
import { formModal, modal, html, icon, money, toast, kv, confirmBox } from './components.js';
import { fmtDateTime, fmt, num, r2 } from '../core/util.js';
import { printHTML, previewDoc } from '../lib/print.js';

export const myShift = () => store.currentShift(auth.current()?.id);

export function openShiftDialog() {
  return formModal({ title: 'فتح وردية جديدة', fields: [{ name: 'cash', label: 'النقدية في الدرج عند البداية (رصيد بداية الوردية)', type: 'number', value: 0, hint: 'عدّ النقود الموجودة في الدرج الآن', autofocus: true }], submit: 'فتح الوردية', onSubmit: async v => { await ops.openShift(v.cash || 0); toast('تم فتح الوردية'); } }).done;
}

export function shiftReportHTML(shift) {
  const s = shift.status === 'closed' && shift.summary ? shift.summary : shiftSummary(shift);
  const rows = [['رصيد بداية الوردية', money(shift.openingCash || 0)], ['عدد الفواتير', s.salesCount], ['إجمالي المبيعات', money(s.salesTotal)], ['مبيعات نقدية', money(s.cashSales)], ['مبيعات بطاقة', money(s.cardSales)], ['مبيعات محفظة', money(s.walletSales)], ['مبيعات آجلة', money(s.creditSales)], ['الخصومات', money(s.discounts)], ['مرتجعات (' + s.returnsCount + ')', money(s.returnsTotal)], ['استردادات نقدية', money(s.retCash)], ['دفعات ديون نقدية', money(s.custCash)], ['مصروفات نقدية', money(s.expCash)], ['دفعات موردين نقدية', money(s.supCash)], ['النقدية المتوقعة', money(s.expectedCash)]];
  if (shift.status === 'closed') rows.push(['النقدية الفعلية', money(shift.counted)], ['الفرق (الفعلي − المتوقع)', money(shift.diff)]);
  return rows;
}
export function printShiftReport(shift) {
  import('../lib/print.js').then(({ tableDoc }) => previewDoc(p => tableDoc({ title: 'تقرير الوردية', subtitle: `${shift.userName} — فُتحت ${fmtDateTime(shift.openedAt)}${shift.closedAt ? ' — أُغلقت ' + fmtDateTime(shift.closedAt) : ''}`, cols: [{ label: 'البند', get: r => r[0] }, { label: 'القيمة', get: r => r[1], num: true }], rows: shiftReportHTML(shift), paper: p }), 'تقرير الوردية'));
}

export function closeShiftDialog(shift = myShift()) {
  if (!shift) { toast('لا توجد وردية مفتوحة', 'warn'); return; }
  const s = shiftSummary(shift);
  const m = modal({ title: 'إغلاق الوردية', body: html`<div class="card flat">${kv('رصيد البداية', money(shift.openingCash || 0))}${kv('مبيعات نقدية', money(s.cashIn))}${kv('دفعات ديون نقدية', money(s.custCash))}${kv('استردادات نقدية', '−' + money(s.retCash + s.voidCash))}${kv('مصروفات ودفعات موردين نقدية', '−' + money(s.expCash + s.supCash))}${kv('النقدية المتوقعة في الدرج', money(s.expectedCash), 'big')}</div>
    <div class="field"><label>النقدية الفعلية بعد العدّ</label><input class="inp big-in" id="counted" inputmode="decimal" autofocus placeholder="0"></div><div id="diff" class="change-box" style="display:none"></div>
    <div class="field"><label>ملاحظات</label><textarea id="cnote" class="inp" rows="2"></textarea></div><div class="form-err" hidden></div>`,
    footer: html`<button class="btn primary" data-ok>${icon('check', 18)} إغلاق الوردية</button><button class="btn ghost" data-close>إلغاء</button>` });
  const inp = m.el.querySelector('#counted'), d = m.el.querySelector('#diff');
  inp.oninput = () => { const c = num(inp.value); if (!isFinite(c)) { d.style.display = 'none'; return; } const df = r2(c - s.expectedCash); d.style.display = ''; d.className = 'change-box' + (df === 0 ? '' : ' bad'); d.textContent = df === 0 ? 'مطابق ✓' : (df > 0 ? 'زيادة ' : 'عجز ') + fmt(Math.abs(df)); };
  m.el.querySelector('[data-ok]').onclick = async () => {
    const c = num(inp.value); const e = m.el.querySelector('.form-err'); if (!isFinite(c) || c < 0) { e.textContent = 'أدخل النقدية الفعلية'; e.hidden = false; return; }
    try { const closed = await ops.closeShift(shift.id, c, m.el.querySelector('#cnote').value, s); m.close(closed); toast('تم إغلاق الوردية'); printShiftReport(closed); } catch (er) { e.textContent = er.message; e.hidden = false; }
  };
  return m.done;
}

// نافذة سريعة للوردية الحالية (من الشريط العلوي)
export function shiftMenu() {
  const sh = myShift();
  if (!sh) return openShiftDialog();
  const s = shiftSummary(sh);
  const m = modal({ title: 'الوردية الحالية', size: 'sm', body: html`<div class="card flat">${kv('الموظف', sh.userName)}${kv('بدأت', fmtDateTime(sh.openedAt))}${kv('الفواتير', s.salesCount)}${kv('المبيعات', money(s.salesTotal))}${kv('النقدية المتوقعة', money(s.expectedCash), 'big')}</div>`, footer: html`<button class="btn danger" data-cl>إغلاق الوردية</button><button class="btn" data-rp>${icon('print', 16)} تقرير</button>` });
  m.el.querySelector('[data-cl]').onclick = () => { m.close(); closeShiftDialog(sh); }; m.el.querySelector('[data-rp]').onclick = () => printShiftReport(sh);
}
