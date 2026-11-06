// عميل Supabase بلا أي مكتبة: تسجيل الدخول (GoTrue REST) واستدعاء دوال قاعدة البيانات (PostgREST RPC).
// المفتاح العام + جلسة المستخدم فقط؛ لا يوجد هنا أي سر. الجلسة تُحفظ في localStorage لهذا الجهاز.
import DEFAULT from '../config.js';

const K = { cfg: 'kp_sb_cfg', ses: 'kp_sb_session', backend: 'kp_backend' };
const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const wr = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const mk = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// ---------- الوضع والإعداد ----------
export const getBackend = () => { try { return localStorage.getItem(K.backend) === 'supabase' ? 'supabase' : 'local'; } catch { return 'local'; } };
export const setBackend = b => { try { b === 'supabase' ? localStorage.setItem(K.backend, 'supabase') : localStorage.removeItem(K.backend); } catch { } };

let runtime = null;   // إعداد مؤقت في الذاكرة (يستعمله متجر المشترين حين يأتي الرابط بالإعداد) — لا يُحفظ
export const setRuntimeConfig = c => { runtime = c && c.url && c.key ? { url: String(c.url), key: String(c.key) } : null; };
export function config() {
  const o = runtime || rd(K.cfg) || {};
  let url = String(o.url || DEFAULT.supabase.url || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
  const key = String(o.key || DEFAULT.supabase.anonKey || '').trim();
  return { url, key, ok: /^https?:\/\/[^\s/]+/i.test(url) && key.length >= 20, fromFile: !o.url && !!DEFAULT.supabase.url };
}
export function saveConfig({ url, key }) { wr(K.cfg, { url: String(url || '').trim(), key: String(key || '').trim() }); }
export function clearConfig() { wr(K.cfg, null); }
// يرفض مفاتيح الأسرار بوضوح (service_role / secret) لأنها تعطي صلاحيات كاملة لكل من يفتح الموقع
export function looksSecret(key) {
  key = String(key || '').trim(); if (/^sb_secret_/i.test(key)) return true;
  try { const p = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.role === 'service_role'; } catch { return false; }
}

// ---------- رسائل الأخطاء بالعربية ----------
export const AR = {
  KP_UNAUTH: 'انتهت جلسة الدخول — سجّل الدخول من جديد',
  KP_NO_SHOP: 'حسابك غير مرتبط بمتجر بعد',
  KP_ALREADY_MEMBER: 'حسابك مرتبط بمتجر مسبقاً',
  KP_BAD_CODE: 'رمز الانضمام غير صحيح',
  KP_FORBIDDEN: 'هذه العملية للمالك (المدير) فقط',
  KP_CONFLICT: 'تغيّرت هذه البيانات من جهاز آخر قبل لحظات',
  KP_CANNOT_REMOVE_SELF: 'لا يمكنك إزالة نفسك',
  KP_BAD_STORE: 'بيانات غير مقبولة (مخزن غير معروف)',
  KP_BAD_DOC: 'بيانات غير مقبولة (سجل مشوّه)',
  // المتجر الإلكتروني
  KP_NO_STORE: 'هذا المتجر غير متاح حالياً أو أن الرابط غير صحيح',
  KP_BAD_KEY: 'تعذّر التعرف على هذا المتصفح — أعد تحميل الصفحة',
  KP_NEED_NAME: 'اكتب اسمك',
  KP_NEED_PHONE: 'اكتب رقم جوال صحيح',
  KP_NEED_ADDRESS: 'اكتب عنوان التوصيل',
  KP_NO_DELIVERY: 'التوصيل غير متاح حالياً — اختر الاستلام من المتجر',
  KP_NO_PICKUP: 'الاستلام من المتجر غير متاح — اختر التوصيل',
  KP_NO_CASH: 'الدفع عند الاستلام غير متاح — اختر التحويل',
  KP_NO_TRANSFER: 'الدفع بالتحويل غير متاح — اختر الدفع عند الاستلام',
  KP_BAD_ORDER: 'بيانات الطلب غير صحيحة',
  KP_EMPTY_CART: 'السلة فارغة أو فيها منتجات كثيرة جداً',
  KP_BAD_QTY: 'كمية غير صحيحة في السلة',
  KP_GONE: 'أحد منتجات السلة لم يعد متاحاً — حدّث الصفحة وراجع السلة',
  KP_RATE: 'محاولات كثيرة خلال فترة قصيرة — انتظر قليلاً ثم أعد المحاولة',
  KP_BAD_IMAGE: 'الصورة غير مقبولة — اختر صورة JPG أو PNG',
  KP_IMAGE_BIG: 'حجم الصورة كبير جداً',
  KP_NO_ORDER: 'الطلب غير موجود',
  KP_ORDER_CLOSED: 'هذا الطلب مغلق ولا يقبل تعديلاً',
  KP_EMPTY_MSG: 'اكتب رسالة أو أرفق صورة',
  KP_NO_THREAD: 'لا توجد محادثة مع هذا المشتري',
  KP_BAD_STATUS: 'حالة غير صحيحة',
  KP_BAD_SLUG: 'رابط المتجر: 3–32 حرفاً إنجليزياً صغيراً أو أرقاماً أو شرطة (-) ويبدأ بحرف أو رقم',
  KP_SLUG_TAKEN: 'هذا الرابط مستخدم لمتجر آخر — اختر اسماً مختلفاً',
};
function authMsg(m) {
  m = String(m || '');
  if (/invalid login credentials|invalid_credentials|invalid_grant/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
  if (/email not confirmed|email_not_confirmed/i.test(m)) return 'لم يُؤكَّد البريد بعد — افتح رسالة التأكيد المرسلة إلى بريدك ثم سجّل الدخول';
  if (/already registered|user_already_exists|already been registered/i.test(m)) return 'هذا البريد مسجّل مسبقاً — استخدم «تسجيل الدخول»';
  if (/password.*(short|least|weak)|weak_password/i.test(m)) return 'كلمة المرور ضعيفة — استخدم 8 أحرف على الأقل';
  if (/rate limit|too many|over_.*_rate_limit|security purposes/i.test(m)) return 'محاولات كثيرة — انتظر دقيقة ثم أعد المحاولة';
  if (/signup.*disabled|signups not allowed|signup_disabled/i.test(m)) return 'إنشاء الحسابات الجديدة معطّل في مشروع Supabase (Authentication ← Providers ← Email)';
  if (/invalid.*email|validation_failed|unable to validate email/i.test(m)) return 'البريد الإلكتروني غير صالح';
  if (/invalid api key|no api key|apikey/i.test(m)) return 'مفتاح Supabase العام غير صحيح';
  return m;
}
function httpError(status, j, text) {
  const raw = (j && (j.message || j.msg || j.error_description || j.error)) || text || ('HTTP ' + status);
  const pgc = j && j.code;
  const kp = /KP_[A-Z_]+/.exec(String(raw)); 
  if (kp) { const c = kp[0]; const det = String(raw).split(c)[1]?.replace(/^:/, '') || ''; return mk(c === 'KP_CONFLICT' ? 'CONFLICT' : c, AR[c] || raw, { status, kp: c, detail: det }); }
  if (pgc === 'PGRST202' || /could not find the function|schema cache/i.test(String(raw))) return mk('NO_SCHEMA', 'لم يُنفَّذ ملف supabase/schema.sql في مشروعك بعد (أو لم تنتهِ Supabase من تحديث الكاش). نفّذه من SQL Editor ثم أعد المحاولة', { status });
  if (status === 401 || pgc === 'PGRST301' || /jwt expired|invalid jwt/i.test(String(raw))) return mk('AUTH', authMsg(raw) || 'انتهت الجلسة', { status });
  if (status === 429) return mk('RATE', 'محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة', { status });
  return mk(status >= 500 ? 'SERVER' : 'HTTP', authMsg(raw), { status });
}

// ---------- طلب HTTP ----------
async function http(path, { method = 'GET', body, token, timeout = 20000 } = {}) {
  const c = config(); if (!c.ok) throw mk('NO_CONFIG', 'لم يُضبط رابط Supabase والمفتاح العام بعد');
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(c.url + path, { method, headers: { apikey: c.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, cache: 'no-store' });
  } catch (e) { throw mk(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', e.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم' : 'تعذّر الاتصال بالإنترنت أو بخادم Supabase'); }
  finally { clearTimeout(tm); }
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { }
  if (!r.ok) throw httpError(r.status, j, text);
  return j;
}

// ---------- الجلسة ----------
export const session = () => rd(K.ses);
const saveSession = s => { const exp = s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600); wr(K.ses, { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: exp, user: { id: s.user?.id, email: s.user?.email } }); return session(); };
export const clearSession = () => wr(K.ses, null);

export async function signUp(email, password) {
  const j = await http('/auth/v1/signup', { method: 'POST', body: { email: String(email).trim(), password } });
  if (j?.access_token) { saveSession(j); return { signedIn: true }; }
  return { signedIn: false, needsConfirm: true };           // تأكيد البريد مفعّل في Supabase
}
export async function signIn(email, password) {
  const j = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(email).trim(), password } });
  saveSession(j); return session();
}
let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const s = session(); if (!s?.refresh_token) throw mk('AUTH', AR.KP_UNAUTH);
    try { const j = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }); return saveSession(j); }
    catch (e) { if (e.code === 'HTTP' || e.code === 'AUTH' || e.status === 400 || e.status === 401) { clearSession(); throw mk('AUTH', AR.KP_UNAUTH); } throw e; }
  })().finally(() => { refreshing = null; });
  return refreshing;
}
export async function signOut() { const s = session(); clearSession(); if (s?.access_token) { try { await http('/auth/v1/logout', { method: 'POST', token: s.access_token, timeout: 6000 }); } catch { } } }
async function token(force = false) {
  let s = session(); if (!s?.access_token) throw mk('AUTH', AR.KP_UNAUTH);
  if (force || (s.expires_at || 0) - Date.now() / 1000 < 60) s = await refresh();
  return s.access_token;
}

// استدعاء دالة قاعدة البيانات (RPC) بوسائطها المسمّاة
export async function rpc(fn, args = {}, { timeout = 20000 } = {}) {
  let t = await token();
  try { return await http('/rest/v1/rpc/' + fn, { method: 'POST', body: args, token: t, timeout }); }
  catch (e) { if (e.code === 'AUTH') { t = await token(true); return await http('/rest/v1/rpc/' + fn, { method: 'POST', body: args, token: t, timeout }); } throw e; }
}

// فحص الإعداد قبل تسجيل الدخول: هل الرابط والمفتاح صحيحان؟
// استدعاء دالة بلا تسجيل دخول (دور anon): لواجهة المشترين فقط
export const anonRpc = (fn, args = {}, { timeout = 20000 } = {}) => http('/rest/v1/rpc/' + fn, { method: 'POST', body: args, timeout });

export async function checkConfig() {
  const j = await http('/auth/v1/settings', { timeout: 10000 });
  return { signupDisabled: !!j?.disable_signup, emailAutoconfirm: !!j?.mailer_autoconfirm };
}
