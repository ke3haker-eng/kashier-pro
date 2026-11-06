// نافذة "حجم الخط والواجهة" (تُفتح من الشريط العلوي/القائمة/الإعدادات). التغيير فوري ويُحفظ على هذا الجهاز فقط.
import { modal, html } from './components.js';
import { getDisplay, setDisplay, resetDisplay, DEFAULTS } from './display.js';

const DENS = [['auto', 'تلقائي'], ['compact', 'مضغوطة'], ['normal', 'عادية'], ['roomy', 'مريحة']];
export function displayControls() {
  const d = getDisplay();
  return html`<div class="col" style="gap:16px" data-disp>
    <div class="col" style="gap:6px"><div class="row between"><b>حجم الخط</b><span class="num muted" data-v="fs">${d.fs}%</span></div>
      <div class="row"><button type="button" class="btn icon sm" data-step="fs:-5" aria-label="تصغير الخط">−</button><input type="range" class="rng" min="80" max="150" step="5" value="${d.fs}" data-k="fs" aria-label="حجم الخط"><button type="button" class="btn icon sm" data-step="fs:5" aria-label="تكبير الخط">+</button></div></div>
    <div class="col" style="gap:6px"><div class="row between"><b>حجم الواجهة (الأزرار والمسافات والأيقونات)</b><span class="num muted" data-v="ui">${d.ui}%</span></div>
      <div class="row"><button type="button" class="btn icon sm" data-step="ui:-5" aria-label="تصغير الواجهة">−</button><input type="range" class="rng" min="75" max="140" step="5" value="${d.ui}" data-k="ui" aria-label="حجم الواجهة"><button type="button" class="btn icon sm" data-step="ui:5" aria-label="تكبير الواجهة">+</button></div></div>
    <div class="col" style="gap:6px"><b>كثافة العناصر</b><div class="seg" data-dens>${DENS.map(([v, l]) => html`<button type="button" data-d="${v}" class="${d.dens === v ? 'on' : ''}">${l}</button>`)}</div>
      <span class="muted small">«تلقائي» = مضغوطة على الجوال وعادية على الشاشات الكبيرة.</span></div>
    <div class="card flat" style="padding:12px"><div class="bold">معاينة</div><div class="muted small">هكذا يظهر النص بالحجم الحالي. سعر المنتج: <b class="num">12.50</b></div></div>
    <button type="button" class="btn ghost" data-reset>إعادة الضبط (${DEFAULTS.fs}%)</button>
  </div>`;
}
// يربط الأحداث داخل عنصر يحتوي displayControls()
export function bindDisplayControls(root) {
  const sync = d => { root.querySelectorAll('[data-v]').forEach(e => e.textContent = d[e.dataset.v] + '%'); root.querySelectorAll('input[data-k]').forEach(i => i.value = d[i.dataset.k]); root.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === d.dens)); };
  root.addEventListener('input', e => { const i = e.target.closest('input[data-k]'); if (i) sync(setDisplay({ [i.dataset.k]: +i.value })); });
  root.addEventListener('click', e => {
    const s = e.target.closest('[data-step]'); if (s) { const [k, n] = s.dataset.step.split(':'); const lim = k === 'fs' ? [80, 150] : [75, 140]; sync(setDisplay({ [k]: Math.min(lim[1], Math.max(lim[0], getDisplay()[k] + +n)) })); }
    const d = e.target.closest('[data-d]'); if (d) sync(setDisplay({ dens: d.dataset.d }));
    if (e.target.closest('[data-reset]')) sync(resetDisplay());
  });
}
export function openDisplayPrefs() {
  const m = modal({ title: 'حجم الخط والواجهة', size: 'sm', body: displayControls(), footer: html`<button class="btn primary" data-close>تم</button>` });
  bindDisplayControls(m.el); return m;
}
