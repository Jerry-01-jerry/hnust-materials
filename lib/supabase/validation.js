/**
 * 入参校验（纯函数，无依赖，可在服务端与客户端复用）。
 * 约定：validateXxx(input) 返回 { ok, value, errors }，errors = [{ field, message }]。
 * 数据库侧还有 CHECK 约束兜底，这里负责给出可读的中文提示。
 */

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  REPORT_REASONS,
  RESOURCE_TYPES,
  SEMESTERS,
  YEAR_MIN,
} from './config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isSlug(value) {
  return typeof value === 'string' && SLUG_RE.test(value);
}

/** 去首尾空白、压缩连续空白、剔除控制字符。 */
export function sanitizeText(value, { multiline = false } = {}) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const pattern = multiline ? /[^\P{C}\n\t]/gu : /[^\P{C}]/gu;
  const stripped = text.replace(pattern, '');
  return (multiline ? stripped.replace(/[ \t]{2,}/g, ' ') : stripped.replace(/\s+/g, ' ')).trim();
}

function toInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return Number.NaN;
}

function utf8Length(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

/**
 * 上传资源入参。
 * @param {{
 *   title?: string, courseId?: string, courseSlug?: string, year?: number|string,
 *   semester?: string, type?: string, teacher?: string, uploaderName?: string,
 *   fileUrl?: string, rejectReason?: string
 * }} input
 */
export function validateResourceInput(input = {}) {
  const errors = [];
  const maxYear = new Date().getFullYear() + 1;

  const title = sanitizeText(input.title);
  if (title.length < 2) errors.push({ field: 'title', message: '标题至少 2 个字。' });
  else if (title.length > 120) errors.push({ field: 'title', message: '标题最多 120 个字。' });

  const courseId = input.courseId ?? input.course_id ?? null;
  const courseSlug = input.courseSlug ?? input.course_slug ?? null;
  if (!courseId && !courseSlug) errors.push({ field: 'courseId', message: '请选择课程。' });
  if (courseId && !isUuid(courseId)) errors.push({ field: 'courseId', message: '课程 id 格式不正确。' });
  if (!courseId && courseSlug && !isSlug(courseSlug)) {
    errors.push({ field: 'courseSlug', message: '课程标识格式不正确。' });
  }

  const year = toInt(input.year);
  if (!Number.isInteger(year)) errors.push({ field: 'year', message: '请选择年份。' });
  else if (year < YEAR_MIN || year > maxYear) {
    errors.push({ field: 'year', message: `年份需在 ${YEAR_MIN} 与 ${maxYear} 之间。` });
  }

  const semester = sanitizeText(input.semester);
  if (!SEMESTERS.includes(semester)) {
    errors.push({ field: 'semester', message: `学期只能是：${SEMESTERS.join('、')}。` });
  }

  const type = sanitizeText(input.type);
  if (!RESOURCE_TYPES.includes(type)) {
    errors.push({ field: 'type', message: `类型只能是：${RESOURCE_TYPES.join('、')}。` });
  }

  const teacher = sanitizeText(input.teacher);
  if (teacher.length > 60) errors.push({ field: 'teacher', message: '教师姓名最多 60 个字。' });

  const uploaderName = sanitizeText(input.uploaderName ?? input.uploader_name ?? '匿名') || '匿名';
  if (uploaderName.length > 24) errors.push({ field: 'uploaderName', message: '昵称最多 24 个字。' });

  const fileUrl = input.fileUrl ?? input.file_url ?? null;
  if (fileUrl && String(fileUrl).length > 1024) {
    errors.push({ field: 'fileUrl', message: '文件地址过长。' });
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      title,
      courseId: courseId || null,
      courseSlug: courseSlug || null,
      year,
      semester,
      type,
      teacher: teacher || null,
      uploaderName,
      fileUrl: fileUrl ? String(fileUrl) : null,
    },
  };
}

/** 评论：1–1000 字，昵称可空。 */
export function validateCommentInput(input = {}) {
  const errors = [];
  const content = sanitizeText(input.content, { multiline: true });
  const resourceId = input.resourceId ?? input.resource_id ?? null;
  const authorName = sanitizeText(input.authorName ?? input.author_name ?? '匿名') || '匿名';

  if (!isUuid(resourceId)) errors.push({ field: 'resourceId', message: '资源 id 格式不正确。' });
  if (content.length < 1) errors.push({ field: 'content', message: '评论内容不能为空。' });
  else if (content.length > 1000) errors.push({ field: 'content', message: '评论最多 1000 字。' });
  if (utf8Length(content) > 4000) errors.push({ field: 'content', message: '评论内容过长。' });
  if (authorName.length > 24) errors.push({ field: 'authorName', message: '昵称最多 24 个字。' });

  return { ok: errors.length === 0, errors, value: { resourceId, content, authorName } };
}

