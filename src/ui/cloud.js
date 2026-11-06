// شاشات الدخول إلى الوضع السحابي (Supabase): ضبط الرابط والمفتاح ← تسجيل الدخول/حساب جديد ← إنشاء متجر أو الانضمام برمز.
// تظهر قبل تحميل التطبيق ولا تُستخدم أبداً في الوضع المحلي.
import * as sb from '../lib/supabase.js';
import { esc } from '../core/util.js';
import { icon } from './components.js';

const logo = `<div class="logo" style="margin:0 auto 6px;width:54px;height:54px;border-radius:16px;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff">${icon('cart', 28)}</div>`;
const shell = (inner, wide = false) => `<div class="login"><div class="box" style="gap:12px;${wide ? 'max-width:460px' : ''}"><div class="center">${logo}<h2>كاشير الدكان</h2><div class="muted small">الوضع السحابي — Supabase</div></div>${inner}</div></div>`;
const fld = (name, label, type = 'text', extra = '') => `<div class="field"><label for="g_${name}">${label}</label><input id="g_${name}" name="${name}" type="${type}" autocomplete="off" ${extra}></div>`;
const err = `<div class="form-err" hidden></div>`;
const showErr = (root, m) => { const e = root.querySelector('.form-err'); if (e) { e.textContent = m || ''; e.hidden = !m; } };
const busy = async (btn, fn) => { btn.disabled = true; btn.classList.add('spin'); try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('spin'); } };
const val = (root, n) => root.querySelector(`[name=${n}]`).value.trim();

export function backToLocal() { sb.setBackend('local'); location.reload(); }

function configScreen(root) {
  return new Promise(resolve => {
    const c = sb.config();
    root.innerHTML = shell(`<div class="muted small" style="line-height:1.9">ضع بيانات مشروعك من Supabase: <b>Project Settings ← API</b>. المطلوب: <b>Project URL</b> و<b>المفتاح العام</b> (anon public / publishable). <b class="bad">لا تضع مفتاح service_role أبداً.</b></div>
      <form class="col" style="gap:10px">${fld('url', 'Project URL', 'url', `placeholder="https://xxxxxxxx.supabase.co" dir="ltr" value="${esc(c.url)}"`)}${fld('key', 'المفتاح العام (anon / publishable)', 'text', `dir="ltr" value="${esc(c.key)}"`)}${err}
      <button class="btn primary block" type="submit">حفظ والمتابعة</button><button class="btn block" type="button" data-local>العودة للوضع المحلي</button></form>`, true);
    root.querySelector('[data-local]').onclick = backToLocal;
    root.querySelector('form').onsubmit = async ev => {
      ev.preventDefault(); const url = val(root, 'url'), key = val(root, 'key');
      if (sb.looksSecret(key)) return showErr(root, 'هذا مفتاح سرّي (service_role/secret) ولا يجوز وضعه في تطبيق يفتحه الجميع. استخدم المفتاح العام anon/publishable.');
      sb.saveConfig({ url, key }); if (!sb.config().ok) return showErr(root, 'الرابط أو المفتاح غير مكتمل');
      await busy(ev.submitter || root.querySelector('.primary'), async () => { try { await sb.checkConfig(); resolve(); } catch (e) { showErr(root, 'تعذّر الاتصال بهذا المشروع: ' + e.message); } });
    };
  });
}

function authScreen(root) {
  return new Promise(resolve => {
    root.innerHTML = shell(`<form class="col" style="gap:10px">${fld('email', 'البريد الإلكتروني', 'email', 'dir="ltr" autocomplete="username"')}${fld('password', 'كلمة المرور', 'password', 'dir="ltr" autocomplete="current-password"')}${err}
      <button class="btn primary block" type="submit" data-in>تسجيل الدخول</button>
      <button class="btn block" type="button" data-up>إنشاء حساب جديد</button>
      <div class="muted small center" style="line-height:1.8">الحساب الأول يُنشئ المتجر ويصبح مالكه. الموظفون ينشئون حساباتهم ثم ينضمّون برمز يعطيهم إياه المالك.</div>
      <div class="row" style="justify-content:center;gap:14px">${sb.config().fromFile ? '' : '<a href="#" data-cfg class="small">إعدادات Supabase</a>'}<a href="#" data-local class="small">العودة للوضع المحلي</a></div></form>`);
    const form = root.querySelector('form');
    const go = async (btn, up) => {
      const email = val(root, 'email'), pw = root.querySelector('[name=password]').value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return showErr(root, 'اكتب بريداً إلكترونياً صحيحاً'); if (up && pw.length < 8) return showErr(root, 'كلمة المرور 8 أحرف على الأقل');
      if (!pw) return showErr(root, 'اكتب كلمة المرور'); showErr(root, '');
      await busy(btn, async () => {
        try {
          if (up) { const r = await sb.signUp(email, pw); if (r.needsConfirm) return showErr(root, 'تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم اضغط «تسجيل الدخول». (يمكنك إيقاف تأكيد البريد من لوحة Supabase: Authentication ← Providers ← Email)'); }
          else await sb.signIn(email, pw);
          resolve();
        } catch (e) { showErr(root, e.message); }
      });
    };
    form.onsubmit = ev => { ev.preventDefault(); go(root.querySelector('[data-in]'), false); };
    root.querySelector('[data-up]').onclick = ev => go(ev.currentTarget, true);
    root.querySelector('[data-cfg]')?.addEventListener('click', ev => { ev.preventDefault(); sb.clearSession(); sb.saveConfig({ url: '', key: '' }); resolve(); });
    root.querySelector('[data-local]').onclick = ev => { ev.preventDefault(); backToLocal(); };
    root.querySelector('[name=email]').focus();
  });
}

