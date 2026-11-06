// الإعدادات: المتجر، الفاتورة والطباعة، الضريبة والتكلفة، المبيعات والمخزون، المظهر، النسخ الاحتياطي، الخادم والسحابة، النظام.
// كل حقل يُحفظ فور تغييره (مع تحقق من المدى) — لا يوجد زر "حفظ" ينساه المستخدم.
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import * as db from '../core/db.js';
import * as bk from '../core/backup.js';
import * as sync from '../lib/sync.js';
import * as cloudSettings from './settings-cloud.js';
import * as shopSettings from './settings-shop.js';
import { SCHEMA_VERSION } from '../core/migrate.js';
import { APP_VERSION } from '../version.js';
import { isDemo, enterDemo, exitDemo, resetDemo } from '../core/demo.js';
import { html, raw, esc, icon, toast, modal, formModal, confirmBox, pageHead, table, badge, tabs, kv, emptyState } from '../ui/components.js';
import { fmt, num, nowISO, fmtDateTime, fmtDate, download, pickFile, readText, daysBetween, dayKey, todayKey, r2 } from '../core/util.js';
import { pickImage } from '../lib/image.js';
import { invoiceHTML, printHTML } from '../lib/print.js';

const can = p => auth.can(p);
const TABS = [['store', 'المتجر', 'settings.manage'], ['invoice', 'الفاتورة والطباعة', 'settings.manage'], ['tax', 'الضريبة والتكلفة', 'settings.manage'], ['pos', 'المبيعات والمخزون', 'settings.manage'], ['look', 'المظهر والتنبيهات', 'settings.manage'], ['backup', 'النسخ الاحتياطي', 'backup.manage'], ['cloud', 'السحابة (Supabase)', 'settings.manage'], ['shop', 'المتجر الإلكتروني', 'settings.manage'], ['server', 'نسخ احتياطي بخادم', 'settings.manage'], ['system', 'النظام والتجربة', 'settings.manage']];
const st = { tab: '' };
let root, token = 0;

// ---------- أدوات بناء الحقول ----------
const S_ = () => store.settings();
const getp = path => path.split('.').reduce((o, k) => o?.[k], S_());
const patchOf = (path, v) => path.split('.').reverse().reduce((acc, k) => ({ [k]: acc }), v);
const row = (label, control, hint = '') => html`<div class="set-row"><div class="set-l"><b>${label}</b>${hint ? html`<div class="small muted">${hint}</div>` : ''}</div><div class="set-c">${control}</div></div>`;
const tx = (path, o = {}) => html`<input class="inp" data-set="${path}" data-t="${o.num ? 'num' : 'text'}" value="${getp(path) ?? ''}" ${o.ph ? raw(`placeholder="${esc(o.ph)}"`) : ''} ${o.num ? raw(`inputmode="decimal" data-min="${o.min ?? ''}" data-max="${o.max ?? ''}" style="max-width:130px"`) : ''} ${o.dir ? raw(`dir="${o.dir}"`) : ''} autocomplete="off">`;
const area = path => html`<textarea class="inp" rows="3" data-set="${path}" data-t="text">${getp(path) ?? ''}</textarea>`;
const sw = (path, t = 'bool') => html`<label class="sw"><input type="checkbox" data-set="${path}" data-t="${t}" ${getp(path) ? raw('checked') : ''}><i></i></label>`;
const sel = (path, opts, t = 'text') => html`<select class="inp" data-set="${path}" data-t="${t}" style="width:auto;min-width:150px">${opts.map(([v, l]) => html`<option value="${v}" ${String(t === 'sbool' ? (getp(path) ? '1' : '0') : getp(path)) === String(v) ? raw('selected') : ''}>${l}</option>`)}</select>`;
const card = (title, body, sub = '') => html`<div class="card mb"><div class="card-h"><div><h3>${title}</h3>${sub ? html`<div class="small muted">${sub}</div>` : ''}</div></div>${body}</div>`;

// ---------- التبويبات ----------
function storeTab() {
  const S = S_();
  return card('بيانات المتجر', html`${row('اسم المتجر', tx('name', { ph: 'يظهر في أعلى الفاتورة وفي القائمة' }))}${row('رقم الهاتف', tx('phone', { dir: 'ltr' }))}${row('العنوان', tx('address'))}${row('الرقم الضريبي', tx('taxNo', { dir: 'ltr' }), 'يظهر على الفاتورة إن وُجد')}${row('رمز العملة', tx('cur', { ph: 'مثال: ر.س أو ج.م أو د.أ' }), 'يُضاف بعد كل مبلغ في التطبيق والفواتير')}
    ${row('شعار المتجر', html`<div class="row gap14">${S.logo ? html`<img src="${S.logo}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:12px;border:1px solid var(--b);background:#fff">` : html`<div class="av" style="width:56px;height:56px;border-radius:12px;background:var(--in);color:var(--t2)">${icon('image', 24)}</div>`}<button class="btn" data-logo>${icon('upload', 16)} ${S.logo ? 'تغيير' : 'اختيار صورة'}</button>${S.logo ? html`<button class="btn ghost" data-logo-del>إزالة</button>` : ''}</div>`, 'يُصغَّر تلقائياً ويُحفظ داخل قاعدة البيانات')}`);
}

