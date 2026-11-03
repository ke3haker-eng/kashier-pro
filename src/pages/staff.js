// الموظفون: الحسابات والأدوار، مصفوفة الصلاحيات، الورديات (نقدية الدرج المتوقعة مقابل الفعلية)، وسجل العمليات.
// تنبيه صريح: تسجيل الدخول هنا قفل تشغيلي على نفس الجهاز، وليس حماية قوية ضد من يملك الجهاز (انظر README).
import * as store from '../core/store.js';
import * as ops from '../core/ops.js';
import * as auth from '../core/auth.js';
import { PERMS, ROLES, DEFAULT_ROLE_PERMS, rolePerms } from '../core/perms.js';
import { shiftSummary } from '../core/analytics.js';
import { html, raw, icon, money, toast, formModal, confirmBox, pageHead, table, paginate, pager, badge, emptyState, statCard, tabs, avatar, kv, mny } from '../ui/components.js';
import { openShiftDialog, closeShiftDialog, printShiftReport, myShift } from '../ui/shift.js';
import { fmtDateTime, fmt, todayKey, addDays, norm, debounce, sortBy, r2, sum, latinDigits, dayKey, groupBy } from '../core/util.js';
import { exportTable, exportBar } from '../lib/export.js';

const can = p => auth.can(p);
const st = { tab: '', page: 1, day: '', aq: '', aUser: '', aKind: '', aFrom: '', aTo: '', sFrom: '', sTo: '', sUser: '', sStatus: '' };
let root;

export const ACTION_LABEL = {
  'sale.create': 'فاتورة بيع', 'invoice.void': 'إلغاء فاتورة', 'invoice.delete': 'حذف فاتورة', 'return.create': 'مرتجع',
  'product.create': 'منتج جديد', 'product.update': 'تعديل منتج', 'product.delete': 'حذف منتج', 'product.archive': 'أرشفة منتج', 'product.restore': 'استرجاع منتج', 'product.import': 'استيراد منتجات',
  'category.save': 'حفظ تصنيف', 'category.delete': 'حذف تصنيف', 'offer.save': 'حفظ عرض', 'offer.delete': 'حذف عرض',
  'stock.adjust': 'تعديل مخزون', 'stock.count': 'جرد مخزون',
  'purchase.draft': 'مسودة شراء', 'purchase.approve': 'اعتماد فاتورة شراء', 'purchase.delete': 'حذف مسودة شراء',
  'supplier.save': 'حفظ مورد', 'supplier.pay': 'دفعة لمورد', 'supplier.delete': 'حذف مورد',
  'customer.save': 'حفظ زبون', 'customer.pay': 'تحصيل من زبون', 'customer.delete': 'حذف زبون',
  'expense.save': 'حفظ مصروف', 'expense.delete': 'حذف مصروف',
  'shift.open': 'فتح وردية', 'shift.close': 'إغلاق وردية',
  'user.save': 'حفظ موظف', 'user.delete': 'حذف موظف', 'auth.enable': 'تفعيل تسجيل الدخول', 'auth.disable': 'إيقاف تسجيل الدخول', 'roles.save': 'تعديل الصلاحيات',
  'settings.save': 'تعديل الإعدادات', 'backup.export': 'تصدير نسخة احتياطية', 'backup.restore': 'استعادة نسخة', 'backup.clear': 'مسح سجل المبيعات', 'backup.reset': 'مسح كل البيانات',
};
const KIND = { sale: 'sales', invoice: 'sales', return: 'sales', product: 'products', category: 'products', offer: 'products', stock: 'stock', purchase: 'purch', supplier: 'purch', customer: 'cust', expense: 'exp', shift: 'shift', user: 'sys', auth: 'sys', roles: 'sys', settings: 'sys', backup: 'sys' };
const KIND_LABEL = { sales: 'المبيعات والفواتير', products: 'المنتجات', stock: 'المخزون', purch: 'المشتريات والموردون', cust: 'الزبائن', exp: 'المصروفات', shift: 'الورديات', sys: 'النظام والموظفون' };
const kindOf = a => KIND[String(a).split('.')[0]] || 'sys';

