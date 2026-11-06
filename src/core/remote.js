// محرك التخزين السحابي (Supabase): نسخة طبق الأصل في الذاكرة من بيانات المتجر + كتابة ذرّية على الخادم.
//  • القراءة فورية من الذاكرة (شاشة البيع سريعة)، والكتابة تنتظر تأكيد الخادم (لذلك تحتاج إنترنت).
//  • كل مستند يحمل رقم نسخة rev؛ إن غيّره جهاز آخر قبلك يرفض الخادم عمليتك (CONFLICT) ويعيد التطبيق المحاولة بعد تحديث البيانات.
//  • كل عملية لها معرّف فريد، فإن انقطع الاتصال بعد وصولها للخادم وأُعيد إرسالها لا تُنفَّذ مرتين (لا فاتورة مكررة).
//  • تحديث تلقائي: كل بضع ثوانٍ يجلب ما تغيّر على الأجهزة الأخرى.
import * as sb from '../lib/supabase.js';
import { DATA_STORES } from './db.js';
import { uid } from './util.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PENDING = 'kp_pending_op';
const idOf = (s, r) => s === 'meta' ? r.k : r.id;
const err = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });
const pollMs = () => { try { return Math.max(500, +localStorage.getItem('kp_poll_ms') || 4000); } catch { return 4000; } };

