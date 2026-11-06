// تبويب «السحابة (Supabase)» في الإعدادات: التحويل بين الوضع المحلي والسحابي، الحساب والمتجر والأعضاء، رفع البيانات المحلية.
import * as db from '../core/db.js';
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as sb from '../lib/supabase.js';
import { html, raw, esc, icon, toast, modal, formModal, confirmBox } from '../ui/components.js';
import { fmtDateTime } from '../core/util.js';

const card = (title, body, sub = '') => html`<div class="card mb"><div class="card-h"><div><h3>${title}</h3>${sub ? html`<div class="small muted">${sub}</div>` : ''}</div></div>${body}</div>`;
const row = (label, control, hint = '') => html`<div class="set-row"><div class="set-l"><b>${label}</b>${hint ? html`<div class="small muted">${hint}</div>` : ''}</div><div class="set-c">${control}</div></div>`;
const copy = async t => { try { await navigator.clipboard.writeText(t); toast('تم النسخ', 'ok', 1200); } catch { prompt('انسخ النص:', t); } };

let localInfo, me = null;       // لقطة من القاعدة المحلية القديمة، ومعلومات الحساب الحالية
async function refreshLocal() { try { localInfo = db.localSummary(await db.readLocalDb('kashier-pro')); } catch { localInfo = null; } }
async function refreshMe() { try { me = await sb.rpc('kp_me'); db.remote().me = me; } catch (e) { me = { error: e.message }; } }

export async function cloudTab() {
  if (!db.isRemote()) return localModeTab();
  await Promise.all([refreshMe(), refreshLocal()]);
  const R = db.remote(), st = R.status, owner = me?.role === 'owner';
  const ok = navigator.onLine && st.state === 'ok';
  const hasLocal = localInfo && (localInfo.products || localInfo.invoices);
  return html`${card('حالة الاتصال', html`
    <div class="note-box ${ok ? '' : 'warn'}">${icon(ok ? 'cloud' : 'wifiOff', 16)} ${ok ? 'متصل بـ Supabase. آخر مزامنة: ' + (st.lastOk ? fmtDateTime(new Date(st.lastOk).toISOString()) : '—') : 'غير متصل — لا يمكن الحفظ حتى يعود الاتصال. ' + esc(st.error || '')}</div>
    ${row('الحساب', html`<span dir="ltr">${esc(me?.email || sb.session()?.user?.email || '')}</span>`)}
    ${row('المتجر', html`<b>${esc(me?.shop_name || '')}</b>`)}
    ${row('الدور في السحابة', html`<b>${owner ? 'مالك (مدير)' : 'موظف'}</b>`, owner ? 'يستطيع إدارة الموظفين والاستعادة وتغيير الرمز' : 'لا يدير الموظفين ولا الإعدادات ولا الاستعادة')}
    <div class="row wrap" style="margin-top:12px"><button class="btn" data-cl-pull>${icon('refresh', 16)} تحديث الآن</button><button class="btn" data-cl-out>${icon('logout', 16)} تسجيل الخروج</button><button class="btn" data-cl-local>العودة للوضع المحلي</button></div>`)}
  ${owner ? card('الموظفون والانضمام', html`
    ${row('رمز الانضمام', html`<code dir="ltr" style="font-size:15px;letter-spacing:1px">${esc(me.join_code || '')}</code> <button class="btn sm" data-cl-copy="${esc(me.join_code || '')}">نسخ</button> <button class="btn sm" data-cl-rotate>تغيير الرمز</button>`, 'أعطِه لموظفك: ينشئ حسابه ثم يختار «الانضمام إلى متجر» ويكتب الرمز. غيّره متى شئت (القديم يتوقف).')}
    <div style="margin-top:8px">${(me.members || []).map(m => html`<div class="list-item"><div class="grow"><b dir="ltr">${esc(m.email || m.user_id)}</b><div class="small muted">${m.role === 'owner' ? 'مالك' : 'موظف'}</div></div>${m.user_id !== me.user_id ? html`<button class="btn sm danger" data-cl-rm="${m.user_id}">إزالة</button>` : html`<span class="badge">أنت</span>`}</div>`)}</div>
    <div class="small muted" style="margin-top:8px;line-height:1.9">حسابات الموظفين هنا لمنع الغرباء من الوصول لبيانات المتجر. أما صلاحيات كل موظف داخل التطبيق (كاشير/مخزون/محاسب) فتُدار من صفحة «الموظفون» ويُفعَّل دخولهم بـ PIN من هناك.</div>`) : ''}
  ${owner && hasLocal ? card('بيانات الوضع المحلي القديمة على هذا الجهاز', html`<div class="small" style="line-height:1.9">وُجدت على هذا الجهاز بيانات محلية: <b>${localInfo.products}</b> منتج، <b>${localInfo.invoices}</b> فاتورة، <b>${localInfo.customers}</b> زبون. يمكنك رفعها إلى السحابة <b class="bad">لتحلّ محلّ بيانات المتجر السحابي الحالية</b>. البيانات المحلية نفسها لا تُحذف.</div>
    <div class="row wrap" style="margin-top:10px"><button class="btn primary" data-cl-upload>${icon('upload', 16)} رفع بياناتي المحلية إلى السحابة</button></div>`) : ''}
  ${card('ما الذي يجب أن تعرفه', html`<div class="small" style="line-height:2">
    <b class="ok">•</b> كل الأجهزة المسجّلة في نفس المتجر ترى نفس البيانات، وتصل التغييرات خلال بضع ثوانٍ.<br>
    <b class="warn">•</b> <b>الحفظ يحتاج إنترنت.</b> عند الانقطاع تظهر شارة «غير متصل» ويتوقف البيع والتعديل حتى يعود الاتصال (القراءة من آخر بيانات محمّلة تبقى متاحة).<br>
    <b class="ok">•</b> إن باع جهازان آخر قطعة من نفس الصنف معاً فتُحفظ إحداهما فقط والأخرى تُرفض برسالة «المتوفر 0» (لا مخزون سالب ولا فاتورة مكررة).<br>
    <b class="ok">•</b> المظهر والاهتزاز والصوت تفضيلات خاصة بكل جهاز ولا تُشارَك.<br>
    <b class="ok">•</b> اللقطات التلقائية في «النسخ الاحتياطي» تبقى على هذا الجهاز وتؤخذ من بيانات السحابة، ويمكنك دائماً تصدير ملف نسخة كاملة.</div>`)}`;
}

