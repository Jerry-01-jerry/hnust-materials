/**
 * Storage 封装：resources 私有桶。
 *
 * 目录约定
 *   pending/<uuid>/<文件名>   —— 匿名上传落地，仅管理员可读，未审核不可公开
 *   published/<uuid>/<文件名> —— 审核通过后由服务端移动过来，匿名可读（签名 URL）
 *
 * 限制：PDF / JPG / PNG / WEBP / GIF / DOC / DOCX，单文件 ≤ 50MB。
 *      数据库侧 storage.buckets 已再次限制，双层兜底。
 */

import {
  ALLOWED_MIME_TYPES,
  EXTENSION_MIME,
  MAX_FILE_BYTES,
  PENDING_PREFIX,
  PUBLISHED_PREFIX,
  RESOURCE_BUCKET,
} from './config.js';
import { BackendError, ERROR_CODES, normalizeSupabaseError } from './errors.js';

function newId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 取扩展名（含点，小写）。 */
export function extname(fileName = '') {
  const match = /(\.[A-Za-z0-9]{1,8})$/.exec(String(fileName).trim());
  return match ? match[1].toLowerCase() : '';
}

/** 文件名清洗：去掉路径分隔符与控制字符，保留中文。 */
export function sanitizeFileName(fileName = 'file') {
  const base = String(fileName).split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\P{C}]+/gu, '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return (cleaned || 'file').slice(0, 120);
}

/**
 * 校验文件描述（File 对象或 { name, type, size } 均可）。
 * @returns {{ ok: boolean, errors: {field:string,message:string}[], value: { name:string, mime:string, size:number, ext:string } }}
 */
export function validateFileDescriptor(file) {
  const errors = [];
  const name = sanitizeFileName(file?.name ?? '');
  const size = Number(file?.size ?? 0);
  const ext = extname(name);
  const declaredType = String(file?.type ?? '').toLowerCase();
  const mime = ALLOWED_MIME_TYPES[declaredType] ? declaredType : EXTENSION_MIME[ext] ?? '';

  if (!name) errors.push({ field: 'file', message: '请选择文件。' });
  if (!mime) {
    errors.push({ field: 'file', message: '仅支持 PDF、图片（JPG/PNG/WEBP/GIF）与 DOC/DOCX。' });
  } else if (!ALLOWED_MIME_TYPES[mime].includes(ext)) {
    errors.push({ field: 'file', message: `文件扩展名 ${ext || '(无)'} 与内容类型不匹配。` });
  }
  if (size <= 0) errors.push({ field: 'file', message: '文件为空或读取失败。' });
  else if (size > MAX_FILE_BYTES) errors.push({ field: 'file', message: '文件超过 50MB 上限。' });

  return { ok: errors.length === 0, errors, value: { name, mime, size, ext } };
}

/** 生成待审对象路径。 */
export function buildPendingPath(fileName) {
  return `${PENDING_PREFIX}/${newId()}/${sanitizeFileName(fileName)}`;
}