function sampleInvoice() {
  const S = S_(), r = S.tax.on ? S.tax.rate / 100 : 0, items = [{ name: 'مثال: حليب 1 لتر', qty: 2, unit: 'pc', price: 5, gross: 10, total: 10, offerDisc: 0, manualDisc: 0 }, { name: 'مثال: جبنة بالوزن', qty: 0.35, unit: 'kg', price: 40, gross: 14, total: 14, offerDisc: 0, manualDisc: 0 }];
  const sub = 24, tax = S.tax.on ? (S.tax.inclusive ? r2(sub - sub / (1 + r)) : r2(sub * r)) : 0, total = S.tax.on && !S.tax.inclusive ? r2(sub + tax) : sub;
  return { no: (S.invoice.prefix || '') + String(1).padStart(S.invoice.pad || 6, '0'), t: nowISO(), userName: 'الكاشير', items, subtotal: sub, offerDisc: 0, lineDisc: 0, invDisc: 0, tax, taxRate: S.tax.rate, taxInclusive: S.tax.inclusive, total, payments: [{ method: 'cash', amount: 50 }], received: 50, change: r2(50 - total), due: 0, status: 'paid', method: 'cash' };
}
function invoiceTab() {
  const S = S_(), I = S.invoice;
  return html`<div class="grid g-main" style="align-items:start"><div>${card('الترقيم والنص', html`${row('بادئة رقم الفاتورة', tx('invoice.prefix', { dir: 'ltr' }), 'التغيير يخص الفواتير الجديدة فقط، والترقيم يستمر دون تكرار')}${row('عدد خانات الرقم', tx('invoice.pad', { num: true, min: 1, max: 10 }))}${row('بادئة المرتجعات', tx('invoice.retPrefix', { dir: 'ltr' }))}${row('بادئة فواتير الشراء', tx('invoice.purPrefix', { dir: 'ltr' }))}${row('نص أسفل الفاتورة', area('invoice.footer'))}`)}
    ${card('الطباعة', html`${row('حجم الورق الافتراضي', sel('invoice.paper', [['58', 'حراري 58 مم'], ['80', 'حراري 80 مم'], ['a4', 'A4']]), 'يمكن تغييره عند كل طباعة من نافذة المعاينة')}${row('طباعة تلقائية بعد البيع', sw('invoice.autoPrint'), 'تفتح نافذة الطباعة مباشرة بعد إتمام كل عملية بيع')}${row('عدد النسخ', tx('invoice.copies', { num: true, min: 1, max: 5 }))}${row('إظهار الشعار', sw('invoice.showLogo'))}<div class="row" style="margin-top:10px"><button class="btn" data-test-print>${icon('print', 16)} طباعة تجريبية</button></div>`)}</div>
    <div class="card" style="position:sticky;top:76px"><div class="card-h"><h3>معاينة الشكل</h3></div><div class="small muted" style="margin-bottom:8px">أمثلة توضيحية للتنسيق فقط — لا تُحفظ ولا تدخل في بياناتك.</div><div class="rcpt-prev">${invoiceHTML(sampleInvoice(), I.paper)}</div></div></div>`;
}

function taxTab() {
  const S = S_(), T = S.tax, r = T.rate / 100, ex = 100, tax = T.on ? (T.inclusive ? r2(ex - ex / (1 + r)) : r2(ex * r)) : 0, tot = T.on && !T.inclusive ? r2(ex + tax) : ex;
  return html`${card('الضريبة', html`${row('تفعيل الضريبة', sw('tax.on'), 'عند التفعيل تُحسب وتُعرض على كل فاتورة جديدة')}${row('اسم الضريبة', tx('tax.label'))}${row('النسبة %', tx('tax.rate', { num: true, min: 0, max: 100 }))}${row('طريقة الحساب', sel('tax.inclusive', [['1', 'الأسعار شاملة الضريبة'], ['0', 'تُضاف الضريبة فوق السعر']], 'sbool'))}
    <div class="note-box" style="margin-top:10px">${icon('info', 16)} مثال: منتج سعره ${fmt(ex)} ← ${T.on ? html`الضريبة <b class="num">${fmt(tax)}</b> والإجمالي <b class="num">${fmt(tot)}</b>` : 'الضريبة غير مفعّلة (الإجمالي ' + fmt(ex) + ')'}. الفواتير القديمة لا تتغير.</div>`)}
    ${card('طريقة احتساب تكلفة الشراء', html`${row('التكلفة المعتمدة للمنتج', sel('cost.method', [['last', 'آخر سعر شراء'], ['avg', 'المتوسط المرجّح']]), 'تُستخدم في حساب الربح وقيمة المخزون. تُسجَّل تكلفة كل فاتورة بيع وقت البيع فلا تتأثر الفواتير القديمة.')}`)}`;
}

