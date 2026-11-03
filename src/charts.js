// رسوم بيانية خفيفة بلا مكتبات: HTML/CSS للأعمدة (نصوص واضحة ومتجاوبة) وSVG للخطوط والدونات
import { html, raw, esc, fmt, r2 } from '../core/util.js';
import { settings } from '../core/store.js';

export const COLORS = ['var(--chart1)', 'var(--chart2)', 'var(--chart3)', 'var(--chart4)', 'var(--chart5)', 'var(--chart6)'];
const short = n => { const a = Math.abs(n); return a >= 1e6 ? fmt(n / 1e6) + 'M' : a >= 1e4 ? fmt(n / 1e3) + 'k' : a >= 1e3 ? fmt(n / 1e3) + 'k' : fmt(n); };
const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
const cur = () => settings().cur ? ' ' + settings().cur : '';

// points: [{label, value, value2?}] — أعمدة (يدعم سلسلتين)
export function barChart(points, { height = 190, two = false } = {}) {
  const max = niceMax(Math.max(...points.map(p => Math.max(p.value || 0, p.value2 || 0)), 0));
  return html`<div style="position:relative"><span class="muted small" style="position:absolute;top:0;inset-inline-end:0">${short(max)}</span>
  <div class="chart-bars" style="height:${height}px">${points.map(p => html`<div class="bar" title="${p.label}: ${fmt(p.value)}${cur()}${two ? ' / ' + fmt(p.value2 || 0) : ''}"><div style="display:flex;align-items:flex-end;gap:2px;width:100%;height:100%;justify-content:center">${[p.value, ...(two ? [p.value2 || 0] : [])].map((v, i) => html`<i class="${i ? 'b2' : ''}" style="height:${Math.max(0, (v || 0) / max * 100)}%"></i>`)}</div></div>`)}</div>
  <div class="chart-x">${points.map(p => html`<span>${p.label}</span>`)}</div></div>`;
}

// خط/مساحة: points: [{label,value}]
export function lineChart(points, { height = 200 } = {}) {
  const n = points.length; if (!n) return '';
  const max = niceMax(Math.max(...points.map(p => p.value), 0));
  const X = i => n === 1 ? 50 : 4 + i * (92 / (n - 1)), Y = v => 100 - (v / max) * 92 - 4;
  const pts = points.map((p, i) => [X(i), Y(p.value)]);
  const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2)).join(' ');
  const area = d + ` L${pts[n - 1][0].toFixed(2)} 100 L${pts[0][0].toFixed(2)} 100 Z`;
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  return html`<div style="padding-inline-end:4px"><div class="chart-line" style="height:${height}px">
    ${[0, 1, 2, 3].map(i => html`<div class="grid-l" style="top:${4 + i * 23}%"><span>${short(max * (1 - i / 4))}</span></div>`)}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart1)" stop-opacity=".28"/><stop offset="1" stop-color="var(--chart1)" stop-opacity="0"/></linearGradient></defs>
    <path d="${raw(area)}" fill="url(#${gid})"/><path d="${raw(d)}" fill="none" stroke="var(--chart1)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
    ${points.map((p, i) => n <= 31 ? html`<span class="dotp" title="${p.label}: ${fmt(p.value)}${cur()}" style="inset-inline-start:${X(i)}%;top:${Y(p.value)}%;${raw(n > 14 ? 'width:7px;height:7px;border-width:2px' : '')}"></span>` : '')}
  </div><div class="chart-x" style="margin-inline-end:0">${points.map((p, i) => html`<span style="${raw(n > 12 && i % Math.ceil(n / 8) ? 'visibility:hidden' : '')}">${p.label}</span>`)}</div></div>`;
}

// دونات: items: [{label,value,color?}]
export function donut(items, { center = '', sub = '' } = {}) {
  const tot = items.reduce((s, i) => s + i.value, 0);
  if (!(tot > 0)) return html`<div class="empty">لا توجد بيانات</div>`;
  let off = 0; const R = 15.915;
  const segs = items.map((it, i) => { const p = it.value / tot * 100; const s = html`<circle cx="21" cy="21" r="${R}" fill="none" stroke="${it.color || COLORS[i % COLORS.length]}" stroke-width="6" stroke-dasharray="${p.toFixed(3)} ${(100 - p).toFixed(3)}" stroke-dashoffset="${(-off).toFixed(3)}"><title>${it.label}: ${fmt(it.value)}</title></circle>`; off += p; return s; });
  return html`<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--in)" stroke-width="6"/>${segs}</svg><div class="mid"><div>${center}</div>${sub ? html`<small>${sub}</small>` : ''}</div></div>
  <div class="legend">${items.map((it, i) => html`<div><i style="background:${it.color || COLORS[i % COLORS.length]}"></i>${it.label} <b class="num">${fmt(it.value / tot * 100)}%</b></div>`)}</div></div>`;
}

// شريط تقدّم أفقي لقائمة: items [{label,value,sub?}]
export function hbars(items, { fmtv = v => fmt(v) } = {}) {
  const max = Math.max(...items.map(i => i.value), 0) || 1;
  return html`<div class="col" style="gap:12px">${items.map(i => html`<div><div class="row between small"><span class="ell">${i.label}</span><b class="num">${fmtv(i.value)}</b></div><div class="progress" style="margin-top:4px"><i style="width:${Math.max(2, i.value / max * 100)}%"></i></div>${i.sub ? html`<div class="muted small">${i.sub}</div>` : ''}</div>`)}</div>`;
}
