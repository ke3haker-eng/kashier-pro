// الهيكل العام: الشريط الجانبي/السفلي، الشريط العلوي، التوجيه (hash)، تسجيل الدخول، التنبيهات والثيم.
import * as db from '../core/db.js';
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import * as ops from '../core/ops.js';
import { alerts } from '../core/analytics.js';
import { ROUTES, byId } from './routes.js';
import { html, raw, icon, modal, toast, confirmBox, delegate, closeAllModals, skeleton, field, emptyState } from './components.js';
import { latinDigits, $, esc } from '../core/util.js';
import { myShift, shiftMenu } from './shift.js';
import { closeScanner } from '../lib/scanner.js';

let cur = null, view, rerenderTimer, lockTimer;
const loaded = new Map(), styled = new Set();
const mq = matchMedia('(prefers-color-scheme:dark)');

export function applyTheme() {
  const t = store.settings().theme, d = t === 'auto' ? mq.matches : t === 'dark';
  document.documentElement.dataset.theme = d ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', d ? '#06222d' : '#083746');
}
mq.onchange = applyTheme;

const canSee = r => [r.perm, ...[].concat(r.altPerm || [])].some(p => auth.can(p));
export const visibleRoutes = () => ROUTES.filter(canSee);
const parseHash = () => { const h = location.hash.replace(/^#\/?/, ''); const [p, q] = h.split('?'); return { id: p || '', params: new URLSearchParams(q || '') }; };
export const navigate = (id, params) => { location.hash = '#/' + id + (params ? '?' + new URLSearchParams(params) : ''); };

// ---------- الإطار ----------
function frame() {
  const S = store.settings(), rs = visibleRoutes();
  const first = rs.find(r => r.mobile) ? rs.filter(r => r.mobile).slice(0, 4) : [];
  document.getElementById('root').innerHTML = `
  ${S.demo ? `<div class="demo-bar" id="demobar"><span>وضع التجربة — بيانات وهمية منفصلة عن بياناتك</span> <button data-exit-demo>خروج</button></div>` : ''}
  <div class="app"><aside class="side" id="side">
    <div class="brand"><div class="logo">${S.logo ? `<img src="${esc(S.logo)}" alt="">` : icon('cart', 20).toString()}</div><div class="bt">${esc(S.name || 'كاشير الدكان')}<small>نظام إدارة السوبر ماركت</small></div></div>
    <nav class="nav" id="nav">${rs.map(r => `<a href="#/${r.id}" data-r="${r.id}">${icon(r.icon, 20)}<span>${r.label}</span><i class="cnt" data-cnt="${r.id}" hidden></i></a>`).join('')}</nav>
    <div class="side-foot"><i class="dot" id="netdot"></i><span id="netlbl">يعمل محلياً على هذا الجهاز</span></div>
  </aside>
  <div class="main"><header class="top"><button class="btn icon ghost menu" data-more aria-label="القائمة">${icon('menu', 20)}</button><h1 id="h1"></h1><div class="sp"></div>
    <span class="pill hide-s" id="shiftpill" data-shift hidden></span><span class="pill" id="offpill" hidden>${icon('wifiOff', 14)} دون اتصال</span>
    <button class="btn icon ghost hide-s" data-fs title="ملء الشاشة" aria-label="ملء الشاشة">${icon('maximize', 18)}</button>
    <button class="btn icon ghost hide-s" data-display title="حجم الخط والواجهة" aria-label="حجم الخط والواجهة"><b style="font-size:.95rem">Aa</b></button>
    <button class="btn icon ghost hide-s" data-theme-cycle title="المظهر" aria-label="المظهر" id="themebtn"></button>
    <button class="btn icon ghost" data-bell aria-label="التنبيهات" style="position:relative">${icon('bell', 20)}<i class="cnt" id="bellcnt" hidden style="position:absolute;top:2px;inset-inline-end:2px;background:var(--bad);color:#fff;border-radius:99px;font-size:.62rem;padding:0 5px;font-style:normal"></i></button>
    <button class="pill" data-user id="userbtn"></button></header>
    <main id="view"></main></div></div>
  <nav class="bnav" id="bnav">${first.map(r => `<a href="#/${r.id}" data-r="${r.id}">${icon(r.icon, 22)}<span>${r.label}</span><i class="cnt" data-cnt="${r.id}" hidden></i></a>`).join('')}<button data-more>${icon('menu', 22)}<span>المزيد</span><i class="cnt" data-cnt="orders-more" hidden></i></button></nav>`;
  view = document.getElementById('view'); refreshChrome();
}

function refreshChrome() {
  const S = store.settings(), cu = auth.current();
  { const bt = document.querySelector('.brand .bt'); if (bt && bt.firstChild) bt.firstChild.textContent = S.name || 'كاشير الدكان'; const lg = document.querySelector('.brand .logo'); if (lg) lg.innerHTML = S.logo ? `<img src="${esc(S.logo)}" alt="">` : icon('cart', 20).toString(); document.title = S.name || 'كاشير الدكان'; }
  const tb = document.getElementById('themebtn'); if (tb) tb.innerHTML = (S.theme === 'dark' ? icon('moon', 20) : S.theme === 'light' ? icon('sun', 20) : icon('sun', 20)).toString() + (S.theme === 'auto' ? '<small style="position:absolute;bottom:1px;font-size:.5rem;font-weight:800">A</small>' : ''); if (tb) tb.style.position = 'relative';
  const ub = document.getElementById('userbtn'); if (ub) ub.innerHTML = `${icon('user', 16)}<span class="hide-s">${esc(cu?.name || '')}</span>${auth.enabled() ? icon('logout', 14).toString() : ''}`; if (ub) ub.title = auth.enabled() ? 'تسجيل الخروج' : cu?.name || '';
  const sp = document.getElementById('shiftpill'); if (sp) { const sh = myShift(); sp.hidden = !(S.pos.requireShift || sh); sp.innerHTML = sh ? `<i class="dot"></i> وردية مفتوحة` : `<i class="dot off"></i> لا توجد وردية`; }
  const al = alerts(); const total = al.length ? al.reduce((s, a) => s + (parseInt(a.text) || 1), 0) : 0;
  const bc = document.getElementById('bellcnt'); if (bc) { bc.hidden = !total; bc.textContent = total > 99 ? '99+' : total; }
  const inv = al.filter(a => a.route.includes('inventory')).reduce((s, a) => s + (parseInt(a.text) || 0), 0);
  document.querySelectorAll('[data-cnt=inventory]').forEach(e => { e.hidden = !inv; e.textContent = inv; });
  document.querySelectorAll('[data-r]').forEach(a => a.classList.toggle('on', cur && a.dataset.r === cur.id));
  const nl = document.getElementById('netlbl'), nd = document.getElementById('netdot'), op = document.getElementById('offpill');
  if (db.isRemote()) {   // الوضع السحابي: الحالة من آخر اتصال ناجح بالخادم وليس من navigator.onLine وحده
    const st = db.remote().status, ok = navigator.onLine && st.state === 'ok';
    if (nl) nl.textContent = ok ? 'متصل بالسحابة' + (S.name ? ' — ' + S.name : '') : 'غير متصل بالسحابة — الحفظ متوقف';
    nd?.classList.toggle('off', !ok); if (op) { op.hidden = ok; op.lastChild.textContent = ' غير متصل بالسحابة'; }
  } else { if (nl) { const on = navigator.onLine; nl.textContent = 'يعمل محلياً على هذا الجهاز' + (on ? '' : ' — دون اتصال'); nd?.classList.toggle('off', !on); } if (op) op.hidden = navigator.onLine; }
}

// ---------- التوجيه ----------
async function route() {
  if (!auth.isLoggedIn()) return showLogin();
  if (!document.getElementById('view')) frame();
  let { id, params } = parseHash(); const rs = visibleRoutes();
  if (!id || !byId(id)) { id = (rs.find(r => r.id === 'home') || rs[0])?.id; if (!id) return noAccess(); history.replaceState(null, '', '#/' + id); }
  const r = byId(id); if (!canSee(r)) { cur = { id }; refreshChrome(); view.className = ''; view.innerHTML = emptyState('lock', 'ليست لديك صلاحية الدخول إلى هذا القسم').toString(); document.getElementById('h1').textContent = r.label; return; }
  try { cur?.page?.destroy?.(); } catch (e) { console.error(e); }
  closeAllModals(); closeScanner(); window.scrollTo(0, 0);
  cur = { id, params, route: r, page: null }; document.getElementById('h1').textContent = r.label;
  { const old = document.getElementById('view'), nv = old.cloneNode(false); old.replaceWith(nv); view = nv; } // عنصر جديد لكل صفحة => لا تتراكم مستمعات الأحداث بين الصفحات
  view.className = ''; view.innerHTML = skeleton(4).toString(); refreshChrome();
  try {
    let mod = loaded.get(id); if (!mod) { mod = await r.load(); loaded.set(id, mod); }
    if (cur.id !== id) return; const page = mod.default || mod; cur.page = page;
    if (page.css && !styled.has(id)) { const s = document.createElement('style'); s.dataset.page = id; s.textContent = page.css; document.head.append(s); styled.add(id); }
    view.className = page.viewClass || ''; view.innerHTML = '';
    await page.render(view, ctx());
  } catch (e) { console.error(e); view.className = ''; view.innerHTML = `<div class="card"><div class="empty">${icon('alert', 44)}<div>تعذّر تحميل هذه الصفحة</div><div class="small">${esc(e.message)}</div><button class="btn primary" style="margin-top:10px" onclick="location.reload()">إعادة المحاولة</button></div></div>`; }
}
const ctx = () => ({ params: cur.params, navigate, refresh: () => cur.page?.render?.(view, ctx()), setTitle: t => { document.getElementById('h1').textContent = t; }, route: cur.route });

function onData(names) {
  refreshChrome(); if (!cur?.page) return;
  if (cur.page.onChange) { try { cur.page.onChange(names, view, ctx()); } catch (e) { console.error(e); } return; }
  clearTimeout(rerenderTimer); rerenderTimer = setTimeout(async () => { if (!cur?.page) return; const y = window.scrollY; try { await cur.page.render(view, ctx()); window.scrollTo(0, y); } catch (e) { console.error(e); } }, 60);
}

function noAccess() { document.getElementById('root').innerHTML = `<div class="login"><div class="box center">${icon('lock', 44)}<h3>لا توجد صلاحيات</h3><p class="muted">لا يملك حسابك صلاحية دخول أي قسم. راجع المدير.</p><button class="btn" id="lo">تسجيل الخروج</button></div></div>`; document.getElementById('lo').onclick = () => { auth.logout(); location.reload(); }; }

// ---------- تسجيل الدخول ----------
function showLogin() {
  const users = store.list('users').filter(u => u.active !== false); let sel = users[0]?.id || '', pin = '';
  const root = document.getElementById('root'); view = null;
  const draw = (err = '') => {
    root.innerHTML = `<div class="login"><div class="box"><div class="center"><div class="logo" style="margin:0 auto 6px;width:54px;height:54px;border-radius:16px;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff">${icon('cart', 28)}</div><h2>${esc(store.settings().name || 'كاشير الدكان')}</h2><div class="muted small">سجّل الدخول للمتابعة</div></div>
    <div class="users-pick">${users.map(u => `<button data-u="${u.id}" class="${u.id === sel ? 'on' : ''}">${icon('user', 22)}<span>${esc(u.name)}</span><small class="muted">${({ manager: 'المدير', cashier: 'الكاشير', stock: 'مسؤول المخزون', accountant: 'المحاسب' })[u.role]}</small></button>`).join('')}</div>
    <div class="pin-dots">${[0, 1, 2, 3, 4, 5].map(i => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('')}</div>${err ? `<div class="form-err center">${esc(err)}</div>` : ''}
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="x">${icon('x', 22)}</button><button data-k="0">0</button><button data-k="ok" style="background:var(--p);color:#fff">${icon('check', 24)}</button></div>
    <button class="btn ghost sm" data-forgot>نسيت الرقم السري؟</button></div></div>`;
  };
  const submit = async () => { if (!sel || pin.length < 4) return; try { await auth.login(sel, pin); await bootRoute(); } catch (e) { pin = ''; draw(e.message); } };
  draw();
  root.onclick = async e => {
    const u = e.target.closest('[data-u]'); if (u) { sel = u.dataset.u; pin = ''; return draw(); }
    const k = e.target.closest('[data-k]'); if (k) { const v = k.dataset.k; if (v === 'x') pin = pin.slice(0, -1); else if (v === 'ok') return submit(); else if (pin.length < 8) pin += v; draw(); if (pin.length >= 4 && v !== 'x' && pin.length === 6) submit(); return; }
    if (e.target.closest('[data-forgot]')) forgotPin();
  };
  document.onkeydown = e => { if (view || !document.querySelector('.login')) return; if (/^\d$/.test(e.key) && pin.length < 8) { pin += e.key; draw(); } else if (e.key === 'Backspace') { pin = pin.slice(0, -1); draw(); } else if (e.key === 'Enter') submit(); };
}
async function forgotPin() {
  const m = modal({ title: 'استعادة الدخول', size: 'sm', body: html`<div class="muted" style="line-height:1.8">لا يمكن استرجاع الرقم السري لأنه مخزَّن مشفّراً. يمكنك <b>إيقاف تسجيل الدخول</b> مع الاحتفاظ بكل بياناتك، ثم إعادة تفعيله وتعيين أرقام جديدة من الإعدادات.<br><br>اكتب كلمة <b>إيقاف</b> للتأكيد. (هذا قفل تشغيلي على جهازك وليس حماية من الغير — راجع README)</div>${field({ name: 'c', label: 'التأكيد', autofocus: true })}`, footer: html`<button class="btn danger" data-ok>إيقاف تسجيل الدخول</button><button class="btn ghost" data-close>إلغاء</button>` });
  m.el.querySelector('[data-ok]').onclick = async () => { if (m.el.querySelector('[name=c]').value.trim() !== 'إيقاف') return; await ops.saveSettings({ auth: { enabled: false } }); auth.logout(); m.close(); location.reload(); };
}

// ---------- تنبيهات ----------
function showAlerts(btn) {
  document.querySelector('.popover')?.remove(); const al = alerts();
  const p = document.createElement('div'); p.className = 'popover'; const r = btn.getBoundingClientRect(); p.style.top = r.bottom + 8 + window.scrollY + 'px'; p.style.insetInlineStart = Math.max(8, Math.min(r.left, innerWidth - 290)) + 'px'; p.style.position = 'absolute';
  p.innerHTML = `<b style="padding:6px 8px;display:block">التنبيهات</b>` + (al.length ? al.map(a => `<a class="list-item" style="text-decoration:none;color:inherit;padding:8px" href="${a.route}"><span class="${a.kind}">${icon(a.icon, 20)}</span><span>${esc(a.text)}</span></a>`).join('') : `<div class="empty" style="padding:20px">لا توجد تنبيهات 🎉</div>`);
  document.body.append(p); const off = e => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('mousedown', off, true); } }; setTimeout(() => document.addEventListener('mousedown', off, true), 0); p.addEventListener('click', () => p.remove());
}

