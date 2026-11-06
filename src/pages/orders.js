// الطلبات والمحادثات القادمة من المتجر الإلكتروني (store.html). تعمل في الوضع السحابي فقط.
// الطلب لا يخصم من المخزون: «إرسال إلى نقطة البيع» يحوّله إلى فاتورة معلّقة يُتمّ بيعها بالطريقة المعتادة (فيُخصم المخزون هناك).
import * as db from '../core/db.js';
import * as sb from '../lib/supabase.js';
import * as ops from '../core/ops.js';
import { list, get, settings } from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, raw, esc, icon, toast, modal, confirmBox, pageHead, tabs, badge, money, emptyState } from '../ui/components.js';
import { fmtDateTime } from '../core/util.js';
import { shrink } from '../lib/image.js';

const STATUS = { new: ['جديد', 'info'], confirmed: ['تم التأكيد', 'warn'], preparing: ['قيد التجهيز', 'warn'], ready: ['جاهز', 'warn'], done: ['تم التسليم', 'ok'], rejected: ['مرفوض', 'bad'], cancelled: ['ملغي', 'bad'] };
const NEXT = { new: [['confirmed', 'تأكيد الطلب', 'primary'], ['rejected', 'رفض', 'danger']], confirmed: [['preparing', 'قيد التجهيز'], ['ready', 'جاهز'], ['done', 'تم التسليم', 'primary'], ['cancelled', 'إلغاء', 'danger']], preparing: [['ready', 'جاهز'], ['done', 'تم التسليم', 'primary'], ['cancelled', 'إلغاء', 'danger']], ready: [['done', 'تم التسليم', 'primary'], ['cancelled', 'إلغاء', 'danger']] };
const FILTERS = [['open', 'المفتوحة'], ['new', 'الجديدة'], ['done', 'المكتملة'], ['closed', 'المرفوضة/الملغاة'], ['all', 'الكل']];
const inF = (o, f) => f === 'all' || (f === 'open' && ['new', 'confirmed', 'preparing', 'ready'].includes(o.status)) || (f === 'new' && o.status === 'new') || (f === 'done' && o.status === 'done') || (f === 'closed' && ['rejected', 'cancelled'].includes(o.status));
const digits = s => String(s || '').replace(/\D/g, '');
const money_ = n => money(n);

let root = null, st, timer, token = 0, loading = false;
const fresh = () => ({ tab: 'orders', filter: 'open', orders: [], threads: [], buyer: null, msgs: [], last: 0, err: '', loaded: false });

export default {
  css: `.bub{max-width:82%;border-radius:1rem;padding:.4rem .7rem;white-space:pre-wrap;word-break:break-word}.bub.me{align-self:flex-start;background:var(--p);color:#fff}.bub.him{align-self:flex-end;background:var(--in)}.bub.sys{align-self:center;color:var(--t2);font-size:.78rem;border:1px dashed var(--b);text-align:center}.bub img{max-width:100%;border-radius:.6rem;display:block;margin:.2rem 0}.bub time{display:block;font-size:.66rem;opacity:.7}.chatbox{display:flex;flex-direction:column;gap:.4rem;height:min(60dvh,34rem);overflow:auto;padding:.3rem}.thr{display:flex;gap:.6rem;align-items:center;padding:.65rem .2rem;border-bottom:1px solid var(--b);cursor:pointer}.thr:last-child{border:0}.thr .av{width:2.4rem;height:2.4rem;border-radius:50%;background:var(--pb);color:var(--p);display:flex;align-items:center;justify-content:center;font-weight:800;flex:none}`,
  async render(view) {
    root = view; st ||= fresh();
    if (!db.isRemote()) { view.innerHTML = html`${pageHead('الطلبات والمحادثات')}<div class="card">${emptyState('chat', 'هذه الصفحة تعمل مع المتجر الإلكتروني، وهو يحتاج الوضع السحابي (Supabase).', html`<a class="btn primary" href="#/settings">اربط Supabase من الإعدادات</a>`)}</div>`.toString(); return; }
    bind(view); await load(true); draw(); poll();
  },
  destroy() { clearTimeout(timer); root = null; token++; },
};

