// منطق حسابي نقي (بدون واجهة وبدون قاعدة بيانات) — قابل للاختبار مباشرة
import { r2, r3, fmt } from './util.js';

// ---------- العروض ----------
export const offerActive = (o, today) => !!o && o.active !== false && (!o.start || today >= o.start) && (!o.end || today <= o.end);
export function offerLabel(o) {
  if (!o) return '';
  if (o.type === 'pct') return 'خصم ' + fmt(o.value) + '%';
  if (o.type === 'fixed') return 'خصم ' + fmt(o.value) + ' للوحدة';
  if (o.type === 'bogo') return `اشترِ ${o.buy || 1} واحصل على ${o.get || 1} مجاناً`;
  return '';
}
// قيمة خصم العرض على سطر (السعر للوحدة، الكمية بوحدة المنتج)
export function offerDiscount(o, price, qty, unit) {
  const gross = r2(price * qty); if (!o || gross <= 0) return 0;
  let d = 0;
  if (o.type === 'pct') d = gross * (+o.value || 0) / 100;
  else if (o.type === 'fixed') d = (+o.value || 0) * qty;
  else if (o.type === 'bogo' && unit === 'pc') { const b = Math.max(1, +o.buy || 1), g = Math.max(1, +o.get || 1); d = Math.floor(qty / (b + g)) * g * price; }
  return r2(Math.min(gross, Math.max(0, d)));
}
// أفضل عرض ساري لمنتج (الأكبر خصماً على 1 وحدة)
export function pickOffer(offers, pid, today) {
  let best = null;
  for (const o of offers) if (o.pid === pid && offerActive(o, today)) best = best || o;
  return best;
}

// ---------- حساب السلة ----------
// cart = { lines:[{pid, qty, disc:{type:'pct'|'fixed', value}|null}], invDisc:{type,value}|null }
// ctx  = { getProduct(id), offerFor(pid), tax:{on,rate,inclusive} }
export function calcCart(cart, ctx) {
  const lines = []; let subtotal = 0, offerDisc = 0, lineDisc = 0, baseAfterLines = 0, qtyTotal = 0, unknownCost = 0;
  for (const l of cart.lines || []) {
    const p = ctx.getProduct(l.pid); if (!p) continue;
    const qty = r3(l.qty), price = +p.price || 0, gross = r2(price * qty);
    const offer = ctx.offerFor ? ctx.offerFor(l.pid) : null;
    const od = offer ? offerDiscount(offer, price, qty, p.unit) : 0;
    const afterOffer = r2(gross - od);
    let md = 0;
    if (l.disc && +l.disc.value > 0) md = l.disc.type === 'pct' ? r2(afterOffer * Math.min(100, +l.disc.value) / 100) : r2(Math.min(afterOffer, +l.disc.value));
    const total = r2(afterOffer - md);
    const costKnown = p.cost != null && p.cost !== '';
    if (!costKnown) unknownCost++;
    lines.push({ pid: p.id, name: p.name, unit: p.unit, qty, price, gross, offerDisc: od, offer: offer ? { id: offer.id, type: offer.type, label: offerLabel(offer) } : null, disc: l.disc || null, manualDisc: md, total, alloc: 0, net: total, cost: costKnown ? +p.cost : 0, costKnown });
    subtotal += gross; offerDisc += od; lineDisc += md; baseAfterLines += total; qtyTotal += qty;
  }
  subtotal = r2(subtotal); offerDisc = r2(offerDisc); lineDisc = r2(lineDisc); baseAfterLines = r2(baseAfterLines);
  // خصم الفاتورة يُوزَّع نسبياً على البنود (ضروري لحساب ربح كل منتج ومبلغ المرتجع بدقة)
  let invDisc = 0;
  if (cart.invDisc && +cart.invDisc.value > 0 && baseAfterLines > 0) invDisc = cart.invDisc.type === 'pct' ? r2(baseAfterLines * Math.min(100, +cart.invDisc.value) / 100) : r2(Math.min(baseAfterLines, +cart.invDisc.value));
  if (invDisc > 0) {
    let left = invDisc;
    lines.forEach((l, i) => { const a = i === lines.length - 1 ? left : r2(Math.min(left, invDisc * l.total / baseAfterLines)); l.alloc = a; l.net = r2(l.total - a); left = r2(left - a); });
  }
  const taxable = r2(baseAfterLines - invDisc);
  const t = ctx.tax || { on: false };
  let tax = 0, total = taxable;
  if (t.on && +t.rate > 0) { if (t.inclusive) tax = r2(taxable * t.rate / (100 + t.rate)); else { tax = r2(taxable * t.rate / 100); total = r2(taxable + tax); } }
  const discount = r2(offerDisc + lineDisc + invDisc);
  const manualBase = r2(subtotal - offerDisc);
  return { lines, subtotal, offerDisc, lineDisc, invDisc, discount, manualDisc: r2(lineDisc + invDisc), manualPct: manualBase > 0 ? (lineDisc + invDisc) / manualBase * 100 : 0, taxable, tax, total, net: r2(total - tax), count: lines.length, qtyTotal: r3(qtyTotal), unknownCost, taxInclusive: !!(t.on && t.inclusive), taxRate: t.on ? +t.rate : 0 };
}

