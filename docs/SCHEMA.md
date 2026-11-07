# مخطط البيانات (Schema)

> التطبيق **لا يحتاج قاعدة بيانات خارجية**: كل البيانات في **IndexedDB** داخل المتصفح (قاعدة `kashier-pro`، وقاعدة منفصلة تماماً `kashier-pro-demo` لوضع التجربة).
> الخادم الاختياري (`server/server.mjs`) لا يحتوي قاعدة بيانات؛ يخزّن **ملفات نسخ احتياطية كاملة** فقط (انظر القسم الأخير).

- إصدار IndexedDB: `DB_VERSION = 1` — إصدار المخطط المنطقي `SCHEMA_VERSION = 1` (`src/core/migrate.js`).
- كل المخازن مفتاحها `id` (نصّ فريد) ما عدا `meta` فمفتاحها `k`.
- كل عملية مالية/مخزنية (بيع، مرتجع، شراء، تعديل مخزون…) تُكتب في **معاملة ذرّية واحدة** (إما تُحفظ كلها أو لا شيء)، ومعها سطر في `audit`.
- التقريب: المبالغ لأقرب 0.01، الكميات لأقرب 0.001. الأوزان تُخزَّن **بالكيلوجرام** (تُدخل في الشاشة بالجرام).
- التواريخ: `ISO 8601` (مثل `2026-11-03T09:15:00.000Z`)، وتواريخ الأيام `YYYY-MM-DD`.

## المخازن (Object Stores)

| المخزن | المحتوى | أهم الحقول |
|---|---|---|
| `meta` | إعدادات وعدّادات (مفتاح/قيمة) | `settings`, `counters` (`invoice`, `purchase`, `return`…), `schema`, `legacy_localstorage` (نسخة خام من بيانات التطبيق القديم، تبقى على الجهاز ولا تدخل في ملفات النسخ), `lastExport`, … |
| `products` | المنتجات | `name, price, cost, unit (pc/kg/…), barcode, code, stock, min, expiry, cat, supplierId, desc, img, track, active, createdAt, updatedAt` |
| `categories` | التصنيفات | `name, color` |
| `suppliers` | الموردون | `name, phone, address, notes, createdAt` (الرصيد يُحسب من فواتير الشراء والدفعات) |
| `customers` | الزبائن | `name, phone, address, notes, creditLimit, createdAt` (الدين يُحسب من الفواتير الآجلة والدفعات) |
| `invoices` | فواتير البيع | `no, t, userId/userName, shiftId, customerId/customerName, items[{pid,name,unit,qty,price,cost,disc,offer,returned,batches[]}], subtotal, offerDisc, lineDisc, invDisc, discount, taxable, tax, taxRate, taxInclusive, total, net, payments[{method,amount}], received, change, due, paid, method (cash/card/wallet/mixed/credit), status (done/void), void {t,userName,reason,cashRefund}, returnedTotal, approvedBy, note` |
| `returns` | المرتجعات | `no, t, invoiceId, invoiceNo, customerId, items[{pid,qty,price,cost,condition,restock}], refund, tax, net, debtCut, cashOut, method, restockCost, reason, note, shiftId, userName` |
| `purchases` | فواتير الشراء | `no, supplierId/supplierName, date, items[{pid,qty,cost,expiry}], subtotal, discount, total, paid, due, status (draft/approved), approvedAt` |
| `payments` | دفعات الزبائن والموردين | `kind (customer/supplier), partyId, partyName, amount, method, alloc[{ref,amount}], shiftId, t, note` |
| `expenses` | المصروفات | `date, category, amount, method, note, shiftId` |
| `moves` | سجل حركة المخزون (لا يُعدَّل) | `pid, pname, type (initial/sale/return/purchase/adjust_add/adjust_sub/count/…), qty, before, after, reason, ref, refNo, t, userName` |
| `batches` | دفعات الصلاحية (FEFO: الأقرب انتهاءً يُباع أولاً) | `pid, qty, expiry, cost, t, note` |
| `offers` | العروض | `name, pid, type (pct/fixed/bogo), value, buy, get, start, end, active, createdAt` |
| `holds` | الفواتير المعلّقة | `t, name, userId/userName, cart {lines[], invDisc, customerId, note}` |
| `users` | الموظفون | `name, role (manager/cashier/stock/accountant), active, pin` ← **تجزئة PBKDF2 + salt**، لا يُخزَّن الرقم نفسه |
| `shifts` | الورديات | `userId, userName, openedAt, openingCash, status (open/closed), closedAt, counted, expected, diff, note, summary` |
| `audit` | سجل العمليات | `t, userId, userName, action, entity, entityId, detail` |
| `counts` | محاضر الجرد | `t, userName, note, items[{pid,name,unit,system,counted,diff,costDiff}]` |
| `backups` | لقطات تلقائية داخل الجهاز (دورية عند فتح التطبيق + قبل أي استعادة أو مسح؛ يُحتفَظ بآخر 7 افتراضياً) — **لا تدخل** في ملف النسخة | `t, label, size, counts, json (نص النسخة الكاملة)` |