export function createRemote() {
  const mem = Object.fromEntries(DATA_STORES.map(s => [s, new Map()]));      // store -> Map(id -> {rev, data})
  let seq = 0, emitter = () => { }, timer = null, pulling = null, loaded = false;
  const status = { state: 'idle', lastOk: 0, error: '' };
  const setStatus = (state, error = '') => { const ch = status.state !== state || status.error !== error; status.state = state; status.error = error; if (state === 'ok') status.lastOk = Date.now(); if (ch) try { window.dispatchEvent(new CustomEvent('kp-cloud', { detail: { ...status } })); } catch { } };

  function applyDocs(docs, ch) {
    for (const x of docs) {
      const m = mem[x.s]; if (!m) continue;
      const cur = m.get(x.i); if (cur && cur.rev >= x.r) continue;
      if (x.x) { if (cur) { m.delete(x.i); (ch.del[x.s] ||= []).push(x.i); } }
      else { m.set(x.i, { rev: x.r, data: x.d }); (ch.put[x.s] ||= []).push(x.d); }
    }
  }
  const hasAny = ch => Object.keys(ch.put).length || Object.keys(ch.del).length;

  async function load(progress) {
    for (const m of Object.values(mem)) m.clear(); seq = 0; let n = 0;
    for (;;) {
      const r = await sb.rpc('kp_changes', { p_since: seq, p_limit: 2000 }, { timeout: 30000 });
      applyDocs(r.docs, { put: {}, del: {} }); n += r.docs.length; seq = r.seq; progress?.(n);
      if (!r.more) break;
    }
    loaded = true; setStatus('ok'); await replayPending(); start();
  }

  // ما تغيّر على الأجهزة الأخرى منذ آخر جلب. تُرجع true إن وصل جديد.
  function pull() {
    if (pulling) return pulling;
    pulling = (async () => {
      try {
        const ch = { put: {}, del: {} }; let more = true;
        while (more) { const r = await sb.rpc('kp_changes', { p_since: seq, p_limit: 1000 }, { timeout: 20000 }); applyDocs(r.docs, ch); seq = r.seq; more = r.more; }
        setStatus('ok'); try { if (localStorage.getItem(PENDING)) replayPending(); } catch { } if (hasAny(ch)) { emitter(ch); return true; } return false;
      } catch (e) { setStatus(e.code === 'AUTH' ? 'auth' : 'offline', e.message); throw e; }
    })().finally(() => { pulling = null; });
    return pulling;
  }
  function start() {
    if (timer) return;
    const tick = () => { if (loaded && document.visibilityState !== 'hidden') pull().catch(() => { }); };
    timer = setInterval(tick, pollMs());
    document.addEventListener('visibilitychange', tick); window.addEventListener('online', tick); window.addEventListener('focus', tick);
  }
  function stop() { clearInterval(timer); timer = null; }

  // ---------- بناء العملية من تغييرات db.commit ----------
  function buildOps(ch) {
    const put = {}, del = {}, clear = (ch.clear || []).filter(s => mem[s]); const clearing = new Set(clear); let any = clear.length > 0;
    const dels = new Set(); for (const [s, ids] of Object.entries(ch.del || {})) for (const id of ids) dels.add(s + '/' + id);
    for (const [s, recs] of Object.entries(ch.put || {})) {
      if (!mem[s]) continue; const byId = new Map(); for (const r of recs) byId.set(idOf(s, r), r);
      for (const [id, r] of byId) { if (dels.has(s + '/' + id)) continue; (put[s] ||= []).push({ id, base: clearing.has(s) ? null : (mem[s].get(id)?.rev ?? null), d: r }); any = true; }
    }
    for (const [s, ids] of Object.entries(ch.del || {})) {
      if (!mem[s] || clearing.has(s)) continue;
      for (const id of new Set(ids)) { const cur = mem[s].get(id); if (cur) { (del[s] ||= []).push({ id, base: cur.rev }); any = true; } }
    }
    return any ? { put, del, clear } : null;
  }
  function applyLocal(ops, res) {
    for (const s of ops.clear) mem[s].clear();
    for (const [s, arr] of Object.entries(ops.put)) for (const e of arr) mem[s].set(e.id, { rev: res.revs?.[s]?.[e.id] ?? ((e.base || 0) + 1), data: e.d });
    for (const [s, arr] of Object.entries(ops.del)) for (const e of arr) mem[s].delete(e.id);
  }
  const ambiguous = e => ['NETWORK', 'TIMEOUT', 'SERVER'].includes(e.code);

  async function send(ops) {
    for (let a = 0; ; a++) {
      try { return await sb.rpc('kp_commit', { p_ops: ops }, { timeout: 25000 }); }
      catch (e) {
        if (ambiguous(e) && a < 4) { await sleep(500 * (a + 1)); continue; }                // نفس معرّف العملية ⇒ آمن لإعادة الإرسال
        if (ambiguous(e)) { try { localStorage.setItem(PENDING, JSON.stringify(ops)); } catch { } setStatus('offline', e.message); throw err('UNSURE', 'انقطع الاتصال أثناء الحفظ ولا نعرف إن وصلت العملية. لا تُعد العملية الآن — ستُؤكَّد تلقائياً عند عودة الاتصال؛ تحقق من قائمة الفواتير بعد قليل.'); }
        if (e.code === 'CONFLICT') throw err('CONFLICT', 'تغيّرت هذه البيانات من جهاز آخر قبل لحظات — حُدّثت الشاشة، أعد المحاولة', { detail: e.detail });
        throw e;
      }
    }
  }
  async function commit(ch) {
    if (!loaded) throw err('NOT_READY', 'لم يكتمل تحميل البيانات من السحابة بعد');
    const ops = buildOps(ch); if (!ops) return ch;
    ops.op = uid();
    const res = await send(ops);
    applyLocal(ops, res); try { localStorage.removeItem(PENDING); } catch { }
    setStatus('ok'); emitter(ch); return ch;
  }
  // عملية كانت غامضة النتيجة (انقطع الاتصال): نعيد إرسالها بنفس المعرّف — الخادم يتجاهلها إن كانت نُفّذت
  async function replayPending() {
    let raw; try { raw = localStorage.getItem(PENDING); } catch { } if (!raw) return;
    try { const res = await sb.rpc('kp_commit', { p_ops: JSON.parse(raw) }, { timeout: 25000 }); localStorage.removeItem(PENDING); await pull().catch(() => { }); try { window.dispatchEvent(new CustomEvent('kp-cloud-note', { detail: { msg: res.replayed ? 'تم تأكيد العملية التي انقطع الاتصال أثناءها (كانت قد حُفظت)' : 'حُفظت العملية التي انقطع الاتصال أثناءها' } })); } catch { } }
    catch (e) { if (!ambiguous(e)) try { localStorage.removeItem(PENDING); } catch { } }
  }

  // كتابة ذرّية مع عدّاد: build(counters) تعيد { ch, result }. عند التعارض نحدّث البيانات ونعيد البناء (يُعاد التحقق من المخزون على الأحدث)
  async function atomic(build) {
    for (let a = 0; ; a++) {
      const counters = { ...(mem.meta.get('counters')?.data?.v || {}) };
      const out = build(counters); out.ch.put ||= {}; out.ch.del ||= {};
      (out.ch.put.meta ||= []).push({ k: 'counters', v: counters });
      try { await commit(out.ch); return out; }
      catch (e) { if (e.code === 'CONFLICT' && a < 5) { await pull().catch(() => { }); continue; } throw e; }
    }
  }

  async function replaceAll(data) {
    const d = { ...data }; if (d.meta) d.meta = d.meta.filter(m => m.k !== 'legacy_localstorage'); delete d.backups;
    await sb.rpc('kp_replace_all', { p_data: d }, { timeout: 120000 });
    await load();
  }

  return {
    mem, status, load, pull, stop, commit, atomic, replaceAll,
    setEmitter: f => { emitter = f; },
    getAll: s => [...mem[s].values()].map(x => x.data),
    get: (s, k) => mem[s]?.get(k)?.data,
    exportAll: () => Object.fromEntries(DATA_STORES.map(s => [s, [...mem[s].values()].map(x => x.data)])),
    isLoaded: () => loaded,
  };
}
