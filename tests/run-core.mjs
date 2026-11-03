import { launch } from './chrome.mjs';
const p = await launch();
try {
  await p.goto('/tests/core.html');
  await p.waitFor('window.__done === true', 60000);
  const r = await p.eval('window.__result');
  console.log(r.out.join('\n')); console.log(`\nنجح: ${r.pass}  فشل: ${r.fail}`);
  const errs = p.logs.filter(l => l.includes('EXCEPTION') || l.startsWith('[error]')); if (errs.length) console.log('سجل المتصفح:\n' + errs.join('\n'));
  process.exitCode = r.fail ? 1 : 0;
} catch (e) { console.log('خطأ في التشغيل:', e.message); console.log(p.logs.join('\n')); process.exitCode = 2; }
finally { await p.close(); }
