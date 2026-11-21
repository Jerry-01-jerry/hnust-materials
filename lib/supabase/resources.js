/**
 * 资源读写。
 *
 * 匿名路径（anon key + RLS）：
 *   listResources / getResource / incrementDownloads / createResourceSubmission
 *   —— 只能看到 published，写入一律 pending。
 *
 * 管理路径（service key，需先通过 auth.js 校验后台身份）：
 *   listModerationQueue / getResourceForAdmin / approveResource / rejectResource / deleteResource
 */

import { DEFAULT_PAGE_SIZE, RESOURCE_STATUS } from './config.js';
import { BackendError, ERROR_CODES, normalizeSupabaseError, validationError } from './errors.js';
import {
  isUuid,
  sanitizeText,
  validateModerationNote,
  validatePagination,
  validateResourceFilters,
  validateResourceInput,
} from './validation.js';
import {
  promotePendingFile,
  removeFile,
  signResourceUrl,
  signResourceUrls,
  uploadPendingFile,
  validateFileDescriptor,
} from './storage.js';

async function ensureReadClient(client) {
  if (client) return client;
  const { getAnonClient } = await import('./server.js');
  return getAnonClient();
}

async function ensureServiceClient(client) {
  if (client) return client;
  const { getServiceClient } = await import('./server.js');
  return getServiceClient();
}

/** PostgREST 的 or() 用逗号分隔条件，用户输入里的逗号/括号必须剔除。 */
function escapeFilterValue(value) {
  return String(value).replace(/[,()*%\\]/g, ' ').trim();
}

function pickOrder(sort) {
  if (sort === 'downloads') return { column: 'downloads', ascending: false };
  if (sort === 'year') return { column: 'year', ascending: false };
  return { column: 'created_at', ascending: false };
}

/* ------------------------------------------------------------------ */
/* 匿名可读                                                            */
/* ------------------------------------------------------------------ */

/**
 * 已发布资源列表 / 搜索。
 * @param {object} [filters] { query, courseId, courseSlug, collegeSlug, majorSlug, year, semester, type, sort }
 * @param {{ client?: object, page?: number, pageSize?: number, signUrls?: boolean, expiresIn?: number }} [options]
 * @returns {Promise<{ data: object[], total: number, page: number, pageSize: number }>}
 */
export async function listResources(filters = {}, options = {}) {
  const { client, page, pageSize, signUrls = false, expiresIn = 3600 } = options;

  const checked = validateResourceFilters(filters);
  if (!checked.ok) throw validationError(checked.errors);
  const f = checked.value;

  const pagination = validatePagination({ page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
  const db = await ensureReadClient(client);

  let courseSlug = f.courseSlug;
  if (f.courseId) {
    if (!isUuid(f.courseId)) throw new BackendError(ERROR_CODES.VALIDATION, '课程 id 格式不正确。', { field: 'courseId' });
    const { data: course, error: courseError } = await db.from('courses').select('slug').eq('id', f.courseId).maybeSingle();
    if (courseError) throw normalizeSupabaseError(courseError, '读取课程失败。');
    courseSlug = course?.slug ?? null;
    if (!courseSlug) return { data: [], total: 0, page: pagination.page, pageSize: pagination.pageSize };
  }

  let query = db.from('v_resources_public').select('*', { count: 'exact' });

  const keyword = escapeFilterValue(f.query);
  if (keyword) query = query.or(`title.ilike.%${keyword}%,teacher.ilike.%${keyword}%`);
  if (courseSlug) query = query.eq('course_id', courseSlug);
  if (f.collegeSlug) query = query.eq('college_id', f.collegeSlug);
  if (f.majorSlug) query = query.eq('major_id', f.majorSlug);
  if (f.year) query = query.eq('year', f.year);
  if (f.semester) query = query.eq('semester', f.semester);
  if (f.type) query = query.eq('type', f.type);

  const order = pickOrder(f.sort);
  const { data, error, count } = await query
    .order(order.column, { ascending: order.ascending })
    .order('created_at', { ascending: false })
    .range(pagination.from, pagination.to);

  if (error) throw normalizeSupabaseError(error, '读取资源列表失败。');

  const rows = data ?? [];
  if (signUrls && rows.length > 0) {
    const map = await signResourceUrls(db, rows.map((row) => row.file_url), expiresIn);
    for (const row of rows) row.download_url = map.get(row.file_url) ?? null;
  }

  return { data: rows, total: count ?? rows.length, page: pagination.page, pageSize: pagination.pageSize };
}

/** 单条已发布资源（含签名下载地址）。 */
export async function getResource(resourceId, { client, expiresIn = 3600 } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'id' });
  const db = await ensureReadClient(client);

  const { data, error } = await db.from('v_resources_public').select('*').eq('id', resourceId).maybeSingle();
  if (error) throw normalizeSupabaseError(error, '读取资源失败。');
  if (!data) throw new BackendError(ERROR_CODES.NOT_FOUND, '资料不存在或尚未通过审核。', { status: 404 });

  return { ...data, download_url: await signResourceUrl(db, data.file_url, expiresIn) };
}

