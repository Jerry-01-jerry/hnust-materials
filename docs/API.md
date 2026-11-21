# 湖科资料库 · Supabase 后端 API 文档

> 版本：v1（2026-11）
> 技术栈确认：Next.js **14.2.35**（App Router）、React **18.3.1**、Tailwind **3.4.19**、Node ≥ 18。未重建项目，只在 `lib/` 下新增后端数据层。
> 交付物：`supabase/schema.sql`（建表 + RLS + Storage + RPC + 种子）、`lib/supabase/**`（数据访问层）、本文档。

---

## 1. 设计原则

| 原则 | 落地方式 |
| --- | --- |
| 不做登录 | 全站匿名访问，Supabase 用 anon key + RLS。`uploader_id / author_id / reporter_id` 恒为 `null`。 |
| auth 只预留 | 三张业务表的外键指向 `auth.users(id)`；`public.is_admin()` 读 JWT `app_metadata.role`；`lib/supabase/auth.js` 是唯一需要改的登录接入点。 |
| 先审后发 | 任何匿名写入（资源 / 评论 / 举报）在数据库层被强制 `status='pending'`，靠 `WITH CHECK` 实现，前端绕不过。 |
| 读已发布 | anon 的 SELECT 策略只放行 `status='published'`，视图 `v_resources_public` 进一步只暴露已发布行。 |
| 文件隔离 | 私有桶 `resources`，`pending/` 仅管理员可读，`published/` 匿名可读（签名 URL）。 |
| 最小权限 | 匿名无法 UPDATE/DELETE 任何表；下载计数走 `increment_downloads` 的 SECURITY DEFINER 函数。 |
| 不动前台 | 未新增/修改 `app/`、`components/` 任何文件；现有 mock 与 localStorage 流程保持可运行。 |

---

## 2. 文件清单

```
supabase/
└── schema.sql                 # 全量 schema（幂等，可在 SQL Editor 重复执行）
lib/supabase/
├── index.js                   # 统一出口（浏览器/服务端通用模块）
├── config.js                  # 环境变量、枚举、50MB/MIME 白名单、分页上限
├── errors.js                  # BackendError / ERROR_CODES / 错误归一化
├── validation.js              # 纯函数校验 + 文本清洗
├── client.js                  # 浏览器 anon 客户端（单例）
├── server.js                  # 服务端 anon / service_role 客户端（禁止进客户端 bundle）
├── auth.js                    # 登录预留 + 后台 Cookie 校验（镜像 app/admin/access.js）
├── storage.js                 # 上传、直传票据、pending→published 迁移、签名 URL
├── catalog.js                 # colleges / majors / courses
├── resources.js               # 资源读写 + 审核
├── comments.js                # 评论读写 + 审核
└── reports.js                 # 举报提交 + 处理
```

数据库对象总览：6 张表（`colleges`、`majors`、`courses`、`resources`、`comments`、`reports`）+ 1 个公开视图 + 3 个 RPC + 1 个 Storage 桶。

---

## 3. 环境变量

`.env.local`（已写入 `.env.example`）：

```sh
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY   # 仅服务端，禁止 NEXT_PUBLIC_ 前缀
ADMIN_PASSWORD=...                                # 沿用现有后台密码
ADMIN_SECURE_COOKIE=true                          # 生产 HTTPS 时设置
```

- `service_role` key 泄露 = 数据库全权限泄露，只能在 Route Handler / Server Action / 脚本里读。
- `lib/supabase/server.js` 在浏览器环境会直接 `throw`，`lib/supabase/auth.js` 同理。
- `isSupabaseConfigured()` 可用于决定是否从 mock 切到真实数据，不用改现有页面逻辑。

---

## 4. 数据模型

### 4.1 枚举

| 类型 | 取值 |
| --- | --- |
| `resource_status` | `pending` / `published` / `rejected` |
| `resource_type` | `复习资料` / `课程笔记` / `练习题` / `课件` / `其他` |
| `semester_type` | `上学期` / `下学期` |
| `report_reason` | `侵权` / `内容错误` / `无法下载` / `广告或违法` / `其他` |
| `report_status` | `pending` / `resolved` / `dismissed` |

