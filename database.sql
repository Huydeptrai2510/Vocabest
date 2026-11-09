-- VOCABEST database.sql — chạy lại an toàn (idempotent). Chạy trong Supabase SQL Editor.
-- Miền email nội bộ ở handle_new_user() phải khớp INTERNAL_EMAIL_DOMAIN trong script.js.

do $$ begin create type public.app_role as enum ('boss','admin','user'); exception when duplicate_object then null; end $$;
do $$ begin create type public.library_source as enum ('personal','system','community'); exception when duplicate_object then null; end $$;
do $$ begin create type public.library_visibility as enum ('private','public'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  status text not null default 'active' check (status in ('active','locked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table if not exists public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null default 'user',
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now());
create table if not exists public.admin_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null check (permission in ('manage_tags','lock_users','moderate_libraries')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, permission));
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 30),
  description text not null default '',
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table if not exists public.libraries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  source public.library_source not null default 'personal',
  visibility public.library_visibility not null default 'private',
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  tag_id uuid references public.tags(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source = 'system' or owner_id is not null));
create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  term text not null check (char_length(term) between 1 and 100),
  meaning text not null check (char_length(meaning) between 1 and 300),
  example text check (char_length(example) <= 300),
  position int not null default 0,
  created_at timestamptz not null default now());
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null, target_type text not null, target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now());

create index if not exists libraries_owner_idx on public.libraries(owner_id);
create index if not exists libraries_public_idx on public.libraries(visibility, source);
create index if not exists library_items_lib_idx on public.library_items(library_id, position);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

-- Hàm hỗ trợ -----------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := pg_catalog.now(); return new; end $$;
drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_tags_touch on public.tags;
create trigger trg_tags_touch before update on public.tags for each row execute function public.touch_updated_at();
drop trigger if exists trg_libraries_touch on public.libraries;
create trigger trg_libraries_touch before update on public.libraries for each row execute function public.touch_updated_at();

create or replace function public.has_role(r public.app_role) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = (select auth.uid()) and ur.role = r and p.status = 'active'); $$;
create or replace function public.has_permission(perm text) returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role('boss') or (public.has_role('admin') and exists (select 1 from public.admin_permissions ap
    where ap.user_id = (select auth.uid()) and ap.permission = perm)); $$;
create or replace function public.is_active() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and status = 'active'); $$;

-- Tạo profile + role 'user' khi có tài khoản mới; role KHÔNG lấy từ frontend.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or new.email !~ '^[a-z0-9_]{3,20}@users\.vocabest\.invalid$' then
    raise exception 'Chỉ chấp nhận tài khoản tạo bằng tên đăng nhập hợp lệ';
  end if;
  insert into public.profiles(id, username) values (new.id, pg_catalog.split_part(new.email, '@', 1));
  insert into public.user_roles(user_id, role) values (new.id, 'user');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.log_tag_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'tag_' || pg_catalog.lower(tg_op), 'tag', coalesce(new.id, old.id)::text,
          pg_catalog.jsonb_build_object('name', coalesce(new.name, old.name)));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_tags_audit on public.tags;
create trigger trg_tags_audit after insert or update or delete on public.tags for each row execute function public.log_tag_change();

-- RPC đặc quyền (kiểm tra quyền ngay trong database) ------------------------
create or replace function public.set_admin(target uuid, make_admin boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('boss') then raise exception 'Không đủ quyền'; end if;
  if not exists (select 1 from public.user_roles where user_id = target and role in ('user','admin')) then
    raise exception 'Không thể thay đổi tài khoản này'; end if;
  update public.user_roles set role = case when make_admin then 'admin'::public.app_role else 'user'::public.app_role end,
    granted_by = (select auth.uid()) where user_id = target;
  if not make_admin then delete from public.admin_permissions where user_id = target; end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id)
  values ((select auth.uid()), case when make_admin then 'admin_appointed' else 'admin_removed' end, 'user', target::text);
end $$;

