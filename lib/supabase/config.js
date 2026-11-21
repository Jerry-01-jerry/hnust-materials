/**
 * 湖科资料库 · Supabase 配置与枚举
 *
 * 该文件被前端与服务端共用，只能放常量与纯函数，禁止放密钥读取以外的副作用。
 * 服务端密钥只允许在 lib/supabase/server.js 中读取。
 */

/** Storage 桶名（与 supabase/schema.sql 第 13 节一致，私有桶）。 */
export const RESOURCE_BUCKET = 'resources';

/** 待审文件前缀：只有管理员可读，匿名上传只能落在这里。 */
export const PENDING_PREFIX = 'pending';

/** 已发布文件前缀：匿名可读（通过签名 URL）。 */
export const PUBLISHED_PREFIX = 'published';

/** 单文件上限 50MB。Storage 桶已在数据库侧再次限制。 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** 分页上限，防止匿名拉全表。 */
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 12;

/** 资源类型（与 public.resource_type 枚举一致）。 */
export const RESOURCE_TYPES = ['复习资料', '课程笔记', '练习题', '课件', '其他'];

/** 学期（与 public.semester_type 枚举一致）。 */
export const SEMESTERS = ['上学期', '下学期'];

/** 资源状态（与 public.resource_status 枚举一致）。 */
export const RESOURCE_STATUS = {
  PENDING: 'pending',
  PUBLISHED: 'published',
  REJECTED: 'rejected',
};

/** 前端 mock 仍使用 approved，视图层做映射：published ↔ approved。 */
export const LEGACY_STATUS_MAP = { published: 'approved', pending: 'pending', rejected: 'rejected' };

/** 举报原因（与 public.report_reason 枚举一致）。 */
export const REPORT_REASONS = ['侵权', '内容错误', '无法下载', '广告或违法', '其他'];

/** 举报处理状态（与 public.report_status 枚举一致）。 */
export const REPORT_STATUS = { PENDING: 'pending', RESOLVED: 'resolved', DISMISSED: 'dismissed' };

/** 年份合法区间：放宽到明年，避免跨年归档失败。 */
export const YEAR_MIN = 2000;
export const CURRENT_YEAR_MAX = new Date().getFullYear() + 1;

/**
 * 允许上传的 MIME → 扩展名。仅 PDF / 图片 / DOC(DOCX)。
 * 前端拿到的 File.type 可能为空（少数系统），因此同时按扩展名兜底。
 */
export const ALLOWED_MIME_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

/** 扩展名 → 规范 MIME，用于 File.type 缺失时补全。 */
export const EXTENSION_MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** 文件选择器用。 */
export const ACCEPT_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx';

/**
 * 读取 Supabase 公共配置（URL + anon key）。两者都可以暴露到浏览器。
 * @returns {{ url: string, anonKey: string }}
 */
export function readPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      '缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY，请复制 .env.example 为 .env.local 后填写。',
    );
  }
  return { url, anonKey };
}

/** 是否已接入 Supabase（供页面在 mock 与真实数据之间切换，不改变现有行为）。 */
export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
