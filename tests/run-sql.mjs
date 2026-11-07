// اختبار مخطط Supabase (supabase/schema.sql) على PostgreSQL 16 حقيقي: عزل المتاجر، الأدوار، التعارض، التكرار، الحذف، الترقيم، الاستبدال الكامل، والتزامن.
// يشغّل مجموعة PostgreSQL مؤقتة (initdb) بمستخدم غير root ويمسحها بعد الانتهاء. يحتاج مجلد ثنائيات PostgreSQL (PG_BIN) — الافتراضي /usr/lib/postgresql/16/bin.
// ملاحظة صريحة: هذا يختبر SQL فعلياً، لكن بدون طبقة Supabase نفسها (GoTrue/PostgREST) — نحاكي auth.uid() ودور authenticated كما يفعل Supabase.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PGB = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
const PORT = 54000 + Math.floor(Math.random() * 900);
const D = fs.mkdtempSync(path.join('/tmp', 'kp-pg-')); fs.chmodSync(D, 0o755);
const asPg = process.getuid?.() === 0 ? ['runuser', ['-u', 'claude', '--']] : null;   // initdb يرفض العمل كـ root
const run = (cmd, args, o = {}) => asPg ? execFileSync(asPg[0], [...asPg[1], cmd, ...args], { encoding: 'utf8', ...o }) : execFileSync(cmd, args, { encoding: 'utf8', ...o });
if (asPg) execFileSync('chown', ['claude:claude', D]);

