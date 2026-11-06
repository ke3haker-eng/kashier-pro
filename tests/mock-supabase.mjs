// بوابة محاكاة لواجهات Supabase (GoTrue للدخول + PostgREST لاستدعاء الدوال) فوق PostgreSQL 16 حقيقي يحمل supabase/schema.sql.
// الغرض: اختبار تطبيق الويب كاملاً (متصفح حقيقي ← HTTP ← قاعدة بيانات حقيقية بسكيمتنا وقواعد أمانها) دون الحاجة لحساب Supabase.
// حدودها بصراحة: هي ليست Supabase نفسها؛ تحاكي العقد (المسارات/الترويسات/صيغ الأخطاء) الذي نستخدمه فقط، ومُوقِّع JWT وهمي.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PGB = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export async function startMock({ anonKey = 'anon-test-key-' + 'x'.repeat(30), ttl = 3600, confirmEmail = false } = {}) {
  const PORT_PG = 54000 + Math.floor(Math.random() * 900);
  const D = fs.mkdtempSync(path.join('/tmp', 'kp-mock-')); fs.chmodSync(D, 0o755);
  const asRoot = process.getuid?.() === 0;
  const run = (cmd, args, o = {}) => asRoot ? execFileSync('runuser', ['-u', 'claude', '--', cmd, ...args], { encoding: 'utf8', ...o }) : execFileSync(cmd, args, { encoding: 'utf8', ...o });
  if (asRoot) execFileSync('chown', ['claude:claude', D]);
  run(`${PGB}/initdb`, ['-D', D + '/data', '-A', 'trust', '-U', 'postgres', '-E', 'UTF8'], { stdio: 'ignore' });
  run(`${PGB}/pg_ctl`, ['-D', D + '/data', '-o', `-p ${PORT_PG} -k ${D} -c listen_addresses='' -c fsync=off -c max_connections=200`, '-l', D + '/log', '-w', 'start'], { stdio: 'ignore' });
  const PSQL = ['-h', D, '-p', String(PORT_PG), '-U', 'postgres', '-d', 'kp', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
  spawnSync('psql', ['-h', D, '-p', String(PORT_PG), '-U', 'postgres', '-X', '-q', '-c', 'create database kp'], { encoding: 'utf8' });
  const admin = sql => { const r = spawnSync('psql', [...PSQL, '-c', sql], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  admin(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  const sr = spawnSync('psql', [...PSQL.filter(x => x !== '-q'), '-f', '-'], { input: fs.readFileSync(path.join(SRC, 'supabase', 'schema.sql'), 'utf8'), encoding: 'utf8' }); if (sr.status !== 0) throw new Error(sr.stderr);
  const sigs = JSON.parse(admin(`select json_agg(row_to_json(t)) from (select p.proname as name, p.proargnames as names, (select json_agg(format_type(x::oid, null)) from unnest(string_to_array(p.proargtypes::text, ' ')) x) as types from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'kp\\_%' and has_function_privilege('authenticated', p.oid, 'execute')) t`));
  const FN = Object.fromEntries(sigs.map(s => [s.name, (s.names || []).map((n, i) => ({ n, t: s.types[i] }))]));

  // ---------- حالة الخدمة ----------
  const users = new Map();            // email -> {id, email, password}
  const tokens = new Map();           // access_token -> {sub, exp}
  const refresh = new Map();          // refresh_token -> user
  const m = { url: '', anonKey, port: 0, offline: false, delayMs: 0, log: [], dropOnce: new Set(), ttl, confirmEmail, users, FN };
  m.count = fn => m.log.filter(l => l.fn === fn).length;
  m.reset = () => { m.log.length = 0; };
  m.admin = admin; m.expireTokens = () => { for (const t of tokens.values()) t.exp = 1; };

  const session = u => {
    const exp = Math.floor(Date.now() / 1000) + m.ttl, payload = { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp };
    const at = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${crypto.randomBytes(12).toString('base64url')}`; tokens.set(at, { sub: u.id, exp });
    const rt = crypto.randomBytes(8).toString('hex'); refresh.set(rt, u);
    return { access_token: at, token_type: 'bearer', expires_in: m.ttl, expires_at: exp, refresh_token: rt, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } };
  };
  const callRpc = (fn, userId, body, role = 'authenticated') => new Promise(resolve => {
    const sig = FN[fn]; if (!sig) return resolve({ status: 404, body: { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${fn} in the schema cache` } });
    let pre = '', n = 0; const parts = [], mine = [];
    for (const [k, v] of Object.entries(body || {})) {
      const s = sig.find(x => x.n === k); if (!s) return resolve({ status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn}(${k}) in the schema cache` } });
      if (v === null) { parts.push(`${k} := NULL::${s.t}`); continue; }   // JSON null = SQL NULL (كما يفعل PostgREST)
      const f = path.join(D, `a-${process.pid}-${Date.now()}-${++n}-${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)); mine.push(f);
      pre += `\\set a_${k} \`cat ${f}\`\n`; parts.push(`${k} := :'a_${k}'::${s.t}`);
    }
    const input = `${pre}begin;\nset local role ${role};\nselect set_config('request.jwt.claims', :'claims', true) as _c \\gset\nselect public.${fn}(${parts.join(', ')});\ncommit;\n`;
    const p = execFile('psql', [...PSQL, '-v', 'claims=' + JSON.stringify(userId ? { sub: userId, role } : { role })], { encoding: 'utf8', maxBuffer: 1 << 28 }, (err, stdout, stderr) => {
      for (const f of mine) try { fs.rmSync(f); } catch { }
      if (err) { const mm = /ERROR:\s+([^\n]*)/.exec(stderr || ''); return resolve({ status: /permission denied/.test(stderr) ? 403 : 400, body: { code: /permission denied/.test(stderr) ? '42501' : 'P0001', details: null, hint: null, message: mm ? mm[1] : String(stderr) } }); }
      const out = stdout.trim().split('\n').filter(Boolean).pop(); resolve({ status: 200, body: out ? JSON.parse(out) : null });
    }); p.stdin.end(input);
  });

  const srv = http.createServer(async (req, res) => {
    const t0 = Date.now(); const u = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info, accept-profile, content-profile', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' };
    const send = (status, body) => { const b = body === undefined ? '' : JSON.stringify(body); res.writeHead(status, { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
    if (m.offline) return req.socket.destroy();
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (m.delayMs) await new Promise(r => setTimeout(r, m.delayMs));
    let raw = ''; for await (const c of req) raw += c; let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { }
    const fnName = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname)?.[1] || u.pathname;
    const entry = { method: req.method, path: u.pathname, fn: fnName, t: t0 }; m.log.push(entry);
    if (req.headers.apikey !== m.anonKey) return send(401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });

    // ---- GoTrue ----
    if (u.pathname === '/auth/v1/settings') return send(200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: !m.confirmEmail });
    if (u.pathname === '/auth/v1/signup' && req.method === 'POST') {
      const { email, password } = body || {}; if (!/^\S+@\S+\.\S+$/.test(email || '')) return send(400, { code: 400, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' });
      if ((password || '').length < 6) return send(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      if (users.has(email)) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      const user = { id: crypto.randomUUID(), email, password }; users.set(email, user); admin(`insert into auth.users values ('${user.id}', '${email.replace(/'/g, "''")}')`);
      if (m.confirmEmail) return send(200, { id: user.id, email, confirmation_sent_at: new Date().toISOString() });
      return send(200, session(user));
    }
    if (u.pathname === '/auth/v1/token' && req.method === 'POST') {
      const gt = u.searchParams.get('grant_type');
      if (gt === 'password') { const us = users.get(body?.email); if (!us || us.password !== body.password) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); return send(200, session(us)); }
      if (gt === 'refresh_token') { const us = refresh.get(body?.refresh_token); if (!us) return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }); refresh.delete(body.refresh_token); return send(200, session(us)); }
    }
    if (u.pathname === '/auth/v1/logout') return send(204);

    // ---- PostgREST (دوال RPC فقط) ----
    const mm = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
    if (mm && req.method === 'POST') {
      const tk = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]; const info = tk && tokens.get(tk);
      if (!tk || tk === m.anonKey) {             // زائر بلا تسجيل دخول: مثل Supabase، المفتاح العام وحده يعني دور anon
        const r = await callRpc(mm[1], null, body, 'anon'); entry.status = r.status; entry.ms = Date.now() - t0; return send(r.status, r.body);
      }
      if (!info) return send(401, { code: 'PGRST301', details: null, hint: null, message: 'JWT invalid' });
      if (info.exp * 1000 < Date.now()) return send(401, { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' });
      const r = await callRpc(mm[1], info.sub, body); entry.status = r.status; entry.ms = Date.now() - t0;
      if (m.dropOnce.has(mm[1])) { m.dropOnce.delete(mm[1]); entry.dropped = true; return req.socket.destroy(); }   // نُفِّذت على القاعدة لكن الاستجابة ضاعت (انقطاع شبكة)
      return send(r.status, r.body);
    }
    send(404, { message: 'not found' });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); m.port = srv.address().port; m.url = `http://127.0.0.1:${m.port}`;
  m.stop = async () => { srv.closeAllConnections?.(); srv.close(); try { run(`${PGB}/pg_ctl`, ['-D', D + '/data', 'stop', '-m', 'immediate'], { stdio: 'ignore' }); } catch { } fs.rmSync(D, { recursive: true, force: true }); };
  return m;
}