function moreSheet() {
  const rs = visibleRoutes();
  const m = modal({ title: store.settings().name || 'القائمة', body: html`<div class="grid g3 keep" style="grid-template-columns:repeat(3,minmax(0,1fr))">${rs.map(r => html`<a href="#/${r.id}" data-nav class="card flat center" style="text-decoration:none;color:var(--t);padding:14px 4px;display:flex;flex-direction:column;align-items:center;gap:6px;${raw(cur?.id === r.id ? 'border-color:var(--p);background:var(--pb)' : '')}">${icon(r.icon, 26)}<span class="small bold">${r.label}</span></a>`)}</div>${auth.enabled() ? html`<button class="btn block" data-lo>${icon('logout', 18)} تسجيل الخروج (${auth.current()?.name})</button>` : ''}` });
  m.body.insertAdjacentHTML('beforeend', `<div class="row wrap" style="margin-top:12px"><button class="btn sm" data-display-open>${icon('maximize', 16)} حجم الخط والواجهة</button><button class="btn sm" data-theme-cycle>${icon('sun', 16)} المظهر</button></div>`);
  m.el.addEventListener('click', e => { if (e.target.closest('[data-display-open]')) { m.close(); import('./display-ui.js').then(x => x.openDisplayPrefs()); } if (e.target.closest('[data-nav]')) m.close(); if (e.target.closest('[data-lo]')) { m.close(); auth.logout(); route(); } });
}

