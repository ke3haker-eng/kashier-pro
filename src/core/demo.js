// وضع التجربة (Demo): قاعدة بيانات منفصلة تماماً (kashier-pro-demo) فلا تختلط أبداً ببياناتك الحقيقية.
// تُولَّد البيانات عبر نفس العمليات الحقيقية (بيع، شراء، مرتجع...) فتكون كل الأرقام والتقارير متسقة.
import * as db from './db.js';
import * as ops from './ops.js';
import * as store from './store.js';
import { setClock, todayKey, addDays, dayStart } from './util.js';

export const REAL_DB = 'kashier-pro', DEMO_DB = 'kashier-pro-demo';
export const isDemo = () => { try { return localStorage.getItem('kp_mode') === 'demo'; } catch { return false; } };
export const dbNameFor = () => isDemo() ? DEMO_DB : REAL_DB;
export function enterDemo() { localStorage.setItem('kp_mode', 'demo'); location.hash = '#/home'; location.reload(); }
export function exitDemo() { localStorage.removeItem('kp_mode'); location.hash = '#/home'; location.reload(); }
export async function resetDemo() { await db.deleteDatabase(DEMO_DB); location.reload(); }

// مولّد أرقام شبه عشوائي ثابت (نفس البيانات في كل مرة)
const rng = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(20261101);
const pick = a => a[Math.floor(rng() * a.length)];
const CATS = ['ألبان وأجبان', 'مخبوزات', 'مشروبات', 'خضار وفواكه', 'معلبات وحبوب', 'منظفات', 'حلويات وسناكس', 'لحوم ودواجن'];
// [اسم, تصنيف, تكلفة, سعر, وحدة, مخزون, حد أدنى]
const PRODUCTS = [
  ['حليب طازج 1 لتر', 0, 4.2, 5.5, 'pc', 80, 20], ['لبن زبادي 500 جم', 0, 2.1, 3, 'pc', 60, 15], ['جبنة شرائح 200 جم', 0, 6.5, 8.5, 'pc', 40, 10], ['زبدة 200 جم', 0, 7, 9.5, 'pc', 8, 10], ['جبنة بيضاء', 0, 22, 30, 'kg', 25, 5],
  ['خبز عربي', 1, 0.6, 1, 'pc', 150, 40], ['خبز توست', 1, 2.5, 3.5, 'pc', 30, 10], ['كرواسون', 1, 1.2, 2, 'pc', 4, 10], ['كعك بالسمسم', 1, 0.8, 1.5, 'pc', 50, 12],
  ['مياه معدنية 600 مل', 2, 0.35, 0.75, 'pc', 300, 60], ['عصير برتقال 1 لتر', 2, 3.8, 5.25, 'pc', 45, 12], ['كولا 330 مل', 2, 1.1, 1.75, 'pc', 120, 30], ['شاي أحمر 100 كيس', 2, 6, 8.5, 'pc', 35, 10], ['قهوة عربية 250 جم', 2, 14, 19, 'pc', 20, 6], ['مشروب طاقة', 2, 3.2, 4.5, 'pc', 0, 12],
  ['طماطم', 3, 2.2, 3.5, 'kg', 40, 10], ['خيار', 3, 1.5, 2.5, 'kg', 35, 10], ['موز', 3, 3.2, 4.5, 'kg', 30, 8], ['تفاح أحمر', 3, 5, 7.5, 'kg', 28, 8], ['بطاطس', 3, 1.6, 2.4, 'kg', 60, 15], ['بصل', 3, 1.2, 2, 'kg', 55, 15], ['ليمون', 3, 3, 4.5, 'kg', 3, 5],
  ['أرز بسمتي 5 كجم', 4, 28, 36, 'pc', 25, 6], ['زيت نباتي 1.5 لتر', 4, 9.5, 12.5, 'pc', 40, 10], ['سكر 2 كجم', 4, 6.5, 8, 'pc', 50, 12], ['مكرونة 400 جم', 4, 1.6, 2.5, 'pc', 90, 20], ['فول معلب', 4, 1.8, 2.75, 'pc', 70, 15], ['تونة معلبة', 4, 3.5, 5, 'pc', 65, 15], ['عدس أحمر 1 كجم', 4, 5, 7, 'pc', 30, 8], ['رز مصري', 4, 4.5, 6, 'kg', 120, 20],
  ['سائل غسيل أطباق', 5, 5, 7.5, 'pc', 35, 8], ['مسحوق غسيل 3 كجم', 5, 18, 24, 'pc', 20, 5], ['مناديل ورقية', 5, 3.5, 5, 'pc', 80, 20], ['منظف أرضيات', 5, 6.5, 9, 'pc', 2, 6],
  ['شوكولاتة لوح', 6, 1.4, 2.25, 'pc', 100, 25], ['شيبس', 6, 1.3, 2, 'pc', 110, 30], ['بسكويت', 6, 1.6, 2.5, 'pc', 85, 20], ['علكة', 6, 0.3, 0.75, 'pc', 200, 40], ['حلاوة طحينية 400 جم', 6, 6, 8.5, 'pc', 30, 8],
  ['دجاج مجمد 1 كجم', 7, 11, 14.5, 'pc', 45, 10], ['لحم مفروم', 7, 32, 42, 'kg', 18, 5], ['نقانق 400 جم', 7, 8, 11, 'pc', 25, 8],
];
const SUPPLIERS = [['شركة الأمل للألبان', '0112345678'], ['مؤسسة النور للتوزيع', '0551234567'], ['مخازن الخير للمواد الغذائية', '0509876543']];
const CUSTOMERS = [['أحمد محمد', '0501112233', 300], ['فاطمة علي', '0553334455', 200], ['مطعم السعادة', '0114445566', 1500], ['سالم الحربي', '0567778899', 0]];