function posTab() {
  const S = S_(), sc = S.pos.scale, tot = sc.prefix.length + sc.itemLen + sc.valLen + 1;
  return html`${card('شاشة البيع', html`${row('إلزام فتح وردية قبل البيع', sw('pos.requireShift'), 'لا يُسمح بالبيع قبل فتح وردية وتسجيل رصيد الدرج')}${row('أقصى خصم للكاشير %', tx('pos.maxDiscPct', { num: true, min: 0, max: 100 }), 'ما يتجاوز هذه النسبة يحتاج الرقم السري لمدير')}${row('طريقة الدفع الافتراضية', sel('pos.defaultPay', [['cash', 'نقدي'], ['card', 'بطاقة'], ['wallet', 'محفظة']]))}${row('العرض الافتراضي للمنتجات', sel('pos.grid', [['1', 'شبكة'], ['0', 'قائمة']], 'sbool'))}${row('إظهار صور المنتجات', sw('pos.images'))}`)}
    ${card('المخزون', html`${row('السماح بالبيع بمخزون سالب', sw('stock.allowNegative'), 'إن كان معطّلاً يُمنع بيع كمية أكبر من المتوفر للمنتجات المتتبَّعة')}${row('الحد الأدنى الافتراضي للتنبيه', tx('stock.lowDefault', { num: true, min: 0 }), 'للمنتجات التي لم يُحدَّد لها حد خاص')}${row('التنبيه المسبق للصلاحية (يوم)', tx('stock.expiryDays', { num: true, min: 1, max: 365 }))}`)}
    ${card('باركود الميزان (للأصناف الموزونة)', html`<div class="small muted" style="margin-bottom:8px">بعض موازين الملصقات تطبع باركوداً يحوي رمز الصنف والوزن. فعّله إن كنت تستخدم ميزاناً كهذا: يُقرأ الوزن بالجرام ويُضاف للفاتورة مباشرة. رمز الصنف هو "الرمز الداخلي" في بطاقة المنتج.</div>${row('تفعيل باركود الميزان', sw('pos.scale.on'))}${row('البادئة', tx('pos.scale.prefix', { dir: 'ltr', ph: '2' }), 'أول رقم/أرقام ثابتة في الباركود (عادةً 2)')}${row('خانات رمز الصنف', tx('pos.scale.itemLen', { num: true, min: 1, max: 8 }))}${row('خانات الوزن (جرام)', tx('pos.scale.valLen', { num: true, min: 1, max: 8 }))}
      <div class="note-box" style="margin-top:10px">${icon('info', 16)} طول الباركود المتوقع: <b class="num">${tot}</b> خانة (البادئة + الصنف + الوزن + خانة تحقق). مثال: <span class="num" dir="ltr">${sc.prefix}${'1'.padStart(sc.itemLen, '0')}${'750'.padStart(sc.valLen, '0')}0</span> = الصنف 1 بوزن 750 جم.${tot !== 13 ? html` <span class="warn">(الشائع 13 خانة EAN-13)</span>` : ''}</div>`)}`;
}

function lookTab() {
  return html`${card('حجم الخط والواجهة (لهذا الجهاز فقط)', html`${row('تكبير أو تصغير الخط والأزرار والمسافات', html`<button class="btn" data-open-display>${icon('maximize', 16)} ضبط الحجم</button>`, 'مناسب لشاشات الجوال الصغيرة أو لمن يريد خطاً أكبر. لا يؤثر على الأجهزة الأخرى.')}`)}${card('المظهر والتنبيهات', html`${row('المظهر', sel('theme', [['auto', 'تلقائي (حسب الجهاز)'], ['light', 'نهاري'], ['dark', 'ليلي']]))}${row('اهتزاز عند المسح والإضافة', sw('vib', 'bit'))}${row('صوت عند المسح والإضافة', sw('snd', 'bit'))}${row('إغلاق الكاميرا بعد كل مسح', sw('once', 'bit'), 'مناسب للمسح المنفرد؛ أوقفه لمسح عدة أصناف متتالية دون إعادة فتح الكاميرا')}`)}`;
}