function localModeTab() {
  const c = sb.config();
  return html`${card('الوضع المحلي (الحالي)', html`<div class="small" style="line-height:2">بياناتك الآن محفوظة داخل متصفح هذا الجهاز فقط، والتطبيق يعمل بدون إنترنت. للعمل على عدة أجهزة بنفس البيانات حوّل إلى الوضع السحابي.</div>`)}
  ${card('التحويل إلى الوضع السحابي (Supabase)', html`
    <ol class="small" style="line-height:2.2;padding-inline-start:20px;margin:0 0 10px">
      <li>أنشئ مشروعاً مجانياً في <b dir="ltr">supabase.com</b>.</li>
      <li>افتح <b>SQL Editor</b> والصق محتوى ملف <code dir="ltr">supabase/schema.sql</code> ثم اضغط Run. <button class="btn sm" data-cl-sql>نسخ محتوى الملف</button></li>
      <li>من <b>Project Settings ← API</b> انسخ <b>Project URL</b> و<b>المفتاح العام</b> (anon / publishable) وضعهما أدناه. <b class="bad">لا تضع مفتاح service_role.</b></li>
      <li>اضغط «حفظ واختبار الاتصال» ثم «التحويل إلى الوضع السحابي».</li>
    </ol>
    ${row('Project URL', html`<input class="inp" id="cl_url" dir="ltr" placeholder="https://xxxxxxxx.supabase.co" value="${esc(c.url)}" ${c.fromFile ? raw('disabled') : ''}>`, c.fromFile ? 'مضبوط من ملف src/config.js' : '')}
    ${row('المفتاح العام', html`<input class="inp" id="cl_key" dir="ltr" placeholder="eyJ... أو sb_publishable_..." value="${esc(c.key)}" ${c.fromFile ? raw('disabled') : ''}>`)}
    <div class="row wrap" style="margin-top:12px"><button class="btn" data-cl-test>${icon('refresh', 16)} حفظ واختبار الاتصال</button><button class="btn primary" data-cl-go ${c.ok ? '' : raw('disabled')}>${icon('cloud', 16)} التحويل إلى الوضع السحابي</button></div>
    <div id="cl_msg" class="small" style="margin-top:8px"></div>`)}
  ${card('قبل أن تبدأ', html`<div class="small" style="line-height:2"><b class="ok">•</b> بياناتك المحلية <b>لا تُحذف ولا تُعدَّل</b>؛ تبقى على هذا الجهاز ويمكنك الرجوع إليها بزر «العودة للوضع المحلي».<br><b class="ok">•</b> بعد الدخول إلى السحابة (حساب جديد ← إنشاء متجر) سيعرض التطبيق رفع بياناتك المحلية إلى المتجر السحابي.<br><b class="warn">•</b> في الوضع السحابي <b>الحفظ يحتاج إنترنت</b>. خذ نسخة احتياطية قبل التحويل كعادة جيدة.</div>`)}`;
}

