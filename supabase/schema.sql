-- ============================================================================
--  كاشير الدكان — مخطط Supabase (الإصدار 2: + المتجر الإلكتروني)
--
--  طريقة التشغيل: Supabase ← SQL Editor ← New query ← الصق هذا الملف كاملاً ← Run.
--  آمن لإعادة التشغيل (idempotent): يمكنك تشغيله مجدداً عند التحديث دون فقدان بيانات.
--
--  تصميم الأمان:
--    • كل الجداول مقفلة بالكامل (RLS مفعّل بلا أي سياسة + سحب كل الصلاحيات من anon/authenticated).
--      لا أحد يستطيع قراءتها أو الكتابة فيها مباشرة عبر REST، حتى لو عرف مفتاح anon.
--    • الوصول الوحيد عبر دوال kp_* (SECURITY DEFINER) التي تتحقق دائماً من أن المستدعي
--      مستخدم مسجّل (auth.uid()) وعضو في المتجر، وتعزل بيانات كل متجر عن الآخر.
--    • دوران: owner (المالك/المدير) و staff (موظف). الموظف لا يكتب مخزن users ولا يستعيد
--      نسخة ولا يمسح مخزناً. أما صلاحيات الواجهة التفصيلية (23 صلاحية) فتبقى قفلاً تشغيلياً في التطبيق.
--
--  نموذج البيانات: مخزن مستندات عام kp_docs (store, id, data jsonb, rev, seq) يطابق مخازن
--  IndexedDB في التطبيق. rev = رقم نسخة المستند للتحقق من التعارض بين جهازين،
--  seq = رقم تسلسلي عام لكل تغيير يُستخدم لجلب "ما تغيّر منذ آخر مرة".
-- ============================================================================

-- ---------- الجداول ----------
create table if not exists public.kp_shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  join_code   text not null unique,
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.kp_members (
  user_id     uuid primary key references auth.users (id) on delete cascade,   -- كل مستخدم في متجر واحد
  shop_id     uuid not null references public.kp_shops (id) on delete cascade,
  role        text not null check (role in ('owner', 'staff')),
  email       text,
  created_at  timestamptz not null default now()
);
create index if not exists kp_members_shop_idx on public.kp_members (shop_id);

create sequence if not exists public.kp_seq;

create table if not exists public.kp_docs (
  shop_id     uuid not null references public.kp_shops (id) on delete cascade,
  store       text not null,
  id          text not null,
  rev         integer not null default 1,
  data        jsonb,
  deleted     boolean not null default false,
  seq         bigint not null,
  updated_at  timestamptz not null default now(),
  primary key (shop_id, store, id)
);
create index if not exists kp_docs_seq_idx on public.kp_docs (shop_id, seq);

-- سجل العمليات المنفَّذة: يمنع تنفيذ نفس العملية مرتين إذا أعاد التطبيق الإرسال بعد انقطاع الشبكة
create table if not exists public.kp_ops (
  shop_id     uuid not null references public.kp_shops (id) on delete cascade,
  op_id       text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (shop_id, op_id)
);
create index if not exists kp_ops_time_idx on public.kp_ops (created_at);

alter table public.kp_shops   enable row level security;
alter table public.kp_members enable row level security;
alter table public.kp_docs    enable row level security;
alter table public.kp_ops     enable row level security;
revoke all on table public.kp_shops, public.kp_members, public.kp_docs, public.kp_ops from public, anon, authenticated;
revoke all on sequence public.kp_seq from public, anon, authenticated;

-- ---------- أدوات داخلية ----------
create or replace function public.kp_store_ok(s text) returns boolean
language sql immutable as $$
  select s = any (array['meta','products','categories','suppliers','customers','invoices','returns','purchases',
                        'payments','expenses','moves','batches','offers','holds','users','shifts','audit','counts']);
$$;

-- يعيد متجر المستخدم الحالي ودوره، أو يرمي خطأ واضحاً
create or replace function public.kp_ctx(out v_shop uuid, out v_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'KP_UNAUTH'; end if;
  select m.shop_id, m.role into v_shop, v_role from public.kp_members m where m.user_id = auth.uid();
  if v_shop is null then raise exception 'KP_NO_SHOP'; end if;
end;
$$;

-- ---------- المتجر والأعضاء ----------
create or replace function public.kp_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; s record; out jsonb;
begin
  if auth.uid() is null then raise exception 'KP_UNAUTH'; end if;
  select * into m from public.kp_members where user_id = auth.uid();
  if not found then
    return jsonb_build_object('schema', 1, 'user_id', auth.uid(), 'shop_id', null);
  end if;
  select * into s from public.kp_shops where id = m.shop_id;
  out := jsonb_build_object('schema', 1, 'user_id', auth.uid(), 'email', m.email, 'shop_id', s.id, 'shop_name', s.name, 'role', m.role);
  if m.role = 'owner' then
    out := out || jsonb_build_object(
      'join_code', s.join_code,
      'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'email', x.email, 'role', x.role, 'since', x.created_at) order by x.created_at), '[]'::jsonb)
                  from public.kp_members x where x.shop_id = s.id));
  end if;
  return out;
end;
$$;

create or replace function public.kp_new_code() returns text
language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
$$;