> 前端 mock 里的 `approved` 只存在于视图层：`v_resources_public` 把 `published` 映射为 `approved`，`normalizeResource()` 做同样的事。数据库内不存 `approved`。

### 4.2 colleges（学院）

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK, default gen_random_uuid() | |
| `name` | text | NOT NULL, 2–60 字, UNIQUE | 学院全名 |
| `slug` | text | NOT NULL, UNIQUE, `^[a-z0-9][a-z0-9-]{0,63}$` | URL 标识 |
| `created_at` | timestamptz | NOT NULL default now() | |

### 4.3 majors（专业）

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | uuid | PK |
| `college_id` | uuid | NOT NULL → `colleges(id)` ON DELETE CASCADE |
| `name` | text | NOT NULL, 2–60 字, `UNIQUE(college_id, name)` |
| `slug` | text | NOT NULL, UNIQUE |
| `created_at` | timestamptz | NOT NULL default now() |

### 4.4 courses（课程）

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | uuid | PK |
| `college_id` | uuid | NOT NULL → `colleges(id)` ON DELETE CASCADE |
| `major_id` | uuid | NULL → `majors(id)` ON DELETE SET NULL |
| `code` | text | NULL（课程代码，可留空） |
| `name` | text | NOT NULL, 1–80 字, `UNIQUE(college_id, name)` |
| `slug` | text | NOT NULL, UNIQUE（`math` / `ds` … 与前端 mock 的课程 id 对齐） |
| `credits` | numeric(3,1) | NULL, 0–30 |
| `created_at` / `updated_at` | timestamptz | `updated_at` 由触发器维护 |

### 4.5 resources（资源）

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 服务端 `crypto.randomUUID()` 生成后显式写入 |
| `title` | text | NOT NULL, 2–120 字 | |
| `course_id` | uuid | NOT NULL → `courses(id)` ON DELETE RESTRICT | 课程被引用时不可删 |
| `year` | smallint | NOT NULL, 2000–2100 | 学年 |
| `semester` | semester_type | NOT NULL | |
| `type` | resource_type | NOT NULL | |
| `teacher` | text | NULL, ≤60 字 | |
| `file_url` | text | NOT NULL, 1–1024 字 | Storage 对象路径或外链 |
| `file_name` | text | NULL, ≤200 字 | 原始文件名（展示用） |
| `file_size` | bigint | NULL, 0 < size ≤ 52428800 | 50MB 硬上限 |
| `mime_type` | text | NULL，白名单 7 种 | 见 §6 |
| `uploader_id` | uuid | NULL → `auth.users(id)` ON DELETE SET NULL | **预留**，当前恒 null |
| `uploader_name` | text | NOT NULL default `'匿名'`, 1–24 字 | 前端旧字段 `uploader` |
| `downloads` | integer | NOT NULL default 0, ≥0 | 只经 RPC 递增 |
| `status` | resource_status | NOT NULL default `'pending'` | 审核状态 |
| `reject_reason` | text | NULL, ≤200 字 | 驳回理由 |
| `reviewed_at` | timestamptz | NULL | 审核时间 |
| `reviewed_by` | uuid | NULL → `auth.users(id)` | **预留** |
| `created_at` / `updated_at` | timestamptz | 触发器维护 | |

索引：`(status, created_at desc)`、`(course_id, year desc, semester)`、`(downloads desc) WHERE status='published'`、`title gin_trgm_ops`（模糊搜索）。

### 4.6 comments（评论）

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | uuid | PK |
| `resource_id` | uuid | NOT NULL → `resources(id)` ON DELETE CASCADE |
| `content` | text | NOT NULL, 1–1000 字 |
| `author_id` | uuid | NULL → `auth.users(id)`（预留） |
| `author_name` | text | NOT NULL default `'匿名'`, 1–24 字 |
| `status` | resource_status | NOT NULL default `'pending'` |
| `created_at` / `updated_at` | timestamptz | |

