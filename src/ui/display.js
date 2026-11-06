// إعدادات العرض لكل جهاز (لا تُزامَن): حجم الخط، حجم الواجهة، كثافة العناصر. تُحفظ في localStorage وتُطبَّق قبل رسم الواجهة.
const KEY = 'kp_display';
export const DEFAULTS = { fs: 100, ui: 100, dens: 'auto' };       // نسب مئوية؛ الكثافة: auto (مضغوطة على الجوال) | compact | normal | roomy
export function getDisplay() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
const clamp = (v, a, b) => Math.min(b, Math.max(a, +v || 100));
export function applyDisplay(d = getDisplay()) {
  const r = document.documentElement;
  r.style.setProperty('--tf', String(clamp(d.fs, 80, 150) / 100));
  r.style.setProperty('--ui', String(clamp(d.ui, 75, 140) / 100));
  const dens = ['auto', 'compact', 'normal', 'roomy'].includes(d.dens) ? d.dens : 'auto';
  r.dataset.dens = dens === 'auto' ? (phone.matches ? 'compact' : 'normal') : dens;   // القيمة الفعلية التي تعتمد عليها الـ CSS
}
const phone = window.matchMedia('(max-width:700px)');
phone.addEventListener?.('change', () => applyDisplay());
export function setDisplay(patch) {
  const d = { ...getDisplay(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* التخزين محجوب: يبقى التطبيق للجلسة الحالية */ }
  applyDisplay(d); return d;
}
export const resetDisplay = () => { try { localStorage.removeItem(KEY); } catch { } applyDisplay({ ...DEFAULTS }); return { ...DEFAULTS }; };
applyDisplay();