// ---------- النسخ الاحتياطي ----------
const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب';
async function backupTab() {
  const S = S_(), B = S.backup, snaps = await bk.listSnapshots(), u = await db.usage(), persisted = await navigator.storage?.persisted?.().catch(() => false);
  const ago = B.lastExportAt ? daysBetween(dayKey(B.lastExportAt), todayKey()) : null;
  const hasData = store.count('products') + store.count('invoices') > 0;
  return html`${card('نسخة احتياطية خارج الجهاز', html`<div class="note-box ${hasData && (ago == null || ago > 7) ? 'warn' : ''}">${icon(hasData && (ago == null || ago > 7) ? 'alert' : 'shield', 16)} ${B.lastExportAt ? html`آخر ملف نسخة صدّرته: <b>${fmtDate(B.lastExportAt)}</b> (قبل ${ago} يوم)${ago > 7 && hasData ? ' — يُنصح بتصدير نسخة جديدة' : ''}` : (hasData ? 'لم تصدّر ملف نسخة احتياطية بعد. بيانات المتصفح قد تُفقد إن مُسح التخزين أو تعطل الجهاز — صدّر نسخة واحفظها خارج الجهاز.' : 'لا توجد بيانات بعد.')}</div>
    <div class="row wrap" style="margin-top:12px"><button class="btn primary" data-export>${icon('download', 18)} تصدير نسخة كاملة (JSON)</button><button class="btn" data-import>${icon('upload', 18)} استيراد / استعادة نسخة</button></div>
    <div class="small muted" style="margin-top:8px">الملف يحوي كل شيء: المنتجات والفواتير والمخزون والمشتريات والزبائن والموردين والمصروفات والورديات والإعدادات. ويقبل أيضاً ملف النسخة القديم من التطبيق السابق. قبل أي استعادة تُؤخذ لقطة أمان تلقائية من بياناتك الحالية.</div>`)}
    ${card('لقطات تلقائية داخل الجهاز', html`${row('إنشاء لقطة تلقائية', sw('backup.auto'), 'تُنشأ عند فتح التطبيق إذا مضى الفاصل المحدد')}${row('الفاصل بين اللقطات', sel('backup.intervalH', [['6', 'كل 6 ساعات'], ['12', 'كل 12 ساعة'], ['24', 'يومياً'], ['72', 'كل 3 أيام'], ['168', 'أسبوعياً']], 'num'))}${row('عدد اللقطات المحتفَظ بها', sel('backup.keep', [['3', '3'], ['7', '7'], ['14', '14'], ['30', '30']], 'num'))}
      <div class="row" style="margin:10px 0"><button class="btn" data-snap>${icon('plus', 16)} إنشاء لقطة الآن</button></div>
      ${table({ cols: [{ key: 't', label: 'الوقت', render: s => html`<span class="num">${fmtDateTime(s.t)}</span>` }, { key: 'l', label: 'النوع', render: s => badge(s.label, s.label === 'تلقائية' ? '' : 'warn') }, { key: 'c', label: 'المحتوى', render: s => html`<span class="small">${s.counts?.products ?? 0} منتج · ${s.counts?.invoices ?? 0} فاتورة</span>` }, { key: 's', label: 'الحجم', render: s => html`<span class="num small">${fmtBytes(s.size)}</span>` }, { key: 'x', label: '', cls: 'nolabel', align: 'end', render: s => html`<div class="row gap4" style="justify-content:flex-end"><button class="btn sm" data-snap-restore="${s.id}">استعادة</button><button class="btn sm icon ghost" data-snap-dl="${s.id}" title="تنزيل">${icon('download', 14)}</button><button class="btn sm icon ghost" data-snap-del="${s.id}" title="حذف">${icon('trash', 14)}</button></div>` }], rows: snaps, empty: 'لا توجد لقطات بعد' })}`, 'محفوظة في قاعدة بيانات المتصفح نفسها (للحماية من الأخطاء، وليست بديلاً عن ملف خارج الجهاز)')}
    ${card('مساحة التخزين', html`${row('التخزين الدائم', persisted ? badge('مفعّل — لن يمسح المتصفح بياناتك تلقائياً', 'ok') : html`<div class="row">${badge('غير مضمون', 'warn')}<button class="btn sm" data-persist>طلب التخزين الدائم</button></div>`, 'تثبيت التطبيق كـ PWA يزيد فرص منح التخزين الدائم')}${u ? row('المساحة المستخدمة', html`<span class="num">${fmtBytes(u.usage || 0)}</span> من <span class="num">${fmtBytes(u.quota || 0)}</span>`) : ''}`)}
    ${card('منطقة الخطر', html`<div class="small muted" style="margin-bottom:10px">كل عملية هنا تأخذ لقطة أمان قبل التنفيذ ويمكن التراجع عنها من قائمة اللقطات.</div><div class="row wrap"><button class="btn danger" data-clear>مسح سجل المبيعات فقط</button><button class="btn danger" data-reset>مسح كل البيانات</button></div>`)}`;
}

