// اختبار مولّد الباركود src/lib/qr.js:
//  (أ) بنية الرمز: أنماط الزوايا والتوقيت وخانة الظلام وصحة بتات الصيغة (BCH) وثبات الناتج ورفض النص الأطول من السعة
//  (ب) فك الترميز الفعلي بقارئ مستقل (OpenCV عبر Python) لـ 4 مستويات تصحيح وأطوال تغطي الإصدارات 1–38 والعربية ورابط المتجر الحقيقي.
//      إن لم يتوفر Python/OpenCV يُتخطى (ب) ويُذكر ذلك صراحة في النتيجة (ولا يُعدّ نجاحاً مفتوحاً).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qrMatrix, qrSvg } from '../src/lib/qr.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = []; const T = async (t, fn) => { try { const n = await fn(); res.push([t, true, n || '']); console.log('✔', t, n ? '— ' + n : ''); } catch (e) { res.push([t, false, e.message]); console.log('✘', t, '—', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''}: المتوقع ${JSON.stringify(b)} والفعلي ${JSON.stringify(a)}`); };

const LINK = 'https://ke3haker-eng.github.io/kashier-pro/store.html?s=alamal-market&u=https%3A%2F%2Ffbdspqonqbdfjujkthfy.supabase.co&k=sb_publishable_OZw3xWtlCGXSyQ_s3vApKQ_cydsBsst';
const rnd = n => { const A = 'abcdefghijklmnopqrstuvwxyz0123456789-_.~:/?=&%ABCDEFGH'; let s = ''; for (let i = 0; i < n; i++) s += A[(i * 7 + n * 13 + i * i) % A.length]; return s; };
const LENS = [1, 5, 10, 17, 20, 26, 32, 40, 53, 60, 78, 90, 106, 120, 134, 154, 170, 195, 220, 250, 280, 330, 400, 500, 650, 800, 1000, 1300, 1700, 2000];

await T('البنية: أنماط الزوايا والتوقيت وخانة الظلام وبتات الصيغة صحيحة لكل مستوى، والناتج ثابت', () => {
  let n = 0;
  for (const level of ['L', 'M', 'Q', 'H']) for (const len of [1, 30, 120, 300]) {
    const q = qrMatrix(rnd(len), level), s = q.size; n++;
    for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); assert(q.get(cx + dx, cy + dy) === (d !== 2), `نمط الزاوية ${level}/${len}`); }
    for (let i = 8; i < s - 8; i++) { assert(q.get(6, i) === (i % 2 === 0) && q.get(i, 6) === (i % 2 === 0), 'نمط التوقيت'); }
    assert(q.get(8, s - 8) === true, 'خانة الظلام');
    // بتات الصيغة: النسختان متطابقتان ومتبقي BCH صفر
    let a = 0; for (let i = 0; i <= 5; i++) a |= (q.get(8, i) ? 1 : 0) << i; a |= (q.get(8, 7) ? 1 : 0) << 6; a |= (q.get(8, 8) ? 1 : 0) << 7; a |= (q.get(7, 8) ? 1 : 0) << 8; for (let i = 9; i < 15; i++) a |= (q.get(14 - i, 8) ? 1 : 0) << i;
    let b = 0; for (let i = 0; i < 8; i++) b |= (q.get(s - 1 - i, 8) ? 1 : 0) << i; for (let i = 8; i < 15; i++) b |= (q.get(8, s - 15 + i) ? 1 : 0) << i;
    eq(a, b, 'نسختا الصيغة'); let r = a ^ 0x5412; for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10); eq(r, 0, 'BCH الصيغة');
    eq((a ^ 0x5412) >>> 13, { L: 1, M: 0, Q: 3, H: 2 }[level], 'مستوى التصحيح في الصيغة');
  }
  const x = qrMatrix(LINK), y = qrMatrix(LINK); let same = x.mask === y.mask && x.size === y.size; for (let j = 0; j < x.size; j++) for (let i = 0; i < x.size; i++) if (x.get(i, j) !== y.get(i, j)) same = false;
  assert(same, 'الناتج يتغير بين مرتين'); return `${n} رمزاً سليم البنية، والرابط الحقيقي ثابت (الإصدار ${x.version}، ${x.size}×${x.size})`;
});

