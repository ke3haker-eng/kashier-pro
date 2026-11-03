// CSV: تصدير (UTF-8 مع BOM ليفتح Excel العربية صحيحة) واستيراد (اكتشاف الفاصل تلقائياً)
export function toCSV(rows) {
  const q = v => { if (v == null) return ''; const s = String(v); return /[",\n\r;\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const cnt = c => (first.match(new RegExp(c === '\t' ? '\t' : '\\' + c, 'g')) || []).length;
  const d = [',', ';', '\t'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