/** 举报：原因必须命中枚举，detail ≤ 500，contact ≤ 100。 */
export function validateReportInput(input = {}) {
  const errors = [];
  const resourceId = input.resourceId ?? input.resource_id ?? null;
  const reason = sanitizeText(input.reason);
  const detail = sanitizeText(input.detail, { multiline: true });
  const contact = sanitizeText(input.contact);

  if (!isUuid(resourceId)) errors.push({ field: 'resourceId', message: '资源 id 格式不正确。' });
  if (!REPORT_REASONS.includes(reason)) {
    errors.push({ field: 'reason', message: `举报原因只能是：${REPORT_REASONS.join('、')}。` });
  }
  if (detail.length > 500) errors.push({ field: 'detail', message: '补充说明最多 500 字。' });
  if (contact.length > 100) errors.push({ field: 'contact', message: '联系方式最多 100 字。' });

  return { ok: errors.length === 0, errors, value: { resourceId, reason, detail: detail || null, contact: contact || null } };
}

/** 分页：page ≥ 1，pageSize 1–50，默认 12。 */
export function validatePagination({ page, pageSize, limit } = {}) {
  const pageValue = Math.max(1, toInt(page) || 1);
  const rawSize = toInt(pageSize ?? limit) || DEFAULT_PAGE_SIZE;
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page: pageValue, pageSize: size, from: (pageValue - 1) * size, to: pageValue * size - 1 };
}

/** 课程检索条件（列表筛选）。 */
export function validateResourceFilters(filters = {}) {
  const errors = [];
  const value = {
    query: sanitizeText(filters.query ?? filters.q),
    courseId: filters.courseId ?? filters.course_id ?? null,
    courseSlug: filters.courseSlug ?? filters.course_slug ?? null,
    collegeSlug: filters.collegeSlug ?? filters.college_slug ?? '',
    majorSlug: filters.majorSlug ?? filters.major_slug ?? '',
    year: filters.year ? toInt(filters.year) : null,
    semester: filters.semester ? sanitizeText(filters.semester) : null,
    type: filters.type ? sanitizeText(filters.type) : null,
    sort: sanitizeText(filters.sort) || 'latest',
  };

  if (value.query && value.query.length > 60) errors.push({ field: 'query', message: '搜索词最多 60 个字。' });
  if (value.semester && !SEMESTERS.includes(value.semester)) {
    errors.push({ field: 'semester', message: '学期取值不合法。' });
  }
  if (value.type && !RESOURCE_TYPES.includes(value.type)) {
    errors.push({ field: 'type', message: '类型取值不合法。' });
  }
  if (value.year && (!Number.isInteger(value.year) || value.year < YEAR_MIN)) {
    errors.push({ field: 'year', message: '年份取值不合法。' });
  }
  if (!['latest', 'downloads', 'year'].includes(value.sort)) value.sort = 'latest';

  return { ok: errors.length === 0, errors, value };
}

/** 管理员新增/编辑学院、专业、课程。 */
export function validateCatalogInput(kind, input = {}) {
  const errors = [];
  const name = sanitizeText(input.name);
  const slug = sanitizeText(input.slug).toLowerCase();
  const value = { name, slug, collegeId: input.collegeId ?? input.college_id ?? null, majorId: input.majorId ?? input.major_id ?? null, code: sanitizeText(input.code) || null, credits: input.credits ?? null };

  if (name.length < 2 || name.length > 80) errors.push({ field: 'name', message: '名称需 2–80 个字。' });
  if (!isSlug(slug)) errors.push({ field: 'slug', message: 'slug 只能是小写字母、数字与连字符。' });
  if (kind === 'major' || kind === 'course') {
    if (!isUuid(value.collegeId)) errors.push({ field: 'collegeId', message: '请选择所属学院。' });
  }
  if (kind === 'course' && value.majorId && !isUuid(value.majorId)) {
    errors.push({ field: 'majorId', message: '专业 id 格式不正确。' });
  }
  if (kind === 'course' && value.credits !== null && (Number.isNaN(Number(value.credits)) || Number(value.credits) < 0 || Number(value.credits) > 30)) {
    errors.push({ field: 'credits', message: '学分需在 0–30 之间。' });
  }
  if (kind === 'course') value.credits = value.credits === null ? null : Number(value.credits);

  return { ok: errors.length === 0, errors, value };
}

/** 审核备注 / 驳回理由。 */
export function validateModerationNote(note, { field = 'reason', max = 200 } = {}) {
  const reason = sanitizeText(note, { multiline: true });
  return reason.length > max
    ? { ok: false, errors: [{ field, message: `说明最多 ${max} 字。` }], value: reason }
    : { ok: true, errors: [], value: reason };
}