### الربح
- تكلفة كل صنف تُحفظ **داخل سطر الفاتورة وقت البيع** (`items[].cost`) فتبقى أرباح الماضي ثابتة ولو تغيّر سعر الشراء لاحقاً.
- الربح الإجمالي = صافي المبيعات (بعد الخصم والمرتجعات وبدون الضريبة) − تكلفة البضاعة المباعة (بتكلفة وقت البيع، وتُستبعد تكلفة ما رُدّ للمخزون). **صافي الربح = الربح الإجمالي − المصروفات**.
- الفواتير المرحَّلة من التطبيق القديم لها علامة `legacy` وبلا تكلفة (لأن القديم لم يسجّلها) فلا تدخل في حساب الربح بقيمة وهمية.

## الترحيل من التطبيق القديم

مفاتيح `localStorage` القديمة: `sh_p` (منتجات) · `sh_c` (سلة) · `sh_s` (سجل المبيعات) · `sh_t` (إعدادات).
عند أول فتح، `src/core/migrate.js`:
1. يحفظ نسخة خام منها في `meta.legacy_localstorage`.
2. يحوّل المنتجات (يرفض المكرر من الباركود دون فقدان بقية الأصناف) والمبيعات القديمة والإعدادات والسلة.
3. **لا يحذف المفاتيح القديمة أبداً** (للرجوع). ولا يرحّل مرتين.

ملفات النسخ الاحتياطية القديمة بصيغة `{P, H, T}` تُقبل أيضاً من الإعدادات ← النسخ الاحتياطي ← استيراد.

## صيغة ملف النسخة الاحتياطية (`kashier-backup-YYYY-MM-DD.json`)

```json
{
  "app": "kashier-pro",
  "format": 1,
  "schema": 1,
  "exportedAt": "2026-11-03T09:15:00.000Z",
  "counts": { "products": 120, "invoices": 842, "...": 0 },
  "checksum": "<SHA-256 لمحتوى data>",
  "data": { "meta": [], "products": [], "categories": [], "...": [] }
}
```
- عند الاستيراد يُتحقق من: اسم التطبيق، الإصدار، البصمة (`checksum`)، وبنية كل مخزن. الملف المعدَّل يدوياً أو التالف **يُرفض قبل لمس أي بيانات**.
- قبل أي استعادة أو مسح تُحفظ **لقطة أمان تلقائية** يمكن الرجوع إليها (وتُنشأ لقطات دورية عند فتح التطبيق أيضاً).
- **مفتاح الخادم (`settings.sync.key`) لا يُكتب في ملفات النسخ**، ولا يُستبدل عند الاستعادة (إعدادات الاتصال تخص الجهاز).

## تخزين الخادم الاختياري

