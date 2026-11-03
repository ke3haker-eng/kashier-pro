// مكوّنات الواجهة المشتركة — كل الصفحات تبنى عليها. القيم داخل html`` تُهرَّب تلقائياً.
import { $, esc, html, raw, Raw, str, fmt, fmtQty, hue, initial, num, norm, latinDigits } from '../core/util.js';
import { icon } from './icons.js';
import { settings } from '../core/store.js';
import * as auth from '../core/auth.js';

export { html, raw, icon, esc, fmt, fmtQty };

// ---------- تنسيق ----------
export const money = n => fmt(n) + (settings().cur ? ' ' + settings().cur : '');
export const priceFmt = n => (Math.round(n * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
export const num_ = n => html`<span class="num">${n}</span>`;
export const mny = n => html`<span class="num">${money(n)}</span>`;

// ---------- عناصر جاهزة ----------
export const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;
export const emptyState = (ic, text, action = '') => html`<div class="empty">${icon(ic, 44)}<div>${text}</div>${action ? html`<div style="margin-top:8px">${action}</div>` : ''}</div>`;
export const pageHead = (title, actions = '', sub = '') => html`<div class="page-h"><div><h2>${title}</h2>${sub ? html`<div class="sub">${sub}</div>` : ''}</div><div class="row wrap">${actions}</div></div>`;
// tone: y (أصفر) b (أزرق) p (بنفسجي) o (برتقالي) g (أخضر) r (أحمر) plain
export const statCard = ({ label, value, icon: ic = 'dollar', tone = 'plain', sub = '', subKind = '' }) => html`<div class="stat ${tone}"><div class="ico">${icon(ic, 24)}</div><div class="grow"><div class="lb">${label}</div><div class="vl">${value}</div>${sub ? html`<div class="sb ${subKind}">${sub}</div>` : ''}</div></div>`;
export const seg = (items, value, attr = 'data-seg') => html`<div class="seg">${items.map(([v, l]) => html`<button type="button" ${raw(attr)}="${v}" class="${v === value ? 'on' : ''}">${l}</button>`)}</div>`;
export const tabs = (items, active, attr = 'data-tab') => html`<div class="tabs">${items.map(([id, label, count]) => html`<button type="button" ${raw(attr)}="${id}" class="${id === active ? 'on' : ''}">${label}${count != null ? html`<span class="tc">${count}</span>` : ''}</button>`)}</div>`;
export const chips = (items, value, attr = 'data-chip') => html`<div class="chips">${items.map(([v, l]) => html`<button type="button" ${raw(attr)}="${v}" class="chip ${v === value ? 'on' : ''}">${l}</button>`)}</div>`;
export const kv = (k, v, cls = '') => html`<div class="kv ${cls}"><span>${k}</span><b>${v}</b></div>`;
export const avatar = (name, size = 44) => html`<div class="av" style="width:${size}px;height:${size}px;background:hsl(${hue(name)} 45% 42%)">${initial(name)}</div>`;
export const thumb = (p, size = 44) => p?.img ? html`<img class="thumb" style="width:${size}px;height:${size}px" src="${p.img}" alt="">` : avatar(p?.name || '?', size);
export const PAY_ICON = { cash: 'cash', card: 'card', wallet: 'wallet', credit: 'users', mixed: 'layers', transfer: 'dollar' };

// حقل نموذج: f = {name,label,type,value,options,required,placeholder,hint,span,step,min,max,rows,suffix,attrs}
export function field(f) {
  const id = 'f_' + f.name, ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const req = f.required ? ' required' : '', at = f.attrs ? ' ' + f.attrs : '';
  let inner;
  if (f.type === 'select') inner = html`<select id="${id}" name="${f.name}"${raw(req + at)}>${(f.options || []).map(([v, l]) => html`<option value="${v}" ${String(v) === String(f.value ?? '') ? raw('selected') : ''}>${l}</option>`)}</select>`;
  else if (f.type === 'textarea') inner = html`<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}"${raw(ph + req + at)}>${f.value ?? ''}</textarea>`;
  else if (f.type === 'checkbox') return html`<div class="field chk ${f.span === 2 ? 'span2' : ''}"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? raw('checked') : ''}${raw(at)}><label for="${id}">${f.label}</label></div>`;
  else inner = html`<input id="${id}" name="${f.name}" type="${f.type === 'number' ? 'text' : (f.type || 'text')}" ${f.type === 'number' ? raw(`inputmode="decimal" data-num="1"`) : ''} value="${f.value ?? ''}"${raw(ph + req + at)}${f.step ? raw(` step="${esc(f.step)}"`) : ''}${f.min != null ? raw(` min="${esc(f.min)}"`) : ''}${f.max != null ? raw(` max="${esc(f.max)}"`) : ''} ${f.autofocus ? raw('autofocus') : ''} autocomplete="off">`;
  return html`<div class="field ${f.required ? 'req' : ''} ${f.span === 2 ? 'span2' : ''}"><label for="${id}">${f.label}</label>${f.extra ? html`<div class="row">${inner}${f.extra}</div>` : inner}${f.hint ? html`<div class="hint">${f.hint}</div>` : ''}</div>`;
}
// قراءة قيم نموذج: تعيد كائناً {name: value} (checkbox => boolean)
export function readForm(root) {
  const o = {};
  for (const el of root.querySelectorAll('[name]')) { if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value; }
  return o;
}
export const delegate = (root, evt, sel, fn) => root.addEventListener(evt, e => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });
export function bindActs(root, acts) { delegate(root, 'click', '[data-act]', (e, t) => { const f = acts[t.dataset.act]; if (f) { e.preventDefault(); Promise.resolve(f(t.dataset, t, e)).catch(err => { console.error(err); toast(err.message || 'حدث خطأ', 'err'); }); } }); }

// ---------- جداول ----------
// cols: [{key,label,render?(row,i)=>html,align:'end'|'center',cls,sort:true}]  — rows: مصفوفة كائنات. rowAttr(row) => نص سمات إضافية (مثل data-id)
export function table({ cols, rows, empty = 'لا توجد بيانات', stack = true, rowAttr, foot, sortKey, sortDir, attrSort = 'data-sort' }) {
  if (!rows.length) return emptyState('list', empty);
  return html`<div class="tbl-wrap"><table class="tbl ${stack ? 'stack' : ''}"><thead><tr>${cols.map(c => html`<th class="${c.align || ''} ${c.sort ? 'sortable' : ''}" ${c.sort ? raw(`${attrSort}="${esc(c.key)}"`) : ''}>${c.label}${c.sort && sortKey === c.key ? raw(sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`)}</tr></thead><tbody>${rows.map((r, i) => html`<tr ${rowAttr ? raw(rowAttr(r, i) || '') : ''}>${cols.map(c => html`<td class="${c.align || ''} ${c.cls || ''}" data-l="${c.label}">${c.render ? c.render(r, i) : (r[c.key] ?? '')}</td>`)}</tr>`)}</tbody>${foot ? html`<tfoot>${foot}</tfoot>` : ''}</table></div>`;
}
export const paginate = (arr, page = 1, size = 25) => ({ items: arr.slice((page - 1) * size, page * size), page, pages: Math.max(1, Math.ceil(arr.length / size)), total: arr.length });
export function pager({ page, pages }, attr = 'data-page') {
  if (pages <= 1) return '';
  const nums = []; for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return html`<div class="pager"><button ${raw(attr)}="${page - 1}" ${page <= 1 ? raw('disabled') : ''}>${icon('chevR', 16)}</button>${nums.map(n => n === '…' ? html`<span class="muted">…</span>` : html`<button ${raw(attr)}="${n}" class="${n === page ? 'on' : ''}">${n}</button>`)}<button ${raw(attr)}="${page + 1}" ${page >= pages ? raw('disabled') : ''}>${icon('chevL', 16)}</button></div>`;
}

// ---------- إشعارات ----------
let toastBox;
export function toast(msg, kind = 'ok', ms = 2600) {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); document.body.append(toastBox); }
  const t = document.createElement('div'); t.className = 'toast ' + (kind === 'ok' || kind === 'err' || kind === 'warn' ? kind : '');
  t.innerHTML = (kind === 'err' ? icon('alert', 18) : kind === 'ok' ? icon('check', 18) : kind === 'warn' ? icon('alert', 18) : '').toString() + '<span></span>'; t.querySelector('span').textContent = msg;
  toastBox.append(t); while (toastBox.children.length > 3) toastBox.firstChild.remove();
  setTimeout(() => t.remove(), ms + (kind === 'err' ? 1500 : 0));
}
toast.ok = m => toast(m, 'ok'); toast.err = m => toast(m, 'err'); toast.warn = m => toast(m, 'warn');
// يشغّل دالة غير متزامنة ويعرض الخطأ كإشعار بدل أن يضيع
export const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); toast(e.message || 'حدث خطأ', 'err'); } };

