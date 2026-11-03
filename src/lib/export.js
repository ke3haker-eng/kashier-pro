// تصدير الجداول: CSV / Excel (xlsx) / PDF (عبر الطباعة). كل الصفحات تستخدم نفس الدالة.
// spec = { name:'sales-report', title:'تقرير المبيعات', subtitle?, cols:[{label, get(row), num?:true}], rows, summary?:[[label,value]] }
import { download, dayKey, now } from '../core/util.js';
import { toCSV } from './csv.js';
import { makeXLSX } from './xlsx.js';
import { tableDoc, previewDoc } from './print.js';
import { html, icon, toast } from '../ui/components.js';

export const matrix = spec => [spec.cols.map(c => c.label), ...spec.rows.map(r => spec.cols.map(c => { const v = c.get(r); return c.num ? (typeof v === 'number' ? v : (isFinite(parseFloat(String(v).replace(/,/g, ''))) ? parseFloat(String(v).replace(/,/g, '')) : v)) : (v ?? ''); }))];
export function exportTable(spec, kind) {
  const base = `${spec.name || 'export'}-${dayKey(now())}`, m = matrix(spec);
  if (kind === 'csv') { download(base + '.csv', toCSV(m), 'text/csv;charset=utf-8'); toast('تم تصدير ملف CSV'); }
  else if (kind === 'xlsx') {
    const sheets = [{ name: spec.title || 'تقرير', rows: m }];
    if (spec.summary?.length) sheets.unshift({ name: 'الملخص', rows: [['البند', 'القيمة'], ...spec.summary.map(([k, v]) => [k, typeof v === 'number' ? v : String(v)])] });
    download(base + '.xlsx', makeXLSX(sheets)); toast('تم تصدير ملف Excel');
  } else if (kind === 'pdf') previewDoc(p => tableDoc({ ...spec, paper: p }), spec.title || 'تقرير');
}
// أزرار التصدير الثلاثة: اربط الحدث بـ data-exp
export const exportBar = () => html`<div class="row gap6"><button class="btn sm" data-exp="xlsx">${icon('sheet', 16)} Excel</button><button class="btn sm" data-exp="csv">${icon('download', 16)} CSV</button><button class="btn sm" data-exp="pdf">${icon('receipt', 16)} PDF</button></div>`;
export const bindExport = (root, getSpec) => root.addEventListener('click', e => { const b = e.target.closest('[data-exp]'); if (b) exportTable(getSpec(), b.dataset.exp); });
