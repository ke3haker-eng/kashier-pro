// خادم كاشير: (1) يخدم ملفات التطبيق (2) يوفّر واجهة نسخ احتياطي سحابي بسيطة بمفتاح وصول.
// بلا أي اعتمادات خارجية — يحتاج Node 18 أو أحدث فقط:   node server/server.mjs
//
// المتغيرات (كلها اختيارية):
//   PORT=8787            المنفذ
//   HOST=0.0.0.0         العنوان (0.0.0.0 = متاح للأجهزة في نفس الشبكة، 127.0.0.1 = هذا الجهاز فقط)
//   KASHIER_KEY=...      مفتاح الوصول. إن لم تحدده يُولَّد تلقائياً ويُحفظ في data/key.txt ويُطبع عند التشغيل
//   KASHIER_DATA=./data  مجلد حفظ النسخ
//   KASHIER_KEEP=30      عدد النسخ المحتفَظ بها (الأقدم تُحذف)
//   KASHIER_MAX_MB=200   أقصى حجم لنسخة واحدة
//   KASHIER_CERT=cert.pem KASHIER_KEYFILE=key.pem   لتشغيل https مباشرة (مطلوب للكاميرا خارج localhost)
//   KASHIER_NO_STATIC=1  لا تخدم ملفات التطبيق (واجهة API فقط)
//
// تنبيه صريح: هذا خادم نسخ احتياطي (رفع/استعادة نسخة كاملة)، وليس مزامنة لحظية بين أجهزة، وليس قاعدة بيانات مركزية.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const PORT = +env.PORT || 8787, HOST = env.HOST || '0.0.0.0';
const DATA = path.resolve(ROOT, env.KASHIER_DATA || 'data'), BK = path.join(DATA, 'backups');
const KEEP = Math.max(1, +env.KASHIER_KEEP || 30), MAX = (+env.KASHIER_MAX_MB || 200) * 1048576;
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
fs.mkdirSync(BK, { recursive: true });

// ---------- المفتاح ----------
let KEY = env.KASHIER_KEY, generated = false;
const keyFile = path.join(DATA, 'key.txt');
if (!KEY) { if (fs.existsSync(keyFile)) KEY = fs.readFileSync(keyFile, 'utf8').trim(); else { KEY = crypto.randomBytes(24).toString('base64url'); fs.writeFileSync(keyFile, KEY + '\n', { mode: 0o600 }); generated = true; } }
const sameKey = (a = '') => { const x = Buffer.from(String(a)), y = Buffer.from(KEY); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// تقييد محاولات المفتاح الخاطئة (حماية من التخمين)
const fails = new Map();
const blocked = ip => { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 10 * 60e3; };
const fail = ip => { const f = fails.get(ip); if (!f || Date.now() - f.t > 10 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; };

// ---------- أدوات ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
const DENY = new Set(['server', 'tests', 'scripts', 'data', 'node_modules', 'docs', 'package.json', 'package-lock.json']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' };
const send = (res, code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store', ...CORS }); res.end(b); };
const idOk = id => /^[A-Za-z0-9_-]{6,60}$/.test(id);
const listBackups = () => fs.readdirSync(BK).filter(f => f.endsWith('.meta.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(BK, f), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => b.t.localeCompare(a.t));
const prune = () => { for (const m of listBackups().slice(KEEP)) for (const ext of ['.json', '.meta.json']) fs.rmSync(path.join(BK, m.id + ext), { force: true }); };

function readBody(req) {
  return new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX) { rej(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks))); req.on('error', rej);
  });
}

// ---------- واجهة API ----------
async function api(req, res, url) {
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, app: 'kashier-pro', version: VERSION, time: new Date().toISOString() });
  const ip = req.socket.remoteAddress || '?';
  if (blocked(ip)) return send(res, 429, { error: 'too many attempts' });
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m || !sameKey(m[1])) { fail(ip); return send(res, 401, { error: 'unauthorized' }); }
  fails.delete(ip);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','backups',id?]
  if (parts[1] !== 'backups') return send(res, 404, { error: 'not found' });

  if (req.method === 'GET' && parts.length === 2) return send(res, 200, { items: listBackups() });
  if (req.method === 'POST' && parts.length === 2) {
    let raw; try { raw = await readBody(req); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: e.message }); }
    let obj; try { obj = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'invalid json' }); }
    if (obj?.app !== 'kashier-pro' || !obj.data || typeof obj.data !== 'object') return send(res, 400, { error: 'not a kashier backup' });
    const t = new Date().toISOString(), id = t.replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
    fs.writeFileSync(path.join(BK, id + '.json'), raw);
    const meta = { id, t, size: raw.length, exportedAt: obj.exportedAt || null, counts: obj.counts || null };
    fs.writeFileSync(path.join(BK, id + '.meta.json'), JSON.stringify(meta)); prune();
    return send(res, 201, meta);
  }
  if (parts.length === 3) {
    let id = decodeURIComponent(parts[2]); if (id === 'latest') id = listBackups()[0]?.id || '';
    if (!idOk(id) || !fs.existsSync(path.join(BK, id + '.json'))) return send(res, 404, { error: 'not found' });
    if (req.method === 'GET') { const f = path.join(BK, id + '.json'); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': fs.statSync(f).size, 'Cache-Control': 'no-store', ...CORS }); return fs.createReadStream(f).pipe(res); }
    if (req.method === 'DELETE') { for (const ext of ['.json', '.meta.json']) fs.rmSync(path.join(BK, id + ext), { force: true }); return send(res, 200, { ok: true }); }
  }
  send(res, 405, { error: 'method not allowed' });
}

