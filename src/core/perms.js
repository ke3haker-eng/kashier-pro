// الأدوار والصلاحيات. المدير يملك كل الصلاحيات دائماً؛ باقي الأدوار قابلة للتعديل من الإعدادات.
export const PERMS = [
  ['pos.sell', 'البيع في نقطة البيع', 'البيع'],
  ['pos.discount', 'تطبيق خصم (ضمن الحد المسموح)', 'البيع'],
  ['pos.bigDiscount', 'تطبيق خصم يتجاوز الحد المسموح', 'البيع'],
  ['pos.credit', 'البيع الآجل (دين)', 'البيع'],
  ['shift.manage', 'فتح وإغلاق الوردية', 'البيع'],
  ['invoices.view', 'عرض الفواتير وإعادة طباعتها', 'الفواتير'],
  ['invoices.void', 'إلغاء فاتورة', 'الفواتير'],
  ['returns.create', 'تنفيذ مرتجع', 'الفواتير'],
  ['products.view', 'عرض المنتجات', 'المنتجات والمخزون'],
  ['products.edit', 'إضافة وتعديل المنتجات', 'المنتجات والمخزون'],
  ['products.delete', 'حذف المنتجات', 'المنتجات والمخزون'],
  ['products.cost', 'رؤية أسعار الشراء والأرباح', 'المنتجات والمخزون'],
  ['inventory.view', 'عرض المخزون', 'المنتجات والمخزون'],
  ['inventory.adjust', 'تعديل المخزون والجرد', 'المنتجات والمخزون'],
  ['purchases.manage', 'المشتريات والموردون', 'المشتريات'],
  ['customers.view', 'عرض الزبائن', 'الزبائن'],
  ['customers.manage', 'إدارة الزبائن وتسجيل الدفعات', 'الزبائن'],
  ['expenses.manage', 'المصروفات', 'المحاسبة'],
  ['reports.view', 'التقارير ولوحة الأرباح', 'المحاسبة'],
  ['users.manage', 'إدارة الموظفين والصلاحيات', 'النظام'],
  ['settings.manage', 'الإعدادات', 'النظام'],
  ['backup.manage', 'النسخ الاحتياطي والاستعادة', 'النظام'],
  ['audit.view', 'سجل العمليات', 'النظام'],
];
export const ALL_PERMS = PERMS.map(p => p[0]);

export const ROLES = { manager: 'المدير', cashier: 'الكاشير', stock: 'مسؤول المخزون', accountant: 'المحاسب' };

export const DEFAULT_ROLE_PERMS = {
  manager: ALL_PERMS,
  cashier: ['pos.sell', 'pos.discount', 'pos.credit', 'shift.manage', 'invoices.view', 'customers.view', 'customers.manage', 'products.view', 'inventory.view'],
  stock: ['products.view', 'products.edit', 'products.cost', 'inventory.view', 'inventory.adjust', 'purchases.manage', 'invoices.view'],
  accountant: ['invoices.view', 'products.view', 'products.cost', 'inventory.view', 'purchases.manage', 'customers.view', 'customers.manage', 'expenses.manage', 'reports.view', 'audit.view'],
};

export const rolePerms = (role, settingsRoles = {}) => role === 'manager' ? ALL_PERMS : (settingsRoles[role] || DEFAULT_ROLE_PERMS[role] || []);
export const roleHas = (role, perm, settingsRoles) => role === 'manager' || rolePerms(role, settingsRoles).includes(perm);
