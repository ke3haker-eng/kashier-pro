// أدوات مساعدة عامة — لا تعتمد على أي وحدة أخرى
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- أمان HTML ----------
// html`...` يهرّب كل القيم تلقائياً؛ استخدم raw() فقط لنص HTML موثوق (مثل نتيجة html``)
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : (v == null || v === false) ? '' : esc(v);
export const html = (strs, ...vals) => new Raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));
export const str = v => v instanceof Raw ? v.s : String(v ?? '');

// ---------- أرقام ومال ----------
export const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
export const r3 = n => Math.round((+n + Number.EPSILON) * 1000) / 1000;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const latinDigits = s => String(s ?? '').replace(/[٠-٩۰-۹]/g, d => { const i = AR_DIGITS.indexOf(d); return i >= 0 ? i : FA_DIGITS.indexOf(d); }).replace(/[٫]/g, '.').replace(/[٬،]/g, ',');
// تحويل مدخل المستخدم إلى رقم (يقبل الأرقام العربية). يرجع NaN إن لم يكن رقماً
export const num = v => { if (typeof v === 'number') return v; const s = latinDigits(v).trim().replace(/,/g, ''); return s === '' ? NaN : Number(s); };
export const fmt = n => { n = r2(n); return (Object.is(n, -0) ? 0 : n).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
export const fmtQty = n => (Math.round(n * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
export const pct = n => fmt(n) + '%';
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// ---------- معرّفات ----------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- الوقت (قابل للتحكم في الاختبارات ووضع التجربة) ----------
let clockOffset = null;
export const setClock = ms => { clockOffset = ms == null ? null : ms - Date.now(); };
export const now = () => Date.now() + (clockOffset || 0);
export const nowISO = () => new Date(now()).toISOString();

// ---------- التواريخ ----------
const pad2 = n => String(n).padStart(2, '0');
export const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }; // توقيت الجهاز
export const todayKey = () => dayKey(now());
export const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n)); };
export const dayStart = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export const monthKey = t => dayKey(t).slice(0, 7);
export const weekStartKey = key => { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); const off = (dt.getDay() + 1) % 7; return addDays(key, -off); }; // الأسبوع يبدأ السبت
export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 864e5);
const LOC = 'ar-EG-u-nu-latn';
// تنسيق يدوي (بدون علامات اتجاه خفية يضيفها toLocale*) كي لا تنعكس التواريخ داخل النصوص العربية
export const fmtTime = t => { const d = new Date(t); let h = d.getHours(); const s = h >= 12 ? 'م' : 'ص'; h = h % 12 || 12; return pad2(h) + ':' + pad2(d.getMinutes()) + ' ' + s; };
export const fmtDate = t => { const d = new Date(t); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); };
export const fmtDateLong = t => new Date(t).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtDateTime = t => fmtDate(t) + ' ' + fmtTime(t);
export const dowName = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(LOC, { weekday: 'short' }); };
export const monthName = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(LOC, { month: 'long' }); };
export const shortDay = key => { const [, m, d] = key.split('-'); return d + '/' + m; };

// ---------- نصوص ----------
// تطبيع عربي للبحث: إزالة التشكيل وتوحيد الهمزات والياء والتاء المربوطة
export const norm = s => latinDigits(s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
export const debounce = (fn, ms = 120) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.cancel = () => clearTimeout(t); return f; };
export const pad = (n, w) => String(n).padStart(w, '0');
export const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
export const initial = s => (String(s || '').trim().charAt(0) || '?');
export const sum = (a, f = x => x) => a.reduce((s, x) => s + (+f(x) || 0), 0);
export const groupBy = (a, f) => { const m = new Map(); for (const x of a) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export const sortBy = (a, f, dir = 1) => a.slice().sort((x, y) => { const p = f(x), q = f(y); return (typeof p === 'string' ? p.localeCompare(q, 'ar') : (p > q) - (p < q)) * dir; });
export const clone = o => structuredClone(o);
export function deepMerge(base, patch) {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const k of Object.keys(patch)) out[k] = (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) ? deepMerge(out[k], patch[k]) : patch[k];
  return out;
}

// ---------- ملفات ----------
export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
export function pickFile(accept) {
  return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept || ''; i.onchange = () => res(i.files[0] || null); i.oncancel = () => res(null); i.click(); });
}
export const readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); });
export const readBuf = f => f.arrayBuffer();

export const UNITS = { pc: 'قطعة', kg: 'كجم', g: 'جرام' };
export const unitLabel = u => UNITS[u] || u;
export const isWeighed = u => u === 'kg' || u === 'g';