async function cycleTheme() { const order = ['auto', 'light', 'dark'], t = store.settings().theme; await ops.saveSettings({ theme: order[(order.indexOf(t) + 1) % 3] }); applyTheme(); refreshChrome(); toast('المظهر: ' + ({ auto: 'تلقائي', light: 'نهاري', dark: 'ليلي' })[store.settings().theme], 'info', 1400); }

function resetLock() { clearTimeout(lockTimer); const mins = store.settings().auth.lockMin; if (auth.enabled() && mins > 0 && auth.isLoggedIn()) lockTimer = setTimeout(() => { auth.logout(); closeAllModals(); route(); }, mins * 60e3); }

let bound = false;
export async function bootRoute() { document.onkeydown = null; document.getElementById('root').onclick = null; frame(); bindGlobal(); await route(); resetLock(); }
function bindGlobal() {
  if (bound) return; bound = true;
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-more]')) return moreSheet();
    if (t.closest('[data-display]')) return import('./display-ui.js').then(x => x.openDisplayPrefs());
    if (t.closest("[data-theme-cycle]")) return cycleTheme();
    if (t.closest('[data-fs]')) return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    if (t.closest('[data-bell]')) return showAlerts(t.closest('[data-bell]'));
    if (t.closest('[data-shift]')) return shiftMenu();
    if (t.closest('[data-user]')) { if (auth.enabled()) { auth.logout(); route(); } return; }
    if (t.closest('[data-exit-demo]')) return import('../core/demo.js').then(m => m.exitDemo());
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', refreshChrome); window.addEventListener('offline', refreshChrome); window.addEventListener('kp-cloud', refreshChrome); window.addEventListener('kp-store', e => {
    const d = e.detail, n = d.orders + d.unread;
    document.querySelectorAll('[data-cnt=orders],[data-cnt=orders-more]').forEach(x => { x.hidden = !n; x.textContent = n > 99 ? '99+' : n; });
    if (d.newOrders) toast('وصل طلب جديد من المتجر الإلكتروني', 'ok', 5000); else if (d.newMsgs) toast('رسالة جديدة من أحد المشترين', 'ok', 4000);
    if ((d.newOrders || d.newMsgs) && navigator.vibrate) try { navigator.vibrate(120); } catch { }
  }); window.addEventListener('kp-cloud-note', e => toast(e.detail.msg, 'warn', 6000));
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, resetLock, { passive: true }));
  store.on(names => { onData(names); if (names.has('meta')) { applyTheme(); } });
}
export const rerenderChrome = refreshChrome;