create or replace function public.set_admin_permission(target uuid, perm text, allowed boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('boss') then raise exception 'Không đủ quyền'; end if;
  if not exists (select 1 from public.user_roles where user_id = target and role = 'admin') then
    raise exception 'Tài khoản này không phải Admin'; end if;
  if allowed then
    insert into public.admin_permissions(user_id, permission, granted_by) values (target, perm, (select auth.uid())) on conflict do nothing;
  else
    delete from public.admin_permissions where user_id = target and permission = perm;
  end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'admin_permission_changed', 'user', target::text, pg_catalog.jsonb_build_object('permission', perm, 'allowed', allowed));
end $$;

create or replace function public.set_account_status(target uuid, new_status text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.app_role;
begin
  if new_status not in ('active','locked') then raise exception 'Trạng thái không hợp lệ'; end if;
  if not public.has_permission('lock_users') then raise exception 'Không đủ quyền'; end if;
  select role into t from public.user_roles where user_id = target;
  if t is null or t = 'boss' or target = (select auth.uid()) or (t = 'admin' and not public.has_role('boss')) then
    raise exception 'Không thể thay đổi tài khoản này'; end if;
  update public.profiles set status = new_status where id = target;
  insert into public.audit_logs(actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'account_' || new_status, 'user', target::text, '{}');
end $$;

revoke execute on function public.touch_updated_at(), public.handle_new_user(), public.log_tag_change() from public, anon, authenticated;
revoke execute on function public.has_role(public.app_role), public.has_permission(text), public.is_active(),
  public.set_admin(uuid, boolean), public.set_admin_permission(uuid, text, boolean), public.set_account_status(uuid, text) from public, anon;
grant execute on function public.has_role(public.app_role), public.has_permission(text), public.is_active(),
  public.set_admin(uuid, boolean), public.set_admin_permission(uuid, text, boolean), public.set_account_status(uuid, text) to authenticated;

-- Quyền bảng + RLS ------------------------------------------------------
revoke all on public.profiles, public.user_roles, public.admin_permissions, public.tags, public.libraries, public.library_items, public.audit_logs from anon, authenticated;
grant select on public.profiles, public.user_roles, public.admin_permissions, public.tags, public.audit_logs to authenticated;
grant insert, delete on public.tags to authenticated;
grant update (name, description, color) on public.tags to authenticated;
grant select, insert, delete on public.libraries, public.library_items to authenticated;
grant update (title, description, visibility, tag_id) on public.libraries to authenticated;
grant update (term, meaning, example, position) on public.library_items to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.tags enable row level security;
alter table public.libraries enable row level security;
alter table public.library_items enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.has_permission('lock_users'));
drop policy if exists roles_select on public.user_roles;
create policy roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('lock_users'));
drop policy if exists perms_select on public.admin_permissions;
create policy perms_select on public.admin_permissions for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role('boss'));
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (public.has_role('boss'));

drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags for select to authenticated using (true);
drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags for insert to authenticated with check (public.has_permission('manage_tags'));
drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags for update to authenticated using (public.has_permission('manage_tags')) with check (public.has_permission('manage_tags'));
drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags for delete to authenticated using (public.has_permission('manage_tags'));

drop policy if exists libs_select on public.libraries;
create policy libs_select on public.libraries for select to authenticated
  using (owner_id = (select auth.uid()) or visibility = 'public');
drop policy if exists libs_insert on public.libraries;
create policy libs_insert on public.libraries for insert to authenticated with check (public.is_active() and (
  (source in ('personal','community') and owner_id = (select auth.uid())) or (source = 'system' and public.has_role('boss'))));
drop policy if exists libs_update on public.libraries;
create policy libs_update on public.libraries for update to authenticated
  using ((owner_id = (select auth.uid()) and source <> 'system' and public.is_active()) or (source = 'system' and public.has_role('boss')))
  with check ((owner_id = (select auth.uid()) and source <> 'system' and public.is_active()) or (source = 'system' and public.has_role('boss')));
drop policy if exists libs_delete on public.libraries;
create policy libs_delete on public.libraries for delete to authenticated
  using ((owner_id = (select auth.uid()) and source <> 'system' and public.is_active()) or (source = 'system' and public.has_role('boss'))
    or (visibility = 'public' and source <> 'system' and public.has_permission('moderate_libraries')));