async function importFlow() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  let obj; try { obj = JSON.parse(await readText(f)); } catch { return toast('الملف ليس بصيغة JSON صالحة', 'err'); }
  const v = await bk.validateBackup(obj); const c = v.counts || {};
  const body = html`<div class="${v.ok ? 'note-box' : 'form-err'}">${v.ok ? (v.kind === 'legacy' ? 'نسخة من التطبيق القديم (منتجات + سجل مبيعات) — ستُحوَّل للصيغة الجديدة.' : 'ملف نسخة احتياطية سليم.') : v.errors.join(' — ')}</div>
    ${v.warnings?.length ? html`<div class="note-box warn" style="margin-top:8px">${v.warnings.join(' — ')}</div>` : ''}
    <div class="card flat" style="margin-top:10px">${v.exportedAt ? kv('تاريخ التصدير', fmtDateTime(v.exportedAt)) : ''}${kv('المنتجات', c.products ?? 0)}${kv('الفواتير', c.invoices ?? 0)}${v.kind === 'full' ? html`${kv('الزبائن', c.customers ?? 0)}${kv('الموردون', c.suppliers ?? 0)}${kv('فواتير الشراء', c.purchases ?? 0)}${kv('المصروفات', c.expenses ?? 0)}` : ''}</div>
    ${v.ok ? html`<div class="note-box warn" style="margin-top:10px">${icon('alert', 16)} <b>سيتم استبدال بياناتك الحالية</b> بمحتوى هذا الملف. تُؤخذ لقطة أمان من بياناتك الحالية أولاً ويمكنك الرجوع إليها.</div>` : ''}`;
  const m = modal({ title: 'استيراد نسخة احتياطية', body, footer: v.ok ? html`<button class="btn danger" data-ok>استبدال البيانات بهذه النسخة</button><button class="btn ghost" data-close>إلغاء</button>` : html`<button class="btn ghost" data-close>إغلاق</button>` });
  m.el.querySelector('[data-ok]')?.addEventListener('click', async e => { e.target.disabled = true; try { const cn = await bk.restoreBackup(obj); await ops.logAudit('backup.restore', 'backup', '', `استعادة نسخة (${cn.products ?? 0} منتج، ${cn.invoices ?? 0} فاتورة)`); m.close(); toast('تمت الاستعادة بنجاح'); draw(); } catch (er) { e.target.disabled = false; toast(er.message, 'err'); } });
}
async function typedConfirm(title, message, word, ok) {
  let go = false; await formModal({ title, size: 'sm', intro: html`<div style="line-height:1.8;margin-bottom:8px">${message}</div>`, fields: [{ name: 'c', label: `اكتب كلمة "${word}" للتأكيد`, autofocus: true, span: 2 }], submit: ok, onSubmit: async v => { if (v.c.trim() !== word) throw new Error('كلمة التأكيد غير مطابقة'); go = true; } }).done;
  return go;
}

// ---------- الخادم ----------
async function serverTab() {
  const Y = S_().sync, ok = sync.configured();
  return html`${card('النسخ الاحتياطي السحابي', html`<div class="note-box ${Y.enabled && ok ? '' : 'warn'}">${icon(Y.enabled && ok ? 'cloud' : 'info', 16)} ${Y.enabled && ok ? 'الخادم مضبوط. ' + (Y.lastPush ? 'آخر رفع: ' + fmtDateTime(Y.lastPush) : 'لم تُرفع نسخة بعد.') : html`<b>غير مفعّل.</b> التطبيق يعمل بالكامل محلياً على هذا الجهاز. لا تُرسل أي بيانات لأي جهة ما لم تُشغّل الخادم وتُدخل عنوانه ومفتاحه هنا.`}</div>
    <div style="margin-top:12px">${row('تفعيل الرفع التلقائي', sw('sync.enabled'), 'يرفع نسخة كاملة للخادم عند فتح التطبيق بحسب فاصل اللقطات')}${row('عنوان الخادم', tx('sync.url', { dir: 'ltr', ph: 'https://example.com:8787' }))}${row('مفتاح الوصول', html`<input class="inp" type="password" data-set="sync.key" data-t="text" value="${Y.key || ''}" dir="ltr" autocomplete="off" placeholder="يظهر في شاشة تشغيل الخادم">`, 'يُحفظ في هذا الجهاز فقط ولا يدخل في ملفات النسخ')}</div>
    <div class="row wrap" style="margin-top:12px"><button class="btn" data-sync-test ${ok ? '' : raw('disabled')}>${icon('refresh', 16)} اختبار الاتصال</button><button class="btn primary" data-sync-push ${ok ? '' : raw('disabled')}>${icon('upload', 16)} رفع نسخة الآن</button><button class="btn" data-sync-list ${ok ? '' : raw('disabled')}>${icon('download', 16)} النسخ على الخادم / استعادة</button></div>`, 'رفع نسخة كاملة إلى خادم تملكه أنت (server/server.mjs)')}
    ${card('ما الذي يوفّره وما الذي لا يوفّره', html`<div class="small" style="line-height:2"><b class="ok">يوفّره:</b> نسخة احتياطية خارج الجهاز تُرفع وتُستعاد بنقرة، مع التحقق من سلامة الملف قبل أي استعادة.<br><b class="warn">لا يوفّره:</b> مزامنة لحظية بين عدة أجهزة أو فروع، ولا صلاحيات مفروضة من الخادم. هذه تحتاج قاعدة بيانات مركزية وتطويراً إضافياً (موضّح في README).<br>خطوات تشغيل الخادم مشروحة في README (قسم «الخادم»): <span class="num" dir="ltr">node server/server.mjs</span></div>`)}`;
}
async function syncList() {
  let items; try { items = await sync.listRemote(); } catch (e) { return toast(e.message, 'err'); }
  const m = modal({ title: 'النسخ المحفوظة على الخادم', body: items.length ? html`<div class="col" style="gap:0">${items.map(i => html`<div class="list-item"><div class="grow"><b class="num">${fmtDateTime(i.t)}</b><div class="small muted">${fmtBytes(i.size)}${i.counts ? ` · ${i.counts.products ?? 0} منتج · ${i.counts.invoices ?? 0} فاتورة` : ''}</div></div><button class="btn sm" data-rs="${esc(i.id)}">استعادة</button><button class="btn sm icon ghost" data-rd="${esc(i.id)}">${icon('trash', 14)}</button></div>`)}</div>` : emptyState('cloud', 'لا توجد نسخ على الخادم') });
  m.el.addEventListener('click', async e => {
    const rs = e.target.closest('[data-rs]'), rd = e.target.closest('[data-rd]');
    try {
      if (rs) { const { obj, check } = await sync.pullBackup(rs.dataset.rs); if (!(await confirmBox({ title: 'استعادة من الخادم', message: html`استبدال بياناتك الحالية بنسخة تحوي <b>${check.counts.products ?? 0}</b> منتج و<b>${check.counts.invoices ?? 0}</b> فاتورة؟ تُؤخذ لقطة أمان أولاً.`, danger: true, ok: 'استعادة' }))) return; await bk.restoreBackup(obj); m.close(); toast('تمت الاستعادة'); draw(); }
      if (rd && await confirmBox({ title: 'حذف النسخة', message: 'حذف هذه النسخة من الخادم نهائياً؟', danger: true, ok: 'حذف' })) { await sync.deleteRemote(rd.dataset.rd); m.close(); syncList(); }
    } catch (er) { toast(er.message, 'err'); }
  });
}