// ---------- النوافذ ----------
const stack = [];
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) { const m = stack[stack.length - 1]; if (!m.persistent) { e.preventDefault(); e.stopPropagation(); m.close(); } } }, true);
export const modalOpen = () => stack.length > 0;
// modal({title, body, footer, size:'sm'|'md'|'lg'|'xl', persistent}) => {el, body, foot, close(v), done:Promise, setBody(html)}
export function modal({ title = '', body = '', footer = '', size = '', persistent = false, onClose } = {}) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="md ${size}" role="dialog" aria-modal="true"><div class="md-h"><h3></h3><button type="button" class="btn icon sm ghost" data-close aria-label="إغلاق">${icon('x', 18)}</button></div><div class="md-b"></div><div class="md-f" hidden></div></div>`;
  ov.querySelector('h3').textContent = title instanceof Raw ? '' : title; if (title instanceof Raw) ov.querySelector('h3').innerHTML = title.s;
  const b = ov.querySelector('.md-b'), f = ov.querySelector('.md-f');
  const set = (el, c) => { if (c instanceof Node) { el.replaceChildren(c); } else el.innerHTML = str(c); };
  set(b, body); if (footer) { set(f, footer); f.hidden = false; }
  let resolve; const done = new Promise(r => resolve = r); let closed = false;
  const m = { el: ov, body: b, foot: f, done, persistent, close(v) { if (closed) return; closed = true; const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1); ov.remove(); onClose?.(v); resolve(v); }, setBody(c) { set(b, c); }, setFoot(c) { set(f, c); f.hidden = !c; } };
  ov.addEventListener('mousedown', e => { if (e.target === ov && !persistent) m.close(); });
  ov.addEventListener('click', e => { if (e.target.closest('[data-close]')) m.close(); });
  stack.push(m); document.body.append(ov);
  setTimeout(() => { if (ov.contains(document.activeElement)) return; /* المستخدم (أو الماسح) بدأ الكتابة بالفعل: لا نسرق التركيز ولا نحدد النص */ const a = ov.querySelector('[autofocus]') || ov.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea'); a?.focus(); a?.select?.(); }, 30);
  return m;
}
export const closeAllModals = () => [...stack].forEach(m => m.close());

export function confirmBox({ title = 'تأكيد', message = '', ok = 'تأكيد', cancel = 'إلغاء', danger = false } = {}) {
  return new Promise(res => {
    const m = modal({ title, size: 'sm', body: html`<div>${message}</div>`, footer: html`<button class="btn ${danger ? 'danger' : 'primary'}" data-ok autofocus>${ok}</button><button class="btn ghost" data-close>${cancel}</button>` });
    m.el.querySelector('[data-ok]').onclick = () => { m.close(true); res(true); }; m.done.then(v => res(!!v));
  });
}
export function promptBox({ title = '', label = '', value = '', type = 'text', placeholder = '', ok = 'موافق', hint = '', required = true } = {}) {
  return new Promise(res => {
    const m = modal({ title, size: 'sm', body: html`<form class="col" data-f>${field({ name: 'v', label, value, type, placeholder, hint, autofocus: true })}<div class="form-err" hidden></div></form>`, footer: html`<button class="btn primary" data-ok>${ok}</button><button class="btn ghost" data-close>إلغاء</button>` });
    const go = () => { const v = m.el.querySelector('[name=v]').value.trim(); if (required && !v) return; m.close(v); }; m.el.querySelector('[data-ok]').onclick = go; m.el.querySelector('[data-f]').onsubmit = e => { e.preventDefault(); go(); }; m.done.then(v => res(v ?? null));
  });
}
// نافذة نموذج عامة: formModal({title, fields, submit, extra, onSubmit(values, api)}) — onSubmit قد يرمي Error فيظهر داخل النافذة
export function formModal({ title, fields, values = {}, submit = 'حفظ', size = '', extraFooter = '', onSubmit, onReady, intro = '' }) {
  const fs = fields.map(f => ({ ...f, value: f.name in values ? values[f.name] : f.value }));
  const m = modal({ title, size, body: html`<form data-f novalidate>${intro}<div class="form-grid">${fs.map(field)}</div><div class="form-err" hidden style="margin-top:10px"></div></form>`, footer: html`<button class="btn primary" data-ok>${submit}</button>${extraFooter}<button class="btn ghost" data-close>إلغاء</button>` });
  const form = m.el.querySelector('[data-f]'), err = m.el.querySelector('.form-err'), okb = m.el.querySelector('[data-ok]');
  const showErr = t => { err.textContent = t; err.hidden = !t; };
  const go = async () => {
    showErr(''); const v = readForm(form);
    for (const f of fs) { if (f.type === 'number' && v[f.name] !== '' && v[f.name] != null) { const n = num(v[f.name]); v[f.name] = isFinite(n) ? n : v[f.name]; } if (f.required && f.type !== 'checkbox' && String(v[f.name] ?? '').trim() === '') { showErr(`الحقل "${f.label}" مطلوب`); form.querySelector(`[name=${f.name}]`)?.focus(); return; } }
    okb.classList.add('spin'); okb.disabled = true;
    try { const r = await onSubmit(v, { close: m.close, setError: showErr, form }); m.close(r ?? true); }
    catch (e) { if (e && e.message) showErr(e.message); console.warn(e); } finally { okb.classList.remove('spin'); okb.disabled = false; }
  };
  okb.onclick = go; form.onsubmit = e => { e.preventDefault(); go(); };
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); go(); } });
  form.addEventListener('input', e => { if (e.target.dataset.num) { const p = e.target.selectionStart; e.target.value = latinDigits(e.target.value).replace(/[^\d.\-]/g, ''); } });
  onReady?.(m, form);
  return m;
}

// موافقة مشرف: إن كان المستخدم يملك الصلاحية يعيده، وإلا يطلب PIN مدير. يعيد المستخدم الموافِق أو null
export async function requireApproval(perm, reason = '') {
  const cu = auth.current(); if (auth.can(perm, cu)) return cu;
  return new Promise(res => {
    const m = modal({ title: 'موافقة المدير مطلوبة', size: 'sm', body: html`<div class="muted">${reason || 'هذه العملية تحتاج موافقة مشرف.'}</div><form data-f class="col">${field({ name: 'pin', label: 'الرقم السري للمدير', type: 'password', attrs: 'inputmode="numeric" maxlength="8"', autofocus: true })}<div class="form-err" hidden></div></form>`, footer: html`<button class="btn primary" data-ok>موافقة</button><button class="btn ghost" data-close>إلغاء</button>` });
    const go = async () => { const pin = latinDigits(m.el.querySelector('[name=pin]').value); const u = await auth.findApprover(perm, pin); if (u) m.close(u); else { const e = m.el.querySelector('.form-err'); e.textContent = 'رقم سري غير صحيح أو لا يملك صلاحية'; e.hidden = false; } };
    m.el.querySelector('[data-ok]').onclick = go; m.el.querySelector('[data-f]').onsubmit = e => { e.preventDefault(); go(); }; m.done.then(v => res(v || null));
  });
}

// ---------- اختيار عنصر من قائمة (منتج/زبون/مورد) مع بحث ----------
// pickFrom({title, items:[{id,label,sub,right}], placeholder}) => id|null
export function pickFrom({ title, items, placeholder = 'بحث...', allowNone = '', create = null }) {
  return new Promise(res => {
    const m = modal({ title, body: html`<div class="input-ic">${icon('search', 18)}<input class="inp" data-q placeholder="${placeholder}" autofocus autocomplete="off"></div><div data-list class="col" style="gap:0;max-height:50dvh;overflow:auto"></div>`, footer: create ? html`<button class="btn soft" data-create>${icon('plus', 16)} ${create.label}</button>` : '' });
    const list = m.el.querySelector('[data-list]'), q = m.el.querySelector('[data-q]');
    const draw = () => { const t = norm(q.value); const r = items.filter(i => !t || norm(i.label + ' ' + (i.sub || '')).includes(t)).slice(0, 80); list.innerHTML = (allowNone ? `<button class="list-item" style="background:none;border:0;cursor:pointer;text-align:start" data-id="">${esc(allowNone)}</button>` : '') + (r.map(i => `<button class="list-item" style="background:none;border:0;cursor:pointer;text-align:start;width:100%" data-id="${esc(i.id)}"><div class="grow"><b>${esc(i.label)}</b>${i.sub ? `<div class="small muted">${esc(i.sub)}</div>` : ''}</div>${i.right ? `<span class="muted small">${esc(i.right)}</span>` : ''}</button>`).join('') || '<div class="empty">لا توجد نتائج</div>'); };
    q.oninput = draw; draw();
    list.onclick = e => { const b = e.target.closest('[data-id]'); if (b) m.close(b.dataset.id); };
    q.onkeydown = e => { if (e.key === 'Enter') { const b = list.querySelector('[data-id]:not([data-id=""])'); if (b) m.close(b.dataset.id); } };
    m.el.querySelector('[data-create]')?.addEventListener('click', async () => { const id = await create.run(); if (id) m.close(id); });
    m.done.then(v => res(v === undefined ? null : v));
  });
}

// تحميل صفحة جزئية بشكل خامل (Skeleton)
export const skeleton = (n = 3) => html`<div class="col">${Array.from({ length: n }, () => html`<div class="skel" style="height:72px"></div>`)}</div>`;

// يمنع الضغط المزدوج: btnBusy(btn, async()=>{...})
export async function btnBusy(btn, fn) { if (btn.disabled) return; btn.disabled = true; btn.classList.add('spin'); try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('spin'); } }
