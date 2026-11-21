-- ============================================================================
-- 湖科资料库 · Supabase 后端 schema
-- 目标版本：Postgres 15+（Supabase 默认）
-- 使用方式：Supabase 控制台 → SQL Editor → 整段执行（可重复执行，幂等）
-- 或在本地：supabase db push / psql "$DATABASE_URL" -f supabase/schema.sql
--
-- 设计约定
--   1. 不做登录：anon 角色可读已发布内容，可写「待审」内容，写入一律 status=pending。
--   2. auth 只预留：uploader_id / author_id / reporter_id 外键指向 auth.users，
--      当前恒为 null；将来接入登录后无需改表结构。
--   3. 管理员 = service_role 服务端密钥（见 lib/supabase/server.js），
--      或将来 JWT 里 app_metadata.role = 'admin'（见 public.is_admin()）。
--   4. 文件桶 resources 私有：pending/ 只有管理员可读，published/ 匿名可读（签名 URL）。
-- ============================================================================

-- gen_random_uuid() 自 PG13 起为内置函数；pgcrypto 仅在更老的内核上需要，缺失不阻断建表
do $$ begin
  create extension if not exists pgcrypto;
exception when others then
  raise notice 'pgcrypto 不可用（PG13+ 已内置 gen_random_uuid，忽略）';
end $$;

-- pg_trgm 用于标题模糊搜索；个别自建实例未装该扩展时降级为普通 ilike 扫描，不阻断建表
do $$ begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm 不可用，标题模糊索引将跳过';
end $$;

