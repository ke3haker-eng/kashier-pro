// أداة اختبار بلا اعتمادات: خادم ملفات ساكن + Chrome headless عبر بروتوكول CDP (WebSocket المدمج في Node 22)
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function serve(root = ROOT) {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end('404'); }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

export async function launch({ width = 1366, height = 800, mobile = false, root = ROOT } = {}) {
  const { srv, port } = await serve(root);
  const dbgPort = 9300 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-chrome-'));
  const proc = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--lang=ar', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let ws, tries = 0, wsUrl;
  while (!wsUrl && tries++ < 80) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); wsUrl = l.find(x => x.type === 'page')?.webSocketDebuggerUrl; } catch { } }
  if (!wsUrl) throw new Error('تعذر تشغيل Chrome');
  ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const logs = []; const handlers = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { }); logs.push('[dialog] ' + m.params.message); }
    for (const h of handlers) h(m);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const base = `http://127.0.0.1:${port}`;
  const page = {
    base, logs, send,
    async goto(p) { const loaded = new Promise(r => { const h = m => { if (m.method === 'Page.loadEventFired') { handlers.splice(handlers.indexOf(h), 1); r(); } }; handlers.push(h); }); await send('Page.navigate', { url: p.startsWith('http') ? p : base + p }); await Promise.race([loaded, sleep(15000)]); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n').slice(0, 4).join(' | ')); return r.result.value; },
    async waitFor(expr, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await page.eval(expr); if (v) return v; } catch { } await sleep(100); } throw new Error('انتهت المهلة: ' + expr); },
    async click(sel) { const r = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`); if (!r) throw new Error('عنصر غير موجود: ' + sel); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0], y: r[1], button: 'left', clickCount: 1 }); },
    async type(text) { for (const ch of text) { await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); } },
    async key(key, code, vk) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code || key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; },
    async viewport(w, h, m = false) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: m ? 2 : 1, mobile: m }); },
    on(method, fn) { const h = m => { if (m.method === method) fn(m.params); }; handlers.push(h); return () => handlers.splice(handlers.indexOf(h), 1); },
    once(method, ms = 8000) { return new Promise((res, rej) => { const t = setTimeout(() => { off(); rej(new Error('لم يصل الحدث ' + method)); }, ms); const off = page.on(method, p => { clearTimeout(t); off(); res(p); }); }); },
    // نقر حقيقي على أول عنصر مرئي يحوي النص (داخل أعلى نافذة منبثقة إن وُجدت)
    async clickText(text, sel = 'button,a,.btn,[role=button],[data-tab],.chip,label') {
      const r = await page.eval(`(()=>{const ovs=document.querySelectorAll('.ov');const scope=ovs.length?ovs[ovs.length-1]:document;const es=[...scope.querySelectorAll(${JSON.stringify(sel)})].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&e.textContent.replace(/\s+/g,' ').trim().includes(${JSON.stringify(text)})});const e=es[0];if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
      if (!r) throw new Error('لا يوجد زر بالنص: ' + text);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0], y: r[1], button: 'left', clickCount: 1 });
    },
    // يملأ حقلاً بالكتابة الفعلية (أو يضبط select). النطاق: أعلى نافذة منبثقة أو الصفحة
    async fill(sel, value) {
      const kind = await page.eval(`(()=>{const ovs=document.querySelectorAll('.ov');const scope=ovs.length?ovs[ovs.length-1]:document;const e=scope.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});e.focus();if(e.tagName==='SELECT'){const o=[...e.options].find(o=>o.value===${JSON.stringify(String(value))}||o.textContent.trim()===${JSON.stringify(String(value))});if(!o)return 'noopt';e.value=o.value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'select'}if(e.type==='checkbox')return 'checkbox';e.select();return 'input'})()`);
      if (!kind) throw new Error('حقل غير موجود: ' + sel); if (kind === 'noopt') throw new Error('خيار غير موجود في ' + sel + ': ' + value);
      if (kind === 'input') { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); if (value !== '') await page.type(String(value)); }
    },
    async enter() { await page.key('Enter', 'Enter', 13); },
    async stopServer() { srv.closeAllConnections?.(); await new Promise(r => srv.close(() => r())); },
    async downloads(dir) { fs.mkdirSync(dir, { recursive: true }); await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true }); },
    async chooseFile(clickFn, file) { await send('Page.setInterceptFileChooserDialog', { enabled: true }); const ev = page.once('Page.fileChooserOpened'); await clickFn(); const e = await ev; await send('DOM.enable'); await send('DOM.setFileInputFiles', { files: [file], backendNodeId: e.backendNodeId }); await send('Page.setInterceptFileChooserDialog', { enabled: false }); },
    async close() { try { ws.close(); } catch { } proc.kill('SIGKILL'); srv.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } },
  };
  return page;
}