async function load(first) {
  const my = ++token; if (loading && !first) return; loading = true;
  try {
    if (st.tab === 'orders') st.orders = await sb.rpc('kp_orders_list', { p_limit: 300 });
    else if (!st.buyer) st.threads = await sb.rpc('kp_threads_list', {});
    else { const r = await sb.rpc('kp_chat_staff_get', { p_buyer: st.buyer, p_after: st.last }); if (my === token && r.msgs.length) { st.msgs.push(...r.msgs); st.last = r.msgs.at(-1).id; st.newMsgs = true; } }
    // الأعداد في التبويبين
    if (st.tab === 'orders') { try { st.threads = await sb.rpc('kp_threads_list', {}); } catch { } } else { try { st.orders = await sb.rpc('kp_orders_list', { p_limit: 300 }); } catch { } }
    st.err = ''; st.loaded = true;
  } catch (e) { st.err = e.code === 'NO_SCHEMA' ? 'لم تُحدَّث قاعدة البيانات لدعم المتجر: شغّل ملف supabase/schema.sql الجديد في Supabase.' : e.message; } finally { if (my === token) loading = false; }
}
function poll() { clearTimeout(timer); timer = setTimeout(async () => { if (!root) return; if (!document.hidden && !document.querySelector('.ov')) { const before = st.msgs.length; await load(); if (root) { if (st.tab === 'chat' && st.buyer) { if (st.msgs.length !== before) drawChat(true); } else draw(); } } poll(); }, st.tab === 'chat' && st.buyer ? 3500 : 6000); }