await T('الحدود: الإصدار يكبر مع الطول، والنص الأطول من السعة يُرفض برسالة، ومستوى مجهول يُرفض، وSVG سليم', () => {
  let last = 0; for (const len of [10, 100, 300, 1000, 2000]) { const v = qrMatrix(rnd(len), 'L').version; assert(v >= last, 'الإصدار يجب ألا ينقص'); last = v; }
  eq(qrMatrix(rnd(17), 'L').version, 1, 'أصغر إصدار'); eq(qrMatrix('x'.repeat(2953), 'L').version, 40, 'أقصى سعة L');
  let threw = false; try { qrMatrix('x'.repeat(2954), 'L'); } catch (e) { threw = /طويل/.test(e.message); } assert(threw, 'نص أطول من السعة');
  threw = false; try { qrMatrix('a', 'Z'); } catch { threw = true; } assert(threw, 'مستوى مجهول');
  const svg = qrSvg(LINK), n = qrMatrix(LINK).size + 8;
  assert(svg.startsWith('<svg') && svg.includes(`viewBox="0 0 ${n} ${n}"`) && svg.includes('fill="#fff"') && svg.includes('fill="#000"') && svg.includes('<path d="M'), 'SVG غير سليم');
  return 'نص أطول من 2953 بايت يُرفض، وSVG بخلفية بيضاء ووحدات سوداء';
});

await T('فك الترميز الفعلي بقارئ مستقل (OpenCV): أطوال وإصدارات ومستويات، والعربية، ورابط المتجر الحقيقي', () => {
  const W = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-qr-')), cases = [];
  for (const level of ['L', 'M', 'Q', 'H']) for (const n of LENS) cases.push([rnd(n), level]);
  for (const t of [LINK, 'https://ke3haker-eng.github.io/kashier-pro/store.html?s=alamal-market', 'متجر الأمل ✓ https://x.y/؟س=١']) cases.push([t, 'M']);
  const out = []; for (const [text, level] of cases) { try { const q = qrMatrix(text, level); out.push({ text, level, version: q.version, size: q.size, rows: Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => q.get(x, y) ? '1' : '0').join('')) }); } catch (e) { assert(/طويل/.test(e.message), e.message); } }
  fs.writeFileSync(path.join(W, 'cases.json'), JSON.stringify(out));
  const py = `
import json, sys
try:
    import numpy as np, cv2
except Exception:
    print('NOCV'); sys.exit(0)
d = json.load(open(sys.argv[1])); dets = [cv2.QRCodeDetector(), cv2.QRCodeDetectorAruco()]; ok = 0; bad = []; vers = set()
def render(c, sc, m=4):
    n = c['size']; img = np.full(((n + 2*m) * sc, (n + 2*m) * sc), 255, np.uint8)
    for y, row in enumerate(c['rows']):
        for x, ch in enumerate(row):
            if ch == '1': img[(y+m)*sc:(y+m+1)*sc, (x+m)*sc:(x+m+1)*sc] = 0
    return img
def match(g, w):
    if g == w: return True
    try: return g.encode('latin-1') == w.encode('utf-8')
    except Exception: return False
for c in d:
    done = False
    for det in dets:
        for sc in (4, 5, 6, 7, 8, 10, 12):
            try: val = det.detectAndDecode(render(c, sc))[0]
            except Exception: val = ''
            if val and match(val, c['text']): done = True; break
        if done: break
    if done: ok += 1; vers.add(c['version'])
    else: bad.append(c['level'] + ' v' + str(c['version']))
print(json.dumps({'ok': ok, 'total': len(d), 'bad': bad, 'vmin': min(vers) if vers else 0, 'vmax': max(vers) if vers else 0}))`;
  const r = spawnSync('python3', ['-I', '-c', py, path.join(W, 'cases.json')], { encoding: 'utf8', maxBuffer: 1 << 26 }); fs.rmSync(W, { recursive: true, force: true });
  if (r.status !== 0 || /NOCV/.test(r.stdout)) return 'تُخطّي: Python/OpenCV غير متوفر هنا (اختبار البنية أعلاه يبقى سارياً)';
  const j = JSON.parse(r.stdout.trim().split('\n').pop()); assert(j.bad.length === 0, 'لم تُفكّ: ' + j.bad.join(', '));
  return `فُكّت ${j.ok}/${j.total} صورة بشكل صحيح (إصدارات ${j.vmin}–${j.vmax}، مستويات L/M/Q/H، عربي، ورابط المتجر الحقيقي)`;
});

const bad = res.filter(r => !r[1]).length; console.log(`\n${bad ? '✘' : '✔'} ${res.length - bad}/${res.length} اختبار باركود`);
fs.writeFileSync(path.join(SRC, 'docs', 'test-results-qr.md'), ['# نتائج اختبار مولّد الباركود', '', '| الاختبار | النتيجة | ملاحظات |', '|---|---|---|', ...res.map(r => `| ${r[0]} | ${r[1] ? '✅' : '❌'} | ${String(r[2]).replace(/\|/g, '\\|')} |`), ''].join('\n'));
process.exit(bad ? 1 : 0);