### 4.7 reports（举报）

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | uuid | PK |
| `resource_id` | uuid | NOT NULL → `resources(id)` ON DELETE CASCADE |
| `reason` | report_reason | NOT NULL |
| `detail` | text | NULL, ≤500 字 |
| `contact` | text | NULL, ≤100 字 |
| `reporter_id` | uuid | NULL → `auth.users(id)`（预留） |
| `status` | report_status | NOT NULL default `'pending'` |
| `resolution_note` | text | NULL, ≤500 字 |
| `resolved_at` | timestamptz | NULL |
| `created_at` | timestamptz | |

### 4.8 视图 `v_resources_public`

`security_invoker = true`（RLS 随调用者生效），字段与前端 mock 完全一致：

```
id, title, course_id(←courses.slug), year, semester, type, teacher,
file_url, uploader(←uploader_name), uploader_id, downloads,
status(published→approved), college_id(←colleges.slug), major_id(←majors.slug),
file_name, file_size, mime_type, created_at
```

只包含 `status='published'` 的行，页面替换 mock 时字段无需改动。

### 4.9 RPC

| 函数 | 权限 | 行为 |
| --- | --- | --- |
| `increment_downloads(p_resource_id uuid) → integer` | `anon`, `authenticated` | 仅对 `published` 行 `downloads+1`；否则抛 `RESOURCE_NOT_PUBLISHED`（SQLSTATE `P0002`）。SECURITY DEFINER，匿名无法直接 UPDATE。 |
| `approve_resource(p_resource_id uuid) → resources` | `authenticated`, `service_role` | 校验 `is_admin()`，置 `published` 并清空驳回理由。 |
| `reject_resource(p_resource_id uuid, p_reason text) → resources` | `authenticated`, `service_role` | 校验 `is_admin()`，置 `rejected`。 |

---

## 5. 权限矩阵（RLS）

图例：✅ 允许 / ⛔ 拒绝（无策略即拒绝）/ 🔒 仅 `is_admin()`

| 表 | anon SELECT | anon INSERT | anon UPDATE/DELETE | authenticated |
| --- | --- | --- | --- | --- |
| `colleges` / `majors` / `courses` | ✅ 全部 | ⛔ | ⛔ | 🔒 写 |
| `resources` | ✅ 仅 `published` | ✅ 仅 `pending`，且 `uploader_id is null`、`downloads=0` | ⛔ | 读全部 🔒、写 🔒 |
| `comments` | ✅ 仅 `published` | ✅ 仅 `pending`，`author_id is null` | ⛔ | 同上 |
| `reports` | ⛔ 匿名完全不可读 | ✅ 仅 `pending`、`reporter_id is null` | ⛔ | 读/写 🔒 |

补充：

- `grant` 层再收口：`anon` 对 `reports` 无 `SELECT`；对三张业务表无 `UPDATE/DELETE`。
- 管理员两种身份：① 服务端 `service_role`（`lib/supabase/server.js#getServiceClient`）；② 将来 JWT `app_metadata.role='admin'`。
- 现有后台仍用 `ADMIN_PASSWORD` + HttpOnly Cookie（`app/admin/access.js`），`lib/supabase/auth.js#verifyAdminCookie` 可原地校验同一个 Cookie，不需要改前台。

---

## 6. Storage 规则

| 项 | 值 |
| --- | --- |
| 桶名 | `resources` |
| 可见性 | 私有（`public = false`） |
| 单文件上限 | 50 MB（`52428800`，桶级 + 表级 CHECK 双层限制） |
| 允许 MIME | `application/pdf`、`image/jpeg`、`image/png`、`image/webp`、`image/gif`、`application/msword`、`application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| 允许扩展名 | `.pdf .jpg .jpeg .png .webp .gif .doc .docx` |

对象路径：

```
pending/<uuid>/<原始文件名>     ← 匿名上传落点，仅管理员可读
published/<uuid>/<原始文件名>   ← 审核通过后 service_role 复制并删除源对象
```

策略：

- `INSERT`（anon/authenticated）：`bucket_id='resources' AND (storage.foldername(name))[1]='pending'` —— 只能往待审目录写。
- `SELECT`（anon/authenticated）：`... = 'published'` —— 只读已发布文件。
- `ALL`（authenticated）：`is_admin()` —— JWT 管理员全桶可写。
- 匿名无 `UPDATE/DELETE`；`promotePendingFile()` 用 service_role 完成搬迁，绕过 RLS。

访问方式：私有桶不提供公开 URL，读文件一律 `signResourceUrl()` 拿签名地址（默认 1 小时，可传 `expiresIn`）。站内 `/public` 文件与外链（`http(s)://`）原样返回，保持与现有 mock 的 `file_url` 兼容。