function draw() {
  if (!root) return;
  const y = window.scrollY, newN = st.orders.filter(o => o.status === 'new').length, unread = st.threads.reduce((s, t) => s + (t.unread || 0), 0);
  root.innerHTML = html`${pageHead('الطلبات والمحادثات', html`<a class="btn" href="#/settings?tab=shop">${icon('gear', 16)} إعدادات المتجر</a>`, 'طلبات المشترين من المتجر الإلكتروني ومحادثاتهم')}
    ${tabs([['orders', 'الطلبات', newN || ''], ['chat', 'المحادثات', unread || '']], st.tab)}
    ${st.err ? html`<div class="note-box warn">${icon('alert', 16)} ${st.err}</div>` : ''}
    <div id="ob">${st.tab === 'orders' ? ordersHtml() : (st.buyer ? chatHtml() : threadsHtml())}</div>`.toString();
  window.scrollTo(0, y); if (st.tab === 'chat' && st.buyer) { const c = root.querySelector('#cb'); if (c) c.scrollTop = c.scrollHeight; loadImgs(); }
}
function ordersHtml() {
  const rows = st.orders.filter(o => inF(o, st.filter));
  return html`<div class="chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${FILTERS.map(([id, l]) => html`<button class="chip ${st.filter === id ? 'on' : ''}" data-f="${id}">${l} <span class="num">${st.orders.filter(o => inF(o, id)).length}</span></button>`)}</div>
    ${rows.length ? html`<div class="col" style="gap:8px">${rows.map(o => html`<div class="card" data-o="${o.id}" style="padding:12px;cursor:pointer"><div class="row between"><b>طلب <span class="num">#${o.no}</span> — ${o.name}</b>${badge(STATUS[o.status][0], STATUS[o.status][1])}</div>
      <div class="row wrap small muted" style="gap:10px;margin-top:4px"><span>${fmtDateTime(o.at)}</span><span>${o.delivery === 'home' ? 'توصيل' : 'استلام'}</span><span>${o.pay === 'transfer' ? 'تحويل' : 'عند الاستلام'}</span>${o.proof ? badge('إشعار دفع', 'ok') : o.pay === 'transfer' ? badge('بلا إشعار', 'warn') : ''}${o.hold_id ? badge('في نقطة البيع', 'p') : ''}</div>
      <div class="small" style="margin-top:4px">${o.items.slice(0, 3).map(i => i.name + ' × ' + i.qty).join('، ')}${o.items.length > 3 ? ' …' : ''}</div><div class="bold num" style="margin-top:2px">${money_(o.total)}</div></div>`)}</div>` : emptyState('box', 'لا توجد طلبات في هذا القسم.')}`;
}
function threadsHtml() {
  return st.threads.length ? html`<div class="card" style="padding:4px 12px">${st.threads.map(t => html`<div class="thr" data-t="${t.buyer}"><div class="av">${[...(t.name || '؟')][0]}</div><div class="grow" style="min-width:0"><div class="row between"><b>${t.name || 'زائر بلا اسم'}</b><span class="small muted">${fmtDateTime(t.last_at)}</span></div><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.last_text}</div></div>${t.unread ? html`<span class="badge bad num">${t.unread}</span>` : ''}</div>`)}</div>` : html`<div class="card">${emptyState('chat', 'لا توجد محادثات بعد.')}</div>`;
}
const bub = m => m.kind === 'system' ? html`<div class="bub sys">${m.body}</div>` : html`<div class="bub ${m.from === 'shop' ? 'me' : 'him'}">${m.img ? html`<img data-mi="${m.id}" alt="صورة" style="min-height:4rem;background:rgba(0,0,0,.08)">` : ''}${m.body}<time>${fmtDateTime(m.at)}</time></div>`;
function chatHtml() {
  const t = st.threads.find(x => x.buyer === st.buyer) || {}, o = st.orders.find(x => x.buyer === st.buyer);
  return html`<div class="card" style="padding:12px"><div class="row between" style="margin-bottom:8px"><div class="row"><button class="btn sm" data-back>${icon('chevR', 16)} الرجوع</button><b>${t.name || o?.name || 'زائر'}</b></div>
    <div class="row">${(t.phone || o?.phone) ? html`<a class="btn sm" href="tel:${t.phone || o.phone}">${icon('phone', 16)}</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${digits(t.phone || o.phone)}">واتساب</a>` : ''}</div></div>
    <div class="chatbox" id="cb">${st.msgs.map(bub)}</div>
    <div class="row" style="margin-top:8px;align-items:flex-end"><button class="btn icon" data-img aria-label="إرفاق صورة">${icon('image', 18)}</button><textarea class="inp grow" id="msg" rows="1" placeholder="اكتب ردك..." style="min-height:40px;resize:none"></textarea><button class="btn primary" data-send>${icon('send', 16)} إرسال</button></div></div>`;
}
function drawChat(scroll) { const c = root?.querySelector('#cb'); if (!c) return draw(); c.innerHTML = st.msgs.map(bub).join(''); if (scroll) c.scrollTop = c.scrollHeight; loadImgs(); }
const imgs = {};
function loadImgs() { root?.querySelectorAll('img[data-mi]').forEach(async el => { const id = el.dataset.mi; if (!imgs[id]) { try { imgs[id] = (await sb.rpc('kp_chat_staff_img', { p_id: +id })).img; } catch { return; } } if (imgs[id]) { el.src = imgs[id]; el.style.minHeight = ''; } }); }

async function openBuyer(buyer) { st.tab = 'chat'; st.buyer = buyer; st.msgs = []; st.last = 0; st.newMsgs = false; await load(true); draw(); }
async function sendMsg(img) {
  const ta = root.querySelector('#msg'), body = (ta?.value || '').trim(); if (!body && !img) return;
  try { await sb.rpc('kp_chat_staff_send', { p_buyer: st.buyer, p_body: body, p_img: img || null }, { timeout: 40000 }); if (ta) ta.value = ''; await load(true); drawChat(true); } catch (e) { toast(e.message, 'err'); }
}
async function setStatus(o, status, note) {
  try { await sb.rpc('kp_order_set', { p_order: o.id, p_status: status, p_note: note ?? null }); toast('تم تحديث الحالة', 'ok'); await load(true); draw(); } catch (e) { toast(e.message, 'err'); }
}
async function toPos(o, m) {
  const lines = [], missing = [];
  for (const i of o.items) { const p = get('products', i.id); if (p && p.active !== false) lines.push({ pid: p.id, qty: i.qty, disc: null }); else missing.push(i.name); }
  if (!lines.length) return toast('منتجات هذا الطلب لم تعد موجودة في المخزون', 'err');
  if (missing.length && !(await confirmBox({ title: 'منتجات غير موجودة', message: 'هذه المنتجات لم تعد متاحة وستُتجاهَل: ' + missing.join('، '), ok: 'متابعة' }))) return;
  let cust = list('customers').find(c => digits(c.phone) && digits(c.phone) === digits(o.phone));
  if (!cust && auth.can('customers.manage')) { try { await ops.saveCustomer({ name: o.name, phone: o.phone, address: o.address }); cust = list('customers').find(c => digits(c.phone) === digits(o.phone)); } catch { } }
  const note = `طلب أونلاين #${o.no} — ${o.name} ${o.phone}${o.delivery === 'home' ? ' — توصيل: ' + o.address : ' — استلام'}${o.pay === 'transfer' ? ' — دُفع بالتحويل' : ' — الدفع عند الاستلام'}${o.note ? ' — ' + o.note : ''}`;
  try {
    const h = await ops.saveHold({ lines, invDisc: null, customerId: cust?.id || '', note }, `طلب أونلاين #${o.no} — ${o.name}`);
    await sb.rpc('kp_order_link', { p_order: o.id, p_hold: h.id }); if (o.status === 'new') await sb.rpc('kp_order_set', { p_order: o.id, p_status: 'confirmed', p_note: null });
    m?.close(); toast('أُرسل الطلب إلى نقطة البيع كفاتورة معلّقة. افتح «المعلّقة» هناك لإتمام البيع.', 'ok', 4500); await load(true); draw();
  } catch (e) { toast(e.message, 'err'); }
}
function orderModal(o) {
  const nx = NEXT[o.status] || [];
  const m = modal({ title: `طلب #${o.no}`, size: 'lg', body: html`<div class="col" style="gap:12px">
    <div class="row between wrap"><div>${badge(STATUS[o.status][0], STATUS[o.status][1])} <span class="small muted">${fmtDateTime(o.at)}</span></div>${o.hold_id ? badge('أُرسل إلى نقطة البيع', 'p') : ''}</div>
    <div class="card flat" style="padding:10px"><div class="bold">${o.name}</div><div class="row wrap" style="gap:8px;margin-top:6px"><a class="btn sm" href="tel:${o.phone}">${icon('phone', 16)} <span class="num">${o.phone}</span></a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${digits(o.phone)}">واتساب</a><button class="btn sm" data-chat-b>${icon('chat', 16)} مراسلة</button></div>
      <div class="small" style="margin-top:6px">${o.delivery === 'home' ? html`<b>توصيل إلى:</b> ${o.address}` : html`<b>استلام من المتجر</b>`} · ${o.pay === 'transfer' ? 'الدفع بالتحويل' : 'الدفع عند الاستلام'}</div>${o.note ? html`<div class="small" style="margin-top:4px"><b>ملاحظة المشتري:</b> ${o.note}</div>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>${o.items.map(i => html`<tr><td>${i.name}</td><td class="num">${i.qty}</td><td class="num">${money_(i.price)}</td><td class="num">${money_(i.total)}</td></tr>`)}</tbody></table></div>
    <div class="col" style="gap:4px"><div class="row between"><span>المجموع</span><span class="num">${money_(o.subtotal)}</span></div>${o.fee ? html`<div class="row between"><span>التوصيل</span><span class="num">${money_(o.fee)}</span></div>` : ''}<div class="row between bold"><span>الإجمالي</span><span class="num">${money_(o.total)}</span></div></div>
    ${o.pay === 'transfer' ? html`<div>${o.proof ? html`<button class="btn" data-proof>${icon('image', 16)} عرض إشعار الدفع</button> <span class="small muted">أُرسل ${fmtDateTime(o.proof_at)}</span><div id="proofbox"></div>` : badge('لم يُرسل المشتري إشعار الدفع بعد', 'warn')}</div>` : ''}
    <div class="field"><label>رسالة للمشتري مع تغيير الحالة (اختياري)</label><input class="inp" id="snote" value="${o.shop_note || ''}" placeholder="مثال: سيصلك الطلب خلال ساعة"></div></div>`,
    footer: html`${!o.hold_id && !['rejected', 'cancelled', 'done'].includes(o.status) ? html`<button class="btn" data-pos>${icon('pos', 16)} إرسال إلى نقطة البيع</button>` : o.hold_id ? html`<a class="btn" href="#/pos" data-close>فتح نقطة البيع</a>` : ''}${nx.map(([s, l, k]) => html`<button class="btn ${k || ''}" data-st="${s}">${l}</button>`)}<button class="btn ghost" data-close>إغلاق</button>` });
  m.el.addEventListener('click', async e => {
    const t = e.target;
    const s = t.closest('[data-st]'); if (s) { const to = s.dataset.st; if (['rejected', 'cancelled'].includes(to) && !(await confirmBox({ title: 'تأكيد', message: 'سيصل المشتري إشعار بذلك. متابعة؟', ok: 'متابعة', danger: true }))) return; m.close(); return setStatus(o, to, m.el.querySelector('#snote')?.value ?? ''); }
    if (t.closest('[data-pos]')) return toPos(o, m);
    if (t.closest('[data-chat-b]')) { m.close(); return openBuyer(o.buyer); }
    if (t.closest('[data-proof]')) { const box = m.el.querySelector('#proofbox'); box.innerHTML = '<div class="muted small">جاري التحميل...</div>'; try { const r = await sb.rpc('kp_order_proof', { p_order: o.id }); box.innerHTML = r.img ? `<img src="${r.img}" alt="إشعار الدفع" style="max-width:100%;border-radius:10px;margin-top:8px;border:1px solid var(--b)">` : '<div class="muted small">لا توجد صورة.</div>'; } catch (er) { box.innerHTML = `<div class="small" style="color:var(--bad)">${esc(er.message)}</div>`; } }
  });
}
function bind(view) {
  view.addEventListener('click', async e => {
    const t = e.target, q = s => t.closest(s);
    try {
      const tb = q('[data-tab]'); if (tb) { st.tab = tb.dataset.tab; st.buyer = null; await load(true); return draw(); }
      const f = q('[data-f]'); if (f) { st.filter = f.dataset.f; return draw(); }
      const o = q('[data-o]'); if (o) { const x = st.orders.find(z => z.id === o.dataset.o); if (x) return orderModal(x); }
      const th = q('[data-t]'); if (th) return openBuyer(th.dataset.t);
      if (q('[data-back]')) { st.buyer = null; st.msgs = []; st.last = 0; await load(true); return draw(); }
      if (q('[data-send]')) return sendMsg();
      if (q('[data-img]')) { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const fl = i.files[0]; if (fl) { try { await sendMsg(await shrink(fl, 1100, 0.72)); } catch { toast('تعذّر قراءة الصورة', 'err'); } } }; i.click(); }
    } catch (er) { toast(er.message, 'err'); }
  });
  view.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'msg') { e.preventDefault(); sendMsg(); } });
}