/**
 * 下载计数 +1（RPC，匿名可调；未发布资源会抛 RESOURCE_NOT_PUBLISHED）。
 * @returns {Promise<number>} 最新下载数
 */
export async function incrementDownloads(resourceId, { client } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'id' });
  const db = await ensureReadClient(client);

  const { data, error } = await db.rpc('increment_downloads', { p_resource_id: resourceId });
  if (error) throw normalizeSupabaseError(error, '下载计数更新失败。');
  return Number(data ?? 0);
}

/**
 * 匿名提交一条待审资源（可带文件）。
 * 文件先落 pending/，再写入 resources(status=pending)，两步失败都会回滚已上传对象。
 *
 * @param {object} input { title, courseId|courseSlug, year, semester, type, teacher?, uploaderName?, fileUrl? }
 * @param {{ client?: object, file?: File|{name:string,type:string,size:number,buffer:Uint8Array} }} [options]
 */
export async function createResourceSubmission(input = {}, { client, file } = {}) {
  const checked = validateResourceInput(input);
  if (!checked.ok) throw validationError(checked.errors);
  const value = checked.value;

  if (!file && !value.fileUrl) {
    throw new BackendError(ERROR_CODES.VALIDATION, '请上传文件或提供文件地址。', { field: 'file' });
  }
  if (file) {
    const fileCheck = validateFileDescriptor(file);
    if (!fileCheck.ok) throw validationError(fileCheck.errors);
  }

  const db = await ensureReadClient(client);

  const courseQuery = db.from('courses').select('id, name, slug').limit(1);
  const { data: course, error: courseError } = await (value.courseId
    ? courseQuery.eq('id', value.courseId)
    : courseQuery.eq('slug', value.courseSlug)
  ).maybeSingle();
  if (courseError) throw normalizeSupabaseError(courseError, '读取课程失败。');
  if (!course) throw new BackendError(ERROR_CODES.VALIDATION, '课程不存在，请重新选择。', { field: 'courseId' });

  let uploaded = null;
  try {
    if (file) uploaded = await uploadPendingFile(db, file);

    const id = globalThis.crypto.randomUUID();
    const { error } = await db.from('resources').insert({
      id,
      title: value.title,
      course_id: course.id,
      year: value.year,
      semester: value.semester,
      type: value.type,
      teacher: value.teacher,
      file_url: uploaded?.path ?? value.fileUrl,
      file_name: uploaded?.name ?? null,
      file_size: uploaded?.size ?? null,
      mime_type: uploaded?.mime ?? null,
      uploader_id: null, // 预留：接入登录后填 auth.uid()
      uploader_name: value.uploaderName,
      downloads: 0,
      status: RESOURCE_STATUS.PENDING,
    });
    if (error) throw normalizeSupabaseError(error, '提交失败，请稍后重试。');

    return {
      id,
      status: RESOURCE_STATUS.PENDING,
      title: value.title,
      course: { id: course.id, slug: course.slug, name: course.name },
      fileUrl: uploaded?.path ?? value.fileUrl,
      message: '提交成功，待审核。',
    };
  } catch (error) {
    if (uploaded?.path) await removeFile(db, uploaded.path).catch(() => {});
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* 管理端（service 客户端）                                            */
/* ------------------------------------------------------------------ */

/**
 * 审核队列。
 * @param {{ status?: 'pending'|'published'|'rejected'|'all', page?: number, pageSize?: number, client?: object }} [options]
 */
export async function listModerationQueue({ status = 'pending', page, pageSize, client } = {}) {
  const db = await ensureServiceClient(client);
  const pagination = validatePagination({ page, pageSize: pageSize ?? 20 });

  let query = db
    .from('resources')
    .select(
      'id, title, year, semester, type, teacher, file_url, file_name, file_size, mime_type, uploader_id, uploader_name, downloads, status, reject_reason, reviewed_at, created_at, course:courses(id, name, slug, college:colleges(id, name, slug), major:majors(id, name))',
      { count: 'exact' },
    );

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error, count } = await query
    .order('created_at', { ascending: status === 'pending' })
    .range(pagination.from, pagination.to);

  if (error) throw normalizeSupabaseError(error, '读取审核队列失败。');

  const rows = data ?? [];
  const map = await signResourceUrls(db, rows.map((row) => row.file_url), 600);
  for (const row of rows) row.preview_url = map.get(row.file_url) ?? null;

  return { data: rows, total: count ?? rows.length, page: pagination.page, pageSize: pagination.pageSize };
}

/** 管理端单条（含任意状态、驳回理由、待审预览地址）。 */
export async function getResourceForAdmin(resourceId, { client } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'id' });
  const db = await ensureServiceClient(client);

  const { data, error } = await db
    .from('resources')
    .select('*, course:courses(id, name, slug, college:colleges(id, name, slug))')
    .eq('id', resourceId)
    .maybeSingle();
  if (error) throw normalizeSupabaseError(error, '读取资源失败。');
  if (!data) throw new BackendError(ERROR_CODES.NOT_FOUND, '资源不存在。', { status: 404 });

  return { ...data, preview_url: await signResourceUrl(db, data.file_url, 600) };
}

