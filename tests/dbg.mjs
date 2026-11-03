import { launch } from './chrome.mjs';
const p = await launch();
try {
  await p.goto('/index.html'); await p.waitFor(`document.querySelector('.login')||document.querySelector('.app')`, 20000);
  await p.eval(`localStorage.setItem('kp_mode','demo')`);
  await p.goto('/index.html'); await p.waitFor(`document.querySelector('.app')`, 120000);
  const r = await p.eval(`(async()=>{
    const store = await import('/src/core/store.js'); const ops = await import('/src/core/ops.js'); const u = await import('/src/core/util.js');
    const invs = store.list('invoices'); const days = {}; invs.forEach(i=>{const k=u.dayKey(i.t); days[k]=(days[k]||0)+1});
    const p = store.list('products').find(p=>p.unit==='pc'&&p.stock>5);
    let err=null; try{ await ops.completeSale({cart:{lines:[{pid:p.id,qty:1}]},payments:[{method:'cash',amount:100}]}); }catch(e){err=e.message}
    u.setClock(u.dayStart(u.addDays(u.todayKey(),-10))+10*3600e3);
    let err2=null; try{ await ops.completeSale({cart:{lines:[{pid:p.id,qty:1}]},payments:[{method:'cash',amount:100}]}); }catch(e){err2=e.message}
    u.setClock(null);
    return {n:invs.length, days, err, err2, stock:p.stock, shifts: store.list('shifts').length, last: store.list('invoices').slice(-2).map(i=>i.t)};
  })()`);
  console.log(JSON.stringify(r,null,1));
} catch (e) { console.log('FAIL', e.message, p.logs.slice(-5)); } finally { await p.close(); }