const availTabs = () => [
  can('users.manage') && ['users', 'الموظفون', store.count('users')],
  can('users.manage') && ['roles', 'الصلاحيات'],
  (can('shift.manage') || can('users.manage') || can('reports.view')) && ['shifts', 'الورديات'],
  (can('audit.view') || can('users.manage')) && ['audit', 'سجل العمليات'],
].filter(Boolean);

// ---------- الموظفون ----------
function userForm(id) {
  const u = id ? store.get('users', id) : null;
  const first = store.count('users') === 0;
  return formModal({
    title: id ? 'تعديل موظف' : 'موظف جديد', size: 'sm',
    intro: first ? html`<div class="note-box">ابدأ بإضافة <b>مدير</b> (حسابك) أولاً، ثم باقي الموظفين، ثم فعّل تسجيل الدخول.</div>` : '',
    fields: [
      { name: 'name', label: 'الاسم', required: true, autofocus: true, span: 2 },
      { name: 'role', label: 'الدور', type: 'select', options: Object.entries(ROLES), span: 2 },
      { name: 'pin', label: id ? 'رقم سري جديد (اتركه فارغاً بلا تغيير)' : 'الرقم السري (4 إلى 8 أرقام)', type: 'password', required: !id, attrs: 'inputmode="numeric" maxlength="8" autocomplete="new-password"', span: 2 },
      { name: 'active', label: 'الحساب فعّال', type: 'checkbox', span: 2 },
    ],
    values: { name: u?.name || '', role: u?.role || (first ? 'manager' : 'cashier'), active: u ? u.active !== false : true, pin: '' },
    onSubmit: async v => { await ops.saveUser({ id, name: v.name, role: v.role, pin: latinDigits(v.pin || ''), active: v.active }); toast(id ? 'تم حفظ التعديلات' : 'تمت إضافة الموظف'); },
  }).done;
}

async function enableLogin() {
  const mgrs = store.list('users').filter(u => u.active !== false && u.role === 'manager');
  if (!mgrs.length) return toast('أضف مديراً فعّالاً بالرقم السري أولاً', 'warn');
  await formModal({
    title: 'تفعيل تسجيل الدخول', size: 'sm',
    intro: html`<div class="note-box">لتجنّب إقفال النظام على نفسك، أدخل الرقم السري لأحد المديرين الآن. سيُطلب تسجيل الدخول بعد التفعيل.</div>`,
    fields: [{ name: 'uid', label: 'المدير', type: 'select', options: mgrs.map(u => [u.id, u.name]), span: 2 }, { name: 'pin', label: 'الرقم السري', type: 'password', required: true, attrs: 'inputmode="numeric" maxlength="8" autocomplete="off"', autofocus: true, span: 2 }],
    submit: 'تفعيل',
    onSubmit: async v => {
      const u = store.get('users', v.uid), pin = latinDigits(v.pin);
      if (!(await auth.verifyPin(u, pin))) throw new Error('الرقم السري غير صحيح');
      await ops.logAudit('auth.enable', 'settings', '', 'تفعيل تسجيل الدخول بواسطة ' + u.name);
      await ops.saveSettings({ auth: { enabled: true } });
      await auth.login(u.id, pin); toast('تم تفعيل تسجيل الدخول');
    },
  }).done;
}
async function disableLogin() {
  if (!(await confirmBox({ title: 'إيقاف تسجيل الدخول', message: 'سيصبح التطبيق مفتوحاً بدون رقم سري وكل من يستخدم الجهاز يعمل كمدير. الحسابات والبيانات تبقى كما هي.', ok: 'إيقاف', danger: true }))) return;
  await ops.logAudit('auth.disable', 'settings', '', 'إيقاف تسجيل الدخول');
  await ops.saveSettings({ auth: { enabled: false } }); auth.logout(); toast('تم إيقاف تسجيل الدخول');
}