// ---------- الملفات الساكنة ----------
function serveStatic(req, res, url) {
  let p; try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('bad request'); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(ROOT, p));
  const rel = path.relative(ROOT, f), top = rel.split(path.sep)[0];
  if (rel.startsWith('..') || path.isAbsolute(rel) || DENY.has(top) || rel.split(path.sep).some(s => s.startsWith('.'))) { res.writeHead(404); return res.end('404'); }
  let st; try { st = fs.statSync(f); } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
  const ext = path.extname(f).toLowerCase(), h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) >= Math.floor(st.mtimeMs / 1000) * 1000) { res.writeHead(304, h); return res.end(); }
  if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.writeHead(200, { ...h, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }); return fs.createReadStream(f).pipe(zlib.createGzip()).pipe(res); }
  res.writeHead(200, { ...h, 'Content-Length': st.size }); fs.createReadStream(f).pipe(res);
}

const handler = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (env.KASHIER_NO_STATIC) { res.writeHead(404); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); else res.end(); }
};

const useTls = env.KASHIER_CERT && env.KASHIER_KEYFILE;
const server = useTls ? https.createServer({ cert: fs.readFileSync(env.KASHIER_CERT), key: fs.readFileSync(env.KASHIER_KEYFILE) }, handler) : http.createServer(handler);
server.listen(PORT, HOST, () => {
  const proto = useTls ? 'https' : 'http';
  console.log(`\nكاشير — الخادم يعمل (الإصدار ${VERSION})`);
  console.log(`  التطبيق:     ${proto}://localhost:${PORT}/${env.KASHIER_NO_STATIC ? '  (معطّل: KASHIER_NO_STATIC)' : ''}`);
  console.log(`  عنوان الخادم في الإعدادات:  ${proto}://<عنوان-هذا-الجهاز>:${PORT}`);
  console.log(`  مفتاح الوصول: ${KEY}${generated ? '   (وُلّد الآن وحُفظ في ' + path.relative(ROOT, keyFile) + ')' : env.KASHIER_KEY ? '   (من KASHIER_KEY)' : '   (من ' + path.relative(ROOT, keyFile) + ')'}`);
  console.log(`  النسخ تُحفظ في: ${DATA}  (آخر ${KEEP} نسخة)`);
  if (!useTls) console.log('  تنبيه: بدون https لن تعمل الكاميرا من أجهزة أخرى (localhost مستثنى). استخدم KASHIER_CERT/KASHIER_KEYFILE أو وكيلاً عكسياً (Caddy/nginx).');
  console.log('');
});