// ---------- النظام ----------
async function systemTab() {
  const demo = isDemo(), u = await db.usage(), reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null), legacy = await db.get('meta', 'legacy_localstorage').catch(() => null);
  const counts = [['products', 'المنتجات'], ['categories', 'التصنيفات'], ['customers', 'الزبائن'], ['suppliers', 'الموردون'], ['invoices', 'الفواتير'], ['returns', 'المرتجعات'], ['purchases', 'فواتير الشراء'], ['expenses', 'المصروفات'], ['moves', 'حركات المخزون'], ['audit', 'سجل العمليات']];
  return html`${card('معلومات النظام', html`${kv('الإصدار', html`<span class="num">${APP_VERSION}</span>`)}${kv('إصدار بنية البيانات', html`<span class="num">${SCHEMA_VERSION}</span>`)}${kv('قاعدة البيانات', html`<span class="num" dir="ltr">${db.dbName()}</span> ${demo ? badge('تجريبية', 'warn') : badge('حقيقية', 'ok')}`)}${kv('الاتصال بالإنترنت', navigator.onLine ? 'متصل' : 'دون اتصال')}${kv('العمل دون إنترنت (Service Worker)', reg ? badge(reg.active ? 'مفعّل' : 'قيد التفعيل', 'ok') : badge('غير مفعّل (يحتاج https أو localhost)', 'warn'))}${u ? kv('مساحة التخزين', html`<span class="num">${fmtBytes(u.usage || 0)}</span>`) : ''}
    <div class="grid g4 keep" style="margin-top:12px">${counts.map(([k, l]) => html`<div class="card flat center" style="padding:10px"><div class="muted small">${l}</div><b class="num" style="font-size:1.2rem">${fmt(store.count(k))}</b></div>`)}</div>
    <div class="row wrap" style="margin-top:12px"><button class="btn" data-update>${icon('refresh', 16)} التحقق من وجود تحديث</button><button class="btn" data-clear-cache>مسح كاش التطبيق وإعادة التحميل</button>${window.__kpInstall ? html`<button class="btn primary" data-install>${icon('download', 16)} تثبيت التطبيق على الجهاز</button>` : ''}</div>
    <div class="small muted" style="margin-top:6px">مسح الكاش لا يمسّ بياناتك (المنتجات والفواتير) — يعيد تنزيل ملفات التطبيق فقط. للتثبيت على الآيفون: مشاركة ← إضافة إلى الشاشة الرئيسية.</div>`)}
    ${card('وضع التجربة (Demo)', html`<div class="small muted" style="line-height:1.9;margin-bottom:10px">وضع التجربة يفتح <b>قاعدة بيانات منفصلة تماماً</b> مليئة ببيانات وهمية (منتجات وفواتير وموردون) لتتعرّف على النظام دون أن تمسّ بياناتك الحقيقية. شريط برتقالي ظاهر طوال الوقت يذكّرك بأنك في وضع التجربة.</div>
      <div class="row wrap">${demo ? html`<button class="btn primary" data-demo-exit>الخروج من وضع التجربة والعودة لبياناتي</button><button class="btn danger" data-demo-reset>إعادة ضبط بيانات التجربة</button>` : html`<button class="btn" data-demo-enter>${icon('play', 16)} الدخول إلى وضع التجربة</button>`}</div>`)}
    ${legacy ? card('بيانات النسخة القديمة', html`<div class="small muted" style="line-height:1.9">رُحّلت بياناتك من التطبيق القديم بتاريخ <b>${fmtDateTime(legacy.v.savedAt)}</b>. نسخة خام منها محفوظة كما هي (لم تُحذف من المتصفح) للأمان.</div><div class="row" style="margin-top:10px"><button class="btn" data-legacy-dl>${icon('download', 16)} تنزيل نسخة البيانات القديمة (بصيغة التطبيق القديم)</button></div>`) : ''}`;
}