drop policy if exists items_select on public.library_items;
create policy items_select on public.library_items for select to authenticated
  using (exists (select 1 from public.libraries l where l.id = library_id));
drop policy if exists items_write on public.library_items;
create policy items_write on public.library_items for all to authenticated
  using (exists (select 1 from public.libraries l where l.id = library_id and
    ((l.owner_id = (select auth.uid()) and l.source <> 'system' and public.is_active()) or (l.source = 'system' and public.has_role('boss')))))
  with check (exists (select 1 from public.libraries l where l.id = library_id and
    ((l.owner_id = (select auth.uid()) and l.source <> 'system' and public.is_active()) or (l.source = 'system' and public.has_role('boss')))));

-- Seed 6 tag CEFR ---------------------------------------------------------
insert into public.tags(name, description, color) values
  ('A1','Sơ cấp: từ vựng sinh tồn hằng ngày','#FFD84D'),
  ('A2','Cơ bản: giao tiếp đơn giản quen thuộc','#FFC233'),
  ('B1','Trung cấp: xử lý hầu hết tình huống thường gặp','#FFA726'),
  ('B2','Trung cao: trao đổi trôi chảy về nhiều chủ đề','#FB8C2E'),
  ('C1','Cao cấp: diễn đạt linh hoạt, chính xác','#F26B1D'),
  ('C2','Thành thạo: gần như người bản ngữ','#D9500F')
on conflict (name) do nothing;

-- GÁN BOSS (chạy THỦ CÔNG sau khi đã đăng ký tài khoản trên website; thay tên đăng nhập):
-- update public.user_roles set role = 'boss'
--  where user_id = (select id from public.profiles where username = 'ten_dang_nhap_cua_ban');

-- ===================== PROMPT 2: thư viện & học tập (chạy lại an toàn) =====================
create or replace function public.item_count(lib uuid) returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.library_items where library_id = lib $$;
create or replace function public.norm(t text) returns text language sql immutable set search_path = '' as $$
  select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(t), '\s+', ' ', 'g')) $$;
create or replace function public.norm_word(t text) returns text language sql immutable set search_path = '' as $$
  select pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.btrim(t), '^[.,;:!?"'']+|[.,;:!?"'']+$', '', 'g'))) $$;

-- Quy tắc >= 8 mục để công khai: chặn ở database, không thể bỏ qua bằng API.
create or replace function public.enforce_public_min() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'public' and public.item_count(new.id) < 8 then
    raise exception 'Cần tối thiểu 8 mục từ để công khai thư viện'; end if;
  return new;
end $$;
drop trigger if exists trg_libs_public_min on public.libraries;
create trigger trg_libs_public_min before insert or update of visibility on public.libraries for each row execute function public.enforce_public_min();

create or replace function public.demote_small_library() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.libraries set visibility = 'private' where id = old.library_id and visibility = 'public' and public.item_count(old.library_id) < 8;
  return old;
end $$;
drop trigger if exists trg_items_demote on public.library_items;
create trigger trg_items_demote after delete on public.library_items for each row execute function public.demote_small_library();
-- Tương thích dữ liệu cũ: thư viện công khai dưới 8 mục chuyển về riêng tư.
update public.libraries set visibility = 'private' where visibility = 'public' and public.item_count(id) < 8;

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  library_id uuid not null references public.libraries(id) on delete cascade,
  mode text not null check (mode in ('classic','speed')),
  direction text not null check (direction in ('en_vi','vi_en')),
  planned_count int check (planned_count between 1 and 100),
  planned_seconds int check (planned_seconds between 10 and 3600),
  started_at timestamptz not null default now(),
  ended_at timestamptz, total int, correct int, duration_seconds int,
  check ((mode = 'classic' and planned_count is not null) or (mode = 'speed' and planned_seconds is not null)));
create table if not exists public.study_attempts (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  item_id uuid not null references public.library_items(id) on delete cascade,
  qtype text not null check (qtype in ('flashcard','mcq','type','match','fill')),
  answer text check (char_length(answer) <= 400),
  blank_pos int check (blank_pos >= 1),
  self_correct boolean,
  correct boolean not null default false,
  created_at timestamptz not null default now());