const res = []; const T = async (t, fn) => { try { const n = await fn(); res.push([t, true, n || '']); console.log('✔', t, n ? '— ' + n : ''); } catch (e) { res.push([t, false, e.message]); console.log('✘', t, '—', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''}: المتوقع ${JSON.stringify(b)} والفعلي ${JSON.stringify(a)}`); };

const PSQL = ['-h', D, '-p', String(PORT), '-U', 'postgres', '-d', 'kp', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
const uid = () => crypto.randomUUID();
// يشغّل دالة RPC كمستخدم (أو بلا مستخدم) بدور authenticated/anon. الوسائط بأسمائها كما يمرّرها PostgREST: { p_ops: {...} }
const TYPES = { p_ops: 'jsonb', p_data: 'jsonb', p_since: 'bigint', p_limit: 'integer', p_name: 'text', p_code: 'text', p_user: 'uuid', p_slug: 'text', p_key: 'text', p_ids: 'text[]', p_proof: 'text', p_phone: 'text', p_body: 'text', p_img: 'text', p_after: 'bigint', p_id: 'bigint', p_on: 'boolean', p_status: 'text', p_note: 'text', p_hold: 'text', p_buyer: 'text', p_order: 'uuid', p_days: 'integer' };
let seqFile = 0;
function prep(user, fn, args = {}, role = 'authenticated') {
  const claims = user ? JSON.stringify({ sub: user, role }) : '';
  const names = Object.keys(args); let pre = '';
  for (const n of names) { const f = path.join(D, `arg-${process.pid}-${++seqFile}.json`); fs.writeFileSync(f, typeof args[n] === 'object' ? JSON.stringify(args[n]) : String(args[n])); pre += `\\set a_${n} \`cat ${f}\`\n`; }
  const call = names.map(n => `${n} := :'a_${n}'::${TYPES[n]}`).join(', ');
  return { vars: ['-v', 'claims=' + claims], input: `${pre}begin;\nset local role ${role};\nselect set_config('request.jwt.claims', :'claims', true) as _c \\gset\nselect public.${fn}(${call});\ncommit;\n` };
}
function rpc(user, fn, args, role) {
  const q = prep(user, fn, args, role);
  const r = spawnSync('psql', [...PSQL, ...q.vars], { input: q.input, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { const m = /ERROR:\s+([^\n]*)/.exec(r.stderr || ''); throw Object.assign(new Error(m ? m[1] : r.stderr), { pg: true }); }
  const out = r.stdout.trim().split('\n').filter(Boolean).pop();
  return out ? JSON.parse(out) : null;
}
const rpcAsync = (user, fn, args) => new Promise(resolve => {
  const q = prep(user, fn, args);
  const p = execFile('psql', [...PSQL, ...q.vars], { encoding: 'utf8', maxBuffer: 1 << 28 }, (err, stdout, stderr) => {
    if (err) { const m = /ERROR:\s+([^\n]*)/.exec(stderr || ''); return resolve({ err: m ? m[1] : String(stderr || err) }); }
    const out = stdout.trim().split('\n').filter(Boolean).pop(); resolve({ ok: out ? JSON.parse(out) : null });
  }); p.stdin.end(q.input);
});
const fails = (fn, re, m) => { try { fn(); } catch (e) { assert(re.test(e.message), (m || '') + ' — رسالة الخطأ غير المتوقعة: ' + e.message); return; } throw new Error((m || '') + ' — كان يجب أن يفشل'); };
const admin = sql => spawnSync('psql', [...PSQL, '-c', sql], { encoding: 'utf8' }).stdout.trim();

const put = (store, id, d, base = null) => ({ put: { [store]: [{ id, base, d: { id, ...d } }] } });
const commit = (u, ops) => rpc(u, 'kp_commit', { p_ops: ops });
const changes = (u, since = 0, limit = 1000) => rpc(u, 'kp_changes', { p_since: since, p_limit: limit });

try {
  run(`${PGB}/initdb`, ['-D', D + '/data', '-A', 'trust', '-U', 'postgres', '-E', 'UTF8'], { stdio: 'ignore' });
  run(`${PGB}/pg_ctl`, ['-D', D + '/data', '-o', `-p ${PORT} -k ${D} -c listen_addresses='' -c fsync=off`, '-l', D + '/log', '-w', 'start'], { stdio: 'ignore' });
  spawnSync('psql', ['-h', D, '-p', String(PORT), '-U', 'postgres', '-X', '-q', '-c', 'create database kp'], { encoding: 'utf8' });
  // محاكاة ما توفّره Supabase: الأدوار anon/authenticated ومخطط auth (users + uid())
  admin(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  const schema = fs.readFileSync(path.join(SRC, 'supabase', 'schema.sql'), 'utf8');
  const apply = () => { const r = spawnSync('psql', [...PSQL.filter(x => x !== '-q'), '-f', '-'], { input: schema, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };

  const A = uid(), B = uid(), C = uid(), D2 = uid();
  for (const [u, m] of [[A, 'a@shop.test'], [B, 'b@shop.test'], [C, 'c@other.test'], [D2, 'd@shop.test']]) admin(`insert into auth.users values ('${u}', '${m}')`);
  let codeA;

  await T('المخطط يُطبَّق بلا أخطاء ويمكن تشغيله مرتين (آمن للتحديث)', async () => { apply(); apply(); return 'مرتان بلا خطأ'; });

  await T('الأمان: بلا تسجيل دخول مرفوض، ودور anon لا يستطيع استدعاء الدوال، والجداول مقفلة مباشرة', async () => {
    fails(() => rpc(null, 'kp_me'), /KP_UNAUTH|permission denied/, 'بلا مستخدم');
    fails(() => rpc(A, 'kp_me', undefined, 'anon'), /permission denied/, 'anon');
    const r = spawnSync('psql', [...PSQL, '-c', 'set role authenticated; select count(*) from public.kp_docs'], { encoding: 'utf8' }); assert(/permission denied/.test(r.stderr), 'القراءة المباشرة من kp_docs يجب أن تُرفض: ' + r.stderr);
    const w = spawnSync('psql', [...PSQL, '-c', "set role authenticated; insert into public.kp_shops(name, join_code, created_by) values ('x','y',gen_random_uuid())"], { encoding: 'utf8' }); assert(/permission denied/.test(w.stderr), 'الكتابة المباشرة يجب أن تُرفض');
    const f = spawnSync('psql', [...PSQL, '-c', "set role authenticated; select public.kp_ctx()"], { encoding: 'utf8' }); assert(/permission denied/.test(f.stderr), 'الدوال الداخلية يجب ألا تُستدعى من الخارج');
    return 'unauth/anon/جداول/دوال داخلية كلها مرفوضة';
  });

  await T('إنشاء متجر: المالك owner مع رمز انضمام؛ ولا يُنشأ متجر ثانٍ لنفس المستخدم', async () => {
    eq(rpc(A, 'kp_me').shop_id, null, 'قبل الإنشاء');
    const me = rpc(A, 'kp_create_shop', { p_name: 'سوبر ماركت الأمل' });
    eq([me.role, me.shop_name, me.email, me.join_code.length], ['owner', 'سوبر ماركت الأمل', 'a@shop.test', 20]); codeA = me.join_code;
    fails(() => rpc(A, 'kp_create_shop', { p_name: 'ثاني' }), /KP_ALREADY_MEMBER/); return 'رمز الانضمام ' + codeA.length + ' خانة';
  });

  await T('الانضمام برمز: الخاطئ يُرفض، والصحيح (بأي حالة أحرف وفواصل) ينضم كموظف ولا يرى الرمز', async () => {
    fails(() => rpc(B, 'kp_join_shop', { p_code: 'WRONGCODE' }), /KP_BAD_CODE/);
    const pretty = codeA.toLowerCase().replace(/(.{4})/g, '$1-');
    const me = rpc(B, 'kp_join_shop', { p_code: pretty }); eq([me.role, me.join_code, me.members], ['staff', undefined, undefined], 'الموظف لا يرى الرمز ولا الأعضاء');
    const owner = rpc(A, 'kp_me'); eq(owner.members.map(m => m.role).sort(), ['owner', 'staff'], 'المالك يرى الأعضاء');
    fails(() => rpc(B, 'kp_join_shop', { p_code: codeA }), /KP_ALREADY_MEMBER/); return 'ok';
  });

  await T('عزل المتاجر: متجر آخر لا يرى بيانات الأول ولا يستطيع تعديلها', async () => {
    rpc(C, 'kp_create_shop', { p_name: 'متجر آخر' });
    commit(A, put('products', 'p1', { name: 'حليب', price: 5 }));
    eq(changes(C).docs.length, 0, 'المتجر الآخر يرى مستندات');
    commit(C, put('products', 'p1', { name: 'سرّي للمتجر الآخر', price: 9 }));          // نفس المعرّف في متجر آخر = مستند مستقل
    eq(changes(A).docs.map(d => d.d.name), ['حليب'], 'بيانات المتجر الأول تغيّرت!');
    eq(changes(C).docs.map(d => d.d.name), ['سرّي للمتجر الآخر']);
    fails(() => commit(D2, put('products', 'x', { name: 'x' })), /KP_NO_SHOP/, 'مستخدم بلا متجر'); return 'ok';
  });

  await T('التعارض: base خاطئ يُرفض ويُلغى كل شيء في نفس العملية (ذرّية)', async () => {
    const r1 = commit(A, put('products', 'p2', { name: 'جبنة', stock: 10 })); eq(r1.revs.products.p2, 1);
    const r2 = commit(A, put('products', 'p2', { name: 'جبنة', stock: 9 }, 1)); eq(r2.revs.products.p2, 2);
    fails(() => commit(A, { put: { products: [{ id: 'p2', base: 1, d: { id: 'p2', stock: 8 } }], invoices: [{ id: 'inv-x', base: null, d: { id: 'inv-x', total: 1 } }] } }), /KP_CONFLICT:products\/p2/, 'بيع على نسخة قديمة');
    eq(changes(A).docs.find(d => d.i === 'inv-x'), undefined, 'الفاتورة حُفظت رغم فشل العملية!');
    eq(changes(A).docs.find(d => d.i === 'p2').d.stock, 9);
    fails(() => commit(A, put('products', 'p2', { name: 'x' }, null)), /KP_CONFLICT/, 'إنشاء مستند موجود');
    fails(() => commit(A, put('products', 'nope', { name: 'x' }, 3)), /KP_CONFLICT/, 'تعديل مستند غير موجود'); return 'ok';
  });

  await T('منع التكرار عند إعادة الإرسال: نفس معرّف العملية لا يُنفَّذ مرتين', async () => {
    const op = { op: 'op-' + uid(), ...put('invoices', 'inv-1', { no: 'INV-000001', total: 10 }) };
    const a = commit(A, op), b = commit(A, op);
    eq([a.replayed, b.replayed, b.revs.invoices['inv-1']], [undefined, true, 1], 'الإعادة');
    eq(changes(A).docs.filter(d => d.i === 'inv-1').length, 1); return 'ok';
  });

  await T('الحذف: مستند محذوف يختفي من التحميل الأول ويصل كـ tombstone للأجهزة التي تتابع، ويمكن إعادة إنشائه', async () => {
    const before = changes(A).seq;
    fails(() => commit(A, { del: { products: [{ id: 'p2', base: 1 }] } }), /KP_CONFLICT/, 'حذف بنسخة قديمة');
    commit(A, { del: { products: [{ id: 'p2', base: 2 }] } });
    eq(changes(A).docs.find(d => d.i === 'p2'), undefined, 'ظهر في التحميل الأول');
    const inc = changes(A, before).docs.find(d => d.i === 'p2'); eq([inc.x, inc.d], [true, null], 'tombstone');
    commit(A, { del: { products: [{ id: 'غير-موجود', base: null }] } });                     // حذف غير موجود: لا خطأ
    const re = commit(A, put('products', 'p2', { name: 'جبنة جديدة' }, null)); assert(re.revs.products.p2 === 4, 'النسخة بعد الحذف وإعادة الإنشاء: ' + JSON.stringify(re)); return 'ok';
  });

  await T('الموظف: يبيع ويكتب المنتجات والفواتير، لكن لا يكتب المستخدمين ولا يمسح مخزناً ولا يستعيد نسخة', async () => {
    commit(B, put('invoices', 'inv-b', { no: 'INV-000002' }));
    fails(() => commit(B, put('users', 'u1', { name: 'x', pin: 'h' })), /KP_FORBIDDEN/, 'كتابة users');
    fails(() => commit(B, { del: { users: [{ id: 'u1' }] } }), /KP_FORBIDDEN/, 'حذف users');
    fails(() => commit(B, { clear: ['invoices'] }), /KP_FORBIDDEN/, 'مسح مخزن');
    fails(() => rpc(B, 'kp_replace_all', { p_data: { products: [] } }), /KP_FORBIDDEN/, 'استعادة');
    fails(() => rpc(B, 'kp_rotate_join_code'), /KP_FORBIDDEN/, 'تدوير الرمز');
    fails(() => rpc(B, 'kp_remove_member', { p_user: A }), /KP_FORBIDDEN/, 'طرد عضو');
    commit(A, put('users', 'u1', { name: 'مدير', role: 'manager' })); return 'ok';
  });

  await T('مخازن غير معروفة ومستندات مشوّهة تُرفض', async () => {
    fails(() => commit(A, put('hackers', 'x', { a: 1 })), /KP_BAD_STORE/);
    fails(() => commit(A, { put: { products: [{ id: '', base: null, d: { a: 1 } }] } }), /KP_BAD_DOC/);
    fails(() => commit(A, { put: { products: [{ id: 'z', base: null, d: 'نص' }] } }), /KP_BAD_DOC/); return 'ok';
  });

  await T('الجلب المتدرّج: حد الصفحة و more و seq بلا فقد ولا تكرار', async () => {
    const ops = { put: { moves: Array.from({ length: 25 }, (_, i) => ({ id: 'm' + i, base: null, d: { id: 'm' + i, n: i } })) } }; commit(A, ops);
    let since = 0, ids = [], pages = 0;
    for (;;) { const r = changes(A, since, 10); ids.push(...r.docs.filter(d => d.s === 'moves').map(d => d.i)); since = r.seq; pages++; if (!r.more) break; assert(pages < 20, 'حلقة لا تنتهي'); }
    eq(new Set(ids).size, 25, 'عدد الحركات'); assert(pages >= 3, 'الصفحات: ' + pages); return pages + ' صفحات';
  });

  await T('الاستبدال الكامل (استعادة/ترحيل): المالك فقط، يُبقي الجديد ويحذف القديم ويصل كتغييرات للأجهزة الأخرى', async () => {
    const seq0 = changes(A).seq;
    const data = { meta: [{ k: 'settings', v: { name: 'المتجر' } }, { k: 'counters', v: { invoice: 7 } }], products: [{ id: 'n1', name: 'أرز' }, { id: 'n2', name: 'سكر' }, { id: 'n1', name: 'أرز (مكرر)' }], users: [{ id: 'mgr', name: 'م' }] };
    rpc(A, 'kp_replace_all', { p_data: data });
    const all = changes(A).docs; eq(all.map(d => d.s + '/' + d.i).sort(), ['meta/counters', 'meta/settings', 'products/n1', 'products/n2', 'users/mgr'].sort(), 'المحتوى بعد الاستبدال');
    eq(all.find(d => d.i === 'n1').d.name, 'أرز (مكرر)', 'المكرر داخل الملف: يؤخذ الأخير');
    const inc = changes(A, seq0).docs; assert(inc.some(d => d.i === 'p2' && d.x), 'القديم لم يصل كحذف'); assert(inc.some(d => d.i === 'n2' && !d.x), 'الجديد لم يصل');
    eq(changes(C).docs.map(d => d.d.name), ['سرّي للمتجر الآخر'], 'متجر آخر تأثّر بالاستبدال!');
    fails(() => rpc(A, 'kp_replace_all', { p_data: { hackers: [] } }), /KP_BAD_STORE/); fails(() => rpc(A, 'kp_replace_all', { p_data: { products: 'x' } }), /KP_BAD_DOC/);
    return 'ok';
  });

  await T('المالك: مسح مخزن كامل، تدوير رمز الانضمام (القديم يتوقف)، وطرد موظف', async () => {
    commit(A, { clear: ['moves'] }); eq(changes(A).docs.filter(d => d.s === 'moves').length, 0);
    const me = rpc(A, 'kp_rotate_join_code'); assert(me.join_code !== codeA, 'الرمز لم يتغيّر'); fails(() => rpc(D2, 'kp_join_shop', { p_code: codeA }), /KP_BAD_CODE/, 'الرمز القديم');
    rpc(D2, 'kp_join_shop', { p_code: me.join_code });
    fails(() => rpc(A, 'kp_remove_member', { p_user: A }), /KP_CANNOT_REMOVE_SELF/);
    rpc(A, 'kp_remove_member', { p_user: D2 }); fails(() => commit(D2, put('products', 'q', { n: 1 })), /KP_NO_SHOP/, 'المطرود');
    rpc(C, 'kp_remove_member', { p_user: B }); /* مالك متجر آخر: لا أثر له */ eq(rpc(A, 'kp_me').members.length, 2, 'B طُرد بواسطة مالك متجر آخر!'); return 'ok';
  });

  await T('التزامن الحقيقي: 8 جلسات تعدّل نفس المستند بنفس النسخة — ينجح واحد فقط والباقي KP_CONFLICT', async () => {
    commit(A, put('products', 'hot', { name: 'الأخيرة', stock: 1 }));
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => rpcAsync(A, 'kp_commit', { p_ops: put('products', 'hot', { name: 'الأخيرة', stock: 0, by: i }, 1) })));
    const ok = rs.filter(r => r.ok), bad = rs.filter(r => r.err);
    eq([ok.length, bad.length], [1, 7], 'الناجح/الفاشل'); assert(bad.every(r => /KP_CONFLICT/.test(r.err)), 'أخطاء غير متوقعة: ' + bad.map(b => b.err).join('|'));
    eq(changes(A).docs.find(d => d.i === 'hot').r, 2); return 'بيع آخر قطعة من جهازين معاً لا يُنفَّذ إلا مرة واحدة';
  });

  await T('التزامن: 12 جلسة تكتب مستندات مختلفة معاً — كلها تنجح وأرقام seq فريدة ومرتّبة', async () => {
    const before = changes(A).seq;
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => rpcAsync(A, 'kp_commit', { p_ops: put('audit', 'au' + i, { n: i }) })));
    assert(rs.every(r => r.ok), 'فشل بعضها: ' + JSON.stringify(rs.filter(r => r.err)));
    const inc = changes(A, before).docs.filter(d => d.s === 'audit'); eq(inc.length, 12); const qs = inc.map(d => d.q); eq(new Set(qs).size, 12, 'seq مكرر'); eq([...qs].sort((a, b) => a - b), qs, 'غير مرتّب'); return 'ok';
  });


  // ===== المتجر الإلكتروني (واجهة المشترين) =====
  const K1 = 'k1_' + 'a'.repeat(30), K2 = 'k2_' + 'b'.repeat(30), K3 = 'k3_' + 'c'.repeat(30), IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  const anon = (fn, args) => rpc(null, fn, args, 'anon');
  const ord = (key, o, slug = 'amal-shop') => anon('kp_store_order', { p_slug: slug, p_key: key, p_data: o });
  const base = { name: 'خالد', phone: '0501234567', delivery: 'pickup', pay: 'cash', items: [{ id: 'sp2', qty: 1 }] };

  await T('المتجر: النشر للمالك فقط، الـ slug يُتحقَّق منه وفريد، وقبل النشر الزائر لا يرى شيئاً', async () => {
    fails(() => anon('kp_store_info', { p_slug: 'amal-shop' }), /KP_NO_STORE/, 'قبل النشر');
    fails(() => rpc(B, 'kp_store_publish', { p_slug: 'amal-shop', p_on: true }), /KP_FORBIDDEN/, 'الموظف');
    fails(() => rpc(A, 'kp_store_publish', { p_slug: 'A b', p_on: true }), /KP_BAD_SLUG/);
    rpc(C, 'kp_store_publish', { p_slug: 'other-shop', p_on: true });
    fails(() => rpc(A, 'kp_store_publish', { p_slug: 'other-shop', p_on: true }), /KP_SLUG_TAKEN/, 'مأخوذ');
    const r = rpc(A, 'kp_store_publish', { p_slug: 'Amal-Shop', p_on: true }); eq([r.slug, r.on], ['amal-shop', true]);
    return 'owner فقط، slug صحيح وفريد';
  });

  await T('المتجر: الكتالوج العام لا يكشف التكلفة/المورد/الكمية الدقيقة، ويخفي المخفي والمؤرشف، ويحسب العروض', async () => {
    const meta = { k: 'settings', v: { name: 'سوبر الأمل', phone: '0112223344', cur: 'ر.س', stock: { lowDefault: 5 }, secretField: 'x', store: { title: 'متجر الأمل', about: 'أفضل الأسعار', whatsapp: '+966 50 123 4567', delivery: { home: true, pickup: true, fee: 10, free_over: 100, min: 20 }, pay: { cash: true, transfer: true, instructions: 'حوّل على آيبان 123' } } } };
    const cur = changes(A).docs.find(d => d.s === 'meta' && d.i === 'settings'); commit(A, { put: { meta: [{ id: 'settings', base: cur ? cur.r : null, d: meta }] } });
    commit(A, { put: { categories: [{ id: 'c1', base: null, d: { id: 'c1', name: 'ألبان', color: '#fff' } }] } });
    commit(A, put('products', 'sp1', { name: 'حليب', price: 10, cost: 6, supplierId: 'sup1', stock: 50, cat: 'c1', desc: 'حليب طازج', img: IMG, unit: 'pc', track: true }));
    commit(A, put('products', 'sp2', { name: 'جبنة', price: 20, cost: 12, stock: 3, unit: 'pc', track: true }));
    commit(A, put('products', 'sp3', { name: 'مخفي', price: 5, stock: 9, hideOnline: true }));
    commit(A, put('products', 'sp4', { name: 'مؤرشف', price: 5, stock: 9, active: false }));
    commit(A, put('products', 'sp5', { name: 'نافد', price: 7, stock: 0, track: true }));
    commit(A, put('products', 'sp6', { name: 'خبز', price: 3, track: false }));
    commit(A, put('products', 'sp7', { name: 'أرز', price: 40, stock: 100, unit: 'kg' }));
    commit(A, put('offers', 'of1', { name: 'خصم الحليب', pid: 'sp1', type: 'pct', value: 10, active: true }));
    commit(A, put('offers', 'of2', { name: 'منتهي', pid: 'sp2', type: 'pct', value: 50, active: true, end: '2000-01-01' }));
    commit(A, put('offers', 'of3', { name: '1+1', pid: 'sp6', type: 'bogo', buy: 1, get: 1, active: true }));
    const info = anon('kp_store_info', { p_slug: 'AMAL-shop' });
    eq([info.name, info.title, info.whatsapp, info.cur, info.delivery.fee, info.pay.instructions, info.categories.length], ['سوبر الأمل', 'متجر الأمل', '966501234567', 'ر.س', 10, 'حوّل على آيبان 123', 1]);
    assert(!JSON.stringify(info).includes('secretField'), 'حقل غير مُدرَج في القائمة البيضاء خرج للزائر');
    const ps = anon('kp_store_products', { p_slug: 'amal-shop' }); const by = Object.fromEntries(ps.map(p => [p.id, p]));
    eq(ps.map(p => p.id).filter(i => i.startsWith('sp')).sort(), ['sp1', 'sp2', 'sp5', 'sp6', 'sp7'], 'المخفي والمؤرشف لا يظهران');
    eq([by.sp1.price, by.sp1.old, by.sp1.tag, by.sp2.price, by.sp2.old, by.sp6.old], [9, 10, 'خصم 10%', 20, null, null], 'العروض (المنتهي وbogo لا يظهران)');
    eq([by.sp1.st, by.sp2.st, by.sp5.st, by.sp6.st, by.sp7.st], ['in', 'low', 'out', 'in', 'in'], 'حالة التوفر');
    const raw = JSON.stringify(ps); for (const bad of ['cost', 'supplierId', '"stock"']) assert(!raw.includes(bad), 'تسريب: ' + bad);
    eq([by.sp1.img, by.sp2.img], [true, false], 'علم وجود صورة بلا نقلها');
    const im = anon('kp_store_images', { p_slug: 'amal-shop', p_ids: '{sp1,sp3,sp2}' }); eq(Object.keys(im), ['sp1'], 'الصورة للظاهر فقط'); eq(im.sp1, IMG);
    return 'قائمة بيضاء + عروض + توفر + صور عند الطلب';
  });

  let o1;
  await T('الطلب: السعر يُحسب على الخادم (لا يُقبل سعر من المتصفح)، مع رسوم التوصيل والحد الأدنى والتوصيل المجاني', async () => {
    o1 = ord(K1, { ...base, items: [{ id: 'sp1', qty: 2, price: 0.01 }, { id: 'sp2', qty: 1 }], total: 1 });
    eq([o1.no, o1.subtotal, o1.fee, o1.total, o1.status], [1, 38, 0, 38, 'new'], 'استلام من المحل: 2×9 + 20');
    const h = ord(K2, { ...base, delivery: 'home', address: 'الرياض شارع التحلية', items: [{ id: 'sp7', qty: 3 }] }); eq([h.no, h.subtotal, h.fee, h.total], [2, 120, 0, 120], 'فوق حد التوصيل المجاني');
    const h2 = ord(K2, { ...base, delivery: 'home', address: 'الرياض شارع التحلية', items: [{ id: 'sp1', qty: 3 }] }); eq([h2.subtotal, h2.fee, h2.total], [27, 10, 37], 'رسوم التوصيل');
    fails(() => ord(K3, { ...base, items: [{ id: 'sp6', qty: 2 }] }), /KP_MIN:20/, 'أقل من الحد الأدنى (6<20)');
    return 'مجموع الخادم 38 رغم أن المتصفح أرسل سعر 0.01 وإجمالي 1';
  });

  await T('الطلب: رفض المدخلات الخاطئة (مفتاح/اسم/هاتف/عنوان/كمية/منتج مخفي/مخزون/صورة)', async () => {
    fails(() => ord('short', base), /KP_BAD_KEY/); fails(() => ord(K3, { ...base, name: 'ا' }), /KP_NEED_NAME/); fails(() => ord(K3, { ...base, phone: '12' }), /KP_NEED_PHONE/);
    fails(() => ord(K3, { ...base, delivery: 'home', address: '' }), /KP_NEED_ADDRESS/); fails(() => ord(K3, { ...base, items: [] }), /KP_EMPTY_CART/);
    fails(() => ord(K3, { ...base, items: [{ id: 'sp1', qty: 0 }] }), /KP_BAD_QTY/); fails(() => ord(K3, { ...base, items: [{ id: 'sp1', qty: 1.5 }] }), /KP_BAD_QTY/, 'كسر لمنتج بالقطعة');
    fails(() => ord(K3, { ...base, items: [{ id: 'sp3', qty: 1 }] }), /KP_GONE/, 'مخفي'); fails(() => ord(K3, { ...base, items: [{ id: 'nope', qty: 1 }] }), /KP_GONE/);
    fails(() => ord(K3, { ...base, items: [{ id: 'sp5', qty: 1 }] }), /KP_STOCK:نافد/, 'نفد'); fails(() => ord(K3, { ...base, items: [{ id: 'sp2', qty: 4 }] }), /KP_STOCK:جبنة/, 'أكثر من المتوفر');
    fails(() => ord(K3, { ...base, proof: 'http://x/y.jpg' }), /KP_BAD_IMAGE/); fails(() => ord(K3, { ...base, proof: 'data:image/jpeg;base64,' + 'A'.repeat(950000) }), /KP_IMAGE_BIG/);
    fails(() => ord(K3, base, 'no-such-shop'), /KP_NO_STORE/);
    const st = rpc(A, 'kp_store_publish', { p_slug: 'amal-shop', p_on: true }); assert(st.on);
    return 'كل الحالات رُفضت برموز واضحة';
  });

  await T('العزل: كل مشترٍ يرى طلباته ومحادثته فقط، والإشعار لا يُرفع لطلب غيره', async () => {
    const m1 = anon('kp_store_orders', { p_slug: 'amal-shop', p_key: K1 }), m2 = anon('kp_store_orders', { p_slug: 'amal-shop', p_key: K2 }), m3 = anon('kp_store_orders', { p_slug: 'amal-shop', p_key: K3 });
    eq([m1.length, m2.length, m3.length], [1, 2, 0]); eq(m1[0].no, 1);
    fails(() => anon('kp_store_order_proof', { p_slug: 'amal-shop', p_key: K2, p_order: o1.id, p_proof: IMG }), /KP_NO_ORDER/, 'طلب غيره');
    anon('kp_store_order_proof', { p_slug: 'amal-shop', p_key: K1, p_order: o1.id, p_proof: IMG });
    eq(anon('kp_store_orders', { p_slug: 'amal-shop', p_key: K1 })[0].proof, true);
    const c3 = anon('kp_store_chat_get', { p_slug: 'amal-shop', p_key: K3, p_after: 0 }); eq(c3.msgs.length, 0, 'مشترٍ بلا محادثة');
    return 'عزل المشترين + إشعار الدفع لصاحبه فقط';
  });

  await T('الإدارة: الطلبات تظهر لأعضاء المتجر فقط، وإشعار الدفع يُجلب عند الطلب، وتغيير الحالة يصل للمشتري', async () => {
    const l = rpc(B, 'kp_orders_list', {}); eq(l.map(o => o.no), [3, 2, 1], 'الأحدث أولاً'); assert(l.find(o => o.no === 1).proof === true, 'الموظف يرى الطلبات وعلم إشعار الدفع');
    eq(rpc(C, 'kp_orders_list', {}).length, 0, 'متجر آخر لا يرى شيئاً');
    eq(rpc(A, 'kp_order_proof', { p_order: o1.id }).img, IMG, 'صورة الإشعار');
    eq(rpc(C, 'kp_order_proof', { p_order: o1.id }).img, null, 'متجر آخر لا يجلب الصورة');
    rpc(B, 'kp_order_set', { p_order: o1.id, p_status: 'confirmed', p_note: 'سيصل خلال ساعة' });
    const mine = anon('kp_store_orders', { p_slug: 'amal-shop', p_key: K1 })[0]; eq([mine.status, mine.shop_note], ['confirmed', 'سيصل خلال ساعة']);
    const ch = anon('kp_store_chat_get', { p_slug: 'amal-shop', p_key: K1, p_after: 0 }).msgs; assert(ch.some(m => m.kind === 'system' && /تم تأكيد طلبك/.test(m.body)), 'رسالة النظام عن تغيير الحالة');
    fails(() => rpc(B, 'kp_order_set', { p_order: o1.id, p_status: 'weird' }), /KP_BAD_STATUS/); fails(() => rpc(C, 'kp_order_set', { p_order: o1.id, p_status: 'done' }), /KP_NO_ORDER/, 'عبر متجر آخر');
    rpc(A, 'kp_order_link', { p_order: o1.id, p_hold: 'hold-123' }); eq(rpc(A, 'kp_orders_list', {}).find(o => o.no === 1).hold_id, 'hold-123');
    return 'تحديث الحالة + رسالة نظام + ربط بنقطة البيع';
  });

  await T('المحادثة: رسائل ذهاباً وإياباً مع عدّادات غير المقروء، وصور عند الطلب، وحد الإرسال', async () => {
    const before = rpc(A, 'kp_store_status', {}); assert(before.unread >= 1, 'غير مقروء من الطلبات');
    const s1 = anon('kp_store_chat_send', { p_slug: 'amal-shop', p_key: K3, p_name: 'سارة', p_phone: '0551112222', p_body: 'هل الحليب متوفر الآن؟' }); assert(s1.id > 0);
    const th = rpc(A, 'kp_threads_list', {}); const t3 = th.find(t => t.name === 'سارة'); eq([t3.unread, t3.last_text], [1, 'هل الحليب متوفر الآن؟']);
    const g = rpc(B, 'kp_chat_staff_get', { p_buyer: t3.buyer, p_after: 0 }); eq(g.msgs.map(m => [m.from, m.body]), [['buyer', 'هل الحليب متوفر الآن؟']]);
    eq(rpc(A, 'kp_threads_list', {}).find(t => t.name === 'سارة').unread, 0, 'قراءة الموظف تصفّر العدّاد');
    rpc(B, 'kp_chat_staff_send', { p_buyer: t3.buyer, p_body: 'نعم متوفر، تفضّلي بالطلب' });
    eq(rpc(A, 'kp_threads_list', {}).find(t => t.name === 'سارة').unread, 0);
    const mine = anon('kp_store_chat_get', { p_slug: 'amal-shop', p_key: K3, p_after: 0 }).msgs; eq(mine.map(m => m.from), ['buyer', 'shop']);
    eq(anon('kp_store_chat_get', { p_slug: 'amal-shop', p_key: K3, p_after: mine[1].id }).msgs.length, 0, 'after: لا جديد');
    const si = anon('kp_store_chat_send', { p_slug: 'amal-shop', p_key: K3, p_name: '', p_phone: '', p_body: '', p_img: IMG });
    const gm = anon('kp_store_chat_get', { p_slug: 'amal-shop', p_key: K3, p_after: mine[1].id }).msgs; eq([gm.length, gm[0].img, gm[0].body], [1, true, ''], 'صورة بلا نص'); eq(anon('kp_store_msg_img', { p_slug: 'amal-shop', p_key: K3, p_id: si.id }).img, IMG);
    eq(anon('kp_store_msg_img', { p_slug: 'amal-shop', p_key: K2, p_id: si.id }).img, null, 'مشترٍ آخر لا يرى صورة غيره');
    eq(rpc(A, 'kp_chat_staff_img', { p_id: si.id }).img, IMG, 'الموظف يجلب الصورة');
    fails(() => anon('kp_store_chat_send', { p_slug: 'amal-shop', p_key: K3, p_name: '', p_phone: '', p_body: '  ' }), /KP_EMPTY_MSG/);
    fails(() => rpc(C, 'kp_chat_staff_send', { p_buyer: t3.buyer, p_body: 'تسلل' }), /KP_NO_THREAD/, 'متجر آخر لا يراسل مشترين غيره');
    let n = 0; try { for (; n < 60; n++) anon('kp_store_chat_send', { p_slug: 'amal-shop', p_key: K3, p_name: '', p_phone: '', p_body: 'x' + n }); } catch (e) { assert(/KP_RATE/.test(e.message), e.message); }
    assert(n >= 35 && n <= 41, 'حد الإرسال عند ' + n); return `رُفض الإرسال بعد ${n} رسالة خلال 10 دقائق`;
  });

  await T('حدود الإساءة: 6 طلبات/ساعة للمشترِي، وأرقام الطلبات متتابعة بلا تكرار تحت 10 طلبات متزامنة', async () => {
    const K9 = 'k9_' + 'z'.repeat(30); let n = 0; try { for (; n < 9; n++) ord(K9, base); } catch (e) { assert(/KP_RATE/.test(e.message), e.message); } eq(n, 6, 'السابع مرفوض');
    admin(`delete from public.kp_orders where shop_id = (select id from public.kp_shops where slug = 'amal-shop')`);
    const keys = Array.from({ length: 10 }, (_, i) => 'kc' + i + '_' + 'q'.repeat(30));
    const rs = await Promise.all(keys.map(k => rpcAsync(null, 'kp_store_order', { p_slug: 'amal-shop', p_key: k, p_data: base })));
    assert(rs.every(r => r.ok), 'فشل بعضها: ' + JSON.stringify(rs.filter(r => r.err)));
    const nos = rs.map(r => r.ok.no).sort((x, y) => x - y); eq(new Set(nos).size, 10, 'أرقام مكررة'); eq(nos[9] - nos[0], 9, 'أرقام الطلبات متتابعة بلا فجوات');
    return 'السابع مرفوض، و10 طلبات متزامنة بأرقام ' + nos[0] + '–' + nos[9] + ' بلا تكرار';
  });

  await T('تفريغ المحادثات: إحصاء، حذف الأقدم، حذف الكل للمالك فقط، والطلبات لا تُمسّ', async () => {
    admin(`update public.kp_orders set proof = '${IMG}' where id = (select id from public.kp_orders where shop_id = (select id from public.kp_shops where slug = 'amal-shop') limit 1)`);
    const st = rpc(B, 'kp_chat_stats', {}); assert(st.threads >= 1 && st.msgs >= 2 && st.images >= 1 && st.bytes > 0 && st.proofs >= 1 && st.proof_bytes > 0, 'الإحصاء: ' + JSON.stringify(st));
    eq(rpc(C, 'kp_chat_stats', {}).msgs, 0, 'متجر آخر لا يرى إحصاء غيره');
    fails(() => rpc(B, 'kp_chat_purge', { p_days: 0 }), /KP_FORBIDDEN/, 'الموظف لا يحذف');
    fails(() => rpc(null, 'kp_chat_purge', {}, 'anon'), /permission denied/, 'الزائر لا يحذف');
    const ordersBefore = rpc(A, 'kp_orders_list', {}).length; assert(ordersBefore >= 1, 'طلبات للاختبار');
    rpc(C, 'kp_chat_purge', { p_days: 0 }); eq(rpc(A, 'kp_chat_stats', {}).msgs, st.msgs, 'حذف مالك متجر آخر لا يمسّ هذا المتجر');
    const K7 = 'k7_' + 'w'.repeat(30); anon('kp_store_chat_send', { p_slug: 'amal-shop', p_key: K7, p_name: 'قديم', p_phone: '', p_body: 'رسالة قديمة جداً' });
    admin(`update public.kp_msgs set created_at = now() - interval '45 days' where body = 'رسالة قديمة جداً'`);
    const s2 = rpc(A, 'kp_chat_stats', {}); eq([s2.older30, s2.threads, s2.msgs], [1, st.threads + 1, st.msgs + 1], 'إحصاء قبل حذف الأقدم');
    const r1 = rpc(A, 'kp_chat_purge', { p_days: 30 }); eq([r1.msgs, r1.threads], [1, 1], 'حذف الأقدم من 30 يوماً: رسالة واحدة ومحادثتها الفارغة'); assert(r1.bytes > 0);
    const s3 = rpc(A, 'kp_chat_stats', {}); eq([s3.threads, s3.msgs, s3.older30], [st.threads, st.msgs, 0], 'غير الأقدم بقي كما هو');
    const r2 = rpc(A, 'kp_chat_purge', { p_days: 0 }); eq([r2.msgs, r2.threads], [st.msgs, st.threads], 'حذف الكل'); assert(r2.bytes >= st.bytes);
    const s4 = rpc(A, 'kp_chat_stats', {}); eq([s4.threads, s4.msgs, s4.images, s4.bytes], [0, 0, 0, 0], 'لا شيء بعد التفريغ');
    eq(rpc(A, 'kp_orders_list', {}).length, ordersBefore, 'الطلبات لم تُمسّ'); eq([s4.proofs, s4.proof_bytes], [st.proofs, st.proof_bytes], 'إشعارات الدفع لم تُمسّ');
    eq(rpc(A, 'kp_store_status', {}).unread, 0, 'العدّاد صفر');
    anon('kp_store_chat_send', { p_slug: 'amal-shop', p_key: K3, p_name: 'سارة', p_phone: '', p_body: 'بعد التفريغ' });
    eq(anon('kp_store_chat_get', { p_slug: 'amal-shop', p_key: K3, p_after: 0 }).msgs.map(m => m.body), ['بعد التفريغ'], 'المشتري يبدأ محادثة جديدة بعد التفريغ');
    eq(rpc(A, 'kp_threads_list', {}).length, 1, 'محادثة جديدة واحدة');
    return `أُفرغت ${st.msgs} رسالة (${st.bytes} بايت) في ${st.threads} محادثة، والطلبات وإشعارات الدفع سليمة`;
  });

  await T('الأمان: anon لا يصل لدوال الموظفين ولا للجداول، والمستخدم غير العضو مرفوض', async () => {
    for (const fn of ['kp_orders_list', 'kp_threads_list', 'kp_store_status']) fails(() => rpc(null, fn, {}, 'anon'), /permission denied/, fn);
    for (const t of ['kp_orders', 'kp_msgs', 'kp_threads']) { const r = spawnSync('psql', [...PSQL, '-c', `set role anon; select count(*) from public.${t}`], { encoding: 'utf8' }); assert(/permission denied/.test(r.stderr), 'قراءة مباشرة من ' + t); }
    fails(() => rpc(D2, 'kp_orders_list', {}), /KP_NO_SHOP/, 'مستخدم بلا متجر'); fails(() => anon('kp_ctx'), /permission denied|does not exist/, 'دالة داخلية');
    fails(() => anon('kp_pub_shop', { p_slug: 'amal-shop' }), /permission denied/, 'دالة داخلية');
    return 'جداول ودوال داخلية ودوال موظفين كلها مغلقة أمام anon';
  });

  await T('الأداء: استبدال 20,000 مستند ثم جلبها كلها بصفحات 5,000 (حد المهلة في Supabase 8 ثوانٍ للاستدعاء)', async () => {
    const products = Array.from({ length: 20000 }, (_, i) => ({ id: 'bulk' + i, name: 'منتج رقم ' + i, price: i % 97, stock: i % 50, barcode: String(6280000000000 + i) }));
    const t0 = Date.now(); rpc(A, 'kp_replace_all', { p_data: { products } }); const tRep = Date.now() - t0;
    let since = 0, n = 0, worst = 0; for (;;) { const t = Date.now(); const r = changes(A, since, 5000); worst = Math.max(worst, Date.now() - t); n += r.docs.filter(d => !d.x).length; since = r.seq; if (!r.more) break; }
    eq(n, 20000, 'عدد المستندات المجلوبة'); assert(tRep < 8000, 'الاستبدال استغرق ' + tRep + 'ms'); return `الاستبدال ${tRep}ms، أبطأ صفحة جلب ${worst}ms (يشمل تشغيل psql)`;
  });
} catch (e) { res.push(['خطأ عام', false, e.message]); console.log('FATAL', e.message); }
finally {
  try { run(`${PGB}/pg_ctl`, ['-D', D + '/data', 'stop', '-m', 'immediate'], { stdio: 'ignore' }); } catch { }
  fs.rmSync(D, { recursive: true, force: true });
}
const bad = res.filter(r => !r[1]).length; console.log(`\n${bad ? '✘' : '✔'} ${res.length - bad}/${res.length} اختبار قاعدة بيانات`);
fs.writeFileSync(path.join(SRC, 'docs', 'test-results-sql.md'), ['# نتائج اختبار مخطط Supabase (PostgreSQL 16 حقيقي)', '', 'ملاحظة: يختبر SQL والأمان والتزامن فعلياً، ويحاكي auth.uid() ودور authenticated كما تفعل Supabase. لا يختبر طبقتي GoTrue/PostgREST الفعليتين.', '', '| الاختبار | النتيجة | ملاحظات |', '|---|---|---|', ...res.map(r => `| ${r[0]} | ${r[1] ? '✅' : '❌'} | ${String(r[2]).replace(/\|/g, '/')} |`), '', `**${res.length - bad} نجح، ${bad} فشل**`].join('\n'));
process.exit(bad ? 1 : 0);
