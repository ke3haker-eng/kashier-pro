// اختبار ملفات Excel / CSV فعلياً:
//  (أ) استيراد ملف .xlsx أنشأته مكتبة openpyxl (Excel حقيقي) وملف .csv بفاصلة منقوطة وأرقام عربية عبر واجهة الاستيراد
//  (ب) تصدير xlsx/csv من التطبيق ثم فتح الناتج بمكتبة openpyxl ومكتبة csv الخارجيتين للتأكد أنه ملف صالح
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = []; const T = async (t, fn, p) => { try { const n = await fn(); res.push([t, true, n || '']); console.log('✔', t, n ? '— ' + n : ''); } catch (e) { res.push([t, false, e.message]); console.log('✘', t, '—', e.message); try { await p?.shot('/tmp/claude-0/shots/FAIL-files.png'); } catch { } } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''}: المتوقع ${JSON.stringify(b)} والفعلي ${JSON.stringify(a)}`); };
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-files-')), DL = path.join(W, 'dl'); fs.mkdirSync(DL);
const py = code => execFileSync('python3', ['-I', '-c', code], { encoding: 'utf8' });

// ---- ملفات الاستيراد ----
py(`
import openpyxl, datetime
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'منتجات'
ws.append(['اسم المنتج','الباركود','الكود الداخلي','التصنيف','الوحدة','سعر الشراء','سعر البيع','الكمية','الحد الأدنى','تاريخ الانتهاء','الوصف'])
ws.append(['مياه معدنية 1.5 لتر', 6281000000099, 'W1', 'مشروبات', 'قطعة', 0.8, 1.5, 100, 20, datetime.date(2027,3,1), 'مياه'])   # باركود كرقم حقيقي في Excel
ws.append(['أرز مصري', '0012345', 'R1', 'بقالة', 'كجم', 9, 12, 12.5, 3, None, None])                                          # باركود نصي بأصفار بادئة
ws.append(['صنف بباركود مكرر داخل الملف', 6281000000099, None, 'مشروبات', 'قطعة', 1, 2, 5, None, None, None])
ws.append(['صنف بلا سعر', '777', None, 'بقالة', 'قطعة', 1, None, 5, None, None, None])
ws.append([None]*11)
ws.append(['عدس', '888', None, 'بقالة', 'وحدة غريبة', 4, 6, 30, 5, None, None])
wb.save(r'${W}/import.xlsx')
open(r'${W}/import.csv','w',encoding='utf-8-sig').write('\\n'.join([
 'اسم المنتج;الباركود;التصنيف;الوحدة;سعر الشراء;سعر البيع;الكمية',
 'مياه معدنية 1.5 لتر;6281000000099;مشروبات;قطعة;٠٫٩;١٫٧٥;50',        # تحديث منتج موجود بأرقام عربية
 '"شاي ""الكوب"" الذهبي; 100 كيس";999;مشروبات;قطعة;6;9.5;40',          # فاصلة منقوطة داخل علامات اقتباس + اقتباس مزدوج
]))
`);

const p = await launch({ width: 1366, height: 800, root: SRC });
const ev = e => p.eval(e), go = async r => { await p.eval(`location.hash='#/${r}'`); await sleep(600); };
const waitModal = async () => { await p.waitFor(`document.querySelector('.ov')`, 6000); await sleep(120); };
async function files(kind) { const t0 = Date.now(); let f; for (let i = 0; i < 60 && !f; i++) { await sleep(150); f = fs.readdirSync(DL).find(x => x.endsWith('.' + kind) && fs.statSync(path.join(DL, x)).mtimeMs >= t0 - 1000); } assert(f, 'لم يُنزَّل ملف ' + kind); await sleep(150); return path.join(DL, f); }
try {
  await p.goto('/index.html'); await p.waitFor(`document.querySelector('.app')`, 30000); await p.downloads(DL);
  await ev(`(async()=>{window.K={store:await import('/src/core/store.js'),ops:await import('/src/core/ops.js'),an:await import('/src/core/analytics.js')}})()`);
  const sleepImp = () => sleep(500);

  await T('استيراد ملف Excel حقيقي (openpyxl): باركود رقمي، أصفار بادئة، تصنيفات جديدة، تواريخ', async () => {
    await go('products'); await p.click('[data-act="import"]'); await waitModal();
    await p.chooseFile(() => p.click('.ov [data-pick]'), path.join(W, 'import.xlsx')); await p.waitFor(`document.querySelector('.ov [data-go]')`, 8000);
    const prev = await ev(`document.querySelector('.ov').innerText`); assert(/اسم المنتج/.test(prev) && /5/.test(prev), 'المعاينة: ' + prev.slice(0, 200));
    await p.click('.ov [data-go]'); await p.waitFor(`/اكتمل الاستيراد/.test(document.querySelector('.ov').innerText)`, 8000);
    const r = await ev(`document.querySelector('.ov').innerText.replace(/\\s+/g,' ')`);
    const ps = await ev(`K.store.list('products').map(p=>({n:p.name,bc:p.barcode,code:p.code,u:p.unit,c:p.cost,p:p.price,s:p.stock,m:p.min,e:p.expiry,cat:K.store.catName(p.cat)}))`);
    const by = n => ps.find(x => x.n === n);
    const w = by('مياه معدنية 1.5 لتر'); assert(w, 'مياه لم تُستورد'); eq([w.bc, w.code, w.u, w.c, w.p, w.s, w.m, w.e, w.cat], ['6281000000099', 'W1', 'pc', 0.8, 1.5, 100, 20, '2027-03-01', 'مشروبات'], 'مياه');
    const a = by('أرز مصري'); eq([a.bc, a.u, a.s, a.cat], ['0012345', 'kg', 12.5, 'بقالة'], 'الأصفار البادئة محفوظة والوحدة بالكيلو');
    assert(!by('صنف بباركود مكرر داخل الملف'), 'الباركود المكرر داخل الملف يجب ألا يُدخل منتجين'); assert(!by('صنف بلا سعر'), 'الصنف بلا سعر يُرفض');
    const l = by('عدس'); assert(l && l.u === 'pc', 'وحدة غير معروفة ← قطعة'); eq(await ev(`K.store.list('categories').map(c=>c.name).sort()`), ['بقالة', 'مشروبات'], 'التصنيفات المُنشأة تلقائياً');
    await p.click('.ov [data-close]'); await sleepImp();
    return `استُورد ${ps.length} منتجات؛ المكرر داخل الملف وبلا سعر رُفضا — ${r.match(/أخطاء[^0-9]*\d+/)?.[0] || ''}`;
  }, p);

  await T('استيراد CSV (UTF-8 BOM، فاصلة منقوطة، أرقام عربية، اقتباس مزدوج): تحديث الموجود وإضافة الجديد', async () => {
    const n0 = await ev(`K.store.count('products')`); await p.click('[data-act="import"]'); await waitModal();
    await p.chooseFile(() => p.click('.ov [data-pick]'), path.join(W, 'import.csv')); await p.waitFor(`document.querySelector('.ov [data-go]')`, 8000);
    await p.click('.ov [data-go]'); await p.waitFor(`/اكتمل الاستيراد/.test(document.querySelector('.ov').innerText)`, 8000);
    const r = await ev(`document.querySelector('.ov').innerText.replace(/\\s+/g,' ')`);
    await p.click('.ov [data-close]'); await sleepImp();
    const w = await ev(`K.store.list('products').find(p=>p.name==='مياه معدنية 1.5 لتر')`); eq([w.cost, w.price, w.stock], [0.9, 1.75, 50], 'التحديث بأرقام عربية (٠٫٩ ← 0.9، ١٫٧٥ ← 1.75) والكمية من الملف');
    const mv = await ev(`K.store.list('moves').filter(m=>m.pid==='${w.id}').map(m=>[m.type,m.qty,m.before,m.after,m.reason])`);
    assert(mv.some(m => m[0] === 'adjust_sub' && m[1] === -50 && m[2] === 100 && m[3] === 50 && /استيراد/.test(m[4])), 'تغيير الكمية بالاستيراد لم يُسجَّل كحركة مخزون: ' + JSON.stringify(mv));
    const t = await ev(`K.store.list('products').find(p=>p.name.includes('الكوب'))`); assert(t, 'الصنف ذو الاقتباس المزدوج لم يُستورد'); eq([t.name, t.barcode, t.price, t.stock], ['شاي "الكوب" الذهبي; 100 كيس', '999', 9.5, 40], 'اسم بفاصلة منقوطة واقتباس مزدوج');
    eq(await ev(`K.store.count('products')`), n0 + 1, 'عدد المنتجات (واحد محدَّث وواحد جديد)');
    return 'حُدّث الموجود (أرقام عربية)، أُضيف الجديد (اقتباس مزدوج + فاصلة منقوطة)، وتغيّر المخزون سُجّل في حركة مخزون'; 
  }, p);
} catch (e) { res.push(['خطأ عام', false, e.message]); console.log('FATAL', e.message); }
// ملاحظة: الاختبار أعلاه سيُعدَّل بعد أول تشغيل إن كان سلوك الكمية مختلفاً عن المتوقع (انظر التقرير)

try {
  await T('تصدير Excel من التطبيق ثم فتحه بمكتبة openpyxl: ورقة صالحة، أرقام حقيقية، اتجاه RTL', async () => {
    await go('products'); await sleep(400); await p.click('[data-exp="xlsx"]'); const f = await files('xlsx');
    const o = JSON.parse(py(`
