/**
 * 目录数据访问：学院 / 专业 / 课程。
 *
 * 读：匿名可用（anon key，RLS 允许 select）。
 * 写：仅管理员，必须传 service 客户端（见 lib/supabase/server.js）。
 */

import { normalizeSupabaseError, validationError, BackendError, ERROR_CODES } from './errors.js';
import { isUuid, sanitizeText, validateCatalogInput, validatePagination } from './validation.js';
import { DEFAULT_PAGE_SIZE } from './config.js';

async function ensureClient(client) {
  if (client) return client;
  const { getAnonClient } = await import('./server.js');
  return getAnonClient();
}

/** 全部学院（数量很小，不分页）。 */
export async function listColleges({ client } = {}) {
  const db = await ensureClient(client);
  const { data, error } = await db
    .from('colleges')
    .select('id, name, slug, created_at')
    .order('name', { ascending: true });
  if (error) throw normalizeSupabaseError(error, '读取学院列表失败。');
  return data ?? [];
}

/**
 * 专业列表。
 * @param {{ collegeSlug?: string, collegeId?: string, client?: object }} [options]
 */
export async function listMajors({ collegeSlug, collegeId, client } = {}) {
  const db = await ensureClient(client);
  let query = db.from('majors').select('id, name, slug, college_id, colleges!inner(id, name, slug)');
  if (collegeId) query = query.eq('college_id', collegeId);
  if (collegeSlug) query = query.eq('colleges.slug', collegeSlug);

  const { data, error } = await query.order('name', { ascending: true });
  if (error) throw normalizeSupabaseError(error, '读取专业列表失败。');
  return data ?? [];
}

/**
 * 课程列表 / 搜索。
 * @param {{
 *   collegeSlug?: string, majorSlug?: string, query?: string,
 *   page?: number, pageSize?: number, client?: object
 * }} [options]
 */
export async function listCourses({ collegeSlug, majorSlug, query, page, pageSize, client } = {}) {
  const db = await ensureClient(client);
  const { page: safePage, pageSize: size, from, to } = validatePagination({ page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE * 2 });

  let request = db
    .from('courses')
    .select(
      'id, name, slug, code, credits, college_id, major_id, colleges!inner(id, name, slug), majors(id, name, slug)',
      { count: 'exact' },
    );

  if (collegeSlug) request = request.eq('colleges.slug', collegeSlug);
  if (majorSlug) request = request.eq('majors.slug', majorSlug);

  const keyword = sanitizeText(query);
  if (keyword) request = request.or(`name.ilike.%${keyword}%,slug.ilike.%${keyword}%`);

  const { data, error, count } = await request
    .order('name', { ascending: true })
    .range(from, to);

  if (error) throw normalizeSupabaseError(error, '读取课程列表失败。');
  return { data: data ?? [], total: count ?? 0, page: safePage, pageSize: size };
}

/** 单门课程：传 uuid 或 slug 均可。 */
export async function getCourse({ id, slug, client } = {}) {
  if (!id && !slug) throw new BackendError(ERROR_CODES.VALIDATION, '请提供课程 id 或 slug。', { field: 'id' });
  const db = await ensureClient(client);

  const request = db
    .from('courses')
    .select('id, name, slug, code, credits, college_id, major_id, colleges(id, name, slug), majors(id, name, slug)');

  const { data, error } = await (isUuid(id ?? '') ? request.eq('id', id) : request.eq('slug', slug ?? id)).maybeSingle();
  if (error) throw normalizeSupabaseError(error, '读取课程失败。');
  if (!data) throw new BackendError(ERROR_CODES.NOT_FOUND, '课程不存在。', { status: 404 });
  return data;
}

/* ------------------------------------------------------------------ */
/* 管理端（service 客户端）                                            */
/* ------------------------------------------------------------------ */

function assertService(client) {
  if (!client) throw new BackendError(ERROR_CODES.CONFIG_ERROR, '写目录需要服务端 service 客户端。');
  return client;
}

export async function createCollege(input, { client } = {}) {
  const db = assertService(client);
  const check = validateCatalogInput('college', input);
  if (!check.ok) throw validationError(check.errors);

  const { data, error } = await db
    .from('colleges')
    .insert({ name: check.value.name, slug: check.value.slug })
    .select('id, name, slug')
    .single();
  if (error) throw normalizeSupabaseError(error, '新增学院失败。');
  return data;
}

export async function createMajor(input, { client } = {}) {
  const db = assertService(client);
  const check = validateCatalogInput('major', input);
  if (!check.ok) throw validationError(check.errors);

  const { data, error } = await db
    .from('majors')
    .insert({ name: check.value.name, slug: check.value.slug, college_id: check.value.collegeId })
    .select('id, name, slug, college_id')
    .single();
  if (error) throw normalizeSupabaseError(error, '新增专业失败。');
  return data;
}

export async function createCourse(input, { client } = {}) {
  const db = assertService(client);
  const check = validateCatalogInput('course', input);
  if (!check.ok) throw validationError(check.errors);

  const { data, error } = await db
    .from('courses')
    .insert({
      name: check.value.name,
      slug: check.value.slug,
      code: check.value.code,
      credits: check.value.credits,
      college_id: check.value.collegeId,
      major_id: check.value.majorId || null,
    })
    .select('id, name, slug, code, credits, college_id, major_id')
    .single();
  if (error) throw normalizeSupabaseError(error, '新增课程失败。');
  return data;
}

export async function updateCourse(id, input, { client } = {}) {
  const db = assertService(client);
  if (!isUuid(id)) throw new BackendError(ERROR_CODES.VALIDATION, '课程 id 格式不正确。', { field: 'id' });

  const patch = {};
  if (input.name !== undefined) patch.name = sanitizeText(input.name);
  if (input.code !== undefined) patch.code = sanitizeText(input.code) || null;
  if (input.credits !== undefined) patch.credits = input.credits === null ? null : Number(input.credits);
  if (input.majorId !== undefined) patch.major_id = input.majorId || null;

  const { data, error } = await db.from('courses').update(patch).eq('id', id).select('*').single();
  if (error) throw normalizeSupabaseError(error, '更新课程失败。');
  return data;
}

/** 删除课程：存在资源时数据库会以 23503 拒绝（on delete restrict）。 */
export async function deleteCourse(id, { client } = {}) {
  const db = assertService(client);
  const { error } = await db.from('courses').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new BackendError(ERROR_CODES.CONFLICT, '该课程下仍有资料，无法删除。', { status: 409 });
    }
    throw normalizeSupabaseError(error, '删除课程失败。');
  }
  return { id };
}
