import { launch } from './chrome.mjs';
const p = await launch({ width: 1366, height: 800 });
const shots = '/tmp/claude-0/shots';
try {
  await p.goto('/index.html');
  await p.waitFor(`document.querySelector('.app')||document.querySelector('.login')`, 20000);
  console.log('boot ok; logs:', p.logs.filter(l=>!l.startsWith('[log]')).slice(0,8));
  await p.shot(shots + '/01-home-empty.png');
  // enter demo
  await p.eval(`localStorage.setItem('kp_mode','demo')`);
  await p.goto('/index.html');
  await p.waitFor(`document.querySelector('.app')`, 120000);
  console.log('demo boot ok');
  await p.eval(`location.hash='#/home'`); await new Promise(r=>setTimeout(r,800));
  await p.shot(shots + '/02-home-demo.png');
  for (const r of ['pos','products','inventory']) { await p.eval(`location.hash='#/${r}'`); await new Promise(r=>setTimeout(r,900)); await p.shot(shots + `/03-${r}.png`); }
  console.log('errors:', p.logs.filter(l=>/EXCEPTION|\[error\]/.test(l)).slice(0,10));
} catch (e) { console.log('FAIL', e.message); console.log(p.logs.slice(-15).join('\n')); }
finally { await p.close(); }
