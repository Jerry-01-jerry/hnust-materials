/**
 * 评论：匿名可提交，进 pending；只有 published 对外可见。
 * 管理端（service）可读全部、通过、驳回、删除。
 */

import { BackendError, ERROR_CODES, normalizeSupabaseError, validationError } from './errors.js';
import { isUuid, validateCommentInput, validatePagination } from './validation.js';

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

/** 某条资源下已发布的评论（时间倒序）。 */
export async function listComments(resourceId, { page, pageSize = 20, client } = {}) {
  if (!isUuid(resourceId)) throw new BackendError(ERROR_CODES.VALIDATION, '资源 id 格式不正确。', { field: 'resourceId' });
  const db = await ensureReadClient(client);
  const pagination = validatePagination({ page, pageSize });

  const { data, error, count } = await db
    .from('comments')
    .select('id, resource_id, author_id, author_name, content, created_at', { count: 'exact' })
    .eq('resource_id', resourceId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .range(pagination.from, pagination.to);

  if (error) throw normalizeSupabaseError(error, '读取评论失败。');
  return { data: data ?? [], total: count ?? 0, page: pagination.page, pageSize: pagination.pageSize };
}

/** 匿名提交评论 → 待审。 */
export async function createComment(input = {}, { client } = {}) {
  const checked = validateCommentInput(input);
  if (!checked.ok) throw validationError(checked.errors);

  const db = await ensureReadClient(client);
  const id = globalThis.crypto.randomUUID();

  const { error } = await db.from('comments').insert({
    id,
    resource_id: checked.value.resourceId,
    content: checked.value.content,
    author_id: null, // 预留
    author_name: checked.value.authorName,
    status: 'pending',
  });
  if (error) throw normalizeSupabaseError(error, '评论提交失败，请稍后重试。');

  return { id, status: 'pending', message: '评论已提交，审核通过后展示。' };
}

/** 管理端：评论审核队列。 */
export async function listCommentsForModeration({ status = 'pending', page, pageSize = 20, client } = {}) {
  const db = await ensureServiceClient(client);
  const pagination = validatePagination({ page, pageSize });

  let query = db
    .from('comments')
    .select('id, resource_id, content, author_name, status, created_at, resource:resources(id, title)', { count: 'exact' });
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error, count } = await query
    .order('created_at', { ascending: status === 'pending' })
    .range(pagination.from, pagination.to);

  if (error) throw normalizeSupabaseError(error, '读取评论审核队列失败。');
  return { data: data ?? [], total: count ?? 0, page: pagination.page, pageSize: pagination.pageSize };
}

async function setCommentStatus(commentId, status, { client } = {}) {
  if (!isUuid(commentId)) throw new BackendError(ERROR_CODES.VALIDATION, '评论 id 格式不正确。', { field: 'id' });
  const db = await ensureServiceClient(client);
  const { data, error } = await db
    .from('comments')
    .update({ status })
    .eq('id', commentId)
    .select('id, status')
    .single();
  if (error) throw normalizeSupabaseError(error, '更新评论状态失败。');
  return data;
}

export function approveComment(commentId, options) {
  return setCommentStatus(commentId, 'published', options);
}

export function rejectComment(commentId, options) {
  return setCommentStatus(commentId, 'rejected', options);
}

export async function deleteComment(commentId, { client } = {}) {
  if (!isUuid(commentId)) throw new BackendError(ERROR_CODES.VALIDATION, '评论 id 格式不正确。', { field: 'id' });
  const db = await ensureServiceClient(client);
  const { error } = await db.from('comments').delete().eq('id', commentId);
  if (error) throw normalizeSupabaseError(error, '删除评论失败。');
  return { id: commentId };
}

/** 管理端：待审评论数。 */
export async function countPendingComments({ client } = {}) {
  const db = await ensureServiceClient(client);
  const { count, error } = await db
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw normalizeSupabaseError(error, '统计评论失败。');
  return count ?? 0;
}