---

## 7. lib API 参考

> 所有方法：成功返回数据对象；失败抛 `BackendError`（`{ code, message, field }`，见 §9）。
> 默认客户端：读/匿名写用 `getAnonClient()`；管理操作必须传 `client`（service 客户端）。

### 7.1 config.js

```js
RESOURCE_BUCKET      // 'resources'
PENDING_PREFIX       // 'pending'
PUBLISHED_PREFIX     // 'published'
MAX_FILE_BYTES       // 52428800
MAX_PAGE_SIZE        // 50
DEFAULT_PAGE_SIZE    // 12
RESOURCE_TYPES       // ['复习资料','课程笔记','练习题','课件','其他']
SEMESTERS            // ['上学期','下学期']
RESOURCE_STATUS      // { PENDING:'pending', PUBLISHED:'published', REJECTED:'rejected' }
REPORT_REASONS       // ['侵权','内容错误','无法下载','广告或违法','其他']
REPORT_STATUS        // { PENDING:'pending', RESOLVED:'resolved', DISMISSED:'dismissed' }
YEAR_MIN             // 2000
CURRENT_YEAR_MAX     // 当前年份 + 1
ALLOWED_MIME_TYPES   // MIME → [扩展名]
EXTENSION_MIME       // 扩展名 → MIME（File.type 为空时兜底）
ACCEPT_ATTRIBUTE     // 直接给 <input accept>
readPublicSupabaseEnv() // → { url, anonKey }，缺失则抛错
isSupabaseConfigured()  // → boolean
```

### 7.2 客户端

```js
// lib/supabase/client.js —— 浏览器
createBrowserSupabaseClient({ url?, anonKey?, accessToken? }) → SupabaseClient
getBrowserSupabaseClient() → SupabaseClient   // 单例

// lib/supabase/server.js —— 仅服务端
createAnonClient({ anonKey? }) → SupabaseClient      // 仍受 RLS
getAnonClient() → SupabaseClient
createServiceClient() → SupabaseClient               // service_role，绕 RLS
getServiceClient() → SupabaseClient
resolveClient('anon' | 'service') → SupabaseClient
```

### 7.3 目录（catalog.js）

| 方法 | 签名 | 权限 | 说明 |
| --- | --- | --- | --- |
| `listColleges` | `({ client? })` | anon | 全部学院，按名称排序 |
| `listMajors` | `({ collegeSlug?, collegeId?, client? })` | anon | 含所属学院对象 |
| `listCourses` | `({ collegeSlug?, majorSlug?, query?, page?, pageSize?, client? })` | anon | 关键词匹配 `name`/`slug`，分页 |
| `getCourse` | `({ id?, slug?, client? })` | anon | 单门课程，含 college/major |
| `createCollege` | `(input, { client })` | service | `{ name, slug }` |
| `createMajor` | `(input, { client })` | service | `{ name, slug, collegeId }` |
| `createCourse` | `(input, { client })` | service | `{ name, slug, collegeId, majorId?, code?, credits? }` |
| `updateCourse` | `(id, patch, { client })` | service | `name/code/credits/majorId` |
| `deleteCourse` | `(id, { client })` | service | 有资源引用时抛 `CONFLICT`（409） |

```js
// 首页目录
const { data: courses, total } = await listCourses({ query: '高等数学', pageSize: 10 }, {});
```

### 7.4 资源（resources.js）

#### `listResources(filters?, options?) → { data, total, page, pageSize }`

```js
const { data, total } = await listResources(
  { query: '高数', collegeSlug: 'cs', year: 2025, semester: '上学期', type: '复习资料', sort: 'downloads' },
  { page: 1, pageSize: 12, signUrls: true, expiresIn: 3600, client? }
);
// data[]: 视图字段 + download_url（signUrls=true 时）
```