```
data/
  key.txt                       مفتاح الوصول (يُولَّد تلقائياً إن لم تضبط KASHIER_KEY) — صلاحية 600
  backups/
    20261103091500-a1b2c3.json         نسخة كاملة كما رُفعت (نفس صيغة الملف أعلاه)
    20261103091500-a1b2c3.meta.json    { id, t, size, exportedAt, counts }
```
| الطلب | الوصف |
|---|---|
| `GET /api/health` | بلا مفتاح — فحص التشغيل |
| `GET /api/backups` | قائمة النسخ (الأحدث أولاً) |
| `POST /api/backups` | رفع نسخة (يُرفض ما ليس `app: "kashier-pro"`) |
| `GET /api/backups/<id أو latest>` | تنزيل نسخة |
| `DELETE /api/backups/<id>` | حذف نسخة |

كل ما عدا `health` يتطلب الترويسة `Authorization: Bearer <المفتاح>`. بعد 10 محاولات بمفتاح خاطئ يُحجب العنوان 10 دقائق. يُحتفَظ بآخر `KASHIER_KEEP` نسخة (الافتراضي 30).

> هذا **نسخ احتياطي/استعادة** لنسخة كاملة، وليس مزامنة لحظية بين أجهزة ولا قاعدة بيانات مركزية. للمزامنة اللحظية متعددة الأجهزة تحتاج خادم قاعدة بيانات حقيقياً (غير مضمَّن) — انظر README.

## جداول المتجر الإلكتروني (Supabase فقط)

تُنشأ مع `supabase/schema.sql` ولا علاقة لها بـ IndexedDB. كلها مقفلة بالكامل (RLS بلا سياسات + سحب الصلاحيات)؛ الوصول عبر دوال `kp_*` فقط.

| الجدول | المحتوى |
|---|---|
| `kp_shops` (أعمدة جديدة) | `slug` (رابط المتجر، فريد)، `store_on` (منشور؟)، `order_seq` (عدّاد أرقام الطلبات لكل متجر) |
| `kp_orders` | `no`, `buyer` (sha256 لمفتاح المشتري), `name, phone, address, note`, `delivery` (pickup/home), `pay` (cash/transfer), `items[{id,name,unit,qty,price,total}]`, `subtotal, fee, total` (تُحسب على الخادم), `proof` (صورة الإشعار Base64), `status` (new/confirmed/preparing/ready/done/rejected/cancelled), `shop_note`, `hold_id` |
| `kp_threads` | محادثة لكل مشترٍ: `buyer, name, phone, last_at, last_text, unread_shop, unread_buyer` |
| `kp_msgs` | الرسائل: `sender` (buyer/shop), `kind` (text/system), `body`, `img`, `order_no` |

إعدادات المتجر النصية (العنوان، واتساب، رسوم التوصيل…) تُحفظ في الإعدادات العادية `settings.store` وتتزامن كأي إعداد، وتقرأ الدالة العامة `kp_store_info` قائمة بيضاء منها فقط.

دوال الزائر (دور `anon`): `kp_store_info`, `kp_store_products`, `kp_store_images`, `kp_store_order`, `kp_store_orders`, `kp_store_order_proof`, `kp_store_chat_send`, `kp_store_chat_get`, `kp_store_msg_img`.
دوال الموظفين (أي عضو): `kp_store_status`, `kp_orders_list`, `kp_order_proof`, `kp_order_set`, `kp_order_link`, `kp_threads_list`, `kp_chat_staff_get`, `kp_chat_staff_send`, `kp_chat_staff_img`. وللمالك فقط: `kp_store_publish`، و`kp_chat_purge(p_days)` (حذف رسائل المحادثات: كلها إن كان 0، أو الأقدم من هذا العدد من الأيام، ثم المحادثات الفارغة؛ لا يمسّ الطلبات). ولأي عضو: `kp_chat_stats` (عدد المحادثات والرسائل والصور وحجمها التقريبي وحجم إشعارات الدفع).