// ---------- الإطار ----------
async function draw() {
  const my = ++token; if (!root) return;
  const tb = TABS.filter(t => can(t[2]) && !(t[0] === 'server' && db.isRemote())); if (!tb.length) { root.innerHTML = emptyState('lock', 'ليست لديك صلاحية').toString(); return; }
  if (!tb.some(t => t[0] === st.tab)) st.tab = tb[0][0];
  const fn = { store: storeTab, invoice: invoiceTab, tax: taxTab, pos: posTab, look: lookTab, backup: backupTab, cloud: cloudSettings.cloudTab, shop: () => shopSettings.shopTab({ row, tx, sw, card, getp }), server: serverTab, system: systemTab }[st.tab];
  const body = await fn(); if (my !== token || !root) return;
  const y = window.scrollY, ae = document.activeElement?.dataset?.set;
  root.innerHTML = html`${pageHead('الإعدادات', '', 'تُحفظ التغييرات تلقائياً فور تعديلها')}${tabs(tb.map(t => [t[0], t[1]]), st.tab)}<div class="set-body">${body}</div>`.toString();
  window.scrollTo(0, y); if (ae) root.querySelector(`[data-set="${ae}"]`)?.focus();
}

async function applySet(el) {
  const path = el.dataset.set, t = el.dataset.t; let v;
  if (t === 'bool') v = el.checked; else if (t === 'bit') v = el.checked ? 1 : 0; else if (t === 'sbool') v = el.value === '1';
  else if (t === 'num') {
    v = num(el.value); const lo = el.dataset.min, hi = el.dataset.max;
    if (!isFinite(v) || (lo !== '' && lo != null && v < +lo) || (hi !== '' && hi != null && v > +hi)) { toast(`أدخل رقماً${lo !== '' && hi !== '' && lo != null && hi != null ? ` بين ${lo} و${hi}` : ' صحيحاً'}`, 'err'); return draw(); }
    if (/pad|copies|itemLen|valLen|expiryDays/.test(path)) v = Math.round(v);
  } else v = String(el.value).trim();
  try {
    if (path === 'sync.url') v = v.replace(/\/+$/, '');
    await ops.saveSettings(patchOf(path, v)); toast('تم الحفظ', 'ok', 1100);
    if (/^invoice\.|^tax\.|^pos\.scale|^sync\./.test(path)) await draw(); // معاينات وأمثلة تعتمد على القيم
    ops.logAudit('settings.save', 'settings', path, `${path} = ${path === 'sync.key' ? '••••' : String(v).slice(0, 60)}`).catch(() => { });
  } catch (e) { toast(e.message, 'err'); draw(); }
}

