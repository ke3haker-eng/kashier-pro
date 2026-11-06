// مراقبة طلبات المتجر الإلكتروني ورسائله في الوضع السحابي: تحديث الشارات وتنبيه عند وصول طلب جديد.
// استعلام خفيف واحد (kp_store_status) كل 10 ثوانٍ إن كان المتجر منشوراً، وكل دقيقة إن لم يكن (لاكتشاف تفعيله من جهاز آخر).
import * as db from './db.js';
import * as sb from '../lib/supabase.js';

export const state = { on: false, slug: '', orders: 0, unread: 0 };
let timer = null, seen = false;
export function start() {
  stop(); if (!db.isRemote()) return;
  const tick = async () => {
    if (!document.hidden && navigator.onLine) {
      try {
        const s = await sb.rpc('kp_store_status'), prev = { ...state };
        Object.assign(state, { on: !!s.on, slug: s.slug || '', orders: +s.new_orders || 0, unread: +s.unread || 0 });
        window.dispatchEvent(new CustomEvent('kp-store', { detail: { ...state, newOrders: seen && state.orders > prev.orders, newMsgs: seen && state.unread > prev.unread } }));
        seen = true;
      } catch { /* بلا شبكة أو بلا سكيمتا محدّثة: نعاود لاحقاً بصمت */ }
    }
    timer = setTimeout(tick, state.on ? 10000 : 60000);
  };
  tick();
}
export function stop() { clearTimeout(timer); timer = null; seen = false; }