- `filters.sort`：`latest`（默认，`created_at desc`）/ `downloads` / `year`。
- `filters.courseId` 传 uuid 时会先解析 slug；也可直接传 `courseSlug`。
- 只返回 `published`（视图 + RLS 双重保证）。
- `pageSize` 上限 50，防止匿名拉全表。

#### `getResource(resourceId, { client?, expiresIn? }) → row & { download_url }`

不存在或未发布 → `NOT_FOUND`（404，不泄露是否待审）。

#### `incrementDownloads(resourceId, { client? }) → number`

调 RPC；资源未发布 → `RESOURCE_NOT_PUBLISHED`。建议在**签名 URL 下发成功之后**调用，避免刷计数。

#### `createResourceSubmission(input, { client?, file? }) → { id, status, title, course, fileUrl, message }`

```js
const result = await createResourceSubmission(
  {
    title: '高等数学期末复习提纲',
    courseSlug: 'math',            // 或 courseId: '<uuid>'
    year: 2025,
    semester: '上学期',
    type: '复习资料',
    teacher: '',                   // 可空
    uploaderName: '匿名',          // 可空，默认 '匿名'
  },
  { file }                          // 浏览器 File；服务端可传 { name, type, size, buffer }
);
// → { id, status: 'pending', message: '提交成功，待审核。' }
```

流程：校验 → 解析课程 → 文件落 `pending/` → 插入 `status='pending'`（`uploader_id: null`）→ 任一步失败回滚已上传对象。
行内容不会回读（匿名 SELECT 只放行 `published`），因此返回本地组装的结果对象。

#### 管理端

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `listModerationQueue` | `({ status='pending', page?, pageSize?, client })` | 全部状态可见，含 `course.college`、`preview_url`（10 分钟签名） |
| `getResourceForAdmin` | `(id, { client })` | 任意状态 + 驳回理由 + 预览地址 |
| `approveResource` | `(id, { client })` | `pending/`→`published/` 迁移后置 `published`；幂等 |
| `rejectResource` | `(id, reason, { client })` | 置 `rejected` + 理由（≤200 字），文件保留待复核 |
| `deleteResource` | `(id, { client })` | 删行 + 删对象 |
| `countResourcesByStatus` | `({ client })` | `{ pending, published, rejected }` |

```js
// 后台审核（Route Handler 里）
import { getServiceClient } from '@/lib/supabase/server';
import { verifyAdminCookie, ADMIN_COOKIE_NAME } from '@/lib/supabase/auth';
import { approveResource } from '@/lib/supabase/resources';

if (!verifyAdminCookie(cookies().get(ADMIN_COOKIE_NAME)?.value)) return new Response('403', { status: 403 });
await approveResource(id, { client: getServiceClient() });
```

### 7.5 评论（comments.js）

| 方法 | 签名 | 权限 |
| --- | --- | --- |
| `listComments` | `(resourceId, { page?, pageSize=20, client? })` | anon，仅 `published` |
| `createComment` | `({ resourceId, content, authorName? }, { client? })` | anon，写 `pending` |
| `listCommentsForModeration` | `({ status='pending', page?, pageSize?, client })` | service |
| `approveComment` / `rejectComment` | `(commentId, { client })` | service |
| `deleteComment` | `(commentId, { client })` | service |
| `countPendingComments` | `({ client })` | service |

`content` 1–1000 字，UTF-8 ≤ 4000 字节；`authorName` ≤ 24 字。

### 7.6 举报（reports.js）

| 方法 | 签名 | 权限 |
| --- | --- | --- |
| `createReport` | `({ resourceId, reason, detail?, contact? }, { client? })` | anon，写 `pending` |
| `listReports` | `({ status='pending', page?, pageSize?, client })` | service |
| `closeReport` | `(reportId, { status: 'resolved'|'dismissed', note? }, { client })` | service |
| `countPendingReports` | `({ client })` | service |
| `listReportsForResource` | `(resourceId, { client })` | service |

资源不存在 → `NOT_FOUND`；匿名**读不到**任何举报记录（防探测、防串号）。

