// ماسح الباركود بالكاميرا: BarcodeDetector الأصلي إن وُجد، وإلا ZXing (محلياً من vendor/ إن وُضعت، وإلا من CDN كما في النسخة الأصلية)
import { icon } from '../ui/icons.js';
import { settings } from '../core/store.js';
import { toast } from '../ui/components.js';

let stream, timer, zx, last = '', lastT = 0, active = false, handler = null, paused = false;

const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
async function loadZX() {
  if (globalThis.ZXing) return;
  try { await loadScript('vendor/zxing.min.js'); if (globalThis.ZXing) return; } catch { }
  await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js');
}
export function feedback() {
  const S = settings();
  if (S.vib) navigator.vibrate?.(60);
  if (S.snd) try { const a = new (window.AudioContext || webkitAudioContext)(), o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 90); } catch { }
}
function hit(code) { if (paused || !code) return; if (code === last && Date.now() - lastT < 1800) return; last = code; lastT = Date.now(); handler?.(code); }
export const pauseScanner = (v = true) => { paused = v; };
export const isScanning = () => active;
export const flashScan = text => { const el = document.querySelector('#cam .last'); if (el) { el.innerHTML = `<span>${text.replace(/[&<>]/g, '')}</span>`; setTimeout(() => { if (el.isConnected) el.innerHTML = ''; }, 1600); } };

// onScan(code) تُستدعى لكل باركود جديد (مع منع التكرار غير المقصود). مثل الأصل: خيار "إغلاق بعد كل مسح" يديره المستدعي.
export async function openScanner(onScan, { hint = 'وجّه الباركود نحو الكاميرا' } = {}) {
  closeScanner(); handler = onScan; paused = false; last = ''; active = true;
  const o = document.createElement('div'); o.id = 'cam';
  o.innerHTML = `<video id="camv" playsinline muted></video><div class="fr"></div><button class="btn danger x" data-camx>${icon('x', 18)} إغلاق</button><div class="last"></div><div class="ht">${hint}</div>`;
  o.querySelector('[data-camx]').onclick = closeScanner; document.body.append(o);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector(), v = o.querySelector('#camv');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); v.srcObject = stream; await v.play();
      const tick = async () => { if (!stream) return; try { const r = await det.detect(v); if (r[0]) hit(r[0].rawValue); } catch { } timer = setTimeout(tick, 180); }; tick();
    } else { await loadZX(); zx = new ZXing.BrowserMultiFormatReader(); zx.decodeFromVideoDevice(undefined, 'camv', r => { if (r) hit(r.getText()); }); }
  } catch (e) { closeScanner(); toast('تعذّر فتح الكاميرا — اسمح بالإذن وافتح التطبيق عبر HTTPS', 'err', 4000); }
}
export function closeScanner() {
  clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); stream = null; try { zx?.reset(); } catch { } zx = null; document.getElementById('cam')?.remove(); active = false; handler = null; paused = false;
}