-- ---------------------------------------------------------------------------
-- 0. 枚举
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.resource_status as enum ('pending', 'published', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.resource_type as enum ('复习资料', '课程笔记', '练习题', '课件', '其他');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.semester_type as enum ('上学期', '下学期');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_reason as enum ('侵权', '内容错误', '无法下载', '广告或违法', '其他');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_status as enum ('pending', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. 管理员判定（预留：JWT app_metadata.role = 'admin'）
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role',
    ''
  ) = 'admin'
  or coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

comment on function public.is_admin() is
  '管理员判定：service_role 或 JWT app_metadata.role=admin。匿名访问返回 false。';

-- ---------------------------------------------------------------------------
-- 2. 更新时间触发器
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 学院
-- ---------------------------------------------------------------------------
create table if not exists public.colleges (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 60),
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists colleges_name_key on public.colleges (name);
create unique index if not exists colleges_slug_key on public.colleges (slug);

comment on table public.colleges is '学院。slug 用于 URL 与前端既有字符串 id 兼容（如 cs）。';

-- ---------------------------------------------------------------------------
-- 4. 专业
-- ---------------------------------------------------------------------------
create table if not exists public.majors (
  id         uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 60),
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists majors_college_name_key on public.majors (college_id, name);
create unique index if not exists majors_slug_key on public.majors (slug);

-- ---------------------------------------------------------------------------
-- 5. 课程
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id         uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete cascade,
  major_id   uuid references public.majors (id) on delete set null,
  code       text,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  credits    numeric(3,1) check (credits is null or (credits >= 0 and credits <= 30)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists courses_college_name_key on public.courses (college_id, name);
create unique index if not exists courses_slug_key on public.courses (slug);
create index if not exists courses_major_idx on public.courses (major_id);

drop trigger if exists courses_set_updated_at on public.courses;
create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. 资源（核心表）
--    file_url 存 Storage 对象路径（如 published/<uuid>/note.pdf）或站内/外链；
--    pending 阶段为 pending/ 前缀，审核通过后由服务端移动到 published/ 并改写。
-- ---------------------------------------------------------------------------
create table if not exists public.resources (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 2 and 120),
  course_id     uuid not null references public.courses (id) on delete restrict,
  year          smallint not null check (year between 2000 and 2100),
  semester      public.semester_type not null,
  type          public.resource_type not null,
  teacher       text check (teacher is null or char_length(teacher) <= 60),
  file_url      text not null check (char_length(file_url) between 1 and 1024),
  file_name     text check (file_name is null or char_length(file_name) <= 200),
  file_size     bigint check (file_size is null or (file_size > 0 and file_size <= 52428800)),
  mime_type     text check (
                  mime_type is null or mime_type in (
                    'application/pdf',
                    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  )
                ),
  uploader_id   uuid references auth.users (id) on delete set null, -- 预留：当前恒为 null
  uploader_name text not null default '匿名' check (char_length(uploader_name) between 1 and 24),
  downloads     integer not null default 0 check (downloads >= 0),
  status        public.resource_status not null default 'pending',
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 200),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users (id) on delete set null,  -- 预留
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists resources_status_created_idx on public.resources (status, created_at desc);
create index if not exists resources_course_idx on public.resources (course_id, year desc, semester);
create index if not exists resources_downloads_idx on public.resources (downloads desc) where status = 'published';

do $$ begin
  create index if not exists resources_title_trgm_idx on public.resources using gin (title gin_trgm_ops);
exception when others then
  raise notice '跳过 gin_trgm_ops 索引（pg_trgm 未安装）';
end $$;

drop trigger if exists resources_set_updated_at on public.resources;
create trigger resources_set_updated_at
  before update on public.resources
  for each row execute function public.set_updated_at();

comment on column public.resources.status is 'pending=待审（默认）/ published=已发布 / rejected=已驳回';
comment on column public.resources.file_url is 'Storage 对象路径或外链。pending 资源位于 pending/ 前缀，未发布不可公开读取。';

-- ---------------------------------------------------------------------------
-- 7. 评论
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete cascade,
  content     text not null check (char_length(btrim(content)) between 1 and 1000),
  author_id   uuid references auth.users (id) on delete set null, -- 预留
  author_name text not null default '匿名' check (char_length(author_name) between 1 and 24),
  status      public.resource_status not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists comments_resource_status_idx on public.comments (resource_id, status, created_at desc);
create index if not exists comments_status_created_idx on public.comments (status, created_at desc);

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. 举报 / 投诉
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  resource_id     uuid not null references public.resources (id) on delete cascade,
  reason          public.report_reason not null,
  detail          text check (detail is null or char_length(detail) <= 500),
  contact         text check (contact is null or char_length(contact) <= 100),
  reporter_id     uuid references auth.users (id) on delete set null, -- 预留
  status          public.report_status not null default 'pending',
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists reports_status_created_idx on public.reports (status, created_at desc);
create index if not exists reports_resource_idx on public.reports (resource_id);

-- ---------------------------------------------------------------------------
-- 9. 下载计数 RPC（匿名不可 UPDATE 表，只可调用该函数 +1）
-- ---------------------------------------------------------------------------
create or replace function public.increment_downloads(p_resource_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_downloads integer;
begin
  update public.resources
     set downloads = downloads + 1
   where id = p_resource_id
     and status = 'published'
  returning downloads into v_downloads;

  if v_downloads is null then
    raise exception 'RESOURCE_NOT_PUBLISHED' using errcode = 'P0002';
  end if;

  return v_downloads;
end;
$$;

comment on function public.increment_downloads(uuid) is '已发布资源下载数 +1，返回最新计数；未发布抛 RESOURCE_NOT_PUBLISHED。';

revoke all on function public.increment_downloads(uuid) from public;
grant execute on function public.increment_downloads(uuid) to anon, authenticated;

-- 管理员审核 RPC（服务端也可用 service_role 直接 update）
create or replace function public.approve_resource(p_resource_id uuid)
returns public.resources
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.resources;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.resources
     set status = 'published',
         reject_reason = null,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = p_resource_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

create or replace function public.reject_resource(p_resource_id uuid, p_reason text default null)
returns public.resources
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.resources;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.resources
     set status = 'rejected',
         reject_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = p_resource_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.approve_resource(uuid) from public;
revoke all on function public.reject_resource(uuid, text) from public;
grant execute on function public.approve_resource(uuid) to authenticated, service_role;
grant execute on function public.reject_resource(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. 兼容视图：字段与前端 mock 完全一致（status published → approved）
-- ---------------------------------------------------------------------------
create or replace view public.v_resources_public
with (security_invoker = true) as
select
  r.id,
  r.title,
  c.slug                          as course_id,   -- 前端沿用字符串课程 id
  r.year,
  r.semester::text                as semester,
  r.type::text                    as type,
  coalesce(r.teacher, '')         as teacher,
  r.file_url,
  r.uploader_name                 as uploader,
  r.uploader_id,
  r.downloads,
  case r.status when 'published' then 'approved' else r.status::text end as status,
  col.slug                        as college_id,
  maj.slug                        as major_id,
  r.file_name,
  r.file_size,
  r.mime_type,
  r.created_at
from public.resources r
join public.courses c   on c.id = r.course_id
join public.colleges col on col.id = c.college_id
left join public.majors maj on maj.id = c.major_id
where r.status = 'published';

comment on view public.v_resources_public is
  '公开资源视图，供前端 mock 字段直接替换；仅暴露 published（映射为 approved）。';

grant select on public.v_resources_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. RLS
-- ---------------------------------------------------------------------------
alter table public.colleges  enable row level security;
alter table public.majors    enable row level security;
alter table public.courses   enable row level security;
alter table public.resources enable row level security;
alter table public.comments  enable row level security;
alter table public.reports   enable row level security;

-- 目录表：匿名只读
drop policy if exists colleges_public_read on public.colleges;
create policy colleges_public_read on public.colleges
  for select to anon, authenticated using (true);

drop policy if exists colleges_admin_write on public.colleges;
create policy colleges_admin_write on public.colleges
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists majors_public_read on public.majors;
create policy majors_public_read on public.majors
  for select to anon, authenticated using (true);

drop policy if exists majors_admin_write on public.majors;
create policy majors_admin_write on public.majors
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists courses_public_read on public.courses;
create policy courses_public_read on public.courses
  for select to anon, authenticated using (true);

drop policy if exists courses_admin_write on public.courses;
create policy courses_admin_write on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- resources：读已发布；匿名写入强制 pending
drop policy if exists resources_read_published on public.resources;
create policy resources_read_published on public.resources
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists resources_anon_insert_pending on public.resources;
create policy resources_anon_insert_pending on public.resources
  for insert to anon
  with check (
    status = 'pending'
    and uploader_id is null
    and downloads = 0
    and reviewed_at is null
    and reviewed_by is null
  );

drop policy if exists resources_user_insert_pending on public.resources;
create policy resources_user_insert_pending on public.resources
  for insert to authenticated
  with check (
    status = 'pending'
    and (uploader_id is null or uploader_id = auth.uid())
    and downloads = 0
    and reviewed_at is null
    and reviewed_by is null
  );

drop policy if exists resources_admin_read_all on public.resources;
create policy resources_admin_read_all on public.resources
  for select to authenticated using (public.is_admin());

drop policy if exists resources_admin_update on public.resources;
create policy resources_admin_update on public.resources
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists resources_admin_delete on public.resources;
create policy resources_admin_delete on public.resources
  for delete to authenticated using (public.is_admin());

-- comments：读已发布；写入强制 pending
drop policy if exists comments_read_published on public.comments;
create policy comments_read_published on public.comments
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists comments_anon_insert_pending on public.comments;
create policy comments_anon_insert_pending on public.comments
  for insert to anon
  with check (status = 'pending' and author_id is null);

drop policy if exists comments_user_insert_pending on public.comments;
create policy comments_user_insert_pending on public.comments
  for insert to authenticated
  with check (status = 'pending' and (author_id is null or author_id = auth.uid()));

drop policy if exists comments_admin_read_all on public.comments;
create policy comments_admin_read_all on public.comments
  for select to authenticated using (public.is_admin());

drop policy if exists comments_admin_update on public.comments;
create policy comments_admin_update on public.comments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists comments_admin_delete on public.comments;
create policy comments_admin_delete on public.comments
  for delete to authenticated using (public.is_admin());

-- reports：匿名只写不读
drop policy if exists reports_anon_insert on public.reports;
create policy reports_anon_insert on public.reports
  for insert to anon
  with check (status = 'pending' and reporter_id is null and resolved_at is null);

drop policy if exists reports_user_insert on public.reports;
create policy reports_user_insert on public.reports
  for insert to authenticated
  with check (status = 'pending' and (reporter_id is null or reporter_id = auth.uid()));

drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read on public.reports
  for select to authenticated using (public.is_admin());

drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 12. 表权限（RLS 之上再加一层列/操作级收口）
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.colleges, public.majors, public.courses to anon, authenticated;
grant select, insert on public.resources to anon, authenticated;
grant select, insert on public.comments to anon, authenticated;
grant insert on public.reports to anon, authenticated;
grant update on public.resources, public.comments, public.reports to authenticated;

revoke update, delete on public.resources from anon;
revoke update, delete on public.comments from anon;
revoke update, delete on public.reports from anon;
revoke select on public.reports from anon;
revoke all on public.colleges, public.majors, public.courses from anon;
grant select on public.colleges, public.majors, public.courses to anon;

-- service_role 绕过 RLS，但仍需要表级 GRANT，否则管理端查询报 42501。
-- 2026-11-20 补授：此前第 12 节只授权了 anon/authenticated，漏了 service_role。
grant usage on schema public to service_role;
grant select, insert, update, delete on public.colleges, public.majors, public.courses, public.resources, public.comments, public.reports to service_role;
grant select on public.v_resources_public to service_role;
grant execute on function public.increment_downloads(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 13. Storage：resources 桶（私有，PDF / 图片 / DOC，单文件 ≤ 50MB）
--     pending/  = 待审，仅管理员可读；published/ = 已发布，匿名可读（用签名 URL）
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resources',
  'resources',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 匿名/登录用户：只能往 pending/ 上传
drop policy if exists storage_resources_anon_upload_pending on storage.objects;
create policy storage_resources_anon_upload_pending on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'resources'
    and (storage.foldername(name))[1] = 'pending'
  );

-- 匿名/登录用户：只能读 published/
drop policy if exists storage_resources_public_read_published on storage.objects;
create policy storage_resources_public_read_published on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'resources'
    and (storage.foldername(name))[1] = 'published'
  );

-- 管理员：全桶可读写（JWT 预留）
drop policy if exists storage_resources_admin_all on storage.objects;
create policy storage_resources_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'resources' and public.is_admin())
  with check (bucket_id = 'resources' and public.is_admin());

-- 注意：禁止匿名 update/delete。审核移动对象（pending → published）由 service_role
-- 在 lib/supabase/storage.js#promotePendingFile 中完成（service_role 绕过 RLS）。

-- ---------------------------------------------------------------------------
-- 14. 种子数据（与 lib/mock.js 的课程 slug 对齐）
-- ---------------------------------------------------------------------------
insert into public.colleges (name, slug) values
  ('数学与计算科学学院', 'math-cs'),
  ('计算机科学与工程学院', 'cs'),
  ('外国语学院', 'foreign-languages')
on conflict (slug) do nothing;

insert into public.majors (college_id, name, slug)
select c.id, v.name, v.slug
from (values
  ('math-cs', '数学与应用数学', 'applied-math'),
  ('cs', '计算机科学与技术', 'cs-tech'),
  ('cs', '软件工程', 'software-engineering'),
  ('foreign-languages', '英语', 'english')
) as v (college_slug, name, slug)
join public.colleges c on c.slug = v.college_slug
on conflict (slug) do nothing;

insert into public.courses (college_id, major_id, name, slug)
select c.id, m.id, v.name, v.slug
from (values
  ('math-cs', 'applied-math', '高等数学', 'math'),
  ('math-cs', 'applied-math', '线性代数', 'linear'),
  ('cs', 'cs-tech', '数据结构', 'ds'),
  ('cs', 'software-engineering', '操作系统', 'os'),
  ('foreign-languages', 'english', '大学英语', 'english')
) as v (college_slug, major_slug, name, slug)
join public.colleges c on c.slug = v.college_slug
join public.majors m on m.slug = v.major_slug
on conflict (slug) do nothing;