// جوال: الأزرار الثانوية في رأس الصفحة (استيراد/تصدير/تصنيفات...) تُجمع في زر «⋯» يفتح قائمة بدل صفوف أزرار متراكمة.
// الإخفاء/الإظهار بالـ CSS (≤700px) فلا حاجة لمتابعة تغيّر حجم الشاشة. المنطق الأصلي للأزرار لا يتغيّر: القائمة تضغط الزر الأصلي.
function compactActs() {
  document.querySelectorAll('.page-h .acts:not([data-c])').forEach(a => {
    a.dataset.c = '1';
    const sec = [...a.querySelectorAll('.btn:not(.primary)')].filter(b => !b.matches('[data-more-acts]'));
    if (sec.length < 2) return;
    sec.forEach(b => b.classList.add('m-sec'));
    const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'btn icon m-more'; mb.setAttribute('aria-label', 'المزيد'); mb.dataset.moreActs = '1'; mb.innerHTML = icon('more', 20).toString();
    mb.onclick = () => {
      const m = modal({ title: 'خيارات الصفحة', size: 'sm', body: html`<div class="col" style="gap:8px">${sec.map((b, i) => html`<button class="btn" style="justify-content:flex-start" data-i="${i}">${raw(b.innerHTML)}${b.title && !b.textContent.trim() ? b.title : ''}</button>`)}</div>` });
      m.el.addEventListener('click', e => { const t = e.target.closest('[data-i]'); if (!t) return; m.close(); sec[+t.dataset.i].click(); });
    };
    a.append(mb);
  });
}
let acting = 0;
new MutationObserver(() => { cancelAnimationFrame(acting); acting = requestAnimationFrame(compactActs); }).observe(document.documentElement, { childList: true, subtree: true });