### 7.7 Storage（storage.js）

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `validateFileDescriptor` | `(file) → { ok, errors, value:{name,mime,size,ext} }` | MIME + 扩展名 + 50MB 三重校验 |
| `sanitizeFileName` | `(name) → string` | 去路径、控制字符、危险符号，截断 120 字符 |
| `buildPendingPath` | `(fileName) → 'pending/<uuid>/<name>'` | |
| `uploadPendingFile` | `(client, file, { path? }) → { path, name, size, mime }` | 服务端中转上传 |
| `createUploadTicket` | `(serviceClient, { fileName, mimeType, size }) → { path, token, signedUrl, mime, maxBytes }` | 浏览器直传（绕过 Next 进程，适合 50MB） |
| `promotePendingFile` | `(serviceClient, path) → publishedPath` | `copy` + `remove`，幂等 |
| `signResourceUrl` | `(client, path, expiresIn=3600) → url` | 外链/`/public` 原样返回 |
| `signResourceUrls` | `(client, paths, expiresIn) → Map<path,url>` | 列表批量签名 |
| `resolveFileUrl` | `(client, fileUrl, expiresIn?)` | 同上单条 |
| `removeFile` | `(serviceClient, path)` | 失败只告警，不阻断 |

前端直传示例（推荐大文件）：

```js
const ticket = await fetch('/api/upload-ticket', { method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size }) }).then(r => r.json());
await fetch(ticket.signedUrl, { method: 'PUT', headers: { 'Content-Type': ticket.mime }, body: file });
// 再把 ticket.path 作为 fileUrl 提交资源
```

### 7.8 校验（validation.js）

`isUuid` / `isSlug` / `sanitizeText(value, { multiline })` / `validateResourceInput` / `validateCommentInput` / `validateReportInput` / `validatePagination({ page, pageSize })` / `validateResourceFilters` / `validateCatalogInput(kind, input)` / `validateModerationNote(note, { max })`。

统一返回 `{ ok, value, errors: [{ field, message }] }`，纯函数、无副作用，可在客户端做即时校验。

---

## 8. 状态流转

```
                    ┌──────── rejectResource(reason) ────────┐
                    ▼                                        │
提交 ──► pending ──► approveResource ──► published ──► deleteResource
 (anon)             （迁移文件到 published/）   │
                    └── rejected（文件留在 pending/，可复核后重审）
```

- 评论：`pending → published | rejected`，`deleteComment` 物理删除。
- 举报：`pending → resolved | dismissed`，附 `resolution_note` 与 `resolved_at`。
- 资源被删除时，评论与举报因 `ON DELETE CASCADE` 一并清理。

---

## 9. 错误码

| code | HTTP | 触发场景 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | 字段不合法（含 `field` 定位） |
| `NOT_FOUND` | 404 | 资源/课程/评论不存在，或资源未发布 |
| `RESOURCE_NOT_PUBLISHED` | 404 | 对未发布资源调 `increment_downloads` |
| `FORBIDDEN` | 403 | RLS 拒绝、缺 service key、非管理员 |
| `CONFLICT` | 409 | 唯一键冲突、课程下仍有资料 |
| `FILE_TOO_LARGE` | 413 | 文件 > 50MB |
| `FILE_TYPE_NOT_ALLOWED` | 415 | MIME / 扩展名不在白名单 |
| `RATE_LIMITED` | 429 | 预留（限流层可复用该码） |
| `STORAGE_ERROR` | 500 | Storage 操作失败 |
| `DATABASE_ERROR` | 500 | 其他数据库错误 |
| `CONFIG_ERROR` | 500 | 环境变量缺失 |

数据库原始错误由 `normalizeSupabaseError()` 归一化：`P0002`→未发布、`42501`→无权限、`23505`→冲突、`23503`→关联不存在、`23514/22P02`→字段非法。

---

## 10. 前端接入（不改现有结构）

现有页面读 `lib/mock.js` / `lib/store.js`（localStorage）。接入真实数据时，只需在页面的数据入口替换为 lib 调用（**本次未改动 `app/`、`components/`**）：

