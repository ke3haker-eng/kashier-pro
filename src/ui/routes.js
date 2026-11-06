// تعريف الأقسام: ترتيب القائمة كما في المطلوب. كل صفحة تُحمَّل عند أول زيارة فقط (تسريع الإقلاع).
// mobile: تظهر في الشريط السفلي. الباقي يظهر ضمن "المزيد".
export const ROUTES = [
  { id: 'home', label: 'الرئيسية', icon: 'home', perm: 'reports.view', altPerm: 'pos.sell', mobile: true, load: () => import('../pages/dashboard.js') },
  { id: 'pos', label: 'نقطة البيع', icon: 'pos', perm: 'pos.sell', mobile: true, load: () => import('../pages/pos.js') },
  { id: 'products', label: 'المنتجات', icon: 'box', perm: 'products.view', mobile: true, load: () => import('../pages/products.js') },
  { id: 'inventory', label: 'المخزون', icon: 'clipboard', perm: 'inventory.view', mobile: true, load: () => import('../pages/inventory.js') },
  { id: 'purchases', label: 'المشتريات', icon: 'cart', perm: 'purchases.manage', load: () => import('../pages/purchases.js') },
  { id: 'suppliers', label: 'الموردون', icon: 'truck', perm: 'purchases.manage', load: () => import('../pages/suppliers.js') },
  { id: 'customers', label: 'الزبائن', icon: 'users', perm: 'customers.view', load: () => import('../pages/customers.js') },
  { id: 'invoices', label: 'الفواتير', icon: 'receipt', perm: 'invoices.view', load: () => import('../pages/invoices.js') },
  { id: 'orders', label: 'الطلبات والمحادثات', icon: 'chat', perm: 'pos.sell', load: () => import('../pages/orders.js') },
  { id: 'returns', label: 'المرتجعات', icon: 'undo', perm: 'returns.create', altPerm: 'invoices.view', load: () => import('../pages/returns.js') },
  { id: 'expenses', label: 'المصروفات', icon: 'wallet', perm: 'expenses.manage', load: () => import('../pages/expenses.js') },
  { id: 'reports', label: 'التقارير', icon: 'chart', perm: 'reports.view', load: () => import('../pages/reports.js') },
  { id: 'staff', label: 'الموظفون', icon: 'idcard', perm: 'users.manage', altPerm: ['shift.manage', 'audit.view'], load: () => import('../pages/staff.js') },
  { id: 'settings', label: 'الإعدادات', icon: 'gear', perm: 'settings.manage', altPerm: ['backup.manage'], load: () => import('../pages/settings.js') },
];
export const byId = id => ROUTES.find(r => r.id === id);