create or replace function public.kp_create_shop(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid; mail text;
begin
  if auth.uid() is null then raise exception 'KP_UNAUTH'; end if;
  if exists (select 1 from public.kp_members where user_id = auth.uid()) then raise exception 'KP_ALREADY_MEMBER'; end if;
  select email into mail from auth.users where id = auth.uid();
  insert into public.kp_shops (name, join_code, created_by) values (left(coalesce(nullif(trim(p_name), ''), 'متجري'), 120), public.kp_new_code(), auth.uid()) returning id into sid;
  insert into public.kp_members (user_id, shop_id, role, email) values (auth.uid(), sid, 'owner', mail);
  return public.kp_me();
end;
$$;

-- انضمام موظف إلى متجر موجود برمز الانضمام (يعطيه إياه المالك)
create or replace function public.kp_join_shop(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid; mail text; code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'KP_UNAUTH'; end if;
  if exists (select 1 from public.kp_members where user_id = auth.uid()) then raise exception 'KP_ALREADY_MEMBER'; end if;
  select id into sid from public.kp_shops where join_code = code;
  if sid is null then raise exception 'KP_BAD_CODE'; end if;
  select email into mail from auth.users where id = auth.uid();
  insert into public.kp_members (user_id, shop_id, role, email) values (auth.uid(), sid, 'staff', mail);
  return public.kp_me();
end;
$$;

create or replace function public.kp_rotate_join_code() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.kp_ctx();
  if c.v_role <> 'owner' then raise exception 'KP_FORBIDDEN'; end if;
  update public.kp_shops set join_code = public.kp_new_code() where id = c.v_shop;
  return public.kp_me();
end;
$$;

create or replace function public.kp_remove_member(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.kp_ctx();
  if c.v_role <> 'owner' then raise exception 'KP_FORBIDDEN'; end if;
  if p_user = auth.uid() then raise exception 'KP_CANNOT_REMOVE_SELF'; end if;
  delete from public.kp_members where user_id = p_user and shop_id = c.v_shop;
  return public.kp_me();
end;
$$;

-- ---------- قراءة: ما الذي تغيّر منذ seq؟ (التحميل الأول = since 0) ----------
create or replace function public.kp_changes(p_since bigint default 0, p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; lim integer := greatest(1, least(coalesce(p_limit, 1000), 5000)); rows_ jsonb; n integer; last_seq bigint;
begin
  select * into c from public.kp_ctx();
  with page as (
    select store, id, rev, data, deleted, seq from public.kp_docs
    where shop_id = c.v_shop and seq > coalesce(p_since, 0) and (coalesce(p_since, 0) > 0 or not deleted)
    order by seq limit lim + 1
  ), cut as (select * from page order by seq limit lim)
  select coalesce(jsonb_agg(jsonb_build_object('s', store, 'i', id, 'r', rev, 'd', data, 'x', deleted, 'q', seq) order by seq), '[]'::jsonb),
         (select count(*) from page), coalesce(max(seq), coalesce(p_since, 0))
    into rows_, n, last_seq from cut;
  return jsonb_build_object('docs', rows_, 'seq', last_seq, 'more', n > lim);
end;
$$;

-- ---------- كتابة ذرّية مع تحقق التعارض ----------
-- p_ops = { "op": "<معرّف فريد للعملية>",
--           "put":   { "<store>": [ { "id": "...", "base": null | رقم_النسخة_التي_رآها_الجهاز, "d": { ...المستند... } } ] },
--           "del":   { "<store>": [ { "id": "...", "base": رقم|null } ] },
--           "clear": [ "<store>" ] }
-- إن كان رقم النسخة (base) لا يطابق ما في القاعدة تُرمى KP_CONFLICT ويُلغى كل شيء (معاملة واحدة).
create or replace function public.kp_commit(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record; s text; e jsonb; cur record; opid text; prev jsonb; out_revs jsonb := '{}'::jsonb; nr integer; sq bigint; maxseq bigint := 0; base_txt text; cnt integer := 0;
begin
  select * into c from public.kp_ctx();
  perform pg_advisory_xact_lock(hashtextextended(c.v_shop::text, 0));   -- تسلسل كل الكتابات لكل متجر ⇒ ترتيب seq = ترتيب الاعتماد

  opid := nullif(p_ops ->> 'op', '');
  if opid is not null then
    select result into prev from public.kp_ops where shop_id = c.v_shop and op_id = opid;
    if found then return prev || jsonb_build_object('replayed', true); end if;   -- أُعيد إرسالها بعد انقطاع: لا تُنفَّذ مرتين
  end if;

  -- مسح مخازن كاملة (للمالك فقط)
  for s in select jsonb_array_elements_text(coalesce(p_ops -> 'clear', '[]'::jsonb)) loop
    if c.v_role <> 'owner' then raise exception 'KP_FORBIDDEN'; end if;
    if not public.kp_store_ok(s) then raise exception 'KP_BAD_STORE:%', s; end if;
    update public.kp_docs set deleted = true, data = null, rev = rev + 1, seq = nextval('public.kp_seq'), updated_at = now()
      where shop_id = c.v_shop and store = s and not deleted;
  end loop;

  -- إضافة/تعديل
  for s in select jsonb_object_keys(coalesce(p_ops -> 'put', '{}'::jsonb)) loop
    if not public.kp_store_ok(s) then raise exception 'KP_BAD_STORE:%', s; end if;
    if s = 'users' and c.v_role <> 'owner' then raise exception 'KP_FORBIDDEN'; end if;
    for e in select value from jsonb_array_elements(p_ops -> 'put' -> s) loop
      if coalesce(e ->> 'id', '') = '' or jsonb_typeof(e -> 'd') <> 'object' then raise exception 'KP_BAD_DOC:%', s; end if;
      base_txt := case when jsonb_typeof(e -> 'base') = 'number' then e ->> 'base' else null end;
      select d.rev, d.deleted into cur from public.kp_docs d where d.shop_id = c.v_shop and d.store = s and d.id = e ->> 'id' for update;
      sq := nextval('public.kp_seq'); cnt := cnt + 1;
      if not found then
        if base_txt is not null then raise exception 'KP_CONFLICT:%/%', s, e ->> 'id'; end if;
        nr := 1;
        insert into public.kp_docs (shop_id, store, id, rev, data, deleted, seq) values (c.v_shop, s, e ->> 'id', 1, e -> 'd', false, sq);
      else
        if cur.deleted then
          if base_txt is not null then raise exception 'KP_CONFLICT:%/%', s, e ->> 'id'; end if;
        else
          if base_txt is null or base_txt::integer <> cur.rev then raise exception 'KP_CONFLICT:%/%', s, e ->> 'id'; end if;
        end if;
        nr := cur.rev + 1;
        update public.kp_docs set rev = nr, data = e -> 'd', deleted = false, seq = sq, updated_at = now()
          where shop_id = c.v_shop and store = s and id = e ->> 'id';
      end if;
      maxseq := greatest(maxseq, sq);
      out_revs := jsonb_set(out_revs, array[s], coalesce(out_revs -> s, '{}'::jsonb) || jsonb_build_object(e ->> 'id', nr), true);
    end loop;
  end loop;

  -- حذف
  for s in select jsonb_object_keys(coalesce(p_ops -> 'del', '{}'::jsonb)) loop
    if not public.kp_store_ok(s) then raise exception 'KP_BAD_STORE:%', s; end if;
    if s = 'users' and c.v_role <> 'owner' then raise exception 'KP_FORBIDDEN'; end if;
    for e in select value from jsonb_array_elements(p_ops -> 'del' -> s) loop
      base_txt := case when jsonb_typeof(e -> 'base') = 'number' then e ->> 'base' else null end;
      select d.rev, d.deleted into cur from public.kp_docs d where d.shop_id = c.v_shop and d.store = s and d.id = e ->> 'id' for update;
      if found and not cur.deleted then
        if base_txt is not null and base_txt::integer <> cur.rev then raise exception 'KP_CONFLICT:%/%', s, e ->> 'id'; end if;
        sq := nextval('public.kp_seq'); cnt := cnt + 1;
        update public.kp_docs set deleted = true, data = null, rev = cur.rev + 1, seq = sq, updated_at = now()
          where shop_id = c.v_shop and store = s and id = e ->> 'id';
        maxseq := greatest(maxseq, sq);
      end if;
    end loop;
  end loop;

  prev := jsonb_build_object('ok', true, 'revs', out_revs, 'seq', maxseq, 'n', cnt);
  if opid is not null then
    insert into public.kp_ops (shop_id, op_id, result) values (c.v_shop, opid, prev);
    delete from public.kp_ops where shop_id = c.v_shop and created_at < now() - interval '3 days';
  end if;
  return prev;
end;
$$;

-- ---------- استبدال كل بيانات المتجر (استعادة نسخة / ترحيل من الوضع المحلي) — للمالك فقط ----------
-- p_data بنفس صيغة data في ملف النسخة الاحتياطية: { "products": [ {...} ], "meta": [ {"k":"settings","v":{}} ], ... }
create or replace function public.kp_replace_all(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; maxs bigint; k text;
begin
  select * into c from public.kp_ctx();
  if c.v_role <> 'owner' then raise exception 'KP_FORBIDDEN'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'KP_BAD_DOC:data'; end if;
  for k in select jsonb_object_keys(p_data) loop
    if not public.kp_store_ok(k) then raise exception 'KP_BAD_STORE:%', k; end if;
    if jsonb_typeof(p_data -> k) <> 'array' then raise exception 'KP_BAD_DOC:%', k; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(c.v_shop::text, 0));

  update public.kp_docs set deleted = true, data = null, rev = rev + 1, seq = nextval('public.kp_seq'), updated_at = now()
    where shop_id = c.v_shop and not deleted;

  insert into public.kp_docs (shop_id, store, id, rev, data, deleted, seq)
  select c.v_shop, t.store, t.id, 1, t.rec, false, nextval('public.kp_seq')
  from (
    select distinct on (st.key, rid) st.key as store, rid as id, rec
    from jsonb_each(p_data) st
    cross join lateral jsonb_array_elements(st.value) with ordinality as r(rec, ord)
    cross join lateral (select coalesce(rec ->> (case when st.key = 'meta' then 'k' else 'id' end), '') as rid) q
    where st.key <> 'backups'
    order by st.key, rid, ord desc
  ) t
  where t.id <> ''
  on conflict (shop_id, store, id) do update
    set rev = public.kp_docs.rev + 1, data = excluded.data, deleted = false, seq = excluded.seq, updated_at = now();

  select coalesce(max(seq), 0) into maxs from public.kp_docs where shop_id = c.v_shop;
  delete from public.kp_ops where shop_id = c.v_shop;
  return jsonb_build_object('ok', true, 'seq', maxs);
end;
$$;

-- ============================================================================
--  المتجر الإلكتروني (واجهة المشترين: store.html) — طلبات + محادثات + إشعارات دفع
--  الزائر لا يصل لأي جدول: يستدعي فقط دوال kp_store_* (دور anon) وكلها تقبل slug المتجر ومفتاح سري يولّده متصفح المشتري.
--  المفتاح السري لا يُخزَّن كما هو: نحفظ بصمته (sha256) فقط، ولا يستطيع أحد قراءة طلبات أو محادثات مشترٍ آخر.
--  لا يخرج للزائر إلا: اسم المتجر وبيانات التواصل المختارة، اسم المنتج وسعره وصورته ووصفه وحالة توفره (متوفر/آخر القطع/نفد).
--  التكلفة والمورد والكمية الدقيقة وأي بيانات إدارية لا تخرج أبداً. السعر النهائي للطلب يُحسب على الخادم من أسعار المنتجات الفعلية.
-- ============================================================================
alter table public.kp_shops add column if not exists slug text;
alter table public.kp_shops add column if not exists store_on boolean not null default false;
alter table public.kp_shops add column if not exists order_seq integer not null default 0;
create unique index if not exists kp_shops_slug_uq on public.kp_shops (slug) where slug is not null;

create table if not exists public.kp_orders (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.kp_shops (id) on delete cascade,
  no          integer not null,
  buyer       text not null,                       -- بصمة مفتاح المشتري
  name        text not null,
  phone       text not null,
  address     text not null default '',
  note        text not null default '',
  delivery    text not null check (delivery in ('pickup', 'home')),
  pay         text not null check (pay in ('cash', 'transfer')),
  items       jsonb not null,
  subtotal    numeric(14, 2) not null,
  fee         numeric(14, 2) not null default 0,
  total       numeric(14, 2) not null,
  proof       text,                                -- صورة إشعار الدفع (data URL مصغّرة)
  proof_at    timestamptz,
  status      text not null default 'new' check (status in ('new', 'confirmed', 'preparing', 'ready', 'done', 'rejected', 'cancelled')),
  shop_note   text not null default '',            -- ملاحظة البائع للمشتري
  hold_id     text,                                -- الفاتورة المعلّقة التي أُرسل إليها الطلب في نقطة البيع
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (shop_id, no)
);
create index if not exists kp_orders_shop_idx on public.kp_orders (shop_id, created_at desc);
create index if not exists kp_orders_buyer_idx on public.kp_orders (shop_id, buyer);

create table if not exists public.kp_threads (
  shop_id      uuid not null references public.kp_shops (id) on delete cascade,
  buyer        text not null,
  name         text not null default '',
  phone        text not null default '',
  last_at      timestamptz not null default now(),
  last_text    text not null default '',
  unread_shop  integer not null default 0,
  unread_buyer integer not null default 0,
  created_at   timestamptz not null default now(),
  primary key (shop_id, buyer)
);
create index if not exists kp_threads_last_idx on public.kp_threads (shop_id, last_at desc);

create table if not exists public.kp_msgs (
  id          bigserial primary key,
  shop_id     uuid not null references public.kp_shops (id) on delete cascade,
  buyer       text not null,
  sender      text not null check (sender in ('buyer', 'shop')),
  kind        text not null default 'text' check (kind in ('text', 'system')),
  body        text not null default '',
  img         text,
  order_no    integer,
  created_at  timestamptz not null default now()
);
create index if not exists kp_msgs_thread_idx on public.kp_msgs (shop_id, buyer, id);

alter table public.kp_orders  enable row level security;
alter table public.kp_threads enable row level security;
alter table public.kp_msgs    enable row level security;
revoke all on table public.kp_orders, public.kp_threads, public.kp_msgs from public, anon, authenticated;
revoke all on sequence public.kp_msgs_id_seq from public, anon, authenticated;

-- ---------- أدوات داخلية (لا تُمنح لأحد) ----------
create or replace function public.kp_bk(p_key text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_key, ''), 'utf8')), 'hex'); $$;

-- المتجر المنشور بهذا الـ slug، أو خطأ KP_NO_STORE
create or replace function public.kp_pub_shop(p_slug text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare sid uuid;
begin
  select id into sid from public.kp_shops where slug = lower(coalesce(p_slug, '')) and store_on;
  if sid is null then raise exception 'KP_NO_STORE'; end if;
  return sid;
end;
$$;

create or replace function public.kp_key_ok(p_key text) returns void
language plpgsql immutable as $$
begin
  if p_key is null or length(p_key) < 24 or length(p_key) > 80 or p_key !~ '^[A-Za-z0-9_-]+$' then raise exception 'KP_BAD_KEY'; end if;
end;
$$;

create or replace function public.kp_img_ok(p_img text) returns void
language plpgsql immutable as $$
begin
  if p_img is null then return; end if;
  if p_img !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'KP_BAD_IMAGE'; end if;
  if length(p_img) > 900000 then raise exception 'KP_IMAGE_BIG'; end if;
end;
$$;

create or replace function public.kp_settings(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data -> 'v' from public.kp_docs where shop_id = p_shop and store = 'meta' and id = 'settings' and not deleted), '{}'::jsonb);
$$;

-- أول عرض فعّال على منتج (نفس منطق التطبيق: pct/fixed فقط تظهر للمشتري)
create or replace function public.kp_offer_of(p_shop uuid, p_pid text, p_today text) returns jsonb
language sql stable security definer set search_path = public as $$
  select d.data from public.kp_docs d
  where d.shop_id = p_shop and d.store = 'offers' and not d.deleted and d.data ->> 'pid' = p_pid
    and coalesce(d.data ->> 'active', 'true') <> 'false' and d.data ->> 'type' in ('pct', 'fixed')
    and (coalesce(d.data ->> 'start', '') = '' or d.data ->> 'start' <= p_today)
    and (coalesce(d.data ->> 'end', '') = '' or d.data ->> 'end' >= p_today)
  order by d.seq limit 1;
$$;

create or replace function public.kp_eff_price(p_price numeric, p_offer jsonb) returns numeric
language sql immutable as $$
  select round(greatest(0, case
    when p_offer is null then p_price
    when p_offer ->> 'type' = 'pct' then p_price * (1 - least(100, coalesce(nullif(p_offer ->> 'value', '')::numeric, 0)) / 100)
    when p_offer ->> 'type' = 'fixed' then p_price - coalesce(nullif(p_offer ->> 'value', '')::numeric, 0)
    else p_price end), 2);
$$;

create or replace function public.kp_num(t text) returns numeric
language plpgsql immutable as $$
begin return coalesce(nullif(t, '')::numeric, 0); exception when others then return 0; end;
$$;

-- رسالة نظام في محادثة المشتري (تحديث حالة طلب...)
create or replace function public.kp_sys_msg(p_shop uuid, p_buyer text, p_text text, p_no integer, p_unread_buyer boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.kp_threads (shop_id, buyer) values (p_shop, p_buyer) on conflict do nothing;
  insert into public.kp_msgs (shop_id, buyer, sender, kind, body, order_no) values (p_shop, p_buyer, 'shop', 'system', p_text, p_no);
  update public.kp_threads set last_at = now(), last_text = left(p_text, 120), unread_buyer = unread_buyer + case when p_unread_buyer then 1 else 0 end
    where shop_id = p_shop and buyer = p_buyer;
end;
$$;

-- ---------- دوال المشتري (anon) ----------
create or replace function public.kp_store_info(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; v jsonb; st jsonb; sh record;
begin
  sid := public.kp_pub_shop(p_slug);
  select * into sh from public.kp_shops where id = sid;
  v := public.kp_settings(sid); st := coalesce(v -> 'store', '{}'::jsonb);
  return jsonb_build_object(
    'slug', sh.slug,
    'name', left(coalesce(nullif(v ->> 'name', ''), sh.name), 120),
    'logo', case when length(coalesce(v ->> 'logo', '')) < 120000 then v -> 'logo' else null end,
    'cur', left(coalesce(v ->> 'cur', ''), 12),
    'phone', left(coalesce(nullif(st ->> 'phone', ''), v ->> 'phone', ''), 30),
    'address', left(coalesce(v ->> 'address', ''), 200),
    'title', left(coalesce(st ->> 'title', ''), 120),
    'about', left(coalesce(st ->> 'about', ''), 600),
    'whatsapp', left(regexp_replace(coalesce(st ->> 'whatsapp', ''), '[^0-9]', '', 'g'), 20),
    'hours', left(coalesce(st ->> 'hours', ''), 200),
    'notice', left(coalesce(st ->> 'notice', ''), 300),
    'delivery', jsonb_build_object(
      'pickup', coalesce(st #>> '{delivery,pickup}', 'true') <> 'false',
      'home', coalesce(st #>> '{delivery,home}', 'true') <> 'false',
      'fee', public.kp_num(st #>> '{delivery,fee}'),
      'free_over', public.kp_num(st #>> '{delivery,free_over}'),
      'min', public.kp_num(st #>> '{delivery,min}'),
      'areas', left(coalesce(st #>> '{delivery,areas}', ''), 300)),
    'pay', jsonb_build_object(
      'cash', coalesce(st #>> '{pay,cash}', 'true') <> 'false',
      'transfer', coalesce(st #>> '{pay,transfer}', 'true') <> 'false',
      'instructions', left(coalesce(st #>> '{pay,instructions}', ''), 800)),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', left(d.data ->> 'name', 60), 'color', d.data ->> 'color') order by d.data ->> 'name'), '[]'::jsonb)
                   from public.kp_docs d where d.shop_id = sid and d.store = 'categories' and not d.deleted)
  );
end;
$$;

create or replace function public.kp_store_products(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD'); low numeric;
begin
  sid := public.kp_pub_shop(p_slug);
  low := coalesce(nullif(public.kp_settings(sid) #>> '{stock,lowDefault}', '')::numeric, 5);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', left(p.data ->> 'name', 160),
      'price', x.eff, 'old', case when x.o is not null then x.lp end,
      'unit', coalesce(nullif(p.data ->> 'unit', ''), 'pc'),
      'cat', nullif(p.data ->> 'cat', ''), 'desc', left(coalesce(p.data ->> 'desc', ''), 400),
      'img', coalesce(p.data ->> 'img', '') <> '',
      'st', case when coalesce(p.data ->> 'track', 'true') = 'false' then 'in'
                 when public.kp_num(p.data ->> 'stock') <= 0 then 'out'
                 when public.kp_num(p.data ->> 'stock') <= coalesce(nullif(p.data ->> 'min', '')::numeric, low) then 'low'
                 else 'in' end,
      'tag', case when x.o is null then null when x.o ->> 'type' = 'pct' then 'خصم ' || (public.kp_num(x.o ->> 'value'))::float8::text || '%' else 'عرض' end
    ) order by p.data ->> 'name')
    from public.kp_docs p
    cross join lateral (select public.kp_num(p.data ->> 'price') as lp, public.kp_offer_of(sid, p.id, today) as o) y
    cross join lateral (select y.lp, y.o, public.kp_eff_price(y.lp, y.o) as eff) x
    where p.shop_id = sid and p.store = 'products' and not p.deleted
      and coalesce(p.data ->> 'active', 'true') <> 'false' and coalesce(p.data ->> 'hideOnline', 'false') <> 'true'
      and coalesce(p.data ->> 'name', '') <> ''
  ), '[]'::jsonb);
end;
$$;

create or replace function public.kp_store_images(p_slug text, p_ids text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid;
begin
  sid := public.kp_pub_shop(p_slug);
  return coalesce((select jsonb_object_agg(p.id, p.data ->> 'img') from public.kp_docs p
    where p.shop_id = sid and p.store = 'products' and not p.deleted and p.id = any (p_ids[1:30])
      and coalesce(p.data ->> 'hideOnline', 'false') <> 'true' and coalesce(p.data ->> 'img', '') <> ''), '{}'::jsonb);
end;
$$;

-- إنشاء طلب: السعر والمجموع يُحسبان هنا من بيانات المنتجات الفعلية (لا يُقبل أي سعر من المتصفح)
create or replace function public.kp_store_order(p_slug text, p_key text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid; st jsonb; b text; nm text; ph text; ad text; nt text; dv text; py text; pf text;
  today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  it record; p record; o jsonb; q numeric; eff numeric; lines jsonb := '[]'::jsonb; sub numeric := 0; fee numeric := 0; fo numeric; mn numeric;
  n integer; oid uuid; cnt integer;
begin
  sid := public.kp_pub_shop(p_slug); perform public.kp_key_ok(p_key); b := public.kp_bk(p_key);
  st := coalesce(public.kp_settings(sid) -> 'store', '{}'::jsonb);
  nm := left(trim(coalesce(p_data ->> 'name', '')), 80); ph := left(regexp_replace(coalesce(p_data ->> 'phone', ''), '[^0-9+]', '', 'g'), 20);
  ad := left(trim(coalesce(p_data ->> 'address', '')), 300); nt := left(trim(coalesce(p_data ->> 'note', '')), 500);
  dv := coalesce(p_data ->> 'delivery', 'pickup'); py := coalesce(p_data ->> 'pay', 'cash'); pf := nullif(p_data ->> 'proof', '');
  if length(nm) < 2 then raise exception 'KP_NEED_NAME'; end if;
  if length(regexp_replace(ph, '[^0-9]', '', 'g')) < 7 then raise exception 'KP_NEED_PHONE'; end if;
  if dv not in ('pickup', 'home') or py not in ('cash', 'transfer') then raise exception 'KP_BAD_ORDER'; end if;
  if dv = 'home' and length(ad) < 4 then raise exception 'KP_NEED_ADDRESS'; end if;
  if dv = 'home' and coalesce(st #>> '{delivery,home}', 'true') = 'false' then raise exception 'KP_NO_DELIVERY'; end if;
  if dv = 'pickup' and coalesce(st #>> '{delivery,pickup}', 'true') = 'false' then raise exception 'KP_NO_PICKUP'; end if;
  if py = 'cash' and coalesce(st #>> '{pay,cash}', 'true') = 'false' then raise exception 'KP_NO_CASH'; end if;
  if py = 'transfer' and coalesce(st #>> '{pay,transfer}', 'true') = 'false' then raise exception 'KP_NO_TRANSFER'; end if;
  perform public.kp_img_ok(pf);
  if jsonb_typeof(p_data -> 'items') <> 'array' or jsonb_array_length(p_data -> 'items') = 0 or jsonb_array_length(p_data -> 'items') > 80 then raise exception 'KP_EMPTY_CART'; end if;
  -- حدود الإساءة: 6 طلبات/ساعة لكل مشترٍ، و150 طلباً/ساعة لكل متجر، و400 طلب جديد لم يُعالَج
  select count(*) into cnt from public.kp_orders where shop_id = sid and buyer = b and created_at > now() - interval '1 hour';
  if cnt >= 6 then raise exception 'KP_RATE'; end if;
  select count(*) into cnt from public.kp_orders where shop_id = sid and created_at > now() - interval '1 hour';
  if cnt >= 150 then raise exception 'KP_RATE'; end if;
  select count(*) into cnt from public.kp_orders where shop_id = sid and status = 'new';
  if cnt >= 400 then raise exception 'KP_RATE'; end if;

  for it in select i ->> 'id' as id, sum(public.kp_num(i ->> 'qty')) as qty
            from jsonb_array_elements(p_data -> 'items') i group by i ->> 'id' loop
    q := round(it.qty, 3);
    if q <= 0 or q > 9999 then raise exception 'KP_BAD_QTY'; end if;
    select d.id, d.data into p from public.kp_docs d
      where d.shop_id = sid and d.store = 'products' and d.id = it.id and not d.deleted
        and coalesce(d.data ->> 'active', 'true') <> 'false' and coalesce(d.data ->> 'hideOnline', 'false') <> 'true';
    if p.id is null then raise exception 'KP_GONE'; end if;
    if coalesce(p.data ->> 'unit', 'pc') = 'pc' and q <> trunc(q) then raise exception 'KP_BAD_QTY'; end if;
    if coalesce(p.data ->> 'track', 'true') <> 'false' and public.kp_num(p.data ->> 'stock') < q then raise exception 'KP_STOCK:%', left(p.data ->> 'name', 60); end if;
    o := public.kp_offer_of(sid, p.id, today);
    eff := public.kp_eff_price(public.kp_num(p.data ->> 'price'), o);
    lines := lines || jsonb_build_array(jsonb_build_object('id', p.id, 'name', left(p.data ->> 'name', 160), 'unit', coalesce(p.data ->> 'unit', 'pc'), 'qty', q, 'price', eff, 'total', round(eff * q, 2)));
    sub := sub + round(eff * q, 2);
  end loop;
  mn := public.kp_num(st #>> '{delivery,min}'); fo := public.kp_num(st #>> '{delivery,free_over}');
  if mn > 0 and sub < mn then raise exception 'KP_MIN:%', mn; end if;
  if dv = 'home' then fee := public.kp_num(st #>> '{delivery,fee}'); if fo > 0 and sub >= fo then fee := 0; end if; end if;

  update public.kp_shops set order_seq = order_seq + 1 where id = sid returning order_seq into n;
  insert into public.kp_orders (shop_id, no, buyer, name, phone, address, note, delivery, pay, items, subtotal, fee, total, proof, proof_at)
  values (sid, n, b, nm, ph, ad, nt, dv, py, lines, sub, fee, sub + fee, pf, case when pf is not null then now() end) returning id into oid;
  insert into public.kp_threads (shop_id, buyer, name, phone) values (sid, b, nm, ph)
    on conflict (shop_id, buyer) do update set name = excluded.name, phone = excluded.phone;
  perform public.kp_sys_msg(sid, b, 'تم استلام طلبك رقم ' || n || ' بمبلغ ' || (sub + fee) || ' وسيتم التواصل معك قريباً.', n, false);
  update public.kp_threads set unread_shop = unread_shop + 1 where shop_id = sid and buyer = b;
  return jsonb_build_object('id', oid, 'no', n, 'subtotal', sub, 'fee', fee, 'total', sub + fee, 'status', 'new');
end;
$$;

create or replace function public.kp_store_orders(p_slug text, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; b text;
begin
  sid := public.kp_pub_shop(p_slug); perform public.kp_key_ok(p_key); b := public.kp_bk(p_key);
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'no', o.no, 'status', o.status, 'items', o.items, 'subtotal', o.subtotal, 'fee', o.fee, 'total', o.total,
            'delivery', o.delivery, 'pay', o.pay, 'proof', o.proof is not null, 'shop_note', o.shop_note, 'at', o.created_at) order by o.created_at desc)
          from (select * from public.kp_orders where shop_id = sid and buyer = b order by created_at desc limit 30) o), '[]'::jsonb);
end;
$$;

create or replace function public.kp_store_order_proof(p_slug text, p_key text, p_order uuid, p_proof text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid; b text; o record;
begin
  sid := public.kp_pub_shop(p_slug); perform public.kp_key_ok(p_key); b := public.kp_bk(p_key);
  if p_proof is null then raise exception 'KP_BAD_IMAGE'; end if;
  perform public.kp_img_ok(p_proof);
  select * into o from public.kp_orders where id = p_order and shop_id = sid and buyer = b for update;
  if not found then raise exception 'KP_NO_ORDER'; end if;
  if o.status not in ('new', 'confirmed', 'preparing', 'ready') then raise exception 'KP_ORDER_CLOSED'; end if;
  update public.kp_orders set proof = p_proof, proof_at = now(), updated_at = now() where id = o.id;
  perform public.kp_sys_msg(sid, b, 'تم إرسال إشعار الدفع للطلب رقم ' || o.no, o.no, false);
  update public.kp_threads set unread_shop = unread_shop + 1 where shop_id = sid and buyer = b;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.kp_store_chat_send(p_slug text, p_key text, p_name text, p_phone text, p_body text, p_img text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid; b text; t text; cnt integer; mid bigint;
begin
  sid := public.kp_pub_shop(p_slug); perform public.kp_key_ok(p_key); b := public.kp_bk(p_key);
  t := left(trim(coalesce(p_body, '')), 1000);
  if t = '' and p_img is null then raise exception 'KP_EMPTY_MSG'; end if;
  perform public.kp_img_ok(p_img);
  select count(*) into cnt from public.kp_msgs where shop_id = sid and buyer = b and sender = 'buyer' and created_at > now() - interval '10 minutes';
  if cnt >= 40 then raise exception 'KP_RATE'; end if;
  if not exists (select 1 from public.kp_threads where shop_id = sid and buyer = b) then
    select count(*) into cnt from public.kp_threads where shop_id = sid and created_at > now() - interval '1 hour';
    if cnt >= 200 then raise exception 'KP_RATE'; end if;
  end if;
  insert into public.kp_threads (shop_id, buyer, name, phone) values (sid, b, left(trim(coalesce(p_name, '')), 80), left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20))
    on conflict (shop_id, buyer) do update set name = case when excluded.name <> '' then excluded.name else public.kp_threads.name end,
                                              phone = case when excluded.phone <> '' then excluded.phone else public.kp_threads.phone end;
  insert into public.kp_msgs (shop_id, buyer, sender, body, img) values (sid, b, 'buyer', t, p_img) returning id into mid;
  update public.kp_threads set last_at = now(), last_text = case when t = '' then '📷 صورة' else left(t, 120) end, unread_shop = unread_shop + 1 where shop_id = sid and buyer = b;
  return jsonb_build_object('id', mid);
end;
$$;

create or replace function public.kp_store_chat_get(p_slug text, p_key text, p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid; b text; res jsonb;
begin
  sid := public.kp_pub_shop(p_slug); perform public.kp_key_ok(p_key); b := public.kp_bk(p_key);
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', m.sender, 'kind', m.kind, 'body', m.body, 'img', m.img is not null, 'no', m.order_no, 'at', m.created_at) order by m.id), '[]'::jsonb) into res
    from (select * from public.kp_msgs where shop_id = sid and buyer = b and id > coalesce(p_after, 0) order by id limit 200) m;
  update public.kp_threads set unread_buyer = 0 where shop_id = sid and buyer = b and unread_buyer <> 0;
  return jsonb_build_object('msgs', res);
end;
$$;

create or replace function public.kp_store_msg_img(p_slug text, p_key text, p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; b text; im text;
begin
  sid := public.kp_pub_shop(p_slug); perform public.kp_key_ok(p_key); b := public.kp_bk(p_key);
  select img into im from public.kp_msgs where id = p_id and shop_id = sid and buyer = b;
  return jsonb_build_object('img', im);
end;
$$;

-- ---------- دوال الموظفين (أي عضو في المتجر) ----------
create or replace function public.kp_store_publish(p_slug text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; s text := lower(trim(coalesce(p_slug, '')));
begin
  select * into c from public.kp_ctx();
  if c.v_role <> 'owner' then raise exception 'KP_FORBIDDEN'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{2,31}$' then raise exception 'KP_BAD_SLUG'; end if;
  if exists (select 1 from public.kp_shops where slug = s and id <> c.v_shop) then raise exception 'KP_SLUG_TAKEN'; end if;
  update public.kp_shops set slug = s, store_on = coalesce(p_on, false) where id = c.v_shop;
  return jsonb_build_object('slug', s, 'on', coalesce(p_on, false));
end;
$$;

create or replace function public.kp_store_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record; s record;
begin
  select * into c from public.kp_ctx(); select * into s from public.kp_shops where id = c.v_shop;
  return jsonb_build_object('slug', s.slug, 'on', s.store_on,
    'new_orders', (select count(*) from public.kp_orders where shop_id = c.v_shop and status = 'new'),
    'unread', (select coalesce(sum(unread_shop), 0) from public.kp_threads where shop_id = c.v_shop));
end;
$$;

create or replace function public.kp_orders_list(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.kp_ctx();
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'no', o.no, 'buyer', o.buyer, 'name', o.name, 'phone', o.phone, 'address', o.address, 'note', o.note,
            'delivery', o.delivery, 'pay', o.pay, 'items', o.items, 'subtotal', o.subtotal, 'fee', o.fee, 'total', o.total, 'proof', o.proof is not null, 'proof_at', o.proof_at,
            'status', o.status, 'shop_note', o.shop_note, 'hold_id', o.hold_id, 'at', o.created_at, 'upd', o.updated_at) order by o.created_at desc)
          from (select * from public.kp_orders where shop_id = c.v_shop order by created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) o), '[]'::jsonb);
end;
$$;

create or replace function public.kp_order_proof(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record; im text;
begin
  select * into c from public.kp_ctx();
  select proof into im from public.kp_orders where id = p_order and shop_id = c.v_shop;
  return jsonb_build_object('img', im);
end;
$$;

create or replace function public.kp_order_set(p_order uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; o record; lbl text;
begin
  select * into c from public.kp_ctx();
  if p_status not in ('new', 'confirmed', 'preparing', 'ready', 'done', 'rejected', 'cancelled') then raise exception 'KP_BAD_STATUS'; end if;
  select * into o from public.kp_orders where id = p_order and shop_id = c.v_shop for update;
  if not found then raise exception 'KP_NO_ORDER'; end if;
  update public.kp_orders set status = p_status, shop_note = case when p_note is null then shop_note else left(trim(p_note), 500) end, updated_at = now() where id = o.id;
  if p_status <> o.status then
    lbl := case p_status when 'confirmed' then 'تم تأكيد طلبك' when 'preparing' then 'طلبك قيد التجهيز' when 'ready' then 'طلبك جاهز' when 'done' then 'تم تسليم طلبك. شكراً لك' when 'rejected' then 'نعتذر، تعذّر تنفيذ طلبك' when 'cancelled' then 'تم إلغاء طلبك' else 'تم تحديث حالة طلبك' end;
    perform public.kp_sys_msg(c.v_shop, o.buyer, lbl || ' (رقم ' || o.no || ')' || case when coalesce(trim(p_note), '') <> '' then ': ' || left(trim(p_note), 200) else '' end, o.no);
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.kp_order_link(p_order uuid, p_hold text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.kp_ctx();
  update public.kp_orders set hold_id = left(p_hold, 80), updated_at = now() where id = p_order and shop_id = c.v_shop;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.kp_threads_list(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.kp_ctx();
  return coalesce((select jsonb_agg(jsonb_build_object('buyer', t.buyer, 'name', t.name, 'phone', t.phone, 'last_at', t.last_at, 'last_text', t.last_text, 'unread', t.unread_shop) order by t.last_at desc)
          from (select * from public.kp_threads where shop_id = c.v_shop order by last_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) t), '[]'::jsonb);
end;
$$;

create or replace function public.kp_chat_staff_get(p_buyer text, p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; res jsonb;
begin
  select * into c from public.kp_ctx();
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', m.sender, 'kind', m.kind, 'body', m.body, 'img', m.img is not null, 'no', m.order_no, 'at', m.created_at) order by m.id), '[]'::jsonb) into res
    from (select * from public.kp_msgs where shop_id = c.v_shop and buyer = p_buyer and id > coalesce(p_after, 0) order by id limit 200) m;
  update public.kp_threads set unread_shop = 0 where shop_id = c.v_shop and buyer = p_buyer and unread_shop <> 0;
  return jsonb_build_object('msgs', res);
end;
$$;

create or replace function public.kp_chat_staff_send(p_buyer text, p_body text, p_img text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; t text; mid bigint;
begin
  select * into c from public.kp_ctx();
  t := left(trim(coalesce(p_body, '')), 1000);
  if t = '' and p_img is null then raise exception 'KP_EMPTY_MSG'; end if;
  perform public.kp_img_ok(p_img);
  if not exists (select 1 from public.kp_threads where shop_id = c.v_shop and buyer = p_buyer) then raise exception 'KP_NO_THREAD'; end if;
  insert into public.kp_msgs (shop_id, buyer, sender, body, img) values (c.v_shop, p_buyer, 'shop', t, p_img) returning id into mid;
  update public.kp_threads set last_at = now(), last_text = case when t = '' then '📷 صورة' else left(t, 120) end, unread_buyer = unread_buyer + 1 where shop_id = c.v_shop and buyer = p_buyer;
  return jsonb_build_object('id', mid);
end;
$$;

create or replace function public.kp_chat_staff_img(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record; im text;
begin
  select * into c from public.kp_ctx();
  select img into im from public.kp_msgs where id = p_id and shop_id = c.v_shop;
  return jsonb_build_object('img', im);
end;
$$;

-- ---------- الصلاحيات: المستخدمون المسجّلون فقط ----------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('kp_me','kp_create_shop','kp_join_shop','kp_rotate_join_code','kp_remove_member','kp_changes','kp_commit','kp_replace_all',
                                          'kp_store_publish','kp_store_status','kp_orders_list','kp_order_proof','kp_order_set','kp_order_link','kp_threads_list','kp_chat_staff_get','kp_chat_staff_send','kp_chat_staff_img')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('kp_ctx','kp_store_ok','kp_new_code','kp_bk','kp_pub_shop','kp_key_ok','kp_img_ok','kp_settings','kp_offer_of','kp_eff_price','kp_num','kp_sys_msg')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- دوال المشترين (الزائر بلا تسجيل دخول): anon + authenticated
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('kp_store_info','kp_store_products','kp_store_images','kp_store_order','kp_store_orders','kp_store_order_proof','kp_store_chat_send','kp_store_chat_get','kp_store_msg_img')
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

