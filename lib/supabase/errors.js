/**
 * 统一错误模型：所有 lib/supabase 方法只抛出 BackendError。
 * 前端可按 code 做提示，无需解析 Postgres/Supabase 原始报错。
 */

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RESOURCE_NOT_PUBLISHED: 'RESOURCE_NOT_PUBLISHED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',
  STORAGE_ERROR: 'STORAGE_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONFIG_ERROR: 'CONFIG_ERROR',
};

export class BackendError extends Error {
  /**
   * @param {string} code ERROR_CODES 之一
   * @param {string} message 面向用户的中文提示
   * @param {{ status?: number, field?: string, cause?: unknown }} [meta]
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.status = meta.status ?? statusForCode(code);
    this.field = meta.field;
    this.cause = meta.cause;
  }

  /** 可安全返回给浏览器的 JSON。 */
  toJSON() {
    return { error: { code: this.code, message: this.message, field: this.field } };
  }
}

function statusForCode(code) {
  switch (code) {
    case ERROR_CODES.VALIDATION:
      return 422;
    case ERROR_CODES.NOT_FOUND:
      return 404;
    case ERROR_CODES.FORBIDDEN:
      return 403;
    case ERROR_CODES.CONFLICT:
      return 409;
    case ERROR_CODES.RESOURCE_NOT_PUBLISHED:
      return 404;
    case ERROR_CODES.FILE_TOO_LARGE:
      return 413;
    case ERROR_CODES.FILE_TYPE_NOT_ALLOWED:
      return 415;
    case ERROR_CODES.RATE_LIMITED:
      return 429;
    default:
      return 500;
  }
}

/**
 * 把 supabase-js / Postgres 的错误收敛成 BackendError。
 * @param {unknown} error
 * @param {string} [fallbackMessage]
 */
export function normalizeSupabaseError(error, fallbackMessage = '数据库操作失败，请稍后重试。') {
  if (error instanceof BackendError) return error;

  const code = error?.code;
  const message = String(error?.message ?? '');

  if (code === 'P0002' || /RESOURCE_NOT_PUBLISHED/.test(message)) {
    return new BackendError(ERROR_CODES.RESOURCE_NOT_PUBLISHED, '该资料尚未通过审核或已被下架。', { cause: error });
  }
  if (code === '42501' || /FORBIDDEN|row-level security/i.test(message)) {
    return new BackendError(ERROR_CODES.FORBIDDEN, '没有权限执行该操作。', { cause: error });
  }
  if (code === '23505') {
    return new BackendError(ERROR_CODES.CONFLICT, '记录已存在（重复名称或 slug）。', { cause: error });
  }
  if (code === '23503') {
    return new BackendError(ERROR_CODES.VALIDATION, '关联的课程、专业或学院不存在。', { cause: error });
  }
  if (code === '23514' || code === '22P02') {
    return new BackendError(ERROR_CODES.VALIDATION, '字段取值不合法，请检查年份、学期与类型。', { cause: error });
  }
  if (/payload too large|exceeded the maximum allowed size|too large/i.test(message)) {
    return new BackendError(ERROR_CODES.FILE_TOO_LARGE, '文件超过 50MB 上限。', { cause: error });
  }
  if (/mime type .* is not supported|invalid mime type/i.test(message)) {
    return new BackendError(ERROR_CODES.FILE_TYPE_NOT_ALLOWED, '仅支持 PDF、图片与 DOC/DOCX。', { cause: error });
  }
  if (error?.statusCode === '403' || error?.error === 'Unauthorized') {
    return new BackendError(ERROR_CODES.FORBIDDEN, '服务端密钥缺失或无效。', { cause: error });
  }

  return new BackendError(ERROR_CODES.DATABASE_ERROR, fallbackMessage, { cause: error });
}

/** 校验失败时统一抛这个。 */
export function validationError(errors, message = '提交内容不合法。') {
  const first = errors?.[0];
  return new BackendError(ERROR_CODES.VALIDATION, first?.message ?? message, {
    field: first?.field,
    cause: errors,
  });
}