/**
 * 审核通过：把 Storage 对象从 pending/ 移到 published/，再置为 published。
 * 幂等：已发布资源直接返回。
 */
export async function approveResource(resourceId, { client } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'id' });
  const db = await ensureServiceClient(client);

  const { data: current, error: readError } = await db
    .from('resources')
    .select('id, status, file_url')
    .eq('id', resourceId)
    .maybeSingle();
  if (readError) throw normalizeSupabaseError(readError, '读取资源失败。');
  if (!current) throw new BackendError(ERROR_CODES.NOT_FOUND, '资源不存在。', { status: 404 });
  if (current.status === RESOURCE_STATUS.PUBLISHED) return { id: resourceId, status: current.status, file_url: current.file_url };

  const publishedPath = await promotePendingFile(db, current.file_url);

  const { data, error } = await db
    .from('resources')
    .update({
      status: RESOURCE_STATUS.PUBLISHED,
      file_url: publishedPath,
      reject_reason: null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', resourceId)
    .select('id, status, file_url, reviewed_at')
    .single();
  if (error) throw normalizeSupabaseError(error, '发布失败。');
  return data;
}

/** 驳回：status=rejected + 理由，文件保留在 pending/ 便于申诉复核。 */
export async function rejectResource(resourceId, reason, { client } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'id' });
  const note = validateModerationNote(reason);
  if (!note.ok) throw validationError(note.errors);

  const db = await ensureServiceClient(client);
  const { data, error } = await db
    .from('resources')
    .update({
      status: RESOURCE_STATUS.REJECTED,
      reject_reason: note.value || '资料不符合收录要求。',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', resourceId)
    .select('id, status, reject_reason, reviewed_at')
    .single();
  if (error) throw normalizeSupabaseError(error, '驳回失败。');
  return data;
}

/** 删除资源（含 Storage 对象）。 */
export async function deleteResource(resourceId, { client } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'id' });
  const db = await ensureServiceClient(client);

  const { data: current } = await db.from('resources').select('id, file_url').eq('id', resourceId).maybeSingle();
  if (!current) throw new BackendError(ERROR_CODES.NOT_FOUND, '资源不存在。', { status: 404 });

  const { error } = await db.from('resources').delete().eq('id', resourceId);
  if (error) throw normalizeSupabaseError(error, '删除资源失败。');

  await removeFile(db, current.file_url);
  return { id: resourceId };
}

/** 各状态计数（后台首页统计）。 */
export async function countResourcesByStatus({ client } = {}) {
  const db = await ensureServiceClient(client);
  const statuses = ['pending', 'published', 'rejected'];
  const entries = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await db.from('resources').select('id', { count: 'exact', head: true }).eq('status', status);
      if (error) throw normalizeSupabaseError(error, '统计资源失败。');
      return [status, count ?? 0];
    }),
  );
  return Object.fromEntries(entries);
}

/** 兼容旧字段：前端把昵称写在 uploader 上，status 用 approved 表达已发布。 */
export function normalizeResource(row) {
  if (!row) return row;
  return {
    ...row,
    uploader: row.uploader ?? row.uploader_name ?? '匿名',
    teacher: row.teacher ?? '',
    status: row.status === 'published' ? 'approved' : row.status,
  };
}