function usersTab() {
  const A = store.settings().auth, cu = auth.current();
  const users = sortBy(store.list('users'), u => u.name);
  const sales = groupBy(store.list('invoices').filter(i => i.status !== 'void'), i => i.userId);
  const openShifts = new Set(store.list('shifts').filter(s => s.status === 'open').map(s => s.userId));
  const login = html`<div class="card mb"><div class="row between wrap"><div class="row gap14"><span class="${A.enabled ? 'ok' : 'warn'}">${icon('lock', 30)}</span><div><h3 style="margin:0">تسجيل الدخول بالرقم السري ${badge(A.enabled ? 'مفعّل' : 'معطّل', A.enabled ? 'ok' : 'warn')}</h3><div class="muted small" style="margin-top:2px">${A.enabled ? 'يُطلب الرقم السري عند فتح التطبيق، وتُطبَّق صلاحيات كل دور.' : 'الوضع الحالي: بدون تسجيل دخول، وكل من يفتح التطبيق يعمل كمدير.'}</div></div></div>
    <div class="row wrap">${A.enabled ? html`<label class="row gap6 small">قفل تلقائي بعد <select class="inp" id="lockMin" style="width:auto;min-height:38px">${[[0, 'بدون'], [2, '2 دقيقة'], [5, '5 دقائق'], [10, '10 دقائق'], [15, '15 دقيقة'], [30, '30 دقيقة']].map(([v, l]) => html`<option value="${v}" ${+A.lockMin === v ? raw('selected') : ''}>${l}</option>`)}</select></label><button class="btn danger" data-disable>إيقاف تسجيل الدخول</button>` : html`<button class="btn primary" data-enable ${users.some(u => u.active !== false && u.role === 'manager') ? '' : raw('disabled title="أضف مديراً أولاً"')}>${icon('lock', 18)} تفعيل تسجيل الدخول</button>`}</div></div>
    <div class="note-box" style="margin-top:12px">${icon('alert', 16)} هذا قفل تشغيلي لتنظيم العمل بين الموظفين على نفس الجهاز، وليس حماية مشفّرة ضد من يملك الجهاز نفسه. الأرقام السرية مخزَّنة مُشفَّرة (PBKDF2) ولا تُحفظ نصاً. الصلاحيات المفروضة من الخادم تحتاج تفعيل الخادم المركزي (مشروحة في README).</div></div>`;
  const tbl = table({
    cols: [
      { key: 'n', label: 'الموظف', render: u => html`<div class="row gap6">${avatar(u.name, 38)}<div><b>${u.name}</b> ${cu?.id === u.id ? badge('أنت', 'info') : ''}<div class="small muted">أُنشئ ${u.createdAt ? fmtDateTime(u.createdAt) : ''}</div></div></div>` },
      { key: 'r', label: 'الدور', render: u => badge(ROLES[u.role] || u.role, u.role === 'manager' ? 'p' : '') },
      { key: 's', label: 'الحالة', render: u => html`${u.active === false ? badge('معطّل', 'bad') : badge('فعّال', 'ok')} ${openShifts.has(u.id) ? badge('وردية مفتوحة', 'info') : ''}` },
      { key: 'i', label: 'الفواتير', align: 'center', render: u => html`<span class="num">${(sales.get(u.id) || []).length}</span>` },
      { key: 't', label: 'إجمالي المبيعات', align: 'end', render: u => mny(r2(sum(sales.get(u.id) || [], i => i.total))) },
      { key: 'x', label: '', cls: 'nolabel', align: 'end', render: u => html`<div class="row gap4" style="justify-content:flex-end"><button class="btn sm icon ghost" data-ed="${u.id}" title="تعديل / تغيير الرقم السري">${icon('edit', 14)}</button><button class="btn sm icon ghost" data-del="${u.id}" title="حذف" ${cu?.id === u.id ? raw('disabled') : ''}>${icon('trash', 14)}</button></div>` },
    ], rows: users, empty: 'لا يوجد موظفون بعد. أضف المدير أولاً.',
  });
  return html`${login}<div class="card" style="padding:8px"><div class="card-h" style="padding:8px 8px 0"><h3>الحسابات</h3><button class="btn primary sm" data-new>${icon('plus', 16)} موظف جديد</button></div>${tbl}</div>`;
}