async function toBytes(file) {
  if (typeof file?.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  if (file?.buffer instanceof Uint8Array) return file.buffer;
  if (file?.buffer instanceof ArrayBuffer) return new Uint8Array(file.buffer);
  throw new BackendError(ERROR_CODES.VALIDATION, '无法读取文件内容。', { field: 'file' });
}

/**
 * 服务端代理上传（≤50MB 走 Node 中转；大文件建议用 createUploadTicket 直传）。
 * @param {import('@supabase/supabase-js').SupabaseClient} client anon 或 service 客户端
 * @param {File|{name:string,type:string,size:number,buffer:Uint8Array|ArrayBuffer}} file
 * @param {{ path?: string }} [options]
 */
export async function uploadPendingFile(client, file, options = {}) {
  const check = validateFileDescriptor(file);
  if (!check.ok) throw new BackendError(ERROR_CODES.VALIDATION, check.errors[0].message, { field: 'file' });

  const path = options.path ?? buildPendingPath(check.value.name);
  const bytes = await toBytes(file);

  const { error } = await client.storage.from(RESOURCE_BUCKET).upload(path, bytes, {
    contentType: check.value.mime,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw normalizeSupabaseError(error, '文件上传失败，请重试。');

  return { path, name: check.value.name, size: check.value.size, mime: check.value.mime };
}

/**
 * 直传票据：浏览器 PUT 到 signedUrl，避免 50MB 经过 Next.js 进程。
 * 需要 service 客户端（或将来带 admin 身份的客户端）。
 */
export async function createUploadTicket(serviceClient, { fileName, mimeType, size }) {
  const check = validateFileDescriptor({ name: fileName, type: mimeType, size });
  if (!check.ok) throw new BackendError(ERROR_CODES.VALIDATION, check.errors[0].message, { field: 'file' });

  const path = buildPendingPath(check.value.name);
  const { data, error } = await serviceClient.storage.from(RESOURCE_BUCKET).createSignedUploadUrl(path);
  if (error) throw normalizeSupabaseError(error, '生成上传地址失败。');

  return {
    path,
    token: data?.token ?? null,
    signedUrl: data?.signedUrl ?? null,
    mime: check.value.mime,
    maxBytes: MAX_FILE_BYTES,
  };
}

/**
 * 审核通过后把对象从 pending/ 搬到 published/，返回新路径。
 * 已发布路径原样返回（幂等）。
 */
export async function promotePendingFile(serviceClient, path) {
  if (!path || typeof path !== 'string') return path;
  if (!path.startsWith(`${PENDING_PREFIX}/`)) return path;

  const target = `${PUBLISHED_PREFIX}/${newId()}/${sanitizeFileName(path.split('/').pop())}`;
  const bucket = serviceClient.storage.from(RESOURCE_BUCKET);

  const copied = await bucket.copy(path, target);
  if (copied.error) throw normalizeSupabaseError(copied.error, '发布文件失败（复制对象出错）。');

  const removed = await bucket.remove([path]);
  if (removed.error) {
    // 复制成功即已可读，删除失败只影响垃圾回收，不阻断发布
    console.warn('[storage] 待审对象清理失败', path, removed.error.message);
  }

  return target;
}

/** 签名下载地址（私有桶必须签名；anonymous 只对 published/ 有权限）。 */
export async function signResourceUrl(client, path, expiresIn = 60 * 60) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path; // 外链或 public/ 站内文件

  const { data, error } = await client.storage.from(RESOURCE_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw normalizeSupabaseError(error, '生成下载地址失败。');
  return data?.signedUrl ?? null;
}

/** 批量签名（列表页），失败的项返回 null。 */
export async function signResourceUrls(client, paths, expiresIn = 60 * 60) {
  const unique = [...new Set((paths ?? []).filter((p) => p && !/^https?:\/\//i.test(p) && !p.startsWith('/')))];
  if (unique.length === 0) return new Map();

  const { data, error } = await client.storage.from(RESOURCE_BUCKET).createSignedUrls(unique, expiresIn);
  if (error) throw normalizeSupabaseError(error, '批量生成下载地址失败。');

  const map = new Map();
  for (const item of data ?? []) {
    map.set(item.path, item.error ? null : item.signedUrl);
  }
  return map;
}

/** 把 file_url 解析成可点击地址（已是外链/站内路径则原样返回）。 */
export async function resolveFileUrl(client, fileUrl, expiresIn = 60 * 60) {
  return signResourceUrl(client, fileUrl, expiresIn);
}

/** 删除对象（管理员下架资源时用）。 */
export async function removeFile(serviceClient, path) {
  if (!path || /^https?:\/\//i.test(path) || path.startsWith('/')) return;
  const { error } = await serviceClient.storage.from(RESOURCE_BUCKET).remove([path]);
  if (error) console.warn('[storage] 删除对象失败', path, error.message);
}
