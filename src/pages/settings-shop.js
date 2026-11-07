// تبويب «المتجر الإلكتروني» في الإعدادات: نشر المتجر للمشترين (store.html) وبيانات التواصل والتوصيل والدفع.
// النشر وحالة الرابط محفوظان في قاعدة Supabase (kp_store_publish)، أما النصوص والرسوم فتُحفظ في الإعدادات العادية (settings.store).
import * as db from '../core/db.js';
import * as sb from '../lib/supabase.js';
import { html, raw, esc, icon, toast, confirmBox } from '../ui/components.js';
import { qrMatrix, qrSvg, qrPng, download } from '../lib/qr.js';

let status = null;           // { slug, on, new_orders, unread }
const fmtB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B';
const isLocalHost = () => /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
const VACUUM = 'vacuum full public.kp_msgs;';
const copy = async t => { try { await navigator.clipboard.writeText(t); toast('تم النسخ', 'ok', 1200); } catch { prompt('انسخ الرابط:', t); } };
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

// رابط المتجر الذي يُرسل للمشترين. إن كان ربط Supabase مضبوطاً في src/config.js على الموقع فالرابط قصير،
// وإلا يُضاف الرابط والمفتاح العام (غير سري) إلى الرابط ليعمل على أي جهاز.
export function storeLink(slug) {
  const c = sb.config(), base = new URL('store.html', location.href.split('#')[0]).href;
  const q = new URLSearchParams({ s: slug }); if (!c.fromFile) { q.set('u', c.url); q.set('k', c.key); }
  return base + '?' + q.toString();
}
export async function shopTab(H) {
  const { row, tx, sw, card } = H;
  if (!db.isRemote()) return card('المتجر الإلكتروني للمشترين', html`<div class="note-box warn">${icon('info', 16)} هذه الميزة تحتاج <b>الوضع السحابي (Supabase)</b>: المشترون يفتحون الموقع من جوالاتهم فلا يستطيعون قراءة بيانات محفوظة على جهازك فقط.</div>
    <ol class="small" style="padding-inline-start:20px;line-height:2"><li>أنشئ مشروع Supabase وشغّل <span class="num">supabase/schema.sql</span> (الشرح في <span class="num">docs/SUPABASE.md</span>).</li><li>من تبويب «السحابة (Supabase)» اربط التطبيق وأنشئ متجرك وارفع بياناتك.</li><li>ارجع إلى هنا: فعّل المتجر، واختر رابطاً، وأرسله لزبائنك.</li></ol>`);
  try { status = await sb.rpc('kp_store_status'); } catch (e) { status = null; }
  const owner = db.remote().me?.role !== 'staff', link = status?.slug ? storeLink(status.slug) : '';
  let cs; try { cs = await sb.rpc('kp_chat_stats'); } catch (e) { cs = { err: e.message || 'خطأ' }; }
  return html`${card('نشر المتجر', html`
    ${row('حالة المتجر', html`<b class="${status?.on ? 'ok' : 'muted'}">${status?.on ? 'منشور ✓' : 'غير منشور'}</b>`, status?.on ? 'الزوار يرون المنتجات المسموح بعرضها فقط (بلا تكلفة ولا مورد ولا كميات دقيقة).' : 'قبل النشر لا يرى الزوار أي شيء.')}
    ${row('رابط المتجر', html`<input class="inp" id="shop_slug" dir="ltr" placeholder="مثال: alamal-market" value="${status?.slug || ''}" style="max-width:220px" maxlength="32">`, 'حروف إنجليزية صغيرة وأرقام وشرطة (3–32). يظهر في عنوان المتجر.')}
    <div class="row wrap" style="gap:8px;margin-top:8px">${owner ? html`<button class="btn primary" data-shop-pub="1">${status?.on ? 'حفظ الرابط' : 'نشر المتجر'}</button>${status?.on ? html`<button class="btn" data-shop-pub="0">إيقاف النشر</button>` : ''}` : html`<span class="muted small">النشر للمالك فقط.</span>`}</div>
    ${link && status.on ? html`<div class="card flat" style="margin-top:12px;padding:12px"><div class="small muted">رابط المشترين</div><div class="num" dir="ltr" style="word-break:break-all;font-size:.82rem;margin:4px 0">${link}</div>
      <div class="row wrap" style="gap:8px"><button class="btn sm" data-shop-copy="${link}">${icon('copy', 16)} نسخ الرابط</button><a class="btn sm" target="_blank" rel="noopener" href="${link}">${icon('eye', 16)} معاينة</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('تسوّقوا من متجرنا واطلبوا أونلاين: ' + link)}">${icon('send', 16)} مشاركة واتساب</a></div>
      <div style="margin-top:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div style="background:#fff;border:1px solid var(--b);border-radius:12px;padding:6px;width:min(220px,100%)">${raw(qrSvg(link).replace('<svg ', '<svg style="display:block;width:100%;height:auto" '))}</div>
        <div style="flex:1;min-width:190px;display:flex;flex-direction:column;gap:8px"><div><b>باركود المتجر</b><div class="small muted">يفتح المتجر مباشرة من كاميرا الجوال. يبقى كما هو ما دام الرابط كما هو، ويتغيّر فقط إذا تغيّر الرابط.</div></div>
          <div class="row wrap" style="gap:8px"><button class="btn sm primary" data-qr-png="${link}" data-qr-name="${status.slug}">${icon('download', 16)} تنزيل PNG</button><button class="btn sm" data-qr-svg="${link}" data-qr-name="${status.slug}">${icon('download', 16)} تنزيل SVG</button></div>
          ${qrMatrix(link).version >= 10 ? html`<div class="small muted">الباركود كثيف لأن الرابط طويل. ضع رابط Supabase والمفتاح العام في <span class="num">src/config.js</span> ليقصر الرابط، <b>قبل</b> أن تطبع الباركود (لأن الباركود سيتغيّر مع الرابط).</div>` : ''}
          ${isLocalHost() ? html`<div class="small warn">تنبيه: أنت تفتح التطبيق من عنوان محلي (${location.hostname})، فهذا الرابط والباركود لا يعملان خارج شبكتك. افتح التطبيق من عنوان موقعك على GitHub لتحصل على رابط عام.</div>` : ''}</div></div>
      ${!sb.config().fromFile ? html`<div class="small muted" style="margin-top:8px">ملاحظة: الرابط يتضمن عنوان مشروع Supabase والمفتاح العام (غير سري) لأن الربط غير مضبوط في <span class="num">src/config.js</span>. ضع القيمتين هناك وارفع الموقع ليصير الرابط أقصر.</div>` : ''}</div>` : ''}`)}
  ${card('بيانات المتجر للمشترين', html`
    ${row('عنوان رئيسي', tx('store.title', { ph: 'اسم المتجر أو شعاره' }))}
    ${row('نبذة قصيرة', tx('store.about', { ph: 'مثال: أفضل الأسعار وتوصيل سريع' }))}
    ${row('رقم واتساب', tx('store.whatsapp', { ph: '9665XXXXXXXX' }), 'بالصيغة الدولية بدون + (يظهر زر واتساب للمشترين).')}
    ${row('رقم الاتصال', tx('store.phone', { ph: 'اتركه فارغاً لاستخدام هاتف المتجر' }))}
    ${row('ساعات العمل', tx('store.hours', { ph: 'يومياً 8 صباحاً – 11 مساءً' }))}
    ${row('إعلان أعلى المتجر', tx('store.notice', { ph: 'مثال: لا توصيل يوم الجمعة' }), 'يظهر في شريط ملوّن أعلى الصفحة.')}`)}
  ${card('التوصيل والاستلام', html`
    ${row('الاستلام من المتجر', sw('store.delivery.pickup'))}${row('التوصيل للمنزل', sw('store.delivery.home'))}
    ${row('رسوم التوصيل', tx('store.delivery.fee', { num: true, min: 0 }))}
    ${row('توصيل مجاني فوق مبلغ', tx('store.delivery.free_over', { num: true, min: 0 }), '0 = لا يوجد توصيل مجاني.')}
    ${row('الحد الأدنى للطلب', tx('store.delivery.min', { num: true, min: 0 }), '0 = بلا حد أدنى. يُتحقق منه على الخادم.')}
    ${row('مناطق التوصيل', tx('store.delivery.areas', { ph: 'مثال: الحي الشمالي والمركز' }))}`)}
  ${card('طرق الدفع', html`
    ${row('الدفع عند الاستلام', sw('store.pay.cash'))}${row('الدفع بالتحويل (مع إشعار)', sw('store.pay.transfer'))}
    ${row('تعليمات التحويل', html`<textarea class="inp" data-set="store.pay.instructions" data-t="text" rows="3" placeholder="مثال: حوّل على آيبان ... باسم ... ثم أرفق صورة الإشعار" style="min-width:220px">${H.getp('store.pay.instructions') || ''}</textarea>`, 'تظهر للمشتري عند اختيار التحويل.')}`)}
  ${card('مساحة المحادثات في Supabase', cs.err ? html`<div class="note-box warn">${icon('info', 16)} تعذّر قراءة إحصاء المحادثات (${cs.err}). إن حدّثت التطبيق حديثاً فنفّذ ملف <span class="num">supabase/schema.sql</span> الجديد في SQL Editor ثم أعد فتح هذه الصفحة.</div>` : html`
    ${row('المحادثات والرسائل', html`<b>${cs.threads} محادثة · ${cs.msgs} رسالة (منها ${cs.images} صورة)</b>`)}
    ${row('حجمها التقريبي', html`<b>${fmtB(cs.bytes)}</b>`, 'نصوص الرسائل وصورها المخزّنة في قاعدة البيانات.')}
    ${row('إشعارات الدفع في الطلبات', html`<b>${cs.proofs} صورة · ${fmtB(cs.proof_bytes)}</b>`, 'مرتبطة بطلباتك فلا تُحذف من هنا.')}
    ${owner ? html`<div class="row wrap" style="gap:8px;margin-top:10px"><button class="btn" data-chat-purge="30" ${cs.older30 ? '' : raw('disabled')}>${icon('trash', 16)} حذف الأقدم من 30 يوماً (${cs.older30})</button><button class="btn danger" data-chat-purge="0" ${cs.msgs ? '' : raw('disabled')}>${icon('trash', 16)} حذف كل المحادثات</button></div>` : html`<div class="small muted" style="margin-top:8px">الحذف للمالك فقط.</div>`}
    <div class="small muted" style="margin-top:10px;line-height:1.9">يحذف رسائل المشترين وصورها فقط، ولا يمسّ الطلبات ولا الفواتير ولا المنتجات، ولا يمكن التراجع عنه. يستطيع المشتري بعده بدء محادثة جديدة.<br><b>حجم القاعدة:</b> بعد الحذف تُعاد المساحة للاستخدام داخل قاعدتك، لكن Supabase لا يُنقص رقم الحجم فوراً. لتقليصه فعلياً نفّذ هذا الأمر في <span class="num">SQL Editor</span> (يقفل جدول الرسائل لحظات): <code class="num" dir="ltr">${VACUUM}</code> <button class="btn sm" data-shop-copy="${VACUUM}">${icon('copy', 16)} نسخ الأمر</button></div>`, 'تفريغ يدوي كل فترة لتوفير مساحة الخطة المجانية')}
  ${card('ما يراه المشترون وما لا يرونه', html`<ul class="small" style="padding-inline-start:20px;line-height:2"><li>يرون: اسم المنتج وسعره وصورته ووصفه وحالة التوفر (متوفر / آخر القطع / نفد) والعروض (نسبة أو مبلغ).</li><li>لا يرون أبداً: التكلفة والربح والموردين والكميات الدقيقة والفواتير والزبائن والموظفين.</li><li>لإخفاء منتج: افتح تعديل المنتج وألغِ «إظهار هذا المنتج في المتجر الإلكتروني». المنتجات غير النشطة لا تظهر.</li><li>السعر النهائي للطلب يحسبه الخادم من أسعارك الفعلية، فلا يمكن للمشتري تغييره.</li><li>الطلب لا يخصم من المخزون: يتحول إلى فاتورة عند إرساله إلى نقطة البيع.</li></ul>`)}`;
}
export async function click(q, { draw }) {
  const pub = q('[data-shop-pub]'); if (pub) {
    const on = pub.dataset.shopPub === '1', slug = slugify(document.getElementById('shop_slug')?.value);
    if (!on && !(await confirmBox({ title: 'إيقاف المتجر', message: 'سيتوقف المشترون عن رؤية المنتجات واستقبال الطلبات. المحادثات والطلبات السابقة تبقى محفوظة.', ok: 'إيقاف' }))) return true;
    try { await sb.rpc('kp_store_publish', { p_slug: slug || status?.slug || '', p_on: on }); toast(on ? 'تم نشر المتجر' : 'تم إيقاف المتجر', 'ok'); import('../core/storewatch.js').then(m => m.start()); } catch (e) { toast(e.message, 'err'); }
    await draw(); return true;
  }
  const cp = q('[data-shop-copy]'); if (cp) { await copy(cp.dataset.shopCopy); return true; }
  const qp = q('[data-qr-png]'); if (qp) { try { download(await qrPng(qp.dataset.qrPng), 'qr-' + (qp.dataset.qrName || 'store') + '.png'); } catch (e) { toast(e.message, 'err'); } return true; }
  const qs = q('[data-qr-svg]'); if (qs) { download(qrSvg(qs.dataset.qrSvg), 'qr-' + (qs.dataset.qrName || 'store') + '.svg', 'image/svg+xml'); return true; }
  const pg = q('[data-chat-purge]'); if (pg) {
    const days = +pg.dataset.chatPurge, all = days === 0;
    if (!(await confirmBox({ title: all ? 'حذف كل المحادثات' : 'حذف المحادثات القديمة', danger: true, ok: all ? 'حذف الكل' : 'حذف', message: all ? 'ستُحذف كل رسائل المشترين وصورها نهائياً من Supabase ولا يمكن التراجع. الطلبات والفواتير لا تتأثر، ويستطيع المشتري بدء محادثة جديدة.' : `ستُحذف رسائل المحادثات الأقدم من ${days} يوماً نهائياً ولا يمكن التراجع. الطلبات والفواتير لا تتأثر.` }))) return true;
    try { const r = await sb.rpc('kp_chat_purge', { p_days: days }); toast(`تم حذف ${r.msgs} رسالة و${r.threads} محادثة (${fmtB(r.bytes)})`, 'ok', 5000); import('../core/storewatch.js').then(m => m.start()); } catch (e) { toast(e.message, 'err'); }
    await draw(); return true;
  }
  return false;
}