```js
// 列表：字段与 mock 完全一致（status: 'approved'）
import { listResources } from '@/lib/supabase/resources';
const { data } = await listResources({ query, collegeSlug }, { signUrls: true });

// 详情：签名下载地址
import { getResource, incrementDownloads } from '@/lib/supabase/resources';
const resource = await getResource(id);
await incrementDownloads(id);

// 上传：file 为 <input type="file"> 的 File
import { createResourceSubmission } from '@/lib/supabase/resources';
await createResourceSubmission({ title, courseSlug, year, semester, type, teacher, uploaderName }, { file });

// 评论 / 举报
import { createComment } from '@/lib/supabase/comments';
import { createReport } from '@/lib/supabase/reports';
await createComment({ resourceId, content, authorName });
await createReport({ resourceId, reason: '无法下载', detail });
```

字段映射（视图已处理，此处备查）：

| mock 字段 | 数据库 / 视图 |
| --- | --- |
| `id` | `resources.id` |
| `course_id`（`'math'`） | `courses.slug` |
| `uploader` | `uploader_name` |
| `status: 'approved'` | `status: 'published'` |
| `file_url` | Storage 对象路径 / 外链 / `/public` 路径 |

若之后要加 REST 层，建议的 Route Handler 与 lib 方法一一对应（**本次未创建 `app/api`，按你的要求不动 `app/`**）：

| 方法 | 路径 | 调用 |
| --- | --- | --- |
| GET | `/api/colleges` | `listColleges()` |
| GET | `/api/courses?q=&college=&major=&page=` | `listCourses()` |
| GET | `/api/resources?q=&course=&year=&semester=&type=&sort=&page=` | `listResources()` |
| GET | `/api/resources/:id` | `getResource()` |
| POST | `/api/resources/:id/download` | `signResourceUrl()` + `incrementDownloads()` |
| POST | `/api/resources` | `createResourceSubmission()` |
| POST | `/api/upload-ticket` | `createUploadTicket()` |
| GET/POST | `/api/resources/:id/comments` | `listComments()` / `createComment()` |
| POST | `/api/reports` | `createReport()` |
| GET/POST | `/api/admin/queue` | `listModerationQueue()` / `approveResource()` / `rejectResource()` |
| POST | `/api/admin/comments` | `listCommentsForModeration()` / `approveComment()` / `rejectComment()` |
| POST | `/api/admin/reports` | `listReports()` / `closeReport()` |

管理端 Route Handler 统一前置：

```js
const ok = verifyAdminCookie(cookies().get(ADMIN_COOKIE_NAME)?.value);
if (!ok) return NextResponse.json({ error: { code: 'FORBIDDEN', message: '未登录后台' } }, { status: 403 });
```

---

## 11. 部署顺序

1. Supabase 新建项目（Region 选 Singapore 或 Tokyo，延迟最低）。
2. SQL Editor 执行 `supabase/schema.sql`（幂等，可重复执行；含种子学院/专业/课程）。
3. Storage 确认桶 `resources` 已存在且为 private，`file_size_limit=52428800`，`allowed_mime_types` 7 项。
4. 填 `.env.local`（URL / anon / service_role / ADMIN_PASSWORD）。
5. `npm run dev` 验证现有页面仍走 mock；再按 §10 逐页替换数据源。
6. 生产：`npm run build && npm start`，`ADMIN_SECURE_COOKIE=true`。

自检 SQL：

```sql
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resources';
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by tablename;
select slug, name from courses order by slug;
-- 匿名视角（SQL Editor 以 postgres 执行，用 set role 模拟需要对应角色）
```

---

## 12. 将来接入登录只需改三处

1. `lib/supabase/auth.js#getAuthUser` → `client.auth.getUser()`；`requireAdmin` 改用 `isAdminUser`。
2. 写入时把 `uploader_id / author_id / reporter_id` 从 `null` 改为 `auth.uid()` —— 数据库策略已允许（`authenticated` 策略校验 `= auth.uid()`）。
3. 后台共享密码切换为 JWT：给管理员账号写 `app_metadata.role='admin'`，`public.is_admin()` 与 `storage.objects` 管理员策略立即生效，SQL 无需改动。

表结构、RLS、Storage 均无需迁移。