async function sqlCopy() { try { const r = await fetch('supabase/schema.sql', { cache: 'no-store' }); if (!r.ok) throw 0; await copy(await r.text()); } catch { toast('تعذّر قراءة الملف. افتح supabase/schema.sql من مجلد المشروع وانسخه يدوياً', 'warn', 5000); } }

// يرفع بيانات القاعدة المحلية القديمة (kashier-pro) إلى المتجر السحابي مستبدلاً ما فيه
export async function uploadLocal({ confirm = true } = {}) {
  const data = await db.readLocalDb('kashier-pro'); const info = db.localSummary(data);
  if (!data || !(info.products || info.invoices || info.customers)) { toast('لا توجد بيانات محلية على هذا الجهاز', 'warn'); return false; }
  const hasCloud = store.count('products') + store.count('invoices') > 0;
  if (confirm && !(await confirmBox({ title: 'رفع البيانات المحلية إلى السحابة', message: html`سيُرفع <b>${info.products}</b> منتج و<b>${info.invoices}</b> فاتورة و<b>${info.customers}</b> زبون إلى المتجر السحابي. ${hasCloud ? html`<b class="bad">وستُستبدل بيانات المتجر السحابي الحالية بالكامل.</b>` : ''} البيانات المحلية لا تُحذف.`, ok: 'رفع', danger: hasCloud }))) return false;
  const up = structuredClone(data);
  up.meta = (up.meta || []).filter(m => m.k !== 'legacy_localstorage').map(m => m.k === 'settings' ? { k: 'settings', v: { ...m.v, sync: { enabled: false, url: '', key: '' } } } : m);
  await db.replaceAll(up); await store.reloadAll();
  await ops.logAudit('cloud.upload', 'backup', '', `رفع بيانات محلية: ${info.products} منتج، ${info.invoices} فاتورة`).catch(() => { });
  toast('تم رفع بياناتك المحلية إلى السحابة', 'ok', 3500); return true;
}

// يُستدعى بعد إقلاع الوضع السحابي: إن كان المتجر السحابي فارغاً ويوجد بيانات محلية، اعرض رفعها مرة واحدة
export async function offerLocalUpload() {
  if (!db.isRemote() || db.remote().me?.role !== 'owner') return;
  if (store.count('products') + store.count('invoices') + store.count('customers') > 0) return;
  try { if (localStorage.getItem('kp_upload_offered') === db.remote().me.shop_id) return; } catch { }
  const info = db.localSummary(await db.readLocalDb('kashier-pro')); if (!info || !(info.products || info.invoices)) return;
  try { localStorage.setItem('kp_upload_offered', db.remote().me.shop_id); } catch { }
  if (await confirmBox({ title: 'نقل بياناتك المحلية', message: html`المتجر السحابي فارغ، ووجدنا على هذا الجهاز بيانات محلية: <b>${info.products}</b> منتج و<b>${info.invoices}</b> فاتورة. هل ترفعها إلى السحابة الآن؟ (تبقى نسختك المحلية كما هي)`, ok: 'ارفعها الآن', cancel: 'لاحقاً' })) await uploadLocal({ confirm: false }).catch(e => toast(e.message, 'err', 6000));
}