import openpyxl, json
wb = openpyxl.load_workbook(r'${f}'); ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
price_col = rows[0].index('سعر البيع')
print(json.dumps({'sheets': wb.sheetnames, 'n': len(rows), 'head': rows[0], 'rtl': ws.sheet_view.rightToLeft, 'num': all(isinstance(r[price_col], (int, float)) for r in rows[1:]), 'names': [r[0] for r in rows[1:]], 'bc': [r[1] for r in rows[1:]]}, ensure_ascii=False))`));
    const total = await ev(`K.store.count('products')`);
    eq(o.n, total + 1, 'عدد الصفوف'); assert(o.head.includes('اسم المنتج') && o.head.includes('سعر البيع'), 'العناوين: ' + o.head); assert(o.num, 'أسعار البيع ليست أرقاماً حقيقية'); assert(o.rtl, 'ورقة Excel ليست من اليمين لليسار'); assert(o.names.includes('أرز مصري') && o.bc.includes('0012345'), 'الأصفار البادئة في الباركود ضاعت في التصدير');
    return `ورقة «${o.sheets[0]}» بـ ${o.n} صفاً، الأسعار أرقام، RTL، والباركود بأصفاره`;
  }, p);

  await T('تصدير CSV: UTF-8 مع BOM ويُقرأ بمكتبة csv مع الاقتباس والفواصل', async () => {
    await p.click('[data-exp="csv"]'); const f = await files('csv'); const raw = fs.readFileSync(f); assert(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF, 'لا يوجد BOM (Excel سيعرض العربية مشوّهة)');
    const o = JSON.parse(py(`