function shopScreen(root, me) {
  return new Promise(resolve => {
    root.innerHTML = shell(`<div class="muted small center">مرحباً <b dir="ltr">${esc(sb.session()?.user?.email || '')}</b> — حسابك غير مرتبط بمتجر بعد.</div>
      <form class="col" style="gap:8px" data-new><h3 style="margin:4px 0">إنشاء متجر جديد</h3>${fld('shop', 'اسم المتجر', 'text', 'placeholder="سوبر ماركت ..."')}<button class="btn primary block" type="submit">إنشاء المتجر (أنا المالك)</button></form>
      <div class="center muted small">— أو —</div>
      <form class="col" style="gap:8px" data-join><h3 style="margin:4px 0">الانضمام إلى متجر موجود</h3>${fld('code', 'رمز الانضمام (يعطيك إياه المالك)', 'text', 'dir="ltr" placeholder="XXXXXXXXXXXXXXXXXXXX" style="text-transform:uppercase"')}<button class="btn block" type="submit">انضمام كموظف</button></form>${err}
      <div class="row" style="justify-content:center;gap:14px"><a href="#" data-out class="small">تسجيل الخروج</a><a href="#" data-local class="small">العودة للوضع المحلي</a></div>`);
    root.querySelector('[data-new]').onsubmit = async ev => { ev.preventDefault(); const name = val(root, 'shop'); if (!name) return showErr(root, 'اكتب اسم المتجر'); showErr(root, ''); await busy(ev.submitter || ev.target.querySelector('button'), async () => { try { await sb.rpc('kp_create_shop', { p_name: name }); resolve(); } catch (e) { showErr(root, e.message); } }); };
    root.querySelector('[data-join]').onsubmit = async ev => { ev.preventDefault(); const code = val(root, 'code'); if (!code) return showErr(root, 'اكتب رمز الانضمام'); showErr(root, ''); await busy(ev.submitter || ev.target.querySelector('button'), async () => { try { await sb.rpc('kp_join_shop', { p_code: code }); resolve(); } catch (e) { showErr(root, e.message); } }); };
    root.querySelector('[data-out]').onclick = async ev => { ev.preventDefault(); await sb.signOut(); resolve(); };
    root.querySelector('[data-local]').onclick = ev => { ev.preventDefault(); backToLocal(); };
  });
}

function errorScreen(root, e) {
  return new Promise(resolve => {
    root.innerHTML = shell(`<div class="form-err">${esc(e.message || e)}</div><div class="muted small" style="line-height:1.9">بياناتك لم تُحذف. تحتاج في الوضع السحابي إلى اتصال بالإنترنت. إن كنت تعمل بدون إنترنت يمكنك العودة للوضع المحلي (بياناته القديمة على هذا الجهاز كما تركتها).</div>
      <button class="btn primary block" data-retry>إعادة المحاولة</button><button class="btn block" data-cfg>تعديل إعدادات Supabase</button><button class="btn block" data-out>تسجيل الخروج</button><button class="btn block" data-local>العودة للوضع المحلي</button>`);
    root.querySelector('[data-retry]').onclick = () => resolve();
    root.querySelector('[data-cfg]').onclick = () => { sb.clearSession(); sb.saveConfig({ url: '', key: '' }); resolve(); };
    root.querySelector('[data-out]').onclick = async () => { await sb.signOut(); resolve(); };
    root.querySelector('[data-local]').onclick = backToLocal;
  });
}

// يعيد معلومات الحساب والمتجر (kp_me) بعد اكتمال: الإعداد + الدخول + وجود متجر
export async function cloudGate(root, splash) {
  for (;;) {
    try {
      if (!sb.config().ok) { await configScreen(root); continue; }
      if (!sb.session()) { await authScreen(root); continue; }
      splash('جاري الاتصال بالسحابة...');
      const me = await sb.rpc('kp_me');
      if (!me?.shop_id) { await shopScreen(root, me); continue; }
      return me;
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'KP_UNAUTH') { sb.clearSession(); continue; }
      await errorScreen(root, e);
    }
  }
}