create table if not exists public.word_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.library_items(id) on delete cascade,
  seen int not null default 0, correct int not null default 0, wrong int not null default 0,
  last_seen timestamptz not null default now(),
  primary key (user_id, item_id));
create index if not exists sessions_user_idx on public.study_sessions(user_id, started_at desc);
create index if not exists attempts_session_idx on public.study_attempts(session_id);
create index if not exists progress_user_idx on public.word_progress(user_id, wrong desc);

-- Chấm điểm ở database: client chỉ gửi câu trả lời, `correct` do trigger quyết định (flashcard là tự đánh giá).
create or replace function public.grade_attempt() returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.study_sessions; it public.library_items; exp text;
begin
  select * into s from public.study_sessions where id = new.session_id and user_id = (select auth.uid());
  if not found or s.ended_at is not null then raise exception 'Phiên học không hợp lệ'; end if;
  select * into it from public.library_items where id = new.item_id and library_id = s.library_id;
  if not found then raise exception 'Mục từ không thuộc thư viện của phiên học'; end if;
  new.user_id := s.user_id;
  if new.qtype = 'flashcard' then
    new.correct := coalesce(new.self_correct, false);
  else
    exp := case when s.direction = 'en_vi' then it.meaning else it.term end;
    if new.qtype = 'fill' then
      new.correct := new.answer is not null and public.norm_word(new.answer) =
        public.norm_word((pg_catalog.regexp_split_to_array(pg_catalog.btrim(exp), '\s+'))[new.blank_pos]);
    else
      new.correct := new.answer is not null and public.norm(new.answer) = public.norm(exp);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_attempts_grade on public.study_attempts;
create trigger trg_attempts_grade before insert on public.study_attempts for each row execute function public.grade_attempt();

create or replace function public.bump_progress() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.word_progress(user_id, item_id, seen, correct, wrong, last_seen)
  values (new.user_id, new.item_id, 1, case when new.correct then 1 else 0 end, case when new.correct then 0 else 1 end, pg_catalog.now())
  on conflict (user_id, item_id) do update set seen = public.word_progress.seen + 1,
    correct = public.word_progress.correct + excluded.correct, wrong = public.word_progress.wrong + excluded.wrong, last_seen = pg_catalog.now();
  return new;
end $$;
drop trigger if exists trg_attempts_progress on public.study_attempts;
create trigger trg_attempts_progress after insert on public.study_attempts for each row execute function public.bump_progress();