let bound = new WeakSet();
export default {
  async render(view, ctx) {
    root = view; const want = ctx?.params?.get?.('tab'); if (want) st.tab = want;
    await draw(); if (bound.has(view)) return; bound.add(view);
    view.addEventListener('change', e => { if (e.target.dataset?.set) applySet(e.target); });
    view.addEventListener('click', async e => {
      const T = e.target; const q = s => T.closest(s);
      try {
        const tb = q('[data-tab]'); if (tb) { st.tab = tb.dataset.tab; return void draw(); }
        if (q('[data-open-display]')) return void import('../ui/display-ui.js').then(x => x.openDisplayPrefs());
        if (await cloudSettings.click(q, { draw })) return;
        if (await shopSettings.click(q, { draw })) return;
        if (q('[data-logo]')) { const img = await pickImage({ max: 256, quality: 0.85 }); if (img) { await ops.saveSettings({ logo: img }); toast('تم حفظ الشعار'); draw(); } return; }
        if (q('[data-logo-del]')) { await ops.saveSettings({ logo: null }); draw(); return; }
        if (q('[data-test-print]')) return printHTML(invoiceHTML(sampleInvoice(), S_().invoice.paper), S_().invoice.paper);
        if (q('[data-export]')) { const c = await bk.exportBackupFile(); await ops.logAudit('backup.export', 'backup', '', `${c.products ?? 0} منتج، ${c.invoices ?? 0} فاتورة`); toast('تم تصدير النسخة الاحتياطية'); return void draw(); }
        if (q('[data-import]')) return void await importFlow();
        if (q('[data-snap]')) { await bk.snapshot('يدوية'); toast('تم إنشاء لقطة'); return void draw(); }
        const sr = q('[data-snap-restore]'); if (sr) { if (await confirmBox({ title: 'استعادة لقطة', message: 'استبدال بياناتك الحالية بهذه اللقطة؟ تُؤخذ لقطة أمان قبل ذلك.', danger: true, ok: 'استعادة' })) { await bk.restoreSnapshot(sr.dataset.snapRestore); await ops.logAudit('backup.restore', 'backup', '', 'استعادة لقطة داخلية'); toast('تمت الاستعادة'); draw(); } return; }
        const sd = q('[data-snap-dl]'); if (sd) return void await bk.downloadSnapshot(sd.dataset.snapDl);
        const sx = q('[data-snap-del]'); if (sx) { if (await confirmBox({ title: 'حذف اللقطة', message: 'حذف هذه اللقطة؟', danger: true, ok: 'حذف' })) { await bk.deleteSnapshot(sx.dataset.snapDel); draw(); } return; }
        if (q('[data-persist]')) { const ok = await db.persist(); toast(ok ? 'تم تفعيل التخزين الدائم' : 'لم يمنح المتصفح التخزين الدائم (جرّب تثبيت التطبيق)', ok ? 'ok' : 'warn'); return void draw(); }
        if (q('[data-clear]')) { if (await typedConfirm('مسح سجل المبيعات', html`سيُحذف سجل الفواتير والمرتجعات والدفعات وحركات المخزون والورديات. <b>المنتجات والزبائن والموردون والمشتريات تبقى</b> (وأرصدة المخزون الحالية كما هي).`, 'مسح', 'مسح السجل')) { await bk.clearSalesHistory(); toast('تم مسح سجل المبيعات (لقطة الأمان محفوظة)'); draw(); } return; }
        if (q('[data-reset]')) { if (await typedConfirm('مسح كل البيانات', html`سيُحذف <b>كل شيء</b>: المنتجات والفواتير والزبائن والموردون والموظفون. تبقى إعدادات المتجر الأساسية فقط.`, 'مسح', 'مسح كل البيانات')) { await bk.resetAllData(); toast('تم مسح كل البيانات (لقطة الأمان محفوظة)'); draw(); } return; }
        if (q('[data-sync-test]')) { const h = await sync.testConnection(); toast('الاتصال ناجح' + (h.version ? ' — إصدار الخادم ' + h.version : ''), 'ok'); return; }
        if (q('[data-sync-push]')) { const r = await sync.pushBackup(); toast(`تم رفع النسخة (${r.counts.products ?? 0} منتج، ${r.counts.invoices ?? 0} فاتورة)`); return void draw(); }
        if (q('[data-sync-list]')) return void await syncList();
        if (q('[data-update]')) { const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) return toast('التحديث التلقائي يحتاج تشغيل التطبيق عبر https أو localhost', 'warn'); await reg.update(); toast('تم التحقق — إن وُجد تحديث فسيُطبَّق تلقائياً'); return; }
        if (q('[data-clear-cache]')) { if (await confirmBox({ title: 'مسح كاش التطبيق', message: 'سيُعاد تنزيل ملفات التطبيق. بياناتك لا تتأثر. متابعة؟', ok: 'متابعة' })) { for (const k of await caches.keys()) await caches.delete(k); const r = await navigator.serviceWorker?.getRegistration(); await r?.unregister(); location.reload(); } return; }
        if (q('[data-install]')) { const ev = window.__kpInstall; if (ev) { ev.prompt(); await ev.userChoice; window.__kpInstall = null; draw(); } return; }
        if (q('[data-demo-enter]')) { if (await confirmBox({ title: 'وضع التجربة', message: 'سيُفتح التطبيق على بيانات وهمية منفصلة تماماً. بياناتك الحقيقية لا تُمسّ وتعود إليها بزر الخروج. متابعة؟', ok: 'دخول' })) enterDemo(); return; }
        if (q('[data-demo-exit]')) return exitDemo();
        if (q('[data-demo-reset]')) { if (await confirmBox({ title: 'إعادة ضبط التجربة', message: 'حذف بيانات التجربة وتوليد بيانات جديدة؟ (لا علاقة لذلك ببياناتك الحقيقية)', danger: true, ok: 'إعادة ضبط' })) resetDemo(); return; }
        if (q('[data-legacy-dl]')) { const l = await db.get('meta', 'legacy_localstorage'), r = l?.v?.raw || {}; const j = k => { try { return JSON.parse(r[k] || 'null'); } catch { return null; } }; download('shop-backup-legacy.json', JSON.stringify({ P: j('sh_p') || [], H: j('sh_s') || [], T: j('sh_t') || {} }), 'application/json'); return; }
      } catch (er) { console.error(er); toast(er.message || 'حدث خطأ', 'err'); }
    });
  },
  onChange(names) { if (!root || !names.has('meta') && !names.has('backups')) return; if (root.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; draw(); },
  destroy() { root = null; token++; },
};