// ---------- تسوية الدفع ----------
// pays: [{method:'cash'|'card'|'wallet'|'credit', amount}] — النقد قد يزيد عن المطلوب (يُحسب الباقي)، والباقي لا يزيد.
export function settle(total, pays) {
  const s = { cash: 0, card: 0, wallet: 0, credit: 0 };
  for (const p of pays || []) { const a = r2(p.amount); if (!(a > 0)) continue; if (!(p.method in s)) throw new Error('طريقة دفع غير معروفة'); s[p.method] = r2(s[p.method] + a); }
  const nonCash = r2(s.card + s.wallet + s.credit);
  if (nonCash > total + 0.0001) throw new Error('مجموع (البطاقة + المحفظة + الآجل) يتجاوز إجمالي الفاتورة');
  const cashNeeded = r2(total - nonCash);
  if (s.cash + 0.0001 < cashNeeded) throw new Error('المبلغ المدفوع أقل من المطلوب بمقدار ' + fmt(cashNeeded - s.cash));
  return { cashNet: cashNeeded, change: r2(s.cash - cashNeeded), received: s.cash, card: s.card, wallet: s.wallet, credit: s.credit };
}

// الدفعات الفعلية التي تُسجل على الفاتورة (النقد بعد خصم الباقي)
export function paymentLines(st) {
  const a = []; if (st.cashNet > 0) a.push({ method: 'cash', amount: st.cashNet }); if (st.card > 0) a.push({ method: 'card', amount: st.card }); if (st.wallet > 0) a.push({ method: 'wallet', amount: st.wallet });
  return a;
}

// ---------- ربح فاتورة ----------
// يعيد null للفواتير المرحّلة من النسخة القديمة (لا تملك تكلفة) حتى لا يُحسب ربح وهمي
export function invoiceProfit(inv) {
  if (!inv || inv.legacy || inv.status === 'void') return null;
  let cost = 0; for (const l of inv.items) cost += l.cost * l.qty;
  return r2(inv.net - cost);
}

// ---------- مرتجع ----------
// مبلغ استرداد وحدة من بند فاتورة (يشمل الضريبة نسبياً)
export function unitRefund(inv, line) {
  if (!line.qty) return 0;
  const ratio = inv.total > 0 && inv.taxable > 0 ? inv.total / inv.taxable : 1; // = 1 + نسبة الضريبة عند الضريبة المضافة، 1 عند الشاملة
  return r2(line.net / line.qty * ratio);
}

export const REASONS_RETURN = ['عيب في المنتج', 'منتج خاطئ', 'تغيير رأي الزبون', 'منتهي الصلاحية', 'تالف', 'أخرى'];
export const PAY_LABEL = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة إلكترونية', credit: 'آجل', mixed: 'مختلط' };