import csv, json
rows = list(csv.reader(open(r'${f}', encoding='utf-8-sig', newline='')))
print(json.dumps({'n': len(rows), 'w': len(set(len(r) for r in rows)), 'tea': [r[0] for r in rows if 'الكوب' in r[0]]}, ensure_ascii=False))`));
    eq(o.w, 1, 'كل الصفوف بنفس عدد الأعمدة'); eq(o.tea, ['شاي "الكوب" الذهبي; 100 كيس'], 'الاقتباس المزدوج والفاصلة المنقوطة داخل الاسم'); return `${o.n} صفاً، الاقتباس سليم`;
  }, p);

  await T('تصدير تقارير: المبيعات/المخزون/الأرباح (xlsx) تُفتح في openpyxl بأوراق ملخّص وبيانات', async () => {
    await ev(`(async()=>{const c=await K.ops.saveCustomer({name:'زبون اختبار'});const pr=K.store.list('products')[0];const t=await K.ops.completeSale({cart:{lines:[{pid:pr.id,qty:2,disc:null}],invDisc:null,customerId:'',note:''},payments:[{method:'cash',amount:50}]});return t.no})()`);
    await go('reports'); await sleep(600); await p.click('[data-exp="xlsx"]'); const f = await files('xlsx');
    const o = JSON.parse(py(`
import openpyxl, json
wb = openpyxl.load_workbook(r'${f}')
print(json.dumps({'sheets': wb.sheetnames, 'rows': [ws.max_row for ws in wb.worksheets]}, ensure_ascii=False))`));
    assert(o.sheets.length >= 1 && o.rows.every(n => n >= 2), 'أوراق فارغة: ' + JSON.stringify(o)); return 'أوراق: ' + o.sheets.join('، ');
  }, p);

  await T('تصدير PDF (معاينة الطباعة) يعرض الجدول الكامل', async () => {
    await go('products'); await p.click('[data-exp="pdf"]'); await waitModal(); const t = await ev(`document.querySelector('.ov .preview-paper')?.innerText||''`);
    assert(/قائمة المنتجات/.test(t) && /أرز مصري/.test(t) && /مياه معدنية/.test(t), 'المعاينة لا تحوي الجدول: ' + t.slice(0, 120)); await p.click('.ov [data-close]'); return 'معاينة A4 تحوي العنوان والمنتجات (الحفظ كـ PDF عبر نافذة طباعة المتصفح)';
  }, p);
} finally { await p.close(); }
const bad = res.filter(r => !r[1]).length; console.log(`\n${bad ? '✘' : '✔'} ${res.length - bad}/${res.length} اختبار ملفات`);
fs.writeFileSync(path.join(SRC, 'docs', 'test-results-files.md'), ['# نتائج اختبار ملفات Excel وCSV', '', '| الاختبار | النتيجة | ملاحظات |', '|---|---|---|', ...res.map(r => `| ${r[0]} | ${r[1] ? '✅' : '❌'} | ${String(r[2]).replace(/\|/g, '/')} |`), '', `**${res.length - bad} نجح، ${bad} فشل**`].join('\n'));
fs.rmSync(W, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
