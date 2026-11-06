// يفتح كل صفحات التطبيق في وضع التجربة ويتحقق من خلوها من الأخطاء وأن محتواها ظاهر + يلتقط صوراً للمراجعة
import { launch } from './chrome.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shots = process.env.SHOTS || '/tmp/claude-0/shots';
const w = +process.env.W || 1366, h = +process.env.H || 800, mobile = !!process.env.MOBILE;
const p = await launch({ width: w, height: h, mobile });
const ROUTES = ['home', 'pos', 'products', 'inventory', 'purchases', 'suppliers', 'customers', 'invoices', 'orders', 'returns', 'expenses', 'reports', 'staff', 'settings'];
let bad = 0;
try {
  await p.goto('/index.html'); await p.eval(`localStorage.setItem('kp_mode','demo')`);
  await p.goto('/index.html'); await p.waitFor(`document.querySelector('.app')`, 180000);
  const stats = await p.eval(`(async()=>{const s=await import('/src/core/store.js');const u=await import('/src/core/util.js');const inv=s.list('invoices');const t=u.todayKey();return {products:s.count('products'),invoices:inv.length,today:inv.filter(i=>u.dayKey(i.t)===t).length,oldest:inv.map(i=>u.dayKey(i.t)).sort()[0],customers:s.count('customers'),suppliers:s.count('suppliers'),purchases:s.count('purchases'),expenses:s.count('expenses'),returns:s.count('returns'),offers:s.count('offers'),batches:s.count('batches')}})()`);
  console.log('demo:', JSON.stringify(stats));
  for (const r of ROUTES) {
    const before = p.logs.length;
    await p.eval(`location.hash='#/${r}'`); await sleep(1100);
    const info = await p.eval(`({h1:document.getElementById('h1')?.textContent, len:document.getElementById('view')?.innerText.length, err:/تعذّر تحميل هذه الصفحة/.test(document.getElementById('view')?.innerText||''), htmlLen:document.getElementById('view')?.innerHTML.length, overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
    const errs = p.logs.slice(before).filter(l => /EXCEPTION|\[error\]/.test(l));
    const ok = info.len > 40 && !info.err && !errs.length;
    if (!ok) bad++;
    console.log((ok ? 'OK  ' : 'FAIL'), r.padEnd(10), JSON.stringify(info), errs.slice(0, 3).join(' | '));
    await p.shot(`${shots}/p-${mobile ? 'm-' : ''}${r}.png`);
  }
  console.log(bad ? `FAILED pages: ${bad}` : 'ALL PAGES OK');
} catch (e) { bad++; console.log('FAIL', e.message); console.log(p.logs.slice(-15).join('\n')); }
finally { await p.close(); }
process.exit(bad ? 1 : 0);
