// المستخدمون وتسجيل الدخول المحلي.
// تنبيه أمني صريح: هذا قفل تشغيلي لتنظيم العمل بين الموظفين على نفس الجهاز، وليس حماية ضد من يملك الجهاز نفسه
// (البيانات في متصفح الجهاز). الصلاحيات الحقيقية المفروضة من الخادم تتطلب تفعيل الخادم المركزي (انظر README).
import * as store from './store.js';
import { roleHas } from './perms.js';

export const OWNER = { id: 'owner', name: 'المدير', role: 'manager', implicit: true };
let cur = null, listeners = new Set();
export const onAuth = f => { listeners.add(f); return () => listeners.delete(f); };
const emit = () => listeners.forEach(f => f(cur));

export const enabled = () => !!store.settings().auth.enabled;
export function current() { return enabled() ? cur : OWNER; }
export const isLoggedIn = () => !enabled() || !!cur;
export function can(perm, user = current()) { return !!user && roleHas(user.role, perm, store.settings().roles); }

// ---------- PIN ----------
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export async function hashPin(pin, salt = crypto.getRandomValues(new Uint8Array(16)), iter = 120000) {
  const saltHex = typeof salt === 'string' ? salt : hex(salt);
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(saltHex), iterations: iter, hash: 'SHA-256' }, key, 256);
  return { salt: saltHex, hash: hex(bits), iter };
}
export async function verifyPin(user, pin) {
  if (!user?.pin) return false;
  const h = await hashPin(pin, user.pin.salt, user.pin.iter);
  return h.hash === user.pin.hash;
}

export async function login(userId, pin) {
  const u = store.get('users', userId);
  if (!u || u.active === false) throw new Error('المستخدم غير موجود أو معطّل');
  if (!(await verifyPin(u, pin))) throw new Error('الرقم السري غير صحيح');
  cur = u; try { sessionStorage.setItem('kp_uid', u.id); } catch { }
  emit(); return u;
}
export function logout() { cur = null; try { sessionStorage.removeItem('kp_uid'); } catch { } emit(); }
export function restoreSession() {
  if (!enabled()) return;
  try { const id = sessionStorage.getItem('kp_uid'); const u = id && store.get('users', id); if (u && u.active !== false) cur = u; } catch { }
}
// تحقق صلاحية مشرف (لتجاوز الخصم أو إلغاء فاتورة): يعيد المستخدم الذي يملك الصلاحية وPIN صحيح
export async function findApprover(perm, pin) {
  for (const u of store.list('users')) if (u.active !== false && can(perm, u) && await verifyPin(u, pin)) return u;
  return null;
}
export const who = () => { const u = current() || OWNER; return { userId: u.id, userName: u.name }; };
