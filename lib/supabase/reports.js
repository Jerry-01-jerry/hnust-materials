/**
 * 举报 / 投诉：匿名可提交（进 pending），匿名不可读（连自己提交的都读不到，防探测）。
 * 管理端（service）可读全部并标记 resolved / dismissed。
 */

import { BackendError, ERROR_CODES, normalizeSupabaseError, validationError } from './errors.js';
import { isUuid, validateModerationNote, validatePagination, validateReportInput } from './validation.js';

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

/** 匿名提交举报。 */
export async function createReport(input = {}, { client } = {}) {
  const checked = validateReportInput(input);
  if (!checked.ok) throw validationError(checked.errors);

  const db = await ensureReadClient(client);
  const id = globalThis.crypto.randomUUID();

  const { error } = await db.from('reports').insert({
    id,
    resource_id: checked.value.resourceId,
    reason: checked.value.reason,
    detail: checked.value.detail,
    contact: checked.value.contact,
    reporter_id: null, // 预留
    status: 'pending',
  });
  if (error) {
    if (error.code === '23503') {
      throw new BackendError(ERROR_CODES.NOT_FOUND, '举报的资料不存在。', { status: 404 });
    }
    throw normalizeSupabaseError(error, '举报提交失败，请稍后重试。');
  }

  return { id, status: 'pending', message: '举报已收到，我们会尽快处理。' };
}

/** 管理端：举报列表。 */
export async function listReports({ status = 'pending', page, pageSize = 20, client } = {}) {
  const db = await ensureServiceClient(client);
  const pagination = validatePagination({ page, pageSize });

  let query = db
    .from('reports')
    .select(
      'id, resource_id, reason, detail, contact, reporter_id, status, resolution_note, resolved_at, created_at, resource:resources(id, title, status, file_url, uploader_name)',
      { count: 'exact' },
    );
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error, count } = await query
    .order('created_at', { ascending: status === 'pending' })
    .range(pagination.from, pagination.to);

  if (error) throw normalizeSupabaseError(error, '读取举报列表失败。');
  return { data: data ?? [], total: count ?? 0, page: pagination.page, pageSize: pagination.pageSize };
}

/**
 * 处理举报。
 * @param {'resolved'|'dismissed'} status
 */
export async function closeReport(reportId, { status = 'resolved', note = '' } = {}, { client } = {}) {
  if (!isUuid(reportId)) throw new BackendError(ERROR_CODES.VALIDATION, '举报 id 格式不正确。', { field: 'id' });
  if (!['resolved', 'dismissed'].includes(status)) {
    throw new BackendError(ERROR_CODES.VALIDATION, '处理结果只能是 resolved 或 dismissed。', { field: 'status' });
  }
  const checked = validateModerationNote(note, { max: 500 });
  if (!checked.ok) throw validationError(checked.errors);

  const db = await ensureServiceClient(client);
  const { data, error } = await db
    .from('reports')
    .update({
      status,
      resolution_note: checked.value || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId)
    .select('id, status, resolution_note, resolved_at')
    .single();
  if (error) throw normalizeSupabaseError(error, '处理举报失败。');
  return data;
}

/** 管理端：待处理举报数。 */
export async function countPendingReports({ client } = {}) {
  const db = await ensureServiceClient(client);
  const { count, error } = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw normalizeSupabaseError(error, '统计举报失败。');
  return count ?? 0;
}

/** 某个资源的历史举报（管理端）。 */
export async function listReportsForResource(resourceId, { client } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'resourceId' });
  const db = await ensureServiceClient(client);
  const { data, error } = await db
    .from('reports')
    .select('id, reason, detail, contact, status, resolution_note, resolved_at, created_at')
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false });
  if (error) throw normalizeSupabaseError(error, '读取举报记录失败。');
  return data ?? [];
}