export async function seedDemo(onProgress = () => { }) {
  setClock(null); const TODAY = todayKey(), REAL_NOW = Date.now(); // تاريخ اليوم الحقيقي ثابت طوال التوليد (الساعة المزيّفة لا تؤثر عليه)
  await ops.saveSettings({ demo: true, name: 'سوبر ماركت تجريبي', cur: 'ر.س', phone: '0112223344', address: 'الرياض — شارع التحلية', invoice: { footer: 'نسخة تجريبية — شكراً لزيارتكم' } });
  const cats = []; for (const n of CATS) cats.push(await ops.saveCategory({ name: n }));
  const prods = []; let i = 0;
  const soon = addDays(TODAY, 9), later = addDays(TODAY, 120), past = addDays(TODAY, -3);
  for (const [name, c, cost, price, unit, stock, min] of PRODUCTS) {
    i++; const exp = c === 0 ? soon : c === 1 && i % 2 ? past : c === 4 ? later : '';
    prods.push(await ops.saveProduct({ name, cat: cats[c].id, cost, price, unit, stock: 0, min, barcode: '62810' + String(10000 + i * 7), code: 'P' + String(i).padStart(3, '0'), expiry: exp, desc: '' }));
    prods[prods.length - 1]._stock = stock;
  }
  onProgress('الموردون والزبائن...');
  const sups = []; for (const [n, p] of SUPPLIERS) sups.push(await ops.saveSupplier({ name: n, phone: p, address: 'الرياض' }));
  const custs = []; for (const [n, p, l] of CUSTOMERS) custs.push(await ops.saveCustomer({ name: n, phone: p, creditLimit: l }));
  // مشتريات تعبّئ المخزون (قبل 40 يوماً) ثم تُطبَّق الكميات المطلوبة
  setClock(dayStart(addDays(TODAY, -35)) + 9 * 3600e3);
  for (let k = 0; k < 3; k++) {
    const group = prods.filter((_, idx) => idx % 3 === k);
    await ops.savePurchase({ supplierId: sups[k].id, status: 'approved', date: addDays(TODAY, -35), items: group.map(p => ({ pid: p.id, qty: Math.round((p._stock + 150) * (p.unit === 'kg' ? 1 : 1)), cost: p.cost, expiry: p.expiry && p.expiry > TODAY ? p.expiry : '' })), paid: k === 0 ? 0 : Math.round(group.reduce((s, p) => s + (p._stock + 150) * p.cost, 0) * 0.6), method: 'cash', enableTrack: true });
  }
  onProgress('عروض...');
  setClock(null);
  await ops.saveOffer({ pid: prods[0].id, type: 'pct', value: 10, end: addDays(TODAY, 14) });
  await ops.saveOffer({ pid: prods[36].id, type: 'bogo', buy: 1, get: 1, end: addDays(TODAY, 7) });
  await ops.saveOffer({ pid: prods[10].id, type: 'fixed', value: 0.5, end: addDays(TODAY, 10) });
  // 30 يوماً من المبيعات الحقيقية عبر نفس دالة البيع
  const sellable = prods.filter(p => p.unit === 'pc' || true);
  for (let d = 30; d >= 0; d--) {
    const day = addDays(TODAY, -d); const n = d === 0 ? 7 : 5 + Math.floor(rng() * 9) + (d % 7 === 5 ? 4 : 0);
    onProgress(`مبيعات اليوم ${31 - d} من 31...`);
    for (let s = 0; s < n; s++) {
      setClock(Math.min(dayStart(day) + (8 + Math.floor(rng() * 13)) * 3600e3 + Math.floor(rng() * 3600) * 1000, REAL_NOW - 60e3));
      const lines = []; const used = new Set();
      for (let k = 0, m = 1 + Math.floor(rng() * 4); k < m; k++) { const p = pick(sellable); if (used.has(p.id)) continue; used.add(p.id); const cp = store.get('products', p.id); if (cp.stock <= 0) continue; const qty = cp.unit === 'kg' ? Math.round((0.25 + rng() * 1.5) * 4) / 4 : 1 + Math.floor(rng() * 3); if (qty > cp.stock) continue; lines.push({ pid: p.id, qty }); }
      if (!lines.length) continue;
      const cart = { lines }; if (rng() < 0.08) cart.invDisc = { type: 'pct', value: 5 };
      const c = (await import('./calc.js')).calcCart(cart, ops.cartCtx()); const r = rng();
      let customerId = '', payments;
      if (r < 0.1 && c.total > 0) { customerId = pick(custs.slice(0, 3)).id; const cust = store.get('customers', customerId); const bal = store.customerBalance(customerId); if (cust.creditLimit && bal + c.total > cust.creditLimit) { payments = [{ method: 'cash', amount: Math.ceil(c.total) }]; customerId = ''; } else payments = [{ method: 'credit', amount: c.total }]; }
      else if (r < 0.4) payments = [{ method: 'card', amount: c.total }]; else if (r < 0.5) payments = [{ method: 'wallet', amount: c.total }]; else payments = [{ method: 'cash', amount: Math.ceil(c.total / 5) * 5 }];
      try { await ops.completeSale({ cart, payments, customerId }); } catch (e) { /* مخزون نفد أثناء التوليد — نتجاوز */ }
    }
    if (d === 12) { setClock(dayStart(day) + 15 * 3600e3); const inv = store.list('invoices').filter(x => !x.legacy && x.status === 'done' && !x.due).slice(-1)[0]; if (inv) { try { await ops.createReturn({ invoiceId: inv.id, items: [{ idx: 0, qty: 1, condition: 'good' }], reason: 'تغيير رأي الزبون' }); } catch { } } }
    if (d === 25 || d === 15 || d === 5) { setClock(dayStart(day) + 11 * 3600e3); await ops.saveExpense({ date: day, category: 'wages', amount: 1800, note: 'أجور موظفين' }).catch(() => { }); await ops.saveExpense({ date: day, category: 'electricity', amount: 420, note: 'فاتورة الكهرباء' }).catch(() => { }); }
    if (d === 28) await ops.saveExpense({ date: day, category: 'rent', amount: 3500, note: 'إيجار المحل' }).catch(() => { });
    if (d === 18) await ops.saveExpense({ date: day, category: 'transport', amount: 260, note: 'نقل بضاعة' }).catch(() => { });
  }
  setClock(null);
  // دفعة سداد من زبون
  await ops.payCustomer(custs[0].id, Math.min(20, store.customerBalance(custs[0].id) || 0) || 0.01, 'cash', 'دفعة تجريبية').catch(() => { });
}