// ---------- الصلاحيات ----------
function rolesTab() {
  const S = store.settings(), groups = [...new Set(PERMS.map(p => p[2]))], rs = Object.keys(ROLES);
  const body = groups.map(g => html`<tr class="grp"><td colspan="${rs.length + 1}"><b>${g}</b></td></tr>${PERMS.filter(p => p[2] === g).map(([k, l]) => html`<tr><td>${l}</td>${rs.map(r => html`<td class="center"><input type="checkbox" class="pchk" data-rp="${r}|${k}" aria-label="${ROLES[r]}: ${l}" ${rolePerms(r, S.roles).includes(k) ? raw('checked') : ''} ${r === 'manager' ? raw('disabled') : ''}></td>`)}</tr>`)}`);
  return html`<div class="card"><div class="card-h"><div><h3>مصفوفة الصلاحيات</h3><div class="muted small">المدير يملك كل الصلاحيات دائماً ولا يمكن تقييده. عدّل الأدوار الأخرى ثم اضغط حفظ. التعديل يسري فوراً.</div></div><div class="row"><button class="btn" data-reset-roles>الإعدادات الافتراضية</button><button class="btn primary" data-save-roles>${icon('check', 16)} حفظ الصلاحيات</button></div></div>
    <div class="tbl-wrap"><table class="tbl perm-tbl"><thead><tr><th>الصلاحية</th>${rs.map(r => html`<th class="center">${ROLES[r]}</th>`)}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}
async function saveRoles(reset) {
  const roles = {};
  for (const r of ['cashier', 'stock', 'accountant']) roles[r] = reset ? [...DEFAULT_ROLE_PERMS[r]] : [...root.querySelectorAll(`[data-rp^="${r}|"]:checked`)].map(i => i.dataset.rp.split('|')[1]);
  const cu = auth.current();
  if (auth.enabled() && cu && cu.role !== 'manager' && !(roles[cu.role] || []).includes('users.manage')) { if (!(await confirmBox({ title: 'تنبيه', message: 'ستفقد صلاحية إدارة الموظفين لدورك الحالي وقد لا تستطيع العودة لهذه الصفحة. متابعة؟', danger: true }))) return; }
  await ops.saveSettings({ roles }); await ops.logAudit('roles.save', 'settings', '', reset ? 'استرجاع الصلاحيات الافتراضية' : 'تعديل مصفوفة الصلاحيات');
  toast(reset ? 'تم استرجاع الصلاحيات الافتراضية' : 'تم حفظ الصلاحيات');
}

// ---------- الورديات ----------
const sumOf = s => (s.status === 'closed' && s.summary) ? s.summary : shiftSummary(s);
function shiftRows() {
  const seeAll = can('users.manage') || can('reports.view'), me = auth.current()?.id;
  return sortBy(store.list('shifts').filter(s => (seeAll || s.userId === me) && (!st.sUser || s.userId === st.sUser) && (!st.sStatus || s.status === st.sStatus) && (!st.sFrom || dayKey(s.openedAt) >= st.sFrom) && (!st.sTo || dayKey(s.openedAt) <= st.sTo)), s => s.openedAt, -1);
}
const shiftSpec = rows => ({ name: 'shifts', title: 'تقرير الورديات', subtitle: `${st.sFrom} → ${st.sTo}`, cols: [{ label: 'الموظف', get: s => s.userName }, { label: 'الفتح', get: s => fmtDateTime(s.openedAt) }, { label: 'الإغلاق', get: s => s.closedAt ? fmtDateTime(s.closedAt) : 'مفتوحة' }, { label: 'رصيد البداية', get: s => s.openingCash || 0, num: true }, { label: 'الفواتير', get: s => sumOf(s).salesCount, num: true }, { label: 'المبيعات', get: s => sumOf(s).salesTotal, num: true }, { label: 'المتوقع', get: s => s.status === 'closed' ? s.expected : sumOf(s).expectedCash, num: true }, { label: 'الفعلي', get: s => s.status === 'closed' ? s.counted : '', num: true }, { label: 'الفرق', get: s => s.status === 'closed' ? s.diff : '', num: true }], rows });

function shiftsTab() {
  const seeAll = can('users.manage') || can('reports.view'), rows = shiftRows(), pg = paginate(rows, st.page, 20), mine = myShift(), cu = auth.current();
  const closed = rows.filter(s => s.status === 'closed'), diff = r2(sum(closed, s => s.diff)), short = closed.filter(s => s.diff < 0).length;
  const mineCard = can('shift.manage') ? (mine ? (() => { const s = shiftSummary(mine); return html`<div class="card mb"><div class="card-h"><h3>${badge('وردية مفتوحة', 'info')} ${mine.userName}</h3><div class="row"><button class="btn" data-sh-report="${mine.id}">${icon('print', 16)} تقرير</button><button class="btn danger" data-sh-close="${mine.id}">إغلاق الوردية</button></div></div><div class="grid g4 keep">${[['بدأت', fmtDateTime(mine.openedAt)], ['رصيد البداية', money(mine.openingCash || 0)], ['المبيعات (' + s.salesCount + ' فاتورة)', money(s.salesTotal)], ['النقدية المتوقعة', money(s.expectedCash)]].map(([k, v]) => html`<div>${kv(k, html`<span class="num">${v}</span>`)}</div>`)}</div></div>`; })() : html`<div class="card mb"><div class="row between wrap"><div><h3 style="margin:0">لا توجد وردية مفتوحة لك</h3><div class="muted small">افتح وردية وسجّل رصيد الدرج لتُحسب النقدية المتوقعة عند الإغلاق.</div></div><button class="btn primary" data-sh-open>${icon('plus', 16)} فتح وردية</button></div></div>`) : '';
  const users = sortBy(store.list('users'), u => u.name);
  const filters = html`<div class="toolbar"><input class="inp" type="date" id="sFrom" value="${st.sFrom}" style="width:auto"><input class="inp" type="date" id="sTo" value="${st.sTo}" style="width:auto">${seeAll ? html`<select class="inp" id="sUser" style="width:auto"><option value="">كل الموظفين</option>${users.map(u => html`<option value="${u.id}" ${st.sUser === u.id ? raw('selected') : ''}>${u.name}</option>`)}</select>` : ''}<select class="inp" id="sStatus" style="width:auto"><option value="">كل الحالات</option><option value="open" ${st.sStatus === 'open' ? raw('selected') : ''}>مفتوحة</option><option value="closed" ${st.sStatus === 'closed' ? raw('selected') : ''}>مغلقة</option></select><span class="grow"></span>${exportBar()}</div>`;
  const stats = html`<div class="grid g4 mb">${statCard({ label: 'عدد الورديات', value: rows.length, icon: 'clock', tone: 'b' })}${statCard({ label: 'إجمالي المبيعات', value: money(r2(sum(rows, s => sumOf(s).salesTotal))), icon: 'dollar', tone: 'g' })}${statCard({ label: 'صافي فروق النقدية', value: money(diff), icon: 'cash', tone: diff < 0 ? 'r' : 'y', sub: diff === 0 ? 'مطابق' : diff < 0 ? 'عجز' : 'زيادة', subKind: diff < 0 ? 'bad' : '' })}${statCard({ label: 'ورديات بها عجز', value: short, icon: 'alert', tone: short ? 'o' : 'plain' })}</div>`;
  const tbl = table({
    cols: [
      { key: 'u', label: 'الموظف', render: s => html`<b>${s.userName}</b>` },
      { key: 'o', label: 'الفتح', render: s => html`<span class="num small">${fmtDateTime(s.openedAt)}</span>` },
      { key: 'c', label: 'الإغلاق', render: s => s.status === 'open' ? badge('مفتوحة', 'info') : html`<span class="num small">${fmtDateTime(s.closedAt)}</span>` },
      { key: 'b', label: 'رصيد البداية', align: 'end', render: s => mny(s.openingCash || 0) },
      { key: 'n', label: 'الفواتير', align: 'center', render: s => html`<span class="num">${sumOf(s).salesCount}</span>` },
      { key: 't', label: 'المبيعات', align: 'end', render: s => mny(sumOf(s).salesTotal) },
      { key: 'e', label: 'المتوقع', align: 'end', render: s => mny(s.status === 'closed' ? s.expected : sumOf(s).expectedCash) },
      { key: 'a', label: 'الفعلي', align: 'end', render: s => s.status === 'closed' ? mny(s.counted) : '—' },
      { key: 'd', label: 'الفرق', align: 'end', render: s => s.status !== 'closed' ? '—' : s.diff === 0 ? badge('مطابق', 'ok') : badge((s.diff < 0 ? 'عجز ' : 'زيادة ') + fmt(Math.abs(s.diff)), s.diff < 0 ? 'bad' : 'warn') },
      { key: 'x', label: '', cls: 'nolabel', align: 'end', render: s => html`<div class="row gap4" style="justify-content:flex-end"><button class="btn sm icon ghost" data-sh-report="${s.id}" title="تقرير الوردية">${icon('print', 14)}</button>${s.status === 'open' && (s.userId === cu?.id || can('users.manage')) ? html`<button class="btn sm danger" data-sh-close="${s.id}">إغلاق</button>` : ''}</div>` },
    ], rows: pg.items, empty: 'لا توجد ورديات في هذه الفترة',
  });
  return html`${mineCard}${stats}${filters}<div class="card" style="padding:8px">${tbl}${pager(pg)}</div>`;
}

// ---------- سجل العمليات ----------
function auditRows() {
  const q = norm(st.aq);
  return store.list('audit').filter(a => (!st.aUser || a.userId === st.aUser) && (!st.aKind || kindOf(a.action) === st.aKind) && (!st.aFrom || dayKey(a.t) >= st.aFrom) && (!st.aTo || dayKey(a.t) <= st.aTo) && (!q || norm((a.detail || '') + ' ' + (a.userName || '') + ' ' + (ACTION_LABEL[a.action] || a.action) + ' ' + (a.ref || '')).includes(q))).sort((a, b) => b.t.localeCompare(a.t));
}
const auditSpec = rows => ({ name: 'audit-log', title: 'سجل العمليات', subtitle: `${st.aFrom} → ${st.aTo}`, cols: [{ label: 'الوقت', get: a => fmtDateTime(a.t) }, { label: 'الموظف', get: a => a.userName }, { label: 'العملية', get: a => ACTION_LABEL[a.action] || a.action }, { label: 'التفاصيل', get: a => a.detail }], rows });
function auditTab() {
  const rows = auditRows(), pg = paginate(rows, st.page, 30), users = sortBy(store.list('users'), u => u.name);
  const names = [...new Map([...users.map(u => [u.id, u.name]), ...store.list('audit').map(a => [a.userId, a.userName])]).entries()].filter(([id]) => id);
  return html`<div class="toolbar"><input class="inp" type="date" id="aFrom" value="${st.aFrom}" style="width:auto"><input class="inp" type="date" id="aTo" value="${st.aTo}" style="width:auto"><select class="inp" id="aUser" style="width:auto"><option value="">كل الموظفين</option>${names.map(([id, n]) => html`<option value="${id}" ${st.aUser === id ? raw('selected') : ''}>${n}</option>`)}</select><select class="inp" id="aKind" style="width:auto"><option value="">كل العمليات</option>${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}" ${st.aKind === k ? raw('selected') : ''}>${l}</option>`)}</select><div class="input-ic grow">${icon('search', 18)}<input class="inp" id="aq" placeholder="بحث في التفاصيل" value="${st.aq}" autocomplete="off"></div>${exportBar()}</div>
    <div class="card" style="padding:8px">${table({ cols: [{ key: 't', label: 'الوقت', render: a => html`<span class="num small">${fmtDateTime(a.t)}</span>` }, { key: 'u', label: 'الموظف', render: a => a.userName || '—' }, { key: 'a', label: 'العملية', render: a => badge(ACTION_LABEL[a.action] || a.action, ({ sales: 'ok', sys: 'p', stock: 'warn' })[kindOf(a.action)] || '') }, { key: 'd', label: 'التفاصيل', render: a => html`<span class="small">${a.detail || ''}</span>` }], rows: pg.items, empty: 'لا توجد عمليات مسجّلة في هذه الفترة' })}${pager(pg)}<div class="small muted" style="padding:8px">${rows.length} عملية — يُسجَّل في هذا السجل كل بيع وتعديل سعر ومخزون وإلغاء وحذف وتغيير إعدادات.</div></div>`;
}

// ---------- الإطار ----------
function draw() {
  const tb = availTabs(); if (!tb.length) { root.innerHTML = emptyState('lock', 'ليست لديك صلاحية').toString(); return; }
  if (!tb.some(t => t[0] === st.tab)) st.tab = tb[0][0];
  const body = st.tab === 'users' ? usersTab() : st.tab === 'roles' ? rolesTab() : st.tab === 'shifts' ? shiftsTab() : auditTab();
  root.innerHTML = html`${pageHead('الموظفون', '', 'الحسابات والأدوار والصلاحيات والورديات وسجل العمليات')}${tabs(tb, st.tab)}${body}`.toString();
}
function initDates() { const t = todayKey(); if (st.day === t) return; st.day = t; st.aFrom = st.sFrom = addDays(t, -29); st.aTo = st.sTo = t; }

let bound = new WeakSet();
export default {
  render(view, ctx) {
    root = view; initDates(); const want = ctx?.params?.get?.('tab'); if (want) st.tab = want; st.page = 1; draw();
    if (bound.has(view)) return; bound.add(view);
    view.addEventListener('click', async e => {
      const T = e.target; try {
        const tb = T.closest('[data-tab]'); if (tb) { st.tab = tb.dataset.tab; st.page = 1; draw(); return; }
        const pg = T.closest('[data-page]'); if (pg) { st.page = +pg.dataset.page; draw(); return; }
        const ex = T.closest('[data-exp]'); if (ex) return exportTable(st.tab === 'shifts' ? shiftSpec(shiftRows()) : auditSpec(auditRows()), ex.dataset.exp);
        if (T.closest('[data-new]')) return void await userForm(null);
        const ed = T.closest('[data-ed]'); if (ed) return void await userForm(ed.dataset.ed);
        const dl = T.closest('[data-del]'); if (dl && !dl.disabled) { const u = store.get('users', dl.dataset.del); if (await confirmBox({ title: 'حذف الموظف', message: `حذف الموظف "${u?.name}"؟ تبقى فواتيره وسجلاته السابقة كما هي. يمكنك بدلاً من ذلك تعطيل الحساب.`, danger: true, ok: 'حذف' })) { await ops.deleteUser(dl.dataset.del); toast('تم حذف الموظف'); } return; }
        if (T.closest('[data-enable]')) return void await enableLogin();
        if (T.closest('[data-disable]')) return void await disableLogin();
        if (T.closest('[data-save-roles]')) return void await saveRoles(false);
        if (T.closest('[data-reset-roles]')) { if (await confirmBox({ title: 'الإعدادات الافتراضية', message: 'استرجاع صلاحيات الكاشير ومسؤول المخزون والمحاسب إلى الوضع الافتراضي؟', ok: 'استرجاع' })) { await saveRoles(true); draw(); } return; }
        if (T.closest('[data-sh-open]')) return void await openShiftDialog();
        const sc = T.closest('[data-sh-close]'); if (sc) return void await closeShiftDialog(store.get('shifts', sc.dataset.shClose));
        const sr = T.closest('[data-sh-report]'); if (sr) return printShiftReport(store.get('shifts', sr.dataset.shReport));
      } catch (er) { toast(er.message, 'err'); }
    });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'aq') { st.aq = e.target.value; st.page = 1; const p = e.target.selectionStart; draw(); const i = root.querySelector('#aq'); i?.focus(); i?.setSelectionRange(p, p); } }, 180));
    view.addEventListener('change', async e => {
      const id = e.target.id, map = { sFrom: 'sFrom', sTo: 'sTo', sUser: 'sUser', sStatus: 'sStatus', aFrom: 'aFrom', aTo: 'aTo', aUser: 'aUser', aKind: 'aKind' };
      if (id === 'lockMin') { try { await ops.saveSettings({ auth: { lockMin: +e.target.value } }); toast('تم الحفظ'); } catch (er) { toast(er.message, 'err'); } return; }
      if (!map[id]) return; st[map[id]] = e.target.value; st.page = 1; draw();
    });
  },
  onChange(names) {
    if (!root) return; if (!['users', 'shifts', 'audit', 'meta', 'invoices'].some(n => names.has(n))) return;
    if (st.tab === 'roles' && !names.has('meta')) return; // لا نُعيد رسم مصفوفة بها تعديلات غير محفوظة
    if (['aq'].includes(document.activeElement?.id)) return; draw();
  },
  destroy() { root = null; },
};