create or replace function public.finish_study_session(sid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.study_sessions s set ended_at = pg_catalog.now(),
    total = (select count(*) from public.study_attempts a where a.session_id = s.id),
    correct = (select count(*) from public.study_attempts a where a.session_id = s.id and a.correct),
    duration_seconds = extract(epoch from pg_catalog.now() - s.started_at)::int
  where s.id = sid and s.user_id = (select auth.uid()) and s.ended_at is null;
end $$;

revoke execute on function public.enforce_public_min(), public.demote_small_library(), public.grade_attempt(), public.bump_progress(), public.norm(text), public.norm_word(text) from public, anon, authenticated;
revoke execute on function public.item_count(uuid), public.finish_study_session(uuid) from public, anon;
grant execute on function public.item_count(uuid), public.finish_study_session(uuid) to authenticated;

revoke all on public.study_sessions, public.study_attempts, public.word_progress from anon, authenticated;
grant select on public.study_sessions, public.study_attempts, public.word_progress to authenticated;
grant insert (library_id, mode, direction, planned_count, planned_seconds) on public.study_sessions to authenticated;
grant insert (session_id, item_id, qtype, answer, blank_pos, self_correct) on public.study_attempts to authenticated;
alter table public.study_sessions enable row level security;
alter table public.study_attempts enable row level security;
alter table public.word_progress enable row level security;
drop policy if exists sessions_select on public.study_sessions;
create policy sessions_select on public.study_sessions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists sessions_insert on public.study_sessions;
create policy sessions_insert on public.study_sessions for insert to authenticated with check (
  user_id = (select auth.uid()) and public.is_active() and public.item_count(library_id) >= 8
  and exists (select 1 from public.libraries l where l.id = library_id));
drop policy if exists attempts_select on public.study_attempts;
create policy attempts_select on public.study_attempts for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists attempts_insert on public.study_attempts;
create policy attempts_insert on public.study_attempts for insert to authenticated with check (user_id = (select auth.uid()) and public.is_active());
drop policy if exists progress_select on public.word_progress;
create policy progress_select on public.word_progress for select to authenticated using (user_id = (select auth.uid()));

-- ===================== PROMPT 3: cộng đồng, kiểm duyệt, quản trị (chạy lại an toàn) =====================
alter table public.libraries add column if not exists moderation text not null default 'ok';
do $$ begin
  alter table public.libraries add constraint libraries_moderation_chk check (moderation in ('ok','reported','hidden','locked'));
exception when duplicate_object then null; end $$;

create or replace function public.can_rate(lib uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active() and exists (select 1 from public.libraries l where l.id = lib and l.visibility = 'public'
    and l.moderation in ('ok','reported') and l.source <> 'system' and l.owner_id is distinct from (select auth.uid())) $$;
create or replace function public.can_report(lib uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active() and exists (select 1 from public.libraries l where l.id = lib and l.visibility = 'public'
    and l.moderation in ('ok','reported') and l.owner_id is distinct from (select auth.uid())) $$;

-- Thư viện hidden/locked biến mất khỏi cộng đồng (chủ sở hữu và người kiểm duyệt vẫn thấy). Thư viện riêng tư luôn riêng tư.
drop policy if exists libs_select on public.libraries;
create policy libs_select on public.libraries for select to authenticated using (
  owner_id = (select auth.uid())
  or (visibility = 'public' and (moderation in ('ok','reported') or public.has_permission('moderate_libraries'))));
drop policy if exists libs_insert on public.libraries;
create policy libs_insert on public.libraries for insert to authenticated with check (public.is_active() and moderation = 'ok' and (
  (source in ('personal','community') and owner_id = (select auth.uid())) or (source = 'system' and public.has_role('boss'))));
drop policy if exists libs_update on public.libraries;
create policy libs_update on public.libraries for update to authenticated
  using ((owner_id = (select auth.uid()) and source <> 'system' and moderation <> 'locked' and public.is_active()) or (source = 'system' and public.has_role('boss')))
  with check ((owner_id = (select auth.uid()) and source <> 'system' and moderation <> 'locked' and public.is_active()) or (source = 'system' and public.has_role('boss')));
drop policy if exists libs_delete on public.libraries;
create policy libs_delete on public.libraries for delete to authenticated
  using ((owner_id = (select auth.uid()) and source <> 'system' and moderation <> 'locked' and public.is_active())
    or (source = 'system' and public.has_role('boss')) or (visibility = 'public' and public.has_role('boss')));

-- Đánh giá: 1 người / 1 thư viện, sửa được, không tự đánh giá.
create table if not exists public.library_ratings (
  library_id uuid not null references public.libraries(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  stars int not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (library_id, user_id));
drop trigger if exists trg_ratings_touch on public.library_ratings;
create trigger trg_ratings_touch before update on public.library_ratings for each row execute function public.touch_updated_at();
alter table public.library_ratings enable row level security;
revoke all on public.library_ratings from anon, authenticated;
grant select on public.library_ratings to authenticated;
grant insert (library_id, stars) on public.library_ratings to authenticated;
grant update (stars) on public.library_ratings to authenticated;
drop policy if exists ratings_select on public.library_ratings;
create policy ratings_select on public.library_ratings for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ratings_insert on public.library_ratings;
create policy ratings_insert on public.library_ratings for insert to authenticated with check (user_id = (select auth.uid()) and public.can_rate(library_id));
drop policy if exists ratings_update on public.library_ratings;
create policy ratings_update on public.library_ratings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.can_rate(library_id));

-- Báo cáo: chỉ 1 báo cáo đang xử lý cho mỗi cặp (người báo cáo, thư viện) và tối đa 10 báo cáo / 24 giờ.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  library_id uuid not null references public.libraries(id) on delete cascade,
  reason text not null check (reason in ('inappropriate','misleading','spam','violation','other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open','in_review','accepted','rejected')),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  resolution text check (char_length(resolution) <= 300),
  created_at timestamptz not null default now());
create unique index if not exists reports_active_uniq on public.content_reports(reporter_id, library_id) where status in ('open','in_review');
create index if not exists reports_status_idx on public.content_reports(status, created_at desc);
alter table public.content_reports enable row level security;
revoke all on public.content_reports from anon, authenticated;
grant select on public.content_reports to authenticated;
grant insert (library_id, reason, details) on public.content_reports to authenticated;
drop policy if exists reports_select on public.content_reports;
create policy reports_select on public.content_reports for select to authenticated using (reporter_id = (select auth.uid()));
drop policy if exists reports_insert on public.content_reports;
create policy reports_insert on public.content_reports for insert to authenticated with check (reporter_id = (select auth.uid()) and public.can_report(library_id));

create or replace function public.report_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.content_reports where reporter_id = new.reporter_id and created_at > pg_catalog.now() - interval '1 day') >= 10 then
    raise exception 'Bạn đã gửi quá nhiều báo cáo hôm nay. Hãy thử lại sau';
  end if;
  return new;
end $$;
drop trigger if exists trg_reports_guard on public.content_reports;
create trigger trg_reports_guard before insert on public.content_reports for each row execute function public.report_guard();
create or replace function public.report_mark() returns trigger language plpgsql security definer set search_path = '' as $$
begin update public.libraries set moderation = 'reported' where id = new.library_id and moderation = 'ok'; return new; end $$;
drop trigger if exists trg_reports_mark on public.content_reports;
create trigger trg_reports_mark after insert on public.content_reports for each row execute function public.report_mark();

-- Không xóa thẻ đang được thư viện sử dụng.
create or replace function public.tag_delete_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.libraries where tag_id = old.id;
  if n > 0 then raise exception 'Thẻ đang được dùng bởi % thư viện, không thể xóa', n; end if;
  return old;
end $$;
drop trigger if exists trg_tags_delete_guard on public.tags;
create trigger trg_tags_delete_guard before delete on public.tags for each row execute function public.tag_delete_guard();

-- Cộng đồng: tác giả, điểm và lượt học lấy từ dữ liệu thật (người học khác chủ thư viện, đếm theo người).
create or replace function public.community_libraries(q text default '', tagid uuid default null, sortby text default 'new', lim int default 40)
returns table(id uuid, title text, description text, author text, tag_name text, tag_color text, items int, avg_rating numeric, rating_count int, learners int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select x.id, x.title, x.description, x.author, x.tag_name, x.tag_color, x.items, x.avg_rating, x.rating_count, x.learners, x.created_at
  from (
    select l.id, l.title, l.description, p.username as author, t.name as tag_name, t.color as tag_color,
      (select count(*)::int from public.library_items i where i.library_id = l.id) as items,
      (select round(avg(r.stars)::numeric, 2) from public.library_ratings r where r.library_id = l.id) as avg_rating,
      (select count(*)::int from public.library_ratings r where r.library_id = l.id) as rating_count,
      (select count(distinct s.user_id)::int from public.study_sessions s where s.library_id = l.id and s.user_id <> l.owner_id and s.ended_at is not null) as learners,
      ((select coalesce(sum(r.stars), 0) from public.library_ratings r where r.library_id = l.id) + 9.0)
        / ((select count(*) from public.library_ratings r where r.library_id = l.id) + 3) as score,
      l.created_at
    from public.libraries l
    join public.profiles p on p.id = l.owner_id
    left join public.tags t on t.id = l.tag_id
    where l.visibility = 'public' and l.source <> 'system' and l.moderation in ('ok','reported')
      and (q = '' or l.title ilike '%' || replace(replace(q, '%', ''), '_', '') || '%')
      and (tagid is null or l.tag_id = tagid)
      and (select auth.uid()) is not null
  ) x
  order by case when sortby = 'rating' then x.score end desc nulls last,
           case when sortby = 'popular' then x.learners end desc nulls last,
           x.created_at desc
  limit least(greatest(lim, 1), 100) $$;

create or replace function public.library_social(lib uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.libraries;
begin
  select * into l from public.libraries where id = lib;
  if not found then return null; end if;
  if not (l.owner_id = (select auth.uid()) or (l.visibility = 'public' and (l.moderation in ('ok','reported') or public.has_permission('moderate_libraries')))) then
    return null; end if;
  return jsonb_build_object(
    'author', (select username from public.profiles where id = l.owner_id),
    'avg', (select round(avg(stars)::numeric, 2) from public.library_ratings where library_id = lib),
    'count', (select count(*) from public.library_ratings where library_id = lib),
    'mine', (select stars from public.library_ratings where library_id = lib and user_id = (select auth.uid())),
    'can_rate', public.can_rate(lib), 'can_report', public.can_report(lib));
end $$;

-- Kiểm duyệt: mọi thay đổi đều qua RPC có kiểm tra quyền và ghi audit_logs.
create or replace function public.set_library_moderation(lib uuid, new_status text, note text default '') returns void language plpgsql security definer set search_path = '' as $$
declare l public.libraries; final text;
begin
  if new_status not in ('ok','hidden','locked') then raise exception 'Trạng thái không hợp lệ'; end if;
  if not public.has_permission('moderate_libraries') then raise exception 'Không đủ quyền'; end if;
  select * into l from public.libraries where id = lib;
  if not found then raise exception 'Không tìm thấy thư viện'; end if;
  if l.source = 'system' and not public.has_role('boss') then raise exception 'Chỉ Boss được kiểm duyệt thư viện hệ thống'; end if;
  final := case when new_status = 'ok' and exists (select 1 from public.content_reports where library_id = lib and status in ('open','in_review')) then 'reported' else new_status end;
  update public.libraries set moderation = final where id = lib;
  insert into public.audit_logs(actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'library_' || new_status, 'library', lib::text, pg_catalog.jsonb_build_object('from', l.moderation, 'note', left(coalesce(note, ''), 300)));
end $$;

create or replace function public.resolve_report(rid uuid, new_status text, note text default '') returns void language plpgsql security definer set search_path = '' as $$
declare r public.content_reports;
begin
  if new_status not in ('in_review','accepted','rejected') then raise exception 'Trạng thái không hợp lệ'; end if;
  if not public.has_permission('moderate_libraries') then raise exception 'Không đủ quyền'; end if;
  update public.content_reports set status = new_status, handled_by = (select auth.uid()), handled_at = pg_catalog.now(), resolution = left(coalesce(note, ''), 300)
    where id = rid and status in ('open','in_review') returning * into r;
  if not found then raise exception 'Báo cáo không tồn tại hoặc đã được xử lý'; end if;
  if new_status <> 'in_review' and not exists (select 1 from public.content_reports where library_id = r.library_id and status in ('open','in_review')) then
    update public.libraries set moderation = 'ok' where id = r.library_id and moderation = 'reported';
  end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'report_' || new_status, 'report', rid::text, pg_catalog.jsonb_build_object('library', r.library_id, 'note', left(coalesce(note, ''), 300)));
end $$;

create or replace function public.admin_reports(st text default '')
returns table(id uuid, library_id uuid, library_title text, library_moderation text, reporter text, reason text, details text, status text, resolution text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('moderate_libraries') then raise exception 'Không đủ quyền'; end if;
  return query select r.id, r.library_id, l.title, l.moderation, p.username, r.reason, r.details, r.status, r.resolution, r.created_at
    from public.content_reports r join public.libraries l on l.id = r.library_id left join public.profiles p on p.id = r.reporter_id
    where (st = '' or r.status = st) order by r.created_at desc limit 100;
end $$;

create or replace function public.admin_libraries(q text default '', srcf text default '', modst text default '')
returns table(id uuid, title text, source text, visibility text, moderation text, author text, items int, open_reports int, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('moderate_libraries') then raise exception 'Không đủ quyền'; end if;
  return query select l.id, l.title, l.source::text, l.visibility::text, l.moderation, p.username,
      (select count(*)::int from public.library_items i where i.library_id = l.id),
      (select count(*)::int from public.content_reports r where r.library_id = l.id and r.status in ('open','in_review')),
      l.created_at
    from public.libraries l left join public.profiles p on p.id = l.owner_id
    where (public.has_role('boss') or l.source = 'system' or l.visibility = 'public')
      and (q = '' or l.title ilike '%' || replace(replace(q, '%', ''), '_', '') || '%')
      and (srcf = '' or (srcf = 'system' and l.source = 'system') or (srcf = 'user' and l.source <> 'system'))
      and (modst = '' or l.moderation = modst)
    order by l.created_at desc limit 100;
end $$;

create or replace function public.admin_stats() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_role('boss') or public.has_role('admin')) then raise exception 'Không đủ quyền'; end if;
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_active', (select count(*) from public.profiles where status = 'active'),
    'libs_total', (select count(*) from public.libraries),
    'libs_public', (select count(*) from public.libraries where visibility = 'public' and moderation in ('ok','reported')),
    'reports_open', (select count(*) from public.content_reports where status in ('open','in_review')));
end $$;

create or replace function public.admin_recent_activity(lim int default 15, for_target text default null)
returns table(actor text, action text, target_type text, target_id text, details jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.username, a.action, a.target_type, a.target_id, a.details, a.created_at
  from public.audit_logs a left join public.profiles p on p.id = a.actor_id
  where (public.has_role('boss') or (public.has_role('admin') and (
      (a.target_type in ('library','report') and public.has_permission('moderate_libraries'))
      or (a.target_type = 'user' and public.has_permission('lock_users'))
      or (a.target_type = 'tag' and public.has_permission('manage_tags')))))
    and (for_target is null or a.target_id = for_target)
  order by a.created_at desc limit least(greatest(lim, 1), 100) $$;

-- Xóa vĩnh viễn tài khoản: CHỈ Boss. Nếu quyền hiện tại không xóa được auth.users, giao dịch bị hủy và dữ liệu giữ nguyên.
create or replace function public.delete_account(target uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.app_role;
begin
  if not public.has_role('boss') then raise exception 'Chỉ Boss được xóa vĩnh viễn tài khoản'; end if;
  select role into t from public.user_roles where user_id = target;
  if t is null then raise exception 'Không tìm thấy tài khoản'; end if;
  if t = 'boss' or target = (select auth.uid()) then raise exception 'Không thể xóa tài khoản này'; end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'account_deleted', 'user', target::text, pg_catalog.jsonb_build_object('role', t::text));
  begin
    delete from auth.users where id = target;
  exception when insufficient_privilege then
    raise exception 'Supabase không cho phép xóa tài khoản Auth bằng SQL với quyền hiện tại. Cần backend đặc quyền (Edge Function dùng service_role). Dữ liệu được giữ nguyên.';
  end;
  if exists (select 1 from public.profiles where id = target) then raise exception 'Không xóa được tài khoản'; end if;
end $$;

revoke execute on function public.report_guard(), public.report_mark(), public.tag_delete_guard() from public, anon, authenticated;
revoke execute on function public.can_rate(uuid), public.can_report(uuid), public.library_social(uuid),
  public.community_libraries(text, uuid, text, int), public.set_library_moderation(uuid, text, text), public.resolve_report(uuid, text, text),
  public.admin_reports(text), public.admin_libraries(text, text, text), public.admin_stats(), public.admin_recent_activity(int, text),
  public.delete_account(uuid) from public, anon;
grant execute on function public.can_rate(uuid), public.can_report(uuid), public.library_social(uuid),
  public.community_libraries(text, uuid, text, int), public.set_library_moderation(uuid, text, text), public.resolve_report(uuid, text, text),
  public.admin_reports(text), public.admin_libraries(text, text, text), public.admin_stats(), public.admin_recent_activity(int, text),
  public.delete_account(uuid) to authenticated;