// ربط أحداث النقر: تُعيد true إن عالجت الحدث
export async function click(q, { draw }) {
  if (q('[data-cl-sql]')) { await sqlCopy(); return true; }
  if (q('[data-cl-test]')) {
    const msg = document.getElementById('cl_msg'), url = document.getElementById('cl_url')?.value, key = document.getElementById('cl_key')?.value;
    if (sb.looksSecret(key)) { toast('هذا مفتاح سرّي (service_role/secret) ولا يجوز استخدامه في التطبيق', 'err', 6000); return true; }
    if (!sb.config().fromFile) sb.saveConfig({ url, key });
    if (!sb.config().ok) { toast('الرابط أو المفتاح غير مكتمل', 'err'); return true; }
    try { const r = await sb.checkConfig(); toast('الاتصال بمشروع Supabase ناجح' + (r.signupDisabled ? ' — لكن إنشاء الحسابات الجديدة معطّل' : ''), r.signupDisabled ? 'warn' : 'ok', 3500); await draw(); } catch (e) { if (msg) msg.innerHTML = `<span class="bad">${esc(e.message)}</span>`; toast('فشل الاتصال', 'err'); }
    return true;
  }
  if (q('[data-cl-go]')) {
    if (!(await confirmBox({ title: 'التحويل إلى الوضع السحابي', message: 'سيُعاد فتح التطبيق على شاشة تسجيل الدخول إلى Supabase. بياناتك المحلية تبقى على هذا الجهاز كما هي ويمكنك الرجوع إليها. متابعة؟', ok: 'تحويل' }))) return true;
    sb.setBackend('supabase'); location.reload(); return true;
  }
  if (q('[data-cl-local]')) { if (await confirmBox({ title: 'العودة للوضع المحلي', message: 'سيعمل التطبيق على البيانات المحلية القديمة لهذا الجهاز (كما تركتها). بيانات السحابة تبقى في Supabase ولا تتأثر. متابعة؟', ok: 'عودة' })) { sb.setBackend('local'); location.reload(); } return true; }
  if (q('[data-cl-out]')) { if (await confirmBox({ title: 'تسجيل الخروج', message: 'سيُطلب منك تسجيل الدخول من جديد.', ok: 'خروج' })) { await sb.signOut(); location.reload(); } return true; }
  if (q('[data-cl-pull]')) { const n = await db.refresh(); toast(n ? 'وصلت تغييرات جديدة' : 'لا توجد تغييرات جديدة', 'ok', 1500); await draw(); return true; }
  const c = q('[data-cl-copy]'); if (c) { await copy(c.dataset.clCopy); return true; }
  if (q('[data-cl-rotate]')) { if (await confirmBox({ title: 'تغيير رمز الانضمام', message: 'سيتوقف الرمز القديم عن العمل. الموظفون المنضمّون سابقاً لا يتأثرون.', ok: 'تغيير' })) { await sb.rpc('kp_rotate_join_code'); toast('تم تغيير الرمز'); await draw(); } return true; }
  const rm = q('[data-cl-rm]'); if (rm) { if (await confirmBox({ title: 'إزالة موظف', message: 'سيفقد هذا الحساب الوصول إلى بيانات المتجر فوراً.', danger: true, ok: 'إزالة' })) { await sb.rpc('kp_remove_member', { p_user: rm.dataset.clRm }); toast('تمت الإزالة'); await draw(); } return true; }
  if (q('[data-cl-upload]')) { if (await uploadLocal()) await draw(); return true; }
  return false;
}
